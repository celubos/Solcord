# Solcord feature runtime

Scope includes the production renderer, common feature models, native storage and the Control Center. Runtime dependencies were mocked for the voice, storage, language and retention probes.

### F01 · P1 · Mark as Read can acknowledge a newer message than the user reviewed

[src/betterdiscord/modules/solcord/runtime.ts:3039–3047](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/solcord/runtime.ts#L3039-L3047) resolves the latest message ID again when a reviewed bulk acknowledgment executes.

A message arriving after review can be marked read without the user ever seeing it.

**Fix and verify.** Capture the per-channel message ID in the review snapshot and acknowledge only through that ID. Test with message A present at confirmation and B arriving before execution. B must remain unread.

### F02 · P2 · Small settings edits synchronously clone and rewrite the entire store

[src/betterdiscord/modules/solcord/store.ts:1062–1088](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/solcord/store.ts#L1062-L1088) clones the whole document for rollback, clones again on the save path, serializes with indentation, and writes and renames synchronously on the renderer thread.

A small frequent edit pays the cost of the full persisted data set, blocking input and paint. Larger stores and slower disks increase the stall.

**Fix and verify.** Coalesce writes by revision, serialize outside the interactive path, and keep atomic replacement and failure recovery. Test rapid updates with slow and failing writes, restart after flush, and verify the latest acknowledged revision survives. Profile event-loop latency on large fixtures.

### F03 · P2 · Unrelated mutations wake every enabled DOM synchronizer

[src/betterdiscord/modules/solcord/native-suite.ts:2150–2161](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/solcord/native-suite.ts#L2150-L2161) observes body mutations and schedules the registered synchronizers together. Several use document-wide selectors at lines 1037, 1053, 1072, 1248, 1267, 1391 and 1537.

Unrelated Discord DOM churn can drive repeated whole-document searches by independent features. Frame coalescing still permits one batch every frame during continuous scrolling or updates.

**Fix and verify.** Route mutation records to relevant enabled features, scope searches to changed roots, and gate the broader pass on navigation or root replacement. Instrument synchronizer and selector invocation counts while scrolling, then check route changes and toggling each feature.

### F04 · P2 · Relationship enrichment precedes the visible result cap

[src/betterdiscord/modules/solcord/runtime.ts:2945–2970](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/solcord/runtime.ts#L2945-L2970) resolves presence, relationship age and mutual guild details for each accepted relationship before applying `.slice(0, 1000)`.

Opening or refreshing a large relationship list pays for rows that cannot be displayed.

**Fix and verify.** Preserve ordering and filtering semantics, apply the cap before enrichment when equivalent, and compute expensive details on demand. Use more than 1,000 records and spy on detail lookups, verifying the same visible identities and order.

### F05 · P1 · Timeline accepts a seed the native store rejects

Timeline applies an entire batch before forwarding it at [src/betterdiscord/modules/solcord/runtime.ts:4556–4578](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/solcord/runtime.ts#L4556-L4578). The channel seed marks the channel as seeded, then takes up to 250 messages at lines 4616–4621. Bulk dispatch accepts up to 500 IDs at `src/betterdiscord/modules/solcord/message-timeline.ts:50–51,163–168`. Main storage accepts at most 100 events, 96 KiB per event and 4 MiB per append at `src/electron/main/modules/solcord-timeline.ts:42–46,117,130–138`.

With 101 previously unjournaled messages in one seed, the renderer shows all 101 but the entire append fails. Export reads main storage at `runtime.ts:1556–1579` and can report a complete export which excludes this batch. The seed has already been marked done.

**Fix and verify.** Share serialized size and count limits, split batches in deterministic order, and track unacknowledged chunks. Surface retry or incomplete-export state. Test 100/101 and 250 records, bulk deletes with seeds, large UTF-8 content, and a failing second chunk. A Bun 1.4.0 isolated probe with the real journal and storage, mock Electron and an empty session reproduced 101 renderer records, 0 stored, and “Timeline append contains an invalid event batch.”

### F06 · P1 · Partial edits can defeat ignored-author filters

A content-only edit has no author at [src/betterdiscord/modules/solcord/message-timeline.ts:176–198](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/solcord/message-timeline.ts#L176-L198). Ignore-self/bot/blocked checks at [src/betterdiscord/modules/solcord/runtime.ts:4537–4543](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/solcord/runtime.ts#L4537-L4543) operate on those absent fields. Lines 4580–4603 try to seed from the message cache, then convert the edit to a fresh create if seeding failed, including when the seed was rejected by the user's filters.

A previously excluded blocked-user or bot message can enter the account's private journal and export following an edit. The issue does not require a mention override.

**Fix and verify.** Resolve the best-known author and channel identity before applying policy. Distinguish a cache miss from a policy rejection. When required filter fields cannot be resolved, drop or defer the event. Test an excluded create followed by a content-only edit, both with and without a cached original.

### F07 · P1 · A canceled recording can take over the next voice-note preview

During stop, Voice Note Studio clears the stop watchdog, creates the Blob/URL, awaits analysis without checking its recording generation afterwards, and only releases microphone tracks in the finalizer at [src/betterdiscord/modules/solcord/native-suite.ts:834–868](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/solcord/native-suite.ts#L834-L868). Cancel allows a new recording at lines 926–938. The shared preview model uses a single recording boolean at [src/common/solcord/v2-feature-models.ts:314–336](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/common/solcord/v2-feature-models.ts#L314-L336).

Cancel A during decode and immediately start B. A's late continuation attaches its canceled preview to B's active state. B then fails to create its own preview. Tracks stay live through decode unless an independent cancel runs.

**Fix and verify.** Release tracks when the stop event fires, tag analysis and callback results with recording identity, check it after every await, and bound the duration of analysis. A Bun probe using the native controller and delayed fake decode returned zero track stops during analysis, returned canceled A with an undefined URL, then rejected B with “No user-started recording is active.” Include this exact sequence and disable/account-switch variants in the suite.

### F08 · P2 · Voice waveform analysis decodes and scans the whole recording

Voice analysis decodes the entire Blob and walks every channel sample synchronously to compute up to 256 peaks at [src/betterdiscord/modules/solcord/native-suite.ts:192–221](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/solcord/native-suite.ts#L192-L221). Ten minutes and 25 MiB of compressed audio are accepted at [src/common/solcord/v2-feature-models.ts:302–303](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/common/solcord/v2-feature-models.ts#L302-L303).

At 48 kHz, ten minutes of stereo produce 57.6 million samples and about 220 MiB of float PCM alone. The JS loops run in the renderer. This is a fixture-size calculation, not a measured RAM peak.

**Fix and verify.** Accumulate peaks incrementally during recording, downsample in a worker or bound the samples visited. Verify input latency, maximum heap and equivalent peaks on silence, short recordings and a ten-minute synthetic recording.

### F09 · P1 · Timeline replay repeatedly scans all retained records

Journal hydration replays each event through `apply`; each successful non-session event scans every current message for retention at `src/betterdiscord/modules/solcord/message-timeline.ts:307–318,372–382`. The main read path admits up to 10,000 events at [src/electron/main/modules/solcord-timeline.ts:45–46](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/electron/main/modules/solcord-timeline.ts#L45-L46).

Replay of N distinct retained creates performs approximately N(N+1)/2 expiry checks on the renderer. With a single synthetic Node v24.22.1 run using short messages, 1k/2k/4k/8k creates took 20/26/75/230 ms. Device frame times remain unmeasured.

**Fix and verify.** Make expiry incremental with an ordered expiry index or replay in bulk with equivalent ordered pruning. Maintain status counters rather than scanning again on every batch. Compare real outputs for edits and out-of-order timestamps. Benchmark the 10k event reader cap.

### F10 · P1 · Quiet channels keep expired messages visible

Journal expiry runs only after an accepted event at [src/betterdiscord/modules/solcord/message-timeline.ts:372–382](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/solcord/message-timeline.ts#L372-L382). Display getters at [src/betterdiscord/modules/solcord/runtime.ts:812–817](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/solcord/runtime.ts#L812-L817) return the journal immediately. The 5-second timer calls account activation, which returns early on unchanged identity at lines 4480,4661.

Expired message content stays visible in an idle Timeline after its configured retention deadline. In a direct fake-clock test, a 24-hour policy still returned its one message after the clock advanced beyond 24 hours without traffic.

**Fix and verify.** Prune at read or scheduled deadline as appropriate, publish removals, and align the view and disk retention boundary. Test an idle open panel and reopen without new dispatch.

### F11 · P1 · A display preference can interrupt message capture

Timeline presentation controls write capture policy at [src/betterdiscord/ui/solcord/timeline.tsx:88–97](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/ui/solcord/timeline.tsx#L88-L97). Every policy change stops/restarts the adapter at `src/betterdiscord/modules/solcord/runtime.ts:864–867,3331–3350`, clears the journal at lines 4662–4672, then drops dispatch while encrypted state is loading at lines 4482–4489,4507–4519,4556–4562.

Changing sort direction, visible counts or the maximum displayed edits repeatedly reloads disk and rehydrates history. A live edit or delete during reload can be lost, especially outside the selected channel.

**Fix and verify.** Separate presentation-only settings from capture scope, subscription, and retention. For changes requiring reload, buffer bounded events tagged with account generation, then replay. Test a nonselected-channel delete during a delayed read and verify sort/order changes cause zero storage reads.

### F12 · P2 · Control Center selectors repeat full-state work on unrelated events

`src/betterdiscord/ui/hooks.ts:8,50–57` reruns subscribed factories per store emission and compares by reference. [src/betterdiscord/modules/solcord/store.ts:749–751](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/solcord/store.ts#L749-L751) deep-clones the entire document. `src/betterdiscord/ui/solcord/panel.tsx:421–424,463–467,1284–1289,1553–1556` select small subsections or construct fresh objects after cloning. The Timeline panel additionally sorts and clones history at [src/betterdiscord/ui/solcord/timeline.tsx:31–36](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/ui/solcord/timeline.tsx#L31-L36) and [src/betterdiscord/modules/solcord/message-timeline.ts:395–401](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/solcord/message-timeline.ts#L395-L401). Timeline health emits twice per batch via `src/betterdiscord/modules/solcord/runtime.ts:4467–4474,4682–4686`.

While a workspace is open, unrelated runtime changes can repeatedly copy settings, sort and copy visible entries, and rerender controls whose data is unchanged. React batching can merge paint, but synchronous selector work already happened twice.

**Fix and verify.** Expose stable per-slice snapshots or revisions and granular subscriptions. Return previous references for unchanged slices, and emit once per journal batch. Verify selector counts and commits while messages arrive, irrespective of the visible workspace.

### F13 · P2 · Audience Guard can queue duplicate policy reads while loading

Audience Guard subscribes to multiple user, streaming and voice Flux stores at `src/betterdiscord/modules/solcord/runtime.ts:4058–4079,4089–4099,4119–4122`. During a policy read, `#audiencePolicyAccountId` is explicitly undefined until resolution (4169–4181). Each unrelated change during that window starts another read and invalidates the previous generation. All share the same serialized capability queue (688–696).

Busy voice updates and slow storage can enqueue redundant reads, indefinitely postpone readiness until an event gap, and delay unrelated private Timeline, notes or setup operations.

**Fix and verify.** Coalesce loads by account and generation, set a separate pending account before starting the read, and invalidate only on actual identity changes or disposal. With one suspended read, fire 100 unchanged-identity voice updates and assert a single read, then switch accounts and prove the old result cannot publish.

### F14 · P2 · Translation treats distinct scripts as the same language

The local language comparator drops all subtags at [src/betterdiscord/modules/solcord/local-translation.ts:93–95](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/solcord/local-translation.ts#L93-L95). Availability reports ready and translation returns original text without invoking the provider at lines 219–222 and 345–350.

Script-distinct languages such as simplified and traditional Chinese are presented as successfully converted even when no conversion took place. The factory stub recorded zero calls for `zh-Hans → zh-Hant` and returned the unchanged input alongside an “available” status.

**Fix and verify.** Only short-circuit equivalent canonical language tags. Consult the provider or report unsupported for script/variant changes. Test identical tags, case normalization and different scripts.
