# Install, update, and recover

For a first installation, follow [Quick start](QUICK_START.md). Use the verified installer from the release you intend to install.

## Choose the right action

| Action | Use it when | What stays in place |
| --- | --- | --- |
| Install Solcord | This Discord installation has no Solcord core | Your existing Discord profile and addon data |
| Update Solcord | You downloaded a newer release | Plugins, themes, settings, private stores, and a rollback point |
| Repair | This exact package is missing or damaged | Existing user data |
| Roll back | The last core change caused a problem | User data; the recorded prior core and injector are restored |
| Uninstall | You want to remove Solcord | Plugins, themes, settings, private stores, and recovery files |
| Verify files | You want to check the installed package | Everything; this checks files without replacing them |
| Open recovery folder | You need the receipts or backups | Everything |

Repair also restores the startup handoff when a Discord desktop update replaces it. Repair does not download a newer Solcord release. Rollback uses the backup recorded by the installer; it does not install an arbitrary older release. A normal update refuses a downgrade.

## Before changing the core

1. Save unfinished drafts and leave calls.
2. Compare the installer checksum with **SHA256SUMS.txt** from the same release.
3. Keep the current recovery folder until you have checked the new installation.
4. Select the Discord entry you actually use under **Version**.

Stable, PTB, and Canary share Solcord's core. The installer requests graceful shutdown of verified Discord processes, then stops verified remaining processes if necessary. It refuses to continue if shutdown cannot be safely completed. It does not kill unrelated applications by name.

The installer is unsigned. Review Windows prompts yourself and do not disable Windows security.

## Update or repair

Open the installer, choose **Update Solcord** or **Repair**, and wait for the verified result. Use **Verify files**, then **Open Solcord**.

The installer launches your existing Discord installation. It does not create a new account or sign you out. Updates and repairs preserve completed First Setup.

## Recover a failed change

1. Reopen the same verified installer.
2. Read the error and choose **Roll back** when available.
3. Let it validate and restore the recorded backup.
4. Use **Verify files** if applicable, then **Open Solcord** after recovery succeeds.

An interrupted operation retains a recovery receipt. Recovery can resume only when the current files match recognized candidate or backup states. If a file changed unexpectedly, the installer stops instead of overwriting it.

Do not delete a pending receipt, choose a random backup directory, or replace files by hand. Keep the exact error for a [bug report](../SUPPORT.md).

## Settings rollback is separate

Inside Solcord, **Recovery** restores settings snapshots and setup choices. In **Extensions**, provider rollback restores eligible plugin source from a migration archive.

These do not replace the installed core. If Discord cannot open, use installer rollback first. Existing settings and migration records remain available afterward.

## Where files live

| Location | Contents |
| --- | --- |
| `%APPDATA%\BetterDiscord\data\betterdiscord.asar` | Installed Solcord core; the filename is retained for injector compatibility |
| `%APPDATA%\BetterDiscord\plugins` | Community plugin source and configuration |
| `%APPDATA%\BetterDiscord\themes` | Community themes |
| `%APPDATA%\BetterDiscord\data` | Settings and local feature data |
| `%APPDATA%\BetterDiscord\solcord-installer` | Installation receipts and rollback backups |

Uninstall is not a private-data wipe. The installer does not erase addon configuration, Custom CSS, message history stores, translation credentials, or provider archives.

## Acceptance and limitations

The current installer is [RC39](https://github.com/celubos/Solcord/releases/tag/v2.0.0-rc.39). New source changes need their own package and acceptance evidence; see [Release status](STATUS.md).

The core and injector are separate files. Their verified replacements are recoverable through receipts, not one atomic filesystem operation. Keep backups through a successful restart.

Developers can find preparation, disposable-profile, build, and interruption details in [Installer architecture](development/INSTALLER_ARCHITECTURE.md).
