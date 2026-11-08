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
            return 0;
        }
        catch (Exception error) {Console.Error.WriteLine(error); return 1;}
        finally {if (Directory.Exists(root)) Directory.Delete(root, recursive: true);}
    }
}
