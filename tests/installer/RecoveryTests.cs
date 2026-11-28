// SPDX-License-Identifier: Apache-2.0

using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using Solcord.Installer;

static class RecoveryTests
{
    static void Check(bool condition, string message) {if (!condition) throw new InvalidDataException(message);}
    static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    static string Bundle(string root, string label, string payload)
    {
        Directory.CreateDirectory(root);
        byte[] bytes = System.Text.Encoding.UTF8.GetBytes(payload);
        string hash = Hash(bytes);
        string commit = new('a', 40);
        File.WriteAllBytes(Path.Combine(root, "solcord.asar"), bytes);
        byte[] build = JsonSerializer.SerializeToUtf8Bytes(new {
            schemaVersion = 2, kind = "solcord-post-build-manifest",
            build = new {product = "Solcord", version = "2.0.0", candidateLabel = label, mode = "production", source = new {clean = true, commit}},
            artifacts = new {asar = new {file = "solcord.asar", sha256 = hash, bytes = bytes.Length}}
        });
        File.WriteAllBytes(Path.Combine(root, "solcord-build-manifest.json"), build);
        File.WriteAllText(Path.Combine(root, "solcord-installer-manifest.json"), JsonSerializer.Serialize(
            new ReleaseManifest("2.0.0", label, commit, hash, "solcord.asar", Hash(build), 7, "fixture", "fixture")));
        return root;
    }

    static (InstallerEngine Engine, DiscordTarget Target) Fixture(string root, string channel = "Stable")
    {
        string name = channel == "Canary" ? "DiscordCanary" : "Discord";
        string app = Path.Combine(root, "local", name, "app-1.2.3");
        Directory.CreateDirectory(Path.Combine(app, "resources"));
        File.WriteAllText(Path.Combine(app, $"{name}.exe"), "fixture-executable");
        File.WriteAllText(Path.Combine(app, "resources", "app.asar"), $"original-{channel}");
        string bundle = Bundle(Path.Combine(root, "bundle-a"), "v2.0.0-rc.1", "core-a");
        var engine = new InstallerEngine(bundle, Path.Combine(root, "local"), Path.Combine(root, "roaming"), _ => 0);
        string owner = Path.Combine(root, "roaming", "BetterDiscord", "plugins", "owner.plugin.js");
        Directory.CreateDirectory(Path.GetDirectoryName(owner)!);
        File.WriteAllText(owner, "private-owner-data");
        return (engine, engine.DetectTargets().Single(target => target.Channel == channel));
    }

    static int CrashChild(string root, string point)
    {
        var engine = new InstallerEngine(Path.Combine(root, "bundle-a"), Path.Combine(root, "local"), Path.Combine(root, "roaming"), _ => 0,
            stage => {if (stage == point) Environment.Exit(87);});
        engine.Uninstall(engine.DetectTargets().Single());
        return 88;
    }

