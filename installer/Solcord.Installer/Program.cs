// SPDX-License-Identifier: Apache-2.0

using System.Text.Json;
using System.Text.Json.Nodes;

namespace Solcord.Installer;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        if (args.Contains("--self-test", StringComparer.OrdinalIgnoreCase))
        {
            try
            {
                using EmbeddedInstallerBundle bundle = EmbeddedInstallerBundle.ExtractVerified();
                return InstallerSelfTest.Run(bundle.Root);
            }
            catch (Exception error)
            {
                Console.Error.WriteLine($"embedded-bundle:{error.GetType().Name}");
                return 1;
            }
        }
        if (args.Contains("--update", StringComparer.OrdinalIgnoreCase)) return RunUpdate(args);
        try
        {
            using EmbeddedInstallerBundle bundle = EmbeddedInstallerBundle.ExtractVerified();
            Application.Run(new InstallerForm(bundle.Root));
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Solcord Installer", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static int RunUpdate(string[] args)
    {
        try
        {
            int channelFlag = Array.FindIndex(args, value => value.Equals("--channel", StringComparison.OrdinalIgnoreCase));
            if (args.Length != 3 || channelFlag < 0 || channelFlag + 1 >= args.Length)
                throw new ArgumentException("Usage: SolcordInstaller.exe --update --channel Stable|PTB|Canary");
            string channel = args[channelFlag + 1];
            if (channel is not ("Stable" or "PTB" or "Canary"))
                throw new ArgumentException("The Discord channel must be Stable, PTB, or Canary.");

            using EmbeddedInstallerBundle bundle = EmbeddedInstallerBundle.ExtractVerified();
            var engine = new InstallerEngine(
                bundle.Root,
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData));
            DiscordTarget target = engine.DetectTargets().SingleOrDefault(candidate => candidate.Channel == channel)
                ?? throw new InvalidOperationException($"Discord {channel} is not installed.");
            engine.Update(target);
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"update:{error.GetType().Name}:{error.Message}");
            return 1;
        }
    }
}

internal static class InstallerSelfTest
{
    private static string SerializeLegacyWithoutCandidateLabel<T>(T value)
    {
        JsonObject document = JsonSerializer.SerializeToNode(value)?.AsObject() ?? throw new InvalidDataException("fixture legacy document");
        if (!document.Remove("CandidateLabel") || document.ContainsKey("CandidateLabel")) throw new InvalidDataException("fixture legacy candidate-label removal");
        return document.ToJsonString();
    }

