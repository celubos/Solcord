# Solcord Changelog

## 2.0.1 - Reliability and privacy (2026-11-10)

- Restored startup across modern Discord builds and late login. **Open Solcord Suite** opens an independent, readable settings panel.
- Repaired Fake Deafen activation, transport confirmation, and the current user's deafened indicator while preserving local audio. Turning it off restores ordinary voice state.
- Hardened editor and addon file boundaries, redirected requests, private-store isolation, and Strict Privacy acknowledgement and coverage.
- Fixed Timeline batch persistence and excluded-author edits, voice-note cancellation, recycled attachment controls, and installer interrupted recovery.
- Reduced repeated embed resolution and tooltip observation, and moved catalog browsing data out of the startup renderer.
- Added installer refresh, safe checking states, useful busy feedback, and complete local error details.
- Added a separate macOS command-line preview for Apple Silicon and Intel with owned copied-app installation and recovery. Live Mac Discord acceptance and notarization remain outstanding.
- Added a 30-minute controller soak, renderer/navigation benchmarks, native Mac packaging checks, and immutable GitHub release packaging.

## 2.0.0 - Signal (2026-10-25)

- Promoted the reviewed V2 line to the first stable Solcord release while retaining the unsigned Windows publisher warning and every rollback check.
- Reduced the continuous ambient-render budget, cached field geometry and palette state, and stopped Solcord-owned DOM decorations from retriggering the shared client synchronizer.
- Kept Fake Deafen beside Discord's ordinary Deafen control with direct per-call operation and complete teardown.
- Removed public-path fixture residue and reran privacy, dependency, source, installer, and deterministic-package checks before publication.

## 2.0.0-rc.39 - Discord update recovery (2026-10-12)

- Corrected the installer credit to `@slaveofsolace` while preserving the factual BetterDiscord fork attribution.
- Restored the one-click repair path for installations whose injector handoff was replaced by a Discord desktop update. Plugins, themes, settings, private stores, and existing recovery material remain untouched.
- Updated the public quick start around one installer action: install or update normally, and choose **Repair Solcord** if a Discord update removes the startup handoff.

## Repository maintenance

- Documented RC38 installation, live checks, owner acceptance, and package hashes without changing the installed core.
- Made `main` the starting point for contributions and moved the maintainer guide to `MAINTAINING.md`.
- Removed obsolete audit exclusions so every tracked file is counted, and dropped the unrelated authorship-word filter.

## 2.0.0-rc.38 - Control and lifecycle corrections (unreleased)

- Keyboard focus survives asynchronous saves without jumping to another control. Compact disclosures have a visible focus outline.
- Accessibility controls show whether the toolkit is active. Reading width offers effective sizes, and sliders use one clear track and focus indicator.
- Built-ins distinguish availability from verified readiness; plugin replacement waits for the exact replacement to be ready.
- Fake Deafen is searchable and included under Voice & Activities > Experimental. It remains manually enabled and armed. Stale call state, repeated arming, channel changes, and failed cleanup are handled without stacking patches.
- Switch tracks keep their shape when narrow settings rows stack vertically.
- Packaging waits for the ASAR output stream to finish before measuring and hashing the file. A late disk-write failure stops publication.
- Release checks run for both main and development. Source delivery and package verification remain separate from uncompleted native mouse, drag, and account-affecting checks.

## 2.0.0-rc.37 - Visible backgrounds and bounded verification (unreleased)

- Animated fields now show through the native workspace instead of being hidden behind Discord's opaque shell. Videos, dialogs, menus and controls keep their own surfaces. Turning the effect off or reducing motion restores ordinary backgrounds.
- Added rendered checks for background visibility, disabled and reduced-motion states, changed selectors, protected foreground surfaces and click targeting.
- The build-provenance integration tests run in a fresh, bounded process. A stalled test now fails promptly without skipping it or silently retrying.
- Includes RC35's injector handoff and RC36's renderer-compatible atomic settings saves. Existing settings and recovery records remain intact.

## 2.0.0-rc.36 - Restore settings startup (unreleased)

- Fixed a settings write that called a Node crypto method missing from Discord's renderer bridge. Atomic saves now use the bridge's secure random bytes, allowing startup to continue into the Control Center and enabled features.
- Persistence tests exercise the renderer crypto bridge, including unique temporary files and a failure to obtain randomness.
- Build provenance commands now have time limits. Git-heavy tests have enough time on shared runners, and CI stops stalled jobs before GitHub's six-hour limit.
- RC35 installers and recovery records remain available. This candidate still requires installation and live acceptance before publication.

## 2.0.0-rc.35 - Discord startup handoff (unreleased)

- The installer preserves Discord's original startup archive under the BetterDiscord-compatible name so Electron actually loads Solcord first. This fixes installs that copied successfully but opened ordinary Discord.
- Verify now checks the receipt, Discord version, original archive, and exact loader contents as well as the Solcord core. Open Solcord refuses an unverified target.
- Rollback restores the previous archive location. Uninstall restores Discord's ordinary startup entry. Interrupted operations and unexpected archive changes preserve their recovery state.
- RC34's candidate and installation evidence remain preserved. RC35 is not a published or live-accepted release yet.

## 2.0.0-rc.34 - Control Center repairs (unreleased)

### Fixed

