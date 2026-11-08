# Contributing

Start from `main`. Keep fixes focused and preserve BetterDiscord's public APIs, addon paths, upstream history, and notices. The `development` branch is retained for upstream integration and stays synchronized at release checkpoints.

## Set up

Install Git and the pinned **Bun 1.4.0** runtime. The **.NET 8 SDK** is needed only to build the Windows installer.

```sh
git clone --branch main https://github.com/celubos/Solcord.git
cd Solcord
git switch -c sol/your-change
bun install --frozen-lockfile
bun run verify
```

Use `bun run build` for a local development build. It does not install anything or restart Discord.

`bun run generate-types` is the supported TypeScript-aware API declaration generator. The obsolete `api` command used an undeclared JavaScript-only documentation tool and has been retired. TypeScript, Happy DOM, and lint tooling are declared directly as development dependencies; frozen installation must not depend on their incidental transitive presence.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `src/common/solcord/` | Settings models, validation, policies, and other runtime-independent code |
| `src/betterdiscord/modules/solcord/` | Built-in features, Discord adapters, and lifecycle management |
| `src/betterdiscord/ui/solcord/` | Control Center and shared controls |
| `src/betterdiscord/styles/` | Shared styling and theme integration |
| `src/electron/` | Main-process and preload boundaries |
| `installer/` | Windows installer and recovery |
| `assets/` | Branding, bundled themes, and reviewed catalogs |
| `tests/` | Behavioral, policy, lifecycle, and packaging tests |
| `scripts/` | Build, verification, catalog, and release tools |
| `docs/` | User guides, architecture, and release procedures |
| `docs/archive/` | Historical evidence; not current installation guidance |

Check the relevant source before making a change. [Maintaining Solcord](MAINTAINING.md) covers architecture, compatibility, and release rules.

## Tests and checks

```sh
bun run test
bun run lint
bun run lint-css:solcord
bun run lint-css:baseline
bun run typecheck
bun run generate-types
bun run circulars
bun run check:docs
git diff --check
```

`bun run test` isolates each test file. This matters for module mocks and singleton stores: `mock.restore()` does not remove a `mock.module()` override. Keep assertions for resource teardown inside each test; test-runner cleanup is not proof that a feature disposed correctly.

For a focused run, keep the same isolation boundary:

```sh
bun test --isolate tests/solcord/plugin-doctor.test.ts
```

Do not rely on another file's mocks, environment changes, or test order. Use controlled fixtures instead of a signed-in account.

After changing tracked files, stage the intended paths and regenerate the repository inventory:

```sh
bun run audit:repo
bun run verify
```

Review the generated report and stage it with your change. `bun run dist` is the production gate and intentionally refuses a dirty tree; run it after committing the reviewed source or in a clean worktree.

## Implementation rules

- Keep privileged filesystem and encryption work out of the renderer.
- Validate Discord module shapes before patching them. Adapter failure must affect only that feature.
- Disabled features must not search Webpack, patch, observe, poll, or access storage.
- Own every listener, observer, timer, patch, and child resource; prove repeated start and stop are safe.
- Preserve settings and private data. A failed write must not look like a successful save.
- Use existing controls and theme tokens. Check focus, disabled states, reduced motion, narrow layouts, and long labels.
- Keep optional network providers and private history off until the user consents.
- Do not automate messages, uploads, relationships, calls, streams, account changes, or entitlements.

## Third-party work

Before importing code or assets, record the source, revision, license, required notices, and modifications in the [provenance registry](docs/PROVENANCE_REGISTRY.md). Attribution alone does not replace permission. Public source is not automatically reusable.

Do not include tokens, private messages, account identifiers, local user paths, or personal screenshots in fixtures, logs, issues, or commits.

## Pull requests

Describe the problem, the fix, and the checks you actually ran. List anything not tested. Include screenshots for visible changes and recovery steps for changes that touch installation or persistence.

Passing source tests is not desktop acceptance. Use the [desktop test checklist](docs/development/DESKTOP_TESTING.md) for live changes and the [release checklist](docs/RELEASE_CHECKLIST.md) before publishing.

## Upstream compatibility

Solcord is based on [BetterDiscord/BetterDiscord](https://github.com/BetterDiscord/BetterDiscord), under Apache-2.0. Preserve upstream authorship and compatibility. Keep upstream synchronization separate from unrelated product changes.
