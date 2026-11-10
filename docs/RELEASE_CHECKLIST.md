# Solcord release checklist

Use this checklist for the GitHub package workflow. The separate [acceptance-evidence assembler](RELEASE_EVIDENCE_ASSEMBLY.md) retains its own archive layout and externally pinned `release-manifest.json` contract; its manifest is not interchangeable with `release-package.json`.

## Source, security and provenance

- [ ] The final source is clean, pushed, reachable from `main`, and its remote SHA is verified. Preserve all implementation and upstream history.
- [ ] Frozen dependencies, complete tests, lint, CSS baseline, types, declarations, reviewed dependency cycles, documentation and repository inventory checks pass.
- [ ] Review the security-sensitive diff: file boundaries, IPC/preloads, privacy/network behavior, installer ownership/recovery and release publication.
- [ ] No credentials, real message content, private account identifiers, local owner paths or profile captures appear in outgoing commits or public artifacts.
- [ ] Original contributor credits, dependency licenses, catalog pins and the provenance registry remain accurate.
- [ ] Product version, candidate label, package manifests, release notes and download links agree.
- [ ] The core updater remains fail-closed without Solcord-owned integrity metadata.

## Runtime qualification

- [ ] The 30-minute disposable soak completes with bounded caches/samples and no owned listeners, timers, patches, tracks or URLs after teardown.
- [ ] Compare the hot renderer paths with the prior release; record environment, median/p95, operation counts and exact source hashes.
- [ ] Repeated settings mount/navigation/unmount checks return subscriptions and callbacks to baseline.
- [ ] Controlled Chromium scenarios cover themes, short/narrow layouts, modern host colors, keyboard/focus, reduced motion, error states and scaling.
- [ ] The native installer remains usable while checks run; verify target refresh, stale-result rejection, complete error details and idle/busy close behavior.
- [ ] Preserve existing Strict Privacy choices. Record native acknowledgement and active adapter coverage without calling it a full network audit.
- [ ] Record live acceptance separately from fixtures and user-reported acceptance. Do not infer microphone, Mac startup or interactive rollback success from synthetic tests.

## Windows package

- [ ] Build from the exact clean source with the pinned Bun runtime and .NET SDK.
- [ ] The self-contained executable's embedded-resource self-test passes in an empty disposable directory.
- [ ] Install, update, repair, verify, rollback, interrupted recovery, uninstall and explicit launch paths have appropriate disposable coverage.
- [ ] The six Windows package files match their build receipt and manifests. Preserve the installer's original `SHA256SUMS.txt`.
- [ ] State the unsigned publisher status and recovery route. Never advise disabling Windows security.
- [ ] Retain existing profiles, plugins, themes, private stores, recovery material and normal Discord shortcuts.

## macOS preview

- [ ] Compile and run the self-contained installer on matching Apple Silicon and Intel macOS runners.
- [ ] Native compiled self-tests verify copied bundles, signatures, existing entitlements, extended attributes, recovery, and preserved source/profile bytes.
- [ ] Test the current official Discord bundle in a read-only mounted image and disposable installation, without launching Discord.
- [ ] The architecture receipt binds the ZIP digest and source SHA, records native validation, and explicitly says preview/not notarized.
- [ ] Preserve the original Discord bundle and security settings; do not remove quarantine, bypass Gatekeeper or require administrator access.
- [ ] Keep real Discord startup, microphone, keychain and update acceptance listed as unverified until separately demonstrated on a Mac.

## Publication and readback

- [ ] A fresh stable decision is supported by recorded qualification and the owner's publication request. Unsigned Windows distribution uses the independently authenticated `celubos/Solcord` GitHub repository, exact-commit Actions builds and downloadable SHA-256 manifests; this is not code signing.
- [ ] The release workflow's source, Windows and both native Mac jobs all pass.
- [ ] `prepare-solcord-release.ts` validates all source/version/architecture bindings and produces `release-package.json` plus `RELEASE-SHA256SUMS.txt`.
- [ ] Review the final release copy and artifact inventory. GitHub's tag source archives identify the same immutable source revision.
- [ ] Upload to a draft, verify every server-side asset name/size/digest, and validate the exact tag before making the release public.
- [ ] Resume only an exactly matching draft. Never overwrite an existing published version or mismatched asset.
- [ ] Read back the public release, tag SHA, notes, CI result, asset inventory and hashes. Preserve older packages unchanged.