    internal static int Run(string embeddedBundleRoot)
    {
        string root = Path.Combine(Path.GetTempPath(), $"solcord-installer-test-{Guid.NewGuid():N}");
        string stage = "prepare";
        try
        {
            stage = "discord-target-selection-and-preflight";
            ValidateTargetSelectionAndPreflight(embeddedBundleRoot, Path.Combine(root, "target-selection"));
            stage = "electron-bootstrap-handoff-and-recovery";
            ValidateBootstrapHandoff(embeddedBundleRoot, Path.Combine(root, "bootstrap-handoff"));
            stage = "discord-update-reinstall";
            ValidateDiscordUpdateReinstall(embeddedBundleRoot, Path.Combine(root, "discord-update-reinstall"));
            stage = "dpi-layout-matrix";
            InstallerForm.ValidateGeometryMatrix(embeddedBundleRoot);
            stage = "responsive-single-flight-engine-operation";
            InstallerForm.ValidateResponsiveOperations(embeddedBundleRoot);
            string local = Path.Combine(root, "local");
            string roaming = Path.Combine(root, "roaming");
            string discord = Path.Combine(local, "Discord", "app-1.2.3");
            Directory.CreateDirectory(discord);
            File.WriteAllText(Path.Combine(discord, "Discord.exe"), "fixture");
            string resources = Path.Combine(discord, "resources");
            Directory.CreateDirectory(resources);
            File.WriteAllText(Path.Combine(resources, "app.asar"), "discord-fixture");
            string priorApp = Path.Combine(resources, "app");
            Directory.CreateDirectory(priorApp);
            const string priorIndex = "// BetterDiscord fixture\nrequire('betterdiscord.asar');\nmodule.exports = require('../app.asar');\n";
            const string priorPackage = "{\"main\":\"./index.js\",\"name\":\"discord\"}";
            File.WriteAllText(Path.Combine(priorApp, "index.js"), priorIndex);
            File.WriteAllText(Path.Combine(priorApp, "package.json"), priorPackage);
            string data = Path.Combine(roaming, "BetterDiscord", "data");
            Directory.CreateDirectory(data);
            File.WriteAllText(Path.Combine(data, "betterdiscord.asar"), "previous-core");
            var engine = new InstallerEngine(embeddedBundleRoot, local, roaming, _ => 0);
            ReleaseManifest manifest = engine.LoadManifest();
            string artifact = engine.VerifyBundle(manifest);
            DiscordTarget target = engine.DetectTargets().Single();
            int stubbornStopAttempts = 0;
            var stubbornEngine = new InstallerEngine(embeddedBundleRoot, local, roaming, name => name == "Discord" ? 1 : 0, null, names =>
            {
                if (!names.SequenceEqual(new[] {"Discord"})) throw new InvalidDataException("fixture process set");
                stubbornStopAttempts++;
            }, _ => {});
            stage = "automatic-discord-stop-refusal";
            try {stubbornEngine.Install(target); return 40;}
            catch (InvalidOperationException error) when (error.Message.Contains("could not close automatically", StringComparison.Ordinal)) {/* expected */}
            if (stubbornStopAttempts != 1) return 41;

            int simulatedDiscordProcesses = 1;
            bool automaticStopUsed = false;
            var autoStoppingEngine = new InstallerEngine(embeddedBundleRoot, local, roaming, name => name == "Discord" ? simulatedDiscordProcesses : 0, null, names =>
            {
                if (!names.SequenceEqual(new[] {"Discord"})) throw new InvalidDataException("fixture process set");
                automaticStopUsed = true;
                simulatedDiscordProcesses = 0;
            }, _ => {});
            stage = "automatic-discord-stop-install";
            InstallReceipt receipt = autoStoppingEngine.Install(target);
            if (!automaticStopUsed || simulatedDiscordProcesses != 0) return 42;
            if (!engine.VerifyInstalled()) return 2;
            if (!File.ReadAllText(Path.Combine(resources, "app", "index.js")).Contains("betterdiscord.asar", StringComparison.OrdinalIgnoreCase)) return 4;
            string currentReceipt = Path.Combine(roaming, "BetterDiscord", "solcord-installer", "current.json");
            string currentReceiptText = File.ReadAllText(currentReceipt);
            InstallReceipt installedReceipt = JsonSerializer.Deserialize<InstallReceipt>(currentReceiptText) ?? throw new InvalidDataException("fixture receipt");
            if (installedReceipt.CandidateLabel != manifest.CandidateLabel) return 18;
            string newerDiscord = Path.Combine(local, "Discord", "app-1.2.4");
            Directory.CreateDirectory(Path.Combine(newerDiscord, "resources"));
            File.WriteAllText(Path.Combine(newerDiscord, "Discord.exe"), "newer-fixture");
            string newerPayload = Path.Combine(newerDiscord, "resources", "app.asar");
            File.WriteAllText(newerPayload, "newer-discord-fixture");
            DiscordTarget newerTarget = engine.DetectTargets().Single();
            if (newerTarget.Version != "1.2.4") throw new InvalidDataException("fixture newer Discord target");
            stage = "receipt-bound-recovery-preflight-and-drift";
            ValidateRecoveryGuards(embeddedBundleRoot, local, roaming, newerTarget, currentReceipt, currentReceiptText);
            stage = "receipt-encoding-compatibility";
            foreach (System.Text.Encoding encoding in new System.Text.Encoding[] {new System.Text.UTF8Encoding(true), System.Text.Encoding.Unicode})
            {
                File.WriteAllText(currentReceipt, currentReceiptText, encoding);
                if (!engine.IsCurrentPackageRecorded()) throw new InvalidDataException("receipt encoding compatibility");
            }
            File.WriteAllText(currentReceipt, currentReceiptText);
            string backupStateFile = Path.Combine(receipt.BackupDirectory ?? throw new InvalidDataException("fixture backup"), "backup-state.json");
            BackupState installedBackup = JsonSerializer.Deserialize<BackupState>(File.ReadAllText(backupStateFile)) ?? throw new InvalidDataException("fixture backup state");
            if (installedBackup.CandidateLabel != manifest.CandidateLabel) return 19;
            File.WriteAllText(currentReceipt, JsonSerializer.Serialize(installedReceipt with {Version = "1.0.0", CandidateLabel = null}));
            stage = "upgrade-repair";
            engine.Install(target, repair: true);
            if (!engine.VerifyInstalled()) return 14;
            if (!InstallerEngine.TryGetReleaseCandidateOrdinal(manifest.CandidateLabel, manifest.Version, out ulong candidateOrdinal) || candidateOrdinal == 0) return 21;
            string previousCandidate = $"v{manifest.Version}-rc.{(candidateOrdinal == ulong.MaxValue ? ulong.MaxValue - 1 : candidateOrdinal - 1)}";
            File.WriteAllText(currentReceipt, JsonSerializer.Serialize(installedReceipt with {ArtifactSha256 = new string('b', 64), SourceCommit = new string('b', 40), CandidateLabel = previousCandidate}));
            stage = "same-core-rc-upgrade";
            engine.Install(target, repair: true);
            if (!engine.VerifyInstalled()) return 24;
            stage = "same-version-repair";
            engine.Install(target, repair: true);
            if (!engine.VerifyInstalled()) return 15;
            File.WriteAllText(currentReceipt, JsonSerializer.Serialize(installedReceipt with {CandidateLabel = null}));
            stage = "legacy-same-core-exact-adoption";
            engine.Install(target, repair: true);
            InstallReceipt adoptedReceipt = JsonSerializer.Deserialize<InstallReceipt>(File.ReadAllText(currentReceipt)) ?? throw new InvalidDataException("fixture adopted receipt");
            if (adoptedReceipt.CandidateLabel != manifest.CandidateLabel || adoptedReceipt.ArtifactSha256 != manifest.ArtifactSha256 || adoptedReceipt.SourceCommit != manifest.SourceCommit) return 28;
            File.WriteAllText(currentReceipt, JsonSerializer.Serialize(installedReceipt with {ArtifactSha256 = new string('b', 64), CandidateLabel = null}));
            stage = "legacy-same-core-hold";
            try {engine.Install(target, repair: true); return 20;}
            catch (InvalidOperationException error) when (error.Message.Contains("predates candidate labels", StringComparison.Ordinal)) {/* expected */}
            File.WriteAllText(currentReceipt, JsonSerializer.Serialize(installedReceipt with {CandidateLabel = $"v{manifest.Version}-rc.-1"}));
            stage = "malformed-candidate-label-refusal";
            try {engine.Install(target, repair: true); return 25;}
            catch (InvalidDataException error) when (error.Message.Contains("version provenance is malformed", StringComparison.Ordinal)) {/* expected */}
            if (!InstallerEngine.TryGetReleaseCandidateOrdinal($"v{manifest.Version}", manifest.Version, out ulong maximumOrdinal) || maximumOrdinal != ulong.MaxValue) return 26;
            if (InstallerEngine.TryGetReleaseCandidateOrdinal($"v{manifest.Version}-rc.{ulong.MaxValue}", manifest.Version, out _)) return 29;
            if (InstallerEngine.TryGetReleaseCandidateOrdinal($"v{manifest.Version}-rc.18446744073709551616", manifest.Version, out _)) return 27;
            if (candidateOrdinal != ulong.MaxValue)
            {
                string newerCandidate = $"v{manifest.Version}-rc.{candidateOrdinal + 1}";
                File.WriteAllText(currentReceipt, JsonSerializer.Serialize(installedReceipt with {ArtifactSha256 = new string('b', 64), CandidateLabel = newerCandidate}));
                stage = "same-core-rc-downgrade-refusal";
                try {engine.Install(target, repair: true); return 22;}
                catch (InvalidOperationException error) when (error.Message.Contains("older than the recorded Solcord release candidate", StringComparison.Ordinal)) {/* expected */}
            }
            File.WriteAllText(currentReceipt, JsonSerializer.Serialize(installedReceipt with {ArtifactSha256 = new string('a', 64)}));
            stage = "candidate-label-reuse-refusal";
            try {engine.Install(target, repair: true); return 23;}
            catch (InvalidOperationException error) when (error.Message.Contains("Candidate labels are immutable", StringComparison.Ordinal)) {/* expected */}
            File.WriteAllText(currentReceipt, JsonSerializer.Serialize(installedReceipt with {Version = "999.0.0", CandidateLabel = "v999.0.0-rc.1"}));
            stage = "downgrade-refusal";
            try {engine.Install(target, repair: true); return 16;}
            catch (InvalidOperationException error) when (error.Message.Contains("older than the recorded Solcord install", StringComparison.Ordinal)) {/* expected */}
            File.WriteAllText(currentReceipt, currentReceiptText);
            if (!engine.VerifyInstalled()) return 17;
            File.WriteAllText(currentReceipt, new string('x', 65 * 1024));
            stage = "oversized-receipt-refusal";
            try {engine.Install(target, repair: true); return 8;}
            catch (InvalidDataException) {/* existing unsafe receipts must fail closed */}
            File.WriteAllText(currentReceipt, currentReceiptText);
            string installedCore = Path.Combine(data, "betterdiscord.asar");
            var racedEngine = new InstallerEngine(embeddedBundleRoot, local, roaming, _ => 0, point =>
            {
                if (point == "install-after-core")
                {
                    File.WriteAllText(installedCore, "owner-changed-core");
                    throw new IOException("fixture owner change");
                }
            });
            stage = "automatic-recovery-owner-change";
            try {racedEngine.Install(target, repair: true); return 11;}
            catch (AggregateException) {/* automatic recovery must preserve an unexpected current core */}
            if (File.ReadAllText(installedCore) != "owner-changed-core") return 12;
            string pendingReceipt = Path.Combine(roaming, "BetterDiscord", "solcord-installer", "pending.json");
            if (!File.Exists(pendingReceipt)) return 13;
            File.Copy(artifact, installedCore, overwrite: true);
            File.Delete(pendingReceipt);
            string rogue = Path.Combine(roaming, "BetterDiscord", "solcord-installer", "backups", "zzzz-unbound-newest");
            Directory.CreateDirectory(rogue);
            File.WriteAllText(Path.Combine(rogue, "backup-state.json"), "{}");
            if (receipt.BackupDirectory is null) return 6;
            string backupStateText = File.ReadAllText(backupStateFile);
            File.WriteAllText(backupStateFile, JsonSerializer.Serialize(installedBackup with {CandidateLabel = previousCandidate}));
            stage = "rollback-candidate-label-mismatch-refusal";
            try {engine.RollBack(target); return 29;}
            catch (InvalidDataException error) when (error.Message.Contains("rollback state does not match", StringComparison.Ordinal)) {/* expected */}
            File.WriteAllText(backupStateFile, backupStateText);
            string injectorIndex = Path.Combine(receipt.BackupDirectory, "injector-app", "index.js");
            string originalInjector = File.ReadAllText(injectorIndex);
            File.AppendAllText(injectorIndex, "tampered");
            stage = "tamper-refusal";
            try {engine.RollBack(target); return 7;}
            catch (InvalidDataException) {/* expected hash-bound refusal */}
            File.WriteAllText(injectorIndex, originalInjector);
            File.WriteAllText(currentReceipt, SerializeLegacyWithoutCandidateLabel(installedReceipt));
            File.WriteAllText(backupStateFile, SerializeLegacyWithoutCandidateLabel(installedBackup));
            if (File.ReadAllText(currentReceipt).Contains("CandidateLabel", StringComparison.Ordinal) || File.ReadAllText(backupStateFile).Contains("CandidateLabel", StringComparison.Ordinal)) return 30;
            stage = "legacy-receipt-backup-rollback-compatibility";
            File.Copy(currentReceipt, pendingReceipt, overwrite: false);
            bool interrupted = false;
            var interruptingEngine = new InstallerEngine(embeddedBundleRoot, local, roaming, _ => 0, point =>
            {
                if (!interrupted && point == "rollback-after-injector") {interrupted = true; throw new IOException("fixture interruption");}
            });
            stage = "partial-rollback";
            try {interruptingEngine.RollBack(target); return 9;}
            catch (IOException) {/* retry must finish from the mixed restored state */}
            if (!interrupted) return 31;
            if (!InstallerEngine.HashFile(installedCore).Equals(manifest.ArtifactSha256, StringComparison.OrdinalIgnoreCase)
                || File.ReadAllText(Path.Combine(priorApp, "index.js")) != priorIndex
                || File.ReadAllText(Path.Combine(priorApp, "package.json")) != priorPackage) return 32;
            stage = "rollback-recorded-version-after-discord-update";
            engine.RollBack(newerTarget);
            if (File.ReadAllText(Path.Combine(data, "betterdiscord.asar")) != "previous-core") return 3;
            if (File.ReadAllText(Path.Combine(priorApp, "index.js")) != priorIndex || File.ReadAllText(Path.Combine(priorApp, "package.json")) != priorPackage) return 5;
            if (File.Exists(currentReceipt)) return 10;
            if (File.ReadAllText(newerPayload) != "newer-discord-fixture" || Directory.Exists(Path.Combine(newerDiscord, "resources", "app")))
                throw new InvalidDataException("rollback touched the newer Discord installation");

            stage = "separate-install-update-repair-actions";
            try {engine.Update(target); return 33;}
            catch (InvalidOperationException error) when (error.Message.Contains("Choose Install Solcord", StringComparison.Ordinal)) {/* expected */}
            engine.InstallNew(target);
            if (!engine.IsCurrentPackageRecorded() || !engine.VerifyInstalled()) return 34;
            string firstSetupIntent = Path.Combine(roaming, "BetterDiscord", "solcord-installer", "first-setup-intent.json");
            if (!File.Exists(firstSetupIntent)) return 43;
            SolcordFirstSetupIntent? setupIntent = JsonSerializer.Deserialize<SolcordFirstSetupIntent>(File.ReadAllText(firstSetupIntent));
            if (setupIntent is null
                || setupIntent.Version != 1
                || setupIntent.Purpose != "first-setup"
                || setupIntent.Channel != target.Channel
                || setupIntent.DiscordVersion != target.Version
                || setupIntent.SourceCommit != manifest.SourceCommit
                || setupIntent.ArtifactSha256 != manifest.ArtifactSha256
                || setupIntent.Attempts != 0) return 44;
            string originalIntent = File.ReadAllText(firstSetupIntent);
            try {engine.Update(target); return 35;}
            catch (InvalidOperationException error) when (error.Message.Contains("Choose Repair Solcord", StringComparison.Ordinal)) {/* expected */}
            engine.Repair(target);
            if (!engine.VerifyInstalled()) return 36;
            if (File.ReadAllText(firstSetupIntent) != originalIntent) return 45;
            File.Delete(firstSetupIntent);
            File.WriteAllText(currentReceipt, JsonSerializer.Serialize(installedReceipt with {ArtifactSha256 = new string('b', 64), SourceCommit = new string('b', 40), CandidateLabel = previousCandidate}));
            engine.Update(target);
            if (File.Exists(firstSetupIntent) || !engine.VerifyInstalled()) return 46;

            stage = "vanilla-uninstall-with-data-preservation";
            string plugins = Path.Combine(roaming, "BetterDiscord", "plugins");
            Directory.CreateDirectory(plugins);
            string ownerPlugin = Path.Combine(plugins, "owner.plugin.js");
            File.WriteAllText(ownerPlugin, "owner-data");
            string uninstallBackup = engine.Uninstall(newerTarget);
            if (File.Exists(installedCore) || Directory.Exists(priorApp) || File.Exists(currentReceipt)) return 37;
            if (File.ReadAllText(ownerPlugin) != "owner-data") return 38;
            if (File.ReadAllText(newerPayload) != "newer-discord-fixture" || Directory.Exists(Path.Combine(newerDiscord, "resources", "app")))
                throw new InvalidDataException("uninstall touched the newer Discord installation");
            foreach (string name in new[] {"betterdiscord.asar", "index.js", "package.json", "current.json", "uninstall-state.json"})
                if (!File.Exists(Path.Combine(uninstallBackup, name))) return 39;
            return 0;
        }
        catch (Exception error) {Console.Error.WriteLine($"{stage}:{error.GetType().Name}:{error.Message}"); return 1;}
        finally {if (Directory.Exists(root)) Directory.Delete(root, recursive: true);}
    }

