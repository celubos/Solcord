# Solcord Engineering Handoff

Prepared: **2026-08-26**

> [!NOTE]
> This is a preserved historical engineering handoff. Current release state and acceptance limits are maintained in [Release status](../STATUS.md).

## Authorization

The repository owner supplied full maintainer authorization for technical inspection, source changes, tests, CI, documentation, branch management, promotion, issue and pull-request maintenance, and release preparation within `slaveofsolace/Solcord`.

Do not place credentials, tokens, private Discord content, account identifiers, or absolute user paths in source, logs, fixtures, issues, releases, or screenshots. Authorization does not replace evidence: never describe a live Discord, installer, rollback, accessibility, or performance result as passed without captured proof.

## Repository state

| Item | Value |
| --- | --- |
| Repository | `slaveofsolace/Solcord` |
| Integration branch | `development` |
| Audit branch | `audit/solcord-foundation` |
| Fork branch before this pass | `bec561cf10837bacfe587be9be4a08abf9891224` |
| Original validated source parent | `620499c11bbcadce390b27565e7ef9b3f00f2a7e` |
| Current upstream `BetterDiscord/BetterDiscord:development` snapshot | `b2b361ccd1b16b4f8162f3bf016396e5a1fa465d` |
| Upstream snapshot date | `2026-08-25` |
| Upstream snapshot change | PR `#2228`, bundle missing site assets |
| Package version | `2.0.0` |
| Runtime | Bun `1.4.0` |
| Primary platform target | Windows desktop |
| Final branch gate | Use the latest `Solcord V2 CI` run for the exact audit-branch head; both Linux and Windows jobs must pass before promotion |

The audit branch is a fast-forward descendant of `development`. Upstream is newer than the upstream parent used by this fork; treat the site-asset merge as a dedicated synchronization item rather than replaying it blindly over Solcord's packaged editor, theme, and branding assets.

## Verified evidence

### Full source and package gate

GitHub Actions finalization run `33019240130` completed successfully and recorded:

- **619 passing tests**
- **40 intentionally skipped tests**
- **0 failing tests**
- **3,931 assertions**
- **659 tests across 61 files**
- ESLint passed
- Solcord CSS lint passed
- TypeScript passed
- public type generation passed
- circular-dependency analysis completed
- repository audit freshness passed
- production `dist` packaging passed
- `assets/branding/solcord-social-preview.png` rendered at 1200×630

The 40 skipped tests are the opt-in disposable Windows acceptance suite. They remain intentionally unclaimed.

### Permanent Linux gate

`Solcord V2 CI` run `33019362556` passed its Linux job on commit `42f9f959a6ad6208e42921ca29d12708fb6c89f7`, including the production package and uploaded review artifact.

### Reproduced Windows installer wiring defect

The same run passed:

- 53 Windows-sensitive fixtures;
- Windows TypeScript checking;
- the .NET installer compile and publish stages.

It then failed the executable self-test with:

```text
embedded-bundle:InvalidDataException
Installer lifecycle self-test failed with status 1.
```

Root cause was not the installer verifier. The package command invoked the obsolete `scripts/build-solcord-installer.cjs`, which published before creating the installer manifest and supplied none of the three MSBuild embedded-resource properties. The executable therefore contained no embedded release bundle and failed closed correctly.

Correction made:

- `package.json` now routes `installer:candidate` to `scripts/build-solcord-v2-installer.mjs`;
- the obsolete sidecar builder was deleted;
- `tests/solcord/installer-security-contract.test.ts` now asserts the exact package command and rejects restoration of the obsolete builder;
- the active builder creates private staged inputs, requires the embedded bundle at build time, publishes exactly one executable, and runs self-test from an empty directory.

Treat the latest permanent Windows CI result on the corrected branch head as authoritative.

## Review scope

This pass performed an exhaustive persistent tracked-text scan and targeted semantic review of the highest-risk surfaces. The generated audit reads every persistent tracked file, classifies binary and generated content, and scans every persistent tracked text line. Manual semantic review concentrated on:

