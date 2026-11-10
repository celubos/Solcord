import {describe, expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

import {resolvePanelLabel, resolveTranslatedText} from "../../src/betterdiscord/stores/panel-label";

describe("Solcord settings navigation label", () => {
    test("uses the product-owned literal without consulting a translation sentinel", () => {
        expect(resolvePanelLabel("solcord", "Solcord Suite", false)).toBe("Solcord Suite");
    });

    test("falls back instead of rendering the missing-translation sentinel", () => {
        expect(resolvePanelLabel("not-a-real-panel", "Fallback panel")).toBe("Fallback panel");
    });

    test("recovers a useful built-in label even when an eager translation became the sentinel", () => {
        expect(resolvePanelLabel("plugins", "String not found!")).toBe("Plugins");
        expect(resolvePanelLabel("customcss", "String not found!")).toBe("Custom CSS");
    });

    test("never leaks the translation sentinel into collection, setting, note, or option fallbacks", () => {
        expect(resolveTranslatedText("Collections.missing.name", "Readable fallback")).toBe("Readable fallback");
        expect(resolveTranslatedText("Collections.missing.note", undefined)).toBeUndefined();
    });
});

describe("Solcord addon controls", () => {
    const switchSource = readFileSync(resolve(import.meta.dir, "../../src/betterdiscord/ui/settings/components/switch.tsx"), "utf8");
    const addonCardSource = readFileSync(resolve(import.meta.dir, "../../src/betterdiscord/ui/settings/addoncard.tsx"), "utf8");
    const toastSource = readFileSync(resolve(import.meta.dir, "../../src/betterdiscord/stores/toasts.ts"), "utf8");
    const themeManagerSource = readFileSync(resolve(import.meta.dir, "../../src/betterdiscord/modules/thememanager.ts"), "utf8");
    const addonManagerSource = readFileSync(resolve(import.meta.dir, "../../src/betterdiscord/modules/addonmanager.ts"), "utf8");

    test("gives plugin and theme switches a feature-specific accessible name", () => {
        expect(switchSource).toContain("aria-label={props.label}");
        expect(addonCardSource).toMatch(/label=\{`\$\{enabled \? "Disable" : "Enable"\} \$\{getString\(addon\.name\)\}`\}/);
        expect(addonCardSource).not.toMatch(/\$\{title\}`\} disabled=\{disabled\} value=\{enabled\}/);
    });

    test("coalesces rapid theme feedback instead of stacking success and error toasts over previews", () => {
        expect(toastSource).toContain("existing.group !== toast.group");
        expect(themeManagerSource.match(/group: "theme-change"/g)).toHaveLength(2);
        expect(themeManagerSource).toMatch(/Toasts\.info\(t\("Addons\.disabled"/);
        expect(addonManagerSource.match(/this\.prefix === "theme" \? \{group: "theme-change"\} : undefined/g)).toHaveLength(2);
    });
});

describe("Solcord Control Center clarity", () => {
    const panel = readFileSync(resolve(import.meta.dir, "../../src/betterdiscord/ui/solcord/panel.tsx"), "utf8");
    const timeline = readFileSync(resolve(import.meta.dir, "../../src/betterdiscord/ui/solcord/timeline.tsx"), "utf8");
    const styles = readFileSync(resolve(import.meta.dir, "../../src/betterdiscord/styles/solcord.css"), "utf8");
    const runtime = readFileSync(resolve(import.meta.dir, "../../src/betterdiscord/modules/solcord/runtime.ts"), "utf8");

    test("uses a stable vertical information architecture", () => {
        expect(panel).toContain("{label: \"Start\", ids: [\"overview\"]}");
        expect(panel).toContain("{label: \"Personalize\", ids: [\"appearance\", \"performance\"]}");
        expect(panel).toContain("{label: \"Features\", ids: [\"privacy\", \"chat\", \"voice\", \"friends\"]}");
        expect(panel).toContain("{label: \"System\", ids: [\"extensions\", \"recovery\"]}");
        expect(panel).toContain("placeholder=\"Find a setting\"");
    });

    test("avoids repeating healthy tool titles while keeping real limitations visible", () => {
        expect(panel).toContain("const usableScopeStatus = scopeStatus.filter(item => item.maturity !== \"unsupported\" && item.maturity !== \"off\")");
        expect(panel).toContain("const attentionScopeStatus = scopeStatus.filter(item => item.maturity === \"degraded\" || item.maturity === \"needs-setup\" || item.maturity === \"unsupported\")");
        expect(panel).not.toContain("{usableScopeStatus.map(item =>");
        expect(panel).toContain("<small>{item.detail}</small>");
        expect(panel).toContain("These tools are unavailable on this Discord build, so no inactive controls are shown.");
    });

    test("moves infrequent profile operations behind progressive disclosure", () => {
        expect(panel).toContain("className=\"solcord-secondary-tools\"");
        expect(panel).toContain("Import, export, or create a profile");
    });

    test("keeps runtime diagnostics and the community catalog out of the primary path", () => {
        expect(panel).toContain("className=\"solcord-extension-disclosure\"");
        expect(panel).toContain("<summary>Community plugins</summary>");
    });

    test("shows native feature readiness before the collapsed community-plugin tools", () => {
        const statusLedger = panel.indexOf("<NativeSuitePanel key=\"status\" scope=\"status\" />");
        const communityDisclosure = panel.indexOf("<details className=\"solcord-extension-disclosure\"");
        expect(statusLedger).toBeGreaterThan(-1);
        expect(communityDisclosure).toBeGreaterThan(statusLedger);
    });

    test("keeps idle Fake Deafen out of Overview attention signals", () => {
        const pulse = panel.slice(panel.indexOf("function SessionPulse"), panel.indexOf("function ProviderMigrationStatus"));
        expect(pulse).not.toContain("fakeDeafen");
        expect(pulse).not.toContain("Fake Deafen");
    });

    test("reports an idle Activity policy as ready to observe instead of a false warning", () => {
        expect(panel).toContain("activity?.status === \"healthy\" || activity?.status === \"idle\"");
        expect(panel).toContain("no Activity window has opened in this session");
    });

    test("keeps Fake Deafen visibly discoverable as a normal built-in Voice option", () => {
        const fakeDeafen = panel.slice(panel.indexOf("function FakeDeafenControls"), panel.indexOf("export default function SolcordPanel"));
        expect(panel).toContain("<FakeDeafenControls />");
        expect(panel).not.toContain("Experimental · account risk</p><FakeDeafenControls");
        expect(fakeDeafen).toContain("label=\"Keep Fake Deafen adapter ready\"");
        expect(fakeDeafen).toContain("direct built-in control beside Discord's normal Deafen button");
        expect(fakeDeafen).toContain("There is no per-call confirmation");
        expect(fakeDeafen).not.toContain("Arm for this call");
        expect(fakeDeafen).not.toContain("window.confirm(\"Arm Fake Deafen");
        expect(panel).toContain("findSolcordWorkspaces(workspaceQuery)");
        expect(panel).not.toMatch(/aria-label=\{`Enable \$\{health\.name\}`\}/);
        expect(panel).not.toContain("workspace === \"power\"");
    });

    test("uses one-click effect color swatches instead of the sticky native color popup", () => {
        expect(panel).toContain("role=\"radiogroup\" aria-label=\"Effect color\"");
        expect(panel).toContain("role=\"radio\" aria-checked=");
        expect(panel).not.toContain("type=\"color\"");
    });

    test("makes an explicit ambient-background choice take effect in one action", () => {
        expect(panel).toContain("const ambient = effect !== \"off\" && effect !== \"signal\"");
        expect(panel).toContain("const motion = ambient && appearance.motion !== \"reduced\" ? \"full\" : appearance.motion");
        expect(panel).toContain("onChange={event => updateAnimatedBackground(event.currentTarget.value as typeof preferences.nativeSuite.motion.effect)}");
    });

    test("gives every standalone private or composer text area an explicit accessible name", () => {
        expect(panel).toContain("aria-label=\"Draft to review locally\"");
        expect(panel).toContain("aria-label=\"Text to translate\"");
        expect(panel).toContain("aria-label=\"Private local identity note\"");
    });

    test("presents Translation Desk as local-first without disguising network providers as setup dependencies", () => {
        expect(panel).toContain("<option value=\"local\">On-device</option>");
        expect(panel).toContain("Checking this language pair on device");
        expect(panel).toContain("Provider off. Nothing will be transmitted.");
        expect(panel).toContain("No cloud fallback will run automatically.");
        expect(panel).toContain("Translate on device");
        expect(panel).toContain("External provider selected. Solcord shows the destination and asks before each request.");
        expect(panel).toContain("localPairBlocked");
        expect(panel).toContain("<summary>External provider settings</summary>");
    });

    test("keeps Voice Note Studio actions synchronized with permission, recording, and preview state", () => {
        expect(panel).toContain("const [voicePhase, setVoicePhase] = useState<SolcordVoiceNotePhase>");
        expect(panel).toContain("disabled={voicePhase !== \"idle\" || Boolean(voicePreview)}");
        expect(panel).toContain("disabled={!voiceRecording}");
        expect(panel).toContain("disabled={voicePhase === \"idle\" && !voicePreview}");
        expect(panel).toContain("controller.cancelVoiceNote();");
    });

    test("never reports a built-in action succeeded after its runtime controller disappeared", () => {
        expect(panel).toContain("const requireController = () =>");
        for (const unsafeCall of [
            "controller?.prepareReviewedVoiceNoteUpload",
            "controller?.applyReviewedNotifications",
            "controller?.pinDm",
            "controller?.hideGuild",
            "controller?.aliasGuild",
            "controller?.setFocusChannels"
        ]) expect(panel).not.toContain(unsafeCall);
    });

    test("mounts native controls only in their owning workspace instead of hiding unrelated forms with CSS", () => {
        for (const contract of [
            "scope === \"chat\" && available(\"composer-toolkit\")",
            "scope === \"chat\" && available(\"channel-glance\")",
            "scope === \"chat\" && available(\"translation-desk\")",
            "scope === \"chat\" && available(\"notification-review\")",
            "scope === \"voice\" && available(\"audio-console\")",
            "scope === \"voice\" && available(\"voice-note-studio\")",
            "scope === \"friends\" && available(\"people-and-spaces\")",
            "scope === \"friends\" && available(\"permission-lens\")",
            "scope === \"friends\" && available(\"local-identity-notes\")"
        ]) expect(panel).toContain(contract);
        expect(panel).toContain("<summary>Channel Glance</summary>");
        expect(panel).toContain("<summary>People and Spaces</summary>");
        expect(panel).not.toContain("<summary>Channel Glance and People and Spaces</summary>");
        expect(styles).not.toContain("details:nth-child");
    });

    test("lets skipped-setup users control built-ins and treats archived providers as history", () => {
        expect(panel).toContain("disabled={busy}");
        expect(panel).toContain("useSolcordAction");
        expect(panel).toContain("superseded provider record(s) archived");
        expect(panel).toContain("Their settings and private data remain preserved for rollback.");
        expect(panel).not.toContain("Complete First Setup once to establish a rollback point before enabling built-ins here.");
        expect(panel).not.toContain("Complete First Setup once to create a rollback point before enabling these tools.");
    });

    test("invalidates local Composer proof as soon as its draft changes", () => {
        expect(panel).toContain("setComposerDraft(event.currentTarget.value); setComposerProof(undefined);");
        expect(panel).toContain("composerProof?.reviewedDraft === composerDraft");
        expect(panel).toContain("role=\"status\" aria-live=\"polite\"");
        expect(panel).toContain("<NativeSuitePanel key=\"chat\" scope=\"chat\" />");
        expect(panel).not.toContain("onChange={event => setComposerDraft(event.currentTarget.value)}");
    });

    test("invalidates safety reviews as soon as the reviewed URL or MIME changes", () => {
        expect(panel).toContain("aria-label=\"Link to inspect\" onChange={event => {setInput(event.currentTarget.value); setInspection(undefined);}}");
        expect(panel).toContain("setInput(event.currentTarget.value); setSource(\"url\"); setInspection(undefined);");
        expect(panel).toContain("setMime(event.currentTarget.value); setInspection(undefined);");
    });

    test("renders Channel Glance as bounded accessible rows rather than a raw message dump", () => {
        expect(panel).toContain("presentSolcordChannelGlance(requireController().previewLoadedChannel(channelId.trim()))");
        expect(panel).toContain("role=\"list\" aria-label={`Channel Glance:");
        expect(panel).toContain("role=\"listitem\" className=\"solcord-glance-row\"");
        expect(panel).toContain("<NativeSuitePanel key=\"voice\" scope=\"voice\" />");
        expect(panel).toContain("Nothing was fetched, marked read, or persisted.");
        expect(panel).not.toContain("{message.text || \"No text content\"}");
        expect(panel).not.toContain("{message.authorLabel}");
    });

    test("never opens a mutating Notification Review confirmation for zero loaded items", () => {
        const notificationReview = panel.slice(panel.indexOf("const previewNotifications"), panel.indexOf("const addLocalSpaceRule"));
        expect(notificationReview).toContain("if (preview.count === 0)");
        expect(notificationReview).toContain("Nothing to review in the already-loaded notification state.");
        expect(notificationReview.indexOf("if (preview.count === 0)")).toBeLessThan(notificationReview.indexOf("window.confirm"));
    });

    test("makes Return Later reachable from the visible DM or channel and keeps route memory account-scoped", () => {
        expect(runtime).toContain("name: \"Save current DM or channel for later\"");
        expect(runtime).toContain("Patcher.after(\"Solcord~ReturnLaterRoute\", window.history, \"pushState\"");
        expect(runtime).toContain("Patcher.after(\"Solcord~ReturnLaterRoute\", window.history, \"replaceState\"");
        expect(runtime).toContain("this.#returnRouteMemory.clear();");
        expect(runtime).toContain("window.location.assign(target);");
        expect(panel).toContain("SolcordRuntime.snoozeReturnLater(item.id");
        expect(panel).toContain("SolcordRuntime.completeReturnLater(item.id)");
        expect(panel).toContain("SolcordRuntime.openReturnLater(item.id)");
        expect(panel).toContain("choose Save current DM or channel for later");
    });

    test("keeps Command Deck focus inside the modal and restores the prior control", () => {
        const deck = runtime.slice(runtime.indexOf("openCommandDeck(): void"), runtime.indexOf("inspectLink(input: string)"));
        expect(deck).toContain("appMount.inert = true");
        expect(deck).toContain("document.addEventListener(\"keydown\", documentKeydown, true)");
        expect(deck).toContain("document.addEventListener(\"focusin\", containFocus, true)");
        expect(deck).toContain("search.addEventListener(\"pointerdown\"");
        expect(deck).toContain("search.focus({preventScroll: true})");
        expect(deck).toContain("filterSolcordCommands(commands, search.value)");
        expect(deck).toContain("No matching local command.");
        expect(deck).toContain("previousFocus.focus({preventScroll: true})");
        expect(styles).toContain("pointer-events: auto !important");
    });

    test("keeps Return Later in one primary workspace while People and Spaces resolves loaded object types", () => {
        expect(panel).toContain("workspace === \"chat\" && <><BaselineToolsPanel /><BuiltInFeatureSwitches scope=\"chat\" /><NativeSuitePanel key=\"chat\" scope=\"chat\" /><ReturnLaterPanel /></>");
        expect(panel).toContain("workspace === \"friends\" && <><FriendWatchPanel /><BuiltInFeatureSwitches scope=\"friends\" /><NativeSuitePanel key=\"friends\" scope=\"friends\" /></>");
        expect(panel.match(/<ReturnLaterPanel \/>/g)).toHaveLength(1);
        expect(panel).toContain("scope === \"friends\" ? SolcordRuntime.currentPeopleObjectId() ?? \"\"");
        expect(panel).toContain("SolcordRuntime.resolvePeopleObject(channelId.trim())");
        expect(panel).toContain("disabled={!peopleTarget?.canPinDm}");
        expect(panel).toContain("disabled={!peopleTarget?.canManageServer}");
        expect(panel).toContain("peopleTarget.kind === \"server-channel\"");
        expect(panel).toContain("The local People and Spaces transaction did not complete; no success was reported.");
        expect(panel).toContain("The local removal did not complete; no success was reported.");
        expect(runtime).toContain("resolvePeopleObject(id: string): SolcordPeopleObjectResolution");
        expect(runtime).toContain("currentPeopleObjectId(): string | undefined");
        expect(runtime).toContain("this.#sessionPeopleState = {pinnedDmIds: [], hiddenGuildIds: [], guildAliases: {}, favoriteFriendIds: [], hiddenFriendIds: [], ignoredVoiceChannelIds: [], ignoredVoiceGuildIds: []}");
    });

    test("keeps workspace search results explicit without desynchronizing the section selector", () => {
        expect(panel).toContain("const navigateFromSearch = (next: SolcordWorkspaceId) => {");
        expect(panel).toContain("setWorkspaceQuery(\"\")");
        expect(panel).toContain("onClick={() => navigateFromSearch(item.id)}");
        expect(panel).toContain("<details className=\"solcord-workspace-menu\"><summary aria-label={`Change workspace. Current workspace: $" + "{selectedWorkspace.label}`}>Workspaces</summary>");
        expect(panel).toContain("onClick={event => navigateFromCompactMenu(event, item.id)}");
        expect(panel).not.toContain("<select value={workspace}");
        expect(panel).not.toContain("value={workspace} onChange={event => setWorkspace(event.currentTarget.value as SolcordWorkspaceId)}>{visibleWorkspaces.map");
    });

    test("shows runtime ownership as read-only technical status and keeps built-in controls in one workspace", () => {
        const statusDetails = panel.slice(panel.indexOf("function RuntimeStatusDetails"), panel.indexOf("function ActivityBridge"));
        expect(statusDetails).toContain("Read-only Solcord runtime status");
        expect(statusDetails).not.toContain("SolcordRuntime.setEnabled");
        expect(statusDetails).not.toContain("type=\"checkbox\"");
        expect(panel).toContain("<summary>Technical details</summary><p>Read-only lifecycle and owned-resource status.");
        expect(panel).not.toContain("<Section title=\"Core runtime\"");
    });

    test("gives built-in title, replacement copy, and status separate wrapping columns", () => {
        expect(panel).toContain("className=\"solcord-native-title\"");
        expect(panel).toContain("className=\"solcord-native-replaces\"");
        expect(styles).toContain("grid-template-columns: minmax(132px, max-content) minmax(18ch, 1fr) auto");
        expect(styles).toContain(".solcord-native-replaces { grid-column: 2; min-width: 0; overflow-wrap: anywhere;");
        expect(styles).toContain(".solcord-native-row > .solcord-capability { grid-column: 3; }");
        expect(styles).toContain(".solcord-native-replaces { grid-row: 2; grid-column: 1 / -1; }");
    });

    test("uses whitespace and type hierarchy instead of stacked adjacent dividers", () => {
        expect(panel).toContain("<h3>{title}</h3>");
        expect(panel).not.toContain("<h2>{title}</h2>");
        expect(styles).toContain(".solcord-workspace-heading { padding: 0 0 20px; }");
        expect(styles).toContain(".solcord-workspace-heading h2 { margin: 0 0 8px;");
        expect(styles).toContain(".solcord-section-heading h3 { margin: 0;");
        expect(styles).toContain(".solcord-section { padding: 20px 0 24px; border: 0; }");
        expect(styles).toContain(".solcord-section + .solcord-section { border-top: 1px solid var(--sc-border); }");
        expect(styles).toContain(".solcord-section-heading p { max-width: 64ch; margin: 8px 0 0;");
        expect(styles).toContain(".solcord-setting-row > span:first-child { display: grid; gap: 8px;");
        for (const primitive of [
            ".solcord-setting-rows { display: grid; gap: 4px; }",
            ".solcord-setting-list { display: grid; gap: 4px; max-width: 700px; }",
            ".solcord-module-table { display: grid; gap: 4px; overflow: hidden; }",
            ".solcord-native-ledger { display: grid; gap: 4px; }",
            ".solcord-privacy-capabilities { display: grid; gap: 4px; margin-top: 14px; }",
            ".solcord-native-tools { display: grid; gap: 8px; margin-top: 14px; }"
        ]) expect(styles).toContain(primitive);
        expect(styles).toContain(".solcord-setting-row:is(:hover, :focus-within) { background: var(--sc-surface-1); }");
        expect(styles).toContain(".solcord-native-row:is(:hover, :focus-within) { background: var(--sc-surface-1); }");
        expect(styles).not.toContain(".solcord-setting-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 18px; align-items: center; min-height: 56px; padding: 9px 0; border-bottom");
        expect(styles).not.toContain(".solcord-native-row:last-child { border-bottom: 0; }");
        expect(styles).not.toContain(".solcord-privacy-capabilities > div { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: center; min-height: 52px; padding: 8px 0; border-bottom");
        expect(styles).not.toContain(".solcord-segmented button { border-right: 0; border-bottom");
        expect(styles).not.toContain(".solcord-workspace-heading { padding: 3px 0 var(--sc-space-4); border-bottom");
        expect(styles).not.toContain("margin-top: 16px; padding: 10px 0; border-block: 1px solid var(--sc-border)");
    });

    test("keeps Friend Watch quiet while off and reveals private controls only after opt in", () => {
        const friendWatch = panel.slice(panel.indexOf("function FriendWatchPanel"), panel.indexOf("function ReturnLaterPanel"));
        expect(friendWatch).toContain("Off. No relationship history is stored.");
        expect(friendWatch).toContain("On. History is encrypted, local, and isolated to this account.");
        expect(friendWatch).toContain("{policy.enabled && <>");
        expect(friendWatch).toContain("<summary>Retention and notifications</summary>");
        expect(friendWatch).toContain("{state.events.length > 0 && <div className=\"solcord-actions\"");
        expect(friendWatch).not.toContain("<ActionButton disabled={!state.events.length}");
        expect(styles).toContain(".solcord-empty { margin: 10px 0; color: var(--text-muted); font-style: normal;");
    });

    test("uses a dedicated setup workspace and only a compact reminder after deferral", () => {
        expect(panel).toContain("const focusSetup = workspace === \"overview\" && workspaceFocus === \"setup\"");
        expect(panel).toContain("workspaceRef.current?.querySelector<HTMLElement>(\".solcord-wizard\")");
        expect(panel).toContain("onboarding.status === \"pending\" ? <SetupWizard />");
        expect(panel).toContain("function SetupManagement({openSetup}: {openSetup: () => void})");
        expect(panel).toContain("<ActionButton onClick={openSetup}>Reopen setup</ActionButton>");
        expect(panel).toContain("<SetupManagement openSetup={openSetup} />");
        expect(panel).toContain("className=\"solcord-setup-reminder\"");
        expect(panel).not.toContain("className=\"solcord-setup-banner\"");
    });

    test("keeps setup rollback feedback visible after onboarding state unmounts its Recovery row", () => {
        expect(panel).toContain("group: \"solcord-setup-rollback\"");
        expect(panel).toContain("Toasts.success(message, options)");
        expect(panel).toContain("Toasts.warning(message, options)");
        expect(panel).toContain("forceShow: true");
    });

    test("leads Privacy with the explicit profile and content-free capability report", () => {
        const privacy = readFileSync(resolve(import.meta.dir, "../../src/betterdiscord/ui/solcord/privacy.tsx"), "utf8");
        expect(panel).toContain("<PrivacyProtectionPanel /><BuiltInFeatureSwitches scope=\"privacy\" /><StreamShieldControls />");
        expect(privacy).toContain("Use Strict Privacy");
        expect(privacy).toContain("Check for updates");
        expect(privacy).toContain("privacyCapabilityStateLabel(capability.state)");
        expect(privacy).toMatch(/solcord-privacy-state-\$\{capability\.state\.toLowerCase\(\)\}/);
        expect(privacy).toContain("never URLs, payloads, account IDs, messages, attachments, or file paths");
    });

    test("reports each built-in from its actual adapter result and explains every family state", () => {
        expect(panel).toContain("adapters: SolcordRuntime.curatedAdapterStatus()");
        expect(panel).toContain("const adapter = state.adapters[name]");
        expect(panel).toContain("solcordBuiltInCapability(enabled, adapter)");
        expect(panel).toContain("const adapter = SolcordRuntime.curatedAdapterStatus()[name]");
        expect(panel).toContain("is selected but unavailable");
        expect(panel).not.toContain("state.statuses.find(item => item.id === feature)");
        expect(panel).toContain("optional setup</span><span>{visibleStatuses.filter(item => item.maturity === \"degraded\").length} degraded");
        expect(panel).toContain("Degraded means part of a running tool drifted or could not clean up completely.");
        expect(panel).toMatch(/aria-label=\{`\$\{item\.title\}: \$\{stateLabel\[item\.maturity\]\}\. \$\{item\.detail\}`\}/);
    });

    test("does not report a storage failure before Message Timeline is enabled", () => {
        expect(timeline).toContain("Not in use while Timeline is off");
        expect(timeline).toContain("Session only by choice");
        expect(timeline).toContain("Session only · encrypted persistence unavailable");
        expect(timeline).not.toContain("session only · secure storage unavailable or disabled");
    });

    test("keeps the Discord wrapper and long status copy inside the visible settings column", () => {
        expect(styles).toContain("[class*=\"container_\"]:has(.solcord-panel) > [class*=\"content_\"] { flex: 1 1 auto; min-width: 0; }");
        expect(styles).toContain("[class*=\"contentBody_\"]:has(.solcord-panel) > [class*=\"scroller_\"],");
        expect(styles).toContain("[class*=\"contentColumn_\"]:has(.solcord-panel)");
        expect(styles).toContain(":is([class*=\"panel_\"], :has(> .solcord-panel)) { box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%; margin: 0; padding: 0; }");
        expect(styles).toContain(".solcord-pulse > div { min-width: 0; }");
        expect(styles).toContain(".solcord-pulse p { margin: 4px 0 0; color: var(--sc-muted); overflow-wrap: anywhere; white-space: normal; }");
        expect(styles).toContain(".solcord-setup-reminder > span { display: grid; gap: 8px; min-width: 0; }");
        expect(styles).toContain(".solcord-setup-reminder small { overflow-wrap: anywhere; white-space: normal; }");
        expect(styles).toContain(".solcord-setup-reminder > .solcord-action { flex: 0 0 auto; }");
        expect(styles).toMatch(/@container solcord-panel \(max-width: 720px\)[\s\S]*?\.solcord-setup-reminder,[\s\S]*?\.solcord-pulse \{ align-items: flex-start; flex-direction: column; \}/);
        expect(styles).toMatch(/@container solcord-panel \(max-width: 720px\)[\s\S]*?\.solcord-setup-reminder > span,[\s\S]*?\.solcord-pulse > div \{ width: 100%; max-width: 100%; \}/);
        expect(styles).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.solcord-panel \{[^}]*width: 100%;[^}]*max-width: 100%;[^}]*padding-right: 12px;[^}]*padding-left: 12px;/);
    });

    test("keeps native file pickers inside narrow Privacy and Recovery workspaces", () => {
        expect(styles).toMatch(/\.solcord-panel input\[type="file"\][^{]*\{[^}]*box-sizing: border-box;[^}]*width: 100%;[^}]*min-width: 0;[^}]*max-width: 100%;[^}]*overflow: hidden;/);
        expect(styles).toMatch(/\.solcord-scrubber-controls > input\[type="file"\][^{]*\{[^}]*flex: 1 1 190px;/);
    });
});

describe("Solcord five-step setup", () => {
    const wizard = readFileSync(resolve(import.meta.dir, "../../src/betterdiscord/ui/solcord/setup-wizard.tsx"), "utf8");

    test("offers one clear footer path and a quiet reversible deferral", () => {
        const footer = wizard.slice(wizard.indexOf("<div className=\"solcord-wizard-footer\">"));
        expect(footer).toContain(">Back</button>");
        expect(footer).toContain(">Continue</button>");
        expect(footer).toContain("{busy ? \"Applying…\" : \"Apply\"}");
        expect(footer).toContain(">Finish later</button>");
        expect(footer).not.toContain("Cancel for now");
        expect(footer).not.toContain("Skip setup");
    });

    test("does not replace community plugin files during initial setup", () => {
        expect(wizard).toContain("{migrateProviders: false}");
        expect(wizard).not.toContain("solcord-provider-choice");
        expect(wizard).not.toContain("Replace duplicate cards");
    });

    test("starts with Strict Privacy and keeps private history optional", () => {
        expect(wizard).toContain("Choose your privacy baseline");
        expect(wizard).toContain("Strict Privacy");
        expect(wizard).toContain("Optional private history");
    });
});