    private static void ValidateDiscordUpdateReinstall(string bundle, string root)
    {
        string local = Path.Combine(root, "local");
        string roaming = Path.Combine(root, "roaming");
        string oldDiscord = Path.Combine(local, "Discord", "app-1.0.0");
        string oldResources = Path.Combine(oldDiscord, "resources");
        Directory.CreateDirectory(oldResources);
        File.WriteAllText(Path.Combine(oldDiscord, "Discord.exe"), "old-discord-fixture");
        File.WriteAllText(Path.Combine(oldResources, "app.asar"), "old-discord-archive");

        string plugins = Path.Combine(roaming, "BetterDiscord", "plugins");
        string themes = Path.Combine(roaming, "BetterDiscord", "themes");
        string settings = Path.Combine(roaming, "BetterDiscord", "data", "stable", "settings.json");
        Directory.CreateDirectory(plugins);
        Directory.CreateDirectory(themes);
        Directory.CreateDirectory(Path.GetDirectoryName(settings)!);
        string plugin = Path.Combine(plugins, "owner.plugin.js");
        string theme = Path.Combine(themes, "owner.theme.css");
        File.WriteAllText(plugin, "owner-plugin");
        File.WriteAllText(theme, "owner-theme");
        File.WriteAllText(settings, "owner-settings");

        var engine = new InstallerEngine(bundle, local, roaming, _ => 0);
        DiscordTarget oldTarget = engine.DetectTargets().Single();
        engine.InstallNew(oldTarget);
        ReleaseManifest manifest = engine.LoadManifest();
        if (!InstallerEngine.TryGetReleaseCandidateOrdinal(manifest.CandidateLabel, manifest.Version, out ulong candidateOrdinal) || candidateOrdinal == 0)
            throw new InvalidDataException("discord-update-reinstall: candidate ordinal");
        string receiptFile = Path.Combine(roaming, "BetterDiscord", "solcord-installer", "current.json");
        InstallReceipt receipt = JsonSerializer.Deserialize<InstallReceipt>(File.ReadAllText(receiptFile)) ?? throw new InvalidDataException("discord-update-reinstall: receipt");
        File.WriteAllText(receiptFile, JsonSerializer.Serialize(receipt with {CandidateLabel = $"v{manifest.Version}-rc.{(candidateOrdinal == ulong.MaxValue ? ulong.MaxValue - 1 : candidateOrdinal - 1)}"}));

        string newDiscord = Path.Combine(local, "Discord", "app-1.0.1");
        string newResources = Path.Combine(newDiscord, "resources");
        Directory.CreateDirectory(newResources);
        File.WriteAllText(Path.Combine(newDiscord, "Discord.exe"), "new-discord-fixture");
        File.WriteAllText(Path.Combine(newResources, "app.asar"), "new-discord-archive");
        DiscordTarget newTarget = engine.DetectTargets().Single();
        if (newTarget.Version != "1.0.1") throw new InvalidDataException("discord-update-reinstall: current Discord target");

        engine.Update(newTarget);
        InstallReceipt updated = JsonSerializer.Deserialize<InstallReceipt>(File.ReadAllText(receiptFile)) ?? throw new InvalidDataException("discord-update-reinstall: updated receipt");
        if (!engine.VerifyInstalled() || updated.DiscordVersion != newTarget.Version || updated.CandidateLabel != manifest.CandidateLabel)
            throw new InvalidDataException("discord-update-reinstall: updated installation did not verify");
        if (File.Exists(Path.Combine(newResources, "app.asar")) || !File.Exists(Path.Combine(newResources, "betterdiscord.app.asar")) || !Directory.Exists(Path.Combine(newResources, "app")))
            throw new InvalidDataException("discord-update-reinstall: startup handoff was not restored");
        if (File.ReadAllText(plugin) != "owner-plugin" || File.ReadAllText(theme) != "owner-theme" || File.ReadAllText(settings) != "owner-settings")
            throw new InvalidDataException("discord-update-reinstall: owner data changed");
    }

