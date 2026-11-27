// SPDX-License-Identifier: Apache-2.0

namespace Solcord.Installer;

/// <summary>Path and write guards shared by the engine, the embedded bundle, and the launcher.</summary>
internal static class FileSafety
{
    /// <summary>Refuse a target outside <paramref name="trustedRoot"/> or reached through any link or junction.</summary>
    internal static void RejectLinkedPath(string trustedRoot, string target, string escapeMessage, string linkMessage)
    {
        string root = Path.GetFullPath(trustedRoot).TrimEnd(Path.DirectorySeparatorChar);
        string full = Path.GetFullPath(target);
        if (!full.Equals(root, StringComparison.OrdinalIgnoreCase) && !full.StartsWith($"{root}{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException(escapeMessage);
        string current = root;
        foreach (string component in Path.GetRelativePath(root, full).Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, component);
            if ((Directory.Exists(current) || File.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException(linkMessage);
        }
    }

    internal static void RejectReparsePoint(string directory, string message)
    {
        if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException(message);
    }

    /// <summary>Write through a sibling temporary file and rename; the temporary file never outlives a failure.</summary>
    internal static void WriteAtomic(string target, string content)
    {
        string temporary = $"{target}.{Guid.NewGuid():N}.tmp";
        try
        {
            File.WriteAllText(temporary, content);
            File.Move(temporary, target, overwrite: true);
        }
        finally
        {
            // A failed rename (antivirus lock, sharing violation) must not leave a
            // stray file that later makes recovery see "owner files".
            try {if (File.Exists(temporary)) File.Delete(temporary);}
            catch (IOException) {}
            catch (UnauthorizedAccessException) {}
        }
    }
}

/// <summary>The Discord desktop channels Solcord manages, and their executable names.</summary>
internal static class DiscordChannels
{
    internal static readonly IReadOnlyList<(string Channel, string ProcessName)> All = [("Stable", "Discord"), ("PTB", "DiscordPTB"), ("Canary", "DiscordCanary")];

    /// <summary>The executable name for a channel, or an empty string for an unknown channel.</summary>
    internal static string ProcessName(string channel) => All.FirstOrDefault(item => item.Channel == channel).ProcessName ?? "";
}
