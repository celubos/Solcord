# Release status

## Downloads and platforms

| Platform | Distribution | Limits |
| --- | --- | --- |
| Windows x64 | [Solcord 2.0.3](https://github.com/celubos/Solcord/releases/tag/v2.0.3), self-contained installer | Unsigned; Windows may show an unknown-publisher warning |
| macOS Apple Silicon and Intel | Separate command-line preview archives in the same release | Locally ad-hoc signed, not Developer ID signed or notarized; live Discord acceptance remains outstanding |
| Linux | Source tests and core build | No supported consumer installer in this release |

The source delivery branch is `main`; `development` remains the upstream integration branch. Use the version, source commit, and hashes in the downloaded package manifests to identify a build. Historical candidates are not relabeled or overwritten.

## What changed

2.0.3 keeps Solcord on when Discord updates itself in the background (it attaches while Discord runs, and the Start menu **Solcord** entry turns it back on if needed), and makes Setup clearer: plain-language states, a **Turn Solcord back on** button, a **Newer version installed** message instead of a validation error, and a persistent **Solcord Setup** in the Start menu and Settings → Apps. See the [2.0.3 release notes](releases/2.0.3.md).

### 2.0.2

2.0.2 adds a discoverable **Message History** workspace for deleted and edited messages, keeps Solcord manageable after Discord updates itself (the installer shows **Discord updated** and recommends Repair or Update), and fixes Control Center controls that did nothing or misreported their results. See the [2.0.2 release notes](releases/2.0.2.md).

### 2.0.1

The 2.0.1 line repairs modern Discord startup, late-login initialization, and the settings entry. **User Settings → Open Solcord Suite** opens an independent Control Center (ten workspaces as of 2.0.2). The voice controller now confirms the actual send before reporting activation and preserves the current user's received deafened indicator while local audio remains enabled. The owner confirmed that Fake Deafen works after the installed RC8 live check.

The audited fixes cover file confinement, redirect credentials, interrupted installer recovery, Timeline persistence and privacy filtering, recording/playback races, bounded DOM work, and startup catalog loading. Setup now offers refresh, disables actions while checking a selected Discord app, explains busy states, and exposes full local error details.

See the [changelog](../CHANGELOG.md), release notes for [2.0.3](releases/2.0.3.md), [2.0.2](releases/2.0.2.md) and [2.0.1](releases/2.0.1.md), and [automated checks](https://github.com/celubos/Solcord/actions/workflows/solcord-ci.yml).

## Evidence and package integrity

Windows packages include `SolcordInstaller.exe`, `solcord.asar`, `SHA256SUMS.txt`, the core and installer manifests, and the installer build receipt. The receipt binds package bytes and the isolated embedded-resource self-test. Mac previews have separate architecture-specific receipts and archives. `release-package.json` binds the combined inventory to one source commit; `RELEASE-SHA256SUMS.txt` covers all release attachments except itself.

The release workflow requires source verification, Windows recovery tests and packaging, and native macOS fixture and packaging jobs on both architectures. It verifies uploaded asset names, sizes and SHA-256 digests before publishing a draft. An existing version or mismatched artifact is never overwritten.

Release preparation also includes a 30-minute synthetic backend/controller soak, renderer performance comparisons, repeated settings navigation, controlled Chromium UI scenarios, and native Windows installer usability checks. These are controlled tests, not an all-day signed-in Discord network or microphone audit. Each version's release notes record the measured scope and limits.

## Privacy and live acceptance

Strict Privacy remains enabled in the accepted Windows profile, with native acknowledgement, manual updates, and validated renderer protection for two telemetry, two optional crash-reporting, and twelve activity-discovery surfaces. No privacy choices were changed during validation. Discord login, messages, voice, and essential service traffic still reach Discord; Strict is not a zero-traffic guarantee.

The installed RC8 Windows client opened signed in; the Control Center opened, closed and reopened; its workspaces rendered and a density setting persisted. Live Fake Deafen on/off checks showed the received deafen state with local audio enabled, then normal state restoration. The owner subsequently confirmed successful deafen/audio behavior. New platform-specific installer changes do not turn that Windows acceptance into Mac acceptance.

2.0.2 live acceptance on the owner's Windows installation (Message History with real deleted messages, a real Discord self-update, and Control Center changes) is recorded separately once performed. Interactive rollback on the signed-in Windows installation and real Mac startup, microphone, keychain and Discord-update behavior remain separate acceptance work. Destructive recovery scenarios use disposable applications and profiles. No real account, message, credential, or recording is included in public fixtures.

## Compatibility limits

- Discord internal APIs can change. Unsupported adapters stay inactive and report their status.
- Private history, Audience Guard, and experimental tools remain opt-in. Fake Deafen must be explicitly enabled and armed for a call.
- On-device translation requires a compatible engine; external translation requires explicit provider configuration.
- Audience Guard is detection-based, not per-viewer server access control.
- Private data uses encrypted account-scoped storage where available; session-only fallback is labeled.
- Community addons retain their own compatibility and outbound-access requirements.
- Do not disable platform security to run an unsigned package. Mac preview instructions never remove quarantine or bypass Gatekeeper.

For current installation instructions, use [Quick start](QUICK_START.md) or the [Mac preview guide](MACOS.md). Older [archived results](archive/README.md) describe only the versions named in them.