- Shared switches, sliders, and action buttons keep their state, focus, and failure feedback consistent. Repeated clicks cannot start duplicate pending actions.
- Setting changes commit once with a rollback snapshot. Failed writes restore the previous state, and unchanged values do not restart modules or write another snapshot.
- Standalone switches, shortcut hints, button rows, and help text have a shared spacing rhythm. Empty collections and healthy recovery details no longer compete with the controls.
- Light and dark appearance modes now define native color tokens at their inheritance root, including aliases used by Discord panels and controls. A leftover native light class no longer darkens an explicitly dark animated background.
- Translation language and endpoint fields preserve incomplete typing until Enter or blur. Responses cannot reappear after a provider, account, or input change.
- Account switches retire private controllers, disarm Audience Guard, and clear private forms before queued storage finishes. Stale Audience Guard and translation actions cannot carry one account's choices into the next.
- Appearance-only changes update their owning effect instead of rebuilding unrelated modules. Motion teardown owns its child resources, and disabled features remain inactive.
- Layout Collapse places its restore action above the measured voice/account panel. Call badges, server details, and timestamps no longer stack or overwrite unrelated presentation.
- Settings subscriptions follow the selected store and key after a view changes. Atomic JSON writes publish state only after persistence succeeds.
- Clearing People and Spaces preserves unknown files and reports an incomplete cleanup instead of claiming every private-store artifact was removed. A missing store identity cannot silently hide retained data or generate a replacement key over it.
- Extensions show installed or quarantined community files, not nonfunctional controls for missing files. Saved selections and rollback records remain preserved.
- The repository audit accepts Git's Windows line endings while still rejecting changed or incomplete report content.
- Test files run in isolated module environments. Plugin lifecycle fixtures can no longer contaminate Plugin Doctor or the real translation tests based on file order.
- The installer ignores incomplete Discord update folders and compares version numbers numerically. It checks the selected application files before closing Discord and again before changing the installation.
- Rollback and uninstall follow the Discord version recorded by the Solcord installation, even after Discord downloads a newer version. A mismatched channel or changed recovery receipt stops the operation before files are changed.
- Installer action and status labels now match their screen-reader names. Verification keeps keyboard focus on the control that started it.
- Installer headings size to their text, and single-column layouts stay within the window when resized or scaled. Geometry checks cover visible controls without opening a test window.

### Documentation

- Installation, daily use, troubleshooting, contribution guidelines, and release status have clear entry points. Older handoffs and version-specific evidence are separated into the documentation archive.
- Bug reports ask for the installed candidate, source, Discord app version, and display scaling. Documentation links are checked alongside source validation.

### Verification boundary

- RC33 and its published artifacts remain unchanged. This entry describes source fixes, not an installed or accepted RC34 release.
- Exact-candidate Discord, installer, accessibility, and restart acceptance remain separate from the automated source checks.
- Solcord remains an unsigned BetterDiscord fork. Private modules stay opt-in, and volatile Discord adapters do not claim support without validation.

## 2.0.0-rc.33 - Reliable Windows artifact publication

### Fixed

- The installer builder now tolerates a short Windows sharing-lock race when atomically publishing a completed candidate directory.
- Publication still refuses an existing destination, an unexpected staging path, symlinks, unrelated filesystem errors, or an exhausted retry budget.

### Verification boundary

- RC32 remains preserved as the candidate that exposed the hosted Windows rename race; its artifacts are not overwritten.
- Runtime behavior is unchanged from the live-accepted RC31 parent apart from embedded source provenance and candidate identity.
- The exact source matrix, deterministic installer build, hosted Windows build, security diff, and installed-client startup checks are rerun against RC33 before publication.

## 2.0.0-rc.32 - Final release guidance and immutable identity

### Changed

- Download, installation, First Setup, update, verification, and recovery guidance now matches the current installer instead of pointing to the historical RC5 release line.
- RC32 uses a new candidate identity because the installer correctly refuses to bind changed source bytes to the preserved RC31 label.

### Verification boundary

- Runtime implementation is unchanged from the live-accepted RC31 parent apart from embedded source provenance and candidate identity.
- The complete source matrix, deterministic installer build, exact-client startup, and release evidence are rerun against RC32 before publication.
- The Windows executable remains unsigned and may show an unknown-publisher warning.

## 2.0.0-rc.11 - Responsive motion and bounded local translation

### Fixed

- Choosing an animated background now activates it in one action under the Balanced profile. Lean mode and reduced-motion preferences still suppress ambient work.
- On-device translation capability checks and jobs now have hard deadlines. An embedded Translator API that stops responding degrades visibly and releases its queue instead of leaving the Control Center spinning.
- Standalone draft, translation, and private-note text areas now expose explicit accessible names.

### Verified

- All eleven Solcord themes activate independently in Discord Stable without introducing document or Control Center horizontal overflow, and the prior selection restores afterward.
- Attachment Guard, Permission Lens, People & Spaces validation, and the four local baseline adapters completed non-mutating live interaction checks.

## 2.0.0-rc.10 - Setup-width containment

### Fixed

- Control Center and First Setup now shrink with Discord's current settings wrappers instead of retaining a desktop-width inner column that clips copy and controls in smaller owner windows.
- First Setup now contains every internal step, paragraph, choice, and action within the live settings column. The five-step rail always remains visible without horizontal scrolling.
- Current `contentRegion`, scroller, content-column, and custom-column wrappers stay inside the visible Solcord settings column without changing non-Solcord settings pages.

