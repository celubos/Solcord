# Audit remediation candidate

Implementation branch: `sol/audit-remediation-20261107`. Audit handoff: `9550a432a7a178473d152cdcc44efba3d74c4048`; audited product: `9b3004ff8c25c9879803a6c07fa8b28d04731438`. The implementation identifies itself as **v2.0.1-rc.3**, distinct from the published stable package. No release has been published by this work.

## Findings and regression coverage

The following dispositions describe implementation and local fixtures. They do not claim signed-in desktop, microphone, participant-volume, or subjective visual acceptance.

| Findings | Change and independent regression evidence |
|---|---|
| I01 | Main-process-bound editor sessions; no document-selected path, remote bridge or remote loader. Hostile-document/subframe and outside-marker tests exercise the real editor authority handler. |
| I02 | Preserve CSP on unrelated documents, subframes and report-only headers. Only trusted Discord main documents gain local packaged asset sources and the required blob worker source. |
| I03–I04 | Single-flight off-thread engine operations, responsive UI/close guards, selected-target verification and launch. Native message-pump and target-selection tests. |
| I05–I07 | Prior receipt/launcher restoration, verified staging before mutation, durable uninstall recovery. Separate child processes exit at seven transitions; fresh-process recovery verifies retained bytes. |
| I08–I09 | Explicit single-channel ownership protects the shared core; identical verified repairs create no extra backups. Both channel orders and twenty-repair tests. |
| R01–R02 | Owned bounded startup/connection waits with retry and complete listener finalization. Actual Core startup tests cover privacy/integrity gates, retry and concurrent calls. |
| R03–R04 | Deduplicated cache snapshots and per-entry addon filesystem failures. Valid neighbors continue without weakening activation policy. |
| R05 | Local version-matched Monaco; deadlines, rejection, late-result ownership and retry. Actual loader failures plus offline packaged asset checks. |
| R06–R08 | Visible-only tooltip observers, idempotent teardown, current-store subscriptions and single direction classes. Lifecycle/rebinding tests. |
| F01 | Acknowledge only the message IDs captured in the reviewed preview; replacement-account/selection guards remain. |
| F02 | Coalesced genuine asynchronous interactive settings writes with atomic commit and failure rollback. Critical setup/recovery transactions retain synchronous durability and reject overlapping writers. |
| F03–F04 | Affected-subtree DOM invalidation and visible-result caps before expensive enrichment. Unrelated mutations and bounded result tests. |
| F05–F06 | Shared byte/count limits, acknowledged chunk queues, retry, export completeness and immutable author identity. Actual encrypted 100/101/250-event restart tests and excluded-author partial-edit tests. |
| F07–F08 | Recording generations, early microphone-track release, bounded preview work and no full PCM decoding for long recordings. A-cancel/B-start late decode regression and bounded sample tests. |
| F09–F12 | Batched replay, bounded retention cleanup, display changes without capture restart, stable immutable selector views. 10k-record, fake-clock, account and identity tests. |
| F13–F14 | One policy read per account and script-aware translation comparison. One hundred concurrent reads and distinct-script tests. |
| X01 | Anchored addon writes validate kind/name/link ownership, stage exclusively, serialize competing updates and verify unchanged bytes. Traversal, junction, parent-swap and concurrent stale-update fixtures. |
| X02–X03 | Shared redirect policy, no cross-origin credentials or inherited query, bounded redirect/body rules, demand-driven response reads, upload drain and cancellation propagation. Real loopback servers verify socket closure, canceled pipes and secret confinement. |
| X04 | Windows CI includes disposable-client preparation and process-restart recovery, separately from installer self-test. |
| X05 | Canonical package metadata and compilation-time output digests reject stale/modified ignored outputs and incomplete build inventories. |
| X06 | Transactional developer injection for supported packed layouts; reject loose layouts before mutation. |
| X07 | Small early trust index; full catalog and Monaco are local assets loaded on demand. Expanded ASAR entries are validated against exact pinned source assets. Offline packaging grows to include editor resources; renderer startup no longer imports full browsing metadata/theme bodies. |
| X08 | Genuine asynchronous callback filesystem bridges, single callbacks outside I/O catches, Node-style boolean exists and binary/encoded read signatures, and real lstat. |
| X09–X10 | Bounded deduplicated atomic addon updates, awaited Update All, preserved existing Chromium feature flags. Races, rescan and failed transfer tests. |
| X11 | Font/layout-settled measurements and production First Setup React behavior tests. All 35 controlled Chromium geometry scenarios passed; these remain separate from live Discord. |
| X12–X15 | Correct custom ownership roots, reviewed cycle-edge gate, explicit full CSS debt baseline, consolidated CI, truthful release evidence and supported direct developer tools. |
| X16–X19 | Bounded/transactional locale ingestion, removed confirmed private dead code, batched immutable Git blob collection and streaming hashes, bounded/cancellable candidate downloads. Accepted archive bytes remain identical in before/after probes. |
| X20 | Linear outermost embed selection and scoped invalidation. One thousand sibling embeds use zero DOM containment calls, versus 999,000 in the audited resolver. |
| X21–X23 | Revalidate recycled voice downloads at action time, avoid invented current-volume claims, and use exact constrained/consent-gated video origins. Actual controller/React fixtures. |

