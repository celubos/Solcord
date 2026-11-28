// SPDX-License-Identifier: Apache-2.0

using System.Diagnostics;
using Microsoft.Win32;

namespace Solcord.Installer;

/// <summary>
/// Keeps one current copy of Setup on the PC so people never have to find an old
/// download again: %LOCALAPPDATA%\Solcord\Setup\SolcordSetup.exe, a "Solcord Setup"
/// Start Menu entry, and a per-user entry in Settings > Apps (no administrator
/// rights). Everything here is optional polish around the verified install: a
/// failure is reported as a warning and never undoes the install.
/// </summary>
internal sealed class SetupRegistration
{
    internal const string DefaultUninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Solcord";
    internal const string SetupShortcutDescription = "Install, update, repair, or remove Solcord";
    private readonly string _localAppData;
    private readonly string _roamingAppData;
    private readonly string _uninstallKey;

    /// <summary>True when Setup was removed while running from its own copy; the copy is deleted after Setup exits.</summary>
    internal bool DeletesCopyAfterExit {get; private set;}

    internal SetupRegistration(string localAppData, string roamingAppData, string uninstallKey = DefaultUninstallKey)
    {
        _localAppData = Path.GetFullPath(localAppData).TrimEnd(Path.DirectorySeparatorChar);
        _roamingAppData = Path.GetFullPath(roamingAppData).TrimEnd(Path.DirectorySeparatorChar);
        _uninstallKey = uninstallKey;
    }

    internal string ProductDirectory => Path.Combine(_localAppData, "Solcord");
    internal string SetupDirectory => Path.Combine(ProductDirectory, "Setup");
    internal string SetupExecutable => Path.Combine(SetupDirectory, "SolcordSetup.exe");
    internal string ShortcutPath => Path.Combine(_roamingAppData, "Microsoft", "Windows", "Start Menu", "Programs", "Solcord", "Solcord Setup.lnk");

    /// <summary>
    /// Copy the running Setup into place (unless it already runs from there), add
    /// the Start Menu entry, and register in Settings > Apps. Returns the copy.
    /// </summary>
    internal string Ensure(string runningExecutable, ReleaseManifest manifest)
    {
        string source = Path.GetFullPath(runningExecutable);
        DeletesCopyAfterExit = false;
        FileSafety.RejectLinkedPath(_localAppData, SetupDirectory, "The Solcord Setup folder escapes its trusted root.", "The Solcord Setup folder is linked elsewhere.");
        Directory.CreateDirectory(SetupDirectory);
        FileSafety.RejectReparsePoint(SetupDirectory, "The Solcord Setup folder is linked elsewhere.");
        if (!source.Equals(SetupExecutable, StringComparison.OrdinalIgnoreCase))
        {
            FileSafety.RejectLinkedPath(SetupDirectory, SetupExecutable, "The Solcord Setup copy escapes its folder.", "The Solcord Setup copy is linked elsewhere.");
            string temporary = $"{SetupExecutable}.{Guid.NewGuid():N}.tmp";
            try
            {
                File.Copy(source, temporary, overwrite: false);
                File.Move(temporary, SetupExecutable, overwrite: true);
            }
            finally
            {
                try {if (File.Exists(temporary)) File.Delete(temporary);}
                catch (Exception error) when (error is IOException or UnauthorizedAccessException) {}
            }
        }
        FileSafety.RejectLinkedPath(_roamingAppData, ShortcutPath, "The Solcord Setup shortcut escapes the Start Menu.", "The Solcord Setup shortcut is linked elsewhere.");
        SolcordLauncher.WriteShortcut(ShortcutPath, SetupExecutable, "", SetupShortcutDescription);
        using RegistryKey key = Registry.CurrentUser.CreateSubKey(_uninstallKey, writable: true) ?? throw new InvalidOperationException("Windows did not create the Solcord apps entry.");
        string quoted = $"\"{SetupExecutable}\"";
        key.SetValue("DisplayName", "Solcord");
        key.SetValue("DisplayVersion", manifest.Version);
        key.SetValue("Publisher", "Solcord");
        key.SetValue("DisplayIcon", $"{SetupExecutable},0");
        key.SetValue("InstallLocation", SetupDirectory);
        key.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd", System.Globalization.CultureInfo.InvariantCulture));
        key.SetValue("UninstallString", $"{quoted} --uninstall");
        key.SetValue("QuietUninstallString", $"{quoted} --uninstall --quiet");
        key.SetValue("ModifyPath", quoted);
        key.SetValue("URLInfoAbout", "https://github.com/celubos/Solcord");
        key.SetValue("EstimatedSize", (int)Math.Min(int.MaxValue, new FileInfo(SetupExecutable).Length / 1024), RegistryValueKind.DWord);
        key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        return SetupExecutable;
    }

    /// <summary>True when the Settings > Apps entry is ours (it points at our Setup folder).</summary>
    internal bool IsRegistered()
    {
        using RegistryKey? key = Registry.CurrentUser.OpenSubKey(_uninstallKey, writable: false);
        return key?.GetValue("InstallLocation") is string location && Path.GetFullPath(location).TrimEnd(Path.DirectorySeparatorChar).Equals(SetupDirectory, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Remove the Start Menu entry, the apps entry, and the Setup copy. Only the
    /// exact files and key Setup created are touched. When Setup is running from
    /// the copy itself, the copy is deleted after Setup exits (<see cref="FinishAfterExit"/>).
    /// </summary>
    internal void Remove(string runningExecutable)
    {
        if (string.Equals(SolcordLauncher.ShortcutTarget(ShortcutPath), SetupExecutable, StringComparison.OrdinalIgnoreCase)) File.Delete(ShortcutPath);
        string shortcutDirectory = Path.GetDirectoryName(ShortcutPath)!;
        if (Directory.Exists(shortcutDirectory) && !Directory.EnumerateFileSystemEntries(shortcutDirectory).Any()) Directory.Delete(shortcutDirectory, recursive: false);
        if (IsRegistered()) Registry.CurrentUser.DeleteSubKey(_uninstallKey, throwOnMissingSubKey: false);
        if (!File.Exists(SetupExecutable) || (File.GetAttributes(SetupExecutable) & FileAttributes.ReparsePoint) != 0) return;
        if (!Path.GetFullPath(runningExecutable).Equals(SetupExecutable, StringComparison.OrdinalIgnoreCase))
        {
            File.Delete(SetupExecutable);
            TryRemoveEmpty(SetupDirectory);
            return;
        }
        // Windows cannot delete a running program, and Setup stays open after an
        // uninstall so the result can be read. Delete the copy once Setup exits.
        DeletesCopyAfterExit = true;
    }

    /// <summary>
    /// Called as Setup exits. A hidden helper waits a few seconds for this process
    /// to end, deletes exactly the Setup copy, then removes the Setup and product
    /// folders only if they are empty (rmdir without /s).
    /// </summary>
    internal void FinishAfterExit()
    {
        if (!DeletesCopyAfterExit) return;
        DeletesCopyAfterExit = false;
        string script = $"/d /c ping -n 4 127.0.0.1 >nul & del /f /q \"{SetupExecutable}\" & rmdir \"{SetupDirectory}\" & rmdir \"{Path.Combine(ProductDirectory, "InstallerTemp")}\" & rmdir \"{ProductDirectory}\"";
        Process.Start(new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "cmd.exe"), script) {CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden});
    }

    private static void TryRemoveEmpty(string directory)
    {
        try {if (Directory.Exists(directory) && !Directory.EnumerateFileSystemEntries(directory).Any()) Directory.Delete(directory, recursive: false);}
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) {}
    }
}
