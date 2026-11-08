import React from "react";

import {useStateFromStores} from "@ui/hooks";
import PluginManager from "@modules/pluginmanager";
import ThemeManager from "@modules/thememanager";
import SolcordRuntime from "@modules/solcord/runtime";
import SolcordSettings, {SOLCORD_PRESET_ADDONS, SOLCORD_THEMES} from "@modules/solcord/store";
import type {SolcordSettingsDocument, SolcordSetupDraft, SolcordThemeId} from "@modules/solcord/contracts";
import {SOLCORD_RUNTIME_ADDONS, SOLCORD_RUNTIME_DEPENDENCIES, SOLCORD_RUNTIME_THEMES} from "@common/solcord/addon-trust.generated";
import {communityAddonIsEnabled, isSolcordBuiltInAddon, resolveCommunityAddon} from "@common/solcord/builtin-addons";
import {recommendedSolcordSetupAddons, resolveSolcordSetupPlan, type SolcordSetupCandidateDecision} from "@common/solcord/setup-catalog";
import {resolveSolcordPerformancePolicy, SOLCORD_PERFORMANCE_POLICIES, SOLCORD_SETUP_STEPS, type SolcordAppearancePreferences, type SolcordPerformanceProfile, type SolcordSetupPreset} from "@common/solcord/product";

import {SOLCORD_ADDON_GROUPS} from "./catalog";
import {scrollSolcordSettingsTarget} from "./scroll-owner";
import SolcordSwitch from "./switch";

const {useEffect, useMemo, useRef, useState} = React;

const WIZARD_STEPS = SOLCORD_SETUP_STEPS;

const THEME_NOTES: Record<SolcordThemeId, string> = {
    "solcord-default": "Recommended · Graphite, warm text, oxidized teal, and ember reserved for warnings.",
    "obsidian-thread": "Graphite, warm bone, oxidized teal, and restrained ember.",
    "carbon-ember": "Charcoal and ash with copper and burgundy accents.",
    "midnight-glass": "Navy-black, silver, ice cyan, and restrained translucency.",
    "paper-signal": "Warm paper, ink, coral, and teal for a light workspace.",
    "threadline": "Compact indexed navigation, ruled regions, and quick-scanning density.",
    "signal-block": "Square controls, thick containment, and unmistakable press and focus states.",
    "relay-classic": "A restrained return to classic Discord density and familiar proportions.",
    "workshop": "Tactile borders, an inset composer, and clear working-state controls.",
    "quiet-read": "Long-form readability, generous measure, visible focus, and reduced motion.",
    "night-transit": "A dark route-rail system distinguishing selected, unread, mention, and voice states."
};

function draftFrom(document: SolcordSettingsDocument): SolcordSetupDraft {
    if (document.onboarding.draft) return structuredClone(document.onboarding.draft);
    return {
        preset: "recommended",
        selectedTheme: document.selectedTheme,
        selectedAddons: SOLCORD_PRESET_ADDONS.filter(name => document.curatedAddons[name]?.selected),
        addonModes: Object.fromEntries(SOLCORD_PRESET_ADDONS.map(name => [name, document.curatedAddons[name]?.mode ?? (name === "SplitLargeMessages" ? "guarded" : "default")])),
        addonProviders: Object.fromEntries(SOLCORD_PRESET_ADDONS.map(name => {
            const mode = document.curatedAddons[name]?.mode ?? (name === "SplitLargeMessages" ? "guarded" : "default");
            const community = resolveCommunityAddon(PluginManager, name, SOLCORD_RUNTIME_ADDONS.find(addon => addon.name === name)?.fileName ?? "");
            const provider = isSolcordBuiltInAddon(name, mode) && !community
                ? "prefer-solcord"
                : document.curatedAddons[name]?.provider ?? "prefer-community";
            return [name, provider];
        })),
        timelinePolicy: document.timelinePolicy,
        productPreferences: document.productPreferences
    };
}

function setupFailureMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : "UnknownSetupFailure";
    if (message === "SetupProviderMigrationConfirmationChanged" || message === "SetupCommunityCounterpartChanged") return "Setup stopped because an active community provider changed after review. Review the exact provider choice again; no provider was silently disabled.";
    if (message.includes("already exists with a different hash")) return `Setup found a local file with different contents and left it untouched. ${message.slice(0, 180)}`;
    if (message.includes("Download failed") || message.includes("response did not contain a body")) return "Setup could not download a reviewed community file. Built-in features and owner files were left unchanged; check the connection and retry.";
    if (message.includes("Hash verification") || message.includes("Integrity") || message.includes("ownership receipt") || message.includes("Staged verification")) return "Setup rejected a file because its reviewed hash or ownership receipt did not match. Nothing unverified was enabled.";
    if (message === "SelectedThemeLoadTimeout" || message === "SelectedThemeStartFailed") return "The theme file was verified, but Discord did not load or enable it in time. The transaction was rolled back.";
    if (message === "SetupFailedRollbackIncomplete") return "Setup stopped and automatic rollback needs attention. Open Recovery before trying setup again; owner files were not overwritten.";
    return "Setup stopped safely before keeping the transaction. Open Plugin Doctor for the sanitized failure code and retry after the flagged item is resolved.";
}

