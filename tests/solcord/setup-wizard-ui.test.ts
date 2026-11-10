// SPDX-License-Identifier: Apache-2.0

import {describe, expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {panelHandlerFixture, runtimeMethodFixture} from "../fixtures/solcord-method-fixture";
import {normalizeSolcordProductPreferences} from "../../src/common/solcord/product";
import {planSolcordPreferenceEffects} from "../../src/common/solcord/preference-effects";


const REPOSITORY_ROOT = resolve(import.meta.dir, "../..");
const WIZARD_SOURCE = readFileSync(resolve(REPOSITORY_ROOT, "src/betterdiscord/ui/solcord/setup-wizard.tsx"), "utf8");
const WIZARD_CSS = readFileSync(resolve(REPOSITORY_ROOT, "src/betterdiscord/styles/solcord.css"), "utf8").replace(/\r\n/g, "\n");
const CATALOG_SOURCE = readFileSync(resolve(REPOSITORY_ROOT, "src/betterdiscord/ui/solcord/catalog.ts"), "utf8");
const PRODUCT_SOURCE = readFileSync(resolve(REPOSITORY_ROOT, "src/common/solcord/product.ts"), "utf8");
const PANEL_SOURCE = readFileSync(resolve(REPOSITORY_ROOT, "src/betterdiscord/ui/solcord/panel.tsx"), "utf8");
const RUNTIME_SOURCE = readFileSync(resolve(REPOSITORY_ROOT, "src/betterdiscord/modules/solcord/runtime.ts"), "utf8");
const SCROLL_SOURCE = readFileSync(resolve(REPOSITORY_ROOT, "src/betterdiscord/ui/solcord/scroll-owner.ts"), "utf8");
const SWITCH_SOURCE = readFileSync(resolve(REPOSITORY_ROOT, "src/betterdiscord/ui/solcord/switch.tsx"), "utf8");

function stepLabels(): string[] {
    const declaration = PRODUCT_SOURCE.match(/SOLCORD_SETUP_STEPS = Object\.freeze\(\[([^\]]+)] as const\)/s)?.[1];
    if (!declaration) throw new Error("Solcord wizard step declaration is missing.");
    return [...declaration.matchAll(/"([^"]+)"/g)].map(match => match[1]);
}

