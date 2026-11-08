# Renderer, UI and compatibility APIs

### R01 · P1 · Startup can wait forever on a missing connection dispatcher

[src/betterdiscord/modules/core.ts:44](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/core.ts#L44) latches `hasStarted` before any awaited work. At line 144, an absent current user and an unavailable dispatcher leave a promise with no resolver or retry. When the dispatcher exists, the callback remains subscribed after resolving. Startup never reaches normal plugin activation, final loading-icon removal or readiness feedback on the missing-dispatcher path. An exception earlier in startup also leaves the latch set.

**Fix and verify.** Give the connection wait a lifecycle owner, retry discovery or show a recoverable degraded state, unsubscribe on every exit, and distinguish starting, ready and failed state. Keep integrity and privacy prerequisites ahead of addon activation. Test late dispatcher discovery, no connection, duplicate reconnects and a retry after initialization failure.

### R02 · P2 · Lazy webpack lookups retain completed filters on long-lived abort signals

[src/betterdiscord/webpack/lazy.ts:125](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/webpack/lazy.ts#L125) registers an abort handler and a listener for future module arrivals. Success removes the module listener but leaves the abort listener on its signal. The closure can retain the filter and captured plugin state until the controller aborts or becomes collectible. An abort in the transition from the initial lookup to listener registration also needs an immediate `signal.aborted` check.

**Fix and verify.** Share one finalizer between success and cancellation, detach both listeners and recheck the signal when registering. Reuse a single controller across many successful lookups and assert listener counts return to baseline. Test an abort precisely between the first search and late registration.

### R03 · P2 · Disk cache fallback can duplicate store cards indefinitely

[src/betterdiscord/modules/addonstore.ts:423](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/addonstore.ts#L423) appends cached entries to the existing `addons` list. It runs at startup, on store re-enablement and on request failure. A successful network refresh resets the list at line 637, but fallback at line 665 does not. Re-enabling while offline or repeating failures can append the same objects, inflating row counts and React filtering/pagination work. The process-wide addon map also retains objects removed from later snapshots.

**Fix and verify.** Replace the list with a new deduplicated snapshot keyed by catalog ID and invalidate stale indexes when a refresh succeeds. Preserve the user's known/new markers. Populate cache with ten rows and force three failed refreshes and two offline toggles; ten uniquely keyed cards must remain.

### R04 · P2 · A single broken addon file can prevent startup for every addon

[src/betterdiscord/modules/addonmanager.ts:173](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/addonmanager.ts#L173) enumerates the directory and synchronously stats every entry before checking the extension. A dangling symlink, concurrently removed file, or unreadable entry can throw outside a per-entry error boundary. Core invokes the manager in the shared startup sequence at [src/betterdiscord/modules/core.ts:106](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/core.ts#L106). A single unrelated file can strand later initialization and leave the loading indicator visible.

**Fix and verify.** Filter candidate names first, bound reads, catch filesystem errors per entry and surface a concise diagnostic. Continue loading valid neighbors without bypassing their normal activation policy. Exercise an irrelevant inaccessible file, deletion between readdir/stat, and one valid plugin/theme.

### R05 · P2 · A failed remote editor load can strand the inline editor

[src/betterdiscord/modules/editor.ts:66](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/modules/editor.ts#L66) memoizes the startup promise. Lines 94–106 obtain a remote loader and invoke its AMD module callback with no rejection callback or deadline. If the loader succeeds and the requested editor module never loads, the promise can remain pending. [src/betterdiscord/ui/customcss/editor.tsx:264](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/betterdiscord/ui/customcss/editor.tsx#L264) waits for resolution before choosing its fallback.

**Fix and verify.** Prefer version-matched local assets or a consent-aware loader. Add errors, timeouts, cleanup and a bounded retry; immediately offer the existing fallback for unavailable modules. Cover offline launch, stalled AMD callbacks, reopening after recovery, and unmount before a late success.
