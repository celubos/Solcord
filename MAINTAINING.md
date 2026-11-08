# Solcord Maintainer Guide

## Repository identity

- Fork: `celubos/Solcord`
- Upstream: `BetterDiscord/BetterDiscord`
- Release and contribution branch: `main`
- Upstream integration branch: `development`; keep it synchronized after a release
- Work branches: `sol/<short-change-name>`
- Package manager and runtime: Bun `1.4.0`

Preserve upstream Git history, attribution, public `BdApi` behavior, BetterDiscord addon paths, and compatibility identifiers unless a migration is explicit, bounded, documented, and tested.

## Runtime boundaries

Keep these surfaces separate:

1. Electron main process: window interception, injection, installer-facing state, IPC registration.
2. Preload: narrow privileged adapters and trusted-origin gates.
3. Renderer: BetterDiscord runtime, settings, addons, React surfaces, Webpack discovery.
4. Solcord common modules: pure models, validation, plans, receipts, and other unit-testable logic.
5. Solcord adapters: Discord-specific module discovery and patches. Adapter failure must disable only the affected feature.

Do not move privileged work into the renderer for convenience. Do not add global prototype patches when a lifecycle-scoped target is available.

## Commands

```sh
bun install --frozen-lockfile
bun run test
bun run lint
bun run lint-css:solcord
bun run typecheck
bun run generate-types
bun run circulars
bun run check:docs
bun run audit:repo
bun run audit:repo:check
bun run verify
bun run dist
```

`bun run dist` is a release gate and expects a clean, reproducible tree. Use `bun run verify` for deterministic source validation while developing.

## Generated files

- `src/common/solcord/addon-catalog.generated.ts`
- `assets/catalog/solcord-runtime-catalog.json`
- `assets/catalog/solcord-catalog.json`
- `assets/catalog/solcord-reviewed-addons.json`
- `docs/audit/FULL_REPOSITORY_AUDIT.md`

Regenerate these through their scripts. Do not hand-edit catalog output or commit `dist/`, `node_modules/`, Discord installations, local profiles, user data, secrets, downloaded addons, or environment-specific absolute paths.

## UI rules

- Reuse the Solcord semantic tokens and existing Discord-compatible components.
- Do not introduce one-off color, spacing, radius, or typography systems.
- Controls require visible focus, disabled, hover, and error states.
- Respect reduced motion and narrow containers.
- Optional feature code stays lazy; disabled features must not patch, observe, poll, or search Webpack.
- Prefer derived render values over effects. Use effects only for external synchronization and always return cleanup.
- Use stable keys and isolate failures with existing error boundaries.
- Measure before adding memoization or new caches.

## Performance rules

- Cache structural module discovery and invalidate deliberately.
- Avoid repeated full Webpack scans, React-tree walks, synchronous filesystem work, document-wide observers, and polling.
- Large generated catalogs must remain isolated from the initial renderer path.
- New baseline capabilities are default-off, lazy, and zero-cost while disabled.

## Wording and provenance

Write short, direct instructions. Describe the behavior, limits, and next action. Preserve third-party notices, licenses, source links, and implementation provenance.

## Reproduction and testing

Every behavioral correction needs:

- a reproduced failure or defensible static invariant;
- an automated regression test when practical;
- adjacent-behavior checks;
- explicit platform and live-client limitations;
- cleanup verification for patches, listeners, observers, timers, subscriptions, DOM, and cached references.

Never claim a live Discord, Windows installer, rollback, accessibility, or visual result passed without captured evidence.

Use `bun run test`, or include `--isolate` in focused `bun test` commands. Module mocks and singleton state must not leak between test files. Runner cleanup never replaces assertions about feature-owned resources.

## Upstream sync

1. Fetch current upstream `development` and record its SHA/date/version.
2. Rebase or merge in a dedicated sync branch.
3. Resolve identity, updater, installer, and Solcord suite conflicts deliberately.
4. Run the full verification matrix.
5. Update audit and handoff documents when architecture or risk changes.

## Definition of done

A batch is complete only when source tests, lint, CSS lint, TypeScript, public types, audit freshness, and applicable packaging pass; the branch is clean; compatibility assumptions are documented; and unresolved live-environment work has exact reproduction steps and acceptance criteria.
