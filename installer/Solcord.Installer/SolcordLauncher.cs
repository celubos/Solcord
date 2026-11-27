// SPDX-License-Identifier: Apache-2.0

using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace Solcord.Installer;

internal sealed record SolcordLauncherReceipt(int SchemaVersion, string ShortcutPath, string IconPath, string TargetPath, string Arguments);

internal static class SolcordLauncher
{
    private const string IconResource = "Solcord.Installer.Resources.solcord.ico";
    internal const string ShortcutDescription = "Launch Discord with Solcord";

    /// <summary>
    /// What the Start Menu entry runs. With a persistent Setup copy it runs
    /// <c>SolcordSetup.exe --launch</c>, which re-attaches Solcord after a Discord
    /// update before opening Discord. Otherwise it starts Discord the way Discord's
    /// own shortcut does: its current launcher at the channel root, then Squirrel's
    /// Update.exe on older installs, then the app executable itself.
    /// </summary>
    internal static (string Target, string Arguments, string WorkingDirectory) LaunchCommand(DiscordTarget target, string? setupExecutable = null)
    {
        if (setupExecutable is not null && File.Exists(setupExecutable)) return (setupExecutable, "--launch", Path.GetDirectoryName(setupExecutable)!);
        string channelRoot = Directory.GetParent(Path.GetDirectoryName(target.ExecutablePath)!)?.FullName ?? throw new InvalidDataException("The Discord installation path is malformed.");
        foreach (string candidate in new[] {Path.Combine(channelRoot, $"{target.ProcessName}.exe"), Path.Combine(channelRoot, "Update.exe")})
        {
            if (!File.Exists(candidate)) continue;
            EnsureSafePath(channelRoot, candidate);
            return (candidate, $"--processStart {target.ProcessName}.exe", channelRoot);
        }
        EnsureSafePath(channelRoot, target.ExecutablePath);
        return (target.ExecutablePath, "", channelRoot);
    }

    internal static void Ensure(DiscordTarget target, string roamingAppData, string? setupExecutable = null)
    {
        string roaming = Path.GetFullPath(roamingAppData).TrimEnd(Path.DirectorySeparatorChar);
        string installerRoot = Path.Combine(roaming, "BetterDiscord", "solcord-installer");
        string programsRoot = Path.Combine(roaming, "Microsoft", "Windows", "Start Menu", "Programs");
        string shortcutDirectory = Path.Combine(programsRoot, "Solcord");
        string shortcutPath = Path.Combine(shortcutDirectory, "Solcord.lnk");
        string iconPath = Path.Combine(installerRoot, "Solcord.ico");
        string receiptPath = Path.Combine(installerRoot, "launcher.json");
        EnsureSafePath(roaming, installerRoot);
        EnsureSafePath(roaming, programsRoot);
        EnsureSafePath(programsRoot, shortcutDirectory);
        EnsureSafePath(shortcutDirectory, shortcutPath);
        EnsureSafePath(installerRoot, iconPath);
        EnsureSafePath(installerRoot, receiptPath);

        bool hasReceipt = File.Exists(receiptPath);
        // A Solcord shortcut whose receipt was lost (an interrupted older Setup)
        // is adopted; anything else at that path is someone else's and is kept.
        if (!hasReceipt && File.Exists(shortcutPath) && !IsSolcordShortcut(shortcutPath)) throw new InvalidDataException("An unrecognized Solcord launcher entry already exists.");
        if (hasReceipt) ValidateReceipt(receiptPath, shortcutPath, iconPath);

        Directory.CreateDirectory(installerRoot);
        Directory.CreateDirectory(shortcutDirectory);
        RejectReparsePoint(installerRoot);
        RejectReparsePoint(shortcutDirectory);
        WriteEmbeddedIcon(iconPath);

        (string launchTarget, string arguments, string workingDirectory) = LaunchCommand(target, setupExecutable);
        CreateShortcut(shortcutPath, launchTarget, arguments, workingDirectory, iconPath, ShortcutDescription);
        var receipt = new SolcordLauncherReceipt(1, shortcutPath, iconPath, launchTarget, arguments);
        WriteAtomic(receiptPath, JsonSerializer.Serialize(receipt, new JsonSerializerOptions {WriteIndented = true}));
    }

    /// <summary>Create or replace a shortcut that Setup owns by fixed path (used for "Solcord Setup").</summary>
    internal static void WriteShortcut(string shortcutPath, string targetPath, string arguments, string description)
    {
        string directory = Path.GetDirectoryName(shortcutPath)!;
        Directory.CreateDirectory(directory);
        RejectReparsePoint(directory);
        CreateShortcut(shortcutPath, targetPath, arguments, Path.GetDirectoryName(targetPath)!, targetPath, description, iconIsExecutable: true);
    }

    /// <summary>The target of an existing shortcut, or null when it cannot be read.</summary>
    internal static string? ShortcutTarget(string shortcutPath) => ReadShortcut(shortcutPath)?.Target;

    private static bool IsSolcordShortcut(string shortcutPath) => ReadShortcut(shortcutPath)?.Description == ShortcutDescription;

