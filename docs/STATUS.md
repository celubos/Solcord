# Release status

## Downloads and source

| Item | Status |
| --- | --- |
| Published Windows download | [Solcord 2.0 — Signal](https://github.com/celubos/Solcord/releases/tag/v2.0.0) |
| Current release | `v2.0.0` |
| Source delivery branch | `main` |
| Upstream integration branch | `development` |
| Distribution | Unsigned Windows x64 stable release |
| Code signing | Not available; Windows may show an unknown-publisher warning |

The [changelog](../CHANGELOG.md) describes source changes. A merge is not an installation or a release. Use the version and hashes in the downloaded release's manifest to identify a package.

## Current release

Solcord 2.0 — Signal promotes the reviewed V2 line without relabeling any release candidate. It keeps the tested Discord-update recovery path and adds a lower-cost ambient renderer: fewer backing pixels, paced background frames, cached field geometry, and no self-triggered DOM synchronization pass. When Discord replaces its startup files, **Update Solcord** or **Repair Solcord** restores the startup handoff without replacing plugins, themes, settings, or private stores.

The published `v2.0.0` release has six package assets: `SolcordInstaller.exe`, `solcord.asar`, `SHA256SUMS.txt`, `solcord-build-manifest.json`, `solcord-installer-manifest.json`, and `solcord-installer-build-receipt.json`. The build and installer manifests bind the source commit and core hash; the checksum list and installer-build receipt bind package bytes and the isolated installer self-test. No `release-manifest.json` from the separate acceptance-evidence assembler is attached to that release. These assets establish package integrity and isolated tests; they do not establish live signed-in client, microphone, or interactive rollback acceptance. Older candidates keep their own immutable receipts and are not relabeled.

| Check | Recorded result |
| --- | --- |
| Historical source matrix | The audited Windows source baseline passed 1,087 tests across two isolated batches. The audit's Linux run passed 1,047 with 40 Windows-only skips. Current source changes require their own checks. Full CSS diagnostics are tracked as inherited debt; the scoped Solcord CSS check does not certify every stylesheet |
| Discord-update fixture | A newer Discord version replaces the startup archive; the installer updates the receipt, restores injection, verifies the result, and preserves plugin, theme, and settings bytes |
| Installer | Embedded-resource self-test covers install, update, repair, rollback, interrupted recovery, downgrade refusal, and uninstall in isolated targets |
| Installed client | No public release-bound signed-in desktop acceptance record is linked by these package assets. The installer's local receipt describes installation ownership and recovery; it is not proof of live feature behavior |
| Private and experimental tools | Stay opt-in. Fake Deafen stays off until explicitly enabled and armed for a call |

Destructive installer lifecycle cases remain isolated from the signed-in owner profile. Call-dependent tools, Activities, account actions, and every Discord update remain separate live checks. Isolated tests do not stand in for those checks.

The [hosted checks](https://github.com/celubos/Solcord/actions/workflows/solcord-ci.yml) report the result for each commit. Future releases must compare their documented evidence names with the actual uploaded asset inventory and bind acceptance records to the reviewed source SHA and artifact digest before making a live-acceptance claim. The Windows installer remains unsigned. Earlier packages and their manifests are never relabeled or overwritten.

## Compatibility limits

- Discord internal APIs can change. Unsupported adapters stay inactive and report their status.
- On-device translation is available only where Discord exposes a compatible engine.
- External translation requires explicit provider configuration and disclosure.
- Audience Guard is detection-based, not per-viewer server access control.
- Private data uses encrypted account-scoped storage where available. Session-only fallback is labeled.
- Community addons retain their own compatibility and outbound-access requirements.
- Windows publisher warnings remain possible because the installer is unsigned.

## Historical results

[RC33 acceptance notes](archive/RC33_ACCEPTANCE.md), RC38 receipts, and older records are preserved. They describe the exact versions and conditions named there. They do not certify the stable package.

For current installation instructions, use [Quick start](QUICK_START.md). For live testing, use the [desktop checklist](development/DESKTOP_TESTING.md).
