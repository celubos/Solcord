// SPDX-License-Identifier: Apache-2.0

using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Solcord.Installer;

internal sealed record ReleaseManifest(string Version, string CandidateLabel, string SourceCommit, string ArtifactSha256, string ArtifactFile, string BuildManifestSha256, int SchemaVersion, string SupportedDiscord, string ReleaseNotes);
internal sealed record DiscordTarget(string Channel, string Version, string ExecutablePath, string ProcessName);
internal sealed record InstallReceipt(string Version, string SourceCommit, string ArtifactSha256, string Channel, string DiscordVersion, string InstalledAtUtc, string? BackupDirectory, string? CandidateLabel = null, string? DiscordArchiveSha256 = null);
internal sealed record SolcordFirstSetupIntent(int Version, string IntentId, string Purpose, string Channel, string DiscordVersion, string SourceCommit, string ArtifactSha256, string CreatedAtUtc, int Attempts);
internal sealed record InjectorBackupState(bool HadAppDirectory, string OriginalModule, string Channel, string DiscordVersion, string? IndexSha256, string? PackageSha256, string? OriginalModuleSha256 = null);
internal sealed record BackupState(bool HadCore, string? ExistingCoreSha256, string InstalledArtifactSha256, string CandidateVersion, string CandidateSourceCommit, InjectorBackupState Injector, string? CandidateLabel = null, string? PreviousReceiptSha256 = null, bool PreviousLauncherRecorded = false);
internal sealed record UninstallBackupState(string Channel, string DiscordVersion, string CandidateLabel, string CoreSha256, string IndexSha256, string PackageSha256, string ReceiptSha256);
internal sealed record UninstallJournal(int SchemaVersion, string BackupDirectory, string BackupStateSha256, string ArchiveSha256, string OriginalModule);