    private static void ValidateBootstrapHandoff(string bundle, string root)
    {
        string local = Path.Combine(root, "local");
        string roaming = Path.Combine(root, "roaming");
        string discord = Path.Combine(local, "Discord", "app-1.2.3");
        string resources = Path.Combine(discord, "resources");
        Directory.CreateDirectory(resources);
        File.WriteAllText(Path.Combine(discord, "Discord.exe"), "fixture");
        string vanilla = Path.Combine(resources, "app.asar");
        string original = Path.Combine(resources, "betterdiscord.app.asar");
        string app = Path.Combine(resources, "app");
        string index = Path.Combine(app, "index.js");
        string core = Path.Combine(roaming, "BetterDiscord", "data", "betterdiscord.asar");
        string receipt = Path.Combine(roaming, "BetterDiscord", "solcord-installer", "current.json");
        File.WriteAllText(vanilla, "untouched-discord-bootstrap");
        string originalHash = InstallerEngine.HashFile(vanilla);
        var engine = new InstallerEngine(bundle, local, roaming, _ => 0);
        DiscordTarget target = engine.DetectTargets().Single();
        void Assert(bool condition, string message)
        {
            if (!condition) throw new InvalidDataException($"bootstrap-handoff: {message}");
        }

        // Electron's real search order is app.asar, app/, default_app.asar.
        // A copied core must not count as an installed, reachable entry point.
        Directory.CreateDirectory(Path.GetDirectoryName(core)!);
        File.Copy(engine.VerifyBundle(engine.LoadManifest()), core);
        Assert(!engine.VerifyInstalled(), "core-only installation was reported verified");
        try {engine.Launch(target); throw new InvalidDataException("unverified installation was launched");}
        catch (InvalidDataException error) when (error.Message.Contains("not verified", StringComparison.Ordinal)) {/* held before Process.Start */}
        File.Delete(core);
        var interrupted = new InstallerEngine(bundle, local, roaming, _ => 0, point => {
            if (point == "install-after-bootstrap") throw new IOException("fixture bootstrap interruption");
        });
        try {interrupted.InstallNew(target); throw new InvalidDataException("interrupted installation unexpectedly succeeded");}
        catch (IOException error) when (error.Message == "fixture bootstrap interruption") {/* restored before returning */}
        Assert(File.Exists(vanilla) && InstallerEngine.HashFile(vanilla) == originalHash && !File.Exists(original)
            && !Directory.Exists(app) && !File.Exists(core) && !File.Exists(receipt), "interrupted install did not restore the original startup layout");

        InstallReceipt installed = engine.InstallNew(target);
        Assert(!File.Exists(vanilla) && File.Exists(original) && InstallerEngine.HashFile(original) == originalHash, "original archive was not preserved outside Electron's first slot");
        Assert(installed.DiscordArchiveSha256 == originalHash && engine.VerifyInstalled(), "working bootstrap did not verify");
        string expectedIndex = File.ReadAllText(index);
        Assert(expectedIndex.Contains("../betterdiscord.app.asar", StringComparison.Ordinal), "loader does not continue into the original archive");
        File.AppendAllText(index, "\n// changed loader\n");
        Assert(!engine.VerifyInstalled(), "changed loader still verified");
        File.WriteAllText(index, expectedIndex);
        File.Copy(original, vanilla);
        Assert(!engine.VerifyInstalled(), "shadowed loader still verified");
        string coreHash = InstallerEngine.HashFile(core);
        try {engine.Repair(target); throw new InvalidDataException("competing archives were accepted");}
        catch (InvalidDataException error) when (error.Message.Contains("competing startup archives", StringComparison.Ordinal)) {/* no mutation */}
        Assert(InstallerEngine.HashFile(core) == coreHash && File.ReadAllText(index) == expectedIndex, "ambiguous archive repair changed files");
        File.Delete(vanilla);

        File.WriteAllText(original, "changed-discord-bootstrap");
        Assert(!engine.VerifyInstalled(), "changed Discord archive still verified");
        try {engine.RollBack(target); throw new InvalidDataException("changed archive was rolled back");}
        catch (InvalidDataException error) when (error.Message.Contains("startup archive changed", StringComparison.Ordinal)) {/* preserve external change */}
        Assert(InstallerEngine.HashFile(core) == coreHash && File.ReadAllText(index) == expectedIndex, "archive drift rollback changed files");
        File.WriteAllText(original, "untouched-discord-bootstrap");

        // Reproduce the RC34 layout: app.asar shadows a valid app/ injector.
        File.Move(original, vanilla);
        Assert(!engine.VerifyInstalled(), "RC34 shadowed layout still verified");
        engine.Repair(target);
        Assert(engine.VerifyInstalled() && !File.Exists(vanilla), "repair did not activate the shadowed loader");
        var interruptedUninstall = new InstallerEngine(bundle, local, roaming, _ => 0, point => {
            if (point == "uninstall-after-bootstrap") throw new IOException("fixture uninstall interruption");
        });
        try {interruptedUninstall.Uninstall(target); throw new InvalidDataException("interrupted uninstall unexpectedly succeeded");}
        catch (IOException error) when (error.Message == "fixture uninstall interruption") {/* restored before returning */}
        Assert(engine.VerifyInstalled() && !File.Exists(vanilla), "uninstall interruption did not restore the working loader");
        engine.Uninstall(target);
        Assert(File.Exists(vanilla) && InstallerEngine.HashFile(vanilla) == originalHash && !File.Exists(original)
            && !Directory.Exists(app) && !File.Exists(core), "uninstall left Discord without its original entry point");

        engine.InstallNew(target);
        bool interruptedRollback = false;
        var partialRollback = new InstallerEngine(bundle, local, roaming, _ => 0, point => {
            if (!interruptedRollback && point == "rollback-after-injector") {interruptedRollback = true; throw new IOException("fixture rollback interruption");}
        });
        try {partialRollback.RollBack(target); throw new InvalidDataException("interrupted rollback unexpectedly succeeded");}
        catch (IOException error) when (error.Message == "fixture rollback interruption") {/* retry from already-restored bootstrap */}
        engine.RollBack(target);
        Assert(File.Exists(vanilla) && InstallerEngine.HashFile(vanilla) == originalHash && !File.Exists(original)
            && !Directory.Exists(app) && !File.Exists(core) && !File.Exists(receipt), "rollback retry did not restore a clean Discord startup");
    }

