# Solcord quick start

Use this guide for the **Solcord 2.0.1** Windows installer. Mac users should read the separate [macOS preview guide](MACOS.md).

Allow about one minute on a typical PC **after download**. Windows prompts, Discord shutdown, or recovery can take longer.

## Before you start

- Use Windows x64 with the official Discord desktop app installed.
- Open ordinary Discord at least once so it can finish installing.
- You do not need to install Bun, Git, .NET, plugin libraries, or BetterDiscord separately.
- Save unfinished drafts and leave voice/video calls before continuing.

> [!WARNING]
> This build is unsigned. Windows may show an unknown-publisher warning. Download only from `celubos/Solcord`, compare the hash below, and do not disable Windows security to install it.

## 1. Download

Download both files into the same folder:

- [SolcordInstaller.exe](https://github.com/celubos/Solcord/releases/download/v2.0.1/SolcordInstaller.exe)
- [SHA256SUMS.txt](https://github.com/celubos/Solcord/releases/download/v2.0.1/SHA256SUMS.txt)

### Check the download

Open PowerShell in your download folder and run:

```powershell
Get-FileHash .\SolcordInstaller.exe -Algorithm SHA256
```

Compare the result with the `SolcordInstaller.exe` line in **SHA256SUMS.txt** from the same release. Do not run a file whose hash differs. **RELEASE-SHA256SUMS.txt** additionally covers every Windows and Mac release attachment.

## 2. Save anything in progress

Solcord's core is shared by Discord Stable, PTB, and Canary. When changing that core, the installer closes running Discord processes whose executable paths it verifies, including another installed channel. It does not close unrelated applications. If a process cannot be verified or stopped, installation stops with an error.

## 3. Install

Open **SolcordInstaller.exe**. In **Discord app**, choose the Discord installation you use. The version is detected from your PC, not fixed by this guide. Choose **Refresh** or press **F5** after installing or updating Discord. Actions stay disabled while Setup checks the selected app.

Choose the large recommended action. It will say **Install Solcord**, **Update Solcord**, or **Repair Solcord** according to the files on your PC. Wait for the verified success status. Do not move or delete recovery files while an action is running.

## 4. Verify and launch

Select **Verify files**. When the installed files match the package, choose **Open Solcord**. This launches your existing Discord installation; you do not need a separate account or a new Discord profile.

## 5. Complete First Setup

A fresh installation opens **Solcord Suite** at **Welcome** once Discord is ready. Follow Welcome, Privacy, Appearance, Features, and Review and Apply.

To open settings later, open Discord **User Settings**, scroll to the bottom of the sidebar, and click **Open Solcord Suite**. This entry opens an independent Control Center even when Discord changes its own settings layout.

**Back** keeps the draft. **Finish later** saves your place without applying the proposed choices. Existing completed profiles do not reopen setup after an update or repair. To reopen it manually, open **Solcord Suite**, choose **Recovery**, then choose **First Setup**.

Recommended first check:

1. Choose a theme and leave optional private/history features off until you need them.
2. Try one built-in at a time in its matching workspace.
3. Open **Recovery**, then **Plugin Doctor**, if a tool reports a problem.
4. Leave Experimental tools off. Audience Guard stays unarmed until you explicitly arm it for a call.

Translation is optional. On-device translation requires a compatible engine in your Discord build and a supported language pair. DeepL and LibreTranslate need an explicit provider choice and may require a credential; no remote provider is silently selected.

## Updating

Download the new release's installer and checksum file, verify the download, and choose **Update Solcord**. Plugins, themes, settings, and private stores remain in place. **Repair** reinstalls the exact package you opened; it does not download an update.

## Recovery

| Problem | Next step |
| --- | --- |
| Discord does not appear in Discord app | Open the official desktop app once, quit it, then choose **Refresh** in Setup. |
| Discord cannot close | Quit it from the Windows system tray, then retry. The installer will not guess at an unverified process. |
| Files are missing or damaged | Run the same package and choose **Repair**. |
| Setup reports an error | Choose **Error details** for the complete local error and recovery path. Nothing is uploaded automatically. |
| Discord updated and Solcord disappeared | Open the newest installer. Choose **Update Solcord**, or **Repair Solcord** if that exact release is already recorded. |
| The new core will not start | Use **Roll back** to restore the verified pre-change backup. |
| A feature says Unavailable | Check Plugin Doctor; the current Discord build may not support that adapter. |
| A background is not moving | In Appearance, select a background rather than Signal or Off. Check the effective motion policy; Lean and reduced motion stop ambient animation. |

**Open recovery folder** shows local backups and receipts. Do not delete `%APPDATA%\BetterDiscord`, plugins, themes, Custom CSS, or private databases to troubleshoot.

## Removing Solcord

Choose **Uninstall** in the installer. It removes the core/injector and keeps plugins, themes, settings, private stores, and backups. This is deliberately not a data-wipe action.

For manual recovery and backup details, read [Install and rollback](INSTALL_AND_ROLLBACK.md).