describe("Solcord beginner-first setup UI", () => {
    test("uses five resumable novice steps with private-history consent and no Power Lab page", () => {
        expect(stepLabels()).toEqual(["Welcome", "Privacy", "Appearance", "Features", "Review and Apply"]);
        expect(WIZARD_SOURCE).toContain("<DisclosureSummary title=\"Optional private history\" detail=\"Off by default · local, account-scoped, and clearable\" />");
        expect(WIZARD_SOURCE).toContain("SolcordSettings.setOnboardingStep(bounded)");
        expect(WIZARD_SOURCE).not.toContain("function PowerLabStep");
        expect(WIZARD_SOURCE).not.toContain("SOLCORD_POWER_LAB");
        expect(WIZARD_SOURCE).not.toContain("Request all 36");
        expect(WIZARD_SOURCE).toContain("SolcordSettings.setSetupDraft(draft)");
        expect(WIZARD_SOURCE).toContain("The durable draft was left unchanged");
        expect(WIZARD_SOURCE).toContain("Solcord could not save this setup step");
        expect(WIZARD_SOURCE).toContain("scrollSolcordSettingsTarget(wizardRef.current, \"target\")");
        expect(WIZARD_SOURCE).toContain("SolcordRuntime.acknowledgeFirstSetupIntent()");
        expect(RUNTIME_SOURCE).toContain("this.#withPrivateCapability(capability => boundedSolcordStartupOperation(TIMELINE_IPC.claimFirstSetupIntent(capability)))");
        expect(RUNTIME_SOURCE).toContain("this.#withPrivateCapability(capability => boundedSolcordStartupOperation(TIMELINE_IPC.acknowledgeFirstSetupIntent(capability, intentId)))");
        expect(RUNTIME_SOURCE).not.toContain("boundedSolcordStartupOperation(this.#withPrivateCapability(capability => TIMELINE_IPC.claimFirstSetupIntent(capability)))");
        expect(SCROLL_SOURCE).toContain("findSolcordSettingsScrollOwner(target)");
        expect(SCROLL_SOURCE).toContain("/^(auto|scroll|overlay)$/.test(getComputedStyle(candidate).overflowY)");
        expect(SCROLL_SOURCE).toContain("mode === \"upward-only\" && desired >= owner.scrollTop");
        expect(SCROLL_SOURCE).toContain("owner.scrollTo({top: desired, behavior: \"auto\"})");
        expect(SCROLL_SOURCE).not.toContain("scrollIntoView");
        expect(SCROLL_SOURCE).not.toContain("globalThis.scrollBy");
        expect(WIZARD_SOURCE).toContain("<section ref={wizardRef} className=\"solcord-wizard\"");
        expect(WIZARD_SOURCE).toContain("role=\"progressbar\"");
        expect(WIZARD_CSS).toContain(".solcord-wizard-steps { box-sizing: border-box; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); width: 100%; min-width: 0; max-width: 100%");
        expect(WIZARD_CSS).toContain(".solcord-wizard-steps li { box-sizing: border-box; width: auto; min-width: 0; max-width: 100%; overflow: hidden; }");
        expect(WIZARD_CSS).toContain(".solcord-wizard-steps button { position: relative; box-sizing: border-box;");
        expect(WIZARD_CSS).not.toContain(".solcord-wizard-steps { display: flex");
        expect(WIZARD_CSS).not.toContain(".solcord-wizard-steps { overflow-x: auto");
        expect(WIZARD_CSS).toContain("var(--brand-500, var(--button-filled-brand-background");
    });

    test("mounts only the active step and gives collapsed setup sections meaningful summaries", () => {
        expect(WIZARD_SOURCE).toContain("const stepContent = [");
        expect(WIZARD_SOURCE).toContain("<div key={step} className=\"solcord-wizard-current-step\" role=\"group\"");
        expect(WIZARD_SOURCE).not.toContain("{step === 0 &&");
        expect(WIZARD_SOURCE).not.toContain("{step === 4 &&");
        expect(WIZARD_SOURCE).toMatch(/Performance details" detail=\{`\$\{policy\.effectiveMotion\} motion/);
        expect(WIZARD_SOURCE).toContain("Activities compatibility check\" detail=\"Policy status only · no Activity is launched during setup\"");
        expect(WIZARD_CSS).toContain(".solcord-disclosure-summary > span { display: grid; gap: 2px; min-width: 0;");
    });

    test("keys responsive layout to the actual settings content container", () => {
        expect(WIZARD_CSS).toContain("container: solcord-panel / inline-size; width: min(100%, 1180px); min-width: 0; max-width: 100%");
        expect(WIZARD_CSS).toContain("padding: 0 clamp(20px, 2.8vw, 34px) 52px");
        expect(WIZARD_CSS).toContain("@container solcord-panel (max-width: 720px)");
        expect(WIZARD_CSS).toContain(".solcord-wizard-steps { width: calc(100% - 24px); margin-right: 12px; margin-left: 12px; }");
        expect(WIZARD_CSS).toContain(".solcord-workspace-nav-list { display: none; }");
        expect(WIZARD_CSS).toContain(".solcord-workspace-search { display: none; }");
        expect(WIZARD_CSS).toContain(".solcord-workspace-menu { position: relative; display: block; width: max-content; max-width: 100%; margin-left: auto; }");
        expect(WIZARD_CSS).toContain(".solcord-workspace-nav { position: static; z-index: auto;");
        expect(WIZARD_CSS).toContain(".solcord-workspace { scroll-margin-top: 12px; }");
        expect(WIZARD_CSS).toContain(".solcord-workspace { min-width: 0; padding-top: 12px; }");
        expect(PANEL_SOURCE).toContain("scrollSolcordSettingsTarget(workspaceRef.current, \"upward-only\")");
        expect(PANEL_SOURCE).not.toContain("scrollIntoView");
        expect(PANEL_SOURCE).not.toContain("globalThis.scrollBy");
        expect(SWITCH_SOURCE).toContain("role=\"switch\"");
        expect(SWITCH_SOURCE).toContain("solcord-switch-track");
        expect(SWITCH_SOURCE).toContain("solcord-switch-thumb");
        expect(WIZARD_CSS).toContain(".solcord-switch-thumb { position: absolute;");
        expect(WIZARD_CSS).toContain("background: #FFFFFF;");
        expect(WIZARD_CSS).not.toContain("input[type=\"checkbox\"]::after");
        expect(WIZARD_CSS).toContain("@container solcord-panel (max-width: 760px)");
        expect(WIZARD_CSS).toContain("@container solcord-panel (max-width: 680px)");
        expect(WIZARD_CSS).toContain("@container solcord-panel (max-width: 520px)");
        expect(WIZARD_CSS).toContain(".solcord-wizard-steps { width: calc(100% - 28px); margin-right: 14px; margin-left: 14px; }");
        expect(WIZARD_CSS).toContain(".solcord-panel { padding-right: 14px; padding-left: 14px; }");
        expect(WIZARD_CSS).toContain("@media (max-width: 640px)");
        expect(WIZARD_CSS).toContain("[class*=\"container_\"]:has(.solcord-panel) > aside[class*=\"sidebar_\"] { display: none; }");
        expect(WIZARD_CSS).toContain("[class*=\"container_\"]:has(.solcord-panel) > [class*=\"content_\"] { flex: 1 1 auto; min-width: 0; }");
        expect(WIZARD_CSS).toContain("[class*=\"contentBody_\"]:has(.solcord-panel) > [class*=\"scroller_\"],");
        expect(WIZARD_CSS).toContain("[class*=\"contentRegion_\"]:has(.solcord-panel)");
        expect(WIZARD_CSS).toContain("[class*=\"contentRegionScroller_\"]:has(.solcord-panel)");
        expect(WIZARD_CSS).toContain("[class*=\"contentColumn_\"]:has(.solcord-panel)");
        expect(WIZARD_CSS).toContain("[class*=\"customColumn_\"]:has(.solcord-panel)");
        expect(WIZARD_CSS).toContain("{ box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%; }");
    });

    test("applies explicit appearance modes to Discord instead of only recoloring the Solcord panel", () => {
        expect(WIZARD_CSS).toContain("html:not([data-solcord-mode=\"follow-discord\"])[data-solcord-mode] :is(body, #app-mount, .theme-dark, .theme-darker, .theme-midnight, .theme-light)");
        expect(WIZARD_CSS).toContain("--background-base-lowest: var(--sc-app-surface-0)");
        expect(WIZARD_CSS).toContain("--chat-background-default: var(--sc-app-surface-0)");
        expect(WIZARD_CSS).toContain("--modal-background: var(--sc-app-surface-1)");
        expect(WIZARD_CSS).toContain("background-color: var(--sc-app-surface-0) !important");
        expect(WIZARD_CSS).toContain("body::before");
        expect(WIZARD_CSS).toContain("--sc-field-grain: url(\"data:image/svg+xml");
        for (const mode of ["solcord-dark", "solcord-light", "oled"]) {
            const block = WIZARD_CSS.match(new RegExp(`html\\[data-solcord-mode="${mode}"\\] \\{([^}]+)}`, "s"))?.[1];
            expect(block).toBeDefined();
            expect(block).toContain("--sc-app-surface-0:");
            expect(block).toContain("--sc-app-surface-1:");
            expect(block).toContain("--sc-app-surface-2:");
            expect(block).toContain("--sc-app-text:");
            expect(block).toContain("--sc-app-muted:");
            expect(block).toContain("--sc-app-border:");
            expect(block).toContain(`color-scheme: ${mode === "solcord-light" ? "light" : "dark"}`);
        }
        expect(WIZARD_CSS).toContain("html:not([data-solcord-accent=\"system\"])[data-solcord-accent] :is(#app-mount, .theme-dark, .theme-darker, .theme-midnight, .theme-light)");
        expect(WIZARD_CSS).toContain("html[data-solcord-density=\"compact\"] #app-mount");
        expect(WIZARD_CSS).toContain("html[data-solcord-message-shape=\"seamed\"] #app-mount");
        expect(WIZARD_CSS).toContain("html[data-solcord-motion=\"reduced\"] #app-mount *");
        expect(WIZARD_CSS).toContain(".solcord-panel select option");
        expect(WIZARD_CSS).toContain("color: #F2EADF; background: #202528");
        expect(WIZARD_CSS).toContain("html[data-solcord-mode=\"solcord-light\"] .solcord-panel select option");
        expect(WIZARD_CSS).toContain("color: #24211F; background: #EBE2D5");
    });

    test("renders only accepted ready tools and directs pending work to the catalog", () => {
        expect(WIZARD_SOURCE).toContain("addons: group.addons.filter(addon => isReadyDecision(decisions.get(addon.name)))");
        expect(WIZARD_SOURCE).toContain("const pendingDecisions = useMemo");
        expect(WIZARD_SOURCE).toContain("Advanced choices come later");
        expect(WIZARD_SOURCE).toContain("Extensions can review community files with a separate backup and rollback preview.");
        expect(WIZARD_SOURCE).toContain("Apply and verify");
        expect(WIZARD_SOURCE).not.toContain("onReviewPending");
        expect(PANEL_SOURCE).toContain("<CatalogBrowser />");
        expect(PANEL_SOURCE).toContain("<SetupWizard />");
        expect(WIZARD_SOURCE).toContain("catalog candidates still need a runtime or security gate");
        expect(WIZARD_SOURCE).toContain("Anything unavailable stays off.");
        expect(WIZARD_SOURCE).toContain(">Recommended</button>");
        expect(WIZARD_SOURCE).toContain("Runtime check pending");
        expect(WIZARD_SOURCE).not.toContain("{decision.statusLabel}");
        expect(WIZARD_CSS).toContain(".solcord-addon-group { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 22px;");
        expect(WIZARD_CSS).toContain("padding: 4px 0 0; border: 0;");
        expect(WIZARD_CSS).not.toContain(".solcord-addon-group { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 22px; margin: 0; padding: 14px 0 0; border: 0; border-top");
        expect(WIZARD_CSS).not.toContain(".solcord-addon-group { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 16px;");
        expect(WIZARD_SOURCE).toContain("Pending tools stay uninstalled");
        expect(PANEL_SOURCE).toContain("Optional files not installed");
        const catalogSource = readFileSync(resolve(REPOSITORY_ROOT, "src/betterdiscord/ui/solcord/addon-catalog.tsx"), "utf8");
        expect(catalogSource).toContain("optional file(s) absent");
        expect(catalogSource).toContain("visibleSolcordCommunityGroups(SOLCORD_ADDON_GROUPS, state.addons)");
        expect(catalogSource).toContain("<summary>Technical details</summary>");
        expect(catalogSource).not.toContain("clean-room built-in");
        expect(catalogSource).toContain("label={presentation.label} checked={addon.enabled}");
        expect(catalogSource).not.toContain("\"not staged\"");
        expect(WIZARD_SOURCE).toContain("Keep display snapshots");
        expect(WIZARD_SOURCE).toContain("Friend Watch notification mode");
        expect(WIZARD_SOURCE).toContain("These features are off by default.");
        expect(WIZARD_SOURCE).not.toContain("this wizard does not change its policy");
        expect(WIZARD_SOURCE).not.toContain("addonModes: {...current.addonModes, SplitLargeMessages: \"guarded\"}");
    });

    test("keeps eleven theme choices, recommends Solcord Default, and preserves a no-change exit", () => {
        expect(WIZARD_SOURCE).toContain("\"solcord-default\": \"Recommended");
        expect(WIZARD_SOURCE).toContain("SOLCORD_THEMES.map(theme");
        expect(WIZARD_SOURCE).toContain("Nothing changes until Apply.");
        expect(WIZARD_SOURCE).toContain("Finish later");
        expect(WIZARD_SOURCE).toContain("SolcordSettings.skipOnboarding()");
        expect(WIZARD_SOURCE).toContain("current.selectedAddons.filter(name => !readyNames.has(name))");
        expect(PANEL_SOURCE).toContain("[onboarding.status, workspace]");
    });

    test("moves reversible provider replacement out of first setup and into Extensions", () => {
        expect(WIZARD_SOURCE).toContain("Existing community plugins stay untouched");
        expect(WIZARD_SOURCE).toContain("{migrateProviders: false}");
        expect(WIZARD_SOURCE).not.toContain("prepareProviderMigrationPlan");
        expect(PANEL_SOURCE).toContain("Replace duplicate plugins");
        expect(PANEL_SOURCE).toContain("SolcordRuntime.prepareProviderMigrationPlan(state.draft)");
        expect(PANEL_SOURCE).toContain("SolcordRuntime.finishSetup(state.draft, confirmedPlan)");
        expect(PANEL_SOURCE).toContain("move only these reviewed files to a timestamped rollback archive");
        expect(PANEL_SOURCE).toContain("Rollback latest migration");
        expect(PANEL_SOURCE).toContain("BDFDB retires last only if no remaining addon uses it");
        expect(PANEL_SOURCE).toContain("BDFDB is rechecked and retires last only when no remaining addon uses it");
        expect(PANEL_SOURCE).toContain("dependency rechecked last");
        expect(RUNTIME_SOURCE).toContain("const standaloneFileName = solcordStandaloneProviderFileName(entry.name)");
        expect(RUNTIME_SOURCE).toContain("const standaloneFileName = solcordStandaloneProviderFileName(migration.name)");
        expect(RUNTIME_SOURCE).toContain("SetupProviderMigrationConfirmationChanged");
        expect(RUNTIME_SOURCE).toContain("solcordV2ArchiveReceiptMatchesPreview(archived.archived, preview.records)");
        expect(RUNTIME_SOURCE).toContain("providerArchiveFiles = archivedRecords.map(record => record.fileName)");
        expect(RUNTIME_SOURCE).not.toContain("providerArchiveFiles = [...new Set(replacementReadyFiles)]");
        expect(RUNTIME_SOURCE.indexOf("providerArchiveTransactionId = archived.transactionId")).toBeLessThan(RUNTIME_SOURCE.indexOf("solcordV2ArchiveReceiptMatchesPreview(archived.archived, preview.records)"));
        expect(RUNTIME_SOURCE).toContain("solcordV2QuarantineIdsForArchivedFiles(providerArchiveFiles)");
    });

    test("keeps dependency retirement opt-in and counts disabled external consumers", () => {
        expect(RUNTIME_SOURCE).toContain("if (migrateProviders && resolveCommunityAddon(PluginManager, \"BDFDB\", \"0BDFDB.plugin.js\"))");
        const consumerScan = RUNTIME_SOURCE.slice(RUNTIME_SOURCE.indexOf("const retainedBdfdbConsumers ="), RUNTIME_SOURCE.indexOf("const preview = await this.#withPrivateCapability", RUNTIME_SOURCE.indexOf("const retainedBdfdbConsumers =")));
        expect(consumerScan).toContain("!replacementFiles.has(addon.filename)");
        expect(consumerScan).not.toContain("isEnabled(");
        expect(consumerScan).toContain("\"Unreviewed external plugin\"");
    });

    test("describes the clean-room interaction tools without claiming unavailable choices or automatic sends", () => {
        expect(CATALOG_SOURCE).toContain("Suppresses one validated outgoing typing-start path while the built-in is enabled.");
        expect(CATALOG_SOURCE).not.toContain("Stops typing indicators unless you choose otherwise.");
        expect(CATALOG_SOURCE).toContain("Guarded mode previews bounded chunks for manual copy without sending.");
    });

    test("keeps Attachment Guard truthful and gives its setup switch a visible effect", () => {
        expect(WIZARD_SOURCE).toContain("<strong>Attachment review</strong>");
        expect(WIZARD_SOURCE).toContain("Inspect a file locally before upload. Solcord never submits it for you.");
        expect(WIZARD_SOURCE).not.toContain("Require a local review before opening high-risk file types.");
        expect(PANEL_SOURCE).toContain("productPreferences.safety.attachmentGuard && <AttachmentGuardWorkbench />");
    });

    test("keeps Fake Deafen visible and preserves an active community provider", () => {
        const fakeDeafenPanel = PANEL_SOURCE.slice(PANEL_SOURCE.indexOf("function FakeDeafenControls"), PANEL_SOURCE.indexOf("export default function SolcordPanel"));
        expect(PANEL_SOURCE).toContain("Optional files not installed");
        expect(PANEL_SOURCE).not.toContain("<dt>Not staged</dt>");
        expect(RUNTIME_SOURCE).toContain("toggleFakeDeafenDirect()");
        const runtimeStart = RUNTIME_SOURCE.slice(RUNTIME_SOURCE.indexOf("async start(): Promise<boolean>"), RUNTIME_SOURCE.indexOf("async completeStartup(): Promise<void>"));
        expect(runtimeStart).toContain("this.#ensureFakeDeafenButton()");
        expect(fakeDeafenPanel).toContain("F</strong>-badged button immediately beside normal Deafen");
        expect(fakeDeafenPanel).toContain("A direct built-in control beside Discord's normal Deafen button.");
        expect(fakeDeafenPanel).not.toContain("Arm for this call");
        expect(PANEL_SOURCE).not.toContain("Experimental · account risk</p><FakeDeafenControls");
        expect(PANEL_SOURCE).toContain("community plugin active");
        expect(PANEL_SOURCE).toContain("does not stack a second gateway patch");
        expect(RUNTIME_SOURCE).toContain("fakeDeafenProvider()");
        expect(CATALOG_SOURCE).toContain("Voice Anchor / Anti-AFK");
        expect(CATALOG_SOURCE).toContain("Unavailable in the V2 release candidate.");
        expect(PANEL_SOURCE).toContain("state.privateState.storage.persistent");
        expect(PANEL_SOURCE).toContain("Encrypted storage is available. Enable the adapter while signed in to load this account's private list.");
        expect(PANEL_SOURCE).not.toContain("Denylist persistence is unavailable; entries remain session-only.\"");
        expect(RUNTIME_SOURCE).toContain("await this.#refreshAudienceGuardStorageStatus()");
        expect(RUNTIME_SOURCE).not.toContain("Audience Guard policy is unloaded while the adapter is stopped.");
    });

    test("distinguishes disabled Friend Watch storage from an active session-only fallback", () => {
        expect(PANEL_SOURCE).toContain("Off. No relationship history is stored.");
        expect(PANEL_SOURCE).toContain("On. History is encrypted, local, and isolated to this account.");
        expect(PANEL_SOURCE).toContain("On for this session only. Persistent storage is unavailable.");
        expect(PANEL_SOURCE).toContain("state.persistent");
    });

    test("keeps compact setup navigation readable and accessible without repeated headings", () => {
        expect(WIZARD_SOURCE).toMatch(/aria-label=\{`\$\{index \+ 1\}\. \$\{label\}\$\{index === step \? ", current step" : ""\}`\}/);
        expect(WIZARD_SOURCE).toContain("<h3>Choose your look</h3>");
        expect(WIZARD_SOURCE).toContain("<h3>Check your choices</h3>");
        expect(WIZARD_SOURCE).not.toContain("<h3>Appearance</h3>");
        expect(WIZARD_SOURCE).not.toContain("<h3>Review and apply</h3>");
        expect(WIZARD_CSS).toContain("@container solcord-panel (max-width: 680px)");
        expect(WIZARD_CSS).toContain(".solcord-wizard-steps button span:last-child { display: none; }");
    });

    test("uses one setup rail and whitespace instead of nested divider boxes", () => {
        expect(WIZARD_CSS).toContain(".solcord-wizard {\n    box-sizing: border-box;\n    width: 100%;\n    min-width: 0;\n    max-width: 100%;\n    overflow: hidden;\n    contain: inline-size;");
        expect(WIZARD_CSS).toContain(".solcord-wizard > *,\n.solcord-wizard-current-step,\n.solcord-wizard-body,\n.solcord-wizard-body > * { box-sizing: border-box; min-width: 0; max-width: 100%; }");
        expect(WIZARD_CSS).toContain(".solcord-wizard-steps { box-sizing: border-box; display: grid;");
        expect(WIZARD_CSS).toContain("border-bottom: 1px solid var(--border-subtle)");
        expect(WIZARD_CSS).toContain(".solcord-control-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; }");
        expect(WIZARD_CSS).toContain(".solcord-control-grid label:hover { background: var(--sc-surface-1); }");
        for (const obsolete of [
            ".solcord-wizard-body + .solcord-wizard-body { min-height: 0; padding-top: 8px; border-top",
            ".solcord-features-advanced { margin: 0 0 18px; border-block",
            ".solcord-apply-summary { margin-bottom: 18px; padding: 12px 0; border-block",
            ".solcord-control-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-block",
            ".solcord-control-grid label:nth-child(even) { padding-left: 16px; border-left",
            ".solcord-choice-grid-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-block"
        ]) expect(WIZARD_CSS).not.toContain(obsolete);
    });

    test("makes appearance choices visible before setup is applied", () => {
        expect(WIZARD_SOURCE).toMatch(/solcord-mode-\$\{appearance\.mode\}/);
        expect(WIZARD_SOURCE).toMatch(/solcord-preview-shape-\$\{appearance\.messageShape\}/);
        expect(WIZARD_SOURCE).toContain("useFullShellAppearancePreview(appearance, performanceProfile)");
        expect(WIZARD_SOURCE).toContain("root.dataset.solcordMode = appearance.mode");
        expect(WIZARD_SOURCE).toContain("root.removeAttribute(attribute)");
        expect(WIZARD_SOURCE).toContain("The whole-shell preview updates immediately.");
        expect(WIZARD_CSS).toContain(".solcord-live-preview.solcord-mode-solcord-light");
        expect(WIZARD_CSS).toContain(".solcord-live-preview.solcord-preview-shape-seamed");
    });

    test("ships the V2 native tool surface without browser prompts or hidden account actions", () => {
        for (const label of ["Composer Proof reviewed this local draft", "Time Composer generated local Discord timestamp markup", "Permission Lens and Focus Channels", "Encrypted Local Identity Notes", "Voice Note Studio", "Notification Review"]) {
            expect(PANEL_SOURCE).toContain(label);
        }
        expect(PANEL_SOURCE).not.toContain("window.prompt(");
        expect(PANEL_SOURCE).toContain("Open normal upload composer");
        expect(PANEL_SOURCE).toContain("not uploaded");
        expect(PANEL_SOURCE).toContain("never edit profiles, sync to cloud, enter diagnostics, or appear in portable settings exports");
        expect(PANEL_SOURCE).toContain("Media Shelf keeps {baseline.mediaShelf.length} local reference(s) and runs no Discord adapter.");
        expect(WIZARD_CSS).toContain("[data-solcord-focus-muted=\"true\"]");
        expect(WIZARD_CSS).toContain(".solcord-call-badge");
    });

    test("keeps baseline adapter settings and runtime status synchronized after durable acknowledgment", async () => {
        let preferences = normalizeSolcordProductPreferences(undefined);
        const events: string[] = [];
        let releaseSave!: () => void;
        const save = new Promise<void>(resolveSave => {releaseSave = resolveSave;});
        const settings = {
            slice: () => preferences,
            async setProductPreferencesAsync(value: unknown) {
                await save;
                preferences = normalizeSolcordProductPreferences(value);
                events.push("saved");
                return undefined;
            }
        };
        let activeBaseline = preferences.baseline.embedControls;
        const owner = {
            started: true,
recoveryMode: false,
            emitChange: () => {},
            synchronizeBaselineSuite() {activeBaseline = preferences.baseline.embedControls; events.push("baseline");},
            synchronizeFeatures: () => {throw new Error("A baseline-only edit must not restart unrelated features.");}
        };
        const apply = runtimeMethodFixture("setProductPreferences", {SolcordSettings: settings, planSolcordPreferenceEffects});
        const update = panelHandlerFixture("BaselineToolsPanel", "update", {SolcordSettings: settings, SolcordRuntime: {setProductPreferences: (value: unknown) => apply.call(owner, value)}});
        // A preference changed after the panel rendered. The action must merge
        // its patch with the current immutable snapshot, preserving that change.
        preferences = normalizeSolcordProductPreferences({...preferences, performanceProfile: "lean", baseline: {...preferences.baseline, collapsedRegions: ["members"]}});
        const target = !preferences.baseline.embedControls;
        const pending = update({embedControls: target}) as Promise<void>;
        expect(events).toEqual([]);
        expect(activeBaseline).not.toBe(target);
        releaseSave(); await pending;
        expect(preferences.baseline.embedControls).toBe(target);
        expect(preferences.baseline.collapsedRegions).toEqual(["members"]);
        expect(preferences.performanceProfile).toBe("lean");
        expect(activeBaseline).toBe(target);
        expect(events).toEqual(["saved", "baseline"]);
    });
});