- product identity and migration;
- renderer, preload, and Electron boundaries;
- Solcord runtime and settings composition;
- installer and rollback boundaries;
- Activity compatibility;
- addon setup and integrity;
- UI consistency and long-list behavior;
- packaging, CI, and release provenance;
- existing native replacements and proposed baseline capabilities.

This is not a claim that every line received equal manual semantic analysis. Exact inventory and hotspots are in `docs/audit/FULL_REPOSITORY_AUDIT.md`.

## Completed work

### 1. Complete product identity migration

The prior product identity was removed from active tracked paths and text. The migration covered:

- source directories, imports, symbols, IPC names, logs, and user-facing strings;
- tests and fixtures;
- scripts and package commands;
- installer project, assembly, executable, manifest, and resource names;
- CI workflow and artifact names;
- themes, catalogs, branding, documentation, evidence, and issue templates;
- release and build-provenance labels.

Current conventions are:

- `Solcord` for human-facing names;
- `solcord` for package, file, and runtime namespaces;
- `SOLCORD_*` for environment variables and constants where appropriate.

Repository code search returns no prior product-identity result on the audit branch.

### 2. Bounded compatibility for historical appearance values

`src/common/solcord/product.ts` normalizes the two pre-rename appearance values into:

- `solcord-dark`
- `solcord-light`

The historical values are reconstructed only at the migration boundary instead of remaining active identifiers. `tests/solcord/product-identity.test.ts` covers both conversions.

A byte-exact historical theme fixture remains testable through `tests/fixtures/solcord-legacy-default.theme.css.b64`; active filenames and source do not retain the prior name.

### 3. UI consistency and rendering

Build Web Apps guidance was applied to the existing interface without introducing a competing component library.

Completed changes include:

- preserving the existing semantic token layer as the source of truth;
- preserving Discord-compatible controls and layout primitives;
- explicit listener cleanup in the settings title provider;
- clearer local naming in `src/betterdiscord/ui/settings.tsx`;
- removal of obsolete lint suppressions in `src/betterdiscord/modules/patcher.ts`;
- `content-visibility: auto` containment for long module, catalog, curated-addon, and people-history rows;
- explicit disabled styling for local actions;
- README and repository presentation aligned to the graphite, teal, cream, and ember brand system.

Current presentation assets include:

- `assets/branding/solcord-mark.svg`
- `assets/branding/solcord-wordmark.svg`
- `assets/branding/solcord-social-preview.svg`
- `assets/branding/solcord-social-preview.png`
- `assets/branding/icons/solcord-mark-*.png`

### 4. README and maintainer documentation

`README.md` was rewritten as a user-first project page with:

- a full-width branded preview;
- concise fork positioning;
- current-state and historical-release warnings;
- performance, compatibility, privacy, suite, build, and attribution sections;
- direct links into audit, security, roadmap, and handoff documents;
- no broken direct links to historical pre-rename binaries.

### 5. Repeatable repository audit

Added:

- `scripts/audit-solcord-repository.mjs`
- `bun run audit:repo`
- `bun run audit:repo:check`
- `docs/audit/FULL_REPOSITORY_AUDIT.md`

The scanner inventories persistent tracked files, text lines, large-file hotspots, identity residue, project wording, maintenance markers, timers, observers, DOM queries, module discovery, patches, synchronous filesystem calls, console calls, and empty catches.

It excludes one-time migration/finalization workflows from persistent inventory and does not count its own pattern definitions as findings.

### 6. One verification command

`bun run verify` runs:

1. tests;
2. TypeScript lint;
3. Solcord CSS lint;
4. TypeScript checking;
5. public type generation;
6. circular-dependency analysis;
7. audit freshness.

It exits nonzero on a failed gate. `bun run dist` remains the clean production packaging gate.

### 7. CI cleanup

Durable fork workflows are:

- `.github/workflows/ci.yml`
- `.github/workflows/solcord-ci.yml`
- inherited Crowdin and type-publishing workflows.

Changes include:

- the renamed Solcord workflow;
- Bun `1.4.0` pinned in verification jobs;
- frozen dependency installation;
- Linux source/package verification;
- Windows policy, safety, and embedded-installer validation;
- Solcord-named artifacts and review bundles;
- upstream-only canary release behavior guarded to `BetterDiscord/BetterDiscord`.

