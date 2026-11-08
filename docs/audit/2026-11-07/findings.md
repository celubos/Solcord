# Prioritized finding register

Select a finding to open its source evidence, proposed repair, and regression check. Entries within a priority are grouped by subsystem. The handoff README gives the recommended implementation order.

## P1 · 18 findings

| ID | Finding |
|---|---|
| I01 | [The detached editor can operate on a path chosen by the document](installer.md#i01) |
| I02 | [The main process removes content security policy for every default-session response](installer.md#i02) |
| I03 | [The installer paints and handles input on the same thread that waits for Discord to stop](installer.md#i03) |
| I05 | [Rolling back an update can leave the restored version unmanaged](installer.md#i05) |
| I07 | [Process interruption during uninstall can leave Discord unable to boot](installer.md#i07) |
| I08 | [One managed receipt cannot represent two Discord channels using the shared core](installer.md#i08) |
| R01 | [Startup can wait forever on a missing connection dispatcher](renderer.md#r01) |
| F01 | [Mark as Read can acknowledge a newer message than the user reviewed](features.md#f01) |
| F05 | [Timeline accepts a seed the native store rejects](features.md#f05) |
| F06 | [Partial edits can defeat ignored-author filters](features.md#f06) |
| F07 | [A canceled recording can take over the next voice-note preview](features.md#f07) |
| F09 | [Timeline replay repeatedly scans all retained records](features.md#f09) |
| F10 | [Quiet channels keep expired messages visible](features.md#f10) |
| F11 | [A display preference can interrupt message capture](features.md#f11) |
| X01 | [The catalog download can write outside the selected addon folder](cross-layer.md#x01) |
| X02 | [The legacy HTTP bridge forwards secrets across redirects](cross-layer.md#x02) |
| X03 | [Bridged downloads and uploads ignore consumer backpressure](cross-layer.md#x03) |
| X04 | [Hosted Windows CI omits the entire disposable-client preparation suite](cross-layer.md#x04) |

## P2 · 28 findings

| ID | Finding |
|---|---|
| I04 | [The installer recommends opening a different channel or version than it verified](installer.md#i04) |
| I06 | [A staging-copy failure can leave an ambiguous recovery record](installer.md#i06) |
| I09 | [Identical repairs create unbounded backup copies](installer.md#i09) |
| R02 | [Lazy webpack lookups retain completed filters on long-lived abort signals](renderer.md#r02) |
| R03 | [Disk cache fallback can duplicate store cards indefinitely](renderer.md#r03) |
| R04 | [A single broken addon file can prevent startup for every addon](renderer.md#r04) |
| R05 | [A failed remote editor load can strand the inline editor](renderer.md#r05) |
| R06 | [Hidden tooltips keep monitoring the entire Discord DOM](renderer.md#r06) |
| R07 | [Shared store hook retains an obsolete subscription after its input changes](renderer.md#r07) |
| F02 | [Small settings edits synchronously clone and rewrite the entire store](features.md#f02) |
| F03 | [Unrelated mutations wake every enabled DOM synchronizer](features.md#f03) |
| F04 | [Relationship enrichment precedes the visible result cap](features.md#f04) |
| F08 | [Voice waveform analysis decodes and scans the whole recording](features.md#f08) |
| F12 | [Control Center selectors repeat full-state work on unrelated events](features.md#f12) |
| F13 | [Audience Guard can queue duplicate policy reads while loading](features.md#f13) |
| F14 | [Translation treats distinct scripts as the same language](features.md#f14) |
| X05 | [Production packaging trusts leftovers in the ignored build folder](cross-layer.md#x05) |
| X06 | [The developer injector can report success with an unbootable Discord directory](cross-layer.md#x06) |
| X07 | [A quarter of the renderer is generated catalog data](cross-layer.md#x07) |
| X08 | [Callback filesystem APIs block the renderer and can call a consumer twice](cross-layer.md#x08) |
| X09 | [Updates can remove an unrelated pending item or expose a partial plugin](cross-layer.md#x09) |
| X10 | [A media-key setting replaces unrelated Chromium flags](cross-layer.md#x10) |
| X11 | [Browser acceptance can record the wrong layout and misses the shipping React tree](cross-layer.md#x11) |
| X12 | [The repository inventory excludes the largest custom runtime and the installer from custom totals](cross-layer.md#x12) |
| X13 | [The published release does not expose the acceptance evidence described by its status page](cross-layer.md#x13) |
| X20 | [Embed Controls repeatedly performs a quadratic scan of loaded messages](cross-layer.md#x20) |
| X21 | [A recycled voice-message row can download the previous person's attachment](cross-layer.md#x21) |
| X22 | [Audio Console shows a made-up starting volume in its confirmation](cross-layer.md#x22) |

## P3 · 8 findings

| ID | Finding |
|---|---|
| R08 | [Tooltip placement can retain conflicting classes after a flip](renderer.md#r08) |
| X14 | [CI repeats expensive work and green checks conceal broader CSS debt](cross-layer.md#x14) |
| X15 | [Installed tooling and public scripts disagree](cross-layer.md#x15) |
| X16 | [Locale export can replace a working translation with a failed download](cross-layer.md#x16) |
| X17 | [Dead compatibility UI and duplicate policy metadata cost maintenance time](cross-layer.md#x17) |
| X18 | [Release tooling scales with files and repeatedly reads the full installer](cross-layer.md#x18) |
| X19 | [The candidate-review downloader enforces its byte ceiling after allocation](cross-layer.md#x19) |
| X23 | [The changelog video player chooses its embed mode by substring](cross-layer.md#x23) |
