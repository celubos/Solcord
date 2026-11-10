# Help and troubleshooting

Use the [installation guide](docs/QUICK_START.md) for a first install. The published download and development source are listed separately in [Release status](docs/STATUS.md).

## Common problems

### The installer does not list Discord

Open the official Discord desktop app once and let it finish updating. Quit it, then reopen Solcord Setup. Choose the installation you actually use under **Version**. The browser version of Discord is not an install target.

### The installer cannot finish an update

Save drafts and leave calls. The installer closes processes verified as belonging to Discord because Stable, PTB, and Canary share Solcord's core. It stops if a process or file cannot be safely verified.

Quit Discord from its system-tray menu, then retry the same installer action once. If the error persists, keep the error text and recovery folder. Do not delete the BetterDiscord data directory or disable Windows security.

### Discord will not open after a change

Open the verified installer and choose **Roll back**. It restores the receipt-bound backup of the previous core and injector. Choose **Open Solcord** after recovery succeeds.

If rollback reports a mismatch, stop and report the exact error. Do not overwrite files manually or pick a random backup.

### The new version is not showing

Open **Solcord Suite**, then **Recovery** and **About and technical information**. Check **Candidate** and **Source** against the release you installed.

A GitHub merge does not update your installed client. Download the intended release, verify it, and use **Update Solcord**. **Repair** reinstalls the package you opened; it does not fetch a newer version.

### A switch or feature does not work

Read its status and inspect **Recovery > Plugin Doctor**. A Discord update can change a feature's internal interface. An unavailable adapter stays inactive instead of patching an unknown target.

If safe for your session, disable a potentially conflicting community plugin or theme and retest. Do not stack an old plugin over its built-in replacement or remove private data as a troubleshooting shortcut.

### An animated background is still

Check the selected effect, effective motion policy, performance profile, and Windows reduced-motion preference. Lean and reduced-motion settings can intentionally suppress ambient effects.

### Translation is not active

No external provider is selected by default. On-device translation needs a compatible engine in the installed Discord build and a supported language pair. DeepL or LibreTranslate needs an explicit provider choice and, where required, a credential. [Translation guide](docs/TRANSLATION_DESK.md).

### A private feature says session-only

Windows encryption is unavailable for that store. Solcord does not substitute plaintext persistence. Data may work for the session but will not survive a restart. Keep the status visible and do not assume it was saved.

## Report a bug

[Open a bug report](https://github.com/celubos/Solcord/issues/new?template=BUG-REPORT.yml) with:

- Solcord candidate and source commit;
- Discord Stable, PTB, or Canary and its app version;
- Windows version and display scaling;
- the workspace or installer action;
- exact steps, expected result, and actual result;
- relevant enabled plugins or themes.

Crop screenshots to the problem. Remove tokens, account identifiers, server names, private messages, personal file paths, and other people's content. Do not upload raw logs or private databases.

For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of posting sensitive details in a public issue.

## Removing Solcord

Choose **Uninstall** in Solcord Setup. Plugins, themes, settings, private stores, and recovery files remain. It is not a data wipe. [Recovery details](docs/INSTALL_AND_ROLLBACK.md).