One-time migration and finalization workflows must not remain in the final branch.

### 8. Embedded installer command correction

The repository contained two installer builders:

- the current secure embedded-resource builder, `scripts/build-solcord-v2-installer.mjs`;
- an obsolete sidecar-oriented builder, `scripts/build-solcord-installer.cjs`.

The package command accidentally invoked the obsolete file while tests inspected the secure file. This created a false split between tested and executed behavior.

Completed correction:

- package command points to the tested builder;
- obsolete builder removed;
- package-to-builder wiring covered by regression test;
- secure builder remains responsible for clean-source rebuild, private input staging, exact embedded hashes, one-file publish, empty-directory self-test, and bounded cleanup.

### 9. Performance-first plugin-store scaffolds

The BetterDiscord plugin store was reviewed on 2026-08-26. Existing native Solcord coverage was preferred over duplicate community-file installation.

Typed, immutable scaffolds in `src/common/solcord/baseline-capabilities.ts` cover:

1. **Layout Collapse**, inspired by CollapsibleUI;
2. **Embed Controls**, inspired by CollapseEmbeds;
3. **Cross-platform Autoscroll**, inspired by AutoScroll;
4. **Media Shelf**, inspired by ImageFolder;
5. **Message Link Preview**, inspired by PeekMessageLinks.

Every scaffold is default disabled, lazy, local-only, free of network/account actions, and blocked at `scaffold` until adapter and runtime evidence exist.

`tests/solcord/baseline-capabilities.test.ts` verifies ordering, uniqueness, disabled behavior, immutable metadata, and exact reviewed store routes. `docs/audit/PLUGIN_BASELINE_REVIEW.md` records the store snapshot and rejection criteria.

## Change ledger

The authoritative diff is:

```sh
git diff --find-renames bec561cf10837bacfe587be9be4a08abf9891224...audit/solcord-foundation
```

### Identity and product paths

- `.gitattributes`
- `.github/ISSUE_TEMPLATE/**`
- `CHANGELOG.md`
- `CONTRIBUTING.md`
- `NOTICE`
- `SECURITY.md`
- `assets/branding/**`
- `assets/catalog/**`
- `assets/locales/**`
- `assets/themes/**`
- `docs/**`
- `installer/Solcord.Installer/**`
- `scripts/*solcord*`
- `src/betterdiscord/modules/solcord/**`
- `src/betterdiscord/ui/solcord/**`
- `src/common/solcord/**`
- `src/electron/main/modules/solcord-*.ts`
- `tests/solcord/**`

### Direct behavioral and quality changes

- `src/common/solcord/product.ts`
- `src/betterdiscord/modules/patcher.ts`
- `src/betterdiscord/ui/settings.tsx`
- `src/betterdiscord/styles/solcord.css`
- `tests/solcord/product-identity.test.ts`
- `src/common/solcord/baseline-capabilities.ts`
- `tests/solcord/baseline-capabilities.test.ts`
- `package.json`
- `tests/solcord/installer-security-contract.test.ts`
- deleted `scripts/build-solcord-installer.cjs`

### Build, CI, and audit changes

- `.github/workflows/ci.yml`
- `.github/workflows/solcord-ci.yml`
- `scripts/audit-solcord-repository.mjs`
- `docs/audit/FULL_REPOSITORY_AUDIT.md`
- `docs/audit/PLUGIN_BASELINE_REVIEW.md`
- `docs/roadmap/BASELINE_CAPABILITIES.md`

### Presentation and maintainer changes

- `README.md`
- `assets/branding/solcord-social-preview.png`
- `docs/archive/V2_ENGINEERING_HANDOFF.md`

Intermediate one-time workflow commits exist because GitHub workflow permissions prevented a single atomic mass rename. The final tracked tree is authoritative.

## Deferred engineering work

### P0 — Live Windows and Discord acceptance

Static and packaged verification cannot establish current Discord desktop behavior. Validate on a disposable Windows profile against the exact installed Discord version:

1. Solcord injection and clean startup;
2. Activity Bridge with an ordinary Activity launch;
3. failure behavior when the Discord-owned preload target drifts;
4. all visible Control Center workspaces;
5. enable, disable, reload, and restart cycles for every ready module;
6. external editor open, focus, save, unsaved-close, and reopen behavior;
7. installer install, upgrade, downgrade refusal, rollback, interrupted recovery, and uninstall;
8. account switching for Timeline, Friend Watch, Audience Guard, and encrypted notes;
9. reduced motion, keyboard navigation, focus restoration, narrow settings widths, and screen-reader labels;
10. teardown evidence for patches, listeners, observers, timers, subscriptions, DOM, recorder/media resources, and cached account state.

Capture Discord version, Solcord commit, artifact SHA-256, steps, sanitized logs/screenshots, and cleanup result. Do not use an ordinary personal profile for destructive installer or recovery testing.

### P0 — Replacement release

The existing `v2.0.0-rc.1` and `v2.0.0-rc.2` releases preserve their historical artifacts. Do not rewrite their provenance. Source changes after RC2 produce RC3.

After live Windows acceptance:

1. build from a clean signed commit;
2. generate `solcord.asar`, checksums, manifest, and `SolcordInstaller.exe`;
3. run embedded-resource self-test from an empty directory;
4. sign and verify the installer;
5. publish a new Solcord-named release;
6. update README release language only after assets exist;
7. retain the historical release with an explicit legacy note.

### P0 — Repository metadata

The connected repository API used during this pass did not expose repository-setting writes. The repository owner or a GitHub CLI session with administration permission must:

- replace the stale pre-rename topic with `solcord`;
- set the repository description to the current README positioning;
- point the homepage to the current release only after a Solcord-named release exists;
- enable Issues if public bug reports are intended;
- upload `assets/branding/solcord-social-preview.png` as the GitHub Social preview.

Suggested commands:

```sh
gh api --method PATCH repos/slaveofsolace/Solcord \
  -f description='A performance-first BetterDiscord fork with bounded Activities compatibility, local tools, recovery, and full-shell themes.' \
  -F has_issues=true

gh api --method PUT repos/slaveofsolace/Solcord/topics \
  -H 'Accept: application/vnd.github+json' \
  --input - <<'JSON'
{"names":["accessibility","betterdiscord-fork","discord-client-mod","electron","plugins","privacy","productivity","solcord","themes","windows"]}
JSON
```

### P1 — Control Center decomposition

Current hotspots:

- `src/betterdiscord/modules/solcord/runtime.ts` — approximately 2,949 lines;
- `src/betterdiscord/modules/solcord/store.ts` — approximately 1,047 lines;
- `src/betterdiscord/ui/solcord/panel.tsx` — approximately 941 lines;
- `src/betterdiscord/styles/solcord.css` — approximately 748 lines.

Refactor without changing visible behavior first. Suggested boundaries:

- workspace shell and navigation;
- status and availability primitives;
- module rows;
- catalog and curated-addon surfaces;
- privacy/history surfaces;
- recovery and diagnostics;
- profile/settings actions;
- pure selectors and view models.

Acceptance criteria: identical visible copy, ordering, state, focus, and narrow-layout behavior; no new eager imports; no duplicated subscriptions or module discovery; component tests for key workspaces; before/after render and bundle evidence.

### P1 — Circular dependencies

Current analysis reports eleven groups:

1. `discordmodules.ts -> webpack/index.ts -> filter.ts -> require.ts -> patcher.ts`
2. `webpack/index.ts -> filter.ts -> require.ts -> patcher.ts`
3. `webpack/require.ts -> webpack/searching.ts`
4. `webpack/lazy.ts -> webpack/utilities.ts`
5. `webpack/index.ts -> webpack/stores.ts`
6. `addonmanager.ts -> addoneditor.tsx -> customcss/editor.tsx -> stores/editor.ts -> thememanager.ts`
7. `pluginmanager.ts -> addonmanager.ts -> addoneditor.tsx -> customcss/editor.tsx -> stores/editor.ts`
8. `floatingwindows.tsx -> floating/container.tsx`
9. `settings.tsx -> addonpage.tsx -> addonstore.tsx -> modules/addonstore.ts -> installmodal.tsx -> addonshared.tsx`
10. `settings.tsx -> settings/panel.tsx`
11. `builtins.ts -> customcss.ts -> settings.tsx`