### Verification boundary

- The source matrix passes 950 tests and 6,327 assertions plus lint, Solcord CSS, TypeScript, type generation, repository audit, circular audit, and whitespace checks.
- Twenty-seven isolated UI fixtures pass, and the formal CSS-only security diff review reports zero findings.
- Installed-client visual acceptance remains required on the exact RC10 bytes before merge or publication. RC9 is preserved as the superseded candidate that exposed the setup-specific defect.

## 2.0.0-rc.4 - Provider consolidation hotfix

### Fixed

- Fake Deafen is visible again in Power Lab whenever the built-in provider is available. It stays off by default and requires explicit per-call arming.
- First Setup preserves the community FakeDeafen provider until the hash-bound native replacement is ready, then archives the exact file through the reversible provider transaction instead of stacking two implementations.
- Native select contrast, setup scroll restoration, provider rollback, and disabled-provider migration sealing now match the current Discord client.

### Changed

- The Control Center presents provider migration as one compact recovery action with truthful community-provider state instead of a second plugin dashboard.
- RC2 and RC3 remain immutable. RC4 is built, verified, and installed as a separate candidate.

### Verification boundary

- The source matrix passes 695 tests and 4,359 assertions plus lint, Solcord CSS, TypeScript, type generation, repository audit, and whitespace checks before final packaging.
- Fake Deafen availability and migration use structural validation; the hotfix never auto-deafens, joins voice, or arms Power Lab during acceptance.
- The Windows executable remains unsigned and may show an unknown-publisher warning.

## 2.0.0-rc.3 - Owner-ready close-out

### Fixed

- Audience Guard now reports encrypted-storage capability independently from whether an account policy has loaded. It remains visibly session-only and fail-closed when Electron `safeStorage` is unavailable or a private operation fails.
- Audience Guard persistence survives restart and remains account-isolated in the exact storage tests.
- Media Shelf is described and counted as user-driven local reference storage instead of a live Discord runtime adapter.

### Changed

- Current-state, installation, recovery, privacy, release, and final owner-session guidance now share one owner-ready status source.
- All eleven circular dependency groups are classified as inherited after an exact comparison with the preserved clean BetterDiscord baseline.

### Verification boundary

- The canonical source matrix passes 672 tests and 4,216 assertions plus lint, Solcord CSS, TypeScript, type generation, repository audit, and whitespace checks.
- The working-tree security review reported zero findings across the three changed executable surfaces and their supporting IPC, authority, and storage code.
- Codenames, a second Discord Activity, signed-in First Setup apply, and passive Friend Watch owner review remain one final owner session on the exact installed candidate.
- The Windows executable remains unsigned and may show an unknown-publisher warning.

## 2.0.0-rc.2 — Product workspace candidate

### Added

- One searchable Control Center with ten task-oriented workspaces and a resumable eight-step first run.
- Real Lean, Balanced, and Visual resource policies with one Full, Subtle, or Reduced motion system.
- Default-off clean-room adapters for Layout Collapse, Embed Controls, Cross-platform Autoscroll, Media Shelf, and loaded-store-only Message Link Preview.

### Changed

- First-run appearance choices now preview the full Discord shell and restore the saved appearance when the user leaves the step.
- Settings favor compact operational rows, plain status language, and one shared lifecycle instead of separate plugin-card dashboards.
- The default shell now uses a warm-black and paper visual field, locally bundled OFL interface and display type, thin rules, and a static low-opacity signal texture informed by the owner's public SOL work page.
- Control Center navigation, section headings, buttons, and theme typography were redrawn to remove the generic rounded-card treatment while keeping Discord's interaction model.
- Documentation now distinguishes implemented local adapters from catalog research and points new users to the installer-first guide.

### Fixed

- Settings search and addon menus now discard incomplete, nested, or throwing third-party metadata before Discord's matcher can crash.

### Verification boundary

- Automated source, package, installer, security, and disposable-runtime evidence is bound to the exact release commit and published manifest.
- No automated acceptance message, call, Activity, relationship, server, upload, stream, or account action is performed.
- The Windows executable remains unsigned and may show an unknown-publisher warning.

## 1.0.0 — V1 review build

### Added

- Restricted same-package Discord Activity preload policy and sanitized Activity Bridge ledger.
- Plugin Doctor quarantine, structural Drift Radar, measured Performance HUD, profiles with rollback, Command Deck, Link Lens, Stream Shield preview, local Screenshot Scrubber, Settings Time Machine, and accessibility controls.
- Original Solcord visual system, security/privacy documentation, provenance registry, and reversible Windows install procedure.

### Changed

- Human-facing product branding is Solcord. Stable BetterDiscord API, path, protocol, CSS, and type identifiers remain for addon compatibility.
- The production artifact is `solcord.asar`; installation uses the legacy `betterdiscord.asar` target required by the existing injector.
- Core updates fail closed until Solcord-owned signed integrity metadata exists.

### Not yet claimed

- Live Codenames and second-Activity acceptance remain owner actions after installed launch.
- Stream Shield Go Live detection and the accessibility surface remain preview until installed Discord validation and visual review pass.

The entries below are the preserved BetterDiscord upstream changelog and attribution history.

