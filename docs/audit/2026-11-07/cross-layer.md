# Packaging, networking, CI, and cross-layer findings

The evidence anchors refer to the audited commit. Run `bun docs/audit/2026-11-07/probes.cjs` from the repository root after a frozen install to reproduce the transport and package-metadata observations with synthetic values.


<a id="x01"></a>

### X01 · P1 · The catalog download can write outside the selected addon folder

[src/betterdiscord/modules/addonstore.ts:168](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/addonstore.ts#L168) takes `file_name` from the remote record. After the user chooses Install, line 267 joins it to the addon folder and writes the response. The preload performs the filesystem write at [src/electron/preload/api/filesystem.ts:19](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/electron/preload/api/filesystem.ts#L19). The UI's installed check looks in an addon list, which does not validate a destination. A malformed or compromised catalog record containing a parent segment can overwrite a writable file outside the plugin/theme directory. The same path can follow an existing link. A temporary marker confirmed the path resolution and write primitive. No production catalog compromise was observed. An enable request also persists state before the write succeeds (lines 253–267).

**Fix and verify.** Move the operation behind an owner-scoped file API. Share [src/electron/main/modules/solcord-setup.ts:106](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/electron/main/modules/solcord-setup.ts#L106) validation, enforce the expected suffix, reject reparse points, and use an exclusive staged write. Commit the enable state only after the file commits. Exercise Windows traversal, junctions, existing unrelated files, invalid metadata and disk-full failures through the actual store-install callback. Preserve ordinary community installs and their separate consent.


<a id="x02"></a>

### X02 · P1 · The legacy HTTP bridge forwards secrets across redirects

[src/electron/preload/api/https.ts:21](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/electron/preload/api/https.ts#L21) follows a redirect with the original options and copies every old query parameter into the new location. A mock 302 from one HTTPS origin to another delivered both the marker authorization header and the old query value to the second host. A POST can also replay its original body. Relative locations throw in the response callback, the chain has no hop limit, and intermediate bodies are not drained. This affects the legacy `request` interface and the store download at [src/betterdiscord/modules/addonstore.ts:241](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/addonstore.ts#L241). The newer native fetch implements separate redirect rules.

**Fix and verify.** Share a redirect policy across both transports while preserving callback and streaming behavior. Resolve relative locations, cap hops, drop sensitive headers on origin change, preserve only the destination query, and implement method/body rules for each redirect status. Drain or destroy abandoned responses. Run the two-origin marker probe, relative redirect, loop, aborted download and multipart replay cases against both interfaces.


<a id="x03"></a>

### X03 · P1 · Bridged downloads and uploads ignore consumer backpressure

[src/common/native-fetch.ts:65](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/common/native-fetch.ts#L65) reads in a loop inside `start`. It never forwards cancellation to the dried reader. [src/electron/preload/api/fetch.ts:46](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/electron/preload/api/fetch.ts#L46) puts the incoming Node stream into flowing mode, and line 151 ignores a false return from `request.write`. In a no-consumer probe, 128 × 64 KiB chunks plus EOF were read before the first consumer read. Cancelling a pending stream invoked its upstream cancellation hook zero times. Large or abandoned media transfers can keep sockets active and accumulate bytes in the preload or renderer.

**Fix and verify.** Read one chunk on demand, propagate cancellation and destroy the corresponding HTTP stream, and await `drain` on upload. Preserve redirect and abort handling. Test throttled readers/writers against a local server with a large file. Assert bounded queued bytes, early socket closure, and no reads after cancellation.


<a id="x04"></a>

### X04 · P1 · Hosted Windows CI omits the entire disposable-client preparation suite

[tests/solcord/disposable-acceptance.test.ts:30](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/tests/solcord/disposable-acceptance.test.ts#L30) gates the suite on Windows. All 40 cases skipped in the Linux run. The Windows job at [.github/workflows/solcord-ci.yml:80](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/.github/workflows/solcord-ci.yml#L80) names four other files. These cases cover refusing unsafe junctions, copy isolation, original injector identification and atomic destination races. The installer executable's self-test exercises a different implementation.

**Fix and verify.** Add this file to the Windows job or run the complete Windows suite. Require counts per platform and preserve the C# self-test. A test-only failure inside this specific suite must make the Windows check fail.


<a id="x05"></a>

### X05 · P2 · Production packaging trusts leftovers in the ignored build folder

[scripts/helpers/package.ts:9](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/scripts/helpers/package.ts#L9) accepts any existing JSON with the expected `name` and `main`. [scripts/pack.ts:63](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/scripts/pack.ts#L63) checks source provenance before packing current output bytes. On a clean checkout, adding `"type":"module"` to `dist/package.json` and running the real packer exited 0, changed the ASAR hash, and embedded the extra field alongside the CommonJS entry point. Independently modified output JS is also read at pack time. This directly affects local `dist`/separate build–pack use. The Windows installer builder clears `dist` and rebuilds at [scripts/build-solcord-v2-installer.mjs:50](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/scripts/build-solcord-v2-installer.mjs#L50).

**Fix and verify.** Write canonical package metadata unconditionally, build and pack from an owned empty staging directory, or bind the actual emitted bytes at build time and reject drift at pack time. Test stale extra keys, a modified preload, a failed partial build, and byte-identical consecutive clean builds.


<a id="x06"></a>

### X06 · P2 · The developer injector can report success with an unbootable Discord directory

[scripts/inject.ts:81](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/scripts/inject.ts#L81) accepts either a packaged `app.asar` or a loose `app` and renames the original. Line 122 always writes a shim requiring `../betterdiscord.app.asar`. On a temporary loose-app fixture the command exited 0 and printed success. The backup directory existed and the required archive did not. [src/electron/main/index.ts:48](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/electron/main/index.ts#L48) also assumes the archive.

**Fix and verify.** Resolve and persist the actual original entry at both layers, or reject unsupported layouts before the rename. Make the shim installation transactional. Test loose and packed targets, repeated injection, an interrupted write, and successfully loading the original entry. Test the developer path independently of the packaged Windows installer.


<a id="x07"></a>

### X07 · P2 · A quarter of the renderer is generated catalog data

On the production Linux build, esbuild attributed **448,061 of 1,839,523 renderer bytes** to [src/common/solcord/addon-catalog.generated.ts:4](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/common/solcord/addon-catalog.generated.ts#L4). The same input supplied **128,515 of 277,028 main-process bytes**. The generator embeds all 11 theme bodies at [scripts/build-solcord-runtime-catalog.cjs:206](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/scripts/build-solcord-runtime-catalog.cjs#L206) and the discovery index at line 211. [src/betterdiscord/modules/solcord/runtime.ts:1008](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/solcord/runtime.ts#L1008) uses catalog records for strict-mode decisions and line 2264 uses theme hashes for ownership. The renderer also statically imports the settings UI at [src/betterdiscord/modules/core.ts:32](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/core.ts#L32). These are measured byte contributions. The effect on live startup time needs a trace.

**Fix and verify.** Generate a compact synchronous trust/ownership index for early startup. Package the full browsing metadata and theme bodies as separate local assets and load them once on demand. Update the ASAR allowlist and checksum/provenance tests together. Keep strict-mode decisions available before addon activation, preserve offline First Setup and compare package bytes, first usable Discord frame, and first-open settings latency.


<a id="x08"></a>

### X08 · P2 · Callback filesystem APIs block the renderer and can call a consumer twice

[src/betterdiscord/polyfill/fs.ts:9](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/polyfill/fs.ts#L9) invokes synchronous preload operations and calls the callback inline inside the same try block. A callback exception triggers the catch, which calls the same callback again. `exists` at line 55 passes an error-first pair where Node callers expect a single boolean. [src/electron/preload/api/filesystem.ts:15](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/electron/preload/api/filesystem.ts#L15) confirms the underlying operations are synchronous. A plugin written to avoid main-thread I/O can still freeze chat or run side effects twice.

**Fix and verify.** Provide genuinely asynchronous bridges for callback APIs. Keep the public synchronous variants working. Move callback execution outside the filesystem catch, and match each callback's Node signature. Test ordering relative to the calling stack, callback count when it throws, `exists` for present and absent files, and renderer responsiveness on a slow read.


<a id="x09"></a>

### X09 · P2 · Updates can remove an unrelated pending item or expose a partial plugin

[src/betterdiscord/modules/updater.ts:233](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/updater.ts#L233) writes the response directly over the live file watched by [src/betterdiscord/modules/addonmanager.ts:115](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/addonmanager.ts#L115). It then splices the result of `indexOf` without checking for −1. Overlapping updates or a rescan during the fetch can remove another item's pending flag. The Update All notification at line 275 starts all operations without awaiting results. A truncated write can be observed by the watcher or destroy the previous working plugin.

**Fix and verify.** De-duplicate work by file, bound parallel downloads, verify destination, size, status and addon metadata, then stage and atomically replace. Recheck managed ownership before committing. Treat a missing pending entry as already resolved. Race Update All against a rescan, user edits, failed downloads and a watcher notification. Check every unrelated item and installed byte.


<a id="x10"></a>

### X10 · P2 · A media-key setting replaces unrelated Chromium flags

[src/electron/main/modules/betterdiscord.ts:299](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/electron/main/modules/betterdiscord.ts#L299) reads the existing `disable-features` switch but only uses it to decide whether to prepend a comma. With the setting enabled, any previously supplied feature names disappear when the new switch is applied. A playback preference can change unrelated Discord or launch-time behavior after restart.

**Fix and verify.** Parse the prior list and append the two media features uniquely. Exercise an empty list, pre-existing flags, duplicates, and ordinary hardware-button handling on the Windows client.


<a id="x11"></a>

### X11 · P2 · Browser acceptance can record the wrong layout and misses the shipping React tree

[tests/fixtures/solcord-control-center.html:162](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/tests/fixtures/solcord-control-center.html#L162) builds a parallel UI from HTML strings. Line 358 calls the geometry inspection immediately. In Chromium 153, 34/35 initial scenarios passed. In Workshop's 960 × 720 wizard, step 3 (“Appearance”) measured 135 px of content in a 124 px button. In three reruns the overflow cleared after fonts and the next frame. The result attribute kept the original failure. The visual fixture is outside the CI verify job.

**Fix and verify.** Stabilize font/layout timing, record first paint separately if transient clipping matters, and mount the production Control Center/wizard against deterministic store adapters for interaction checks. Include Tab-only use, Enter/Space, 320 px and 200% scaling, theme changes while open, and focus after validation errors. Verify First Setup on real WinForms/Discord separately. The observed failure describes fixture timing, not a persistent Windows screenshot defect.


<a id="x12"></a>

### X12 · P2 · The repository inventory excludes the largest custom runtime and the installer from custom totals

[scripts/audit-solcord-repository.mjs:15](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/scripts/audit-solcord-repository.mjs#L15) matches UI and an obsolete installer directory while omitting `src/betterdiscord/modules/solcord/` and `installer/Solcord.Installer/`. The generated report consequently counts the 4,691-line runtime and 2,221-line native suite in the whole-tree ranking but misses them in the custom ranking and signal counts. Lines 146–155 hardcode a circular-dependency classification. The `dpdm` invocation at [package.json:35](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/package.json#L35) exits successfully on cycles and never compares the reported graph to a baseline.

**Fix and verify.** Make ownership roots explicit, test the actual installer/runtime paths and compare normalized cycle edges against a reviewed baseline. Retain the existing 11 groups until individually changed. Adding a new Solcord cycle or an installer probe must visibly affect the intended gate.


<a id="x13"></a>

### X13 · P2 · The published release does not expose the acceptance evidence described by its status page

[docs/STATUS.md:20](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/docs/STATUS.md#L20) and line 27 point to a release manifest and receipt with exact installed-client and backup context. GitHub lists six attached v2.0.0 assets: an executable, ASAR, checksum list, build manifest, installer manifest and installer-build receipt. The installer-build receipt records a packaged self-test. The external `release-manifest.json` produced by the separate evidence assembler is absent from the release assets. This makes the stronger acceptance claim difficult to verify. The published checksum file also names the executable simply `SolcordInstaller.exe`, whereas [docs/QUICK_START.md:32](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/docs/QUICK_START.md#L32) directs first-time users to look for `installer/SolcordInstaller.exe`.

**Fix and verify.** Link an existing sanitized acceptance record by exact digest if available, or correct the status text to reflect what the published assets establish. For future releases, validate documented evidence names against uploaded assets and bind each to the reviewed SHA. Preserve private user/profile information. [Published v2.0.0 assets](https://github.com/celubos/Solcord/releases/tag/v2.0.0)


<a id="x14"></a>

### X14 · P3 · CI repeats expensive work and green checks conceal broader CSS debt

[.github/workflows/ci.yml:31](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/.github/workflows/ci.yml#L31) duplicates the test, lint, typecheck and ASAR build on the Linux V2 job for main/development and PRs. [package.json:22](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/package.json#L22) and [.github/workflows/solcord-ci.yml:32](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/.github/workflows/solcord-ci.yml#L32) limit the required CSS check to two files. The separate full CSS command exited nonzero, reporting 197 errors and 27 warnings in its first invocation. Many are style conventions. Its second glob is behind `&&`, so the count is a lower bound for the configured command and says nothing about the count of visible defects.

**Fix and verify.** Reuse the Linux build and outputs while preserving required check names, Windows policy jobs, and artifact consumers. Establish a reviewed CSS baseline and require changed maintained styles to pass. Test a new invalid nested stylesheet and compare actual runner minutes per PR.


<a id="x15"></a>

### X15 · P3 · Installed tooling and public scripts disagree

[package.json:33](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/package.json#L33) calls `jsdoc`. Running `bun run api` after the frozen install failed with `Script not found "jsdoc"`. ESLint is listed in regular dependencies, while TypeScript and Happy DOM are used directly but supplied transitively ([scripts/types.ts:6](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/scripts/types.ts#L6) and [scripts/soak-solcord-backend.ts:5](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/scripts/soak-solcord-backend.ts#L5)). Monaco occupies approximately 101 MiB in the developer install here. The editor uses its version/types and downloads implementation code from a CDN. These are developer-install bytes, not 101 MiB in the ASAR.

**Fix and verify.** Decide whether the API generator is supported, wire a TS-aware pinned generator with a real empty-checkout smoke test or retire the command. Declare directly used tooling, move lint-only dependencies to development, and coordinate any Monaco packaging changes with offline/editor security work. Compare frozen-install and ASAR sizes separately.


<a id="x16"></a>

### X16 · P3 · Locale export can replace a working translation with a failed download

[scripts/translations.ts:20](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/scripts/translations.ts#L20) accumulates response bytes without a status check, error handler, size limit or timeout. Lines 87–95 write the raw response, substituting an empty object for an empty response. Line 107 passes only the path from the export URL and drops its query. An expired or signed URL, HTTP error page, or unmapped language can leave a partially refreshed locale set, including invalid JSON consumed at build time.

**Fix and verify.** Preserve the full export URL, enforce response bounds/status, validate JSON and known locale IDs, and publish validated files atomically. Mock a signed URL, a 403/HTML response, unknown language and aborted transfer. Check that existing translations survive every failure.


<a id="x17"></a>

### X17 · P3 · Dead compatibility UI and duplicate policy metadata cost maintenance time

The production module graph has no reference to [src/betterdiscord/ui/settings/sidebarheader.tsx:12](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/ui/settings/sidebarheader.tsx#L12). The only reference to `AddonStore.isOfficial` at [src/betterdiscord/modules/addonstore.ts:505](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/addonstore.ts#L505) is commented-out JSX. [src/betterdiscord/ui/solcord/catalog.ts:107](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/ui/solcord/catalog.ts#L107) maintains a separate unused optional-addon list beside the generated records. The Activity handshake classifier and baseline-capability descriptor have synthetic test consumers, with no production import in the seven-entry build. Type-only contracts legitimately disappear at runtime.

**Fix and verify.** Remove confirmed private unused UI and its orphan styles following a symbol/class search. Make tests for claimed runtime behavior cross the actual adapter. Keep intentional design fixtures or compatibility contracts with an explicit owner. Preserve BdApi, upstream import contracts and first-party identifiers. Recheck bundle output before assigning any download-size saving.


<a id="x18"></a>

### X18 · P3 · Release tooling scales with files and repeatedly reads the full installer

[scripts/assemble-solcord-release-evidence.mjs:634](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/scripts/assemble-solcord-release-evidence.mjs#L634) starts a Git process per tracked blob (625 at the audited SHA), writes a temporary file for each, then rereads them for the deterministic archive. [scripts/build-solcord-v2-installer.mjs:28](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/scripts/build-solcord-v2-installer.mjs#L28) reads each input into a single buffer and lines 189–195 rehash the installer for checksums and receipt. The published executable is 163,937,829 bytes versus a 2,159,378-byte ASAR. The self-contained Windows runtime is a deliberate installation requirement.

**Fix and verify.** Batch `git cat-file` and stream large hashes while preserving immutable blob IDs, source-drift checks, canonical ZIP order and self-test evidence. Benchmark packaging wall time/peak RSS and compare artifact hashes. Separately benchmark single-file compression for installer download bytes, cold extraction and launch before changing its distribution format.


<a id="x19"></a>

### X19 · P3 · The candidate-review downloader enforces its byte ceiling after allocation

[scripts/review-solcord-candidates.cjs:29](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/scripts/review-solcord-candidates.cjs#L29) checks the Content-Length hint, then buffers the entire body before enforcing the limit on actual bytes. A chunked or stalled source can exhaust memory or stall the review process. This is a maintainer-run ingestion script.

**Fix and verify.** Count bytes while reading, cancel once over the cap, and use a deadline. Test a chunked body without Content-Length, a false length, slow responses, and a valid payload at the boundary. Preserve exact-byte hashing for accepted records.


<a id="x20"></a>

### X20 · P2 · Embed Controls repeatedly performs a quadratic scan of loaded messages

[src/betterdiscord/modules/solcord/baseline-suite.ts:96](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/solcord/baseline-suite.ts#L96) tests every verified embed against every other embed to find outermost roots. Line 317 scans the whole document from a coalesced mutation callback. In a headless Chromium fixture using the production resolver, 50, 200, 500 and 1,000 sibling embeds caused **2,450 / 39,800 / 249,500 / 999,000** calls to `Node.contains`. Median uninstrumented scan times over nine runs were approximately **0.2 / 1.4 / 7.5 / 29.8 ms** on this host. The last exceeds a 60 Hz frame interval before other Discord work. Large fixtures demonstrate scaling, not the typical number of mounted Discord embeds.

**Fix and verify.** Discover candidates from affected message subtrees, coalesce invalidations, then use one ancestor traversal or document-order stack to discard nested verified roots. Keep structural validation, cleanup of detached controls and exactly one button per outermost embed. Repeat sibling, nested and unrelated-DOM mutation cases; compare operation count as well as median/p95 frame time.


<a id="x21"></a>

### X21 · P2 · A recycled voice-message row can download the previous person's attachment

[src/betterdiscord/modules/solcord/native-suite.ts:1393](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/solcord/native-suite.ts#L1393) skips a voice container as soon as it has a Solcord download link. The shared observer at line 2158 watches child changes and the `datetime` attribute. In a Happy DOM run of the shipping controller, changing a retained audio node from `first.webm` to `second.webm` and triggering a further DOM mutation left the anchor targeting `first.webm`. Line 1400 suggests `voice-message.ogg` even for a WebM resource. This affects the user's download action while the player itself can already be playing the new source.

**Fix and verify.** Bind the link to the current audio element and revalidate its current URL on reuse and on action. Remove the link for a newly unsupported source; retain the existing HTTPS/CDN allowlist. Derive the suggested extension from validated media information. In a virtualized row test, change both attachment and signed URL, replace or remove the source and disable the feature. Verify the user gets the file they see.


<a id="x22"></a>

### X22 · P2 · Audio Console shows a made-up starting volume in its confirmation

[src/betterdiscord/ui/solcord/panel.tsx:652](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/ui/solcord/panel.tsx#L652) always passes 100 as the current participant volume and includes it in the displayed confirmation. [src/common/solcord/v2-feature-models.ts:276](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/common/solcord/v2-feature-models.ts#L276) stores that caller-supplied value. The actual adapter discovered at [src/betterdiscord/modules/solcord/runtime.ts:2857](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/solcord/runtime.ts#L2857) supplies a setter. For someone already at 35%, the dialog still says the change begins at 100%.

**Fix and verify.** Use a validated current-volume getter or display just the target when the present value is unknown. Keep call/participant and action-ownership checks at confirmation. Test a non-default volume and a participant leaving while the dialog is open.


<a id="x23"></a>

### X23 · P3 · The changelog video player chooses its embed mode by substring

[src/betterdiscord/ui/modals/changelog.tsx:38](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/ui/modals/changelog.tsx#L38) grants iframe capabilities including autoplay, clipboard writing and web sharing. Line 49 selects that path whenever the entire URL contains `youtube.com`. An unrelated host or a query containing that text gets a YouTube-labeled iframe. This is reachable through the public changelog API at [src/betterdiscord/api/ui.ts:199](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/api/ui.ts#L199). The checked-in changelog has its video disabled. The issue concerns addon-supplied changelogs and future product announcements.

**Fix and verify.** Parse the URL, validate HTTPS hosts and embed paths, and grant only the capabilities required by supported video playback. Keep legitimate direct media in the native video element. Render a real embed URL, an unrelated origin with a matching query, a lookalike hostname and a direct MP4. Verify keyboard play/pause, full screen and modal-close behavior.