    private static (string Target, string Description)? ReadShortcut(string shortcutPath)
    {
        if (!File.Exists(shortcutPath) || (File.GetAttributes(shortcutPath) & FileAttributes.ReparsePoint) != 0) return null;
        Type? shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType is null) return null;
        object? shell = null;
        object? shortcut = null;
        try
        {
            shell = Activator.CreateInstance(shellType);
            if (shell is null) return null;
            shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] {shortcutPath});
            if (shortcut is null) return null;
            Type shortcutType = shortcut.GetType();
            string target = shortcutType.InvokeMember("TargetPath", BindingFlags.GetProperty, null, shortcut, null) as string ?? "";
            string description = shortcutType.InvokeMember("Description", BindingFlags.GetProperty, null, shortcut, null) as string ?? "";
            return (target, description);
        }
        catch (Exception error) when (error is COMException or TargetInvocationException or ArgumentException or UnauthorizedAccessException) {return null;}
        finally
        {
            if (shortcut is not null && Marshal.IsComObject(shortcut)) Marshal.FinalReleaseComObject(shortcut);
            if (shell is not null && Marshal.IsComObject(shell)) Marshal.FinalReleaseComObject(shell);
        }
    }

    internal static void Remove(string roamingAppData)
    {
        string roaming = Path.GetFullPath(roamingAppData).TrimEnd(Path.DirectorySeparatorChar);
        string installerRoot = Path.Combine(roaming, "BetterDiscord", "solcord-installer");
        string programsRoot = Path.Combine(roaming, "Microsoft", "Windows", "Start Menu", "Programs");
        string shortcutDirectory = Path.Combine(programsRoot, "Solcord");
        string shortcutPath = Path.Combine(shortcutDirectory, "Solcord.lnk");
        string iconPath = Path.Combine(installerRoot, "Solcord.ico");
        string receiptPath = Path.Combine(installerRoot, "launcher.json");
        EnsureSafePath(roaming, installerRoot);
        EnsureSafePath(roaming, programsRoot);
        EnsureSafePath(programsRoot, shortcutDirectory);
        bool hasReceipt = File.Exists(receiptPath);
        if (hasReceipt) ValidateReceipt(receiptPath, shortcutPath, iconPath);
        else if (!IsSolcordShortcut(shortcutPath)) return;
        if (File.Exists(shortcutPath)) File.Delete(shortcutPath);
        if (Directory.Exists(shortcutDirectory) && !Directory.EnumerateFileSystemEntries(shortcutDirectory).Any()) Directory.Delete(shortcutDirectory, recursive: false);
        if (File.Exists(iconPath)) File.Delete(iconPath);
        if (hasReceipt) File.Delete(receiptPath);
    }

    private static void ValidateReceipt(string receiptPath, string shortcutPath, string iconPath)
    {
        FileInfo info = new(receiptPath);
        if (!info.Exists || info.Length is <= 0 or > 32 * 1024 || (info.Attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("The Solcord launcher receipt is unsafe.");
        SolcordLauncherReceipt? receipt;
        try {receipt = JsonSerializer.Deserialize<SolcordLauncherReceipt>(File.ReadAllText(receiptPath));}
        catch {throw new InvalidDataException("The Solcord launcher receipt is malformed.");}
        if (receipt is null || receipt.SchemaVersion != 1 || !Path.GetFullPath(receipt.ShortcutPath).Equals(Path.GetFullPath(shortcutPath), StringComparison.OrdinalIgnoreCase) || !Path.GetFullPath(receipt.IconPath).Equals(Path.GetFullPath(iconPath), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The Solcord launcher receipt does not own the expected files.");
    }

    private static void WriteEmbeddedIcon(string iconPath)
    {
        using Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(IconResource) ?? throw new InvalidDataException("The embedded Solcord launcher icon is missing.");
        using var memory = new MemoryStream();
        stream.CopyTo(memory);
        byte[] bytes = memory.ToArray();
        if (bytes.Length is <= 0 or > 2 * 1024 * 1024) throw new InvalidDataException("The embedded Solcord launcher icon is invalid.");
        string temporary = $"{iconPath}.{Guid.NewGuid():N}.tmp";
        try {File.WriteAllBytes(temporary, bytes); File.Move(temporary, iconPath, overwrite: true);}
        finally {if (File.Exists(temporary)) File.Delete(temporary);}
    }

    private static void CreateShortcut(string shortcutPath, string targetPath, string arguments, string workingDirectory, string iconPath, string description, bool iconIsExecutable = false)
    {
        Type shellType = Type.GetTypeFromProgID("WScript.Shell") ?? throw new PlatformNotSupportedException("Windows shortcut services are unavailable.");
        object shell = Activator.CreateInstance(shellType) ?? throw new PlatformNotSupportedException("Windows shortcut services are unavailable.");
        string temporary = $"{shortcutPath}.{Guid.NewGuid():N}.tmp.lnk";
        object? shortcut = null;
        try
        {
            shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] {temporary});
            if (shortcut is null) throw new InvalidOperationException("Windows did not create the Solcord shortcut.");
            Type shortcutType = shortcut.GetType();
            shortcutType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] {targetPath});
            shortcutType.InvokeMember("Arguments", BindingFlags.SetProperty, null, shortcut, new object[] {arguments});
            shortcutType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] {workingDirectory});
            shortcutType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] {iconIsExecutable ? $"{targetPath},0" : $"{iconPath},0"});
            shortcutType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] {description});
            shortcutType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
            File.Move(temporary, shortcutPath, overwrite: true);
        }
        finally
        {
            if (shortcut is not null && Marshal.IsComObject(shortcut)) Marshal.FinalReleaseComObject(shortcut);
            if (Marshal.IsComObject(shell)) Marshal.FinalReleaseComObject(shell);
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }

    private static void WriteAtomic(string target, string content) => FileSafety.WriteAtomic(target, content);

    private static void EnsureSafePath(string root, string target) => FileSafety.RejectLinkedPath(root, target, "The Solcord launcher path escapes its trusted root.", "The Solcord launcher refused a linked path.");

    private static void RejectReparsePoint(string directory) => FileSafety.RejectReparsePoint(directory, "The Solcord launcher refused a linked directory.");
}