This changelog starts with the restructured 1.0.0 release that happened after context isolation changes. The changelogs here should more-or-less mirror the ones that get shown in the client but probably with less formatting and pizzazz.

1.13.14
### Improvements
- Improved start up times

### Fixed
- Themes with special characters in their names didn't unload properly
- Fixed BD's markdown
- Fixed theme attributes
- Fixed `@runAt idle` running too early
- Fixed passing fatal to waitForModule / getLazy causing a possible error

### Added
- Added declarationFilter to waitForModule / getLazy

1.13.13
### Added
- New system for exposing top-level module declarations
- New `@runAt` meta tag to work around issues caused by lazy loading

1.13.12
### Fixed
- BetterDiscord now loads

1.13.11
### Improvements
- Dropdowns now close after selecting an option
- Dropdowns do not display the scrollbar when its not needed
- Better handling of other client mods

### Fixed
- Fix for lazy listeners firing before class modules get interpolated

1.13.10
### Fixed
- Fixed crashing when trying to view BetterDiscord's custom setting tabs

1.13.9
### Fixed
- Fixes BD's items in the settings cog context-menu
- The changelog button was at the bottom of the bd section
- Hovering over a bd section would cause the to get filled instead of changing the color
- Fixes Net.fetch from removing forbidden headers like User-Agent because of `new Request
- Possible fix for addon store indefinitely loading - please report if you still have this issue

1.13.8
### Fixed
- BetterDiscord now loads on macOS and Linux.

### Added
- Added `--avatar-url-[size]` to avatars for theme attributes.
- Added a bunch of new theme attributes to messages.
- Added an utility for developers to easily patch react elements.

1.13.7
### Added
- New Webpack cache system for faster loading times; you will see much faster loading times after the first launch with this update.

### Fixed
- Fixed `tags` button appearing behind other elements in the Addon Store
- Fixed downloading addons via the addon store
- Fixed dropdowns with lots of options not allowing you to scroll through all of the options
- Minor UI fixes

### Improvements
- Dropdowns now automatically scroll to the selected option when opened

1.13.6

### Fixed
- Fixed BetterDiscord not appearing in the `Settings Cog` context menu (right click menu)
- Fixed `Version Info` strings in settings not appearing
- Native titlebar matches Linux now

### Improvements
- Allow context menu toggle to be preventDefaulted
- ContextMenu API Rework
- Rewrite Native Fetch

1.13.5

### Added
- Added `data-speaking` attribute to VoiceUser in ThemeAttributes

### Fixed
- Fixed BdApi.Net.fetch not handling relative urls properly
- BetterDiscord now properly checks for addon updates periodically
- BetterDiscord now loads up correctly

### Improved
- Tweaked styles for InstallCSS
- BetterDiscord's Dropdown Component was rewrote

### Removed

1.13.4

### Fixed:
- Fixed styles breaking in certain areas.
- Fixed theme attributes from causing a bunch of lag.

1.13.3

### Fixed:
- BetterDiscord Settings section now appears correctly in the settings menu
- Fixed css to match Discord's latest changes
- Context Menu patches fixed

1.13.2

### Fixed:
- BetterDiscord Settings section now appears correctly in the settings menu
- Fixed css to match Discord's latest changes
- Context Menu patches fixed


1.13.1

### Fixed:
- Navigating to Plugins, Themes, or Settings from the context menu now correctly opens the intended page
- Custom CSS file is now automatically created if it doesn't exist
- aria-label for BetterDiscord section in settings panel now sets correctly
- Plugins/Themes Search bar clear button now properly resets the input field
- Fixed css to match Discord's latest changes
- BetterDiscord Settings section now appears correctly in the settings menu
- Fixes for theme attributes
- Flipped canary tooltip status fixed

## 1.13.0

### Added
- InstallCSS button next to CSS snippets for easy installation, with safety fallbacks like "Keep Changes", automatically reverting changes after 10 seconds if not kept
- In-App Notification API `BdApi.UI.showNotification`
- Ability to shift+click to open a plugin's settings from context menu
- Support for custom modal sizing to allow plugins to create modals with different dimensions and improved theming flexibility
- `aria-label` to buttons within the BD settings to improve screen reader compatibility and accessibility for users with disabilities
- React hook wrapper (`BdApi.ReactUtils.wrapInHooks`)
- Early groundwork for theme settings
- Recovery action for closing Discord modals
- `BdApi.Webpack.getBulk` for bulk getting all needed modules within one search
- `BdApi.Utils.forceLoad` to force lazy chunks to be loaded
- `BdApi.Webpack.Stores` added for easy access to all stores
- Added a changelog button to the layer modal settings

### Removed
- `Filters.byProps` removed
- `Filters.byPrototypeFields` removed
- All functions directly on `BdApi` have been removed

### Changed
- Repository reorganization, move from node/npm to bun, from webpack to esbuild, from mocha to bun:test, start TypeScript, and upgrade eslint
- Switched to using lucide icons
- Full transition to TypeScript
- Added our own react compatible stores and moved the addon manager and settings to a new model
- Added some useful defaults for VS Code
- Switched to text-based lockfile (chore)
- Revamped the i18n to support pluralization
- Updated module filtering to use `moduleCache[id]` instead of `webpackRequire.m[module.id]` for more reliable module string access
- Updated module resolution to handle Discord's new proxy-based i18n system by fixing export handling and store filtering
- Improved startup performance by replacing DataStore with lazy-loading JSON cache system
- Enhanced code editor with features including autocomplete, status bar, problems panel (VS Code-like), and improved Monaco Editor integration
- Moved update notices for BetterDiscord Core and Plugins & Themes away from Notices, to the new Notification API
- General freshen up of the CSS since Discord's large visual refresh
- Monaco editor is now lazy-loaded, improving startup performance
- Rewrote toasts to make them more in-line with NotificationApi logic & styling refresh
- Startup toasts now only show "XX Plugins/Themes enabled" rather than individual toasts for each plugin
- Changes the markdown for the betterdiscord:// protocol so it works in slate and masked links
- Hijack opening links to open the download modal on all bd addon download urls
- Visual changes to the react error recovery page to increase aesthetics.

### Fixed
- Context issue on BdApi.Webpack where `this.getModule` could return `not a function`
- Slash Command API conflicts
- getMangled utility function to properly handle undefined properties when mapping object keys
- ThemeAttributes builtin throwing errors when message components lack aria-roledescription property
- `clearable` option for `keybind` setting, if set to `true` it will now allow clearing a keybind
- Compatibility with newer Electron/Node.js versions by using stats.mtimeMs and adding OS check for accent color API
- BrowserWindow minimum size removal
- `Automatically Enable` tickbox not enabling the plugin if the file's name differed from the plugins store name
- Webpack module listening to include initial modules and optimized plugin lifecycle calls with better error handling
- Editor focus being lost in settings panel
- Issues with the BetterDiscord updater functionality and resolved problems with the getlazy utility
- Fixes a bug where if `pluginInstance.onSwitch` or `pluginInstance.observer` were non-nullable but not a function it would error
- Fixed `/[addon type] action:Enable name:[addon name]` from saying the addon started even if it errored
- Slight changes to `getByStrings` to increase webpack search speed
- Updated the context menu module for Discord's changes


## 1.12.8

### Added

### Removed

### Changed

### Fixed
 - Fixed for Discord modal changes


## 1.12.7

### Added

### Removed

### Changed
- Move settings patch to after user connection

### Fixed


## 1.12.6

### Added

### Removed

### Changed

### Fixed
 - Fixed theme attribute selectors
 - Fixed remove minimum size
 - Fixed bad css


## 1.12.5

### Added

### Removed

### Changed

### Fixed
 - Fixed more using old reactdom apis
 - Fixed webpack require hijack
 - Fixed customcss watcher


## 1.12.4

### Added

### Removed

### Changed

### Fixed
 - Fixed using old reactdom apis


## 1.12.3

### Added

### Removed

### Changed
 - Added a temporary delay to renderer injection in response to Discord changes

### Fixed


## 1.12.2

### Added

### Removed

### Changed

### Fixed
 - Fixed pasting in monaco
 - Fixed command auth
 - Fixed toast location
 - Fixed notice location
 - Fixed mtime usages


## 1.12.1

### Added
 - Sliders can now set more specific labels in their markers
 - Addon update checking can now be toggled
 - Update checking can now be done periodically

### Removed
- Removed extra code in the devtools warning module

### Changed
 - `forceUpdate` is only used for particular setting IDs
 - `bySource` now accepted multiple searches
 - Store and addon requests now set the no-cache directive

### Fixed
 - Fixed frame showing up on linux
 - Fixed opening store from context menu
 - Fixed addon store error causing freezes
 - Fixed crashing when mentioning a bot
 - Fixed addon updates not checking status code


## 1.12.0

### Added
 - Added built-in addon store
 - Slash command API
 - Default BetterDiscord slash commands
 - Search webpack modules by source code string (or regex) search (`getBySource`)
 - Basic theme attributes
 - React crash recovery
 - API for mapping the mangled keys of a single module (`getMangled`)
 - Webpack search APIs now have a `raw` option to return the entire `Module` object
 - New native window frame option
 - In-app traffic lights for macOS when using a native frame
 - Added `onAdded` to the plugin api under `DOM`
 - New `Open Addon Store` entry in context menu

### Removed

### Changed
 - `DOM.createElement` can now accept multiple children and any number of directly assignable properties
 - Settings builder now accepts a `button` type
 - Addon error modal now uses `details` and `summary` to be more accessible
 - Internal setting strings are now handled via `get` functions to allow for blind auto-translations
 - `className` function changed to use `clsx` under the hood--our first true dependency
 - Webpack searching does some additional sanity checking to help prevent errors on string searches
   - String searches are becoming more and more common so this will help performance on those searches
   - The downside is this has some very slight overhead for all other types of searching

### Fixed
 - Fixed remove minimum size
 - Clicking component source in react devtoools now goes to the right component when patched
 - Corrupt plugin configs won't halt operation
 - Blankslate for no addons in the list now render properly
 - Fixed grabbing context menu components
 - Fixed grabbing modal actions

### Deprecated
 - `target` option of `DOM.createElement` is deprecated

## 1.11.0

### Added
 - Added new `showChangelogModal` to the `UI` namespace
 - Added `getNestedValue` and `semverCompare` to `Utils`
 - Added settings builders to `UI` namespace as `buildSettingItem` and `buildSettingsPanel`
 - Added a `Logger` namespace for easier and prettier logging of debug information
 - Added some React components under `BdApi.Components

