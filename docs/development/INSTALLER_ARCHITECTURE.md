# Installer architecture and acceptance

> Technical reference with historical, version-specific review records. For current user guidance, see [Documentation](../README.md) and [Release status](../STATUS.md).

For a normal installation, start with the [quick start](../QUICK_START.md). This page explains what the installer changes, how recovery works, and the additional checks used when building a release. Windows security and sign-in prompts remain yours to review.

## Published build and acceptance boundaries

Published historical candidates remain immutable. The owner-machine install manifest, not this repository page, identifies whichever exact build is currently installed in the signed-in profile.

The current download is [v2.0.0-rc.39](https://github.com/celubos/Solcord/releases/tag/v2.0.0-rc.39). Its automated installer evidence covers install, update, Discord-update repair, downgrade refusal, interrupted recovery, rollback, and uninstall in isolated targets; that is not a claim that destructive recovery cases were exercised against the signed-in owner profile.

The local install receipt identifies the exact source commit, core hash, Discord version, and backup. Those owner-machine paths are intentionally not embedded here. New source changes require new build and runtime evidence. Audience Guard uses account-bound encrypted storage only when Electron's secure storage is available, and reports session-only storage otherwise. It does not provide per-person control over Discord's media delivery.

## Compatibility paths

- Staged production artifact: repository `dist\solcord.asar`
- Installed compatibility target: `%APPDATA%\BetterDiscord\data\betterdiscord.asar`
- Existing plugin folder: `%APPDATA%\BetterDiscord\plugins`
- Existing theme folder: `%APPDATA%\BetterDiscord\themes`
- Existing stable settings: `%APPDATA%\BetterDiscord\data\stable`
- Recovery receipts and backups: `%APPDATA%\BetterDiscord\solcord-installer`

The installed filename remains `betterdiscord.asar` because that is the existing injector contract. This is an intentional compatibility identifier, not product branding.

A separately prepared vanilla launcher may be retained as an additional escape hatch. It is not created by the standard installer and is not required to install Solcord.

## Pre-install gate

1. Record repository root, branch, HEAD, remotes, dirty state, Discord channel/version, installed BetterDiscord version/hash, injector hash, active Discord PIDs, and compatibility paths.
2. Verify both original bundle SHA-256 values and the delivery manifest.
3. Run frozen dependency installation, full tests, lint, type check, type generation, circular-dependency check, production build, package, and `git diff --check`.
4. Prove setup failure atomicity, existing-file conflict behavior, addon quarantine, state rollback, Timeline encryption fallback/retention/account isolation, and the disposable-profile addon matrix. Do not convert `runtime: PENDING` to accepted on static evidence alone.
5. Hash `dist\solcord.asar` and verify the package contains the expected main, preload, renderer, editor, and package files.
6. Confirm no token-like string, private content, absolute user path, or secret appears in the diff, package, screenshots, docs, or build manifest.
7. Do not continue if any required gate fails.

## Disposable acceptance mode

Solcord can prepare a copied Discord runtime for core-only acceptance without changing the installed Discord resources or copying the owner's Discord/BetterDiscord profile. Acceptance mode requires an explicit absolute root and derives every Solcord data path from that root. It also suppresses `betterdiscord://` registration and disables core/addon update writes for the copied run.

The preparer has a true dry-run mode. Before any destination write, it validates a bounded CommonJS `resources/app/package.json`, matches bounded `resources/build_info.json` metadata to the `app-<version>` directory, rejects a source that already contains `resources/solcord.asar`, canonicalizes the physical source and existing destination parent, and rejects links/reparse aliases or physical destination containment. It verifies the caller-bound Solcord ASAR SHA-256 and full source commit, prechecks bounded ASAR file/header sizes before parsing, validates every packed entry range, and requires the exact self-contained runtime entrypoints plus embedded clean `production` or `release` build provenance. The caller must supply both `--expected-sha256 <sha256>` and `--expected-source-commit <40-character git commit>`; corrupt, truncated, oversized, copied, or stale diagnostic artifacts fail closed.

The source runtime may contain either Discord's direct desktop-core entry or the exact recognized legacy BetterDiscord injector entry. The preparer validates the physical `discord_desktop_core/core.asar` and package identity, copies the full runtime, verifies the copy, and neutralizes only that copied injector entry. It never edits the installed Discord tree or installed BetterDiscord core. The copied shim then validates every copied native module wrapper before loading Solcord, disables copied-runtime updater behavior, and writes a bounded content-free lifecycle ledger. The isolated 1.0.9253 run at `32e65a3` reached desktop-core startup and main-window visibility without a duplicate core/preload collision. It stopped at the expected unauthenticated connection boundary; this is startup evidence, not authenticated UI or Activity acceptance.

A real preparation snapshots a deterministic hash inventory of the complete Discord application tree, builds under a random sibling staging directory whose physical identity is rechecked, verifies both the unchanged source tree and the complete copied tree against that snapshot, writes the shim/artifact/manifest inside staging, and atomically renames staging to the still-absent final destination. Failure cleanup removes only the staging directory whose recorded identity is still owned by that invocation; it never deletes a competing or replaced destination. The shim then requires the launcher-provided `SOLCORD_ACCEPTANCE_ROOT`, `APPDATA`, `LOCALAPPDATA`, and `DISCORD_USER_DATA_DIR` to canonically match its copied location before enabling acceptance mode or loading Solcord. Direct `Discord.exe` execution therefore fails closed. Preparation never launches Discord. The generated launcher uses `--multi-instance`; authentication remains a manual owner action.

Residual nonclaim: the staging-identity check and recursive failure cleanup are separate filesystem operations. A hostile process running as the same Windows user with write access to the destination parent could attempt a directory swap in that narrow interval. Random staging names, repeated physical identity checks, and replacement-preserving failure behavior reduce exposure and fail closed when a swap is observed, but they do not make recursive deletion kernel-atomic. Use a destination parent that untrusted same-user processes cannot modify, or a separate Windows account, for a stronger boundary.

Do not copy `%APPDATA%\Discord`, `%APPDATA%\BetterDiscord`, tokens, Timeline data, or browser session material into the disposable profile. A same-Windows-user profile separates files and Discord state but still shares the Windows account and DPAPI boundary. A separate standard Windows account is the stronger acceptance boundary.

Disposable acceptance does not authorize messages, uploads, notification reads, voice joins, recordings, streams, OAuth, links, or Activity launches. The owner performs those actions after reviewing the prepared build. The copied runtime is evidence only for the exact artifact hash and Discord version recorded in its manifest.

## Maintainer installation checks

End users do not need Bun, repository access, or these source-install steps. Use the downloaded installer unless you are deliberately validating a reviewed source build.

1. Post the exact close/install action in the active task.
2. Close all Discord desktop channels before changing the shared core. Use the installer to request graceful shutdown and, when necessary, terminate only processes verified as belonging to those Discord installations. Never kill unrelated processes by name.
3. Create a timestamped backup outside the repository under the task evidence directory.
4. Copy, without deleting originals, the current injector entry point, installed core asar, stable settings, plugin files, theme files, Custom CSS, MessageLoggerV2 files/data, any Solcord Timeline state, and compatibility state. Record SHA-256 values and relative paths without reading private message content.
5. Preserve any existing vanilla recovery launcher unchanged; do not assume one exists.
6. Copy the verified `solcord.asar` to a staged install path; hash again and require equality.
7. Run `bun run inject release stable`. Release mode verifies and atomically stages `dist/solcord.asar` to `%APPDATA%\BetterDiscord\data\betterdiscord.asar`, then creates the standard Discord resource injector pointing at that compatibility target. Do not overwrite plugins, themes, settings, or Custom CSS.
8. Launch Discord Stable normally. Do not start an Activity, join voice, send, upload, or authorize anything.
9. Confirm Discord stays open, Solcord settings/About render, Activity Bridge reports the restricted policy, and no crash loop or duplicate injection is visible.
10. Open First Setup and review the proposed choices. Existing addon/theme states must remain unchanged until **Apply**. Destructive setup and rollback tests belong in an isolated profile, not the signed-in owner's profile.
11. Leave Discord open for the owner.

The machine-readable install manifest records exact backup and rollback paths after execution. Until that manifest exists, this document describes the procedure but is not evidence that installation or backup occurred.

## About-one-minute RC install

The normal RC path is designed to take about one minute on a typical Windows PC after download. This is a usability target, not a time guarantee.

1. Download `SolcordInstaller.exe` and the release-level `SHA256SUMS.txt` from the same owner-controlled `v2.0.0-rc.39` release. The complete review bundle is also available inside the delivery ZIP under its exact generated name.
2. Compare the executable hash with the `installer/SolcordInstaller.exe` entry in the release-level `SHA256SUMS.txt`; that nested evidence name applies byte-for-byte to the root-published executable. Stop on any mismatch.
3. Save anything in progress and leave active calls. Run `SolcordInstaller.exe`, confirm **Version** (Stable, PTB, or Canary), and choose **Install Solcord** or **Update Solcord**. Because the core is shared, the installer closes verified running Discord desktop channels, not just the selected one.
4. Choose **Verify files**, then **Open Solcord**. A fresh install opens **User Settings → Solcord Suite** on Welcome after Discord is ready; an update or repair preserves completed setup.

The RC executable is unsigned. Windows may display an unknown-publisher warning. Do not disable Windows security or automate its prompts. The published guide must use screenshots captured from this exact RC executable; source mockups and images from an older build are not installation evidence.

## Installer behavior

`installer/Solcord.Installer` is the Solcord Windows installer source. A candidate bundle places one self-contained Windows x64 `SolcordInstaller.exe`, `solcord.asar`, the authoritative `solcord-build-manifest.json`, `solcord-installer-manifest.json`, installer-only `SHA256SUMS.txt`, and `solcord-installer-build-receipt.json` together. The receipt's SHA-256 is retained outside the bundle before release assembly. No separate .NET installation is required to run it. The builder accepts only a clean exact `HEAD`, recreates the ignored `dist` directory from that source, and proves that the new ASAR byte count and SHA-256 match both the post-build source manifest and the ASAR's embedded provenance. It rechecks `HEAD`, cleanliness, and generated hashes after publishing, then rehashes the staged payload.

The installer detects Stable, PTB, and Canary and displays the selected version. Before a core change, it asks verified Discord processes to exit gracefully, then terminates only verified remaining Discord processes if necessary. It refuses the change if safe shutdown cannot be completed. It verifies the core before and after installation and records a checked backup of the previous core and injector.

Each action is separate: **Install**, **Update**, **Repair**, **Roll back**, **Uninstall**, **Verify files**, **Open recovery folder**, and **Open Solcord**. Repair reinstalls this package; Update installs a different version. Roll back restores the receipt-bound backup; Uninstall removes Solcord's injector/core without deleting user data. Opening Discord is an explicit action.

It never deletes plugins, themes, settings, custom CSS, MessageLogger data, Timeline data, Friend Watch data, provider archives, or translation credential stores. It does not bypass Windows prompts, authenticate, start an Activity, or perform account actions. Its lifecycle self-test uses disposable directories and verifies install, exact hash, refusal of oversized receipts, receipt-bound rollback, refusal of a rogue newer backup, refusal of a tampered injector backup, preservation of an unexpected current-core change during automatic recovery, canonicalization of an identical stale pending receipt, and retry after an injected partial-rollback interruption. A `pending.json` receipt is durable before mutation; a successful install becomes `current.json`, while a failed update retains pending recovery. Rollback recognizes the candidate and already-restored hashes, restores the injector before the core, and is safe to retry from a mixed state. It refuses to replace or delete a current core whose hash is neither the installed candidate nor the captured prior core, including during automatic recovery. It accepts only the exact direct-child backup recorded by the selected recovery receipt and validates every restored hash before mutation. Launch re-detects and containment-checks the selected channel/version/path. The candidate is unsigned and self-contained; automated lifecycle checks do not make it a signed stable release.

The core ASAR and injector entry files are replaced as separately verified filesystem operations, not as one kernel-atomic transaction, and the installer does not claim a durable parent-directory flush on Windows. A power loss or process failure between those surfaces can leave a mixed state. The pending recovery receipt and idempotent state classification make the tested interruption retryable, but they do not turn the two replacements into one atomic filesystem operation. Keep the receipt-bound backup and recover through the verified rollback path before relaunching Discord.

## First-run setup transaction

The V2 first-run draft selects Solcord Default and the 21 behavior mappings implemented by the Native Suite. Those mappings include the three established interaction controls and grouped composer, call, audio, voice-note, translation, people/space, glance, notification, and motion tools. A mapping is not a blanket live claim: its adapter must report ready before a matching community provider may be archived. Message Timeline, Stream Audience Guard, and every Power Lab experiment remain off. The other catalog entries are optional and carry an individual reason/status; unavailable choices never block **Apply**. **Finish later** changes no addon file, enabled state, theme, Timeline setting, credential, or provider archive; only the resumable onboarding marker is recorded.

After **Apply**, Solcord verifies requested choices, applies the selected theme and preferences, and records a rollback snapshot. Existing community plugins stay in place. Initial setup does not authorize provider replacement or retirement of shared plugin libraries. A selected built-in still needs its own compatible Discord adapter; an unavailable adapter is not counted as working. Reduced-motion settings continue to suppress optional motion.

Plugin replacement is a separate action under **Extensions → Replace duplicate plugins**. The preview binds each feature to its community filename/hash, enabled state, dependency state, archive destination, and provider choice. Apply rechecks the source bytes and replacement readiness before moving only the provider `.plugin.js` into `solcord-provider-archive-v2`, outside the scanned plugin folder. BDFDB is considered last; both enabled and disabled retained consumers keep the library in place. Configuration and private databases are not moved, read, or deleted. Any mismatch aborts or rolls back the transaction. These source safeguards require matching isolated and live evidence before being attributed to a new release.

The setup rollback action restores the recorded prior plugin/theme enabled states and pre-setup Solcord snapshot, removes only unchanged files the setup transaction proved it added, and invokes provider rollback for its recorded archive transaction. Provider rollback restores only a hash-matching archived source to an absent plugin destination. It never overwrites a replacement file or touches private data. Identical pre-existing files are reused and never removed; user changes are preserved for manual review.

## Owner Activity acceptance

A previous owner session reported Activities working. That historical result does not certify every future build. Activity Bridge retains its same-package preload restriction; rerun the authenticated matrix after a change to either mechanism. No automated test starts an Activity on the owner's behalf.

1. Open Solcord Suite → **Voice & Activities** and inspect Activity Bridge. Keep the unrestricted override off.
2. In a designated low-risk server/channel, start **Codenames** yourself. Wait for READY and complete one join/leave/rejoin cycle.
3. Return to Activity Bridge. Confirm one verified late preload was accepted, no preload error appeared, and the ledger remains bounded.
4. Start one second Discord Activity yourself. Repeat open/close/rejoin.
5. Check main chat, Settings, plugin list, theme list, Custom CSS editor, one popout, Command Deck, Stream Shield preview, and recovery panel.
6. If any Activity stalls, stop testing and use rollback. Do not enable the unrestricted override as a shortcut.

## Rollback

There are two separate rollback scopes:

1. **Setup/provider rollback:** while Solcord is running, open **Recovery** for setup snapshots or **Extensions** for the latest provider migration. This restores recorded enabled states and the Solcord snapshot, removes only unchanged files the setup transaction added, and restores hash-matching archived source only when its plugin destination is absent.
2. **Core rollback:** open the same verified installer and choose **Roll back**. It closes verified Discord processes, checks the recorded backup, and restores the injector/core using the recovery receipt. Choose **Open Solcord** only after recovery succeeds. Do not select a random backup folder or overwrite files by hand.

The manifest-generated core restore uses resolved literal paths and a staged copy/hash/rename sequence. Before any recursive cleanup, it verifies the resolved target remains inside the manifest's timestamped backup or Solcord staging directory. No rollback command deletes the plugin directory, theme directory, stable settings directory, MessageLoggerV2 data, Timeline store, translation credential store, provider archive, or vanilla launcher.

If Solcord cannot open far enough to expose setup rollback, use the core rollback first. The setup journal remains available for later reviewed recovery; do not manually delete candidate files in bulk.

Do not delete the Solcord artifact or backup until the owner accepts both Activities and ordinary settings/plugin/theme behavior. Exact commands are generated from resolved absolute paths in the install manifest; this document intentionally contains no user-specific path.

## Nonclaims

- A successful copy is not runtime acceptance.
- A visible Solcord settings page is not proof an Activity handshake completes.
- The owner’s existing plugins/themes are preserved, not certified compatible.
- The vanilla launcher is an escape hatch, not a Solcord validation path.
- A catalog hash match or static pass is not plugin runtime acceptance.
- The 36-entry catalog is not an enabled-addon list. V2's recommended mappings select built-in behavior, not community payloads; every runtime adapter can still report unavailable and every provider migration remains separately hash- and health-gated.
- Message Timeline remains opt-in; its encrypted storage and fallback paths are tested, but no automated acceptance captures or exports owner messages.
- “About one minute” describes the intended happy path after download. It does not include download time, Windows review prompts, Discord shutdown delays, backup recovery, or first-run feature decisions.
- The unsigned RC has no publisher identity in Windows. A successful lifecycle self-test does not replace code signing or authenticated release distribution.