An exact run against the preserved clean BetterDiscord baseline reports these same eleven groups with the same paths. They are inherited, not Solcord-introduced. Do not break public exports merely to reach zero. Revisit a group only when profiling or a concrete runtime failure proves risk; add import-boundary tests before changing module ownership.

### P1 — Measurement-led performance work

The renderer production bundle remains roughly 1.3 MiB. Measure before splitting. Record:

- initial and compressed bundle size;
- startup phase durations;
- number and duration of module searches;
- active patches, listeners, and observers after startup;
- cost of each default-enabled module;
- cost of opening each Control Center workspace;
- memory after repeated lifecycle cycles.

Likely lazy boundaries are generated catalogs, setup/recovery views, Timeline UI, and optional baseline-capability code. Do not defer core safety checks needed before addon execution.

### P1 — Baseline capability implementation

Implement one capability at a time in the encoded performance order. For each:

1. create a pure model and lifecycle owner;
2. create one cached structural Discord adapter;
3. prove zero work while disabled;
4. add idempotent start/stop tests;
5. add drift and teardown tests;
6. capture disposable runtime evidence;
7. add accessible settings;
8. change status to `ready` only after live acceptance.

Do not copy community plugin source without an explicit compatible license and provenance entry. Inspiration links define user value, not an implementation license.

### P1 — Resource ownership

Use `docs/audit/FULL_REPOSITORY_AUDIT.md` as the inventory. For every custom timer, observer, patch, listener, recorder, and synchronous filesystem call:

- identify its owner;
- identify start and stop boundaries;
- verify idempotence;
- verify account, route, and reload invalidation;
- determine whether it can move off the renderer path;
- add a targeted test where coverage is absent.

Prioritize runtime, Timeline, setup/recovery, Friend Watch, Audience Guard, and external editor paths.

### P2 — Upstream synchronization

Upstream `development` points to `b2b361ccd1b16b4f8162f3bf016396e5a1fa465d`, which merged missing site assets after the fork's upstream parent.

Create a dedicated sync branch. Compare the upstream asset change against Solcord's bundled editor/theme assets and preserve fork identity, updater ownership, packaged assets, preload and Activity boundaries, public `BdApi` behavior, tests, and migration receipts.

Run the complete Linux and Windows matrix after the sync. Do not combine upstream synchronization with Control Center decomposition or feature implementation.

## Smallest coherent next slice

The next slice after branch promotion is **live Windows acceptance plus release evidence**, not another feature batch:

1. build the exact promoted commit;
2. prepare a disposable Discord runtime and isolated data root;
3. run installer self-test and disposable acceptance;
4. launch Discord twice and validate Activity Bridge, settings, module lifecycle, and teardown;
5. record sanitized evidence;
6. fix only reproduced failures;
7. rerun source, Windows, installer, and live gates;
8. publish a new Solcord-named release after all gates pass.

After the release candidate is evidence-backed, start Control Center decomposition as a behavior-preserving refactor.

## Resume instructions

1. Read the [contributing guide](../../CONTRIBUTING.md).
2. Read this handoff.
3. Read `docs/audit/FULL_REPOSITORY_AUDIT.md`.
4. Read `docs/audit/PLUGIN_BASELINE_REVIEW.md`.
5. Compare the current branch with `development`.
6. Run:

```sh
bun install --frozen-lockfile
bun run verify
bun run dist
```

7. On Windows, run:

```powershell
bun run installer:candidate -- dist/solcord.asar "$env:TEMP\solcord-installer-candidate" "$(git rev-parse HEAD)"
```

8. Do not repeat the identity migration.
9. Do not restore the deleted sidecar installer builder.
10. Do not replace existing native capabilities with duplicate community files.
11. Do not claim skipped or live-only tests passed.
12. Keep disabled optional features at effectively zero runtime cost.
13. Update this handoff with exact evidence after a deeper slice.

## Definition of completion

A deeper item is complete only when the failure or cost is reproduced or measured, the smallest coherent change is implemented, adjacent behavior is tested, source gates pass, applicable Windows and live evidence is captured, cleanup is verified, documentation and provenance are updated, the branch is clean, and no unsupported working claim remains.