### Removed

### Changed

### Fixed
 - Fixed a `0` showing up when modals weren't on screen
 - Fixed the version string not showing up in settings
 - Fixed an issue where enabled/disabling custom css wouldn't update the style
 - Fixed tooltips not being able to have custom labels
 - Fixed lazy `Webpack` listeners not being given the correct arguments
 - Fixed `Filters.combine` not using the correct arguments
 - Fixed plugin settings modals overflowing the window

## 1.10.2

### Added

### Removed

### Changed

### Fixed
- Fixed transition group search for Discord's new export schema

## 1.10.1

### Added
- Added an `ErrorBoundary` to the custom modal stack to prevent errors from bubbling up and preventing startup.

### Removed

### Changed

### Fixed
- Fixed modal transition component search for Discord's new function component version


## 1.10.0

### Added
- Enable/disable all buttons for both AddonLists
- BDContextMenu has been integrated
- Ability to reset to default settings of any collection
- Several design components like Flex, Button, Text, and all Modal components
- Added a backup modal stack and backdrop in case we lose Discord's again
- Added a wanring for large debug logs
- `onClose` for modal APIs
- New debug information in user settings

### Removed
- Several unused "known modules"
- `DiscordClasses` module since it was seldom used
- `ClassName` and similar constructs
- Legacy emote assets