    private static void ValidateTargetSelectionAndPreflight(string bundle, string root)
    {
        string local = Path.Combine(root, "local");
        string roaming = Path.Combine(root, "roaming");
        DiscordTarget CreateTarget(string version, string? module, string content = "discord-fixture")
        {
            string directory = Path.Combine(local, "Discord", $"app-{version}");
            string resources = Path.Combine(directory, "resources");
            Directory.CreateDirectory(resources);
            string executable = Path.Combine(directory, "Discord.exe");
            File.WriteAllText(executable, "fixture");
            if (module is not null) File.WriteAllText(Path.Combine(resources, module), content);
            return new DiscordTarget("Stable", version, executable, "Discord");
        }

        CreateTarget("1.9.9", "app.asar");
        DiscordTarget complete = CreateTarget("1.10.0", "betterdiscord.app.asar");
        DiscordTarget staged = CreateTarget("1.11.0", null);
        DiscordTarget empty = CreateTarget("1.12.0", "app.asar", "");
        CreateTarget("unfinished", "app.asar");
        var detector = new InstallerEngine(bundle, local, roaming, _ => 0);
        if (detector.DetectTargets().Single() != complete)
            throw new InvalidDataException("numeric-version-selection-skips-incomplete-updates");

        string core = Path.Combine(roaming, "BetterDiscord", "data", "betterdiscord.asar");
        Directory.CreateDirectory(Path.GetDirectoryName(core)!);
        File.WriteAllText(core, "previous-core");
        int stopAttempts = 0;
        var preflight = new InstallerEngine(bundle, local, roaming, name => name == "Discord" ? 1 : 0,
            discordProcessStopper: _ => stopAttempts++, delay: _ => {});
        foreach (DiscordTarget invalid in new[] {staged, empty, complete with {Version = "1.10.1"}, complete with {Channel = "Canary"}, complete with {ProcessName = "Unknown"}})
        {
            bool rejected = false;
            try {preflight.Install(invalid);}
            catch (InvalidDataException) {rejected = true;}
            if (!rejected || stopAttempts != 0)
                throw new InvalidDataException("invalid-target-must-not-close-discord");
            AssertUnchanged();
        }

        int running = 1;
        var changedDuringClose = new InstallerEngine(bundle, local, roaming, name => name == "Discord" ? running : 0,
            discordProcessStopper: _ => {
                stopAttempts++;
                running = 0;
                File.Delete(Path.Combine(Path.GetDirectoryName(complete.ExecutablePath)!, "resources", "betterdiscord.app.asar"));
            }, delay: _ => {});
        bool changedTargetRejected = false;
        try {changedDuringClose.Install(complete);}
        catch (InvalidDataException) {changedTargetRejected = true;}
        if (!changedTargetRejected || stopAttempts != 1 || running != 0)
            throw new InvalidDataException("target-drift-after-close-must-abort-install");
        AssertUnchanged();

        void AssertUnchanged()
        {
            if (File.ReadAllText(core) != "previous-core" || Directory.Exists(Path.Combine(roaming, "BetterDiscord", "solcord-installer")))
                throw new InvalidDataException("invalid-target-mutated-core-or-recovery-state");
        }
    }

