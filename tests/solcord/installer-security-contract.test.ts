// SPDX-License-Identifier: Apache-2.0

import {describe, expect, test} from "bun:test";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "../..");
const builderPath = path.join(root, "scripts", "build-solcord-v2-installer.mjs");
const obsoleteBuilderPath = path.join(root, "scripts", "build-solcord-installer.cjs");
const builder = fs.readFileSync(builderPath, "utf8");
const publisher = fs.readFileSync(path.join(root, "scripts/helpers/publish-directory.mjs"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const engine = fs.readFileSync(path.join(root, "installer/Solcord.Installer/InstallerEngine.cs"), "utf8");
const embeddedBundle = fs.readFileSync(path.join(root, "installer/Solcord.Installer/EmbeddedInstallerBundle.cs"), "utf8");
const selfTest = fs.readFileSync(path.join(root, "installer/Solcord.Installer/Program.cs"), "utf8");
const installerForm = fs.readFileSync(path.join(root, "installer/Solcord.Installer/InstallerForm.cs"), "utf8");
const launcher = fs.readFileSync(path.join(root, "installer/Solcord.Installer/SolcordLauncher.cs"), "utf8");
const installerProject = fs.readFileSync(path.join(root, "installer/Solcord.Installer/Solcord.Installer.csproj"), "utf8");
const installerReadme = fs.readFileSync(path.join(root, "installer/README.md"), "utf8");
const fullCi = fs.readFileSync(path.join(root, ".github/workflows/solcord-ci.yml"), "utf8");
const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8").split(/\r?\n/);

describe("Solcord installer security contracts", () => {
    test("routes candidate builds through the tested embedded-resource builder", () => {
        expect(packageJson.scripts["installer:candidate"]).toBe("bun scripts/build-solcord-v2-installer.mjs");
        expect(packageJson.scripts["release:evidence"]).toBe("bun scripts/assemble-solcord-release-evidence.mjs");
        expect(fs.existsSync(builderPath)).toBeTrue();
        expect(fs.existsSync(obsoleteBuilderPath)).toBeFalse();
    });

    test("rebuilds ignored dist output from the exact clean commit before packaging", () => {
        const remove = builder.indexOf("fs.rmSync(dist, {recursive: true})");
        const rebuild = builder.indexOf("spawnSync(process.execPath, [\"run\", \"dist\"]");
        const publish = builder.indexOf("const publish = spawnSync(\"dotnet\", [");
        expect(remove).toBeGreaterThan(0);
        expect(rebuild).toBeGreaterThan(remove);
        expect(publish).toBeGreaterThan(rebuild);
        expect(builder).toContain("The ASAR's embedded provenance does not match");
        expect(builder).toContain("The source changed while the installer was being built");
        expect(builder).toContain("Fresh build output changed while the installer was being built");
        expect(builder).toContain("\"--self-contained\", \"true\"");
        expect(builder).toContain("\"-p:PublishSingleFile=true\"");
        expect(builder).toContain("\"-r\", \"win-x64\"");
        expect(builder).toContain("the selected SDK could not be verified for a direct retry");
        expect(builder).toContain("-property:MSBuildEnableWorkloadResolver=false");
        expect(builder).toContain("-target:Publish");
        expect(builder).toContain("requireRegularFile(msbuild");
        expect(builder).toContain("The existing installer restore graph changed during the failed CLI publish");
        const directPublish = builder.slice(builder.indexOf("const directPublish"), builder.indexOf("publishStatus = directPublish.status"));
        expect(directPublish).not.toContain("\"-restore\"");
    });

    test("embeds the exact manifest-bound resources before publishing transparent release references", () => {
        expect(builder).toContain("-p:SolcordRequireEmbeddedBundle=true");
        expect(builder).toContain("SolcordEmbeddedArtifact");
        expect(builder).toContain("SolcordEmbeddedBuildManifest");
        expect(builder).toContain("SolcordEmbeddedInstallerManifest");
        expect(builder).toContain("entries.length !== 1");
        expect(builder).toContain("entries[0].name !== \"SolcordInstaller.exe\"");
        expect(builder).toContain("SHA256SUMS.txt");
        expect(builder).toContain("solcord-build-manifest.json");
        expect(builder).toContain("solcord-installer-manifest.json");
        expect(builder).toContain("solcord-installer-build-receipt.json");
        expect(builder).toContain("installerReceiptSha256");
        expect(builder).toContain("candidateLabel: postBuild.build.candidateLabel");
        expect(builder).toContain("schemaVersion: 7");
        expect(engine).toContain("build.GetProperty(\"candidateLabel\").GetString() == manifest.CandidateLabel");
        expect(engine).toContain("same-core install predates candidate labels");
        expect(engine).toContain("TryGetReleaseCandidateOrdinal");
        expect(engine).toContain("Candidate labels are immutable");
        expect(selfTest).toContain("same-core-rc-upgrade");
        expect(selfTest).toContain("discord-update-reinstall");
        expect(selfTest).toContain("startup handoff was not restored");
        expect(selfTest).toContain("owner data changed");
        expect(selfTest).toContain("same-core-rc-downgrade-refusal");
        expect(selfTest).toContain("candidate-label-reuse-refusal");
        expect(selfTest).toContain("malformed-candidate-label-refusal");
        expect(selfTest).toContain("rc.18446744073709551616");
        expect(selfTest).toContain("ulong.MaxValue");
        expect(builder).toContain("The release-candidate directory contains an unexpected file set");
        expect(builder).toContain("await publishGeneratedDirectory(staging, output)");
        expect(publisher).toContain("RETRYABLE_WINDOWS_RENAME_ERRORS");
        expect(publisher).toContain("The installer output directory appeared before publication completed");
        expect(publisher).not.toContain("copyFileSync");
        expect(builder.indexOf("const selfTest = spawnSync")).toBeLessThan(builder.indexOf("const publishedFiles"));
    });

    test("documents the complete review bundle and keeps generated evidence out of source status", () => {
        for (const file of [
            "SolcordInstaller.exe",
            "solcord.asar",
            "solcord-build-manifest.json",
            "solcord-installer-manifest.json",
            "solcord-installer-build-receipt.json",
            "SHA256SUMS.txt"
        ]) expect(installerReadme).toContain(file);
        expect(installerReadme).toContain("six-file review bundle");
        expect(gitignore).toContain("outputs/");
    });

    test("runs release checks for both main and development pushes and pull requests", () => {
        const compatibilityCi = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
        for (const workflow of [fullCi]) {
            for (const event of ["push", "pull_request"]) {
                const list = workflow.match(new RegExp(`  ${event}:\\r?\\n    branches: (\\[[^\\r\\n]+\\])`))?.[1];
                expect(list).toBeDefined();
                const branches = JSON.parse(list!);
                expect(branches).toContain("main");
                expect(branches).toContain("development");
            }
        }
        expect(compatibilityCi).toContain("workflow_dispatch:");
        expect(compatibilityCi).toContain("uses: ./.github/workflows/solcord-ci.yml");
        expect(compatibilityCi).not.toContain("bun run test");
        expect(fullCi).toContain("name: build");
        expect(fullCi).toContain("needs: verify");
        expect(fullCi).toContain("run: test \"$SOURCE_RESULT\" = success");
    });

    test("verifies embedded bytes before private extraction and cleans only known files", () => {
        const verify = embeddedBundle.indexOf("InstallerEngine.VerifyBundleBytes(manifest, artifact, buildManifest)");
        const extract = embeddedBundle.indexOf("WriteExclusive(Path.Combine(root, \"solcord.asar\"), artifact)");
        expect(verify).toBeGreaterThan(0);
        expect(extract).toBeGreaterThan(verify);
        expect(embeddedBundle).toContain("SetAccessRuleProtection(isProtected: true, preserveInheritance: false)");
        expect(embeddedBundle).toContain("FileMode.CreateNew");
        expect(embeddedBundle).toContain("FileShare.None");
        expect(embeddedBundle).toContain("FileOptions.WriteThrough");
        expect(embeddedBundle).toContain("bundle.LockExtractedFiles()");
        expect(embeddedBundle).toContain("FileAccess.Read, FileShare.Read");
        expect(embeddedBundle).toContain("foreach (string name in ExtractedFiles)");
        expect(embeddedBundle).not.toContain("Directory.Delete(root, recursive: true)");
    });

    test("runs self-test from an empty directory using only embedded resources", () => {
        expect(builder).toContain("cwd: validationRoot");
        expect(builder).toContain("fs.readdirSync(validationRoot).length !== 0");
        expect(selfTest).toContain("EmbeddedInstallerBundle.ExtractVerified()");
        expect(selfTest).toContain("InstallerSelfTest.Run(bundle.Root)");
        expect(selfTest).not.toContain("string bundle = Path.Combine(root, \"bundle\")");
    });

    test("presents distinct install, update, repair, rollback, and uninstall actions", () => {
        for (const action of ["Install Solcord", "Update Solcord", "Repair Solcord", "Roll back", "Uninstall Solcord"]) {
            expect(installerForm).toContain(JSON.stringify(action));
        }
        expect(installerForm).not.toContain("Repair / Update");
        expect(installerForm).not.toContain("Roll Back / Uninstall");
        expect(installerForm).toContain("AccessibleName = title");
        expect(installerForm).toContain("AutoScaleMode = AutoScaleMode.Dpi");
        expect(engine).toContain("internal InstallReceipt InstallNew");
        expect(engine).toContain("internal InstallReceipt Update");
        expect(engine).toContain("internal InstallReceipt Repair");
        expect(selfTest).toContain("separate-install-update-repair-actions");
    });

    test("uses one recommended action and a legible native setup and recovery flow", () => {
        expect(installerForm).toContain("ClientSize = new Size(900, 650)");
        expect(installerForm).toContain("MinimumSize = new Size(760, 600)");
        expect(installerForm.match(/AutoScroll = true/g)?.length).toBe(1);
        expect(installerForm).not.toContain("BuildBrandRail");
        expect(installerForm).not.toContain("BuildSignalPath");
        expect(installerForm).not.toContain("All operations");
        expect(installerForm).toContain("Solcord Setup");
        expect(installerForm).toContain("\"Recovery\"");
        expect(installerForm).toContain("_maintenanceList.Dock = DockStyle.Top");
        expect(installerForm).toContain("NewLabel(\"Version\"");
        expect(installerForm).toContain("$\"{target.Channel} · {target.Version}\"");
        expect(installerForm).toContain("new Size(112, 36)");
        expect(installerForm).toContain("primary-action-collapsed");
        expect(installerForm).toContain("maintenance-action-geometry");
        expect(installerForm).toContain("Built with BetterDiscord, created by @slaveofsolace.");
        expect(installerForm).not.toContain("@Sleeve of Solace");
        expect(installerForm).toContain("private static readonly Color BrandTile = Color.FromArgb(24, 37, 39);");
        expect(installerForm).toContain("_brandMarkHost.BackColor = BrandTile;");
        expect(installerForm).toContain("_brandMark.BackColor = BrandTile;");
        expect(installerForm).toContain("layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));");
        expect(installerForm).toContain("_brandMarkHost.Dock = DockStyle.Fill;");
        expect(installerForm).toContain("brand-mark-safe-area-collapsed");
        expect(installerForm).toContain("SizeType.AutoSize");
        expect(installerForm).not.toContain("visibleMaintenanceRows * 52");
        expect(installerForm).toContain("_statePanel.Invalidate()");
        expect(installerForm).toContain("ButtonTone.Primary");
        expect(installerForm).toContain("_recommendedKey");
        expect(installerForm).toContain("_targets.TabIndex = 0");
        expect(installerForm).toContain("_verifyAction.TabIndex = 5");
        expect(installerForm).toContain("Open recovery folder");
        expect(installerForm).toContain("MinimumSize = new Size(0, 44)");
        expect(installerForm).toContain("Height = 36");
        expect(installerForm).toContain("Color.White");
        expect(installerForm).toContain("\"Try again\"");
        expect(installerForm).not.toContain("\"No action available\"");
        expect(engine).toContain("_stopDiscordProcesses(running)");
        expect(engine).toContain("IsTrustedDiscordExecutable");
        expect(engine).toContain("process.Kill();");
        expect(engine).not.toContain("entireProcessTree");
        expect(engine).toContain("attempt < 30");
        expect(engine).toContain("_delay(100)");
        expect(selfTest).toContain("automatic-discord-stop-refusal");
        expect(selfTest).toContain("automatic-discord-stop-install");
        expect(installerForm).not.toContain("DISCORD, REWIRED.");
        expect(installerForm).not.toContain("ToolTip");
        expect(installerForm).toContain("ValidateGeometryMatrix");
        expect(installerForm).toContain("ValidateStableChrome");
        expect(installerForm).toContain("workspace-scroll-moved-fixed-chrome");
        expect(installerForm).toContain("new[] {96, 120, 144, 192}");
        expect(installerForm).toContain("new Size(760, 600), new Size(900, 650)");
        expect(selfTest).toContain("dpi-layout-matrix");
    });

    test("creates a receipt-bound first-setup handoff only for a verified first install", () => {
        expect(engine).toContain("internal sealed record SolcordFirstSetupIntent");
        expect(engine).toContain("WriteFirstSetupIntent(receipt)");
        expect(engine).toContain("first-setup-intent.json");
        expect(engine).toContain("Guid.NewGuid().ToString(\"N\")");
        const installNew = engine.slice(engine.indexOf("internal InstallReceipt InstallNew"), engine.indexOf("internal InstallReceipt Update"));
        const update = engine.slice(engine.indexOf("internal InstallReceipt Update"), engine.indexOf("internal InstallReceipt Repair"));
        const repair = engine.slice(engine.indexOf("internal InstallReceipt Repair"), engine.indexOf("internal bool VerifyInstalled"));
        expect(installNew).toContain("WriteFirstSetupIntent(receipt)");
        expect(update).not.toContain("WriteFirstSetupIntent");
        expect(repair).not.toContain("WriteFirstSetupIntent");
        expect(selfTest).toContain("first-setup-intent.json");
        expect(selfTest).toContain("File.ReadAllText(firstSetupIntent) != originalIntent");
        expect(selfTest).toContain("File.Exists(firstSetupIntent) || !engine.VerifyInstalled()");
    });

    test("checks a complete target before closing Discord and rechecks after shutdown", () => {
        const install = engine.slice(engine.indexOf("internal InstallReceipt Install("), engine.indexOf("internal InstallReceipt InstallNew"));
        const shutdown = install.indexOf("RequireAllDiscordStopped()");
        const firstValidation = install.indexOf("RequireReadyTarget(target)");
        const secondValidation = install.indexOf("RequireReadyTarget(target)", firstValidation + 1);
        expect(firstValidation).toBeGreaterThan(0);
        expect(firstValidation).toBeLessThan(shutdown);
        expect(secondValidation).toBeGreaterThan(shutdown);
        expect(secondValidation).toBeLessThan(install.indexOf("Directory.CreateDirectory"));
        expect(selfTest).toContain("numeric-version-selection-skips-incomplete-updates");
        expect(selfTest).toContain("invalid-target-must-not-close-discord");
        expect(selfTest).toContain("target-drift-after-close-must-abort-install");
        expect(selfTest).toContain("invalid-target-mutated-core-or-recovery-state");
    });

    test("keeps accessible action and status names in sync with the visible text", () => {
        expect(installerForm).not.toContain("AccessibleName = \"Recommended action\"");
        expect(installerForm).not.toContain("AccessibleName = \"Installation state details\"");
        expect(installerForm).toContain("ValidateAccessibleState(form, context)");
        expect(installerForm).toContain("action-name-mismatch");
        expect(installerForm).toContain("status-name-mismatch");
    });

    test("keeps recovery bound to its recorded Discord version after an upstream update", () => {
        const rollback = engine.slice(engine.indexOf("internal string RollBack("), engine.indexOf("internal string Uninstall("));
        const uninstall = engine.slice(engine.indexOf("internal string Uninstall("), engine.indexOf("internal void Launch("));
        for (const action of [rollback, uninstall]) {
            expect(action.indexOf("RequireRecordedTarget(target, receipt)")).toBeLessThan(action.indexOf("RequireAllDiscordStopped()"));
            expect(action.indexOf("RequireUnchangedReceipt(receiptFile, receiptHash)")).toBeGreaterThan(action.indexOf("RequireAllDiscordStopped()"));
        }
        expect(selfTest).toContain("rollback-recorded-version-after-discord-update");
        expect(selfTest).toContain("uninstall touched the newer Discord installation");
        expect(selfTest).toContain("receipt-bound-recovery-preflight-and-drift");
        expect(selfTest).toContain("receipt-encoding-compatibility");
    });

    test("verifies the reachable Electron loader and restores the original bootstrap transactionally", () => {
        const verify = engine.slice(engine.indexOf("internal bool VerifyInstalled"), engine.indexOf("internal string RollBack"));
        const launch = engine.slice(engine.indexOf("internal void Launch"), engine.indexOf("private void WriteFirstSetupIntent"));
        expect(verify).toContain("RequireWorkingInjector");
        expect(launch).toContain("!VerifyInstalled()");
        expect(engine).toContain("PrepareBootstrapRollback");
        expect(engine).toContain("OriginalModuleSha256");
        expect(engine).toContain("competing startup archives");
        expect(selfTest).toContain("electron-bootstrap-handoff-and-recovery");
        expect(selfTest).toContain("RC34 shadowed layout still verified");
        expect(selfTest).toContain("uninstall interruption did not restore the working loader");
        expect(selfTest).toContain("rollback retry did not restore a clean Discord startup");
    });

    test("creates a branded, owner-scoped Windows Search entry without replacing Discord shortcuts", () => {
        expect(launcher).toContain("Start Menu\", \"Programs");
        expect(launcher).toContain("Solcord.lnk");
        expect(launcher).toContain("Launch Discord with Solcord");
        expect(launcher).toContain("launcher.json");
        expect(launcher).toContain("An unrecognized Solcord launcher entry already exists");
        expect(launcher).toContain("EnsureSafePath(channelRoot, launchTarget)");
        expect(launcher).toContain("Marshal.FinalReleaseComObject");
        expect(engine).toContain("SolcordLauncher.Ensure");
        expect(engine).toContain("SolcordLauncher.Remove");
        const rollback = engine.slice(engine.indexOf("internal string RollBack"), engine.indexOf("internal string Uninstall"));
        expect(rollback).toContain("SolcordLauncher.Remove(_roamingAppData)");
        expect(rollback).toContain("state.PreviousLauncherRecorded");
        expect(installerForm).toContain("The previous installation and its ownership record were restored");
        expect(installerProject).toContain("Solcord.Installer.Resources.solcord.ico");
    });

    test("supports a bounded noninteractive update for an explicitly selected Discord channel", () => {
        expect(selfTest).toContain("args.Contains(\"--update\"");
        expect(selfTest).toContain("--update --channel Stable|PTB|Canary");
        expect(selfTest).toContain("args.Length != 3");
        expect(selfTest).toContain("engine.Update(target)");
        expect(selfTest).not.toContain("engine.Uninstall(target);\n            return 0;");
    });

    test("uses the reviewed Solcord mark for the window and executable", () => {
        expect(installerProject).toContain("<ApplicationIcon>..\\..\\assets\\branding\\icons\\solcord.ico</ApplicationIcon>");
        expect(installerProject).toContain("LogicalName=\"Solcord.Installer.Resources.solcord-mark.png\"");
        expect(installerForm).toContain("Solcord.Installer.Resources.solcord-mark.png");
        expect(fs.existsSync(path.join(root, "assets/branding/icons/solcord.ico"))).toBeTrue();
    });

    test("uninstalls only the recognized Solcord core and injector while preserving user data", () => {
        expect(engine).toContain("internal string Uninstall");
        expect(engine).toContain("The active injector is not owned by this Solcord installation");
        expect(engine).toContain("uninstall-backups");
        expect(engine).toContain("uninstall-state.json");
        expect(engine).not.toContain("Directory.Delete(appDirectory, recursive: true)");
        expect(selfTest).toContain("vanilla-uninstall-with-data-preservation");
        expect(selfTest).toContain("owner.plugin.js");
    });

    test("fails closed for an unsafe existing downgrade receipt", () => {
        expect(engine).toContain("if (!File.Exists(receipt)) return;");
        expect(engine).toContain("receiptInfo.Length is <= 0 or > 64 * 1024");
        expect(engine).toContain("update is held for review");
        expect(selfTest).toContain("upgrade-repair");
        expect(selfTest).toContain("same-version-repair");
        expect(selfTest).toContain("downgrade-refusal");
        expect(selfTest).toContain("older than the recorded Solcord install");
        expect(selfTest).toContain("oversized-receipt-refusal");
    });

    test("verifies stable core and injector backups before mutation", () => {
        expect(engine).toContain("The current core changed while its rollback backup was captured");
        expect(engine).toContain("The injector changed while its rollback backup was captured");
        expect(engine.indexOf("The current core changed while its rollback backup was captured")).toBeLessThan(engine.indexOf("File.Move(temporary, installed, overwrite: true)"));
    });

    test("keeps pending recovery, preserves unknown current core, and accepts a mixed retry state", () => {
        expect(engine).toContain("pending.json");
        expect(engine).toContain("The pending receipt was preserved for Roll Back");
        expect(engine).toContain("if (!candidatePresent && !priorPresent && !priorAbsent) throw new InvalidDataException");
        expect(engine).not.toContain("requireUnchangedInjector");
        expect(engine).toContain("install-after-core");
        expect(selfTest).toContain("automatic-recovery-owner-change");
        expect(selfTest).toContain("owner-changed-core");
        expect(engine).toContain("rollback-after-injector");
        expect(selfTest).toContain("partial-rollback");
    });
});
