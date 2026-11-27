# Install, update, and recover

For a first installation, follow [Quick start](QUICK_START.md). Use the verified installer from the release you intend to install.

## Choose the right action

| Action | Use it when | What stays in place |
| --- | --- | --- |
| Install Solcord | This Discord installation has no Solcord core | Your existing Discord profile and addon data |
| Update Solcord | You downloaded a newer release | Plugins, themes, settings, private stores, and a rollback point |
| Repair | This exact package is missing or damaged | Existing user data |
| Roll back | The last core change caused a problem | User data; the recorded prior core and injector are restored |
| Turn Solcord back on | Discord updated and Solcord is off | Everything; this is Repair (same release) or Update (newer release) for the new Discord version |
| Uninstall | You want to remove Solcord | Plugins, themes, settings, private stores, and recovery files |
| Check files | You want to check the installed package | Everything; this checks files without replacing them |
| Open backups folder | You need the receipts or backups | Everything |

Repair does not download a newer Solcord release. Rollback uses the backup recorded by the installer; it does not install an arbitrary older release. A normal update refuses a downgrade.

## When Discord updates itself

Discord installs each update in a new `app-<version>` folder, usually in the background while it is running, and deletes the old folder later. While Discord runs, Solcord checks once a minute for a new folder and copies its startup loader into it once the new files have stopped changing for a minute; it tries again when Discord quits. If that cannot finish, the new folder is left as ordinary Discord and nothing breaks. Result codes (no paths or content) go to `%APPDATA%\BetterDiscord\data\updater.log`.

If Discord updated while Solcord was not running, the new version starts without Solcord. Opening Discord from the **Solcord** Start menu entry fixes this automatically when Discord is closed: it turns Solcord back on, then opens Discord. It never closes a running Discord.

The installer records the Discord version it installed into. After a Discord update it shows **Solcord is off** and recommends **Turn Solcord back on**, which runs:

- **Repair Solcord** if you are running the same Solcord release, or
- **Update Solcord** if you opened a newer release.

Either one moves Solcord's record to the current Discord version. Until then, **Uninstall** and a first-install **Roll back** refuse with "Discord updated to … Choose Repair Solcord first". This prevents removing the core while the new Discord version still loads it, which would stop Discord from starting. Nothing is changed when they refuse.

If Discord has already removed the version Solcord recorded, the installer says so and asks for **Repair** or **Update** in the same way.

## Solcord Setup stays on your PC

After a successful install, update, repair or rollback, Setup copies itself to `%LOCALAPPDATA%\Solcord\Setup\SolcordSetup.exe`, adds **Solcord Setup** to the Start menu, and registers **Solcord** in **Settings → Apps → Installed apps** for your Windows user only (no administrator rights). **Uninstall** there opens Setup with Uninstall selected. Uninstalling Solcord removes the copy and both entries; only entries Setup itself created are removed.

An older installer opened over a newer installation says **Newer version installed** and changes nothing.

## Before changing the core

1. Save unfinished drafts and leave calls.
2. Compare the installer checksum with **SHA256SUMS.txt** from the same release.
3. Keep the current recovery folder until you have checked the new installation.
4. Select the Discord installation you actually use under **Discord app**.

Stable, PTB, and Canary share Solcord's core. If Discord is running, the installer asks before closing it, because closing ends any call or upload in progress. It then requests graceful shutdown of verified Discord processes and stops verified remaining processes if necessary. It refuses to continue if shutdown cannot be safely completed. It does not kill unrelated applications by name.

The installer is unsigned. Review Windows prompts yourself and do not disable Windows security.

## Update or repair

Open the installer, choose **Update Solcord** or **Repair**, and wait for the verified result. Use **Check files** if you like, then **Open Discord**.

The installer launches your existing Discord installation. It does not create a new account or sign you out. Updates and repairs preserve completed First Setup.

## Recover a failed change

1. Reopen the same verified installer.
2. Read the error and choose **Roll back** when available.
3. Let it validate and restore the recorded backup.
4. Use **Check files** if applicable, then **Open Discord** after recovery succeeds.

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
| `%APPDATA%\BetterDiscord\solcord-timeline-v1` | Encrypted Message History, one opaque store per Discord account |
| `%APPDATA%\BetterDiscord\solcord-installer` | Installation receipts and rollback backups |
| `%LOCALAPPDATA%\Solcord\Setup\SolcordSetup.exe` | Setup's own copy, opened by **Solcord Setup** and Settings → Apps |

Uninstall is not a private-data wipe. The installer does not erase addon configuration, Custom CSS, Message History, translation credentials, or provider archives. To remove Message History, use **Erase history** in Solcord before uninstalling ([details](MESSAGE_HISTORY.md)).

## Acceptance and limitations

Each release lists its installer, checksums, and the acceptance evidence that applies to it. New source changes need their own package and evidence; see [Release status](STATUS.md).

The core and injector are separate files. Their verified replacements are recoverable through receipts, not one atomic filesystem operation. Keep backups through a successful restart.

Developers can find preparation, disposable-profile, build, and interruption details in [Installer architecture](development/INSTALLER_ARCHITECTURE.md).
