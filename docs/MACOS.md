# Solcord for macOS (preview)

The macOS preview uses a self-contained command-line installer for Apple Silicon
(`arm64`) or Intel (`x64`). It installs a separate Discord copy in
`~/Applications/Solcord/<channel>/`. Your original Discord app stays in place.
Discord profiles, signed-in accounts, BetterDiscord settings, plugins and themes
are preserved. The installer does not read account credentials or change privacy
choices. Solcord's normal privacy protections apply when the managed copy runs.

This is a **preview**, not a signed and notarized consumer Mac release. A Windows
test run cannot establish macOS compatibility. Native copy, signing, verification
and recovery fixtures must pass on macOS before a preview archive is published;
interactive Discord startup, microphone, keychain and update acceptance still
need a Mac. Apple may block an unsigned download. The installer does not remove
quarantine, bypass Gatekeeper, request `sudo`, or change security settings.

## Install

Download the preview archive for your CPU from the project's GitHub release and
compare its SHA-256 with that release's checksums. Extract the whole folder; keep
`solcord-macos`, its two manifests and `solcord.asar` together. The executable pins
the package manifest's hash and verifies its payload before installation.

Quit **both** the original Discord and any Solcord Discord copy, including menu
bar helpers. Open Terminal in the extracted folder, then run:

```sh
./solcord-macos inspect
./solcord-macos install
./solcord-macos verify
./solcord-macos launch
```

The launcher opens the exact managed app, not an app selected by bundle name.
Do not run the original and managed copies together: they use the same Discord
profile. Do not move the managed app or its state folder after installation.

For PTB or Canary, add `--channel ptb` or `--channel canary` to every command.
If Discord is installed elsewhere, select its original bundle explicitly:

```sh
./solcord-macos install --source "/Applications/Discord.app"
```

The installer validates the selected channel and its existing code signature,
copies it with macOS `ditto` (preserving extended attributes and framework links),
adds Solcord to the copy, and signs the copy locally with an ad-hoc identity.
Existing entitlements and hardened-runtime flags are retained; no extra
entitlements are granted. The original signed bundle is never re-signed.

## Update, repair and recovery

After downloading a new Solcord preview, quit both copies and run `update` from
the new package. After updating the original Discord app, run `repair` to stage a
new managed copy from it. Each operation verifies a complete staged copy before
switching the managed app. The prior app and receipt remain in recovery storage.

```sh
./solcord-macos update
./solcord-macos repair
./solcord-macos rollback
./solcord-macos recover
```

`rollback` restores a verified prior app and Solcord payload. A changed prior copy
is preserved for inspection rather than silently trusted. `recover` rolls an
interrupted switch back to its preceding app and receipt. A lock held by a live
installer is never removed. If recovery finds changed or ambiguous files, it
stops and preserves every copy; do not delete the recovery directory.

To uninstall, quit both copies and run:

```sh
./solcord-macos uninstall
```

The managed app moves into its recovery storage; the original Discord app stays
usable. Profiles, settings, themes, plugins, payloads and recovery files are not
deleted. Recovery files are under
`~/Applications/Solcord/<channel>/state/transactions/`. They may occupy substantial
space because prior app bundles are retained deliberately.

## Build and validation

Use the pinned Bun runtime and a clean production `bun run dist` build, then:

```sh
bun scripts/build-solcord-macos-installer.ts dist/solcord.asar /absolute/new/output SOURCE_COMMIT --arch=arm64
bun scripts/build-solcord-macos-installer.ts dist/solcord.asar /absolute/new/output SOURCE_COMMIT --arch=x64
```

Run each architecture on its matching macOS runner. `--stage-only` permits
cross-compilation without claiming native signing or launch validation. The
builder binds the archive to the clean source commit and build manifest; final
native packaging verifies the CLI signature, runs the compiled executable's
`--self-test` against private native fixtures, and creates a ZIP. No Discord app,
account, browser profile or credentials are needed by the automated fixtures.

Before publishing a preview, CI also runs:

```sh
bun scripts/verify-solcord-macos-official.ts /absolute/package/output /absolute/new/evidence
```

This separate compatibility check downloads Discord's official stable Mac image
from a restricted set of official URLs, mounts it read-only, and exercises a
managed copy in a disposable home. It never launches Discord. Install, verify,
repair, rollback and uninstall must pass with the source signature and hash
unchanged. The package receipt records that result and the tested ZIP hash.

Apple explains why a modified signed bundle needs a new signature in
[TN2206: macOS Code Signing In Depth](https://developer.apple.com/library/archive/technotes/tn2206/).
This implementation uses that constraint to preserve the original app and makes
no claim that an ad-hoc signature provides Developer ID or notarization trust.