### Changed
- Search bars now auto focus
- Opening folder on Windows now occur in the foreground
- Search fields are now clearable
- AddonList pages now show totals and results of searches
- Custom CSS live update is now debounced and using a proper switch not a checkbox
- ConfirmationModal and ChangelogModal are now using custom components
- Updater panel now uses icons rather than text buttons
- AddonList panels have been rearranged to accomodate the new buttons
- The anonymous BD patch function is now named `BDPatcher`
- Modal APIs now use internal ConfirmationModal component
- Markdown areas now consistenly allow for embedded links
- Lazy loaded modules are returned to the original source

### Fixed
- Fixed grabbing the wrong module for accepting invites
- Fixed more strings that were not translatable

## 1.9.8

### Added

### Removed

### Changed

### Fixed
- Removed `ipc.sendTo` for electron 28
- Fixed core updater not using the semver comparator

## 1.9.7

### Added
- Support for Spanish (LATAM) locale

### Removed

### Changed
- Updated translations
- Ignore relative requires (This is because when favoriting a GIF and other UI actions, Discord repeatedly attempts to load relative requires on accident causing our code to make tons of FS requests causing lag.)

### Fixed
- Fixed locale not falling back to English properly

## 1.9.6

### Added
- All HTTP request options for bd-fetch

### Removed

### Changed
- Updated translations

### Fixed
- Fixed race conditions for notices
- Fixed options not being sent to fetch

## 1.9.5

### Added

### Removed

### Changed

### Fixed
- Fixed the webpack patch for the new loader

## 1.9.4

### Added
- New css variable `--os-accent-color`
- Temporary `Buffer` polyfill

### Removed

### Changed
- `BdApi.Net.fetch` now has an optional `timeout` parameter

### Fixed
- Fixes not being able to use `http` for `BdApi.Net.fetch`.
- Bad URLs and other early errors in `BdApi.Net.fetch` now handled better.

## 1.9.3

### Added
- Multiple shorthand functions under `BdApi.Webpack`
- New `getStore` filter

### Removed

### Changed
- Updated translations

### Fixed
- Fixed header color in light mode.
- Fixed window size retention for users of remove minimum size option.
- Fixed a toast saying an addon was loaded when it was unloaded.
- Fixed context menu patching API for plugins.

## 1.9.2

### Added

### Removed

### Changed

### Fixed
- Fixed context menu crash & api

## 1.9.1

### Added
- SourceURL for the renderer

### Removed

### Changed

### Fixed
- Fixed client crashes

## 1.9.0

### Added
- Remove minimum window size now remembers desired size
- Basic semver comparison

### Removed
- Public Servers
- Old DataStore functions that are no longer used

### Changed
- All main react components are now functional with hooks
- Mac now uses cmd instead of ctrl

### Fixed
- Fixed dropdowns
- Fixed markdown parser

## 1.8.5

### Added
- Ability to use a custom local version of React DevTools
- Experimental `BdApi.Components` for component access in plugins

### Removed

### Changed
- Title for settings sidebar now uses a custom component

### Fixed
- Fixed ModalRoot and ConfirmationModal not being found in webpack
- Fixed context menus for internal changes

## 1.8.4

### Added

### Removed

### Changed

### Fixed
- Fixed more bugs with context menu api

## 1.8.3

### Added
- Checking for old installs and deleting them

### Removed
- All references to Emotes, this will become a separate plugin

### Changed
- Moved to the more permissive Apache 2.0 license
- Now check for discord.asar for electron17+
- Handle setting module exports internally rather than maintaining getter references

### Fixed
- Fixed `inject` for electron17+
- Updater checking `>` which does not work for open versions
- Fixed a startup bug with the context menu api

## 1.8.2

### Added

### Removed

### Changed

### Fixed
- Fixed modals not working
- Fixed downloading binary files
- Fixed public server invites

## 1.8.1

### Added
- A script to automatically grab the new translations from POEditor
- Several new translations