function bytesLabel(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function isReadyDecision(decision: SolcordSetupCandidateDecision | undefined): boolean {
    return decision?.availability === "built-in" || decision?.availability === "accepted";
}

function DisclosureSummary({title, detail}: {title: string; detail: string;}) {
    return <summary className="solcord-disclosure-summary"><span><strong>{title}</strong><small>{detail}</small></span></summary>;
}

function StepNavigation({step, setStep, disabled}: {step: number; setStep(step: number): void; disabled: boolean;}) {
    return <ol className="solcord-wizard-steps" aria-label="Solcord setup steps">
        {WIZARD_STEPS.map((label, index) => <li key={label}>
            <button type="button" aria-label={`${index + 1}. ${label}${index === step ? ", current step" : ""}`} aria-current={index === step ? "step" : undefined} disabled={disabled} onClick={() => setStep(index)}>
                <span aria-hidden="true">{index + 1}</span><span>{label}</span>
            </button>
        </li>)}
    </ol>;
}

function WelcomeStep() {
    return <div className="solcord-wizard-body solcord-welcome-step">
        <h3>Welcome to Solcord</h3>
        <p>A private BetterDiscord fork with recovery, themes, and local tools. Discord updates can still break optional features.</p>
        <p className="solcord-callout"><strong>You stay in control.</strong> Solcord never sends, joins, records, or enables private history without your action.</p>
    </div>;
}

function PresetStep({value, onChange}: {value: SolcordSetupPreset; onChange(value: SolcordSetupPreset): void;}) {
    const options: Array<{id: SolcordSetupPreset; title: string; detail: string;}> = [
        {id: "recommended", title: "Recommended", detail: "Activity safety, recovery, and the three accepted local interaction tools."},
        {id: "minimal", title: "Minimal", detail: "Core compatibility and recovery only; no daily interaction tools."},
        {id: "power-user", title: "Power User", detail: "Requests the complete catalog set for review. Held tools stay uninstalled."}
    ];
    return <div className="solcord-wizard-body">
        <h3>Choose a starting point</h3>
        <p>This changes only the draft. You will see every resulting change before Apply.</p>
        <div className="solcord-choice-stack">{options.map(option => <label key={option.id} className="solcord-choice-row"><input type="radio" name="solcord-preset" checked={value === option.id} onChange={() => onChange(option.id)} /><span><strong>{option.title}</strong><small>{option.detail}</small></span></label>)}</div>
    </div>;
}

function PerformanceStep({draft, onChange}: {draft: SolcordSetupDraft; onChange(value: SolcordSetupDraft): void;}) {
    const profile = draft.productPreferences.performanceProfile;
    const reducedByOs = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    const policy = resolveSolcordPerformancePolicy(profile, draft.productPreferences.appearance.motion, reducedByOs);
    return <div className="solcord-wizard-body">
        <h3>Performance</h3>
        <p>Balanced is recommended. Disabled tools stay stopped in every profile.</p>
        <div className="solcord-segmented" role="radiogroup" aria-label="Setup performance profile">{(Object.keys(SOLCORD_PERFORMANCE_POLICIES) as SolcordPerformanceProfile[]).map(id => <button key={id} type="button" role="radio" aria-checked={profile === id} onClick={() => onChange({...draft, productPreferences: {...draft.productPreferences, performanceProfile: id}})}><strong>{id[0].toUpperCase() + id.slice(1)}</strong><small>{SOLCORD_PERFORMANCE_POLICIES[id].description}</small></button>)}</div>
        <details className="solcord-review-details"><DisclosureSummary title="Performance details" detail={`${policy.effectiveMotion} motion · sampling no faster than every ${policy.sampleSeconds} seconds`} /><dl className="solcord-facts"><div><dt>Effective motion</dt><dd>{policy.effectiveMotion}</dd></div><div><dt>Sampling interval</dt><dd>at least {policy.sampleSeconds} seconds</dd></div><div><dt>Windows reduced motion</dt><dd>{reducedByOs ? "honored" : "not requested"}</dd></div></dl></details>
    </div>;
}

function ActivitiesStep() {
    const state = useStateFromStores(SolcordRuntime, () => ({activity: SolcordRuntime.activityHealth(), drift: SolcordRuntime.driftResults()}));
    const failed = state.drift.filter(item => !item.ok);
    return <div className="solcord-wizard-body">
        <h3>Activities compatibility check</h3>
        <p>Solcord keeps BetterDiscord&apos;s unrestricted preload override off. It permits one later preload only when canonical paths prove that it belongs to the same Discord package.</p>
        <dl className="solcord-facts"><div><dt>Compatibility policy</dt><dd>{state.activity?.status ?? "starting"}</dd></div><div><dt>Unrestricted override</dt><dd>{state.activity?.unrestrictedOverride ? "on — review required" : "off"}</dd></div><div><dt>Structural checks</dt><dd>{failed.length ? `${failed.length} degraded` : "available"}</dd></div></dl>
        <p className="solcord-callout">This check does not launch an Activity or act on your account. Codenames and a second Activity remain hands-on acceptance steps after setup.</p>
    </div>;
}

const SOLCORD_PRESENTATION_ATTRIBUTES = [
    "data-solcord-mode",
    "data-solcord-accent",
    "data-solcord-density",
    "data-solcord-motion",
    "data-solcord-message-shape",
    "data-solcord-performance",
    "data-solcord-effective-motion",
    "data-solcord-ambient-motion"
] as const;

function useFullShellAppearancePreview(appearance: SolcordAppearancePreferences, performanceProfile: SolcordPerformanceProfile): void {
    useEffect(() => {
        const root = document.documentElement;
        const previous = new Map(SOLCORD_PRESENTATION_ATTRIBUTES.map(attribute => [attribute, root.getAttribute(attribute)]));
        const reducedByOs = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
        root.dataset.solcordMode = appearance.mode;
        root.dataset.solcordAccent = appearance.accent;
        root.dataset.solcordDensity = appearance.density;
        root.dataset.solcordMotion = appearance.motion;
        root.dataset.solcordMessageShape = appearance.messageShape;
        root.dataset.solcordPerformance = performanceProfile;
        const policy = resolveSolcordPerformancePolicy(performanceProfile, appearance.motion, reducedByOs);
        root.dataset.solcordEffectiveMotion = policy.effectiveMotion;
        root.dataset.solcordAmbientMotion = String(policy.ambientEffects);
        return () => {
            for (const [attribute, value] of previous) {
                if (value === null) root.removeAttribute(attribute);
                else root.setAttribute(attribute, value);
            }
        };
    }, [appearance, performanceProfile]);
}

function ThemeStep({value, appearance, performanceProfile, onChange, onAppearance}: {value: SolcordThemeId; appearance: SolcordAppearancePreferences; performanceProfile: SolcordPerformanceProfile; onChange(value: SolcordThemeId): void; onAppearance(value: SolcordAppearancePreferences): void;}) {
    useFullShellAppearancePreview(appearance, performanceProfile);
    return <div className="solcord-wizard-body">
        <h3>Choose your look</h3>
        <p>Preview the full Discord shell. Leaving this step restores your saved look.</p>
        <div className="solcord-appearance-controls">
            <label>Mode<select value={appearance.mode} onChange={event => onAppearance({...appearance, mode: event.currentTarget.value as SolcordAppearancePreferences["mode"]})}><option value="follow-discord">Follow Discord</option><option value="solcord-dark">Solcord Dark</option><option value="solcord-light">Solcord Light</option><option value="oled">OLED</option></select></label>
            <label>Accent<select value={appearance.accent} onChange={event => onAppearance({...appearance, accent: event.currentTarget.value as SolcordAppearancePreferences["accent"]})}><option value="system">Discord / system</option><option value="glacier">Glacier cyan</option><option value="signal">Signal amber</option><option value="coral">Coral</option><option value="forest">Forest</option></select></label>
            <label>Density<select value={appearance.density} onChange={event => onAppearance({...appearance, density: event.currentTarget.value as SolcordAppearancePreferences["density"]})}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
            <label>Motion<select value={appearance.motion} onChange={event => onAppearance({...appearance, motion: event.currentTarget.value as SolcordAppearancePreferences["motion"]})}><option value="follow-system">Use performance profile</option><option value="full">Full</option><option value="subtle">Subtle</option><option value="reduced">Reduced</option></select></label>
            <label>Message shape<select value={appearance.messageShape} onChange={event => onAppearance({...appearance, messageShape: event.currentTarget.value as SolcordAppearancePreferences["messageShape"]})}><option value="discord">Discord default</option><option value="seamed">Quiet 1px seams</option></select></label>
        </div>
        <div className={`solcord-live-preview solcord-mode-${appearance.mode} solcord-accent-${appearance.accent} solcord-preview-density-${appearance.density} solcord-preview-shape-${appearance.messageShape}`} aria-label="Solcord appearance preview"><span>Private thread</span><strong>Clear hierarchy, quiet seams, visible focus.</strong><small>The whole-shell preview updates immediately. Apply saves the mode and installs the selected compatibility theme.</small></div>
        <details className="solcord-legacy-themes"><summary>Compatibility theme package</summary>
        <div className="solcord-theme-options">
            {SOLCORD_THEMES.map(theme => <label key={theme.id} className={`solcord-theme-option solcord-theme-${theme.id}`}>
                <input type="radio" name="solcord-theme" value={theme.id} checked={value === theme.id} onChange={() => onChange(theme.id)} />
                <span className="solcord-theme-swatch" aria-hidden="true"><i /><i /><i /><i /></span>
                <span><strong>{theme.name}</strong><small>{THEME_NOTES[theme.id]}</small></span>
            </label>)}
        </div>
        </details>
        <p className="solcord-callout">Only the selected Solcord package is enabled. Existing third-party themes are not modified; possible visual overlap is shown in the final review.</p>
    </div>;
}

function PrivacyStep({draft, onChange}: {draft: SolcordSetupDraft; onChange(value: SolcordSetupDraft): void;}) {
    const friendWatch = draft.productPreferences.friendWatch;
    const privacy = draft.productPreferences.privacy;
    const safety = draft.productPreferences.safety;
    const setPrivacyProfile = (profile: "strict" | "standard") => onChange({
        ...draft,
        productPreferences: {
            ...draft.productPreferences,
            privacy: {
                ...privacy,
                profile,
                telemetry: profile === "strict" ? "block" : "allow",
                crashReporting: profile === "strict" ? "block-optional" : "allow",
                activityDiscovery: profile === "strict" ? "block" : "allow",
                updates: "manual",
                migrationPending: false
            }
        }
    });
    return <div className="solcord-wizard-body">
        <h3>Choose your privacy baseline</h3>
        <p>Strict Privacy blocks verified optional reporting. Discord essentials keep working.</p>
        <div className="solcord-choice-grid solcord-choice-grid-two">
            <label className="solcord-choice-row"><input type="radio" name="privacy-profile" checked={privacy.profile === "strict"} onChange={() => setPrivacyProfile("strict")} /><span><strong>Strict Privacy</strong><small>Recommended. Optional telemetry, crash reports, game discovery, and automatic Solcord checks stay off.</small></span></label>
            <label className="solcord-choice-row"><input type="radio" name="privacy-profile" checked={privacy.profile !== "strict"} onChange={() => setPrivacyProfile("standard")} /><span><strong>Standard</strong><small>Discord optional reporting may run. Solcord update checks remain manual.</small></span></label>
        </div>
        <h3>Safety tools</h3>
        <div className="solcord-choice-stack">
            <label className="solcord-choice-row"><SolcordSwitch label="Enable Link Lens" checked={safety.linkLens} onChange={value => onChange({...draft, productPreferences: {...draft.productPreferences, safety: {...safety, linkLens: value}}})} /><span><strong>Link Lens</strong><small>Review external links before opening them. Discord navigation is not intercepted.</small></span></label>
            <label className="solcord-choice-row"><SolcordSwitch label="Enable attachment review" checked={safety.attachmentGuard} onChange={value => onChange({...draft, productPreferences: {...draft.productPreferences, safety: {...safety, attachmentGuard: value}}})} /><span><strong>Attachment review</strong><small>Inspect a file locally before upload. Solcord never submits it for you.</small></span></label>
        </div>
        <details className="solcord-review-details">
            <DisclosureSummary title="Optional private history" detail="Off by default · local, account-scoped, and clearable" />
            <p>These features are off by default. They use only data already loaded by this client and make no extra Discord requests.</p>
            <div className="solcord-choice-stack">
            <label className="solcord-choice-row"><SolcordSwitch label="Enable Friend Watch" checked={friendWatch.enabled} onChange={value => onChange({...draft, productPreferences: {...draft.productPreferences, friendWatch: {...friendWatch, enabled: value}}})} /><span><strong>Friend Watch</strong><small>Relationship transitions only; 30-day encrypted local retention by default. It never guesses who blocked you.</small></span></label>
            <label className="solcord-choice-row"><SolcordSwitch label="Keep Friend Watch display snapshots" disabled={!friendWatch.enabled} checked={friendWatch.includeDisplaySnapshot} onChange={value => onChange({...draft, productPreferences: {...draft.productPreferences, friendWatch: {...friendWatch, includeDisplaySnapshot: value}}})} /><span><strong>Keep display snapshots</strong><small>Store the already-loaded display name inside the encrypted account history. Turn this off to keep only an account-scoped subject key.</small></span></label>
            <label className="solcord-choice-row"><span><strong>Local notifications</strong><small>Daily shows one bounded in-app summary after a new transition; per-event is capped to prevent notification storms.</small></span><select aria-label="Friend Watch notification mode" disabled={!friendWatch.enabled} value={friendWatch.digest} onChange={event => onChange({...draft, productPreferences: {...draft.productPreferences, friendWatch: {...friendWatch, digest: event.currentTarget.value as typeof friendWatch.digest}}})}><option value="off">Off</option><option value="daily">Daily in-app</option><option value="per-event">Per event, local</option></select></label>
            <label className="solcord-choice-row"><SolcordSwitch label="Enable Message Timeline" checked={draft.timelinePolicy.enabled} onChange={value => onChange({...draft, timelinePolicy: {...draft.timelinePolicy, enabled: value}})} /><span><strong>Message Timeline</strong><small>DM-only, text-only, seven days by default. This stores observed message edits/deletes locally.</small></span></label>
            </div>
            <p className="solcord-callout">Without Windows secure storage, private history becomes session-only.</p>
        </details>
    </div>;
}

function ApplyStep({draft}: {draft: SolcordSetupDraft;}) {
    return <div className="solcord-apply-summary">
        <p>Apply verifies the selected files and captures a rollback point. Existing community plugins stay untouched.</p>
        <dl className="solcord-facts"><div><dt>Preset</dt><dd>{draft.preset}</dd></div><div><dt>Performance</dt><dd>{draft.productPreferences.performanceProfile}</dd></div><div><dt>Friend Watch</dt><dd>{draft.productPreferences.friendWatch.enabled ? "consented" : "off"}</dd></div><div><dt>Message Timeline</dt><dd>{draft.timelinePolicy.enabled ? "consented" : "off"}</dd></div><div><dt>Power Lab</dt><dd>off</dd></div></dl>
    </div>;
}

function AddonStep({draft, toggle, selectRecommended}: {draft: SolcordSetupDraft; toggle(name: string, enabled: boolean): void; selectRecommended(): void;}) {
    const selected = useMemo(() => new Set(draft.selectedAddons), [draft.selectedAddons]);
    const plan = useMemo(() => resolveSolcordSetupPlan(draft.selectedAddons, draft.addonModes), [draft.addonModes, draft.selectedAddons]);
    const decisions = useMemo(() => new Map(plan.decisions.map(decision => [decision.name, decision])), [plan.decisions]);
    const readyGroups = useMemo(() => SOLCORD_ADDON_GROUPS.map(group => ({
        ...group,
        addons: group.addons.filter(addon => isReadyDecision(decisions.get(addon.name)))
    })).filter(group => group.addons.length > 0), [decisions]);
    const readyDecisions = useMemo(() => plan.decisions.filter(isReadyDecision), [plan.decisions]);
    const pendingDecisions = useMemo(() => plan.decisions.filter(decision => !isReadyDecision(decision)), [plan.decisions]);
    const selectedReadyCount = readyDecisions.filter(decision => selected.has(decision.name)).length;
    const selectedPendingCount = pendingDecisions.filter(decision => selected.has(decision.name)).length;
    return <div className="solcord-wizard-body">
        <div className="solcord-wizard-inline-heading"><div><h3>Features</h3><p>{selectedReadyCount} of {readyDecisions.length} selected. Anything unavailable stays off.</p></div><div className="solcord-actions"><button type="button" className="solcord-action" onClick={selectRecommended}>Recommended</button><button type="button" className="solcord-action" onClick={() => readyDecisions.forEach(decision => toggle(decision.name, false))}>Clear</button></div></div>
        <div className="solcord-addon-groups">
            {readyGroups.map(group => <fieldset key={group.id} className="solcord-addon-group">
                <legend><span>{group.title}</span><small>{group.summary}</small></legend>
                {group.addons.map(addon => {
                    return <label key={addon.name} className="solcord-addon-choice">
                            <SolcordSwitch label={`${selected.has(addon.name) ? "Disable" : "Enable"} ${addon.name}`} checked={selected.has(addon.name)} onChange={value => toggle(addon.name, value)} />
                            <span><strong>{addon.label}</strong><small>{addon.summary}</small></span>
                            <span className="solcord-review-chip">Runtime check pending</span>
                        </label>;
                })}
            </fieldset>)}
        </div>
        <div className="solcord-catalog-handoff">
            <div><strong>Advanced choices come later</strong><p>{pendingDecisions.length} catalog candidates still need a runtime or security gate. {selectedPendingCount > 0 ? `${selectedPendingCount} saved request(s) remain pending. ` : ""}After setup, Extensions can review community files with a separate backup and rollback preview.</p></div>
        </div>
    </div>;
}

function ReviewStep({draft}: {draft: SolcordSetupDraft;}) {
    const plan = useMemo(() => resolveSolcordSetupPlan(draft.selectedAddons, draft.addonModes), [draft.addonModes, draft.selectedAddons]);
    const readyCount = plan.decisions.filter(isReadyDecision).length;
    const executable = new Set(plan.executableAddons);
    const communityCandidates = SOLCORD_RUNTIME_ADDONS.filter(candidate => executable.has(candidate.name) && plan.decisions.find(decision => decision.name === candidate.name)?.availability === "accepted");
    const dependencies = SOLCORD_RUNTIME_DEPENDENCIES.filter(candidate => plan.dependencyNames.includes(candidate.name));
    const selectedTheme = SOLCORD_THEMES.find(theme => theme.id === draft.selectedTheme)!;
    const themeBytes = SOLCORD_RUNTIME_THEMES.reduce((sum, theme) => sum + theme.sizeBytes, 0);
    const diskBytes = communityCandidates.reduce((sum, candidate) => sum + candidate.sizeBytes, 0) + dependencies.reduce((sum, dependency) => sum + dependency.sizeBytes, 0) + themeBytes;
    const conflicts = [...new Set(plan.decisions.filter(decision => decision.willApply).flatMap(decision => [...decision.conflicts]))];
    const changes = SolcordRuntime.previewSetup(draft);
    const activeSkipped = useStateFromStores([PluginManager], () => plan.skipped.filter(decision => communityAddonIsEnabled(PluginManager, decision.name, decision.fileName)));
    const activeUnrequested = useStateFromStores([PluginManager], () => {
        const requested = new Set(plan.requestedAddons);
        return SOLCORD_RUNTIME_ADDONS.filter(candidate => !requested.has(candidate.name) && communityAddonIsEnabled(PluginManager, candidate.name, candidate.fileName)).map(candidate => candidate.name);
    });
    const liveThemeState = useStateFromStores([ThemeManager], () => ({
        selectedEnabled: ThemeManager.isEnabled(selectedTheme.fileName),
        activeOtherNames: SOLCORD_THEMES.filter(theme => theme.id !== selectedTheme.id && ThemeManager.isEnabled(theme.fileName)).map(theme => theme.name),
        activeThirdPartyNames: ThemeManager.addonList
            .filter(theme => !SOLCORD_THEMES.some(candidate => candidate.fileName === theme.filename) && ThemeManager.isEnabled(theme.filename))
            .map(theme => theme.name || theme.filename)
    }));
    return <div className="solcord-wizard-body">
        <h3>Check your choices</h3>
        <dl className="solcord-facts">
            <div><dt>Ready tools selected</dt><dd>{plan.executableAddons.length} of {readyCount}</dd></div>
            <div><dt>Pending catalog requests</dt><dd>{plan.skipped.length} · no download</dd></div>
            <div><dt>Dependencies</dt><dd>{dependencies.map(item => item.name).join(", ") || "none"}</dd></div>
            <div><dt>Theme enabled after Apply and verify</dt><dd>{selectedTheme.name}</dd></div>
            <div><dt>Bundled theme files in transaction</dt><dd>{SOLCORD_RUNTIME_THEMES.length}</dd></div>
            <div><dt>Maximum staged disk use</dt><dd>{bytesLabel(diskBytes)}</dd></div>
        </dl>
        <details className="solcord-review-details">
            <summary>Review every setting, conflict, and file</summary>
            <div className="solcord-review-columns">
                <div><strong>Settings diff</strong>{changes.length ? <ul>{changes.map(change => <li key={change}>{change}</li>)}</ul> : <p>No stored-selection difference; Apply and verify still checks selected files.</p>}</div>
                <div><strong>Known conflict checks</strong>{conflicts.length ? <ul>{conflicts.map(conflict => <li key={conflict}>{conflict}</li>)}</ul> : <p>No catalog-declared conflicts in this selection.</p>}</div>
            </div>
            {plan.skipped.length > 0 && <p className="solcord-callout"><strong>Pending stays pending:</strong> {plan.skipped.length} saved catalog request(s) remain uninstalled. Review their individual evidence and status in the catalog after setup.</p>}
            {activeSkipped.length > 0 && <p className="solcord-callout"><strong>Selected community files already active:</strong> {activeSkipped.map((decision: SolcordSetupCandidateDecision) => decision.name).join(", ")} remain enabled and owner-managed. Solcord skips their unaccepted catalog candidates without replacing, stopping, or certifying the existing files.</p>}
            {activeUnrequested.length > 0 && <p className="solcord-callout"><strong>Preserved owner addons:</strong> {activeUnrequested.join(", ")} are active but were not requested here. Apply and verify leaves them unchanged and outside this transaction.</p>}
            {liveThemeState.activeThirdPartyNames.length > 0 && <p className="solcord-callout"><strong>Possible theme overlap:</strong> {liveThemeState.activeThirdPartyNames.join(", ")} remain enabled and owner-managed. Apply and verify does not modify third-party themes.</p>}
            <div className="solcord-callout"><strong>Theme files</strong><p>All {SOLCORD_RUNTIME_THEMES.length} bundled files are included and hash-verified. Apply and verify {liveThemeState.selectedEnabled ? "keeps" : "enables"} {selectedTheme.name}{liveThemeState.activeOtherNames.length ? ` and disables ${liveThemeState.activeOtherNames.join(", ")}` : ""}; rollback restores the prior state.</p></div>
        </details>
        <p className="solcord-callout">Only the ready set changes. Pending tools stay uninstalled, exact hashes are verified, and rollback is kept.</p>
    </div>;
}

export default function SetupWizard() {
    const document = useStateFromStores(SolcordSettings, () => SolcordSettings.snapshot());
    const wizardRef = useRef<HTMLElement | null>(null);
    const [step, setStepState] = useState(document.onboarding.lastStep);
    const [draft, setDraftState] = useState<SolcordSetupDraft>(() => draftFrom(document));
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState("");
    const plan = useMemo(() => resolveSolcordSetupPlan(draft.selectedAddons, draft.addonModes), [draft.addonModes, draft.selectedAddons]);
    useEffect(() => {
        try {SolcordSettings.setSetupDraft(draft);}
        catch {setStatus("Your setup choices could not be saved. The durable draft was left unchanged; check disk access and retry before applying.");}
    }, [draft]);
    useEffect(() => {
        const frame = requestAnimationFrame(() => scrollSolcordSettingsTarget(wizardRef.current, "target"));
        return () => cancelAnimationFrame(frame);
    }, [step]);
    useEffect(() => {
        const frame = requestAnimationFrame(() => void SolcordRuntime.acknowledgeFirstSetupIntent());
        return () => cancelAnimationFrame(frame);
    }, []);
    const setDraft = (update: SolcordSetupDraft | ((current: SolcordSetupDraft) => SolcordSetupDraft)) => setDraftState(current => typeof update === "function" ? update(current) : update);
    const toggle = (name: string, enabled: boolean) => setDraft(current => ({...current, selectedAddons: enabled ? [...new Set([...current.selectedAddons, name])] : current.selectedAddons.filter(item => item !== name)}));
    const setStep = (next: number) => {
        const bounded = Math.min(WIZARD_STEPS.length - 1, Math.max(0, next));
        try {
            SolcordSettings.setOnboardingStep(bounded);
            setStepState(bounded);
        }
        catch {setStatus("Solcord could not save this setup step. Your durable setup state was left unchanged; check disk access and retry.");}
    };
    const setPreset = (preset: SolcordSetupPreset) => setDraft(current => ({
        ...current,
        preset,
        selectedAddons: preset === "minimal" ? [] : preset === "power-user" ? [...SOLCORD_PRESET_ADDONS] : recommendedSolcordSetupAddons()
    }));
    const selectRecommended = () => setDraft(current => {
        const recommended = recommendedSolcordSetupAddons();
        const readyNames = new Set(resolveSolcordSetupPlan(SOLCORD_PRESET_ADDONS, current.addonModes).decisions.filter(isReadyDecision).map(decision => decision.name));
        return {
            ...current,
            selectedAddons: [...new Set([...current.selectedAddons.filter(name => !readyNames.has(name)), ...recommended])]
        };
    });
    const finish = async () => {
        if (!window.confirm(`Apply ${plan.executableAddons.length} ready feature(s) and activate ${SOLCORD_THEMES.find(theme => theme.id === draft.selectedTheme)?.name}? Existing community plugins stay untouched; Extensions can review replacements later with a separate rollback preview.`)) return;
        setBusy(true);
        setStatus(plan.skipped.length ? `Applying the ready set; ${plan.skipped.length} unavailable choice(s) will be skipped…` : "Applying the ready set and verifying hashes…");
        try {
            const result = await SolcordRuntime.finishSetup(draft, undefined, {migrateProviders: false});
            setStatus(`Finished transaction ${result.transactionId}. ${result.enabled.length} enabled; ${plan.skipped.length} skipped; ${result.quarantined.length} quarantined; ${result.providerConflicts.length} provider conflict(s).`);
        }
        catch (error) {setStatus(setupFailureMessage(error));}
        finally {
            setBusy(false);
        }
    };
    const finishLater = () => {
        try {
            SolcordSettings.setSetupDraft(draft);
            SolcordSettings.setOnboardingStep(step);
            SolcordSettings.skipOnboarding();
        }
        catch {setStatus("Solcord could not save this setup for later. Setup remains open and no feature state was changed.");}
    };
    const stepContent = [
        <WelcomeStep />,
        <PrivacyStep draft={draft} onChange={setDraft} />,
        <ThemeStep value={draft.selectedTheme} appearance={draft.productPreferences.appearance} performanceProfile={draft.productPreferences.performanceProfile} onChange={selectedTheme => setDraft(current => ({...current, selectedTheme}))} onAppearance={appearance => setDraft(current => ({...current, productPreferences: {...current.productPreferences, appearance}}))} />,
        <><PerformanceStep draft={draft} onChange={setDraft} /><PresetStep value={draft.preset} onChange={setPreset} /><details className="solcord-features-advanced"><DisclosureSummary title="Customize individual features" detail="Optional · every adapter is checked before it can start" /><AddonStep draft={draft} toggle={toggle} selectRecommended={selectRecommended} /></details></>,
        <><ReviewStep draft={draft} /><ApplyStep draft={draft} /><details className="solcord-features-advanced"><DisclosureSummary title="Activities compatibility check" detail="Policy status only · no Activity is launched during setup" /><ActivitiesStep /></details></>
    ][step];

    return <section ref={wizardRef} className="solcord-wizard" aria-labelledby="solcord-setup-title" aria-busy={busy}>
        <div className="solcord-wizard-title"><div><p className="solcord-eyebrow">First setup</p><h2 id="solcord-setup-title">Set up Solcord</h2><p>Five quick steps. Nothing changes until Apply.</p></div><span>{step + 1} / {WIZARD_STEPS.length}</span></div>
        <div className="solcord-wizard-progress" role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={WIZARD_STEPS.length} aria-valuenow={step + 1}><span style={{width: `${((step + 1) / WIZARD_STEPS.length) * 100}%`}} /></div>
        <StepNavigation step={step} setStep={setStep} disabled={busy} />
        <div key={step} className="solcord-wizard-current-step" role="group" aria-label={`${WIZARD_STEPS[step]} setup step`}>{stepContent}</div>
        <div className="solcord-wizard-footer">
            <div className="solcord-actions"><button type="button" className="solcord-action" onClick={() => setStep(step - 1)} disabled={step === 0 || busy}>Back</button>{step < WIZARD_STEPS.length - 1 ? <button type="button" className="solcord-action solcord-action-accent" disabled={busy} onClick={() => setStep(step + 1)}>Continue</button> : <button type="button" className="solcord-action solcord-action-accent" disabled={busy} onClick={() => void finish()}>{busy ? "Applying…" : "Apply"}</button>}<button type="button" className="solcord-text-button" disabled={busy} onClick={finishLater}>Finish later</button></div>
            {status && <p role="status" aria-live="polite" className="solcord-setup-status">{status}</p>}
        </div>
    </section>;
}