## Additional desktop and privacy corrections

The published package fails on the observed Discord 1.0.9267 / Electron 44.10.0 client in a rewritten `libdiscore` module: `i.A is not a constructor`. A controlled disposable copy reproduced it. Current Rspack supplies direct value exports as the third argument of its export helper; the old wrapper discarded them. The candidate preserves those exports and selects the active Rspack queue. A causal fixture constructs the logger through the shipping early hook and checks that renderer discovery uses that same runtime. The narrow upstream adaptation is recorded in the provenance registry.

Live RC1 acceptance reached Discord's login and signed-in client, then exposed a second pre-Core error: ContextMenu discovery called the runtime with an undefined module ID. RC2 broadens the exact parser-associated Rspack factory shape and fails closed when optional menu discovery is missing or throws. Actual import tests cover both legacy/Rspack results and absent, mismatched or throwing modules. One-argument CSS factories also retain their aliases. A renderer initialization failure now shows a dismissible notice instead of silently omitting Solcord.

RC3 adds source-driven startup recovery before further desktop acceptance. A malformed webpack cache cannot abort imports; throwing optional exports are skipped without disabling valid neighboring modules. Missing Discord adapters are retried instead of memoized permanently. Commands and settings navigation report availability and own partial-patch cleanup. Required React APIs gate injection, and optional rendering integrations cannot abort the core during module evaluation. A document-owned native watchdog reports a bootstrap that never reaches injection.

Settings navigation retains one document-owned arrival listener after its bounded startup attempts expire, so opening Discord settings later can still install the Solcord entry. Successful registration and document unload remove that listener. Local recovery dialogs mount on demand with explicit readiness, keyboard focus containment and cleanup; missing native transition or animation modules no longer hide their content. The optional CSS-message integration has a deadline, cancellation and transactional patch cleanup.

Login beyond the initial 30-second deadline now enters a waiting state and resumes once the account is ready. A connection event alone cannot release startup before account hydration. The bounded wait and late-login observer retire pollers, abort handlers and exact dispatcher subscriptions, including reentrant aborts during host calls. Optional integration failures report degraded startup; privacy and integrity remain prerequisites for community addon activation. Retrying idempotent settings/command integrations does not repeat addon activation.

Native storage prerequisites validate every required directory. Missing parents are created under the established data root; blocking files are preserved. An irrecoverable storage error holds Solcord activation and shows repair feedback while allowing the original Discord bootstrap to proceed with the native privacy guard. Compatibility settings reject malformed document shapes and require an explicit boolean for an unrestricted preload override. Native browser-window IPC settles on manual close and handles load rejection. Privacy configuration reads use a bounded descriptor rather than a stat/read race.

Strict Privacy now rejects contradictory persisted allow flags. Legacy settings without an explicit privacy receipt start strict. An early native guard blocks recognized optional science/track and Sentry store/envelope requests, independently of renderer adapter discovery. Generic addon IPC cannot grant new permissions: only a durable explicit choice may relax the guard, while strengthening is immediate even if renderer cleanup fails. The editor and bundled catalog require no remote fetch. Request diagnostics omit authorization, query values and response content.

These controls do not establish zero traffic or anonymity. Core Discord authentication, messages, voice and media still reach Discord. Native crash reporting, arbitrary privileged Node networking, unknown future endpoints and untrusted software running as the same Windows account are outside complete coverage. See [Privacy and security](../../SECURITY_AND_PRIVACY.md).

## Acceptance boundary

Integrated verification and exact candidate package checks are recorded for each build. Live desktop startup, actual local editor behavior under CSP, signed-in Control Center use, real recording/playback and interactive rollback must be reported separately from unit tests, browser fixtures and native disposable self-tests. No skipped or unobserved path is a pass. The existing broader CSS diagnostics and reviewed dependency cycles remain explicit debt rather than a claim of a perfect codebase.
