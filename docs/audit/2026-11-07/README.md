# Solcord audit and Codex handoff

**Audited source** [celubos/Solcord at 9b3004f](https://github.com/celubos/Solcord/tree/9b3004ff8c25c9879803a6c07fa8b28d04731438), the main-branch revision targeted by [v2.0.0](https://github.com/celubos/Solcord/releases/tag/v2.0.0). Audited November 7, 2026, US Central. All code anchors in this handoff refer to that revision. The handoff includes review material, diagnostic probes and the repository's regenerated document inventory.

This pass records **54 prioritized findings**. The file ledger and bundle attribution refer to the original 625-file tree. GitHub changed the repository owner name during the audit; the repository ID (1343091147), owner account ID and audited main-branch commit were rechecked at the current address.

## Fix order

| Order | Work item | Closure evidence |
|---|---|---|
| 1 | **Confine privileged writes and redirects.** I01–I02 and X01–X02 cover editor document authority, session-wide CSP removal, store destinations, and legacy HTTP credentials. | A hostile-location editor fixture gets no bridge. Traversal and links cannot escape the selected root. Two origin servers confirm secrets stay at the first origin. Real editor, theme and media workflows still work. |
| 2 | **Make install and recovery transactional across channels.** I03–I09 and X04–X06 cover UI-thread blocking, target identity, crash recovery, rollback receipts, developer injection and the missing Windows tests. | Hard-exit the installer at every filesystem transition. Relaunch, restore and verify Stable and Canary independently. Confirm progress keeps painting during process waits. |
| 3 | **Make privacy and user-confirmed actions survive races.** F01, F05–F07 and F10–F11 cover acknowledgments, batch persistence, author exclusions, retention and capturing a replacement voice recording. | An unseen new message stays unread, excluded authors stay excluded after partial edits, 101/250-event batches survive reload, and canceling recording A cannot change B. |
| 4 | **Stop work that scales with everything already loaded.** X03, X20, F02–F04, F08–F09 and F12–F13 cover backpressure, full-DOM scans, sync saves, journal replay, waveform decoding and repeated selectors. | Repeat the synthetic scaling probes. Add Windows traces for scroll, UI input, transfer cancellation, account changes and settings activity under message load. |
| 5 | **Repair daily UX and startup failure handling.** R01–R05, X09–X11 and X21–X23 cover editing, reconnects, stale addons, voice downloads, volume confirmation and media keys. | Exercise the actual React components and desktop client, including stale rows, clipboard/editor interactions, keyboard focus, multiple windows and a CDN outage. |
| 6 | **Reduce package and maintenance costs.** Start with X07, then X12–X19 and F14. Split behind measured boundaries and preserve the small early trust index needed by privacy policy. | Compare cold startup and first settings-open time as well as bytes. Commit reproducible bundle attribution, honest CI gates and release evidence. |

**Priority convention.** P1 items can compromise private data, leave an installation unbootable, corrupt durable state, or break a core path. P2 items have material effects on responsiveness, correctness or maintenance under identifiable conditions. P3 items are lower-impact workflow and polish fixes. Priorities reflect consequence as well as how often the trigger is expected to occur.


## What to open

| File | Use |
|---|---|
| [Prioritized finding register](findings.md) | All findings grouped by severity, with direct links to fixes and regression checks |
| [Installer and Electron](installer.md) | WinForms, launch, backups and rollback, main/preload and native trust boundaries |
| [Renderer and compatibility APIs](renderer.md) | Startup, webpack, addon lifecycle, UI and editor |
| [Solcord feature runtime](features.md) | Feature state, account-bound actions, persistence and DOM subscriptions |
| [Cross-layer findings](cross-layer.md) | Download, streaming, player controls, package size, build integrity and CI |
| [File coverage](file-coverage.csv) | Every tracked path at the audited SHA, Git blob, direct check, and production-entry bytes where available |
| [Measurements](measurements.json) · [Reproduction probes](probes.cjs) | Re-run evidence and compare the same workloads after implementation |

## Evidence and boundaries

All **625 tracked Git blobs** were inventoried and independently matched to the pinned tree by byte count and Git object hash. The audit includes 337 source files, 109 test/support files, 59 assets, 49 documents, 29 scripts, eight installer files and the remaining configuration, workflows and root files. The file ledger describes the kind of check each received. Findings come from source tracing, production bundle analysis, test execution and targeted reproductions. Inventory membership alone does not establish runtime correctness.

| Check | Result at the audited revision |
|---|---|
| Linux x64, pinned Bun 1.4.0, frozen dependencies | `bun run verify` succeeded. Two batches gave 1,047 passes, 40 Windows-only skips, zero failures, 7,335 assertions. Typecheck, lint, scoped CSS lint, type generation, inventory and local documentation-link checks passed. Eleven dependency cycles were reported. |
| Production package | `bun run dist` succeeded. Local ASAR 2,159,045 bytes; published ASAR 2,159,378 bytes. Use each artifact's own digest. The release targets Windows. This run used Linux and did not establish cross-platform byte identity. |
| Browser fixtures | Evaluated the repository's 35 scenarios in headless Chromium 153.0.8010.0 using the same fixture URLs, viewport sizes and page-emitted measurements. Initially 34 passed. Workshop's wizard measured the Appearance button before layout settled. Its overflow cleared in 3/3 reruns after font readiness and the next animation frame. |
| Resource soak | 60.0 seconds, 2,250 synthetic lifecycle cycles, zero recorded failures, up to 26 owned resources, final reported heap growth 3,657,316 bytes. The harness used Happy DOM and executed zero live Discord adapters. |
| Extra probes | Reproduced credential forwarding across origins, eager stream consumption, missing upstream cancellation, acceptance of stale package metadata, a dangling developer-injection shim, an obsolete voice-download link and quadratic embed scanning. The full CSS command and API-doc generation failed outside the default verify gate. |
| Hosted evidence | The exact revision passed the Linux compatibility workflow and both jobs in the V2 workflow, including the Windows installer build/self-test. [Compatibility CI](https://github.com/celubos/Solcord/actions/runs/40235787620) · [V2 CI](https://github.com/celubos/Solcord/actions/runs/40235787608) |
| Interactive coverage | No signed-in Discord session, live voice call, Windows GUI interaction, OS media-key session, or real installer rollback was run during this audit. Headless fixture geometry and synthetic timing describe those environments only. |

**Player scope.** Discord owns the underlying audio/video player. Solcord ships a local volume control, voice-note download/capture UI, embed controls, host media-key integration and a changelog media component. `BetterMediaPlayer` is an optional third-party catalog record with `runtimeStatus: PENDING` and `installable: false`. The review covers the integration and first-party code. Independently installed third-party player code and Discord's own implementation are outside this Git tree.

## Codex implementation contract

Use a new implementation branch from the current target and compare it with the audited SHA before editing. Preserve the BdApi surface, addon identifiers and paths, settings migrations, offline setup, user-controlled audio actions, keyboard navigation and recoverability. Prefer one focused change and a causal regression test per defect. Couple changes only where a single invariant spans a boundary, such as a confirmed preview plus its eventual native action.

1. For filesystem and recovery changes, test partial writes, a process restart between stages, failure after each rename, multiple installed channels, pre-existing files and reparse points. Assert the previous core, injector, receipt and user's addons remain mutually consistent.
2. For networking, use local fake endpoints. Record redirect destinations/header sets and maximum outstanding bytes with slow readers and writers. Exercise callback-style addons and the fetch-style API. Assert connection teardown on cancellation.
3. For renderer changes, capture matched before/after traces on the same Discord/Electron build, profile and addon set. Record cold startup to a usable conversation, settings first-open and warm reopen, input-to-paint p50/p95, long tasks, and frame times during scroll/playback. Repeat with Solcord disabled, enabled at defaults, and only the changed feature enabled. Bundle bytes and synthetic timings are starting evidence.
4. Test lifetime changes across at least 50 open/close or enable/disable cycles, a channel switch, a full renderer reload and an account change. Inspect listener, timer, observer, DOM-node and native-handle ownership, plus retained heap after GC. Keep private text, attachment URLs and credentials out of captured diagnostics.
5. Verify media with two different loaded attachments and participants at non-default volume. Test keyboard-only setup and recovery, Windows scaling at 100/125/150/200%, reduced motion and narrow windows. Attach sanitized, SHA-bound results for real Windows/Discord acceptance before closing those items.

**Re-run locally** using the repository-pinned Bun. Start with `bun install --frozen-lockfile`, `bun run verify` and `bun run dist` on a clean implementation commit. Run `bun docs/audit/2026-11-07/probes.cjs` for baseline observations. The probe prints measurements and deliberately exits successfully on the audited defects; promote them to failing expectations in the implementation PRs.
