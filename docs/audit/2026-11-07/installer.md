# Installer, launch and Electron boundaries

### I01 · P1 · The detached editor can operate on a path chosen by the document

[src/editor/preload.ts:13](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/editor/preload.ts#L13) derives the type and filename from the current document query. Lines 38–50 expose file read/write and clipboard reads. [src/electron/main/modules/editor.ts:39](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/electron/main/modules/editor.ts#L39) disables sandboxing and web security and allows insecure content. The page loads remote script at [src/editor/index.html:295](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/editor/index.html#L295). The navigation guard at [src/electron/main/modules/editor.ts:57](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/electron/main/modules/editor.ts#L57) is one-shot on one launch path. The editor IPC handler at [src/electron/main/modules/ipc.ts:191](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/electron/main/modules/ipc.ts#L191) does not validate the type or confine the filename. In a probe of the transpiled preload, a synthetic HTTPS document received the bridge and wrote a marker outside an isolated plugins folder. This verifies the primitive. Reachability via navigation in the distributed Electron client remains a desktop acceptance item.

**Fix and verify.** Bind the chosen file to an opaque main-process editor session; check sender, exact packaged editor document, kind, path ancestry and suffix. Start with restricted window preferences, bundle a local editor loader, restrict navigation/child windows, and expose only the necessary operations to that session. Exercise navigation, CDN outage, a sibling-directory target, a junction, and normal editing for all three editor types.

### I02 · P1 · The main process removes content security policy for every default-session response

[src/electron/main/index.ts:37](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/electron/main/index.ts#L37) invokes the removal for every non-vanilla startup. [src/electron/main/modules/csp.ts:14](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/src/electron/main/modules/csp.ts#L14) registers a default-session response callback with no URL or resource-type filter and deletes headers whose name starts with `content-security-policy`. Subframes and unrelated responses using that session lose both enforcement and report-only policies. Solcord has separate trusted-frame checks for its private IPC; those do not restore Chromium's content restrictions.

**Fix and verify.** Identify the exact resource types, origins and policy directives required by CSS injection and addon compatibility, then apply the smallest scoped change there. Preserve all unrelated headers and test real Discord media, Activities, optional community themes, and the editor. Assert an unrelated response and embedded origin retain their byte-identical policies.

### I03 · P1 · The installer paints and handles input on the same thread that waits for Discord to stop

[installer/Solcord.Installer/InstallerForm.cs:496](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/installer/Solcord.Installer/InstallerForm.cs#L496) disables buttons and calls the selected function synchronously. Install/repair/verify perform filesystem reads and hashes. [installer/Solcord.Installer/InstallerEngine.cs:852](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/installer/Solcord.Installer/InstallerEngine.cs#L852) polls live processes, and lines 887 and 893 include multi-second blocking waits per process. During a slow close or antivirus scan, the message pump cannot reliably paint the working state, repaint moved windows or handle input. A user may terminate the installer during a transaction.

**Fix and verify.** Make operations single-flight and run engine work off the UI thread. Snapshot the selected target before dispatch, marshal progress and errors back to the UI, keep the window responsive, and respect journal boundaries when handling close or cancellation. Test with a deliberately delayed process and slow filesystem. Verify paint/input latency and recovery after a forced process exit.

### I04 · P2 · The installer recommends opening a different channel or version than it verified

[installer/Solcord.Installer/InstallerForm.cs:386](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/installer/Solcord.Installer/InstallerForm.cs#L386) treats any selection as ready and uses a parameterless `VerifyInstalled` to display the exact installed state. [installer/Solcord.Installer/InstallerEngine.cs:312](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/installer/Solcord.Installer/InstallerEngine.cs#L312) verifies the target reconstructed from the receipt. `Launch` at line 466 checks the actual selection against that receipt. On Stable plus PTB, the UI can offer “Open Solcord” for PTB based on successful Stable verification and then fail. The same mismatch can occur after an update where the old app directory is still present.

**Fix and verify.** Derive availability, recommended action, verification text and launch from the same selected-target result. Test multiple channels and coexisting versions with a single receipt. Recovery for a recorded older target still needs an explicit route.

### I05 · P1 · Rolling back an update can leave the restored version unmanaged

[installer/Solcord.Installer/InstallerEngine.cs:230](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/installer/Solcord.Installer/InstallerEngine.cs#L230) journals prior core and injector bytes for the installation and line 256 replaces the current receipt. Successful rollback at lines 345–348 restores the bytes, deletes the loaded receipt and removes the launcher. The ordinary completed-update backup has no saved earlier current receipt. When updating an already-managed installation, its restored version can consequently lack verification, managed uninstall and its launcher. A rollback of a fresh install has a different correct end state.

**Fix and verify.** Snapshot prior receipt/launcher ownership in the update journal and restore both for a previously managed core. Preserve the existing clean-install rollback behavior. Verify install A → update B → roll back → verify/launch/uninstall A, including interruptions between core, injector and receipt operations.

### I06 · P2 · A staging-copy failure can leave an ambiguous recovery record

[installer/Solcord.Installer/InstallerEngine.cs:239](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/installer/Solcord.Installer/InstallerEngine.cs#L239) commits the pending receipt before copying the new artifact to a temporary path. The copy at line 242 is outside the cleanup try block beginning at line 245. Disk-full or sharing violations can leave a pending transaction and possible partial staging file even though no installed core or injector was replaced.

**Fix and verify.** Stage/capacity-check and verify the artifact before publishing an actionable receipt, or persist a precise pre-mutation phase and clean only owned staging data on failure. Preserve crash recovery when the first real mutation has occurred. Inject a pre-copy failure and an interrupted copy, restart the installer, and verify the original managed installation remains usable.


### I07 · P1 · Process interruption during uninstall can leave Discord unable to boot

[installer/Solcord.Installer/InstallerEngine.cs:429](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/installer/Solcord.Installer/InstallerEngine.cs#L429) begins deleting entry files before restoring the original archive to its startup location. The backup exists, but recovery in the catch runs only while that process is alive. A new uninstall invocation validates the original bootstrap before reaching the restore path at lines 368–388. A hard exit between these operations leaves neither the expected vanilla startup path nor a valid bootstrap for retry.

**Fix and verify.** Publish a durable uninstall journal before the first destructive operation and recover recognized intermediate states after a restart. Restore the host startup path safely as early as possible. Kill the actual disposable installer after each filesystem transition, then rerun, verify vanilla Discord launches and compare preserved addon/settings bytes.

### I08 · P1 · One managed receipt cannot represent two Discord channels using the shared core

[installer/Solcord.Installer/InstallerEngine.cs:208](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/installer/Solcord.Installer/InstallerEngine.cs#L208) computes the shared core destination under Roaming AppData. A repair can target another channel and line 256 overwrites the sole managed receipt. Uninstall later removes the shared payload at line 439. If the prior bootstrap still references it, a sequence of individually allowed actions can break the surviving channel. With identical bytes, a normal second install can instead be rejected before the new channel's bootstrap is created.

**Fix and verify.** Choose and enforce a single-target invariant before mutation, or track receipts by channel/version with shared core ownership and delete it only when no bootstrap depends on it. Update the selector, launch shortcut, rollback and uninstall together. Test Stable + Canary, install/repair/uninstall in both orders, followed by cold starts of both channels.

### I09 · P2 · Identical repairs create unbounded backup copies

[installer/Solcord.Installer/InstallerEngine.cs:216](https://github.com/celubos/Solcord/blob/9b3004ff8c25c9879803a6c07fa8b28d04731438/installer/Solcord.Installer/InstallerEngine.cs#L216) creates a new time/GUID-named backup and copies the existing core and injector. Repeated repairs never retire or reuse equivalent backup content. Disk usage grows even when no new release was installed.

**Fix and verify.** Deduplicate immutable content by hash, keep receipt-specific metadata, and apply a retention policy only after checking all current, pending and previous rollback references. Twenty same-version repairs should keep a working rollback and bounded retained core bytes.
