# Privacy and security

Solcord runs inside the Discord desktop client. It cannot make Discord anonymous, add end-to-end encryption to ordinary messages, or control what Discord's servers retain.

## Defaults

Strict Privacy is the default for fresh installs. Optional private history, external providers, and account-risk experiments remain off until separately enabled.

Legacy profiles without a recorded privacy choice also start with Strict Privacy while awaiting review. A Strict profile cannot retain contradictory allow flags from an older settings file. Standard or custom permissions require an explicit saved choice.

Privacy controls target specific optional surfaces such as analytics, optional reporting, and activity discovery. Core sign-in, chat, voice, media, moderation, safety, and client security updates must continue to work. Solcord does not use a blanket network block.

## Read the status

- **Protected:** the adapter verified and applied its supported policy.
- **Needs review:** a choice or outbound-access decision is required.
- **Degraded:** part of the intended protection could not be verified.
- **Unsupported:** the current client exposes no supported path.

Protected refers to the category shown, not all Discord traffic. Discord's account-side privacy preferences remain separate settings.

## Local data

Friend Watch, Message Timeline, Audience Guard, and private notes are opt-in and account-scoped. Retention is bounded. Use each feature's clear or export controls deliberately.

Where durable private storage is promised, Solcord uses Electron's secure storage. If encryption is unavailable, the interface reports **session-only** or holds the affected feature. It does not silently persist private data as plaintext.

Portable settings exports exclude private history, denied-user identifiers, provider credentials, and consent acknowledgements. A private feature's own export may still contain sensitive or pseudonymous data; review it before sharing.

## Network access

Solcord update and catalog checks are manual by default. Optional providers and community addons have separate outbound-access choices. Quarantined or unapproved code must not run merely because its source file is present.

Solcord has no analytics collection service. Catalog metadata, bundled themes and the editor implementation are available from local packaged assets; opening the editor does not require a CDN request. Downloading a community addon or checking for updates remains an explicit network action.

The native request guard blocks the recognized Discord science/track endpoints and optional Sentry store/envelope endpoints under Strict Privacy before renderer adapters are discovered. Renderer adapters separately target supported analytics, reporting and activity-discovery methods. Only a durably saved privacy choice can relax the guard; a generic addon IPC call cannot grant these permissions. The guard does not collect request bodies, authorization headers, query values or private content for diagnostics.

This is data minimization, not zero traffic to Discord. Login, messages, attachments, voice, calls and required client/security traffic still reach Discord and its infrastructure. Unknown future endpoints, privileged Node networking, native crash reporting and independently installed third-party code are outside the request guard's complete coverage. Adapter status and actual network observations must be checked for each supported client version. Optional controls cannot establish anonymity or guarantee zero telemetry.

Both native HTTP interfaces strip authentication and cookies when a redirect changes origin, retain only the destination query, reject insecure redirects and bound redirect chains. Cancellation closes upstream resources, and streaming readers and writers apply backpressure. Request errors must not log headers or private response bodies.

DeepL and LibreTranslate require an explicit provider choice and disclosure of the text being sent. On-device translation is available only when the installed client exposes a compatible engine. [Translation details](TRANSLATION_DESK.md).

Diagnostics retain bounded operational information. Privacy-policy receipts are content-free: category, decision, coarse time, and result. Do not publish raw Discord logs, private databases, or screenshots of conversations.

## Streaming, voice, and history

Audience Guard can prevent or stop a stream after a denied user is detected. It cannot guarantee per-person blocking or zero-frame exposure. [Audience Guard limits](STREAM_AUDIENCE_GUARD.md).

Voice Note Studio requires explicit recording, preview, and send or save actions. It does not record or upload automatically.

Message Timeline observes only events already available to the running client after opt-in. It does not fetch unseen or deleted history, import another logger's private database, or reveal hidden channels. Friend Watch does not claim to know who blocked whom.

## Installation and recovery

The installer verifies the selected Discord installation, package, and rollback backup. It preserves plugins, themes, settings, and private stores. Uninstall removes the core and injector; it is not a private-data wipe.

A self-contained unsigned installer is not a signed or stable release. Use this repository's downloads, compare hashes, and never disable Windows security as an installation step.

A disposable profile separates files and Discord state, but it still shares the Windows account's security boundary. Use a separate standard Windows account when a stronger isolation boundary is needed.

Addon installs and updates validate filenames under their selected root and stage content before publication. They reject linked paths, stale overwrite digests and concurrent stale updates. A hostile process with the same Windows account's filesystem rights is not isolated by JavaScript path checks; this API is not an operating-system sandbox.

## Reports and technical detail

Report sensitive vulnerabilities through the process in [SECURITY.md](../SECURITY.md). Use [Support](../SUPPORT.md) for ordinary bugs.

The [security architecture](development/SECURITY_ARCHITECTURE.md) documents IPC, storage, addon, updater, and installer safeguards together with historical source-review records. Those records are not evidence that every newer build passed live acceptance.