### Removed

### Changed
- Moved some hardcoded strings to be part of the translation system
- Several updated translations

### Fixed
- Fixed context menu patcher not patching consistently
- Fixed context menu toggle item UI not updating
- Fixed an issue with the bound API checking the wrong arguments
- Fixed `getOwnerInstance` calling the wrong functions internally

## 1.8.0

### Added
- Proper updater system with UI.
- Tooltip component for plugins.
- Highly expanded plugin API.

### Removed

### Changed
- Reverted how internal webpack module searches are performed.
- New options for webpack searches.

### Fixed
- Fixed many issues regarding memory leaks and out-of-memory errors!
- Fixed a major issue where webpack searches would iterate by default.
- Fixed an issue with `byStrings` and `combine` filters in the API.
- Fixed an issue where searching for multiple modules could yield the same module multiple times.
- Fixed an issue where misnamed addon files could prevent startup.
- Fixed an issue where the `request` module would not follow redirects.
- Fixed an issue where certain modals could crash the client.
- Fixed an issue where toasts would not show on the crash screen.

## 1.7.0

### Added
- Polyfill for certain node modules.

### Removed
- Proxy protection for certain modules.

### Changed
- Changed how internal webpack module searches are performed.
- New location for public servers button.
- Switch to pnpm with workspaces.
- Improved startup errors.

### Fixed
- Fixed several issues for Discord's internal changes.

## 1.6.3

### Added

### Removed

### Changed
- Plugin startup errors should be more descriptive for developers.

### Fixed
- Fixed an issue where custom css crashed Discord.
- Fixed an issue where `waitForModule` returned a boolean instead of a module.

## 1.6.2

### Added

### Removed

### Changed

### Fixed
- Fixed non-loading issue due to changed UserSettingsStore

## 1.6.1

### Added

### Removed

### Changed

### Fixed
- Fixed an issue where `waitForModule` would not return the found module.
- Fixed an issue where broken addon METAs could prevent BD from fully loading.
- Fixed an issue where developer badges stopped rendering.

## 1.6.0

### Added
- Better handling and fallback when the editor fails to load. (Thanks Qb)
- Now able to sort addons by whether they're enabled. (Thanks TheGreenPig)
- New `Webpack` API added for plugin developers to take advantage of.

### Removed

### Changed
- Addon loading no longer uses `require`
- Addon error modal updated (Thanks Qb)
- Fixed plugin error display on the modal

### Fixed
- Fixed dispatcher changes by Discord

## 1.5.3

### Added

### Removed

### Changed

### Fixed
- Fixed Canary crashing immediately

## 1.5.2

### Added

### Removed

### Changed

### Fixed
- Fixed being unable to inject into settings, thanks @Strencher

## 1.5.1

### Added
- `Number` settings component using builtin `input[type=number]`
- Settings for monaco editor: font size, line numbers, minimap, whitespace, quick suggestions, tooltips

### Removed

### Changed

### Fixed
- Fixed `GuildComponent` throwing errors
- Fixed public servers button disappearing when guilds list rerenders
- Fixed plugin compilation error not pointing to console
- Fixed plugins with no `@name` attempting to load

## 1.5.0