    private static void ValidateRecoveryGuards(string bundle, string local, string roaming, DiscordTarget newest, string receiptFile, string originalReceipt)
    {
        string core = Path.Combine(roaming, "BetterDiscord", "data", "betterdiscord.asar");
        string coreHash = InstallerEngine.HashFile(core);
        InstallReceipt receipt = JsonSerializer.Deserialize<InstallReceipt>(originalReceipt) ?? throw new InvalidDataException("fixture recovery receipt");
        string injector = Path.Combine(local, "Discord", $"app-{receipt.DiscordVersion}", "resources", "app", "index.js");
        string originalInjector = File.ReadAllText(injector);
        foreach (bool rollback in new[] {true, false})
        foreach (string mode in rollback ? new[] {"channel", "receipt"} : new[] {"channel", "receipt", "injector"})
        {
            int stopAttempts = 0;
            int running = 1;
            var engine = new InstallerEngine(bundle, local, roaming, name => name == "Discord" ? running : 0,
                discordProcessStopper: _ => {
                    stopAttempts++;
                    running = 0;
                    if (mode == "receipt") File.AppendAllText(receiptFile, " ");
                    if (mode == "injector") File.AppendAllText(injector, "// owner fixture edit\n");
                }, delay: _ => {});
            DiscordTarget selected = mode == "channel" ? newest with {Channel = "Canary"} : newest;
            bool rejected = false;
            try
            {
                if (rollback) engine.RollBack(selected);
                else engine.Uninstall(selected);
            }
            catch (InvalidDataException) {rejected = true;}
            if (!rejected || stopAttempts != (mode == "channel" ? 0 : 1))
                throw new InvalidDataException("recovery must reject channel mismatch before shutdown and receipt drift before mutation");
            if (InstallerEngine.HashFile(core) != coreHash
                || File.ReadAllText(receiptFile) != originalReceipt + (mode == "receipt" ? " " : "")
                || File.ReadAllText(injector) != originalInjector + (mode == "injector" ? "// owner fixture edit\n" : ""))
                throw new InvalidDataException("recovery changed protected files after a failed preflight");
            File.WriteAllText(receiptFile, originalReceipt);
            File.WriteAllText(injector, originalInjector);
        }
    }
}
