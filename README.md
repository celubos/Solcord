<img src="assets/branding/solcord-mark.svg" width="64" height="64" alt="">

# Solcord

A BetterDiscord fork for Windows, with a built-in Control Center, local privacy tools, full-shell themes, and reversible installation.

**[Download for Windows](https://github.com/celubos/Solcord/releases/tag/v2.0.0)** · [Installation](docs/QUICK_START.md) · [User guide](docs/USER_GUIDE.md) · [Get help](SUPPORT.md)

## Install

You need **Windows x64** and the official **Discord desktop app**. You do not need Git, Bun, .NET, plugin libraries, or a separate BetterDiscord installation.

1. Download **SolcordInstaller.exe** and **SHA256SUMS.txt** from the [same release](https://github.com/celubos/Solcord/releases/tag/v2.0.0). [Check the download](docs/QUICK_START.md#check-the-download).
2. Save your drafts and leave any calls. The installer closes verified Discord processes before changing its shared core.
3. Open the installer. Under **Version**, select your Discord installation, then choose **Install Solcord** or **Update Solcord**.
4. Choose **Open Solcord**. On a fresh installation, First Setup opens when Discord is ready. You can complete it now or choose **Finish later**.

Installation takes about one minute on a typical PC **after download**. Your existing Discord login, plugins, themes, and settings stay in place.

> [!IMPORTANT]
> **Solcord 2.0 — Signal** is a stable but unsigned release. Windows may show an unknown-publisher warning. Do not disable Windows security to install it. [Release status](docs/STATUS.md)

If a Discord desktop update makes Solcord disappear, open the current installer and choose **Update Solcord**. If you are already on the same Solcord release, choose **Repair Solcord**. Both paths keep plugins, themes, settings, and private stores in place.

## What Solcord adds

| Area | Features |
| --- | --- |
| Appearance | Eleven shell themes, animated backgrounds, density, accents, and reduced-motion controls |
| Chat | Character count, timestamps, reply shortcuts, message splitting, loaded-message previews, and Media Shelf |
| Voice | Call context, volume controls, Voice Note Studio, connection diagnostics, and Activity Bridge |
| Friends and servers | DM pins, local server aliases, hidden-server controls, Focus Channels, and optional private notes |
| Privacy | Strict Privacy controls, Link Lens, attachment metadata review, Stream Shield, and optional Audience Guard |
| Recovery | Plugin Doctor, addon quarantine, settings snapshots, setup rollback, and installer recovery |

Open Discord **User Settings**, then **Solcord Suite**. Search for a tool or browse its workspace. See the [user guide](docs/USER_GUIDE.md) for motion settings, feature states, and plugin migration.

Features that depend on Discord internals verify compatibility before starting. An unavailable adapter stays off; selecting a setting does not bypass that check. [Current status and limits](docs/STATUS.md)

## Privacy and compatibility

Private history, Audience Guard, and experimental tools are opt-in. Private stores are account-scoped; the interface distinguishes encrypted storage from session-only storage. Translation providers require an explicit choice before text leaves Discord.

Solcord does not provide end-to-end encryption for ordinary Discord messages, reveal hidden channels, backfill unseen messages, or guarantee zero tracking. Audience Guard can prevent or stop a stream after detecting a denied viewer; it cannot provide per-person stream access control.

[Privacy guide](docs/SECURITY_AND_PRIVACY.md) · [Audience Guard](docs/STREAM_AUDIENCE_GUARD.md) · [Security reports](SECURITY.md)

## Update or recover

Use the installer for the release you want:

- **Update** installs a newer core and keeps a rollback point.
- **Repair** reinstalls the package you opened; it does not download an update.
- **Roll back** restores the verified backup from the previous core change.
- **Uninstall** removes Solcord while retaining plugins, themes, settings, private stores, and backups.

**Verify files** checks the installed package. **Open recovery folder** shows its receipts and backups. Uninstall is not a private-data wipe. [Installation and recovery details](docs/INSTALL_AND_ROLLBACK.md)

## Documentation and development

Start with the [documentation index](docs/README.md). Installation, daily use, development, and historical records are kept separate.

Contributors need Git and **Bun 1.4.0**. Building the Windows installer also requires the **.NET 8 SDK**.

```sh
git clone --branch main https://github.com/celubos/Solcord.git
cd Solcord
bun install --frozen-lockfile
bun run verify
bun run dist
```

Production packaging requires a clean checkout. For changes in progress, use `bun run build`; it does not install Solcord or restart Discord. [Contributing](CONTRIBUTING.md) explains testing, repository layout, and release checks.

## License and credit

Solcord is maintained by [@celubos](https://github.com/celubos) and forked from [BetterDiscord](https://github.com/BetterDiscord/BetterDiscord). Upstream history, contributors, Apache-2.0 licensing, public `BdApi`, addon paths, and compatibility identifiers are preserved.

This is an independent project, not an official Discord or BetterDiscord release. See [LICENSE](LICENSE), [NOTICE](NOTICE), and the [third-party provenance registry](docs/PROVENANCE_REGISTRY.md).