### Added
- `appSettings` override and corresponding toggle to enable DevTools (Thanks [Kyza](https://github.com/Kyza))
- `bd-transparency` class is added to `document.body` when window transparency is enabled (Thanks [Strencher](https://github.com/Strencher))

### Removed
- Removed all appearance related `Builtin`s including: 24 Hour Timestamps, Colored Text, Hide GIF/Gift Button, and MinimalMode

### Changed

### Fixed
- Fixed `DebugLogs` throwing errors or not writing `null`, `undefined`, and circular objects
- Fixed guild utility classes not being added
- Fixed toast location

## 1.4.0

### Added
- Notices API (Thanks [Strencher](https://github.com/Strencher))

### Removed

### Changed

### Fixed
- Fixed outdates styles and classnames (Thanks [Strencher](https://github.com/Strencher))
- Fixed guild list classes being overwritten causing the public server button to not show
- Fixed finding the wrong module for `ActionTypes` in custom css module
- Fixed not removing customcss upon disable
- Fixed media keys commandline switch not being applied

## 1.3.0

### Added

### Removed

### Changed
- Startup now waits for current user to be populated or for CONNECTION_OPEN event

### Fixed
- Fixed emote menu causing crashes

## 1.2.4

### Added

### Removed

### Changed

### Fixed
- Fixed loading sequence using wrong classes

## 1.2.3

### Added

### Removed

### Changed

### Fixed
- Fixed translations not falling back to English
- Fixed waiting for guilds due to class name changes

## 1.2.2

### Added
- Added Czech translation
- Added Spanish translation
- Added Hindi (partial) translation
- Added Italian translation
- Added Dutch translation
- Added Norwegian translation
- Added Portuguese (PT) translation
- Added Romanian translation
- Added Russian translation
- Added Turkish translation

### Removed

### Changed
- `window.webpackJsonp` is temporarily polyfilled for Canary but _will_ be disappearing
- Updated French translation
- Updated Germand translation

### Fixed
- Fixed public servers missing (Thanks [Strencher](https://github.com/Strencher))
- Fixed guild classes missing (Thanks [Strencher](https://github.com/Strencher))

## 1.2.1

### Added
- Added `getPatchesByCaller` to `BdApi.Patcher`

### Removed

### Changed
- Internal react keys updated for new version in Discord (Thanks [Strencher](https://github.com/Strencher))
- Monaco editor now loads for all cases rather than just for custom css (Thanks [Qb](https://github.com/QbDesu))
- MacOS on Discord non-canary will use the default `process` object

### Fixed
- Fixed failed plugin loads being permanently cached (Thanks [Strencher](https://github.com/Strencher))
- Fixed duplicate file renaming sometimes causing crashed (Thanks [Strencher](https://github.com/Strencher))
- Fixed plugin data retrieval when using falsey values
- Fixed plugin data being overwritten if a read did not occur first
- Fixed react dev tools time of installation to comply with linux injection. (Thanks [Qb](https://github.com/QbDesu))

## 1.2.0

### Added
- `openDialog` function added to `BdApi` to enable save/load of files.

### Removed

### Changed
- Emote menu now more seamlessly integrates with Discord.
- Support for other chrome profiles added when using React DevTools. (Thanks [CrizGames](https://github.com/CrizGames))
- Console errors from plugins should now properly map to the local file.

### Fixed
- Fixed several crashing issues related to voice and video chats.
- Fixed the incompatibility with Canary/PTB
- Fixed missing class names on guild elements.
- Fixed minimal mode for new Discovery tab. (Thanks [dav1312](https://github.com/dav1312))


## 1.1.1

### Added

### Removed

### Changed
- Plugin loader now removes the used `script` tags
- URLs reflect new website

### Fixed
- Fixed an issue with hiding GIF and Gift buttons
- Fixed certain plugin patches not returning values
- Fixed an issue with the settings patch failing


## 1.1.0

### Added
- Added an option to prevent Discord from hijacking the media keys.
- Added command line flag to launch a vanilla version of Discord `--vanilla`
- Added an option for app-wide `ctrl+shift+c` shortcut for inspect element.
- Added emote blocklist to `BdApi` via `BdApi.Emotes.blocklist`.
- Added the ability to remove Discord's forced minimum window size.
- Added a basic core updater to hopefully prevent the need for future installs.
- Added an option to log out all console logs to file for developers.
- Added an option to disable Discord's console warning.
- Added translations for the following languages: French, Slovak, Polish, Portuguese (BR), Chinese (Traditional), Chinese (Simplified)

### Removed
- Class normalizer was removed as it does more harm than good.

### Changed
- Addon error modals got a makeover thanks to [Strencher](https://github.com/Strencher) and [Tropical](https://github.com/Tropix126)
- Emotes are now downloaded as a single asar bundle as opposed to individual JSON files.
- Strings are now bundles with the main payload, but may move to a separate asar like the emotes.
- `BdApi` functions related to window preferences no longer work and are deprecated.
- Guild classes are obtained later from webpack in case it's not loaded in fast enough.
- DataStore now has additional protections (`try..catch`).

### Fixed
- Fixed an issue with old METAs used in themes cause the css to render invalid.
- Fixed crashing issues with plugins using `Buffer`.
- Fixed a bug for manual and 3rd party installations that don't create the BD folder.
- Fixed incorrect path usage for some Mac devices.
- Fixed colored text not doing anything.
- Fixed detached css window not loading saved css.
- Fixed an issue where toggling settings collections would remove incorrect panels.
- Fixed the file watchers not properly matching duplicate files.
- Fixed Hide GIF and Hide Gift options for Discord's changes
- Fixed public servers button not showing.
- Fixed multiple error modals showing on startup if multiple plugins had errors.
- Fixed incorrect styling on emotes.
- Fixed system editor edit buttons using an old Electron API (`openItem` vs `openPath`)
- Fixed an issue for those using exclusively server folders


## 1.0.0

### Added
- **Everything** is entirely rewritten, for better or worse.
- **Emotes and Custom CSS** can be completely turned off for those not interested. It saves on memory too by not loading those components.
- **Floating editors** for both custom css and plugins/themes are now available.
- **Monaco** is now used as the main CSS editor, in place of Ace.
- **Settings panels** are completely new and sleek. They are also highly extensible for potential future features :eyes:
- **Translations** are now integrated starting with only a couple languages, but feel free to contribute your own!
- **Public servers** got a new makeover thanks to some design help from Tropical and Gibbu!
We added settings to hide the **Gif Picker** and the **Nitro Gift** buttons in the textarea.

### Changed
- **Patcher API** was added to `BdApi` under `BdApi.Patcher`. The old `BdApi.monkeyPatch` was patched to use the Patcher as well. This allows plugins and patches to play nice with one another.
- **jQuery** was removed from dependencies.
- **General performance** improvements throughout the app, from startup to emotes to addons.
- **Exporting** by plugins is now highly encouraged over trying to match your meta name and class name.
- **Plugins and Themes** pages have more options for sorting, views and more. The entire panel got a facelift!
- **Blankslates** have been added all over for that added UX.
- **Several unused UI features** have been removed for a more performant and usable experience.
- **Debugger Hotkey** is now a built-in feature!

### Fixed
- **Minimal mode** has been redesigned from the ground up and now works as intended.
- **Emote menus** are fixed and now use React Patching to properly integrate into the new Emoji Picker. (Thanks Strencher#1044!)
