// SPDX-License-Identifier: Apache-2.0

using System.Reflection;
using System.Security.AccessControl;
using System.Security.Principal;

namespace Solcord.Installer;

internal sealed class EmbeddedInstallerBundle : IDisposable
{
    private const string ArtifactResource = "Solcord.Installer.Resources.solcord.asar";
    private const string BuildManifestResource = "Solcord.Installer.Resources.solcord-build-manifest.json";
    private const string InstallerManifestResource = "Solcord.Installer.Resources.solcord-installer-manifest.json";
    private const int MaximumArtifactBytes = 256 * 1024 * 1024;
    private static readonly string[] ExtractedFiles = ["solcord.asar", "solcord-build-manifest.json", "solcord-installer-manifest.json"];
    private readonly string _privateParent;
    private readonly List<FileStream> _locks = [];
    private bool _disposed;

    private EmbeddedInstallerBundle(string root, string privateParent)
    {
        Root = root;
        _privateParent = privateParent;
    }

    internal string Root { get; }

    internal static EmbeddedInstallerBundle ExtractVerified()
    {
        Assembly assembly = Assembly.GetExecutingAssembly();
        byte[] artifact = ReadResource(assembly, ArtifactResource, MaximumArtifactBytes);
        byte[] buildManifest = ReadResource(assembly, BuildManifestResource, 256 * 1024);
        byte[] installerManifest = ReadResource(assembly, InstallerManifestResource, 64 * 1024);
        ReleaseManifest manifest = InstallerEngine.ParseManifest(installerManifest);
        if (!string.Equals(manifest.ArtifactFile, "solcord.asar", StringComparison.Ordinal)) throw new InvalidDataException("The embedded installer manifest names an unexpected artifact.");
        InstallerEngine.VerifyBundleBytes(manifest, artifact, buildManifest);

        string localAppData = Path.GetFullPath(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData));
        string privateParent = Path.Combine(localAppData, "Solcord", "InstallerTemp");
        string productRoot = Path.GetDirectoryName(privateParent)!;
        Directory.CreateDirectory(productRoot);
        RejectLinkedPath(localAppData, productRoot);
        Directory.CreateDirectory(privateParent);
        RejectLinkedPath(localAppData, privateParent);
        SetPrivateAcl(privateParent);
        RemoveStaleBundles(privateParent);
        string root = Path.Combine(privateParent, $"bundle-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        SetPrivateAcl(root);
        RejectLinkedPath(privateParent, root);
        var bundle = new EmbeddedInstallerBundle(root, privateParent);
        try
        {
            WriteExclusive(Path.Combine(root, "solcord.asar"), artifact);
            WriteExclusive(Path.Combine(root, "solcord-build-manifest.json"), buildManifest);
            WriteExclusive(Path.Combine(root, "solcord-installer-manifest.json"), installerManifest);
            bundle.LockExtractedFiles();
            var extracted = new InstallerEngine(root, localAppData, Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData));
            ReleaseManifest extractedManifest = extracted.LoadManifest();
            extracted.VerifyBundle(extractedManifest);
            return bundle;
        }
        catch
        {
            bundle.Dispose();
            throw;
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        foreach (FileStream stream in _locks) stream.Dispose();
        _locks.Clear();
        try
        {
            string root = Path.GetFullPath(Root);
            string parent = Path.GetFullPath(_privateParent).TrimEnd(Path.DirectorySeparatorChar);
            if (!string.Equals(Path.GetDirectoryName(root), parent, StringComparison.OrdinalIgnoreCase)
                || !Path.GetFileName(root).StartsWith("bundle-", StringComparison.Ordinal)
                || !Directory.Exists(root)
                || (File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0) return;
            foreach (string name in ExtractedFiles)
            {
                string file = Path.Combine(root, name);
                if (!File.Exists(file) || (File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) continue;
                File.Delete(file);
            }
            if (Directory.GetFileSystemEntries(root).Length == 0) Directory.Delete(root);
        }
        catch
        {
            // Cleanup is bounded to the three known regular files. Never recurse
            // through an entry another same-user process may have introduced.
        }
    }

    /// <summary>
    /// A crashed or killed run leaves its extracted copy behind. Remove copies
    /// older than an hour using the same bounded rule as Dispose: only the three
    /// known regular files, never recursion. A running installer keeps its files
    /// open, so its delete fails and its folder is skipped.
    /// </summary>
    private static void RemoveStaleBundles(string privateParent)
    {
        try
        {
            DateTime cutoff = DateTime.UtcNow.AddHours(-1);
            foreach (string directory in Directory.EnumerateDirectories(privateParent, "bundle-*", SearchOption.TopDirectoryOnly))
            {
                try
                {
                    if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0 || Directory.GetLastWriteTimeUtc(directory) > cutoff) continue;
                    foreach (string name in ExtractedFiles)
                    {
                        string file = Path.Combine(directory, name);
                        if (File.Exists(file) && (File.GetAttributes(file) & FileAttributes.ReparsePoint) == 0) File.Delete(file);
                    }
                    if (Directory.GetFileSystemEntries(directory).Length == 0) Directory.Delete(directory);
                }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException) {/* In use or owner-changed; leave it. */}
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) {/* Cleanup never blocks setup. */}
    }

    private static byte[] ReadResource(Assembly assembly, string name, int maximumBytes)
    {
        using Stream stream = assembly.GetManifestResourceStream(name) ?? throw new InvalidDataException($"The embedded installer resource {name} is missing.");
        if (stream.CanSeek && (stream.Length <= 0 || stream.Length > maximumBytes)) throw new InvalidDataException($"The embedded installer resource {name} is empty or oversized.");
        using var output = new MemoryStream();
        byte[] buffer = new byte[64 * 1024];
        int total = 0;
        while (true)
        {
            int read = stream.Read(buffer, 0, buffer.Length);
            if (read == 0) break;
            total = checked(total + read);
            if (total > maximumBytes) throw new InvalidDataException($"The embedded installer resource {name} is oversized.");
            output.Write(buffer, 0, read);
        }
        if (total == 0) throw new InvalidDataException($"The embedded installer resource {name} is empty.");
        return output.ToArray();
    }

    private static void SetPrivateAcl(string directory)
    {
        SecurityIdentifier user = WindowsIdentity.GetCurrent().User ?? throw new InvalidOperationException("The installer could not identify the current Windows user.");
        var security = new DirectorySecurity();
        security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        const FileSystemRights rights = FileSystemRights.FullControl;
        const InheritanceFlags inheritance = InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;
        security.AddAccessRule(new FileSystemAccessRule(user, rights, inheritance, PropagationFlags.None, AccessControlType.Allow));
        security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), rights, inheritance, PropagationFlags.None, AccessControlType.Allow));
        new DirectoryInfo(directory).SetAccessControl(security);
    }

    private static void WriteExclusive(string file, ReadOnlySpan<byte> bytes)
    {
        using var stream = new FileStream(file, FileMode.CreateNew, FileAccess.Write, FileShare.None, 64 * 1024, FileOptions.WriteThrough | FileOptions.SequentialScan);
        stream.Write(bytes);
        stream.Flush(flushToDisk: true);
    }

    private void LockExtractedFiles()
    {
        foreach (string name in ExtractedFiles)
        {
            string file = Path.Combine(Root, name);
            if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("The embedded installer refused a linked extracted resource.");
            _locks.Add(new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read));
        }
    }

    private static void RejectLinkedPath(string trustedRoot, string target)
    {
        string root = Path.GetFullPath(trustedRoot).TrimEnd(Path.DirectorySeparatorChar);
        string full = Path.GetFullPath(target);
        if (!full.Equals(root, StringComparison.OrdinalIgnoreCase) && !full.StartsWith($"{root}{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The embedded installer extraction path escapes its private root.");
        string current = root;
        foreach (string component in Path.GetRelativePath(root, full).Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, component);
            if ((Directory.Exists(current) || File.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("The embedded installer refused a linked extraction path.");
        }
    }
}