internal sealed class InstallerEngine
{
    private static readonly Regex Sha256Pattern = new("^[0-9a-f]{64}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private readonly string _bundleRoot;
    private readonly string _localAppData;
    private readonly string _roamingAppData;
    private readonly Func<string, int> _runningProcessCount;
    private readonly Action<IReadOnlyList<string>> _stopDiscordProcesses;
    private readonly Action<int> _delay;
    private readonly Action<string>? _mutationHook;

    internal string? LastLauncherWarning {get; private set;}

    internal InstallerEngine(
        string bundleRoot,
        string localAppData,
        string roamingAppData,
        Func<string, int>? runningProcessCount = null,
        Action<string>? mutationHook = null,
        Action<IReadOnlyList<string>>? discordProcessStopper = null,
        Action<int>? delay = null)
    {
        _bundleRoot = Path.GetFullPath(bundleRoot);
        _localAppData = Path.GetFullPath(localAppData);
        _roamingAppData = Path.GetFullPath(roamingAppData);
        _runningProcessCount = runningProcessCount ?? (name => Process.GetProcessesByName(name).Length);
        _mutationHook = mutationHook;
        _stopDiscordProcesses = discordProcessStopper ?? StopDiscordProcesses;
        _delay = delay ?? Thread.Sleep;
    }

    internal ReleaseManifest LoadManifest()
    {
        string file = Path.Combine(_bundleRoot, "solcord-installer-manifest.json");
        if (!File.Exists(file) || new FileInfo(file).Length is <= 0 or > 64 * 1024) throw new InvalidDataException("The installer manifest is missing or oversized.");
        return ParseManifest(File.ReadAllBytes(file));
    }

    internal static ReleaseManifest ParseManifest(ReadOnlySpan<byte> json)
    {
        if (json.Length is <= 0 or > 64 * 1024) throw new InvalidDataException("The installer manifest is missing or oversized.");
        ReleaseManifest? manifest;
        try {manifest = JsonSerializer.Deserialize<ReleaseManifest>(json, new JsonSerializerOptions {PropertyNameCaseInsensitive = true});}
        catch {throw new InvalidDataException("The installer manifest failed validation.");}
        if (manifest is null || !Sha256Pattern.IsMatch(manifest.ArtifactSha256) || !Sha256Pattern.IsMatch(manifest.BuildManifestSha256) || manifest.SchemaVersion != 7 || !Regex.IsMatch(manifest.Version, "^\\d+\\.\\d+\\.\\d+(?:\\.\\d+)?$") || !Version.TryParse(manifest.Version, out _) || string.IsNullOrEmpty(manifest.CandidateLabel) || !IsCandidateLabelForVersion(manifest.CandidateLabel, manifest.Version) || !Regex.IsMatch(manifest.SourceCommit, "^[0-9a-f]{40}$")) throw new InvalidDataException("The installer manifest failed validation.");
        if (Path.GetFileName(manifest.ArtifactFile) != manifest.ArtifactFile || !manifest.ArtifactFile.EndsWith(".asar", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The manifest artifact name is unsafe.");
        return manifest;
    }

    internal IReadOnlyList<DiscordTarget> DetectTargets()
    {
        var definitions = new[] {("Stable", "Discord", "Discord"), ("PTB", "DiscordPTB", "DiscordPTB"), ("Canary", "DiscordCanary", "DiscordCanary")};
        var targets = new List<DiscordTarget>();
        foreach ((string channel, string directoryName, string processName) in definitions)
        {
            string root = Path.Combine(_localAppData, directoryName);
            if (!Directory.Exists(root)) continue;
            var candidates = Directory.EnumerateDirectories(root, "app-*", SearchOption.TopDirectoryOnly)
                .Select(directory => {
                    string version = Path.GetFileName(directory)[4..];
                    return (Directory: directory, Version: version, ParsedVersion: Version.TryParse(version, out Version? parsed) ? parsed : null);
                })
                .Where(candidate => candidate.ParsedVersion is not null)
                .OrderByDescending(candidate => candidate.ParsedVersion);
            foreach (var candidate in candidates)
            {
                var target = new DiscordTarget(channel, candidate.Version, Path.Combine(candidate.Directory, $"{processName}.exe"), processName);
                try {RequireReadyTarget(target);}
                catch (Exception error) when (error is IOException or InvalidDataException or UnauthorizedAccessException) {continue;}
                targets.Add(target);
                break;
            }
        }
        return targets;
    }

    private void RequireReadyTarget(DiscordTarget target)
    {
        string processName = target.Channel switch {"Stable" => "Discord", "PTB" => "DiscordPTB", "Canary" => "DiscordCanary", _ => ""};
        if (processName.Length == 0 || target.ProcessName != processName || !Version.TryParse(target.Version, out _))
            throw new InvalidDataException("The selected Discord version is not a supported installation.");
        string expected = Path.Combine(_localAppData, processName, $"app-{target.Version}", $"{processName}.exe");
        if (!Path.GetFullPath(target.ExecutablePath).Equals(expected, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("The selected Discord version does not match its installation folder.");
        RejectLinkedPath(_localAppData, target.ExecutablePath);
        if (!File.Exists(target.ExecutablePath) || new FileInfo(target.ExecutablePath).Length == 0)
            throw new InvalidDataException("The selected Discord installation is incomplete. Finish its update before trying again.");
        RequireOriginalModule(Path.Combine(Path.GetDirectoryName(target.ExecutablePath)!, "resources"));
    }

    private static string RequireOriginalModule(string resources)
    {
        if (!Directory.Exists(resources)) throw new InvalidDataException("The selected Discord resources directory is missing.");
        RejectReparsePoint(resources);
        if (Directory.Exists(Path.Combine(resources, "app.asar")) || Directory.Exists(Path.Combine(resources, "betterdiscord.app.asar")))
            throw new InvalidDataException("A Discord startup archive path is occupied by a directory; no files were replaced.");
        if (File.Exists(Path.Combine(resources, "app.asar")) && File.Exists(Path.Combine(resources, "betterdiscord.app.asar")))
            throw new InvalidDataException("Discord has two competing startup archives. No files were replaced; finish or repair its update first.");
        string module = File.Exists(Path.Combine(resources, "betterdiscord.app.asar")) ? "betterdiscord.app.asar" : "app.asar";
        string file = Path.Combine(resources, module);
        RejectLinkedPath(resources, file);
        if (!File.Exists(file) || new FileInfo(file).Length == 0)
            throw new InvalidDataException("The selected Discord installation is incomplete. Finish its update before trying again.");
        return $"../{module}";
    }

    private DiscordTarget RequireRecordedTarget(DiscordTarget selected, InstallReceipt receipt)
    {
        if (selected.Channel != receipt.Channel || !Version.TryParse(receipt.DiscordVersion, out _))
            throw new InvalidDataException("Select the Discord channel recorded by this Solcord installation to manage it.");
        string processName = receipt.Channel switch {"Stable" => "Discord", "PTB" => "DiscordPTB", "Canary" => "DiscordCanary", _ => ""};
        var target = new DiscordTarget(receipt.Channel, receipt.DiscordVersion,
            Path.Combine(_localAppData, processName, $"app-{receipt.DiscordVersion}", $"{processName}.exe"), processName);
        RequireReadyTarget(target);
        return target;
    }

    private DiscordTarget RecordedTarget(InstallReceipt receipt)
    {
        string name = receipt.Channel switch {"Stable" => "Discord", "PTB" => "DiscordPTB", "Canary" => "DiscordCanary", _ => throw new InvalidDataException("The recorded Discord channel is invalid.")};
        return new DiscordTarget(receipt.Channel, receipt.DiscordVersion, Path.Combine(_localAppData, name, $"app-{receipt.DiscordVersion}", $"{name}.exe"), name);
    }

    private InstallReceipt? ReadPreviousManagement(string backupDirectory, BackupState state)
    {
        if (state.PreviousReceiptSha256 is null) return null;
        if (!Sha256Pattern.IsMatch(state.PreviousReceiptSha256)) throw new InvalidDataException("The previous receipt hash is invalid.");
        string file = Path.Combine(backupDirectory, "previous-current.json");
        InstallReceipt previous = ReadReceipt(file, out string hash);
        if (hash != state.PreviousReceiptSha256 || previous.ArtifactSha256 != state.ExistingCoreSha256 || previous.Channel != state.Injector.Channel)
            throw new InvalidDataException("The previous managed installation does not match its rollback backup.");
        return previous;
    }

    private InstallReceipt? RestorePreviousManagement(string backupDirectory, BackupState state)
    {
        InstallReceipt? previous = ReadPreviousManagement(backupDirectory, state);
        if (previous is not null)
            RestoreOwnedFile(Path.Combine(backupDirectory, "previous-current.json"), Path.Combine(_roamingAppData, "BetterDiscord", "solcord-installer", "current.json"), state.PreviousReceiptSha256!);
        return previous;
    }

    internal bool HasManagedInstall() => File.Exists(Path.Combine(_roamingAppData, "BetterDiscord", "solcord-installer", "current.json"));

    internal bool HasPendingRecovery() => File.Exists(Path.Combine(_roamingAppData, "BetterDiscord", "solcord-installer", "pending.json")) || File.Exists(Path.Combine(_roamingAppData, "BetterDiscord", "solcord-installer", "pending-uninstall.json"));

    internal bool IsManagedChannel(DiscordTarget selected)
    {
        InstallReceipt? current = ReadCurrentReceipt();
        return current is null || current.Channel == selected.Channel;
    }

    internal DiscordTarget? ManagedTarget()
    {
        InstallReceipt? receipt = ReadCurrentReceipt();
        if (receipt is null) return null;
        DiscordTarget target = RecordedTarget(receipt);
        RequireReadyTarget(target);
        return target;
    }

    private void RequireManagedChannel(DiscordTarget selected)
    {
        if (!IsManagedChannel(selected)) throw new InvalidOperationException("Solcord manages one Discord channel at a time because its core is shared. Uninstall it from the recorded channel before switching channels.");
    }

    internal bool IsCurrentPackageRecorded()
    {
        InstallReceipt? receipt = ReadCurrentReceipt();
        if (receipt is null) return false;
        ReleaseManifest manifest = LoadManifest();
        return receipt.Version == manifest.Version
            && receipt.CandidateLabel == manifest.CandidateLabel
            && receipt.SourceCommit == manifest.SourceCommit
            && receipt.ArtifactSha256.Equals(manifest.ArtifactSha256, StringComparison.OrdinalIgnoreCase);
    }

    internal string VerifyBundle(ReleaseManifest manifest)
    {
        string artifact = Path.Combine(_bundleRoot, manifest.ArtifactFile);
        string buildManifest = Path.Combine(_bundleRoot, "solcord-build-manifest.json");
        if (!File.Exists(artifact)) throw new FileNotFoundException("The manifest-bound Solcord ASAR is missing.");
        if (!File.Exists(buildManifest) || new FileInfo(buildManifest).Length is <= 0 or > 256 * 1024) throw new InvalidDataException("The authoritative build manifest is missing or does not match the installer manifest.");
        byte[] artifactBytes = File.ReadAllBytes(artifact);
        byte[] buildManifestBytes = File.ReadAllBytes(buildManifest);
        VerifyBundleBytes(manifest, artifactBytes, buildManifestBytes);
        return artifact;
    }

    internal static void VerifyBundleBytes(ReleaseManifest manifest, ReadOnlyMemory<byte> artifact, ReadOnlyMemory<byte> buildManifest)
    {
        if (artifact.Length <= 0) throw new InvalidDataException("The manifest-bound Solcord ASAR is missing.");
        string actual = Convert.ToHexString(SHA256.HashData(artifact.Span)).ToLowerInvariant();
        if (!CryptographicOperations.FixedTimeEquals(Convert.FromHexString(actual), Convert.FromHexString(manifest.ArtifactSha256))) throw new InvalidDataException("The Solcord ASAR hash does not match the manifest.");
        if (buildManifest.Length is <= 0 or > 256 * 1024) throw new InvalidDataException("The authoritative build manifest is missing or does not match the installer manifest.");
        string buildManifestHash = Convert.ToHexString(SHA256.HashData(buildManifest.Span)).ToLowerInvariant();
        if (!CryptographicOperations.FixedTimeEquals(Convert.FromHexString(buildManifestHash), Convert.FromHexString(manifest.BuildManifestSha256))) throw new InvalidDataException("The authoritative build manifest is missing or does not match the installer manifest.");
        try
        {
            using JsonDocument document = JsonDocument.Parse(buildManifest);
            JsonElement root = document.RootElement;
            JsonElement build = root.GetProperty("build");
            JsonElement source = build.GetProperty("source");
            JsonElement asar = root.GetProperty("artifacts").GetProperty("asar");
            string mode = build.GetProperty("mode").GetString() ?? "";
            bool valid = root.GetProperty("schemaVersion").GetInt32() == 2
                && root.GetProperty("kind").GetString() == "solcord-post-build-manifest"
                && build.GetProperty("product").GetString() == "Solcord"
                && build.GetProperty("version").GetString() == manifest.Version
                && build.GetProperty("candidateLabel").GetString() == manifest.CandidateLabel
                && (mode == "production" || mode == "release")
                && source.GetProperty("clean").GetBoolean()
                && source.GetProperty("commit").GetString() == manifest.SourceCommit
                && asar.GetProperty("file").GetString() == manifest.ArtifactFile
                && asar.GetProperty("sha256").GetString() == manifest.ArtifactSha256
                && asar.GetProperty("bytes").GetInt64() == artifact.Length;
            if (!valid) throw new InvalidDataException("The build manifest does not bind this clean Solcord artifact and source commit.");
        }
        catch (InvalidDataException) {throw;}
        catch (Exception) {throw new InvalidDataException("The authoritative build manifest failed validation.");}
    }

    internal InstallReceipt Install(DiscordTarget target, bool repair = false)
    {
        LastLauncherWarning = null;
        ReleaseManifest manifest = LoadManifest();
        string artifact = VerifyBundle(manifest);
        RequireReadyTarget(target);
        RequireNoPendingRecovery();
        RejectDowngrade(manifest);
        RequireManagedChannel(target);
        RequireAllDiscordStopped();
        RequireReadyTarget(target);
        RequireNoPendingRecovery();
        RejectDowngrade(manifest);
        RequireManagedChannel(target);

        string dataDirectory = Path.Combine(_roamingAppData, "BetterDiscord", "data");
        RejectLinkedPath(_roamingAppData, dataDirectory);
        Directory.CreateDirectory(dataDirectory);
        RejectReparsePoint(dataDirectory);
        string installed = Path.Combine(dataDirectory, "betterdiscord.asar");
        bool hadCore = File.Exists(installed);
        string? existingHash = hadCore ? HashFile(installed) : null;
        if (!repair && existingHash?.Equals(manifest.ArtifactSha256, StringComparison.OrdinalIgnoreCase) == true) throw new InvalidOperationException("This exact Solcord artifact is already installed. Use Verify or Repair.");
        string backupName = $"{DateTime.UtcNow:yyyyMMddTHHmmssZ}-{existingHash?[..12] ?? "clean"}-{Guid.NewGuid():N}";
        backupName = backupName[..Math.Min(64, backupName.Length)];
        string backupDirectory = Path.Combine(_roamingAppData, "BetterDiscord", "solcord-installer", "backups", backupName);
        RejectLinkedPath(_roamingAppData, backupDirectory);
        Directory.CreateDirectory(backupDirectory);
        RejectReparsePoint(backupDirectory);
        if (hadCore)
        {
            string coreBackup = Path.Combine(backupDirectory, "betterdiscord.asar");
            RejectLinkedPath(dataDirectory, installed);
            File.Copy(installed, coreBackup, overwrite: false);
            if (existingHash is null || !HashFile(coreBackup).Equals(existingHash, StringComparison.OrdinalIgnoreCase) || !HashFile(installed).Equals(existingHash, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The current core changed while its rollback backup was captured; installation was held before mutation.");
        }
        InjectorBackupState injector = BackupInjector(target, backupDirectory, installed);
        string? previousReceiptHash = null;
        InstallReceipt? previousReceipt = ReadCurrentReceipt();
        if (previousReceipt is not null && previousReceipt.ArtifactSha256 == existingHash)
        {
            string previousReceiptFile = Path.Combine(_roamingAppData, "BetterDiscord", "solcord-installer", "current.json");
            string savedReceipt = Path.Combine(backupDirectory, "previous-current.json");
            File.Copy(previousReceiptFile, savedReceipt, overwrite: false);
            previousReceiptHash = HashFile(savedReceipt);
            if (HashFile(previousReceiptFile) != previousReceiptHash) throw new InvalidDataException("The previous installation record changed during backup.");
        }
        var backupState = new BackupState(hadCore, existingHash, manifest.ArtifactSha256, manifest.Version, manifest.SourceCommit, injector, manifest.CandidateLabel, previousReceiptHash,
            previousReceiptHash is not null && File.Exists(Path.Combine(_roamingAppData, "BetterDiscord", "solcord-installer", "launcher.json")));
        WriteAtomic(Path.Combine(backupDirectory, "backup-state.json"), JsonSerializer.Serialize(backupState, new JsonSerializerOptions {WriteIndented = true}));

        var receipt = new InstallReceipt(manifest.Version, manifest.SourceCommit, manifest.ArtifactSha256, target.Channel, target.Version, DateTime.UtcNow.ToString("O"), backupDirectory, manifest.CandidateLabel, injector.OriginalModuleSha256);
        string receiptRoot = Path.Combine(_roamingAppData, "BetterDiscord", "solcord-installer");
        RejectLinkedPath(_roamingAppData, receiptRoot);
        Directory.CreateDirectory(receiptRoot);
        RejectReparsePoint(receiptRoot);
        string pendingReceipt = Path.Combine(receiptRoot, "pending.json");
        string temporary = Path.Combine(dataDirectory, $".solcord-{Guid.NewGuid():N}.tmp");
        bool coreReplaced = false;
        bool injectorReplaced = false;
        try
        {
            _mutationHook?.Invoke("install-before-stage");
            File.Copy(artifact, temporary, overwrite: false);
            if (!HashFile(temporary).Equals(manifest.ArtifactSha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The staged ASAR failed verification.");
            _mutationHook?.Invoke("install-after-stage");
            WriteAtomic(pendingReceipt, JsonSerializer.Serialize(receipt, new JsonSerializerOptions {WriteIndented = true}));
            File.Move(temporary, installed, overwrite: true);
            coreReplaced = true;
            if (!HashFile(installed).Equals(manifest.ArtifactSha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The installed ASAR failed verification.");
            _mutationHook?.Invoke("install-after-core");
            injectorReplaced = true;
            InstallInjector(target, injector, installed);
            _mutationHook?.Invoke("install-after-bootstrap");
            RequireWorkingInjector(target, installed, receipt.DiscordArchiveSha256);
            WriteAtomic(Path.Combine(receiptRoot, "current.json"), JsonSerializer.Serialize(receipt, new JsonSerializerOptions {WriteIndented = true}));
            try {SolcordLauncher.Ensure(target, _roamingAppData);}
            catch (Exception error) {LastLauncherWarning = $"Solcord was installed, but its Windows Search entry could not be refreshed ({error.GetType().Name}).";}
            try {File.Delete(pendingReceipt);}
            catch {/* current.json durably records the successful install; a matching stale pending receipt is reconciled before the next mutation */}
            return receipt;
        }
        catch (Exception installError)
        {
            try
            {
                RestoreBackup(target, backupDirectory, backupState, coreReplaced, injectorReplaced);
                File.Delete(pendingReceipt);
            }
            catch (Exception restoreError)
            {
                throw new AggregateException("Solcord installation failed and automatic recovery is incomplete. The pending receipt was preserved for Roll Back.", installError, restoreError);
            }
            throw;
        }
        finally {if (File.Exists(temporary)) File.Delete(temporary);}
    }

    internal InstallReceipt InstallNew(DiscordTarget target)
    {
        if (HasPendingRecovery()) throw new InvalidOperationException("A previous operation needs Roll Back before a new installation.");
        if (HasManagedInstall()) throw new InvalidOperationException("Solcord is already managed on this PC. Choose Update, Repair, Roll Back, or Uninstall.");
        InstallReceipt receipt = Install(target);
        try {WriteFirstSetupIntent(receipt);}
        catch (Exception error) {LastLauncherWarning = $"Solcord was installed, but automatic First Setup could not be scheduled ({error.GetType().Name}). Open Solcord Suite to start it manually.";}
        return receipt;
    }

    internal InstallReceipt Update(DiscordTarget target)
    {
        if (!HasManagedInstall()) throw new InvalidOperationException("No managed Solcord installation was found. Choose Install Solcord instead.");
        if (IsCurrentPackageRecorded()) throw new InvalidOperationException($"This installer package is already recorded. Choose Repair Solcord to replace damaged or missing files.");
        return Install(target, repair: true);
    }

    internal InstallReceipt Repair(DiscordTarget target)
    {
        LastLauncherWarning = null;
        if (!HasManagedInstall()) throw new InvalidOperationException("No managed Solcord installation was found. Choose Install Solcord instead.");
        if (!IsCurrentPackageRecorded()) throw new InvalidOperationException("The installed Solcord release differs from this package. Choose Update Solcord instead.");
        RequireManagedChannel(target);
        if (VerifyInstalled(target))
        {
            try {SolcordLauncher.Ensure(target, _roamingAppData);}
            catch (Exception error) {LastLauncherWarning = $"Installed files are verified, but the Windows Search entry needs attention ({error.GetType().Name}).";}
            return ReadCurrentReceipt()!;
        }
        return Install(target, repair: true);
    }

    internal bool VerifyInstalled(DiscordTarget? selected = null)
    {
        ReleaseManifest manifest = LoadManifest();
        VerifyBundle(manifest);
        string installed = Path.Combine(_roamingAppData, "BetterDiscord", "data", "betterdiscord.asar");
        if (!File.Exists(installed) || !HashFile(installed).Equals(manifest.ArtifactSha256, StringComparison.OrdinalIgnoreCase)) return false;
        try
        {
            InstallReceipt? receipt = ReadCurrentReceipt();
            if (receipt is null || receipt.ArtifactSha256 != manifest.ArtifactSha256 || receipt.SourceCommit != manifest.SourceCommit || receipt.CandidateLabel != manifest.CandidateLabel) return false;
            if (selected is not null && (receipt.Channel != selected.Channel || receipt.DiscordVersion != selected.Version)) return false;
            string processName = receipt.Channel switch {"Stable" => "Discord", "PTB" => "DiscordPTB", "Canary" => "DiscordCanary", _ => ""};
            var target = new DiscordTarget(receipt.Channel, receipt.DiscordVersion,
                Path.Combine(_localAppData, processName, $"app-{receipt.DiscordVersion}", $"{processName}.exe"), processName);
            RequireReadyTarget(target);
            RequireWorkingInjector(target, installed, receipt.DiscordArchiveSha256);
            return true;
        }
        catch (Exception error) when (error is IOException or InvalidDataException or UnauthorizedAccessException) {return false;}
    }

    internal string RollBack(DiscordTarget target)
    {
        LastLauncherWarning = null;
        string? uninstallRecovery = RecoverInterruptedUninstall(target);
        if (uninstallRecovery is not null) return uninstallRecovery;
        string backupRoot = Path.Combine(_roamingAppData, "BetterDiscord", "solcord-installer", "backups");
        if (!Directory.Exists(backupRoot)) throw new InvalidOperationException("No Solcord installer backup is available.");
        RejectLinkedPath(_roamingAppData, backupRoot);
        RejectReparsePoint(backupRoot);
        (InstallReceipt receipt, string receiptFile, string receiptHash) = LoadRecoveryReceipt();
        target = RequireRecordedTarget(target, receipt);
        if (receipt.BackupDirectory is null) throw new InvalidDataException("The current install receipt does not identify a rollback backup.");
        string backupDirectory = Path.GetFullPath(receipt.BackupDirectory);
        RejectLinkedPath(backupRoot, backupDirectory);
        if (!string.Equals(Path.GetDirectoryName(backupDirectory), Path.GetFullPath(backupRoot).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The receipt backup path is not a direct installer backup.");
        if (!Directory.Exists(backupDirectory) || !File.Exists(Path.Combine(backupDirectory, "backup-state.json"))) throw new InvalidOperationException("The receipt-bound Solcord backup is unavailable.");
        RejectReparsePoint(backupDirectory);
        BackupState? state = JsonSerializer.Deserialize<BackupState>(File.ReadAllText(Path.Combine(backupDirectory, "backup-state.json")));
        if (state is null || state.Injector.Channel != target.Channel || state.Injector.DiscordVersion != target.Version || !Sha256Pattern.IsMatch(state.InstalledArtifactSha256) || state.InstalledArtifactSha256 != receipt.ArtifactSha256 || state.CandidateVersion != receipt.Version || state.CandidateSourceCommit != receipt.SourceCommit || state.CandidateLabel != receipt.CandidateLabel || state.CandidateLabel is not null && !IsCandidateLabelForVersion(state.CandidateLabel, state.CandidateVersion)) throw new InvalidDataException("The rollback state does not match the receipt-bound Discord target.");
        if (state.HadCore != (state.ExistingCoreSha256 is not null) || state.ExistingCoreSha256 is not null && !Sha256Pattern.IsMatch(state.ExistingCoreSha256)) throw new InvalidDataException("The rollback core metadata is invalid.");
        if (state.Injector.HadAppDirectory != (state.Injector.IndexSha256 is not null && state.Injector.PackageSha256 is not null) || state.Injector.IndexSha256 is not null && !Sha256Pattern.IsMatch(state.Injector.IndexSha256) || state.Injector.PackageSha256 is not null && !Sha256Pattern.IsMatch(state.Injector.PackageSha256)) throw new InvalidDataException("The rollback injector metadata is invalid.");
        ReadPreviousManagement(backupDirectory, state);
        RequireAllDiscordStopped();
        RequireReadyTarget(target);
        RequireUnchangedReceipt(receiptFile, receiptHash);
        RestoreBackup(target, backupDirectory, state, true, true);
        InstallReceipt? previous = RestorePreviousManagement(backupDirectory, state);
        if (previous is null || Path.GetFileName(receiptFile) == "pending.json") File.Delete(receiptFile);
        try
        {
            if (previous is not null && state.PreviousLauncherRecorded) SolcordLauncher.Ensure(RecordedTarget(previous), _roamingAppData);
            else SolcordLauncher.Remove(_roamingAppData);
        }
        catch (Exception error) {LastLauncherWarning = $"The previous installation was restored, but the Solcord Windows Search entry needs manual cleanup ({error.GetType().Name}).";}
        return backupDirectory;
    }

    internal string Uninstall(DiscordTarget target)
    {
        LastLauncherWarning = null;
        ReleaseManifest manifest = LoadManifest();
        VerifyBundle(manifest);
        RecoverInterruptedUninstall(target);
        RequireNoPendingRecovery();

        string receiptFile = Path.Combine(_roamingAppData, "BetterDiscord", "solcord-installer", "current.json");
        if (!File.Exists(receiptFile)) throw new InvalidOperationException("No managed Solcord installation is available to uninstall.");
        InstallReceipt receipt = ReadReceipt(receiptFile, out string receiptHash);
        target = RequireRecordedTarget(target, receipt);
        if (receipt.CandidateLabel is null) throw new InvalidDataException("The current Solcord receipt does not identify its release candidate.");

        string dataDirectory = Path.Combine(_roamingAppData, "BetterDiscord", "data");
        string installedCore = Path.Combine(dataDirectory, "betterdiscord.asar");
        RejectLinkedPath(_roamingAppData, installedCore);
        if (!File.Exists(installedCore) || !HashFile(installedCore).Equals(receipt.ArtifactSha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The installed core changed after Solcord recorded it; uninstall was held before mutation.");

        string resources = Path.Combine(Path.GetDirectoryName(target.ExecutablePath)!, "resources");
        string originalModule = RequireOriginalModule(resources);
        string archive = Path.Combine(resources, originalModule[3..]);
        string archiveHash = HashFile(archive);
        if (receipt.DiscordArchiveSha256 is not null && archiveHash != receipt.DiscordArchiveSha256)
            throw new InvalidDataException("The Discord startup archive changed after installation; uninstall was held before mutation.");
        string appDirectory = Path.Combine(resources, "app");
        RejectLinkedPath(_localAppData, appDirectory);
        if (!Directory.Exists(appDirectory)) throw new InvalidDataException("The managed Discord injector is missing; uninstall was held before mutation.");
        RejectReparsePoint(appDirectory);
        string[] entries = Directory.GetFileSystemEntries(appDirectory).Select(Path.GetFileName).Order().ToArray()!;
        if (!entries.SequenceEqual(new[] {"index.js", "package.json"})) throw new InvalidDataException("The Discord injector contains owner files; uninstall was held before mutation.");
        string indexFile = Path.Combine(appDirectory, "index.js");
        string packageFile = Path.Combine(appDirectory, "package.json");
        RejectLinkedPath(_localAppData, indexFile);
        RejectLinkedPath(_localAppData, packageFile);
        string index = ReadHashedText(indexFile, out string indexHash);
        string package = ReadHashedText(packageFile, out string packageHash);
        if (!RecognizedInjector(index, package, installedCore) || !IsSolcordInjectorIndex(index, installedCore)) throw new InvalidDataException("The active injector is not owned by this Solcord installation; uninstall was held before mutation.");

        RequireAllDiscordStopped();
        RequireReadyTarget(target);
        RequireUnchangedReceipt(receiptFile, receiptHash);
        if (RequireOriginalModule(resources) != originalModule || HashFile(archive) != archiveHash)
            throw new InvalidDataException("The Discord startup archive changed while Discord was closing; nothing was removed.");
        foreach (string file in new[] {installedCore, indexFile, packageFile})
            RejectLinkedPath(file == installedCore ? _roamingAppData : _localAppData, file);
        if (HashFile(installedCore) != receipt.ArtifactSha256 || HashFile(indexFile) != indexHash || HashFile(packageFile) != packageHash)
            throw new InvalidDataException("The installed files changed while Discord was closing; nothing was removed.");

        string root = Path.Combine(_roamingAppData, "BetterDiscord", "solcord-installer", "uninstall-backups");
        RejectLinkedPath(_roamingAppData, root);
        Directory.CreateDirectory(root);
        RejectReparsePoint(root);
        string uninstallName = $"{DateTime.UtcNow:yyyyMMddTHHmmssZ}-{receipt.ArtifactSha256[..12]}-{Guid.NewGuid():N}";
        uninstallName = uninstallName[..Math.Min(64, uninstallName.Length)];
        string backupDirectory = Path.Combine(root, uninstallName);
        RejectLinkedPath(root, backupDirectory);
        Directory.CreateDirectory(backupDirectory);
        RejectReparsePoint(backupDirectory);
        string coreBackup = Path.Combine(backupDirectory, "betterdiscord.asar");
        string indexBackup = Path.Combine(backupDirectory, "index.js");
        string packageBackup = Path.Combine(backupDirectory, "package.json");
        string receiptBackup = Path.Combine(backupDirectory, "current.json");
        File.Copy(installedCore, coreBackup, overwrite: false);
        File.Copy(indexFile, indexBackup, overwrite: false);
        File.Copy(packageFile, packageBackup, overwrite: false);
        File.Copy(receiptFile, receiptBackup, overwrite: false);
        var state = new UninstallBackupState(target.Channel, target.Version, receipt.CandidateLabel, HashFile(coreBackup), HashFile(indexBackup), HashFile(packageBackup), HashFile(receiptBackup));
        if (state.CoreSha256 != receipt.ArtifactSha256
            || state.IndexSha256 != HashFile(indexFile)
            || state.PackageSha256 != HashFile(packageFile)
            || state.ReceiptSha256 != HashFile(receiptFile)) throw new InvalidDataException("The Solcord uninstall recovery copy failed verification; nothing was removed.");
        WriteAtomic(Path.Combine(backupDirectory, "uninstall-state.json"), JsonSerializer.Serialize(state, new JsonSerializerOptions {WriteIndented = true}));

        string journalFile = Path.Combine(_roamingAppData, "BetterDiscord", "solcord-installer", "pending-uninstall.json");
        var journal = new UninstallJournal(1, backupDirectory, HashFile(Path.Combine(backupDirectory, "uninstall-state.json")), archiveHash, originalModule);
        WriteAtomic(journalFile, JsonSerializer.Serialize(journal));

        string vanillaArchive = Path.Combine(resources, "app.asar");
        try
        {
            _mutationHook?.Invoke("uninstall-after-journal");
            // Publish vanilla startup before removing any part of its loader.
            if (originalModule == "../betterdiscord.app.asar")
            {
                File.Move(archive, vanillaArchive, overwrite: false);
                if (HashFile(vanillaArchive) != archiveHash) throw new InvalidDataException("Discord startup archive restoration failed verification.");
            }
            _mutationHook?.Invoke("uninstall-after-archive");
            File.Delete(indexFile);
            _mutationHook?.Invoke("uninstall-after-index");
            File.Delete(packageFile);
            _mutationHook?.Invoke("uninstall-after-package");
            Directory.Delete(appDirectory, recursive: false);
            _mutationHook?.Invoke("uninstall-after-bootstrap");
            File.Delete(installedCore);
            _mutationHook?.Invoke("uninstall-after-core");
            File.Delete(receiptFile);
            _mutationHook?.Invoke("uninstall-after-receipt");
            try {SolcordLauncher.Remove(_roamingAppData);}
            catch (Exception error) {LastLauncherWarning = $"Solcord was removed, but its Windows Search entry needs manual cleanup ({error.GetType().Name}).";}
            File.Delete(journalFile);
            return backupDirectory;
        }
        catch (Exception uninstallError)
        {
            try
            {
                RecoverInterruptedUninstall(target);
            }
            catch (Exception restoreError) {throw new AggregateException("Solcord uninstall failed and automatic recovery is incomplete. The recovery copy was preserved.", uninstallError, restoreError);}
            throw;
        }
    }

    private string? RecoverInterruptedUninstall(DiscordTarget selected)
    {
        string installerRoot = Path.Combine(_roamingAppData, "BetterDiscord", "solcord-installer");
        string journalFile = Path.Combine(installerRoot, "pending-uninstall.json");
        if (!File.Exists(journalFile)) return null;
        RejectLinkedPath(_roamingAppData, journalFile);
        if (new FileInfo(journalFile).Length is <= 0 or > 64 * 1024) throw new InvalidDataException("The uninstall recovery journal is invalid.");
        string journalHash = HashFile(journalFile);
        UninstallJournal journal = JsonSerializer.Deserialize<UninstallJournal>(File.ReadAllText(journalFile)) ?? throw new InvalidDataException("The uninstall recovery journal is invalid.");
        string root = Path.Combine(installerRoot, "uninstall-backups");
        string backup = Path.GetFullPath(journal.BackupDirectory);
        RejectLinkedPath(root, backup);
        if (journal.SchemaVersion != 1 || !Sha256Pattern.IsMatch(journal.BackupStateSha256) || !Sha256Pattern.IsMatch(journal.ArchiveSha256)
            || Path.GetDirectoryName(backup) != Path.GetFullPath(root) || journal.OriginalModule is not ("../app.asar" or "../betterdiscord.app.asar"))
            throw new InvalidDataException("The uninstall recovery journal failed validation.");
        string stateFile = Path.Combine(backup, "uninstall-state.json");
        RejectLinkedPath(backup, stateFile);
        if (!File.Exists(stateFile) || new FileInfo(stateFile).Length is <= 0 or > 64 * 1024 || HashFile(stateFile) != journal.BackupStateSha256)
            throw new InvalidDataException("The uninstall recovery state changed.");
        UninstallBackupState state = JsonSerializer.Deserialize<UninstallBackupState>(File.ReadAllText(stateFile)) ?? throw new InvalidDataException("The uninstall recovery state is invalid.");
        InstallReceipt receipt = ReadReceipt(Path.Combine(backup, "current.json"), out string receiptHash);
        if (receiptHash != state.ReceiptSha256 || receipt.Channel != selected.Channel || receipt.Channel != state.Channel || receipt.DiscordVersion != state.DiscordVersion || receipt.CandidateLabel != state.CandidateLabel || receipt.ArtifactSha256 != state.CoreSha256)
            throw new InvalidDataException("Select the recorded Discord channel to restore this uninstall.");
        DiscordTarget target = RecordedTarget(receipt);
        RejectLinkedPath(_localAppData, target.ExecutablePath);
        if (!File.Exists(target.ExecutablePath)) throw new InvalidDataException("The recorded Discord executable is missing.");
        string resources = Path.Combine(Path.GetDirectoryName(target.ExecutablePath)!, "resources");
        string app = Path.Combine(resources, "app");
        RejectLinkedPath(_localAppData, app);
        if (Directory.Exists(app) && Directory.GetFileSystemEntries(app).Select(Path.GetFileName).Except(new[] {"index.js", "package.json"}).Any())
            throw new InvalidDataException("The injector gained owner files during uninstall recovery.");
        var files = new[] {
            ("betterdiscord.asar", Path.Combine(_roamingAppData, "BetterDiscord", "data", "betterdiscord.asar"), state.CoreSha256),
            ("index.js", Path.Combine(app, "index.js"), state.IndexSha256),
            ("package.json", Path.Combine(app, "package.json"), state.PackageSha256),
            ("current.json", Path.Combine(installerRoot, "current.json"), state.ReceiptSha256)
        };
        foreach (var (name, destination, hash) in files)
        {
            RejectLinkedPath(backup, Path.Combine(backup, name));
            RejectLinkedPath(name is "index.js" or "package.json" ? _localAppData : _roamingAppData, destination);
            if (!Sha256Pattern.IsMatch(hash) || !File.Exists(Path.Combine(backup, name)) || HashFile(Path.Combine(backup, name)) != hash || File.Exists(destination) && HashFile(destination) != hash)
                throw new InvalidDataException("An uninstall recovery file changed; owner bytes were preserved.");
        }
        string archive = Path.Combine(resources, journal.OriginalModule[3..]);
        string vanilla = Path.Combine(resources, "app.asar");
        string activeArchive = File.Exists(archive) ? archive : vanilla;
        RejectLinkedPath(_localAppData, activeArchive);
        if (!File.Exists(activeArchive) || HashFile(activeArchive) != journal.ArchiveSha256 || archive != vanilla && File.Exists(archive) && File.Exists(vanilla))
            throw new InvalidDataException("The Discord startup archive changed during uninstall recovery.");
        RequireAllDiscordStopped();
        // Repeat immutable checks at commit time after process shutdown.
        if (HashFile(journalFile) != journalHash || HashFile(activeArchive) != journal.ArchiveSha256)
            throw new InvalidDataException("The uninstall journal changed while Discord was closing.");
        foreach (var (name, destination, hash) in files)
            if (File.Exists(destination) && HashFile(destination) != hash) throw new InvalidDataException("A recovery destination changed while Discord was closing.");
        foreach (var (name, destination, hash) in files) RestoreOwnedFile(Path.Combine(backup, name), destination, hash);
        if (activeArchive != archive) File.Move(activeArchive, archive, overwrite: false);
        RequireWorkingInjector(target, files[0].Item2, receipt.DiscordArchiveSha256);
        File.Delete(journalFile);
        try {SolcordLauncher.Ensure(target, _roamingAppData);}
        catch (Exception error) {LastLauncherWarning = $"The installation was restored; its shortcut needs attention ({error.GetType().Name}).";}
        return backup;
    }

    private static void RestoreOwnedFile(string source, string destination, string expectedHash)
    {
        if (!File.Exists(source) || HashFile(source) != expectedHash) throw new InvalidDataException("A recovery source changed before restoration.");
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        string temporary = $"{destination}.{Guid.NewGuid():N}.tmp";
        try
        {
            File.Copy(source, temporary, overwrite: false);
            if (HashFile(temporary) != expectedHash) throw new InvalidDataException("A staged recovery file failed verification.");
            File.Move(temporary, destination, overwrite: true);
        }
        finally {if (File.Exists(temporary)) File.Delete(temporary);}
    }

    internal void Launch(DiscordTarget target)
    {
        RequireReadyTarget(target);
        DiscordTarget current = target;
        RejectLinkedPath(_localAppData, current.ExecutablePath);
        InstallReceipt? receipt = ReadCurrentReceipt();
        if (receipt is null || receipt.Channel != current.Channel || receipt.DiscordVersion != current.Version || !VerifyInstalled())
            throw new InvalidDataException("Solcord is not verified for this Discord version. Install or repair it before opening.");
        Process.Start(new ProcessStartInfo(current.ExecutablePath) {UseShellExecute = true});
    }

    private void WriteFirstSetupIntent(InstallReceipt receipt)
    {
        if (!Regex.IsMatch(receipt.SourceCommit, "^[0-9a-f]{40}$") || !Sha256Pattern.IsMatch(receipt.ArtifactSha256)) throw new InvalidDataException("The verified install receipt cannot authorize First Setup.");
        string root = Path.Combine(_roamingAppData, "BetterDiscord", "solcord-installer");
        RejectLinkedPath(_roamingAppData, root);
        Directory.CreateDirectory(root);
        RejectReparsePoint(root);
        string target = Path.Combine(root, "first-setup-intent.json");
        RejectLinkedPath(root, target);
        var intent = new SolcordFirstSetupIntent(
            1,
            Guid.NewGuid().ToString("N"),
            "first-setup",
            receipt.Channel,
            receipt.DiscordVersion,
            receipt.SourceCommit,
            receipt.ArtifactSha256,
            DateTime.UtcNow.ToString("O"),
            0
        );
        WriteAtomic(target, JsonSerializer.Serialize(intent, new JsonSerializerOptions {WriteIndented = true}));
    }

    internal static string HashFile(string file)
    {
        using FileStream stream = new(file, FileMode.Open, FileAccess.Read, FileShare.Read);
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }

    private void RejectDowngrade(ReleaseManifest manifest)
    {
        string receipt = Path.Combine(_roamingAppData, "BetterDiscord", "solcord-installer", "current.json");
        if (!File.Exists(receipt)) return;
        RejectLinkedPath(_roamingAppData, receipt);
        FileInfo receiptInfo = new(receipt);
        if ((receiptInfo.Attributes & FileAttributes.ReparsePoint) != 0 || receiptInfo.Length is <= 0 or > 64 * 1024) throw new InvalidDataException("The current Solcord installer receipt is unsafe; update is held for review.");
        InstallReceipt? current;
        try {current = JsonSerializer.Deserialize<InstallReceipt>(File.ReadAllText(receipt));}
        catch {throw new InvalidDataException("The current Solcord installer receipt is malformed; repair is held for review.");}
        if (current is null || !Sha256Pattern.IsMatch(current.ArtifactSha256) || !Regex.IsMatch(current.SourceCommit, "^[0-9a-f]{40}$") || !Version.TryParse(current.Version, out Version? installed) || !Version.TryParse(manifest.Version, out Version? candidate) || current.CandidateLabel is not null && !IsCandidateLabelForVersion(current.CandidateLabel, current.Version)) throw new InvalidDataException("Solcord version provenance is malformed; update is held for review.");
        if (candidate < installed) throw new InvalidOperationException("The candidate is older than the recorded Solcord install. Use an explicit rollback instead of downgrading through Update.");
        if (candidate > installed) return;
        if (current.CandidateLabel is null)
        {
            if (current.ArtifactSha256.Equals(manifest.ArtifactSha256, StringComparison.OrdinalIgnoreCase) && current.SourceCommit == manifest.SourceCommit) return;
            throw new InvalidOperationException("The recorded same-core install predates candidate labels, so its RC order cannot be proven. Use Roll Back / Uninstall before installing this candidate.");
        }
        if (!TryGetReleaseCandidateOrdinal(current.CandidateLabel, current.Version, out ulong installedOrdinal) || !TryGetReleaseCandidateOrdinal(manifest.CandidateLabel, manifest.Version, out ulong candidateOrdinal)) throw new InvalidOperationException("The recorded same-core candidate labels do not have a supported RC order. Use an explicit rollback instead of replacing them through Update.");
        if (candidateOrdinal < installedOrdinal) throw new InvalidOperationException("The candidate is older than the recorded Solcord release candidate. Use an explicit rollback instead of downgrading through Update.");
        if (candidateOrdinal == installedOrdinal && (current.CandidateLabel != manifest.CandidateLabel || !current.ArtifactSha256.Equals(manifest.ArtifactSha256, StringComparison.OrdinalIgnoreCase) || current.SourceCommit != manifest.SourceCommit)) throw new InvalidOperationException("This release-candidate label is already bound to different source bytes. Candidate labels are immutable; use a new label or explicit rollback.");
    }

    internal static bool TryGetReleaseCandidateOrdinal(string candidateLabel, string version, out ulong ordinal)
    {
        ordinal = 0;
        if (!IsCandidateLabelForVersion(candidateLabel, version)) return false;
        if (candidateLabel.Equals($"v{version}", StringComparison.OrdinalIgnoreCase))
        {
            ordinal = ulong.MaxValue;
            return true;
        }
        Match match = Regex.Match(candidateLabel, $"^v{Regex.Escape(version)}-rc\\.(0|[1-9][0-9]*)$", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);
        return match.Success && ulong.TryParse(match.Groups[1].Value, out ordinal) && ordinal < ulong.MaxValue;
    }

    private static bool IsCandidateLabelForVersion(string candidateLabel, string version) => Regex.IsMatch(candidateLabel, $"^v{Regex.Escape(version)}(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

    private void RequireNoPendingRecovery()
    {
        if (File.Exists(Path.Combine(_roamingAppData, "BetterDiscord", "solcord-installer", "pending-uninstall.json")))
            throw new InvalidOperationException("A prior Solcord uninstall needs Roll Back before another operation.");
        string root = Path.Combine(_roamingAppData, "BetterDiscord", "solcord-installer");
        string pending = Path.Combine(root, "pending.json");
        if (!File.Exists(pending)) return;
        string current = Path.Combine(root, "current.json");
        if (File.Exists(current) && MatchingSafeReceiptFiles(current, pending))
        {
            File.Delete(pending);
            return;
        }
        throw new InvalidOperationException("A prior Solcord installation needs Roll Back before another install or update.");
    }

    private static InjectorBackupState BackupInjector(DiscordTarget target, string backupDirectory, string installedCore)
    {
        string resources = Path.Combine(Path.GetDirectoryName(target.ExecutablePath)!, "resources");
        string originalModule = RequireOriginalModule(resources);
        string originalModuleHash = HashFile(Path.Combine(resources, originalModule[3..]));
        string appDirectory = Path.Combine(resources, "app");
        bool hadAppDirectory = Directory.Exists(appDirectory);
        if (hadAppDirectory)
        {
            RejectReparsePoint(appDirectory);
            string[] entries = Directory.GetFileSystemEntries(appDirectory).Select(Path.GetFileName).Order().ToArray()!;
            if (!entries.SequenceEqual(new[] {"index.js", "package.json"})) throw new InvalidDataException("The existing Discord injector directory contains unrecognized files; nothing was overwritten.");
            string indexFile = Path.Combine(appDirectory, "index.js");
            string packageFile = Path.Combine(appDirectory, "package.json");
            RejectLinkedPath(appDirectory, indexFile);
            RejectLinkedPath(appDirectory, packageFile);
            string capturedIndexSha256 = HashFile(indexFile);
            string capturedPackageSha256 = HashFile(packageFile);
            string index = File.ReadAllText(indexFile);
            string package = File.ReadAllText(packageFile);
            if (!RecognizedInjector(index, package, installedCore)) throw new InvalidDataException("The existing Discord injector is not a recognized BetterDiscord or Solcord entry; nothing was overwritten.");
            string injectorBackup = Path.Combine(backupDirectory, "injector-app");
            Directory.CreateDirectory(injectorBackup);
            string backupIndex = Path.Combine(injectorBackup, "index.js");
            string backupPackage = Path.Combine(injectorBackup, "package.json");
            File.Copy(indexFile, backupIndex, overwrite: false);
            File.Copy(packageFile, backupPackage, overwrite: false);
            if (!HashFile(backupIndex).Equals(capturedIndexSha256, StringComparison.OrdinalIgnoreCase)
                || !HashFile(backupPackage).Equals(capturedPackageSha256, StringComparison.OrdinalIgnoreCase)
                || !HashFile(indexFile).Equals(capturedIndexSha256, StringComparison.OrdinalIgnoreCase)
                || !HashFile(packageFile).Equals(capturedPackageSha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The injector changed while its rollback backup was captured; installation was held before mutation.");
        }
        string? indexSha256 = null;
        string? packageSha256 = null;
        if (hadAppDirectory)
        {
            string injectorBackup = Path.Combine(backupDirectory, "injector-app");
            indexSha256 = HashFile(Path.Combine(injectorBackup, "index.js"));
            packageSha256 = HashFile(Path.Combine(injectorBackup, "package.json"));
        }
        return new InjectorBackupState(hadAppDirectory, originalModule, target.Channel, target.Version, indexSha256, packageSha256, originalModuleHash);
    }

    private static void InstallInjector(DiscordTarget target, InjectorBackupState backup, string installedCore)
    {
        string resources = Path.Combine(Path.GetDirectoryName(target.ExecutablePath)!, "resources");
        string originalModule = RequireOriginalModule(resources);
        string archive = Path.Combine(resources, originalModule[3..]);
        if (originalModule != backup.OriginalModule || HashFile(archive) != backup.OriginalModuleSha256)
            throw new InvalidDataException("The Discord startup archive changed during installation; its files were preserved.");
        string appDirectory = Path.Combine(resources, "app");
        Directory.CreateDirectory(appDirectory);
        RejectReparsePoint(appDirectory);
        WriteAtomic(Path.Combine(appDirectory, "package.json"), "{\"main\":\"./index.js\",\"name\":\"discord\"}");
        string encodedCore = JsonSerializer.Serialize(Path.GetFullPath(installedCore));
        WriteAtomic(Path.Combine(appDirectory, "index.js"), $"require({encodedCore});{Environment.NewLine}module.exports = require(\"../betterdiscord.app.asar\");{Environment.NewLine}");
        // Electron searches app.asar before app/. Keep the original bytes, but
        // move them out of that first slot so the reviewed loader actually runs.
        if (originalModule == "../app.asar") File.Move(archive, Path.Combine(resources, "betterdiscord.app.asar"), overwrite: false);
    }

    private static void RequireWorkingInjector(DiscordTarget target, string installedCore, string? archiveHash)
    {
        string resources = Path.Combine(Path.GetDirectoryName(target.ExecutablePath)!, "resources");
        if (RequireOriginalModule(resources) != "../betterdiscord.app.asar" || Directory.Exists(Path.Combine(resources, "app.asar")))
            throw new InvalidDataException("Discord would skip the Solcord loader. Repair this installation before opening it.");
        string original = Path.Combine(resources, "betterdiscord.app.asar");
        if (archiveHash is not null && HashFile(original) != archiveHash) throw new InvalidDataException("The Discord startup archive no longer matches this installation.");
        string app = Path.Combine(resources, "app");
        string index = Path.Combine(app, "index.js");
        string package = Path.Combine(app, "package.json");
        RejectLinkedPath(resources, index);
        RejectLinkedPath(resources, package);
        string expected = $"require({JsonSerializer.Serialize(Path.GetFullPath(installedCore))});\nmodule.exports = require(\"../betterdiscord.app.asar\");\n";
        if (!File.Exists(index) || !File.Exists(package) || File.ReadAllText(index).Replace("\r\n", "\n") != expected || !IsSolcordInjectorPackage(File.ReadAllText(package)))
            throw new InvalidDataException("The Solcord startup loader is missing or changed. Repair this installation before opening it.");
    }

    private static Action PrepareBootstrapRollback(DiscordTarget target, InjectorBackupState backup)
    {
        if (backup.OriginalModule is not ("../app.asar" or "../betterdiscord.app.asar")) throw new InvalidDataException("The rollback startup archive path is invalid.");
        // Older installers did not rename the archive. Keep their rollback
        // semantics intact rather than inferring ownership from a filename.
        if (backup.OriginalModuleSha256 is null) return () => {};
        if (!Sha256Pattern.IsMatch(backup.OriginalModuleSha256)) throw new InvalidDataException("The rollback startup archive hash is invalid.");
        string resources = Path.Combine(Path.GetDirectoryName(target.ExecutablePath)!, "resources");
        string currentModule = RequireOriginalModule(resources);
        string current = Path.Combine(resources, currentModule[3..]);
        if (HashFile(current) != backup.OriginalModuleSha256) throw new InvalidDataException("The Discord startup archive changed; rollback preserved it for review.");
        if (currentModule == backup.OriginalModule) return () => {};
        if (backup.OriginalModule != "../app.asar") throw new InvalidDataException("The Discord startup archive moved unexpectedly; nothing was rolled back.");
        string original = Path.Combine(resources, "app.asar");
        return () => {
            if (HashFile(current) != backup.OriginalModuleSha256) throw new InvalidDataException("The Discord startup archive changed during rollback.");
            File.Move(current, original, overwrite: false);
        };
    }

    private void RestoreBackup(DiscordTarget target, string backupDirectory, BackupState state, bool restoreCore, bool restoreInjector)
    {
        string installed = Path.Combine(_roamingAppData, "BetterDiscord", "data", "betterdiscord.asar");
        string? appDirectory = null;
        string[] currentEntries = [];
        string? coreBackup = null;
        string? injectorIndexContent = null;
        string? injectorPackageContent = null;
        bool restoreIndex = false;
        bool restorePackage = false;
        bool removeInjectorDirectory = false;
        bool restoreCoreBytes = false;
        bool deleteCore = false;
        Action restoreBootstrap = restoreInjector ? PrepareBootstrapRollback(target, state.Injector) : () => {};
        if (restoreInjector)
        {
            string resources = Path.Combine(Path.GetDirectoryName(target.ExecutablePath)!, "resources");
            appDirectory = Path.Combine(resources, "app");
            if (Directory.Exists(appDirectory))
            {
                RejectReparsePoint(appDirectory);
                currentEntries = Directory.GetFileSystemEntries(appDirectory).Select(Path.GetFileName).Order().ToArray()!;
                if (currentEntries.Except(new[] {"index.js", "package.json"}).Any()) throw new InvalidDataException("The injector directory gained owner files; nothing was rolled back.");
            }
            else if (state.Injector.HadAppDirectory) throw new InvalidDataException("The installed injector directory is missing; nothing was rolled back.");
        }
        if (restoreCore && state.HadCore)
        {
            coreBackup = Path.Combine(backupDirectory, "betterdiscord.asar");
            RejectLinkedPath(backupDirectory, coreBackup);
            if (!File.Exists(coreBackup) || state.ExistingCoreSha256 is null || !HashFile(coreBackup).Equals(state.ExistingCoreSha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The core backup failed validation.");
        }
        if (restoreInjector && state.Injector.HadAppDirectory)
        {
            string injectorBackup = Path.Combine(backupDirectory, "injector-app");
            RejectLinkedPath(backupDirectory, injectorBackup);
            if (!Directory.Exists(injectorBackup)) throw new InvalidDataException("The injector backup is missing.");
            RejectReparsePoint(injectorBackup);
            string backupIndex = Path.Combine(injectorBackup, "index.js");
            string backupPackage = Path.Combine(injectorBackup, "package.json");
            RejectLinkedPath(injectorBackup, backupIndex);
            RejectLinkedPath(injectorBackup, backupPackage);
            if (state.Injector.IndexSha256 is null || state.Injector.PackageSha256 is null || !File.Exists(backupIndex) || !File.Exists(backupPackage) || !HashFile(backupIndex).Equals(state.Injector.IndexSha256, StringComparison.OrdinalIgnoreCase) || !HashFile(backupPackage).Equals(state.Injector.PackageSha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The injector backup failed hash validation.");
            injectorIndexContent = File.ReadAllText(backupIndex);
            injectorPackageContent = File.ReadAllText(backupPackage);
        }

        if (restoreCore)
        {
            string? currentHash = File.Exists(installed) ? HashFile(installed) : null;
            bool candidatePresent = currentHash?.Equals(state.InstalledArtifactSha256, StringComparison.OrdinalIgnoreCase) == true;
            bool priorPresent = state.HadCore && currentHash?.Equals(state.ExistingCoreSha256, StringComparison.OrdinalIgnoreCase) == true;
            bool priorAbsent = !state.HadCore && currentHash is null;
            if (!candidatePresent && !priorPresent && !priorAbsent) throw new InvalidDataException("The installed core changed after the backup. Rollback preserved it for manual review.");
            restoreCoreBytes = state.HadCore && !priorPresent;
            deleteCore = !state.HadCore && !priorAbsent;
        }

        if (restoreInjector && state.Injector.HadAppDirectory)
        {
            string currentIndexFile = Path.Combine(appDirectory!, "index.js");
            string currentPackageFile = Path.Combine(appDirectory!, "package.json");
            if (!File.Exists(currentIndexFile) || !File.Exists(currentPackageFile)) throw new InvalidDataException("The installed injector is incomplete; nothing was rolled back.");
            RejectLinkedPath(appDirectory!, currentIndexFile);
            RejectLinkedPath(appDirectory!, currentPackageFile);
            string currentIndexHash = HashFile(currentIndexFile);
            string currentPackageHash = HashFile(currentPackageFile);
            bool indexRestored = currentIndexHash.Equals(state.Injector.IndexSha256, StringComparison.OrdinalIgnoreCase);
            bool packageRestored = currentPackageHash.Equals(state.Injector.PackageSha256, StringComparison.OrdinalIgnoreCase);
            if (!indexRestored && !IsSolcordInjectorIndex(File.ReadAllText(currentIndexFile), installed)) throw new InvalidDataException("The injector entry changed after installation; nothing was rolled back.");
            if (!packageRestored && !IsSolcordInjectorPackage(File.ReadAllText(currentPackageFile))) throw new InvalidDataException("The injector package changed after installation; nothing was rolled back.");
            restoreIndex = !indexRestored;
            restorePackage = !packageRestored;
        }
        else if (restoreInjector && Directory.Exists(appDirectory!))
        {
            foreach (string name in currentEntries)
            {
                string currentFile = Path.Combine(appDirectory!, name);
                RejectLinkedPath(appDirectory!, currentFile);
                string content = File.ReadAllText(currentFile);
                if (name == "index.js" ? !IsSolcordInjectorIndex(content, installed) : !IsSolcordInjectorPackage(content)) throw new InvalidDataException("The new injector directory changed after installation; nothing was rolled back.");
            }
            removeInjectorDirectory = true;
        }

        // Restore the injector first. If a later core operation fails, retry can
        // recognize either the candidate bytes or each already-restored file.
        if (restoreIndex) WriteAtomic(Path.Combine(appDirectory!, "index.js"), injectorIndexContent!);
        if (restorePackage) WriteAtomic(Path.Combine(appDirectory!, "package.json"), injectorPackageContent!);
        if (restoreInjector && state.Injector.HadAppDirectory)
        {
            if (!HashFile(Path.Combine(appDirectory!, "index.js")).Equals(state.Injector.IndexSha256, StringComparison.OrdinalIgnoreCase)
                || !HashFile(Path.Combine(appDirectory!, "package.json")).Equals(state.Injector.PackageSha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Injector rollback verification failed.");
        }
        if (removeInjectorDirectory)
        {
            foreach (string name in currentEntries) File.Delete(Path.Combine(appDirectory!, name));
            if (Directory.Exists(appDirectory!) && Directory.GetFileSystemEntries(appDirectory!).Length == 0) Directory.Delete(appDirectory!);
        }
        restoreBootstrap();
        _mutationHook?.Invoke("rollback-after-injector");

        if (restoreCoreBytes)
        {
            string temporary = $"{installed}.rollback-{Guid.NewGuid():N}.tmp";
            File.Copy(coreBackup!, temporary, overwrite: false);
            File.Move(temporary, installed, overwrite: true);
            if (!HashFile(installed).Equals(state.ExistingCoreSha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Rollback verification failed.");
        }
        else if (deleteCore && File.Exists(installed)) File.Delete(installed);
    }

    private static bool IsSolcordInjectorIndex(string index, string installedCore) => index.Contains(JsonSerializer.Serialize(Path.GetFullPath(installedCore)), StringComparison.OrdinalIgnoreCase) && index.Contains("module.exports = require", StringComparison.Ordinal);
    private static bool IsSolcordInjectorPackage(string package) => package == "{\"main\":\"./index.js\",\"name\":\"discord\"}";

    private static bool RecognizedInjector(string index, string package, string installedCore)
    {
        if (!package.Contains("\"main\"", StringComparison.Ordinal) || !package.Contains("index.js", StringComparison.Ordinal) || !package.Contains("\"discord\"", StringComparison.OrdinalIgnoreCase)) return false;
        bool solcord = IsSolcordInjectorIndex(index, installedCore);
        bool betterDiscord = index.Contains("BetterDiscord", StringComparison.OrdinalIgnoreCase) && index.Contains("betterdiscord.asar", StringComparison.OrdinalIgnoreCase) && index.Contains("module.exports = require", StringComparison.Ordinal);
        return solcord || betterDiscord;
    }

    private (InstallReceipt Receipt, string File, string Sha256) LoadRecoveryReceipt()
    {
        string root = Path.Combine(_roamingAppData, "BetterDiscord", "solcord-installer");
        string pending = Path.Combine(root, "pending.json");
        string current = Path.Combine(root, "current.json");
        string file;
        if (File.Exists(pending) && File.Exists(current) && MatchingSafeReceiptFiles(current, pending))
        {
            // A successful install may leave an identical pending receipt when
            // cleanup is interrupted. Canonicalize it before rollback so the
            // completed candidate receipt is removed with the restored core.
            File.Delete(pending);
            file = current;
        }
        else file = File.Exists(pending) ? pending : current;
        InstallReceipt receipt = ReadReceipt(file, out string sha256);
        return (receipt, file, sha256);
    }

    private InstallReceipt? ReadCurrentReceipt()
    {
        string file = Path.Combine(_roamingAppData, "BetterDiscord", "solcord-installer", "current.json");
        return File.Exists(file) ? ReadReceipt(file) : null;
    }

    private InstallReceipt ReadReceipt(string file) => ReadReceipt(file, out _);

    private InstallReceipt ReadReceipt(string file, out string sha256)
    {
        if (!File.Exists(file) || new FileInfo(file).Length is <= 0 or > 64 * 1024) throw new InvalidDataException("The current Solcord install receipt is unavailable.");
        RejectLinkedPath(_roamingAppData, file);
        if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("The current Solcord install receipt is unsafe.");
        byte[] contents = File.ReadAllBytes(file);
        if (contents.Length is <= 0 or > 64 * 1024) throw new InvalidDataException("The current Solcord install receipt is unavailable.");
        sha256 = Convert.ToHexString(SHA256.HashData(contents)).ToLowerInvariant();
        InstallReceipt? receipt;
        try
        {
            using var reader = new StreamReader(new MemoryStream(contents));
            receipt = JsonSerializer.Deserialize<InstallReceipt>(reader.ReadToEnd());
        }
        catch {throw new InvalidDataException("The current Solcord install receipt is malformed.");}
        if (receipt is null || !Sha256Pattern.IsMatch(receipt.ArtifactSha256) || !Regex.IsMatch(receipt.SourceCommit, "^[0-9a-f]{40}$") || !Version.TryParse(receipt.Version, out _) || receipt.CandidateLabel is not null && !IsCandidateLabelForVersion(receipt.CandidateLabel, receipt.Version) || receipt.DiscordArchiveSha256 is not null && !Sha256Pattern.IsMatch(receipt.DiscordArchiveSha256)) throw new InvalidDataException("The current Solcord install receipt failed validation.");
        return receipt;
    }

    private void RequireUnchangedReceipt(string file, string expectedHash)
    {
        ReadReceipt(file, out string actualHash);
        if (actualHash != expectedHash)
            throw new InvalidDataException("The Solcord installation record changed while Discord was closing; nothing was changed.");
    }

    private static string ReadHashedText(string file, out string sha256)
    {
        byte[] contents = File.ReadAllBytes(file);
        sha256 = Convert.ToHexString(SHA256.HashData(contents)).ToLowerInvariant();
        using var reader = new StreamReader(new MemoryStream(contents));
        return reader.ReadToEnd();
    }

    private bool MatchingSafeReceiptFiles(string left, string right)
    {
        foreach (string file in new[] {left, right})
        {
            RejectLinkedPath(_roamingAppData, file);
            FileInfo info = new(file);
            if (!info.Exists || (info.Attributes & FileAttributes.ReparsePoint) != 0 || info.Length is <= 0 or > 64 * 1024) throw new InvalidDataException("A Solcord installer receipt is unsafe.");
        }
        return CryptographicOperations.FixedTimeEquals(SHA256.HashData(File.ReadAllBytes(left)), SHA256.HashData(File.ReadAllBytes(right)));
    }

    private void RequireAllDiscordStopped()
    {
        string[] running = new[] {"Discord", "DiscordPTB", "DiscordCanary"}.Where(name => _runningProcessCount(name) > 0).ToArray();
        if (running.Length == 0) return;
        _stopDiscordProcesses(running);
        string[] remaining = running;
        for (int attempt = 0; attempt < 30; attempt++)
        {
            remaining = running.Where(name => _runningProcessCount(name) > 0).ToArray();
            if (remaining.Length == 0) return;
            _delay(100);
        }
        if (remaining.Length > 0) throw new InvalidOperationException($"Discord could not close automatically ({string.Join(", ", remaining)}). Quit it from the system tray, then try again.");
    }

    private void StopDiscordProcesses(IReadOnlyList<string> processNames)
    {
        var failures = new List<string>();
        foreach (string processName in processNames)
        {
            string trustedRoot = Path.GetFullPath(Path.Combine(_localAppData, processName)).TrimEnd(Path.DirectorySeparatorChar);
            foreach (Process process in Process.GetProcessesByName(processName))
            {
                using (process)
                {
                    try
                    {
                        if (process.HasExited) continue;
                        string? executable = process.MainModule?.FileName;
                        if (executable is null || !IsTrustedDiscordExecutable(trustedRoot, processName, executable))
                        {
                            failures.Add($"{processName} {process.Id}");
                            continue;
                        }

                        if (process.CloseMainWindow() && process.WaitForExit(2500)) continue;
                        if (!process.HasExited)
                        {
                            // Every Discord process is enumerated and validated independently.
                            // Do not terminate arbitrary descendants that Discord may have launched.
                            process.Kill();
                            if (!process.WaitForExit(5000)) failures.Add($"{processName} {process.Id}");
                        }
                    }
                    catch (InvalidOperationException) {/* Process exited between inspection and shutdown. */}
                    catch {failures.Add($"{processName} {process.Id}");}
                }
            }
        }

        if (failures.Count > 0)
        {
            string joined = string.Join(", ", failures.Distinct(StringComparer.Ordinal));
            throw new InvalidOperationException($"Discord could not close automatically ({joined}). Quit it from the system tray, then try again.");
        }
    }

    private static bool IsTrustedDiscordExecutable(string trustedRoot, string processName, string executable)
    {
        string full = Path.GetFullPath(executable);
        return Path.GetFileName(full).Equals($"{processName}.exe", StringComparison.OrdinalIgnoreCase)
            && full.StartsWith($"{trustedRoot}{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase);
    }

    private static void RejectReparsePoint(string directory)
    {
        if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("The installer refused a linked directory.");
    }

    private static void RejectLinkedPath(string trustedRoot, string target)
    {
        string root = Path.GetFullPath(trustedRoot).TrimEnd(Path.DirectorySeparatorChar);
        string full = Path.GetFullPath(target);
        if (!full.Equals(root, StringComparison.OrdinalIgnoreCase) && !full.StartsWith($"{root}{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The installer target escapes its trusted root.");
        string current = root;
        foreach (string component in Path.GetRelativePath(root, full).Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, component);
            if ((Directory.Exists(current) || File.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("The installer refused a linked target path.");
        }
    }

    private static void WriteAtomic(string target, string content)
    {
        string temporary = $"{target}.{Guid.NewGuid():N}.tmp";
        File.WriteAllText(temporary, content);
        File.Move(temporary, target, overwrite: true);
    }
}