    static void Crash(string root, string point)
    {
        string executable = Environment.ProcessPath ?? throw new InvalidOperationException("Test process path is unavailable.");
        var start = new ProcessStartInfo(executable) {UseShellExecute = false, CreateNoWindow = true};
        if (Path.GetFileNameWithoutExtension(executable).Equals("dotnet", StringComparison.OrdinalIgnoreCase)) start.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);
        foreach (string argument in new[] {"--crash-child", root, point}) start.ArgumentList.Add(argument);
        using Process process = Process.Start(start) ?? throw new InvalidOperationException("Test child failed to start.");
        if (!process.WaitForExit(15000)) {process.Kill(); throw new TimeoutException("Owned recovery test child timed out.");}
        Check(process.ExitCode == 87, $"Child did not exit at {point}: {process.ExitCode}");
    }

    static void TestUninstallRestart(string root)
    {
        foreach (string point in new[] {"uninstall-after-journal", "uninstall-after-archive", "uninstall-after-index", "uninstall-after-package", "uninstall-after-bootstrap", "uninstall-after-core", "uninstall-after-receipt"})
        {
            string scenario = Path.Combine(root, point);
            var (engine, target) = Fixture(scenario);
            engine.InstallNew(target);
            Crash(scenario, point);
            string journal = Path.Combine(scenario, "roaming", "BetterDiscord", "solcord-installer", "pending-uninstall.json");
            Check(File.Exists(journal), $"Missing durable journal after {point}");
            var restarted = new InstallerEngine(Path.Combine(scenario, "bundle-a"), Path.Combine(scenario, "local"), Path.Combine(scenario, "roaming"), _ => 0);
            restarted.RollBack(target);
            Check(restarted.VerifyInstalled(target) && !File.Exists(journal), $"Restart recovery did not restore installation after {point}");
            restarted.Uninstall(target);
            string resources = Path.Combine(Path.GetDirectoryName(target.ExecutablePath)!, "resources");
            Check(File.ReadAllText(Path.Combine(resources, "app.asar")) == "original-Stable", $"Vanilla startup lost after {point}");
            Check(!Directory.Exists(Path.Combine(resources, "app")), $"Injector remained after {point}");
            Check(File.ReadAllText(Path.Combine(scenario, "roaming", "BetterDiscord", "plugins", "owner.plugin.js")) == "private-owner-data", $"Owner bytes changed after {point}");
            Console.WriteLine($"PASS hard process exit + restart: {point}");
        }
    }

    static void TestManagedRollback(string root)
    {
        var (a, target) = Fixture(root);
        InstallReceipt first = a.InstallNew(target);
        string bBundle = Bundle(Path.Combine(root, "bundle-b"), "v2.0.0-rc.2", "core-b");
        var b = new InstallerEngine(bBundle, Path.Combine(root, "local"), Path.Combine(root, "roaming"), _ => 0);
        b.Update(target);
        b.RollBack(target);
        Check(a.VerifyInstalled(target), "A did not verify after A -> B -> rollback");
        string receipt = Path.Combine(root, "roaming", "BetterDiscord", "solcord-installer", "current.json");
        Check(JsonSerializer.Deserialize<InstallReceipt>(File.ReadAllText(receipt)) == first, "Previous managed receipt was not restored exactly");
        a.Uninstall(target);
        Console.WriteLine("PASS managed install A -> update B -> rollback -> verify/uninstall A");
    }

    static void TestStagingAndRepairs(string root)
    {
        var (a, target) = Fixture(root);
        a.InstallNew(target);
        string installerRoot = Path.Combine(root, "roaming", "BetterDiscord", "solcord-installer");
        int count = Directory.GetDirectories(Path.Combine(installerRoot, "backups")).Length;
        for (int i = 0; i < 20; i++) a.Repair(target);
        Check(Directory.GetDirectories(Path.Combine(installerRoot, "backups")).Length == count && a.VerifyInstalled(target), "Identical repairs grew backups");
        string core = Path.Combine(root, "roaming", "BetterDiscord", "data", "betterdiscord.asar");
        string receipt = File.ReadAllText(Path.Combine(installerRoot, "current.json"));
        string b = Bundle(Path.Combine(root, "bundle-b"), "v2.0.0-rc.2", "core-b");
        foreach (string point in new[] {"install-before-stage", "install-after-stage"})
        {
            var failing = new InstallerEngine(b, Path.Combine(root, "local"), Path.Combine(root, "roaming"), _ => 0, stage => {if (stage == point) throw new IOException("fixture stage failure");});
            try {failing.Update(target); throw new InvalidDataException("Staging failure was ignored");}
            catch (IOException error) when (error.Message == "fixture stage failure") {}
            Check(!a.HasPendingRecovery() && a.VerifyInstalled(target) && File.ReadAllText(core) == "core-a" && File.ReadAllText(Path.Combine(installerRoot, "current.json")) == receipt, "Staging failure changed installed state");
            Check(!Directory.GetFiles(Path.GetDirectoryName(core)!, ".solcord-*.tmp").Any(), "Owned staging file leaked");
        }
        Console.WriteLine("PASS 20 bounded identical repairs and pre-mutation staging failures");
    }

    static void TestChannelOwnership(string root)
    {
        foreach (string first in new[] {"Stable", "Canary"})
        {
            string scenario = Path.Combine(root, first);
            var (engine, selected) = Fixture(scenario, first);
            string other = first == "Stable" ? "Canary" : "Stable";
            Fixture(scenario, other);
            DiscordTarget alternate = engine.DetectTargets().Single(target => target.Channel == other);
            engine.InstallNew(selected);
            Check(!engine.VerifyInstalled(alternate), "Other channel was reported verified");
            try {engine.Repair(alternate); throw new InvalidDataException("Cross-channel repair was allowed");}
            catch (InvalidOperationException error) when (error.Message.Contains("one Discord channel", StringComparison.Ordinal)) {}
            Check(engine.VerifyInstalled(selected), "Rejected cross-channel repair changed managed channel");
            engine.Uninstall(selected);
            Check(File.ReadAllText(Path.Combine(Path.GetDirectoryName(alternate.ExecutablePath)!, "resources", "app.asar")) == $"original-{other}", "Other channel changed");
        }
        Console.WriteLine("PASS single-channel ownership in both Stable/Canary orders");
    }

    static void TestOwnerDrift(string root)
    {
        var (engine, target) = Fixture(root);
        engine.InstallNew(target);
        Crash(root, "uninstall-after-index");
        string file = Path.Combine(Path.GetDirectoryName(target.ExecutablePath)!, "resources", "app", "package.json");
        File.WriteAllText(file, "owner-replacement");
        try {engine.RollBack(target); throw new InvalidDataException("Owner drift was overwritten");}
        catch (InvalidDataException error) when (error.Message.Contains("owner bytes were preserved", StringComparison.Ordinal)) {}
        Check(File.ReadAllText(file) == "owner-replacement" && engine.HasPendingRecovery(), "Owner drift/recovery evidence was lost");
        Console.WriteLine("PASS interrupted recovery refuses changed owner bytes");
    }

    // Mirrors src/electron/main/discord-update-migration.ts (canonical) and the
    // inherited migrator shipped through Solcord 2.0.1 (legacy).
    static string StageDiscordUpdate(string root, string version, string format, string core)
    {
        string app = Path.Combine(root, "local", "Discord", $"app-{version}");
        string resources = Path.Combine(app, "resources");
        Directory.CreateDirectory(resources);
        File.WriteAllText(Path.Combine(app, "Discord.exe"), "fixture-executable");
        if (format == "vanilla")
        {
            File.WriteAllText(Path.Combine(resources, "app.asar"), $"original-{version}");
            return resources;
        }
        File.WriteAllText(Path.Combine(resources, "betterdiscord.app.asar"), $"original-{version}");
        Directory.CreateDirectory(Path.Combine(resources, "app"));
        if (format == "canonical")
        {
            File.WriteAllText(Path.Combine(resources, "app", "package.json"), "{\"main\":\"./index.js\",\"name\":\"discord\"}");
            File.WriteAllText(Path.Combine(resources, "app", "index.js"), $"require({JsonSerializer.Serialize(core)});\nmodule.exports = require(\"../betterdiscord.app.asar\");\n");
        }
        else
        {
            File.WriteAllText(Path.Combine(resources, "app", "package.json"), "{\"name\":\"discord\",\"main\":\"index.js\"}");
            File.WriteAllText(Path.Combine(resources, "app", "index.js"), $"\nrequire({JsonSerializer.Serialize(Path.Combine(core, "main.js"))});\nrequire(\"../betterdiscord.app.asar\");\n");
        }
        return resources;
    }

    static void TestDiscordUpdateMigration(string root)
    {
        foreach (string format in new[] {"canonical", "legacy"})
        {
            string scenario = Path.Combine(root, format);
            var (engine, target) = Fixture(scenario);
            engine.InstallNew(target);
            string core = Path.Combine(scenario, "roaming", "BetterDiscord", "data", "betterdiscord.asar");
            string newer = StageDiscordUpdate(scenario, "1.2.4", format, core);
            try {engine.Uninstall(target); throw new InvalidDataException($"Uninstall deleted the core a newer {format} loader needs");}
            catch (InvalidOperationException error) when (error.Message.Contains("Discord updated to 1.2.4. Choose Repair Solcord first", StringComparison.Ordinal)) {}
            Check(File.Exists(core) && engine.VerifyInstalled(target) && !engine.HasPendingRecovery(), $"Refused {format} uninstall changed state");

            DiscordTarget updated = engine.DetectTargets().Single();
            Check(updated.Version == "1.2.4" && !engine.VerifyInstalled(updated), $"Newer {format} Discord was reported verified before repair");
            engine.Repair(updated);
            Check(engine.VerifyInstalled(updated), $"Repair did not adopt the {format}-migrated Discord version");
            Check(File.ReadAllText(Path.Combine(newer, "app", "package.json")) == "{\"main\":\"./index.js\",\"name\":\"discord\"}", $"Repair left the {format} loader package");
            string receipt = Path.Combine(scenario, "roaming", "BetterDiscord", "solcord-installer", "current.json");
            Check(JsonSerializer.Deserialize<InstallReceipt>(File.ReadAllText(receipt))!.DiscordVersion == "1.2.4", "Receipt did not follow the Discord update");

            engine.Uninstall(updated);
            Check(File.ReadAllText(Path.Combine(newer, "app.asar")) == "original-1.2.4" && !Directory.Exists(Path.Combine(newer, "app")) && !File.Exists(core), $"Uninstall after {format} migration did not restore vanilla Discord");
            Check(File.ReadAllText(Path.Combine(scenario, "roaming", "BetterDiscord", "plugins", "owner.plugin.js")) == "private-owner-data", "Owner bytes changed");
            Console.WriteLine($"PASS Discord update with {format} migrated loader: uninstall refused, repair adopted, uninstall restored vanilla");
        }

        string vanilla = Path.Combine(root, "vanilla");
        var (plain, plainTarget) = Fixture(vanilla);
        plain.InstallNew(plainTarget);
        StageDiscordUpdate(vanilla, "1.2.4", "vanilla", "");
        plain.Uninstall(plainTarget);
        Check(!File.Exists(Path.Combine(vanilla, "roaming", "BetterDiscord", "data", "betterdiscord.asar")), "A vanilla newer folder blocked uninstall");
        Console.WriteLine("PASS a vanilla newer Discord folder does not block uninstall");

        string removed = Path.Combine(root, "removed");
        var (gone, goneTarget) = Fixture(removed);
        gone.InstallNew(goneTarget);
        string removedCore = Path.Combine(removed, "roaming", "BetterDiscord", "data", "betterdiscord.asar");
        StageDiscordUpdate(removed, "1.2.4", "canonical", removedCore);
        Directory.Delete(Path.GetDirectoryName(goneTarget.ExecutablePath)!, recursive: true);
        DiscordTarget current = gone.DetectTargets().Single();
        foreach (Action action in new Action[] {() => gone.Uninstall(current), () => gone.RollBack(current)})
        {
            try {action(); throw new InvalidDataException("A removed recorded Discord version was not explained");}
            catch (InvalidOperationException error) when (error.Message.Contains("Discord updated to 1.2.4 and removed 1.2.3", StringComparison.Ordinal)) {}
        }
        gone.Repair(current);
        Check(gone.VerifyInstalled(current), "Repair did not recover after Discord removed the recorded version");
        gone.Uninstall(current);
        Check(!File.Exists(removedCore), "Uninstall after recovery left the core");
        Console.WriteLine("PASS removed recorded Discord version: actionable refusal, repair, uninstall");

        // The field case: Discord staged a new version in the background, left it
        // vanilla (no migrator ran), deleted the recorded version, and a newer
        // Solcord package is then installed over it.
        string field = Path.Combine(root, "field-update");
        var (older, olderTarget) = Fixture(field);
        older.InstallNew(olderTarget);
        StageDiscordUpdate(field, "1.2.4", "vanilla", "");
        Directory.Delete(Path.GetDirectoryName(olderTarget.ExecutablePath)!, recursive: true);
        var upgrade = new InstallerEngine(Bundle(Path.Combine(field, "bundle-b"), "v2.0.0-rc.2", "core-b"), Path.Combine(field, "local"), Path.Combine(field, "roaming"), _ => 0);
        DiscordTarget staged = upgrade.DetectTargets().Single();
        Check(staged.Version == "1.2.4" && upgrade.RecordedDiscordVersion() == "1.2.3" && !upgrade.IsCurrentPackageRecorded(), "Field fixture did not reproduce a detached newer Discord");
        Check(upgrade.InstalledPackageLabel() == "v2.0.0-rc.1", "Installed package label was not readable");
        upgrade.Update(staged);
        Check(upgrade.VerifyInstalled(staged) && upgrade.RecordedDiscordVersion() == "1.2.4", "A newer package did not re-attach Solcord to the updated Discord");
        Check(File.ReadAllText(Path.Combine(field, "roaming", "BetterDiscord", "plugins", "owner.plugin.js")) == "private-owner-data", "Owner bytes changed during field update");
        upgrade.Uninstall(staged);
        Check(File.ReadAllText(Path.Combine(field, "local", "Discord", "app-1.2.4", "resources", "app.asar")) == "original-1.2.4", "Uninstall after field update did not restore vanilla Discord");
        Console.WriteLine("PASS detached Discord update + removed recorded version: newer package updates, uninstall restores vanilla");
    }

    static void TestLauncherTargets(string root)
    {
        var (_, target) = Fixture(root);
        string channelRoot = Path.Combine(root, "local", "Discord");
        Check(SolcordLauncher.LaunchCommand(target).Target == target.ExecutablePath, "Without a launcher the app executable must be used");
        File.WriteAllText(Path.Combine(channelRoot, "Update.exe"), "squirrel");
        var squirrel = SolcordLauncher.LaunchCommand(target);
        Check(squirrel.Target == Path.Combine(channelRoot, "Update.exe") && squirrel.Arguments == "--processStart Discord.exe", "The Squirrel launch command is wrong");
        File.WriteAllText(Path.Combine(channelRoot, "Discord.exe"), "launcher");
        var launcher = SolcordLauncher.LaunchCommand(target);
        Check(launcher.Target == Path.Combine(channelRoot, "Discord.exe") && launcher.Arguments == "--processStart Discord.exe", "Discord's current launcher was not preferred over Update.exe");
        string setup = Path.Combine(root, "local", "Solcord", "Setup", "SolcordSetup.exe");
        Directory.CreateDirectory(Path.GetDirectoryName(setup)!);
        File.WriteAllText(setup, "setup");
        var healing = SolcordLauncher.LaunchCommand(target, setup);
        Check(healing.Target == setup && healing.Arguments == "--launch", "The healing Setup launcher was not used");

        string roaming = Path.Combine(root, "roaming");
        string installerRoot = Path.Combine(roaming, "BetterDiscord", "solcord-installer");
        string shortcut = Path.Combine(roaming, "Microsoft", "Windows", "Start Menu", "Programs", "Solcord", "Solcord.lnk");
        SolcordLauncher.Ensure(target, roaming);
        Check(SolcordLauncher.ShortcutTarget(shortcut) == Path.Combine(channelRoot, "Discord.exe"), "The shortcut does not start Discord's current launcher");
        // An interrupted older Setup lost the receipt and icon: adopt, don't refuse forever.
        File.Delete(Path.Combine(installerRoot, "launcher.json"));
        File.Delete(Path.Combine(installerRoot, "Solcord.ico"));
        SolcordLauncher.Ensure(target, roaming, setup);
        Check(File.Exists(Path.Combine(installerRoot, "launcher.json")) && File.Exists(Path.Combine(installerRoot, "Solcord.ico")) && SolcordLauncher.ShortcutTarget(shortcut) == setup, "An orphaned Solcord shortcut was not adopted");
        File.Delete(Path.Combine(installerRoot, "launcher.json"));
        SolcordLauncher.Remove(roaming);
        Check(!File.Exists(shortcut) && !File.Exists(Path.Combine(installerRoot, "Solcord.ico")), "An orphaned Solcord shortcut was not removed on uninstall");
        // Something else at that path is never overwritten or removed.
        Directory.CreateDirectory(Path.GetDirectoryName(shortcut)!);
        File.WriteAllText(shortcut, "not a Solcord shortcut");
        try {SolcordLauncher.Ensure(target, roaming); throw new InvalidDataException("A foreign launcher entry was overwritten");}
        catch (InvalidDataException error) when (error.Message.Contains("unrecognized", StringComparison.Ordinal)) {}
        SolcordLauncher.Remove(roaming);
        Check(File.ReadAllText(shortcut) == "not a Solcord shortcut", "A foreign launcher entry was removed");
        Console.WriteLine("PASS launcher uses Discord's current launcher or healing Setup, adopts orphaned entries, keeps foreign ones");
    }

    static void TestInstalledPackageLabel(string root)
    {
        var (engine, target) = Fixture(root);
        Check(engine.InstalledPackageLabel() is null, "A missing receipt reported an installed package");
        engine.InstallNew(target);
        string receipt = Path.Combine(root, "roaming", "BetterDiscord", "solcord-installer", "current.json");
        Check(engine.InstalledPackageLabel() == "v2.0.0-rc.1", "The installed package label was not read");
        // A receipt written by a future Setup may fail this Setup's strict checks;
        // the label is still read so the UI can say a newer Solcord is installed.
        File.WriteAllText(receipt, "{\"Version\":\"9.1.0\",\"CandidateLabel\":\"v9.1.0\",\"FutureField\":{\"x\":1},\"SourceCommit\":\"not-a-commit\"}");
        Check(engine.InstalledPackageLabel() == "v9.1.0", "A future receipt label was not read leniently");
        Check(engine.InstalledPackageIsNewer(), "A future receipt was not reported as newer");
        // Missing fields must read as an unrecognized receipt, not crash strict validation.
        File.WriteAllText(receipt, "{\"Version\":\"9.1.0\",\"CandidateLabel\":\"v9.1.0\"}");
        Check(engine.InstalledPackageIsNewer() && engine.HasManagedInstall(), "A minimal future receipt was not reported as newer");
        try {engine.ManagedTarget(); throw new InvalidOperationException("A minimal future receipt was accepted as this Setup's receipt");}
        catch (InvalidDataException) {}
        try {engine.Update(target); throw new InvalidOperationException("An older Setup updated over a newer receipt");}
        catch (InvalidDataException) {}
        File.WriteAllText(receipt, "{\"Version\":\"not a version\"}");
        Check(engine.InstalledPackageLabel() is null && !engine.InstalledPackageIsNewer(), "A malformed receipt produced a label");
        File.WriteAllText(receipt, "{\"Version\":\"1.0.0\"}");
        Check(engine.InstalledPackageLabel() == "v1.0.0" && !engine.InstalledPackageIsNewer(), "An older label-less receipt was misreported");
        Console.WriteLine("PASS installed package label is read leniently for newer/older receipts");
    }

    static void TestLoaderRecognition()
    {
        string core = Path.Combine(Path.GetTempPath(), "Ünïcode user's", "BetterDiscord", "data", "betterdiscord.asar");
        string nodeStyle = $"require(\"{core.Replace("\\", "\\\\")}\");\nmodule.exports = require(\"../betterdiscord.app.asar\");\n";
        Check(InstallerEngine.LoaderTargetsCore(nodeStyle, core, allowLegacy: false), "Node JSON escaping of a non-ASCII path was not recognized");
        Check(InstallerEngine.LoaderTargetsCore(nodeStyle.Replace("\n", "\r\n"), core, allowLegacy: false), "CRLF loader was not recognized");
        Check(!InstallerEngine.LoaderTargetsCore(nodeStyle, core + ".other", allowLegacy: true), "A loader for another core was accepted");
        Check(!InstallerEngine.LoaderTargetsCore(nodeStyle + "require('evil');\n", core, allowLegacy: true), "Appended code was accepted");
        string legacy = $"\nrequire({JsonSerializer.Serialize(Path.Combine(core, "main.js"))});\nrequire(\"../betterdiscord.app.asar\");\n";
        Check(InstallerEngine.LoaderTargetsCore(legacy, core, allowLegacy: true) && !InstallerEngine.LoaderTargetsCore(legacy, core, allowLegacy: false), "Legacy loader handling is wrong");
        Check(!InstallerEngine.LoaderTargetsCore("require(\"relative\\\\betterdiscord.asar\");\nmodule.exports = require(\"../betterdiscord.app.asar\");\n", "relative\\betterdiscord.asar", allowLegacy: true), "A relative loader path was accepted");
        Console.WriteLine("PASS semantic loader recognition (escaping, CRLF, legacy, foreign/extra code)");
    }

    static void TestCompletedInstallIsNotRecovery(string root)
    {
        var (engine, target) = Fixture(root);
        engine.InstallNew(target);
        string installerRoot = Path.Combine(root, "roaming", "BetterDiscord", "solcord-installer");
        File.Copy(Path.Combine(installerRoot, "current.json"), Path.Combine(installerRoot, "pending.json"));
        Check(!engine.HasPendingRecovery(), "An interrupted cleanup of a completed install was presented as needing Roll Back");
        engine.Repair(target);
        Check(engine.VerifyInstalled(target) && !File.Exists(Path.Combine(installerRoot, "pending.json")), "Matching pending receipt was not reconciled");
        File.WriteAllText(Path.Combine(installerRoot, "pending.json"), File.ReadAllText(Path.Combine(installerRoot, "current.json")).Replace("Stable", "Canary"));
        Check(engine.HasPendingRecovery(), "A different pending receipt was hidden");
        Console.WriteLine("PASS identical pending receipt is reconciled, a different one still requires recovery");
    }

    static int Main(string[] args)
    {
        if (args.Length == 3 && args[0] == "--crash-child") return CrashChild(args[1], args[2]);
        string root = Path.Combine(Path.GetTempPath(), $"solcord-installer-recovery-{Guid.NewGuid():N}");
        try
        {
            TestManagedRollback(Path.Combine(root, "managed"));
            TestStagingAndRepairs(Path.Combine(root, "staging"));
            TestChannelOwnership(Path.Combine(root, "channels"));
            TestUninstallRestart(Path.Combine(root, "restart"));
            TestOwnerDrift(Path.Combine(root, "drift"));
            TestLoaderRecognition();
            TestDiscordUpdateMigration(Path.Combine(root, "discord-update"));
            TestCompletedInstallIsNotRecovery(Path.Combine(root, "completed"));
            TestInstalledPackageLabel(Path.Combine(root, "label"));
            TestLauncherTargets(Path.Combine(root, "launcher"));
            return 0;
        }
        catch (Exception error) {Console.Error.WriteLine(error); return 1;}
        finally {if (Directory.Exists(root)) Directory.Delete(root, recursive: true);}
    }
}
