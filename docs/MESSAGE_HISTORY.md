# Message History (deleted and edited messages)

Message History keeps a private copy of messages Solcord sees, so you can still read one after someone deletes or edits it. It is off until you turn it on.

Open Discord **User Settings**, choose **Open Solcord Suite**, then **Message History**. You can also type "deleted" or "edited" in the settings search.

## What it saves

- Messages in **direct messages and group DMs** that Discord shows to this running client while Message History is on.
- **Server channels only if you add them one at a time.** Open the channel in Discord, return to Message History, open **What gets saved**, and choose **Add the open server channel**.
- **Text only** by default. You can choose **Text and attachment names**; attachment files themselves are never saved.
- Edits, deletions, bulk deletions, and ghost pings (a message that mentioned you and was deleted or edited to remove the mention).

It cannot:

- recover messages that were deleted before Solcord saw them;
- read hidden channels or fetch older history from Discord;
- see messages while Discord is closed or Message History is off.

## Reading your history

The list starts on **Deleted & edited**. The other filters are **Deleted**, **Edited**, **Ghost pings**, and **Everything saved**. Each shows a count.

- **Search** matches message text, earlier versions, names, and attachment names.
- **Conversation** can narrow the list to the DM or channel open behind the settings window.
- **Order** shows newest or oldest activity first.
- Each entry shows who wrote it, where it was posted (resolved from Discord at the time you look; names are not stored), when Solcord first saw it, and when it was deleted or last edited.
- **Show earlier versions** lists every saved version with the time each version was first seen.
- **Open conversation** closes settings and opens the conversation near that message.

The list loads 50 entries at a time; choose **Show more** to continue.

## Where it is stored

| Situation | Storage |
| --- | --- |
| Normal | Only on this computer, under the Solcord data folder in `solcord-timeline-v1`. Each saved event is encrypted with AES-256-GCM. The key is protected by your operating system's secure storage through Electron safeStorage (Windows DPAPI or the macOS Keychain). Each Discord account has its own separate store. |
| **Keep history for: Until Discord closes** | Memory only, by your choice. Nothing is written to disk. |
| Secure storage unavailable | Memory only. Message History says so, and nothing unencrypted is written to disk. History is erased when Discord closes. |

Nothing is uploaded. Saved messages never appear in Solcord diagnostics, settings exports, or logs.

## How long it is kept

- Each message is kept for the selected period **after Solcord first saw it**: 1, 7 (default), 30, or 90 days, or until you erase it.
- Expiry keeps running while Message History is turned off.
- At most **10,000 saved events per account** (about 32 MB). When that is reached, the oldest are removed first. This limit keeps every restart and export complete.

## Turning it off, exporting, and erasing

- **Turn off:** switch off **Save deleted and edited messages**. Nothing new is saved and the list is hidden. History saved earlier stays encrypted on this computer until it expires or you erase it.
- **Export:** **Export or erase › Export…**, then **Export file**. This saves readable JSON through Discord's download prompt. It includes message text, edit history, and channel and message identifiers, so keep it private. If any part of the saved history cannot be read, no file is written and the reason is shown.
- **Erase:** **Export or erase › Erase history…**, then **Erase permanently**. This deletes the current account's saved history from this computer. It cannot be undone. If Solcord finds encrypted stores it can no longer match to an account (for example after the system key was reset), it asks separately before erasing those.

Uninstalling Solcord does not erase Message History. Erase it first if you want it gone.

## Switching Discord accounts

Each Discord account has its own isolated history. When you switch accounts, the previous account's messages leave the list before anything from the new account is loaded, and events from one account are never saved into another.

## Settings

Under **What gets saved**:

- **Keep history for** — retention period.
- **Save** — text only, or text and attachment names.
- **Versions shown per message** — how many earlier versions each entry lists.
- **Skip** switches — your own messages, bots, blocked users, muted channels, muted servers, and age-restricted channels.
- **Always save direct messages, even when muted.**
- **Always keep messages that mentioned me** — keeps ghost pings even from skipped authors.
- **Show bulk-deleted messages.**
