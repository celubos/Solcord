# Using Solcord

Open Discord **User Settings**, then **Solcord Suite**. The Control Center uses one workspace list and one search field.

## Find a setting

| Workspace | Start here for |
| --- | --- |
| Overview | Current problems and a reminder to finish setup |
| Appearance & Accessibility | Theme, background, accent, density, motion, and reading controls |
| Performance | Lean, Balanced, or Visual profiles and optional diagnostics |
| Privacy & Safety | Tracking controls, Privacy Mode for screen sharing, link and file review |
| Chat & Composer | Writing tools, previews, translation, and media |
| Message History | Deleted and edited messages Solcord saw, with search, export, and erase |
| Voice & Activities | Call tools, audio, Activity Bridge, and Experimental features |
| Friends & Spaces | DM pins, server presentation, Focus Channels, and Friend Watch |
| Extensions | Existing addons, quarantine, and optional duplicate-plugin migration |
| Recovery | Setup, snapshots, Plugin Doctor, and installed build details |

To check the installed version, open **Recovery**, expand **About and technical information**, and read **Candidate** and **Source**.

## Themes and backgrounds

Choose a shell theme in **Appearance & Accessibility**. Only one Solcord theme is active at a time. Theme, density, accent, and background settings have separate controls.

For an animated background, select an effect and review the effective motion policy. **Lean**, reduced-motion preferences, or a less animated motion mode can stop ambient effects. Windows reduced motion takes priority. A saved effect is not necessarily a currently running effect.

Use a still background if motion distracts you. Reset appearance from the same workspace; do not delete your theme files to change a selection.

## Controls and saves

A switch changes a feature's requested state. Its nearby status explains whether the current Discord build can run it. A failed save restores the previous setting and reports the error.

Text fields preserve incomplete edits while you type. Where shown, use **Apply**, **Save**, or **Review** to finish a change. Number fields save when you leave the field or press Enter; a value outside the supported range is adjusted and the field says so.

If a change does not take effect, read the status before clicking again. Repeated clicks must not start duplicate actions.

## Feature states

- **Off:** disabled; no feature work should be running.
- **On / Active:** enabled and running.
- **Ready:** the implementation is available but may be idle or disabled.
- **Provider off / Needs setup:** an optional provider or required choice has not been configured.
- **Unavailable / Unsupported:** this Discord build does not expose a supported interface.
- **Degraded / Needs review:** a check failed or only part of the capability is protected.
- **Session-only:** the data cannot be durably encrypted and will not survive a restart.
- **Experimental:** additional risk and separate consent apply.

Consent, compatibility, enabled state, and storage durability are different facts. Enabling a feature does not waive its safety checks.

## Privacy-sensitive features

Friend Watch, Message History, private notes, Audience Guard, and experiments require their own opt-in. Check retention and clear/export controls before enabling history. [How Message History works](MESSAGE_HISTORY.md).

**Privacy Mode** (Privacy & Safety) hides server, channel, and DM names on your own screen before you share it. Turn on **Privacy Mode tools** first; then choose what to hide and use Ctrl + Alt + Shift + S to switch it on or off.

Audience Guard remains unarmed until you choose **Arm for this call**. It cannot prevent every frame from reaching a denied viewer. [Read its limits](STREAM_AUDIENCE_GUARD.md).

Translation providers are optional. Solcord does not silently choose a public server or send a conversation for translation. [Translation setup](TRANSLATION_DESK.md).

## Existing plugins

Solcord preserves your BetterDiscord plugins and settings. Do not enable a community plugin and its built-in replacement together just to bypass an unavailable state.

In **Extensions**, **Replace duplicate plugins** previews the exact source files and replacements. It archives eligible plugin source with rollback available; it does not erase plugin settings or private databases. Shared libraries stay while retained plugins still need them. [Migration details](V2_PLUGIN_MIGRATION.md).

## First Setup and recovery

First Setup can be deferred and resumed. Updates and repairs do not reset completed onboarding. Reopen setup through **Recovery** when you want to change the initial choices. After **Apply**, the result (or the reason it stopped) appears on **Overview**.

Use **Recovery** for settings snapshots. Use the installer for a core **Repair** or **Roll back**. These are different operations. [Troubleshooting](../SUPPORT.md) explains which one to use.
