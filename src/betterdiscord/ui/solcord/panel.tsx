import React from "react";
import solcordMark from "@assets/branding/solcord-mark.svg";

import {useStateFromStores} from "@ui/hooks";
import Toasts from "@stores/toasts";
import Config from "@stores/config";
import PluginManager from "@modules/pluginmanager";
import SolcordRuntime from "@modules/solcord/runtime";
import SolcordSettings, {SOLCORD_PRESET_ADDONS} from "@modules/solcord/store";
import PluginDoctor from "@modules/solcord/doctor";
import type {SolcordLocalTranslationAvailability} from "@modules/solcord/local-translation";
import type {SolcordVoiceNotePhase} from "@modules/solcord/native-suite";
import {CoreUpdater, PluginUpdater, ThemeUpdater} from "@modules/updater";
import type {SolcordModuleId, SolcordSetupDraft} from "@modules/solcord/contracts";
import type {LinkInspection} from "@modules/solcord/link-lens";

import SetupWizard from "./setup-wizard";
import MessageTimelinePanel from "./timeline";
import {CatalogBrowser, CuratedAddonSet} from "./addon-catalog";
import {SOLCORD_ADDON_PRESENTATION, SOLCORD_POWER_LAB} from "./catalog";
import {findSolcordWorkspaces, isSolcordTranslationLanguage, normalizeSolcordMediaShelfUrl, normalizeSolcordTranslationEndpoint, prioritizeSolcordPulse, resolveSolcordPerformancePolicy, SOLCORD_PERFORMANCE_POLICIES, SOLCORD_WORKSPACES, type SolcordAppearancePreferences, type SolcordMediaKind, type SolcordPerformanceProfile, type SolcordProductPreferences, type SolcordWorkspaceId} from "@common/solcord/product";
import {isSolcordBuiltInAddon, SOLCORD_CLEAN_ROOM_BUILTIN_ADDONS, solcordBuiltInCapability, solcordNativeSuiteFeatureForAddon, type SolcordProviderMigrationPlan} from "@common/solcord/builtin-addons";
import {SOLCORD_V2_REPLACEMENT_MANIFEST} from "@common/solcord/v2-replacement-manifest";
import {presentSolcordChannelGlance, type SolcordChannelGlancePresentation} from "@common/solcord/chat-output";
import {privacyCapabilityStateLabel} from "@common/solcord/privacy";
import {scrollSolcordSettingsTarget} from "./scroll-owner";
import SolcordSwitch from "./switch";
import PreferenceSlider from "./slider";
import AccessibilityOptions from "./accessibility-options";
import PreferenceTextField from "./text-field";
import ActionButton from "./action-button";
import {SolcordActionErrorContext, useSolcordAction, useSolcordResultScope, useSolcordWrite} from "./use-action";

const {useEffect, useRef, useState} = React;

const WORKSPACE_GROUPS: ReadonlyArray<{label: string; ids: SolcordWorkspaceId[];}> = [
    {label: "Start", ids: ["overview"]},
    {label: "Personalize", ids: ["appearance", "performance"]},
    {label: "Features", ids: ["privacy", "chat", "voice", "friends"]},
    {label: "System", ids: ["extensions", "recovery"]}
];

function timestamp(value?: number | string): string {
    if (!value) return "never";
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? "unknown" : date.toLocaleString();
}

function Section({title, summary, children}: {title: string; summary?: string; children: React.ReactNode;}) {
    return <section className="solcord-section">
        <div className="solcord-section-heading">
            <h3>{title}</h3>
            {summary && <p>{summary}</p>}
        </div>
        {children}
    </section>;
}

function RuntimeStatusDetails() {
    const health = useStateFromStores(SolcordRuntime, () => SolcordRuntime.health());
    return <div className="solcord-module-table" role="list" aria-label="Read-only Solcord runtime status">
        {health.length ? health.map(item => <div className="solcord-module-row" role="listitem" key={item.id}>
            <div className="solcord-module-primary">
                <div className="solcord-module-name"><strong>{item.name}</strong><span className={`solcord-status solcord-status-${item.status}`}>{item.status}</span></div>
                <p>{item.detail}</p>
                <small>{item.startupDurationMs === undefined ? "Not timed" : `${item.startupDurationMs} ms startup`} · {Object.values(item.resources).reduce((sum, value) => sum + value, 0)} owned resources</small>
            </div>
        </div>) : <p className="solcord-empty" role="status">Runtime status will appear after Solcord finishes starting.</p>}
    </div>;
}

function ActivityBridge() {
    const activity = useStateFromStores(SolcordRuntime, () => SolcordRuntime.activityHealth());
    const events = activity?.events.slice(-8).reverse() ?? [];
    const ready = (activity?.status === "healthy" || activity?.status === "idle") && !activity.unrestrictedOverride;
    const readinessCopy = activity?.status === "idle"
        ? "Same-package preload protection is active; no Activity window has opened in this session."
        : "Same-package preload protection is active; the unrestricted override is off.";
    return <Section title="Activities" summary="A bounded compatibility fix for Discord's embedded games.">
        <div className={ready ? "solcord-all-clear" : "solcord-callout solcord-callout-danger"} role="status"><strong>{ready ? "Ready" : "Needs review"}</strong>{" "}<span>{ready ? readinessCopy : "The compatibility policy is not fully healthy on this Discord build."}</span></div>
        <details className="solcord-secondary-tools"><summary>Technical details</summary>
            <dl className="solcord-facts"><div><dt>Policy</dt><dd>{activity?.status ?? "waiting"}</dd></div><div><dt>Accepted assignments</dt><dd>{activity?.counters?.discordPreloadsAccepted ?? 0}</dd></div><div><dt>Rejected assignments</dt><dd>{activity?.counters?.assignmentsRejected ?? 0}</dd></div><div><dt>Unrestricted override</dt><dd>{activity?.unrestrictedOverride ? "On" : "Off"}</dd></div></dl>
            <div className="solcord-ledger" aria-label="Recent Activity compatibility events">
                {events.length ? events.map(event => <div key={event.sequence} className="solcord-ledger-row">
                    <time>{timestamp(event.timestamp)}</time>
                    <strong>{event.action}</strong>
                    <span>{event.context}{event.reason ? ` · ${event.reason}` : ""}</span>
                </div>) : <p className="solcord-empty">No Activity window decision has been observed in this session.</p>}
            </div>
            <div className="solcord-actions"><ActionButton onClick={() => SolcordRuntime.exportDiagnostics()}>Export sanitized diagnostics</ActionButton></div>
        </details>
    </Section>;
}

function PluginRecovery() {
    const state = useStateFromStores([PluginDoctor, SolcordRuntime, SolcordSettings], () => ({records: PluginDoctor.snapshot(), integrity: SolcordRuntime.integrityStatus(), curated: SolcordSettings.slice("curatedAddons"), adapters: SolcordRuntime.curatedAdapterStatus()}));
    const [retrying, setRetrying] = useState<string>();
    const [retryStatus, setRetryStatus] = useState("");
    const archivedProviders = state.records.filter(record => {
        if (!record.quarantinedAt) return false;
        const curated = state.curated[record.addonId];
        const sourceIsArchived = state.integrity.records.some(integrity => integrity.kind === "addon" && integrity.name === record.addonId && integrity.status === "missing");
        return Boolean(curated && isSolcordBuiltInAddon(record.addonId, curated.mode) && sourceIsArchived && state.adapters[record.addonId]?.enabled);
    });
    const archivedProviderIds = new Set(archivedProviders.map(record => record.addonId));
    const quarantined = state.records.filter(record => record.quarantinedAt && !archivedProviderIds.has(record.addonId));
    const visibleIntegrity = state.integrity.records.filter(record => record.status !== "match" && record.status !== "missing").slice(0, 12);
    const requestedUnavailable = state.integrity.records.filter(record => record.kind === "addon" && record.status === "missing" && state.curated[record.name]?.selected && !isSolcordBuiltInAddon(record.name, state.curated[record.name]?.mode));
    const retry = async (id: string) => {
        setRetrying(id);
        const succeeded = await SolcordRuntime.retryQuarantinedAddon(id);
        setRetryStatus(succeeded ? `${id} passed a fresh integrity audit and started.` : `${id} stayed quarantined because integrity or startup validation did not pass.`);
        setRetrying(undefined);
    };
    const needsReview = state.integrity.summary.attention + state.integrity.summary.unavailable;
    if (!needsReview && !quarantined.length) {
        return <Section title="Plugin Doctor">
            <div className="solcord-all-clear" role="status"><strong>All clear</strong><span>Reviewed files match and no addon is quarantined.</span></div>
            {archivedProviders.length > 0 && <details className="solcord-secondary-tools"><summary>{archivedProviders.length} superseded provider record(s) archived</summary><p>The old plugin source files are outside the loader. Their settings and private data remain preserved for rollback.</p></details>}
            {requestedUnavailable.length > 0 && <details className="solcord-secondary-tools"><summary>{requestedUnavailable.length} optional catalog request(s) saved</summary><p>These community files are not installed or running. Their saved choices are preserved; Solcord built-ins do not need them.</p></details>}
            <details className="solcord-secondary-tools"><summary>Technical details</summary><dl className="solcord-facts"><div><dt>Verified files</dt><dd>{state.integrity.summary.match}</dd></div><div><dt>Optional files absent</dt><dd>{state.integrity.summary.missing}</dd></div></dl></details>
        </Section>;
    }
    return <Section title="Plugin Doctor" summary="Installed files, failures, and recovery.">
        <div className="solcord-health-strip" aria-label="Plugin Doctor summary"><span><strong>{state.integrity.summary.match}</strong> verified</span><span><strong>{needsReview}</strong> need review</span><span><strong>{quarantined.length}</strong> quarantined</span></div>
        {requestedUnavailable.length > 0 && <p className="solcord-callout"><strong>{requestedUnavailable.length} saved catalog request(s) are not installed.</strong> They remain optional and off because their review or dependency gate is incomplete. Solcord built-ins do not require community plugin files.</p>}
        {quarantined.length ? <div className="solcord-recovery-list">
            {quarantined.map(record => <div className="solcord-recovery-row" key={record.addonId}>
                <div><strong>{record.addonId}</strong><p>{record.quarantineReason}</p><small>Quarantined {timestamp(record.quarantinedAt)}</small></div>
                <ActionButton tone="danger" disabled={retrying === record.addonId} onClick={() => retry(record.addonId)}>{retrying === record.addonId ? "Checking…" : "Retry once"}</ActionButton>
            </div>)}
        </div> : <p className="solcord-empty">No addon is quarantined.</p>}
        {retryStatus && <p role="status" className="solcord-import-status">{retryStatus}</p>}
        {archivedProviders.length > 0 && <details className="solcord-secondary-tools"><summary>{archivedProviders.length} superseded provider record(s) archived</summary><p>The old plugin source files are outside the loader. Their settings and private data remain preserved for rollback.</p></details>}
        {visibleIntegrity.length ? <div className="solcord-ledger" aria-label="Add-on integrity requiring review">
            {visibleIntegrity.map(record => <div className="solcord-ledger-row" key={`${record.kind}-${record.name}`}><strong>{record.name}</strong><span>{record.kind} · {record.status}</span><code>{record.reviewedSha256.slice(0, 12)}…{record.installedSha256 ? ` / ${record.installedSha256.slice(0, 12)}…` : ""}</code></div>)}
            {state.integrity.records.filter(record => record.status !== "match" && record.status !== "missing").length > visibleIntegrity.length && <p className="solcord-empty">Showing the first {visibleIntegrity.length} path-free attention records. Sanitized diagnostics contain the complete bounded status list.</p>}
        </div> : <p className="solcord-empty">Every installed reviewed file matches.</p>}
        <details className="solcord-secondary-tools"><summary>Integrity details</summary><dl className="solcord-facts"><div><dt>Optional files not installed</dt><dd>{state.integrity.summary.missing}</dd></div><div><dt>Audit unavailable</dt><dd>{state.integrity.summary.unavailable}</dd></div></dl></details>
    </Section>;
}

function ProfilesAndHistory() {
    const document = useStateFromStores(SolcordSettings, () => SolcordSettings.readonlySnapshot());
    const [profileId, setProfileId] = useState(document.profiles[0]?.id ?? "");
    const [newName, setNewName] = useState("");
    const [includeThirdParty, setIncludeThirdParty] = useState(false);
    const [importStatus, setImportStatus] = useState("");
    const diff = profileId ? SolcordRuntime.previewProfile(profileId) : [];
    const selected = document.profiles.find(profile => profile.id === profileId);
    const apply = async () => {
        if (!selected) return;
        if (!window.confirm(`Apply ${selected.name}? Solcord will snapshot the current state first and then apply the complete preview shown here.`)) return;
        const executionPlan = SolcordRuntime.profileAddonExecutionPlan(selected.id);
        if (selected.includesThirdPartyAddons) {
            if (!executionPlan) {
                setImportStatus("The third-party addon plan changed before confirmation; nothing was applied.");
                return;
            }
            const starts = [...executionPlan.enablePlugins, ...executionPlan.enableThemes];
            const stops = [...executionPlan.disablePlugins, ...executionPlan.disableThemes];
            const startList = starts.length ? starts.map(fileName => `• ${fileName}`).join("\n") : "• none";
            const stopList = stops.length ? stops.map(fileName => `• ${fileName}`).join("\n") : "• none";
            if (!window.confirm(`Third-party execution confirmation\n\nApplying this profile will start ${executionPlan.enablePlugins.length} plugin file(s) now. Enabled plugins execute third-party code in Discord. It will also enable ${executionPlan.enableThemes.length} theme file(s) and stop or disable ${stops.length} file(s).\n\nFiles to start or enable (${starts.length}):\n${startList}\n\nFiles to stop or disable (${stops.length}):\n${stopList}\n\nContinue with these exact files?`)) return;
        }
        const applied = await SolcordRuntime.applyProfile(selected.id, executionPlan);
        setImportStatus(applied ? `${selected.name} applied with a rollback snapshot.` : `${selected.name} was not fully applied. Solcord attempted recovery; review the current addon and module states before retrying.`);
    };
    const save = () => {
        try {
            if (includeThirdParty && !window.confirm("Save the complete currently enabled BetterDiscord plugin and theme set in this profile? Applying it later can execute or stop third-party code. The file names will appear in settings exports.")) return;
            const profile = SolcordRuntime.saveProfile(newName, includeThirdParty);
            setNewName("");
            setIncludeThirdParty(false);
            setProfileId(profile.id);
            setImportStatus(`Saved ${profile.name}.`);
        }
        catch (error) {
            setImportStatus(error instanceof Error ? error.message : "The profile could not be saved.");
        }
    };
    const importFile = async (file?: File) => {
        setImportStatus("");
        if (!file) return;
        if (file.size > 1024 * 1024) {
            setImportStatus("The settings file exceeds the 1 MB safety limit.");
            return;
        }
        try {
            const text = await file.text();
            const importPreview = SolcordRuntime.previewSettingsImport(text);
            if (!importPreview) {
                setImportStatus("Choose an unmodified Solcord settings export.");
                return;
            }
            const {changes, fingerprint} = importPreview;
            const preview = changes.length ? changes.map(change => `• ${change}`).join("\n") : "No settings differences.";
            if (!window.confirm(`Import this validated Solcord settings file? The current state will be snapshotted first.\n\nComplete preview:\n${preview}`)) {
                setImportStatus("Import cancelled; no settings changed.");
                return;
            }
            const imported = await SolcordRuntime.importSettings(text, fingerprint);
            setImportStatus(imported ? "Settings imported. A rollback snapshot was kept." : "Import changed after preview or failed validation; no settings changed.");
        }
        catch {
            setImportStatus("The settings file could not be read locally.");
        }
    };
    return <Section title="Profiles and snapshots" summary="Preview a profile, apply it safely, or return to an earlier state.">
        <div className="solcord-split">
            <div>
                <label className="solcord-field">Profile
                    <select value={profileId} onChange={event => setProfileId(event.currentTarget.value)}>
                        {document.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                    </select>
                </label>
                <div className="solcord-diff" aria-label="Profile change preview">
                    <strong>Complete preview</strong>
                    {diff.length ? <ul>{diff.map(item => <li key={item}>{item}</li>)}</ul> : <p>No module-setting differences.</p>}
                </div>
                <div className="solcord-actions">
                    <ActionButton tone="accent" onClick={() => apply()} disabled={!selected}>Apply with snapshot</ActionButton>
                    <ActionButton onClick={() => SolcordRuntime.exportSettings()}>Export settings</ActionButton>
                </div>
                <details className="solcord-secondary-tools">
                    <summary>Import, export, or create a profile</summary>
                    <p>Profiles save Solcord module settings only. They do not capture Timeline policy or curated-addon choices.</p>
                    <label className="solcord-file-import">Import settings JSON
                        <input type="file" accept="application/json,.json" onChange={event => {
                            const file = event.currentTarget.files?.[0];
                            event.currentTarget.value = "";
                            void importFile(file);
                        }} />
                    </label>
                    <div className="solcord-inline-field">
                        <input value={newName} maxLength={80} placeholder="Profile name" aria-label="Custom profile name" onChange={event => setNewName(event.currentTarget.value)} />
                        <ActionButton onClick={save} disabled={!newName.trim()}>Save module state</ActionButton>
                    </div>
                    <label className="solcord-profile-addon-optin"><SolcordSwitch label="Include enabled third-party plugins and themes" checked={includeThirdParty} onChange={setIncludeThirdParty} /> Include enabled third-party plugins and themes</label>
                    <p className="solcord-key-hint">Applying a profile that includes plugins can execute third-party code. Solcord always shows the exact files before it starts them.</p>
                </details>
                {importStatus && <p className="solcord-import-status" role="status">{importStatus}</p>}
            </div>
            <div>
                <strong>Recent snapshots</strong>
                <div className="solcord-snapshot-list">
                    {document.snapshots.slice(-6).reverse().map(snapshot => <div key={snapshot.id} className="solcord-snapshot-row">
                        <div><span>{snapshot.reason}</span><small>{timestamp(snapshot.createdAt)}</small></div>
                        <ActionButton onClick={() => {
                            if (!window.confirm(`Roll back to “${snapshot.reason}”? A snapshot of the current state will be kept.`)) return;
                            return SolcordRuntime.rollback(snapshot.id).then(restored => setImportStatus(restored
                                ? `Rolled back to “${snapshot.reason}”.`
                                : "The settings snapshot was restored, but one or more addon states remained held or failed to change. Review Plugin Doctor before retrying."));
                        }}>Roll back</ActionButton>
                    </div>)}
                    {!document.snapshots.length && <p className="solcord-empty">No snapshot has been captured yet.</p>}
                </div>
            </div>
        </div>
    </Section>;
}

function PrivacyProtectionPanel() {
    const state = useStateFromStores([SolcordSettings, SolcordRuntime], () => ({
        preferences: SolcordSettings.slice("productPreferences").privacy,
        capabilities: SolcordRuntime.privacyCapabilities(),
        receipts: SolcordRuntime.privacyDecisionReceipts(),
        receiptStorage: SolcordRuntime.privacyReceiptStorage()
    }));
    const [status, setStatus] = useState("");
    const applyProfile = async (profile: "strict" | "standard") => {
        if (profile === state.preferences.profile && !state.preferences.migrationPending) return;
        if (profile === "strict" && !window.confirm("Apply Strict Privacy? Solcord will capture a rollback snapshot, block verified optional reporting and activity discovery, make update checks manual, and disable enabled community addons whose exact reviewed bytes do not declare local-only behavior. Core chat, calls, media, moderation, safety, sign-in, and Discord security updates remain available.")) return;
        try {
            await SolcordRuntime.setPrivacyProfile(profile);
            setStatus(profile === "strict" ? "Strict Privacy applied with a rollback snapshot." : "Standard privacy applied with a rollback snapshot.");
        }
        catch (error) {setStatus(error instanceof Error ? error.message : "The privacy change failed closed. Open Recovery to verify the rollback snapshot.");}
    };
    const checkUpdates = async () => {
        setStatus("Checking reviewed addon and theme sources…");
        try {
            await Promise.all([CoreUpdater.checkForUpdate(false), PluginUpdater.checkAll(false), ThemeUpdater.checkAll(false)]);
            setStatus("Manual update check finished. Solcord core remains pinned until an owner-controlled integrity feed is available.");
        }
        catch {setStatus("The manual update check did not complete. Existing files were not changed.");}
    };
    return <Section title="Privacy protection" summary="Optional data collection is controlled without intercepting Discord's essential traffic.">
        <div className="solcord-privacy-command">
            <div><p className="solcord-eyebrow">Current profile</p><strong>{state.preferences.profile === "strict" ? "Strict Privacy" : state.preferences.profile === "standard" ? "Standard" : "Custom"}</strong><p>{state.preferences.profile === "strict" ? "Verified optional reporting is blocked; unsupported categories stay visible; updates are manual." : "Some optional Discord reporting may remain available."}</p></div>
            {state.preferences.migrationPending && <span className="solcord-status solcord-status-starting">Needs review</span>}
        </div>
        <div className="solcord-actions"><ActionButton tone="accent" disabled={state.preferences.profile === "strict" && !state.preferences.migrationPending} onClick={() => applyProfile("strict")}>{state.preferences.profile === "strict" && !state.preferences.migrationPending ? "Strict Privacy on" : "Use Strict Privacy"}</ActionButton><ActionButton disabled={state.preferences.profile === "standard" && !state.preferences.migrationPending} onClick={() => applyProfile("standard")}>{state.preferences.profile === "standard" && !state.preferences.migrationPending ? "Standard on" : "Use Standard"}</ActionButton><ActionButton onClick={() => checkUpdates()}>Check for updates</ActionButton></div>
        <div className="solcord-privacy-capabilities" role="list" aria-label="Privacy capability status">{state.capabilities.map(capability => <div key={capability.dataClass} role="listitem"><span><strong>{capability.dataClass.replaceAll("-", " ")}</strong><small>{capability.summary}</small></span><span className={`solcord-privacy-state solcord-privacy-state-${capability.state.toLowerCase()}`}>{privacyCapabilityStateLabel(capability.state)}</span></div>)}</div>
        <p className="solcord-key-hint">Discord account privacy settings are separate. Solcord reports unsupported or drifting protection honestly and never claims zero tracking without an exact-build network audit.</p>
        {status && <p role="status" className="solcord-import-status">{status}</p>}
        <details className="solcord-secondary-tools"><summary>Technical details</summary>{state.receiptStorage === "session-only" && <p role="status">Diagnostics are session-only because local storage is unavailable. Privacy protection is still active.</p>}<p>{state.receipts.length} content-free local decision receipt(s). Receipts contain only category, decision, coarse time, and result—never URLs, payloads, account IDs, messages, attachments, or file paths.</p></details>
    </Section>;
}

function StreamShieldControls() {
    const document = useStateFromStores(SolcordSettings, () => SolcordSettings.readonlySnapshot());
    const shield = document.modules["stream-shield"].values;
    const setting = useSolcordWrite((id: SolcordModuleId, key: string, value: unknown) => SolcordRuntime.setValue(id, key, value));
    return <Section title="Privacy Mode" summary="Preview local redaction before sharing your screen.">
        <div className="solcord-control-grid">
            <label><SolcordSwitch label="Stream Shield preview" checked={shield.previewActive === true} onChange={value => setting("stream-shield", "previewActive", value)} /> Stream Shield preview</label>
            <label><SolcordSwitch label="Stream Shield manual state" checked={shield.manualActive === true} onChange={value => setting("stream-shield", "manualActive", value)} /> Stream Shield manual state</label>
            <label><SolcordSwitch label="Redact guild identity" checked={shield.redactGuilds === true} onChange={value => setting("stream-shield", "redactGuilds", value)} /> Redact guild identity</label>
            <label><SolcordSwitch label="Redact channel names" checked={shield.redactChannels === true} onChange={value => setting("stream-shield", "redactChannels", value)} /> Redact channel names</label>
            <label><SolcordSwitch label="Redact DM identity" checked={shield.redactDMs === true} onChange={value => setting("stream-shield", "redactDMs", value)} /> Redact DM identity</label>
            <label><SolcordSwitch label="Redact notifications" checked={shield.redactNotifications === true} onChange={value => setting("stream-shield", "redactNotifications", value)} /> Redact notifications</label>
            <label><SolcordSwitch label="Redact local notes" checked={shield.redactNotes === true} onChange={value => setting("stream-shield", "redactNotes", value)} /> Redact local notes</label>
            <label><SolcordSwitch label="Redact account area" checked={shield.redactAccount === true} onChange={value => setting("stream-shield", "redactAccount", value)} /> Redact account area</label>
        </div>
        <p className="solcord-key-hint"><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd> toggles Privacy Mode when Stream Shield is enabled.</p>
    </Section>;
}

function readAudienceGuardPanelState() {
    return {
        accountGeneration: SolcordRuntime.privateAccountGeneration(),
        settings: SolcordSettings.snapshot().modules["stream-audience-guard"],
        runtime: SolcordRuntime.audienceGuardStatus(),
        privateState: SolcordRuntime.audienceGuardPrivatePolicy(),
        armReadiness: SolcordRuntime.audienceGuardArmReadiness()
    };
}

function StreamAudienceGuardControls() {
    const state = useStateFromStores([SolcordSettings, SolcordRuntime], readAudienceGuardPanelState);
    return <StreamAudienceGuardAccountControls key={state.accountGeneration} state={state} />;
}

function StreamAudienceGuardAccountControls({state}: {state: ReturnType<typeof readAudienceGuardPanelState>;}) {
    const [userId, setUserId] = useState("");
    const [label, setLabel] = useState("");
    const [actionStatus, setActionStatus] = useState("");
    const accountIsCurrent = () => SolcordRuntime.privateAccountIsCurrent(state.accountGeneration);
    const results = useSolcordResultScope(String(state.accountGeneration), accountIsCurrent);
    const setMode = (key: "preventStart" | "stopOnJoin" | "stopOnWatch", value: boolean) => {
        if (key === "stopOnWatch" && value && !window.confirm("Enable Stop on Watch? A denied viewer may receive brief frames before Discord reports them. This is detection and rapid stopping, not per-viewer stream access control.")) return;
        return SolcordRuntime.setValue("stream-audience-guard", key, value);
    };
    const add = async () => {
        const isCurrent = results.begin();
        if (!isCurrent()) return;
        const normalizedId = userId.trim();
        if (!/^[1-9]\d{16,19}$/.test(normalizedId)) {
            setActionStatus("Enter a complete Discord user ID (17 to 20 digits).");
            return;
        }
        const complete = await SolcordRuntime.setAudienceGuardEntries([...state.privateState.policy.entries, {userId: normalizedId, label: label.trim()}], state.accountGeneration);
        if (!isCurrent()) return;
        setActionStatus(complete ? "Denied user saved to this account's private policy." : "The private policy is available for this session, but encrypted persistence could not be confirmed.");
        setUserId("");
        setLabel("");
    };
    const arm = () => {
        if (!accountIsCurrent()) return;
        if (!state.armReadiness.ready) {
            setActionStatus(state.armReadiness.detail);
            return;
        }
        if (!window.confirm("Arm Stream Audience Guard for the current voice call? Solcord will prevent or stop your own Go Live when a denied user is detected. This cannot make a normal Discord stream invisible to one person or guarantee zero-frame exposure.")) return;
        if (!accountIsCurrent()) return;
        setActionStatus(SolcordRuntime.armAudienceGuard(state.accountGeneration) ? "Audience Guard is armed for this call." : "Audience Guard could not arm. Join a voice channel, add a denied user, enable at least one mode, and confirm the adapter is available.");
    };
    const entries = state.privateState.policy.entries;
    const storageMessage = state.privateState.persistent
        ? "Encrypted persistence is active through Electron safeStorage."
        : state.privateState.storage.persistent
            ? state.privateState.loaded
                ? "Encrypted storage is available for this account; this list will persist once saved."
                : "Encrypted storage is available. Enable the adapter while signed in to load this account's private list."
            : `Denylist persistence is unavailable; entries remain session-only.${state.privateState.storage.reason ? ` ${state.privateState.storage.reason}` : ""}`;
    return <Section title="Stream Audience Guard" summary="Stop your own Go Live when a denied user is detected.">
        <div className="solcord-audience-command">
            <div>
                <p className="solcord-eyebrow">Call-bound protection</p>
                <strong>Your stream will not start or continue while a denied user is detected in the current call or viewer list.</strong>
                <p>Only native private-channel permissions are server-enforced. Stop on Watch cannot rule out brief frame exposure.</p>
            </div>
            <span className={`solcord-status solcord-status-${state.runtime.phase === "armed" ? "active" : state.runtime.phase === "attention" || state.runtime.phase === "unavailable" ? "failed" : "starting"}`}>{state.runtime.phase}</span>
        </div>
        <div className="solcord-control-grid">
            <label><SolcordSwitch label="Enable Stream Audience Guard adapter" checked={state.settings.enabled} onChange={value => SolcordRuntime.setEnabled("stream-audience-guard", value)} /> Enable validated adapter</label>
            <label><SolcordSwitch label="Prevent stream start" checked={state.settings.values.preventStart === true} disabled={!state.settings.enabled || state.runtime.armed} onChange={value => setMode("preventStart", value)} /> Prevent Start</label>
            <label><SolcordSwitch label="Stop stream when a denied user joins" checked={state.settings.values.stopOnJoin === true} disabled={!state.settings.enabled || state.runtime.armed} onChange={value => setMode("stopOnJoin", value)} /> Stop on Join</label>
            <label><SolcordSwitch label="Stop stream when a denied user watches" checked={state.settings.values.stopOnWatch === true} disabled={!state.settings.enabled || state.runtime.armed} onChange={value => setMode("stopOnWatch", value)} /> Stop on Watch</label>
        </div>
        <div className="solcord-inline-field solcord-audience-add">
            <input value={userId} inputMode="numeric" maxLength={20} placeholder="Discord user ID" aria-label="Denied Discord user ID" onChange={event => setUserId(event.currentTarget.value.replace(/\D/g, ""))} />
            <input value={label} maxLength={80} placeholder="Private label (optional)" aria-label="Private label for denied user" onChange={event => setLabel(event.currentTarget.value)} />
            <ActionButton onClick={() => add()} disabled={!state.settings.enabled || entries.length >= 100 || !userId.trim()}>Add locally</ActionButton>
        </div>
        {entries.length > 0 ? <div className="solcord-audience-list" aria-label="Denied stream audience">
            {entries.map(entry => <div key={entry.userId} className="solcord-audience-row"><div><strong>{entry.label || `Discord user •${entry.userId.slice(-4)}`}</strong><small>Account-private entry · ID ending {entry.userId.slice(-4)}</small></div><ActionButton disabled={state.runtime.armed} onClick={() => SolcordRuntime.setAudienceGuardEntries(entries.filter(item => item.userId !== entry.userId), state.accountGeneration)}>Remove</ActionButton></div>)}
        </div> : <p className="solcord-empty">No denied users are stored for this Discord account.</p>}
        <div className="solcord-actions">
            {state.runtime.armed ? <ActionButton tone="danger" onClick={() => {SolcordRuntime.disarmAudienceGuard(); setActionStatus("Audience Guard disarmed.");}}>Disarm</ActionButton> : <ActionButton tone="accent" disabled={!state.armReadiness.ready} onClick={arm}>Arm for this call</ActionButton>}
            <ActionButton tone="danger" disabled={!entries.length || state.runtime.armed} onClick={() => {if (accountIsCurrent() && window.confirm("Clear this account's private Stream Audience Guard denylist?")) return SolcordRuntime.clearAudienceGuardEntries(state.accountGeneration);}}>Clear private list</ActionButton>
        </div>
        <p className="solcord-key-hint">{storageMessage} {state.runtime.detail}</p>
        {actionStatus && <p role="status" className="solcord-import-status">{actionStatus}</p>}
    </Section>;
}

type NativeSuiteScope = "status" | "chat" | "voice" | "friends";
type BuiltInWorkspaceScope = "privacy" | "appearance" | Exclude<NativeSuiteScope, "status">;

const BUILTIN_FEATURES_BY_WORKSPACE = Object.freeze({
    privacy: ["privacy-controls"],
    appearance: ["motion-studio"],
    chat: ["composer-toolkit", "translation-desk", "channel-glance", "notification-review"],
    voice: ["call-context", "audio-console", "voice-note-studio"],
    friends: ["people-and-spaces"]
} as const);

function BuiltInFeatureSwitches({scope}: {scope: BuiltInWorkspaceScope;}) {
    const state = useStateFromStores([SolcordSettings, SolcordRuntime], () => {
        const settings = SolcordSettings.readonlySnapshot();
        return {addons: settings.curatedAddons, backgroundOn: settings.productPreferences.nativeSuite.motion.effect !== "off", adapters: SolcordRuntime.curatedAdapterStatus()};
    });
    const [message, setMessage] = useState("");
    const featureIds = BUILTIN_FEATURES_BY_WORKSPACE[scope] as readonly string[];
    const rows = SOLCORD_CLEAN_ROOM_BUILTIN_ADDONS
        .filter(name => featureIds.includes(solcordNativeSuiteFeatureForAddon(name) ?? ""))
        .map(name => ({name, presentation: SOLCORD_ADDON_PRESENTATION.get(name)!}));
    const {pending: busy, run: toggle} = useSolcordAction(async (name: string, enabled: boolean) => {
        setMessage("");
        const succeeded = await SolcordRuntime.setCuratedAddonEnabled(name, enabled);
        const label = SOLCORD_ADDON_PRESENTATION.get(name)?.label ?? name;
        const adapter = SolcordRuntime.curatedAdapterStatus()[name];
        setMessage(!succeeded
            ? `${label} stayed off because its setup, integrity, or runtime gate is not ready.`
            : !enabled
                ? `${label} disabled.`
                : adapter?.enabled
                    ? `${label} enabled${adapter.provider === "community" ? " through the reviewed community provider" : ""}.`
                    : `${label} is selected but unavailable${adapter?.reason ? `: ${adapter.reason}` : "."}`);
    }, () => setMessage("The change was not saved. Try again, or open Recovery."));
    const title = scope === "privacy" ? "Privacy built-ins" : scope === "appearance" ? "Motion built-ins" : scope === "chat" ? "Message built-ins" : scope === "voice" ? "Voice built-ins" : "People built-ins";
    return <Section title={title} summary="Owned Solcord features; each switch starts and stops only its matching behavior.">
        <div className="solcord-setting-rows solcord-builtin-switches">
            {rows.map(({name, presentation}) => {
                const enabled = name === "DiscordEffects" ? state.backgroundOn : state.addons[name]?.enabled === true;
                const adapter = state.adapters[name];
                const {maturity, label: status} = solcordBuiltInCapability(enabled, adapter);
                return <label key={name}>
                    <span><strong>{presentation.label}</strong><small>{presentation.summary}</small></span>
                    <span className="solcord-builtin-control">
                        <small className={`solcord-capability solcord-capability-${maturity}`} title={adapter?.reason}>{status}</small>
                        <SolcordSwitch label={presentation.label} checked={enabled} disabled={busy} onChange={value => toggle(name, value)} />
                    </span>
                </label>;
            })}
        </div>
        {message && <p className="solcord-import-status" role="status">{message}</p>}
    </Section>;
}

const readNativeSuitePanelState = () => ({statuses: SolcordRuntime.nativeSuiteView(), preferences: SolcordSettings.slice("productPreferences"), accountGeneration: SolcordRuntime.privateAccountGeneration()});

function NativeSuitePanel({scope}: {scope: NativeSuiteScope;}) {
    const state = useStateFromStores([SolcordRuntime, SolcordSettings], readNativeSuitePanelState, undefined, true);
    return <NativeSuiteAccountPanel key={state.accountGeneration} scope={scope} state={state} />;
}

function NativeSuiteAccountPanel({scope, state}: {scope: NativeSuiteScope; state: ReturnType<typeof readNativeSuitePanelState>;}) {
    const controller = SolcordRuntime.nativeSuiteController();
    const nativePreferences = state.preferences.nativeSuite;
    const initialObjectId = scope === "friends" ? SolcordRuntime.currentPeopleObjectId() ?? "" : controller?.currentChannelId() ?? "";
    const [actionStatus, setActionStatus] = useState("");
    const [audioUserId, setAudioUserId] = useState("");
    const [audioPercent, setAudioPercent] = useState(100);
    const [channelId, setChannelId] = useState(initialObjectId);
    const [peopleTarget, setPeopleTarget] = useState(() => scope === "friends" ? SolcordRuntime.resolvePeopleObject(initialObjectId) : undefined);
    const [serverAlias, setServerAlias] = useState("");
    const [glance, setGlance] = useState<SolcordChannelGlancePresentation>(() => presentSolcordChannelGlance([]));
    const [translationText, setTranslationText] = useState("");
    const [translationResult, setTranslationResult] = useState("");
    const [translationCredential, setTranslationCredential] = useState("");
    const [translationEdits, setTranslationEdits] = useState({endpoint: false, sourceLanguage: false, targetLanguage: false});
    const translationDirty = Object.values(translationEdits).some(Boolean);
    const translationContext = JSON.stringify([state.accountGeneration, nativePreferences.translation.provider, nativePreferences.translation.endpoint]);
    const accountIsCurrent = () => SolcordRuntime.privateAccountIsCurrent(state.accountGeneration);
    const credentialResults = useSolcordResultScope(translationContext, accountIsCurrent);
    const translationResults = useSolcordResultScope(JSON.stringify([translationContext, nativePreferences.translation.sourceLanguage, nativePreferences.translation.targetLanguage, translationText]), accountIsCurrent);
    const [localTranslationState, setLocalTranslationState] = useState(() => controller?.localTranslationState());
    const [localPairAvailability, setLocalPairAvailability] = useState<"idle" | "checking" | "auto" | SolcordLocalTranslationAvailability | "failed">("idle");
    const translationAbort = useRef<AbortController | undefined>(undefined);
    const translationAvailabilityAbort = useRef<AbortController | undefined>(undefined);
    const [voicePhase, setVoicePhase] = useState<SolcordVoiceNotePhase>(() => controller?.voiceNotePhase() ?? "idle");
    const [voicePreview, setVoicePreview] = useState<{recordingId: string; durationMs: number; sizeBytes: number; waveform: readonly number[]; url: string;} | undefined>();
    const [composerDraft, setComposerDraft] = useState("");
    const [composerProof, setComposerProof] = useState<{reviewedDraft: string; characterCount: number; partCount: number; warnings: string[];} | undefined>();
    const [timeValue, setTimeValue] = useState("");
    const [timeStyle, setTimeStyle] = useState<"t" | "T" | "d" | "D" | "f" | "F" | "R">("F");
    const [timeMarkup, setTimeMarkup] = useState("");
    const [permissionInput, setPermissionInput] = useState("VIEW_CHANNEL, CONNECT, STREAM");
    const [permissionResults, setPermissionResults] = useState<Array<{permission: string; explanation: string;}>>([]);
    const [focusInput, setFocusInput] = useState(state.preferences.nativeSuite.focusChannelIds.join(", "));
    const [identitySubject, setIdentitySubject] = useState("");
    const [identityText, setIdentityText] = useState("");
    const [identityTags, setIdentityTags] = useState("");
    const [identityNotes, setIdentityNotes] = useState<Array<{subjectId: string; text: string; tags: string[]; updatedAt: number;}>>([]);
    const [identityPersistent, setIdentityPersistent] = useState(false);
    const [friendQuery, setFriendQuery] = useState("");
    const [friendSort, setFriendSort] = useState<"name" | "status">("name");
    const [friendCategory, setFriendCategory] = useState<"visible" | "favorites" | "hidden" | "blocked" | "incoming" | "outgoing" | "ignored">("visible");
    const [friendRows, setFriendRows] = useState<Array<{id: string; label: string; status: "online" | "idle" | "dnd" | "offline" | "unknown"; relationship: "friend" | "blocked" | "incoming" | "outgoing" | "ignored"; favorite: boolean; hidden: boolean; relationshipSince?: number; mutualGuildCount?: number;}>>([]);
    const [peopleSnapshot, setPeopleSnapshot] = useState(() => controller?.peopleSnapshot());
    useEffect(() => {
        if (scope !== "voice" || !controller) return;
        setVoicePhase(controller.voiceNotePhase());
        const unsubscribe = controller.subscribeVoiceNotePhase(setVoicePhase);
        return () => {
            unsubscribe();
            controller.cancelVoiceNote();
        };
    }, [controller, scope]);
    useEffect(() => setPeopleSnapshot(controller?.peopleSnapshot()), [controller, state.accountGeneration]);
    useEffect(() => {
        setTranslationCredential("");
        setTranslationResult("");
        translationAbort.current?.abort();
    }, [translationContext]);
    useEffect(() => {
        if (!controller) return;
        const unsubscribe = controller.subscribeLocalTranslation(setLocalTranslationState);
        return () => {
            translationAbort.current?.abort();
            translationAvailabilityAbort.current?.abort();
            unsubscribe();
        };
    }, [controller]);
    useEffect(() => {
        translationAvailabilityAbort.current?.abort();
        if (scope !== "chat" || !controller || nativePreferences.translation.provider !== "local") {
            setLocalPairAvailability("idle");
            return;
        }
        const source = nativePreferences.translation.sourceLanguage.trim();
        const target = nativePreferences.translation.targetLanguage.trim();
        if (source.toLocaleLowerCase() === "auto") {
            setLocalPairAvailability("auto");
            return;
        }
        const abort = new AbortController();
        translationAvailabilityAbort.current = abort;
        setLocalPairAvailability("checking");
        void controller.localTranslationAvailability(source, target, abort.signal).then(availability => {
            if (!abort.signal.aborted) setLocalPairAvailability(availability);
        }).catch(error => {
            if (!abort.signal.aborted && (!(error instanceof Error) || error.name !== "AbortError")) setLocalPairAvailability("failed");
        });
        return () => abort.abort();
    }, [controller, nativePreferences.translation.provider, nativePreferences.translation.sourceLanguage, nativePreferences.translation.targetLanguage, scope]);
    const stateLabel = {"off": "Off", "needs-setup": "Optional setup", "ready": "Ready", "degraded": "Degraded", "unsupported": "Unavailable"} as const;
    const statusById = new Map(state.statuses.map(item => [item.id, item]));
    const visibleStatuses = state.statuses.filter(item => item.maturity !== "off");
    const unavailableStatuses = state.statuses.filter(item => item.maturity === "unsupported");
    const statusFor = (...ids: Array<(typeof state.statuses)[number]["id"]>) => state.statuses.filter(item => ids.includes(item.id));
    const available = (id: (typeof state.statuses)[number]["id"]) => ["ready", "needs-setup", "degraded"].includes(statusById.get(id)?.maturity ?? "off");
    const voiceDeliveryMode = controller?.voiceNoteDeliveryMode() ?? "unavailable";
    const voiceContext = controller?.currentVoiceContext();
    const audioReadiness = controller?.localVolumeReviewState(audioUserId.trim()) ?? {ready: false, detail: "Audio Console is unavailable on this Discord build."};
    const voiceStarting = voicePhase === "requesting-permission";
    const voiceRecording = voicePhase === "recording";
    const voicePhaseLabel: Record<SolcordVoiceNotePhase, string> = {"idle": "idle", "requesting-permission": "waiting for microphone permission", "recording": "recording locally", "processing": "building local preview", "preview-ready": "local preview ready"};
    const externalTranslation = nativePreferences.translation.provider === "deepl" || nativePreferences.translation.provider === "libretranslate";
    const translationEndpoint = nativePreferences.translation.provider === "deepl" ? "https://api-free.deepl.com/v2/translate" : nativePreferences.translation.endpoint;
    const localPairMessage = localTranslationState?.phase === "downloading"
        ? `Downloading the local language pack · ${Math.round((localTranslationState.progress ?? 0) * 100)}%`
        : localTranslationState?.phase === "unsupported"
            ? "On-device translation is unsupported in this Discord/Electron build. No cloud fallback will run automatically."
            : localTranslationState?.phase === "degraded" || localPairAvailability === "failed"
                ? "The local engine failed closed. No text left Discord."
                : localPairAvailability === "checking"
                    ? "Checking this language pair on device…"
                    : localPairAvailability === "unavailable"
                        ? "This language pair is unavailable in the installed Discord/Electron build."
                        : localPairAvailability === "downloadable" || localPairAvailability === "downloading"
                            ? "Available on device after Chromium downloads this language pack."
                            : localPairAvailability === "available"
                                ? "Available on device. Text stays on this device."
                                : "Automatic detection and the exact language pair are checked locally when you translate.";
    const localPairBlocked = localPairAvailability === "checking" || localPairAvailability === "unavailable" || localPairAvailability === "failed" || localTranslationState?.phase === "unsupported";
    const updateNativePreferences = useSolcordWrite((next: typeof nativePreferences) => SolcordRuntime.setProductPreferences({...SolcordSettings.slice("productPreferences"), nativeSuite: next}));
    const updateTranslationPreferences = useSolcordWrite((patch: Partial<typeof nativePreferences.translation>) => {
        const current = SolcordSettings.slice("productPreferences");
        return SolcordRuntime.setProductPreferences({...current, nativeSuite: {...current.nativeSuite, translation: {...current.nativeSuite.translation, ...patch}}});
    });
    const changeTranslationProvider = async (provider: typeof nativePreferences.translation.provider) => {
        credentialResults.invalidate();
        translationResults.invalidate();
        translationAbort.current?.abort();
        setTranslationCredential("");
        setTranslationResult("");
        if (await updateTranslationPreferences({provider})) setTranslationEdits({endpoint: false, sourceLanguage: false, targetLanguage: false});
    };
    const translationDraftChanged = (field: keyof typeof translationEdits, dirty: boolean) => {
        setTranslationEdits(current => ({...current, [field]: dirty}));
        if (!dirty) return;
        translationResults.invalidate();
        translationAbort.current?.abort();
        setTranslationResult("");
        if (field === "endpoint") {credentialResults.invalidate(); setTranslationCredential("");}
    };
    const translationLanguage = (value: string, allowAuto = false) => {
        if (!isSolcordTranslationLanguage(value, allowAuto)) throw new Error(allowAuto ? "Use auto or a language code such as EN or pt-BR." : "Use a language code such as EN or pt-BR.");
        return value;
    };
    const translationAddress = (value: string) => {
        const endpoint = normalizeSolcordTranslationEndpoint(value);
        if (value && !endpoint) throw new Error("Use a complete HTTPS address without credentials, a query, or a fragment.");
        return endpoint;
    };
    const credentialAction = async (action: "load" | "save" | "clear") => {
        if (translationDirty || !translationEndpoint || !externalTranslation) return;
        const isCurrent = credentialResults.begin();
        if (!isCurrent()) return;
        const provider = nativePreferences.translation.provider as "deepl" | "libretranslate";
        try {
            if (action === "load") {
                const result = await SolcordRuntime.readTranslationCredential(provider, translationEndpoint, state.accountGeneration);
                if (!isCurrent()) return;
                setTranslationCredential(result.credential);
                setActionStatus(result.complete ? (result.credential ? "Credential loaded from account-bound private storage." : "No credential is stored for this provider and endpoint.") : "Credential storage could not be read completely.");
            }
            else if (action === "save") {
                const result = await SolcordRuntime.writeTranslationCredential(provider, translationEndpoint, translationCredential, state.accountGeneration);
                if (isCurrent()) setActionStatus(result.complete ? (result.persistent ? "Credential encrypted through Electron safeStorage." : "Encryption is unavailable; the credential remains memory-only for this session.") : "Credential could not be persisted and was not added to normal settings.");
            }
            else {
                const result = await SolcordRuntime.clearTranslationCredential(provider, translationEndpoint, state.accountGeneration);
                if (!isCurrent()) return;
                if (result.complete) setTranslationCredential("");
                setActionStatus(result.complete ? "Stored credential cleared for this provider and endpoint." : "Credential cleanup needs attention.");
            }
        }
        catch {if (isCurrent()) setActionStatus("Credential storage could not finish. No credential was added to normal settings.");}
    };
    const requireController = () => {
        if (!controller) throw new Error("Solcord's built-in controls are unavailable on this Discord build.");
        return controller;
    };
    const volume = () => {
        try {
            const activeController = requireController();
            const preview = activeController.previewLocalVolume(audioUserId.trim(), 100, audioPercent);
            if (!window.confirm(`Set local playback for user •${preview.userId.slice(-4)} to ${preview.targetPercent}%? This changes only what you hear.`)) return;
            activeController.applyReviewedLocalVolume();
            setActionStatus("Reviewed local playback volume applied.");
        }
        catch (error) {setActionStatus(error instanceof Error ? error.message : "Audio Console stayed unavailable.");}
    };
    const reviewChannel = () => {
        try {
            const presentation = presentSolcordChannelGlance(requireController().previewLoadedChannel(channelId.trim()));
            setGlance(presentation);
            setActionStatus(presentation.totalCount
                ? `Showing ${presentation.rows.length} of ${presentation.totalCount} already-loaded message${presentation.totalCount === 1 ? "" : "s"}. Nothing was fetched, marked read, or persisted.`
                : "No already-loaded messages are available for that channel. Nothing was fetched, marked read, or persisted.");
        }
        catch (error) {setGlance(presentSolcordChannelGlance([])); setActionStatus(error instanceof Error ? error.message : "Channel Glance stayed unavailable.");}
    };
    const translate = async () => {
        if (translationDirty) return;
        const isCurrent = translationResults.begin();
        if (!isCurrent()) return;
        try {
            const provider = nativePreferences.translation.provider;
            const activeController = requireController();
            if (provider === "local") {
                translationAbort.current?.abort();
                const abort = new AbortController();
                translationAbort.current = abort;
                const result = await activeController.translateLocally(nativePreferences.translation.sourceLanguage, nativePreferences.translation.targetLanguage, translationText, abort.signal);
                if (!isCurrent()) return;
                setTranslationResult(result);
                setActionStatus("Translated on this device. No message text was sent to a Solcord or third-party server.");
                return;
            }
            if (provider === "off") throw new Error("Translation Desk is ready, but every provider is off. Choose On-device, DeepL, or LibreTranslate when you want to translate.");
            const preview = activeController.previewTranslation(provider, nativePreferences.translation.endpoint || undefined, nativePreferences.translation.sourceLanguage, nativePreferences.translation.targetLanguage, translationText);
            if (!window.confirm(`${preview.disclosure}\n\nContinue with this reviewed text?`)) return;
            if (!isCurrent()) return;
            const result = await activeController.executeReviewedTranslation(preview.id, translationCredential);
            if (!isCurrent()) return;
            setTranslationResult(result);
            setActionStatus("Translation returned to this local panel. It was not inserted or sent to Discord.");
        }
        catch (error) {if (isCurrent()) setActionStatus(error instanceof Error ? error.message : "Translation Desk failed closed.");}
    };
    const startVoice = async () => {
        try {
            if (!controller) throw new Error("Voice Note Studio is unavailable on this Discord build.");
            setVoicePhase("requesting-permission");
            await controller.beginVoiceNoteFromUserGesture();
            setVoicePreview(undefined);
            setActionStatus("Recording locally. Nothing is uploading.");
        }
        catch (error) {setVoicePhase(controller?.voiceNotePhase() ?? "idle"); setActionStatus(error instanceof Error ? error.message : "Voice Note Studio stayed unavailable.");}
        finally {setVoicePhase(controller?.voiceNotePhase() ?? "idle");}
    };
    const stopVoice = async () => {
        try {
            if (!controller || !voiceRecording) throw new Error("No local recording is active.");
            const preview = await controller.stopVoiceNoteForPreview();
            setVoicePreview(preview);
            setActionStatus(voiceDeliveryMode === "discord-composer"
                ? "Recording stopped. Review it before opening Discord's ordinary upload composer."
                : "Recording stopped. Review it before saving the local file to attach manually.");
        }
        catch (error) {setVoicePhase(controller?.voiceNotePhase() ?? "idle"); setActionStatus(error instanceof Error ? error.message : "No local recording could be previewed.");}
    };
    const prepareVoiceUpload = () => {
        if (!voicePreview || !window.confirm("Open Discord's normal upload composer with this reviewed voice note? This prepares the file but does not press Send.")) return;
        try {requireController().prepareReviewedVoiceNoteUpload(channelId.trim()); setVoicePreview(undefined); setActionStatus("The reviewed file was handed to Discord's normal upload composer. You still control Send.");}
        catch (error) {setActionStatus(error instanceof Error ? error.message : "The native upload composer stayed unavailable.");}
    };
    const saveVoiceFile = () => {
        if (!voicePreview || !window.confirm("Save this reviewed voice note as a local file? Solcord will not attach or send it; you choose where and whether to upload it.")) return;
        try {requireController().saveReviewedVoiceNoteFile(); setVoicePreview(undefined); setActionStatus("Voice note saved locally. Attach it through Discord yourself when ready.");}
        catch (error) {setActionStatus(error instanceof Error ? error.message : "The local voice-note file could not be saved.");}
    };
    const previewNotifications = (notificationScope: "guild" | "mentions" | "all") => {
        try {
            const activeController = requireController();
            const preview = activeController.previewNotifications(notificationScope);
            if (preview.count === 0) {
                setActionStatus("Nothing to review in the already-loaded notification state. No confirmation opened and no read state changed.");
                return;
            }
            if (!window.confirm(`Mark ${preview.count} reviewed ${notificationScope} notification item(s) as read? This changes account read state and cannot be undone by Solcord.`)) return;
            activeController.applyReviewedNotifications(preview.id);
            setActionStatus(`${preview.count} reviewed notification item(s) were marked read.`);
        }
        catch (error) {setActionStatus(error instanceof Error ? error.message : "Notification Review stayed unavailable.");}
    };
    const addLocalSpaceRule = (kind: "pin" | "hide" | "alias") => {
        try {
            const activeController = requireController();
            const target = SolcordRuntime.resolvePeopleObject(channelId.trim());
            if (kind === "pin" && !target.canPinDm) throw new Error(target.label);
            if ((kind === "hide" || kind === "alias") && !target.canManageServer) throw new Error(target.label);
            const before = activeController.peopleSnapshot();
            if (kind === "pin") {
                if (before?.pinnedDmIds.includes(target.id)) activeController.unpinDm(target.id);
                else activeController.pinDm(target.id);
            }
            else if (kind === "hide") {
                if (before?.hiddenGuildIds.includes(target.id)) activeController.showGuild(target.id);
                else activeController.hideGuild(target.id);
            }
            else {activeController.aliasGuild(target.id, serverAlias.trim());}
            const next = activeController.peopleSnapshot();
            const pinChanged = kind !== "pin" || next?.pinnedDmIds.includes(target.id) !== before?.pinnedDmIds.includes(target.id);
            const hideChanged = kind !== "hide" || next?.hiddenGuildIds.includes(target.id) !== before?.hiddenGuildIds.includes(target.id);
            const aliasChanged = kind !== "alias" || next?.guildAliases[target.id] === serverAlias.trim();
            if (!next || !pinChanged || !hideChanged || !aliasChanged) throw new Error("The local People and Spaces transaction did not complete; no success was reported.");
            setPeopleSnapshot(next);
            setPeopleTarget(target);
            setActionStatus(kind === "pin"
                ? next.pinnedDmIds.includes(target.id) ? "DM pinned locally for this account." : "DM unpinned locally for this account."
                : kind === "hide"
                    ? next.hiddenGuildIds.includes(target.id) ? "Server hidden locally for this account." : "Server shown locally for this account."
                    : "Local server alias saved for this account. Discord server state was not edited.");
        }
        catch (error) {setActionStatus(error instanceof Error ? error.message : "The local preference was not changed.");}
    };
    const removeLocalSpaceRule = (kind: "pin" | "hide" | "alias", id: string) => {
        try {
            const activeController = requireController();
            if (kind === "pin") activeController.unpinDm(id);
            else if (kind === "hide") activeController.showGuild(id);
            else activeController.clearGuildAlias(id);
            const next = activeController.peopleSnapshot();
            if (!next
                || (kind === "pin" && next.pinnedDmIds.includes(id))
                || (kind === "hide" && next.hiddenGuildIds.includes(id))
                || (kind === "alias" && Object.hasOwn(next.guildAliases, id))) throw new Error("The local removal did not complete; no success was reported.");
            setPeopleSnapshot(next);
            setActionStatus("The account-local People and Spaces rule was removed. Discord state was not changed.");
        }
        catch (error) {setActionStatus(error instanceof Error ? error.message : "The local preference was not removed.");}
    };
    const refreshFriendList = () => {
        try {
            const rows = requireController().loadedFriendList(friendQuery, friendSort, friendCategory);
            setFriendRows(rows);
            setActionStatus(`${rows.length} already-loaded relationship row${rows.length === 1 ? "" : "s"} matched. Nothing was fetched or changed.`);
        }
        catch (error) {setFriendRows([]); setActionStatus(error instanceof Error ? error.message : "Better Friend List stayed unavailable.");}
    };
    const updateFriendGroup = (id: string, action: "favorite" | "unfavorite" | "hide" | "show") => {
        try {
            const activeController = requireController();
            if (action === "favorite") activeController.favoriteFriend(id);
            else if (action === "unfavorite") activeController.unfavoriteFriend(id);
            else if (action === "hide") activeController.hideFriend(id);
            else activeController.showFriend(id);
            refreshFriendList();
            setActionStatus("The account-local friend group was updated. Discord's relationship state was not changed.");
        }
        catch (error) {setActionStatus(error instanceof Error ? error.message : "The local friend group was not changed.");}
    };
    const reviewComposer = () => {
        try {setComposerProof({reviewedDraft: composerDraft, ...requireController().composerProof(composerDraft)}); setActionStatus("Composer Proof reviewed this local draft. Nothing was inserted or sent.");}
        catch (error) {setComposerProof(undefined); setActionStatus(error instanceof Error ? error.message : "Composer Proof stayed unavailable.");}
    };
    const composeTime = () => {
        try {
            const parsed = new Date(timeValue).valueOf();
            const markup = requireController().timeMarkup(parsed, timeStyle);
            setTimeMarkup(markup);
            setActionStatus("Time Composer generated local Discord timestamp markup. It was not inserted or sent.");
        }
        catch (error) {setTimeMarkup(""); setActionStatus(error instanceof Error ? error.message : "Time Composer could not parse that time.");}
    };
    const reviewPermissions = () => {
        try {
            const names = permissionInput.split(/[\s,]+/).map(value => value.trim()).filter(Boolean);
            setPermissionResults([...requireController().explainCachedPermissions(names)]);
            setActionStatus("Permission Lens explained the supplied cached permission names. It did not fetch or edit channel permissions.");
        }
        catch (error) {setPermissionResults([]); setActionStatus(error instanceof Error ? error.message : "Permission Lens stayed unavailable.");}
    };
    const applyFocus = () => {
        try {
            requireController().setFocusChannels(focusInput.split(/[\s,]+/).map(value => value.trim()).filter(Boolean));
            setActionStatus("Focus Channels dimmed non-selected loaded channel rows locally. Hovered and selected rows remain readable.");
        }
        catch (error) {setActionStatus(error instanceof Error ? error.message : "Focus Channels stayed unavailable.");}
    };
    const loadIdentityNotes = async () => {
        const [status, result] = await Promise.all([SolcordRuntime.localIdentityNotesStatus(), SolcordRuntime.readLocalIdentityNotes()]);
        setIdentityNotes(result.notes);
        setIdentityPersistent(status.persistent && result.persistent && result.complete);
        setActionStatus(result.complete ? `${result.notes.length} account-private note(s) loaded locally.` : "Local Identity Notes stayed unavailable; no private content was exposed.");
    };
    const saveIdentityNote = async () => {
        try {
            const tags = identityTags.split(",").map(tag => tag.trim()).filter(Boolean);
            const activeController = requireController();
            const reviewed = activeController.reviewIdentityNote(identitySubject.trim(), identityText, tags);
            if (!window.confirm(`Store the reviewed local note for user •${reviewed.subjectId.slice(-4)}? The note never changes that Discord profile and never enters normal settings or exports.`)) return;
            const intent = activeController.confirmIdentityNote(reviewed.subjectId);
            const result = await SolcordRuntime.writeLocalIdentityNote(intent.payload);
            if (!result.complete) throw new Error("The private note write did not complete.");
            setIdentityText("");
            setIdentityTags("");
            await loadIdentityNotes();
            setActionStatus(result.persistent ? "Reviewed note encrypted through Electron safeStorage." : "Encryption is unavailable; the reviewed note remains session-only.");
        }
        catch (error) {setActionStatus(error instanceof Error ? error.message : "Local Identity Notes stayed unavailable.");}
    };
    const removeIdentityNote = async (subjectId: string) => {
        if (!window.confirm(`Remove the local note for user •${subjectId.slice(-4)}? This does not change the Discord account.`)) return;
        const result = await SolcordRuntime.removeLocalIdentityNote(subjectId);
        if (result.complete) await loadIdentityNotes();
        else setActionStatus("The private note was preserved because removal did not complete cleanly.");
    };
    const scopeStatus = scope === "chat"
        ? statusFor("composer-toolkit", "translation-desk", "channel-glance", "notification-review")
        : scope === "voice"
            ? statusFor("call-context", "audio-console", "voice-note-studio", "voice-health")
            : scope === "friends"
                ? statusFor("people-and-spaces", "permission-lens", "local-identity-notes")
                : visibleStatuses;
    const usableScopeStatus = scopeStatus.filter(item => item.maturity !== "unsupported" && item.maturity !== "off");
    const unsupportedScopeStatus = scopeStatus.filter(item => item.maturity === "unsupported");
    const attentionScopeStatus = scopeStatus.filter(item => item.maturity === "degraded" || item.maturity === "needs-setup" || item.maturity === "unsupported");
    const sectionTitle = scope === "status" ? "Built-in features" : scope === "chat" ? "Message tools" : scope === "voice" ? "Voice tools" : "People tools";
    const sectionSummary = scope === "status" ? "Built-ins replacing the old plugin cards." : "Open a tool to adjust its options.";
    return <Section title={sectionTitle} summary={sectionSummary}>
        {scope === "status" && <>
            <div className="solcord-native-summary" aria-label="Built-in feature summary"><strong>{visibleStatuses.filter(item => item.maturity === "ready").length} ready</strong><span>{visibleStatuses.filter(item => item.maturity === "needs-setup").length} optional setup</span><span>{visibleStatuses.filter(item => item.maturity === "degraded").length} degraded</span><span>{unavailableStatuses.length} unsupported on this build</span></div>
            <details className="solcord-state-help"><summary>What these states mean</summary><p>Ready passed startup validation. Optional setup means the tool is available but an external provider or preference is still off. Degraded means part of a running tool drifted or could not clean up completely. Off performs no Discord lookup or patch work. Unavailable means this Discord build exposed no verified adapter.</p></details>
            <div className="solcord-native-ledger" role="list" aria-label="Solcord built-in features">
                {scopeStatus.filter(item => item.maturity !== "unsupported").map(item => <div key={item.id} role="listitem" className="solcord-native-row" aria-label={`${item.title}: ${stateLabel[item.maturity]}. ${item.detail}`} title={item.detail}><strong className="solcord-native-title">{item.title}</strong>{item.enabledProviders.length > 0 && <small className="solcord-native-replaces">Replaces {item.enabledProviders.join(", ")}</small>}<span className={`solcord-capability solcord-capability-${item.maturity}`}>{stateLabel[item.maturity]}</span></div>)}
                {!scopeStatus.length && <p className="solcord-empty">No built-in status is available yet.</p>}
            </div>
            {unavailableStatuses.length > 0 && <details className="solcord-native-unavailable-list"><summary>{unavailableStatuses.length} unavailable on this Discord build</summary>{unavailableStatuses.map(item => <div key={item.id}><strong>{item.title}</strong><span>{item.detail}</span></div>)}</details>}
        </>}
        {scope !== "status" && <>
            {scope === "voice" && <div className="solcord-setting-list"><label className="solcord-setting-row"><span><strong>Voice Health</strong><small>Samples cached connection quality every five seconds while enabled. Never records audio.</small></span><SolcordSwitch label="Enable Voice Health" checked={nativePreferences.voiceHealthEnabled} onChange={value => updateNativePreferences({...nativePreferences, voiceHealthEnabled: value})} /></label><details className="solcord-secondary-tools"><summary>Voice indicator surfaces</summary><div className="solcord-control-grid">{([["memberList", "Member list"], ["dmList", "DM list"], ["peopleList", "Friends list"], ["highlightCurrentChannel", "Highlight current call"], ["statusIcons", "Speaking/status detail"], ["currentUser", "Show my indicator"]] as const).map(([key, label]) => <label key={key}><SolcordSwitch label={label} checked={nativePreferences.voiceActivity[key]} onChange={value => updateNativePreferences({...nativePreferences, voiceActivity: {...nativePreferences.voiceActivity, [key]: value}})} /> {label}</label>)}</div>{voiceContext && <div className="solcord-actions">{peopleSnapshot?.ignoredVoiceChannelIds.includes(voiceContext.channelId) ? <ActionButton onClick={() => {controller?.includeVoiceChannel(voiceContext.channelId); setActionStatus("Voice indicators restored for this call.");}}>Show this call</ActionButton> : <ActionButton onClick={() => {controller?.ignoreVoiceChannel(voiceContext.channelId); setActionStatus("Voice indicators hidden for this call on this account.");}}>Hide this call</ActionButton>}{voiceContext.guildId && (peopleSnapshot?.ignoredVoiceGuildIds.includes(voiceContext.guildId) ? <ActionButton onClick={() => {controller?.includeVoiceGuild(voiceContext.guildId!); setActionStatus("Voice indicators restored for this server.");}}>Show this server</ActionButton> : <ActionButton onClick={() => {controller?.ignoreVoiceGuild(voiceContext.guildId!); setActionStatus("Voice indicators hidden for this server on this account.");}}>Hide this server</ActionButton>)}</div>}</details></div>}
            {attentionScopeStatus.length > 0 && <div className="solcord-native-context-status" role="list" aria-label={`${sectionTitle} needing attention`}>{attentionScopeStatus.map(item => <div role="listitem" key={item.id}><span>{item.title}</span><strong className={`solcord-capability solcord-capability-${item.maturity}`}>{stateLabel[item.maturity]}</strong><small>{item.detail}</small></div>)}</div>}
            {scopeStatus.every(item => item.maturity === "off") && <p className="solcord-empty">No built-in tools are on. Use the switches above to enable only what you want.</p>}
            {!usableScopeStatus.length && unsupportedScopeStatus.length > 0 && <p className="solcord-empty">These tools are unavailable on this Discord build, so no inactive controls are shown.</p>}
            <div className={`solcord-native-tools solcord-native-tools-${scope}`}>
            {scope === "chat" && available("composer-toolkit") && <details><summary>Composer Toolkit</summary><div className="solcord-composer-lab">
                <div className="solcord-catalog-tools">
                    <label>Reply modifier<select value={nativePreferences.composer.doubleClickReplyModifier} onChange={event => updateNativePreferences({...nativePreferences, composer: {...nativePreferences.composer, doubleClickReplyModifier: event.currentTarget.value as typeof nativePreferences.composer.doubleClickReplyModifier}})}><option value="none">None</option><option value="ctrl">Ctrl</option><option value="shift">Shift</option><option value="alt">Alt</option></select></label>
                    <label>Split boundary<select value={nativePreferences.composer.splitBoundary} onChange={event => updateNativePreferences({...nativePreferences, composer: {...nativePreferences.composer, splitBoundary: event.currentTarget.value as typeof nativePreferences.composer.splitBoundary}})}><option value="balanced">Newlines, then words</option><option value="newlines">Prefer newlines</option></select></label>
                    <label>Part limit<input type="number" min="1000" max="4000" value={nativePreferences.composer.splitLimit} onChange={event => updateNativePreferences({...nativePreferences, composer: {...nativePreferences.composer, splitLimit: Number(event.currentTarget.value)}})} /></label>
                    <label>Maximum parts<input type="number" min="0" max="20" value={nativePreferences.composer.maxSplitParts} onChange={event => updateNativePreferences({...nativePreferences, composer: {...nativePreferences.composer, maxSplitParts: Number(event.currentTarget.value)}})} /></label>
                    <label>Text-file threshold<input type="number" min="0" max="64000" value={nativePreferences.composer.attachmentThreshold} onChange={event => updateNativePreferences({...nativePreferences, composer: {...nativePreferences.composer, attachmentThreshold: Number(event.currentTarget.value)}})} /></label>
                    <label>Counter warning %<input type="number" min="50" max="100" value={nativePreferences.composer.counterWarningPercent} onChange={event => updateNativePreferences({...nativePreferences, composer: {...nativePreferences.composer, counterWarningPercent: Number(event.currentTarget.value)}})} /></label>
                    <label>Timestamp tooltip<select value={nativePreferences.composer.timestampFormat} onChange={event => updateNativePreferences({...nativePreferences, composer: {...nativePreferences.composer, timestampFormat: event.currentTarget.value as typeof nativePreferences.composer.timestampFormat}})}><option value="full">Full</option><option value="compact">Compact</option><option value="iso">ISO</option></select></label>
                    <label className="solcord-setting-row"><span><strong>Preserve blank lines</strong></span><SolcordSwitch label="Preserve blank lines" checked={nativePreferences.composer.preserveBlankLines} onChange={value => updateNativePreferences({...nativePreferences, composer: {...nativePreferences.composer, preserveBlankLines: value}})} /></label>
                </div>
                <details className="solcord-secondary-tools"><summary>Timestamp surfaces</summary><div className="solcord-control-grid">
                    {([["chat", "Chat"], ["embeds", "Embeds"], ["markup", "Timestamp markup"], ["auditLogs", "Audit logs"], ["chatTooltips", "Chat tooltips"], ["editedTooltips", "Edited tooltips"], ["markupTooltips", "Markup tooltips"]] as const).map(([key, label]) => <label key={key}><SolcordSwitch label={label} checked={nativePreferences.timestamps[key]} onChange={value => updateNativePreferences({...nativePreferences, timestamps: {...nativePreferences.timestamps, [key]: value}})} /> {label}</label>)}
                </div></details>
                <textarea value={composerDraft} maxLength={64000} placeholder="Review a draft locally before sending" aria-label="Draft to review locally" onChange={event => {setComposerDraft(event.currentTarget.value); setComposerProof(undefined); setActionStatus("Draft changed. Review again for updated counts and warnings.");}} /><div className="solcord-actions"><ActionButton onClick={reviewComposer}>Review draft</ActionButton></div>{composerProof?.reviewedDraft === composerDraft && <div className="solcord-native-preview" role="status" aria-live="polite"><p><strong>{composerProof.characterCount.toLocaleString()} characters</strong><span>{composerProof.partCount} guarded part(s)</span></p>{composerProof.warnings.length ? composerProof.warnings.map(warning => <p key={warning}>{warning}</p>) : <p>No broad-mention, length, or unclosed-code-block warnings found.</p>}</div>}
                <div className="solcord-catalog-tools"><label>Local date and time<input type="datetime-local" value={timeValue} onChange={event => setTimeValue(event.currentTarget.value)} /></label><label>Discord display style<select value={timeStyle} onChange={event => setTimeStyle(event.currentTarget.value as typeof timeStyle)}><option value="F">Full date and time</option><option value="f">Short date and time</option><option value="R">Relative</option><option value="D">Long date</option><option value="d">Short date</option><option value="T">Time with seconds</option><option value="t">Short time</option></select></label></div><div className="solcord-inline-field"><ActionButton disabled={!timeValue} onClick={composeTime}>Generate timestamp</ActionButton>{timeMarkup && <><output>{timeMarkup}</output><ActionButton onClick={() => navigator.clipboard?.writeText(timeMarkup).then(() => setActionStatus("Reviewed timestamp copied. Solcord did not insert or send it."))}>Copy</ActionButton></>}</div>
            </div></details>}
            {scope === "voice" && available("audio-console") && <details><summary>Audio Console</summary><div className="solcord-inline-field"><input value={audioUserId} inputMode="numeric" maxLength={20} placeholder="Discord user ID" aria-label="Audio Console user ID" onChange={event => setAudioUserId(event.currentTarget.value.replace(/\D/g, ""))} /><input type="number" min="0" max="200" value={audioPercent} aria-label="Local volume percent" onChange={event => setAudioPercent(Math.max(0, Math.min(200, Number(event.currentTarget.value))))} /><ActionButton disabled={!audioReadiness.ready} onClick={volume}>Review and apply</ActionButton></div><p className="solcord-key-hint">{audioReadiness.detail}</p></details>}
            {scope === "chat" && available("channel-glance") && <details><summary>Channel Glance</summary><div className="solcord-inline-field"><input value={channelId} inputMode="numeric" placeholder="Loaded channel ID" aria-label="Loaded channel ID" onChange={event => {setChannelId(event.currentTarget.value.replace(/\D/g, "")); setGlance(presentSolcordChannelGlance([])); setActionStatus("Channel changed. Run Glance to review the new already-loaded state.");}} /><ActionButton disabled={!channelId} onClick={reviewChannel}>Glance</ActionButton></div><p className="solcord-key-hint">Reads only the already-loaded message store. It never fetches history, marks messages read, or persists content.</p>{glance.rows.length > 0 && <div className="solcord-native-preview" role="list" aria-label={`Channel Glance: ${glance.rows.length} of ${glance.totalCount} already-loaded messages`}>{glance.rows.map(message => <article key={message.key} role="listitem" className="solcord-glance-row"><strong>{message.author}</strong><span>{message.excerpt}</span><time dateTime={new Date(message.timestamp).toISOString()}>{timestamp(message.timestamp)}</time></article>)}{glance.hiddenCount > 0 && <p className="solcord-key-hint">{glance.hiddenCount} additional loaded message{glance.hiddenCount === 1 ? "" : "s"} hidden by the preview limit.</p>}</div>}</details>}
            {scope === "friends" && available("people-and-spaces") && <details><summary>People and Spaces</summary>
                <details className="solcord-secondary-tools"><summary>Display options</summary><div className="solcord-control-grid">
                    {([["showRelationshipDates", "Relationship dates"], ["showMutualGuildCounts", "Mutual-server counts"], ["pinIcon", "Pinned label"], ["pinUnreadAmount", "Pinned unread count"], ["pinChannelAmount", "Pinned total"], ["sortPinnedByRecent", "Recent-first pins"], ["serverHiderStreamOnly", "Hide servers only in Streamer Mode"]] as const).map(([key, label]) => <label key={key}><SolcordSwitch label={label} checked={nativePreferences.people[key]} onChange={value => updateNativePreferences({...nativePreferences, people: {...nativePreferences.people, [key]: value}})} /> {label}</label>)}
                </div><strong className="solcord-subheading">Pinned DM groups</strong><div className="solcord-control-grid">{([["friends", "Friends"], ["groups", "Group DMs"], ["bots", "Bots"], ["blocked", "Blocked"], ["others", "Other DMs"]] as const).map(([key, label]) => <label key={key}><SolcordSwitch label={label} checked={nativePreferences.people.pinCategories[key]} onChange={value => updateNativePreferences({...nativePreferences, people: {...nativePreferences.people, pinCategories: {...nativePreferences.people.pinCategories, [key]: value}}})} /> {label}</label>)}</div></details>
                <div className="solcord-inline-field"><input value={channelId} inputMode="numeric" placeholder="Loaded DM, server, or user ID" aria-label="Local Discord object ID" onChange={event => {const value = event.currentTarget.value.replace(/\D/g, ""); setChannelId(value); setPeopleTarget(SolcordRuntime.resolvePeopleObject(value)); setServerAlias(""); setActionStatus("");}} /><ActionButton disabled={!peopleTarget?.canPinDm} onClick={() => addLocalSpaceRule("pin")}>{peopleSnapshot?.pinnedDmIds.includes(peopleTarget?.id ?? "") ? "Unpin DM" : "Pin DM"}</ActionButton><ActionButton disabled={!peopleTarget?.canManageServer} onClick={() => addLocalSpaceRule("hide")}>{peopleSnapshot?.hiddenGuildIds.includes(peopleTarget?.id ?? "") ? "Show server" : "Hide server"}</ActionButton></div>
                {peopleTarget && channelId && <div className="solcord-inline-status" role="status" aria-live="polite"><span>{peopleTarget.label}</span>{peopleTarget.kind === "server-channel" && peopleTarget.serverId && <ActionButton onClick={() => {const target = SolcordRuntime.resolvePeopleObject(peopleTarget.serverId!); setChannelId(peopleTarget.serverId!); setPeopleTarget(target); setServerAlias(""); setActionStatus("");}}>Use server</ActionButton>}</div>}
                <div className="solcord-inline-field solcord-alias-field"><input value={serverAlias} maxLength={48} placeholder="Local server alias" aria-label="Local server alias" disabled={!peopleTarget?.canManageServer} onChange={event => setServerAlias(event.currentTarget.value)} /><ActionButton disabled={!peopleTarget?.canManageServer || !serverAlias.trim()} onClick={() => addLocalSpaceRule("alias")}>Save alias</ActionButton></div>
                {(peopleSnapshot?.pinnedDmIds.length || peopleSnapshot?.hiddenGuildIds.length || Object.keys(peopleSnapshot?.guildAliases ?? {}).length) ? <div className="solcord-native-preview" role="list" aria-label="Account-local People and Spaces rules">
                    {peopleSnapshot?.pinnedDmIds.map(id => <p key={`pin:${id}`} role="listitem"><strong>Pinned DM •{id.slice(-4)}</strong><small><button type="button" className="solcord-text-button" onClick={() => removeLocalSpaceRule("pin", id)}>Unpin</button></small></p>)}
                    {peopleSnapshot?.hiddenGuildIds.map(id => <p key={`hidden:${id}`} role="listitem"><strong>Hidden server •{id.slice(-4)}</strong><small><button type="button" className="solcord-text-button" onClick={() => removeLocalSpaceRule("hide", id)}>Show server</button></small></p>)}
                    {Object.entries(peopleSnapshot?.guildAliases ?? {}).map(([id, alias]) => <p key={`alias:${id}`} role="listitem"><strong>{alias}</strong><span>Server •{id.slice(-4)}</span><small><button type="button" className="solcord-text-button" onClick={() => removeLocalSpaceRule("alias", id)}>Clear alias</button></small></p>)}
                </div> : <p className="solcord-empty">No pinned DMs, hidden servers, or local aliases are saved for this account.</p>}
                <div className="solcord-inline-field"><input value={friendQuery} maxLength={80} placeholder="Filter loaded people" aria-label="Filter loaded relationships" onChange={event => setFriendQuery(event.currentTarget.value)} /><select value={friendCategory} aria-label="Relationship group" onChange={event => setFriendCategory(event.currentTarget.value as typeof friendCategory)}><option value="visible">Friends</option><option value="favorites">Favorites</option><option value="hidden">Hidden</option><option value="blocked">Blocked</option><option value="incoming">Incoming</option><option value="outgoing">Outgoing</option><option value="ignored">Ignored</option></select><select value={friendSort} aria-label="Relationship sort" onChange={event => setFriendSort(event.currentTarget.value as "name" | "status")}><option value="name">Name</option><option value="status">Status</option></select><ActionButton onClick={refreshFriendList}>Review loaded</ActionButton></div>
                {friendRows.length > 0 && <div className="solcord-native-preview" role="list" aria-label="Loaded relationship results">{friendRows.map(friend => <p key={friend.id} role="listitem"><strong>{friend.label}</strong> <span>{friend.status} · {friend.relationship}{friend.relationshipSince ? ` · since ${new Date(friend.relationshipSince).toLocaleDateString()}` : ""}{friend.mutualGuildCount !== undefined ? ` · ${friend.mutualGuildCount} mutual server${friend.mutualGuildCount === 1 ? "" : "s"}` : ""}</span>{friend.relationship === "friend" && <small>{friend.hidden ? <button type="button" className="solcord-text-button" onClick={() => updateFriendGroup(friend.id, "show")}>Show</button> : <><button type="button" className="solcord-text-button" onClick={() => updateFriendGroup(friend.id, friend.favorite ? "unfavorite" : "favorite")}>{friend.favorite ? "Unfavorite" : "Favorite"}</button> <button type="button" className="solcord-text-button" onClick={() => updateFriendGroup(friend.id, "hide")}>Hide</button></>}</small>}</p>)}</div>}
                <p className="solcord-key-hint">Pins, hidden servers, aliases, Favorites, and Hidden are encrypted for this account when Windows secure storage is available. Relationship rows come only from Discord&apos;s already-loaded store.</p>
            </details>}
            {scope === "chat" && available("translation-desk") && <details>
                <summary>Translation Desk</summary>
                <div className="solcord-translation-grid">
                    <label>Engine<select value={nativePreferences.translation.provider} onChange={event => {void changeTranslationProvider(event.currentTarget.value as typeof nativePreferences.translation.provider);}}><option value="local">On-device</option><option value="off">Provider off</option><option value="deepl">DeepL Free</option><option value="libretranslate">LibreTranslate</option></select></label>
                    <p className="solcord-key-hint" role="status">{nativePreferences.translation.provider === "local" ? localPairMessage : nativePreferences.translation.provider === "off" ? "Provider off. Nothing will be transmitted." : "External provider selected. Solcord shows the destination and asks before each request."}</p>
                    <div className="solcord-translation-languages"><PreferenceTextField key={`from:${translationContext}`} label="From" value={nativePreferences.translation.sourceLanguage} maxLength={16} placeholder="auto" normalize={value => translationLanguage(value, true)} onCommit={value => updateTranslationPreferences({sourceLanguage: value})} onDraftChange={dirty => translationDraftChanged("sourceLanguage", dirty)} /><PreferenceTextField key={`to:${translationContext}`} label="To" value={nativePreferences.translation.targetLanguage} maxLength={16} placeholder="EN" normalize={value => translationLanguage(value)} onCommit={value => updateTranslationPreferences({targetLanguage: value})} onDraftChange={dirty => translationDraftChanged("targetLanguage", dirty)} /></div>
                    {externalTranslation && <details className="solcord-secondary-tools"><summary>External provider settings</summary>
                        {nativePreferences.translation.provider === "libretranslate" && <PreferenceTextField key={`endpoint:${state.accountGeneration}`} label="HTTPS endpoint" value={nativePreferences.translation.endpoint} maxLength={500} placeholder="https://translate.example/translate" normalize={translationAddress} onCommit={value => updateTranslationPreferences({endpoint: value})} onDraftChange={dirty => translationDraftChanged("endpoint", dirty)} />}
                        <label>Credential<input type="password" autoComplete="off" value={translationCredential} placeholder="Stored only through encrypted private storage" onChange={event => {credentialResults.invalidate(); setTranslationCredential(event.currentTarget.value);}} /></label>
                        <div className="solcord-actions solcord-translation-credentials"><ActionButton disabled={translationDirty || !translationEndpoint} onClick={() => credentialAction("load")}>Load credential</ActionButton><ActionButton disabled={translationDirty || !translationEndpoint || !translationCredential} onClick={() => credentialAction("save")}>Save securely</ActionButton><ActionButton disabled={translationDirty || !translationEndpoint} tone="danger" onClick={() => credentialAction("clear")}>Clear credential</ActionButton></div>
                    </details>}
                    <textarea value={translationText} maxLength={16000} placeholder="Text to translate" aria-label="Text to translate" onChange={event => {translationResults.invalidate(); translationAbort.current?.abort(); setTranslationResult(""); setTranslationText(event.currentTarget.value);}} />
                    {translationDirty && <p className="solcord-key-hint solcord-translation-edit-hint" role="status">Finish editing the language or endpoint, then press Enter or leave the field to save. Escape cancels the edit.</p>}
                    <div className="solcord-actions"><ActionButton disabled={translationDirty || !translationText || nativePreferences.translation.provider === "off" || (nativePreferences.translation.provider === "libretranslate" && !translationEndpoint) || (nativePreferences.translation.provider === "local" && localPairBlocked)} onClick={() => translate()}>{nativePreferences.translation.provider === "local" ? "Translate on device" : "Review destination and translate"}</ActionButton>{nativePreferences.translation.provider === "local" && (localTranslationState?.queued ?? 0) > 0 && <ActionButton tone="danger" onClick={() => {translationResults.invalidate(); translationAbort.current?.abort(); requireController().cancelLocalTranslations();}}>Cancel local translation</ActionButton>}</div>
                    {translationResult && <output>{translationResult}</output>}
                </div>
            </details>}
            {scope === "voice" && available("voice-note-studio") && <details><summary>Voice Note Studio</summary><div className="solcord-control-grid"><label><SolcordSwitch label="Download loaded voice messages" checked={nativePreferences.voiceNotes.downloadButton} onChange={value => updateNativePreferences({...nativePreferences, voiceNotes: {...nativePreferences.voiceNotes, downloadButton: value}})} /> Download loaded voice messages</label><label><SolcordSwitch label="Use minimal local voice-file metadata" checked={nativePreferences.voiceNotes.stripMetadata} onChange={value => updateNativePreferences({...nativePreferences, voiceNotes: {...nativePreferences.voiceNotes, stripMetadata: value}})} /> Minimal local file metadata</label></div><p role="status" aria-live="polite" className="solcord-key-hint">Voice Note Studio state: {voicePhaseLabel[voicePhase]}.</p><div className="solcord-actions"><ActionButton disabled={voicePhase !== "idle" || Boolean(voicePreview)} onClick={() => startVoice()}>{voiceStarting ? "Waiting for microphone" : voicePhase === "processing" ? "Building preview" : "Record"}</ActionButton><ActionButton disabled={!voiceRecording} onClick={() => stopVoice()}>Stop and preview</ActionButton>{voiceDeliveryMode === "discord-composer" ? <ActionButton disabled={voicePhase !== "preview-ready" || !voicePreview || !channelId} onClick={prepareVoiceUpload}>Open normal upload composer</ActionButton> : <ActionButton disabled={voicePhase !== "preview-ready" || !voicePreview} onClick={saveVoiceFile}>Save local voice file</ActionButton>}<ActionButton disabled={voicePhase === "idle" && !voicePreview} tone="danger" onClick={() => {controller?.cancelVoiceNote(); setVoicePreview(undefined); setActionStatus("Local voice-note recording and preview cleared.");}}>Cancel</ActionButton></div>{voicePreview && <div className="solcord-native-preview"><audio controls src={voicePreview.url} />{voicePreview.waveform.length > 0 && <div className="solcord-voice-waveform" aria-label="Locally analyzed voice-note waveform">{voicePreview.waveform.filter((_, index) => index % Math.max(1, Math.ceil(voicePreview.waveform.length / 64)) === 0).map((sample, index) => <i key={index} style={{height: `${Math.max(2, Math.round(sample / 255 * 28))}px`}} />)}</div>}<small>{Math.ceil(voicePreview.durationMs / 1000)} seconds · {(voicePreview.sizeBytes / 1024).toFixed(1)} KiB · not uploaded{voiceDeliveryMode === "local-file" ? " · manual attachment fallback" : ""}</small></div>}</details>}
            {scope === "chat" && available("notification-review") && <details><summary>Notification Review</summary><div className="solcord-control-grid">{([["includeDms", "Include DMs"], ["includeGuilds", "Include servers"], ["includeMuted", "Include muted channels"]] as const).map(([key, label]) => <label key={key}><SolcordSwitch label={label} checked={nativePreferences.notifications[key]} onChange={value => updateNativePreferences({...nativePreferences, notifications: {...nativePreferences.notifications, [key]: value}})} /> {label}</label>)}</div><div className="solcord-actions"><ActionButton onClick={() => previewNotifications("mentions")}>Review mentions</ActionButton><ActionButton onClick={() => previewNotifications("guild")}>Review current server</ActionButton><ActionButton onClick={() => previewNotifications("all")}>Review all</ActionButton></div><p className="solcord-key-hint">Every action previews a bounded count and asks again before changing read state. Muted channels stay excluded unless you opt in.</p></details>}
            {scope === "friends" && available("permission-lens") && <details><summary>Permission Lens and Focus Channels</summary><div className="solcord-catalog-tools"><label>Cached permission names<input value={permissionInput} onChange={event => setPermissionInput(event.currentTarget.value)} /></label><div className="solcord-actions"><ActionButton disabled={!permissionInput.trim()} onClick={reviewPermissions}>Explain locally</ActionButton></div><label>Focus channel IDs<input value={focusInput} placeholder="Comma-separated loaded channel IDs" onChange={event => setFocusInput(event.currentTarget.value.replace(/[^\d,\s]/g, ""))} /></label><div className="solcord-actions"><ActionButton onClick={applyFocus}>{focusInput.trim() ? "Apply focus" : "Clear focus"}</ActionButton></div></div>{permissionResults.length > 0 && <div className="solcord-native-preview">{permissionResults.map(result => <p key={result.permission}><strong>{result.permission}</strong><span>{result.explanation}</span></p>)}</div>}<p className="solcord-key-hint">Permission Lens uses only supplied cached names. Focus Channels changes only the loaded local channel rail, stays session-only, and clears on account switch.</p></details>}
            {scope === "friends" && available("local-identity-notes") && <details><summary>Encrypted Local Identity Notes</summary><div className="solcord-composer-lab"><p className="solcord-key-hint">Default-off and account-isolated. Notes never edit profiles, sync to cloud, enter diagnostics, or appear in portable settings exports.</p><div className="solcord-catalog-tools"><label>Discord user ID<input value={identitySubject} inputMode="numeric" maxLength={32} placeholder="User ID" onChange={event => setIdentitySubject(event.currentTarget.value.replace(/\D/g, ""))} /></label><label>Private tags<input value={identityTags} maxLength={199} placeholder="friend, project" onChange={event => setIdentityTags(event.currentTarget.value)} /></label></div><textarea value={identityText} maxLength={280} placeholder="Private local note" aria-label="Private local identity note" onChange={event => setIdentityText(event.currentTarget.value)} /><div className="solcord-actions"><ActionButton disabled={!identitySubject || !identityText} onClick={() => saveIdentityNote()}>Review and store</ActionButton><ActionButton onClick={() => loadIdentityNotes()}>Load account notes</ActionButton><ActionButton tone="danger" disabled={!identityNotes.length} onClick={() => {if (window.confirm("Clear every Local Identity Note for the current Discord account?")) return SolcordRuntime.clearLocalIdentityNotes().then(() => loadIdentityNotes());}}>Clear all</ActionButton></div>{identityNotes.length > 0 && <div className="solcord-native-preview">{identityNotes.map(note => <p key={note.subjectId}><strong>User •{note.subjectId.slice(-4)}</strong><span>{note.text}{note.tags.length ? ` · ${note.tags.join(", ")}` : ""}</span><small>{timestamp(note.updatedAt)} <button type="button" className="solcord-text-button" onClick={() => removeIdentityNote(note.subjectId)}>Remove</button></small></p>)}</div>}<p className="solcord-key-hint">{identityPersistent ? "Encrypted persistence is active." : "No persistence claim: until loaded, or when safeStorage is unavailable, notes are session-only."}</p></div></details>}
            </div>
        </>}
        {actionStatus && <p role="status" className="solcord-import-status">{actionStatus}</p>}
    </Section>;
}

function AccessibilityControls() {
    const accessibility = useStateFromStores(SolcordSettings, () => SolcordSettings.snapshot().modules["accessibility-toolkit"]);
    const setting = useSolcordWrite((key: string, value: unknown) => SolcordRuntime.setValue("accessibility-toolkit", key, value));
    return <Section title="Accessibility" summary="Reading, contrast, focus, and motion controls.">
        <AccessibilityOptions enabled={accessibility.enabled} values={accessibility.values}
            onEnabledChange={enabled => SolcordRuntime.setEnabled("accessibility-toolkit", enabled)} onValueChange={setting} />
    </Section>;
}

function PerformanceProfileControls() {
    const preferences = useStateFromStores(SolcordSettings, () => SolcordSettings.slice("productPreferences"));
    const profile = preferences.performanceProfile;
    const reducedByOs = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    const policy = resolveSolcordPerformancePolicy(profile, preferences.appearance.motion, reducedByOs);
    const setProfile = useSolcordWrite((performanceProfile: SolcordPerformanceProfile) => SolcordRuntime.setProductPreferences({...SolcordSettings.slice("productPreferences"), performanceProfile}));
    return <Section title="Performance profile" summary="Choose how much background work and motion Solcord may use.">
        <div className="solcord-segmented" role="radiogroup" aria-label="Solcord performance profile">
            {(Object.keys(SOLCORD_PERFORMANCE_POLICIES) as SolcordPerformanceProfile[]).map(id => <button key={id} type="button" role="radio" aria-checked={profile === id} onClick={() => setProfile(id)}><strong>{id[0].toUpperCase() + id.slice(1)}</strong><small>{SOLCORD_PERFORMANCE_POLICIES[id].description}</small></button>)}
        </div>
        <dl className="solcord-facts solcord-policy-facts"><div><dt>Effective motion</dt><dd>{policy.effectiveMotion}</dd></div><div><dt>Performance sampling</dt><dd>no faster than every {policy.sampleSeconds} seconds</dd></div><div><dt>Ambient accents</dt><dd>{policy.ambientEffects ? "available" : "off"}</dd></div><div><dt>Windows reduced motion</dt><dd>{reducedByOs ? "honored" : "not requested"}</dd></div></dl>
    </Section>;
}

function BaselineToolsPanel() {
    const state = useStateFromStores([SolcordSettings, SolcordRuntime], () => ({preferences: SolcordSettings.slice("productPreferences"), runtime: SolcordRuntime.baselineSuiteStatus()}));
    const baseline = state.preferences.baseline;
    const [mediaLabel, setMediaLabel] = useState("");
    const [mediaUrl, setMediaUrl] = useState("");
    const [mediaKind, setMediaKind] = useState<SolcordMediaKind>("gif");
    const [status, setStatus] = useState("");
    const update = (patch: Partial<typeof baseline>) => {
        const current = SolcordSettings.slice("productPreferences");
        return SolcordRuntime.setProductPreferences({...current, baseline: {...current.baseline, ...patch}});
    };
    const toggleRegion = (region: "guilds" | "channels" | "members", hidden: boolean) => {
        const collapsedRegions = SolcordSettings.slice("productPreferences").baseline.collapsedRegions;
        return update({collapsedRegions: hidden ? [...new Set([...collapsedRegions, region])] : collapsedRegions.filter(item => item !== region)});
    };
    const addMedia = async () => {
        const url = normalizeSolcordMediaShelfUrl(mediaUrl.trim());
        try {
            if (!url) throw new Error();
            const mediaShelf = SolcordSettings.slice("productPreferences").baseline.mediaShelf;
            await update({mediaShelf: [...mediaShelf, {id: globalThis.crypto?.randomUUID?.() ?? `media-${Date.now().toString(36)}`, label: mediaLabel.trim() || "Saved media", url, kind: mediaKind}].slice(-200)});
            setMediaLabel(current => current === mediaLabel ? "" : current);
            setMediaUrl(current => current === mediaUrl ? "" : current);
            setStatus("Saved the Discord CDN reference locally. Solcord did not download it.");
        }
        catch {setStatus(url ? "The reference was not saved. Your input is still here; try again or open Recovery." : "Use an HTTPS Discord CDN URL with no credentials, query, or fragment. Nothing was saved.");}
    };
    return <Section title="Layout and message tools" summary="Local controls for layout, embeds, scrolling, message previews, and saved media references. When every switch is off, these tools stay out of Discord.">
        <div className="solcord-setting-rows">
            <label><span><strong>Layout Collapse</strong><small>Hide selected Discord regions locally. Use the floating restore control or Ctrl+Shift+L to show every panel.</small></span><SolcordSwitch label="Enable Layout Collapse" checked={baseline.layoutCollapse} onChange={value => update({layoutCollapse: value})} /></label>
            {baseline.layoutCollapse && <div className="solcord-inline-options" aria-label="Layout regions"><label><SolcordSwitch label="Collapse servers" checked={baseline.collapsedRegions.includes("guilds")} onChange={value => toggleRegion("guilds", value)} /> Servers</label><label><SolcordSwitch label="Collapse channels" checked={baseline.collapsedRegions.includes("channels")} onChange={value => toggleRegion("channels", value)} /> Channels</label><label><SolcordSwitch label="Collapse members" checked={baseline.collapsedRegions.includes("members")} onChange={value => toggleRegion("members", value)} /> Members</label></div>}
            <label><span><strong>Embed Controls</strong><small>Add local collapse and expand buttons without changing message data.</small></span><SolcordSwitch label="Enable Embed Controls" checked={baseline.embedControls} onChange={value => update({embedControls: value})} /></label>
            <label><span><strong>Cross-platform Autoscroll</strong><small>Middle-click a scrollable Discord region; release the middle button or press Escape to stop.</small></span><SolcordSwitch label="Enable Cross-platform Autoscroll" checked={baseline.crossPlatformAutoscroll} onChange={value => update({crossPlatformAutoscroll: value})} /></label>
            <label><span><strong>Message Link Preview</strong><small>Preview Discord message links only when the exact message is already loaded. No history fetch.</small></span><SolcordSwitch label="Enable Message Link Preview" checked={baseline.messageLinkPreview} onChange={value => update({messageLinkPreview: value})} /></label>
        </div>
        <details className="solcord-media-shelf"><summary>Media Shelf <small>{baseline.mediaShelf.length} saved reference(s)</small></summary><p>Keep bounded labels for Discord CDN GIF, sticker, or emoji links. Files are never downloaded in the background.</p><div className="solcord-catalog-tools"><label>Label<input value={mediaLabel} maxLength={64} onChange={event => setMediaLabel(event.currentTarget.value)} /></label><label>Kind<select value={mediaKind} onChange={event => setMediaKind(event.currentTarget.value as SolcordMediaKind)}><option value="gif">GIF</option><option value="sticker">Sticker</option><option value="emoji">Emoji</option></select></label><label>Discord CDN URL<input type="url" value={mediaUrl} onChange={event => setMediaUrl(event.currentTarget.value)} /></label></div><div className="solcord-actions"><ActionButton disabled={!mediaUrl.trim()} onClick={addMedia}>Save local reference</ActionButton></div>{baseline.mediaShelf.length > 0 && <div className="solcord-media-list">{baseline.mediaShelf.map(item => <div key={item.id}><span><strong>{item.label}</strong><small>{item.kind} · {new URL(item.url).hostname}</small></span><ActionButton onClick={() => navigator.clipboard?.writeText(item.url)}>Copy URL</ActionButton><ActionButton tone="danger" onClick={() => {
                const mediaShelf = SolcordSettings.slice("productPreferences").baseline.mediaShelf;
                return update({mediaShelf: mediaShelf.filter(candidate => candidate.id !== item.id)});
            }}>Remove</ActionButton></div>)}</div>}</details>
        <p className="solcord-key-hint">Runtime: {state.runtime.active ? `${state.runtime.enabled.join(", ")} active · ${Object.values(state.runtime.resources).reduce((sum, value) => sum + value, 0)} owned resources.` : "all adapters idle."} Media Shelf keeps {baseline.mediaShelf.length} local reference(s) and runs no Discord adapter. {state.runtime.unavailable.join(" ")}</p>
        {status && <p role="status" className="solcord-import-status">{status}</p>}
    </Section>;
}

function PerformanceControls() {
    const values = useStateFromStores(SolcordSettings, () => SolcordSettings.snapshot().modules["performance-hud"].values);
    return <Section title="Performance HUD" summary="Bounded local samples report event-loop and owned-resource measurements only while the overlay is visible.">
        <label><SolcordSwitch label="Show the local performance overlay" checked={values.showOverlay === true} onChange={value => SolcordRuntime.setValue("performance-hud", "showOverlay", value)} /> Show the local performance overlay</label>
        <p className="solcord-key-hint">When hidden, the sampler owns no recurring timer. <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>K</kbd> opens Command Deck.</p>
    </Section>;
}

function LinkWorkbench() {
    const [input, setInput] = useState("");
    const [inspection, setInspection] = useState<LinkInspection>();
    const [memoryRevision, setMemoryRevision] = useState(0);
    const remembered = inspection?.valid ? SolcordRuntime.domainMemoryDecision(input) : undefined;
    const domainRisk = inspection?.valid ? SolcordRuntime.inspectDomain(input) : undefined;
    const remember = (decision: "allow" | "warn" | "block") => {
        if (SolcordRuntime.rememberDomain(input, decision)) setMemoryRevision(memoryRevision + 1);
    };
    return <Section title="Link Lens" summary="Paste a link for a local inspection of the visible host, declared redirect target, tracking parameters, confusable-domain signals, and Discord invite code.">
        <div className="solcord-inline-field">
            <input type="url" value={input} placeholder="https://example.com/path" aria-label="Link to inspect" onChange={event => {setInput(event.currentTarget.value); setInspection(undefined);}} />
            <ActionButton tone="accent" onClick={() => setInspection(SolcordRuntime.inspectLink(input))} disabled={!input.trim()}>Inspect locally</ActionButton>
        </div>
        {inspection && <div className={`solcord-link-result ${inspection.valid ? "" : "solcord-link-invalid"}`}>
            <dl className="solcord-facts">
                <div><dt>Visible host</dt><dd>{inspection.host ?? "invalid"}</dd></div>
                <div><dt>Declared final host</dt><dd>{inspection.finalHost ?? "unknown"}</dd></div>
                <div><dt>Invite</dt><dd>{inspection.inviteCode ?? "not detected"}</dd></div>
                <div><dt>Removed trackers</dt><dd>{inspection.removedParameters.join(", ") || "none"}</dd></div>
            </dl>
            {inspection.warnings.length ? <ul>{inspection.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul> : <p>No local warning signal was found. That is not a safety guarantee.</p>}
            <div className="solcord-domain-memory">
                <strong>Domain Memory</strong>
                <p>{remembered ? `${remembered.decision} until ${timestamp(remembered.expiresAt)}` : "No expiring decision is stored for this exact host."}</p>
                {domainRisk?.reasons.length ? <small>Allow is unavailable: {domainRisk.reasons.join(", ")}.</small> : <small>Scheme-and-host decisions expire after seven days and never apply to subdomains. In warn-only mode, allow never bypasses a Link Lens warning.</small>}
                <div className="solcord-actions">
                    <ActionButton disabled={domainRisk?.restricted !== false} onClick={() => remember("allow")}>Remember allow</ActionButton>
                    <ActionButton onClick={() => remember("warn")}>Remember warning</ActionButton>
                    <ActionButton tone="danger" onClick={() => remember("block")}>Remember block</ActionButton>
                    <ActionButton disabled={!remembered || !inspection.host} onClick={() => {if (inspection.host && SolcordRuntime.forgetDomain(inspection.host)) setMemoryRevision(memoryRevision + 1);}}>Forget</ActionButton>
                </div>
            </div>
        </div>}
    </Section>;
}

function AttachmentGuardWorkbench() {
    const [input, setInput] = useState("");
    const [mime, setMime] = useState("");
    const [source, setSource] = useState<"url" | "local-file">("url");
    const [inspection, setInspection] = useState<ReturnType<typeof SolcordRuntime.inspectAttachment>>();
    const inspectLocalFile = (file?: File) => {
        if (!file) return;
        setSource("local-file");
        setMime(file.type);
        setInspection(SolcordRuntime.inspectLocalAttachment(file));
    };
    return <Section title="Attachment Guard" summary="Review a visible attachment URL or choose a local file to inspect only its filename, extension, and browser-declared MIME. This tool never reads file contents, downloads, opens, scans, or uploads the file.">
        <div className="solcord-inline-field">
            <input type="url" value={input} placeholder="https://cdn.example/file.zip" aria-label="Attachment URL to inspect" onChange={event => {setInput(event.currentTarget.value); setSource("url"); setInspection(undefined);}} />
            <input value={mime} placeholder="Optional MIME type" aria-label="Declared attachment MIME type" onChange={event => {setMime(event.currentTarget.value); setInspection(undefined);}} />
            <ActionButton tone="accent" onClick={() => {setSource("url"); setInspection(SolcordRuntime.inspectAttachment(input, mime || undefined));}} disabled={!input.trim()}>Inspect URL locally</ActionButton>
        </div>
        <label className="solcord-inline-field"><span>Choose a local file (metadata only)</span><input type="file" aria-label="Local file to inspect" onChange={event => {inspectLocalFile(event.currentTarget.files?.[0]); event.currentTarget.value = "";}} /></label>
        {inspection && <div className={`solcord-link-result ${inspection.risk === "block" ? "solcord-link-invalid" : ""}`} role="status">
            <dl className="solcord-facts"><div><dt>Source</dt><dd>{source === "local-file" ? "Local file metadata" : inspection.host ?? "invalid URL"}</dd></div><div><dt>Filename</dt><dd>{inspection.filename ?? "unavailable"}</dd></div><div><dt>Extension</dt><dd>{inspection.extension ?? "none"}</dd></div><div><dt>Local result</dt><dd>{inspection.risk}</dd></div></dl>
            {inspection.reasons.length ? <ul>{inspection.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul> : <p>No high-risk filename signal was found. This is not a malware verdict.</p>}
        </div>}
    </Section>;
}

function ScreenshotScrubber() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const sourceRef = useRef<HTMLImageElement | undefined>(undefined);
    const dragRef = useRef<{x: number; y: number;} | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [loading, setLoading] = useState(false);
    const [mode, setMode] = useState<"cover" | "blur">("cover");
    const [error, setError] = useState("");
    const [region, setRegion] = useState({x: 10, y: 10, width: 30, height: 20});

    const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = event.currentTarget;
        const rect = canvas.getBoundingClientRect();
        return {x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height};
    };
    const drawSource = () => {
        const canvas = canvasRef.current;
        const image = sourceRef.current;
        if (!canvas || !image) return;
        canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    const clearSource = () => {
        sourceRef.current = undefined;
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = 1;
        canvas.height = 1;
        canvas.getContext("2d")?.clearRect(0, 0, 1, 1);
    };
    const load = (file?: File) => {
        setError("");
        const supportedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
        if (!file || !supportedTypes.has(file.type)) {
            clearSource();
            setLoading(false);
            setLoaded(false);
            setError("Choose a PNG, JPEG, or WebP image.");
            return;
        }
        if (file.size > 25 * 1024 * 1024) {
            clearSource();
            setLoading(false);
            setLoaded(false);
            setError("The local image exceeds the 25 MB safety limit.");
            return;
        }
        clearSource();
        setLoading(true);
        setLoaded(false);
        const reader = new FileReader();
        reader.onload = () => {
            const image = new Image();
            image.onload = () => {
                if (image.naturalWidth * image.naturalHeight > 40_000_000) {
                    clearSource();
                    setLoading(false);
                    setLoaded(false);
                    setError("The decoded image exceeds the 40-megapixel safety limit.");
                    return;
                }
                const canvas = canvasRef.current!;
                const scale = Math.min(1, 1_400 / image.naturalWidth, 900 / image.naturalHeight);
                canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
                canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
                sourceRef.current = image;
                drawSource();
                setLoaded(true);
                setLoading(false);
            };
            image.onerror = () => {
                clearSource();
                setLoading(false);
                setLoaded(false);
                setError("The image could not be decoded locally.");
            };
            image.src = String(reader.result);
        };
        reader.onerror = () => {
            clearSource();
            setLoading(false);
            setLoaded(false);
            setError("The image could not be read locally.");
        };
        reader.readAsDataURL(file);
    };
    const redact = (canvas: HTMLCanvasElement, x: number, y: number, width: number, height: number) => {
        if (width < 3 || height < 3) return;
        const context = canvas.getContext("2d")!;
        if (mode === "cover") {
            context.fillStyle = "#171a1c";
            context.fillRect(x, y, width, height);
            return;
        }
        const sample = document.createElement("canvas");
        sample.width = Math.ceil(width);
        sample.height = Math.ceil(height);
        sample.getContext("2d")?.drawImage(canvas, x, y, width, height, 0, 0, sample.width, sample.height);
        context.save();
        context.filter = "blur(12px)";
        context.drawImage(sample, 0, 0, sample.width, sample.height, x, y, width, height);
        context.restore();
    };
    const finish = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const start = dragRef.current;
        if (!start) return;
        dragRef.current = null;
        const end = point(event);
        const x = Math.min(start.x, end.x);
        const y = Math.min(start.y, end.y);
        const width = Math.abs(end.x - start.x);
        const height = Math.abs(end.y - start.y);
        redact(event.currentTarget, x, y, width, height);
    };
    const setRegionValue = (key: keyof typeof region, value: string) => {
        const number = Number(value);
        const maximum = key === "x" || key === "y" ? 99 : 100;
        const minimum = key === "width" || key === "height" ? 1 : 0;
        setRegion(current => ({...current, [key]: Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : minimum}));
    };
    const applyTypedRegion = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const x = canvas.width * region.x / 100;
        const y = canvas.height * region.y / 100;
        const width = canvas.width * Math.min(region.width, 100 - region.x) / 100;
        const height = canvas.height * Math.min(region.height, 100 - region.y) / 100;
        redact(canvas, x, y, width, height);
    };
    const download = () => {
        canvasRef.current?.toBlob(blob => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = "solcord-scrubbed.png";
            anchor.click();
            queueMicrotask(() => URL.revokeObjectURL(url));
        }, "image/png");
    };
    return <Section title="Screenshot Scrubber" summary="Choose an image from this PC, redact by pointer or percentage fields, and download a new PNG. The image stays in this renderer and is never uploaded by Solcord.">
        <div className="solcord-scrubber-controls">
            <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Choose screenshot" disabled={loading} onChange={event => load(event.currentTarget.files?.[0])} />
            <label>Tool <select value={mode} onChange={event => setMode(event.currentTarget.value as "cover" | "blur")}><option value="cover">Solid cover</option><option value="blur">Blur</option></select></label>
            <ActionButton onClick={drawSource} disabled={!loaded || loading}>Reset</ActionButton>
            <ActionButton tone="accent" onClick={download} disabled={!loaded || loading}>Download PNG</ActionButton>
        </div>
        <fieldset className="solcord-region-grid" disabled={!loaded || loading}>
            <legend>Keyboard redaction region (percent)</legend>
            {(["x", "y", "width", "height"] as const).map(key => <label key={key}>{key === "x" || key === "y" ? key.toUpperCase() : key}
                <input type="number" min={key === "width" || key === "height" ? 1 : 0} max={key === "x" || key === "y" ? 99 : 100} value={region[key]} onChange={event => setRegionValue(key, event.currentTarget.value)} />
            </label>)}
            <ActionButton onClick={applyTypedRegion} disabled={!loaded}>Apply {mode}</ActionButton>
        </fieldset>
        <canvas
            ref={canvasRef}
            className={`solcord-scrubber-canvas ${loaded ? "" : "solcord-canvas-empty"}`}
            role="img"
            aria-label="Local screenshot redaction canvas"
            aria-busy={loading}
            aria-disabled={!loaded || loading}
            onPointerDown={event => {
                if (!loaded || loading) return;
                dragRef.current = point(event);
                event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerUp={event => {
                if (!loaded || loading) return;
                finish(event);
            }}
            onPointerCancel={() => {dragRef.current = null;}}
        />
        {loading && <p className="solcord-import-status" role="status">Reading and decoding the image on this PC…</p>}
        {error && <p className="solcord-error" role="alert">{error}</p>}
        {!loaded && !loading && !error && <p className="solcord-empty" role="status">No local image selected.</p>}
    </Section>;
}

function AboutSolcord() {
    return <Section title="About Solcord" summary="A private, local-first BetterDiscord fork.">
        <dl className="solcord-facts" aria-label="Installed Solcord identity"><div><dt>Candidate</dt><dd>{Config.get("candidate")}</dd></div><div><dt>Status</dt><dd>{Config.isCleanCandidateBuild ? "Clean release candidate" : "Diagnostic build"}</dd></div><div><dt>Build</dt><dd>{Config.get("build") || "Unidentified"}</dd></div><div><dt>Core</dt><dd>{Config.get("version")}</dd></div><div><dt>Source</dt><dd>{Config.get("commit")}</dd></div></dl>
        <div className="solcord-about-grid">
            <p><strong>Why it exists.</strong> Solcord keeps the BetterDiscord plugin and theme ecosystem while tightening recovery behavior and restoring Discord Activities through a bounded same-package preload policy.</p>
            <p><strong>What it does not do.</strong> It does not grant Nitro, forge entitlements, extract tokens, backfill messages, access hidden channels, send on your behalf, send Solcord telemetry, or enable the global unrestricted preload override.</p>
            <p><strong>Privacy.</strong> Module state, snapshots, and diagnostics stay local. The private Message Timeline runs only after opt-in, is DM-only by default, and uses encrypted persistence when safeStorage is available. Sanitized diagnostics omit message content, server names, account identifiers, and absolute paths.</p>
            <p><strong>Maturity.</strong> Automated and synthetic checks can prove policy behavior; only the owner’s post-launch Codenames and second-Activity checks can complete live human acceptance.</p>
        </div>
        <p className="solcord-attribution">Based on BetterDiscord. Upstream contributors, Apache-2.0 licensing, ecosystem-compatible identifiers, and fork lineage are preserved.</p>
    </Section>;
}

function SessionPulse({openWorkspace, openSetup}: {openWorkspace(workspace: SolcordWorkspaceId): void; openSetup(): void;}) {
    const state = useStateFromStores([SolcordSettings, SolcordRuntime, PluginDoctor, PluginManager], () => ({
        document: SolcordSettings.readonlySnapshot(),
        health: SolcordRuntime.health(),
        recovery: SolcordRuntime.recoveryMode,
        quarantines: PluginDoctor.snapshot(),
        integrity: SolcordRuntime.integrityStatus(),
        adapters: SolcordRuntime.curatedAdapterStatus(),
        activity: SolcordRuntime.activityHealth(),
        relationshipChanges: SolcordRuntime.friendWatchEvents().length,
        dueReminders: SolcordRuntime.returnLaterItems().filter(item => item.dueAt <= Date.now()).length
    }));
    const quarantined = state.quarantines.filter(record => {
        if (!record.quarantinedAt) return false;
        const curated = state.document.curatedAddons[record.addonId];
        const sourceIsArchived = state.integrity.records.some(integrity => integrity.kind === "addon" && integrity.name === record.addonId && integrity.status === "missing");
        return !(curated && isSolcordBuiltInAddon(record.addonId, curated.mode) && sourceIsArchived && state.adapters[record.addonId]?.enabled);
    }).length;
    const failed = state.health.filter(item => item.status === "failed" || item.status === "quarantined").length;
    const drift = state.health.find(item => item.id === "drift-radar");
    const attentionSignals = prioritizeSolcordPulse([
        ...(state.recovery ? [{id: "recovery", priority: 100, tone: "danger" as const, label: "Safe Start is active", detail: "Optional Solcord capabilities are held off until you retry normal startup.", action: "Open recovery"}] : []),
        ...(failed || quarantined ? [{id: "addons", priority: 90, tone: "danger" as const, label: "Add-ons need attention", detail: `${failed} failed · ${quarantined} quarantined`, action: "Review add-ons"}] : []),
        ...(state.activity?.status === "attention" ? [{id: "activity", priority: 85, tone: "attention" as const, label: "Activity Bridge needs review", detail: "The bounded compatibility ledger reported attention.", action: "Inspect Activity Bridge"}] : []),
        ...(drift?.status === "failed" || drift?.status === "quarantined" ? [{id: "drift", priority: 80, tone: "attention" as const, label: "Discord adapter drift", detail: drift.detail, action: "Open diagnostics"}] : []),
        ...(state.document.onboarding.status === "pending" ? [{id: "setup", priority: 75, tone: "attention" as const, label: "Finish setup", detail: "Your saved setup is ready to continue. Nothing has changed yet.", action: "Continue"}] : []),
        ...(state.dueReminders ? [{id: "return-later", priority: 65, tone: "attention" as const, label: "Return Later is due", detail: `${state.dueReminders} local reminder(s) are ready.`, action: "Open People"}] : []),
        ...(state.relationshipChanges ? [{id: "friend-watch", priority: 60, tone: "ok" as const, label: "Relationship history updated", detail: `${state.relationshipChanges} local change(s)`, action: "Open People"}] : [])
    ]);
    const signals = attentionSignals.length ? attentionSignals : [{id: "healthy", priority: 1, tone: "ok" as const, label: "All clear", detail: "No Solcord action needs attention."}];
    return <Section title="Right now">
        <div className="solcord-pulse-list">{signals.map(signal => <article key={signal.id} className={`solcord-pulse solcord-pulse-${signal.tone}`}><div><strong>{signal.label}</strong><p>{signal.detail}</p></div>{signal.action && <ActionButton onClick={() => signal.id === "setup" ? openSetup() : openWorkspace(signal.id === "activity" ? "voice" : signal.id === "return-later" || signal.id === "friend-watch" ? "friends" : "recovery")}>{signal.action}</ActionButton>}</article>)}</div>
    </Section>;
}

function ProviderMigrationStatus() {
    const state = useStateFromStores([PluginManager, SolcordSettings], () => {
        const document = SolcordSettings.readonlySnapshot();
        const installed = SOLCORD_V2_REPLACEMENT_MANIFEST.entries.flatMap(entry => {
            const addon = PluginManager.resolveAddon(entry.fileName);
            return addon ? [{...entry, enabled: PluginManager.isEnabled(addon.filename) === true}] : [];
        });
        const selectedAddons = [...new Set([
            ...SOLCORD_PRESET_ADDONS.filter(name => document.curatedAddons[name]?.selected),
            ...installed.map(entry => entry.cardName).filter((name): name is typeof SOLCORD_PRESET_ADDONS[number] => SOLCORD_PRESET_ADDONS.includes(name as typeof SOLCORD_PRESET_ADDONS[number]))
        ])];
        const migrationNames = new Set(installed.map(entry => entry.cardName));
        const draft: SolcordSetupDraft = {
            preset: document.onboarding.draft?.preset ?? "recommended",
            selectedTheme: document.selectedTheme,
            selectedAddons,
            addonModes: Object.fromEntries(SOLCORD_PRESET_ADDONS.map(name => [name, document.curatedAddons[name]?.mode ?? (name === "SplitLargeMessages" ? "guarded" : "default")])),
            addonProviders: Object.fromEntries(SOLCORD_PRESET_ADDONS.map(name => [name, migrationNames.has(name) ? "prefer-solcord" : document.curatedAddons[name]?.provider ?? "prefer-community"])),
            timelinePolicy: document.timelinePolicy,
            productPreferences: document.productPreferences
        };
        return {installed, draft, latest: SolcordSettings.latestSetupTransaction()};
    });
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState("");
    if (!state.installed.length) return null;
    const enabled = state.installed.filter(item => item.enabled);
    const plan = SolcordRuntime.prepareProviderMigrationPlan(state.draft);
    const eligible = plan?.entries ?? [];
    const eligibleNames = new Set(eligible.map(entry => entry.name));
    const dependency = state.installed.find(item => item.fileName === "0BDFDB.plugin.js");
    const held = state.installed.filter(item => item.fileName !== dependency?.fileName && !eligibleNames.has(item.cardName));
    const reviewedFiles = [...eligible.map(entry => entry.fileName), ...(dependency ? [dependency.fileName] : [])];
    const apply = async (confirmedPlan: SolcordProviderMigrationPlan) => {
        const files = [...confirmedPlan.entries.map(entry => entry.fileName), ...(dependency ? [dependency.fileName] : [])].join(", ");
        if (!window.confirm(`Replace ${confirmedPlan.entries.length} duplicate plugin provider(s)? Solcord will verify the replacements, move only these reviewed files to a timestamped rollback archive, and preserve their private data. BDFDB retires last only if no remaining addon uses it: ${files}`)) return;
        setBusy(true);
        setStatus("Verifying replacements and preparing the rollback archive…");
        try {
            const result = await SolcordRuntime.finishSetup(state.draft, confirmedPlan);
            setStatus(`Migration ${result.transactionId} completed. ${confirmedPlan.entries.length} exact duplicate file(s) moved to the rollback archive.`);
        }
        catch {setStatus("Migration stopped safely. A file, adapter, or sealed preview changed; existing plugin files and enabled states were restored.");}
        finally {setBusy(false);}
    };
    const rollback = async () => {
        if (!window.confirm("Restore the most recent Solcord setup and duplicate-plugin migration? Current exact addon and theme states will be replaced by the recorded rollback point.")) return;
        setBusy(true);
        setStatus("Restoring the latest rollback point…");
        try {
            const result = await SolcordRuntime.rollbackLatestSetup();
            setStatus(result.status === "complete" ? "Rollback completed and exact prior addon states were restored." : "Rollback needs attention. Open Recovery before changing plugins again.");
        }
        catch {setStatus("Rollback needs attention. Existing files were left in place; open Recovery for the bounded receipt.");}
        finally {setBusy(false);}
    };
    return <Section title="Replace duplicate plugins" summary="Optional migration with an exact backup and rollback preview.">
        <div className="solcord-provider-summary">
            <div><strong>{state.installed.length}</strong><span>duplicate files</span></div>
            <div><strong>{enabled.length}</strong><span>currently active</span></div>
            <div><strong>{eligible.length}</strong><span>ready to replace</span></div>
            {dependency && <div><strong>1</strong><span>dependency rechecked last</span></div>}
        </div>
        <details className="solcord-secondary-tools solcord-provider-files"><summary>Review backup and rollback plan</summary><p>{reviewedFiles.length ? reviewedFiles.join(", ") : "No duplicate currently has a verified replacement."}</p><small>Solcord rechecks this reviewed list immediately before it acts, starts every replacement first, and moves only matching source files into a timestamped rollback archive outside the plugin scan directory. Private databases and settings stay untouched. BDFDB is rechecked and retires last only when no remaining addon uses it.</small>{held.length > 0 && <p>{held.length} duplicate file(s) remain owner-managed because their replacement is off, unsupported, or still needs consent.</p>}</details>
        <div className="solcord-actions"><ActionButton tone="accent" disabled={busy || !plan || eligible.length === 0} onClick={() => plan && apply(plan)}>{busy ? "Working…" : "Replace ready duplicates"}</ActionButton><ActionButton disabled={busy || !state.latest?.providerArchiveTransactionId} onClick={() => rollback()}>Rollback latest migration</ActionButton></div>
        {status && <p className="solcord-setup-status" role="status" aria-live="polite">{status}</p>}
    </Section>;
}

const SOLCORD_EFFECT_COLORS = Object.freeze([
    {label: "Glacier", value: "#9fb8ff"},
    {label: "Oxidized teal", value: "#76a891"},
    {label: "Ember", value: "#ff755f"},
    {label: "Warm bone", value: "#f3eee5"},
    {label: "Signal amber", value: "#f0b44d"}
] as const);

function AppearanceWorkspace() {
    const preferences = useStateFromStores(SolcordSettings, () => SolcordSettings.slice("productPreferences"));
    const appearance = preferences.appearance;
    const [saveStatus, setSaveStatus] = useState("");
    const persist = useSolcordWrite(async (next: SolcordProductPreferences) => {
        setSaveStatus("Saving…");
        await SolcordRuntime.setProductPreferences(next);
        setSaveStatus("Saved");
    }, () => setSaveStatus("Not saved. Previous setting restored."));
    const update = (next: SolcordAppearancePreferences) => persist({...SolcordSettings.slice("productPreferences"), appearance: next});
    const updateMotionEffect = (next: Partial<typeof preferences.nativeSuite.motion>) => {
        const current = SolcordSettings.slice("productPreferences");
        return persist({...current, nativeSuite: {...current.nativeSuite, motion: {...current.nativeSuite.motion, ...next}}});
    };
    const updateAnimatedBackground = (effect: typeof preferences.nativeSuite.motion.effect) => {
        const ambient = effect !== "off" && effect !== "signal";
        const motion = ambient && appearance.motion !== "reduced" ? "full" : appearance.motion;
        return persist({
            ...preferences,
            appearance: {...appearance, motion},
            nativeSuite: {...preferences.nativeSuite, motion: {...preferences.nativeSuite.motion, effect}}
        });
    };
    return <>
        <Section title="Theme and layout" summary="Changes save immediately and apply across Discord.">
            <div className="solcord-appearance-controls">
                <label>Mode<select value={appearance.mode} onChange={event => update({...appearance, mode: event.currentTarget.value as SolcordAppearancePreferences["mode"]})}><option value="follow-discord">Follow Discord</option><option value="solcord-dark">Solcord Dark</option><option value="solcord-light">Solcord Light</option><option value="oled">OLED</option></select></label>
                <label>Accent<select value={appearance.accent} onChange={event => update({...appearance, accent: event.currentTarget.value as SolcordAppearancePreferences["accent"]})}><option value="system">Discord / system</option><option value="glacier">Glacier cyan</option><option value="signal">Signal amber</option><option value="coral">Coral</option><option value="forest">Forest</option></select></label>
                <label>Density<select value={appearance.density} onChange={event => update({...appearance, density: event.currentTarget.value as SolcordAppearancePreferences["density"]})}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
                <label>Motion<select value={appearance.motion} onChange={event => update({...appearance, motion: event.currentTarget.value as SolcordAppearancePreferences["motion"]})}><option value="follow-system">Use performance profile</option><option value="full">Full</option><option value="subtle">Subtle</option><option value="reduced">Reduced</option></select></label>
                <label>Animated background<select value={preferences.nativeSuite.motion.effect === "stars" ? "field" : preferences.nativeSuite.motion.effect} onChange={event => updateAnimatedBackground(event.currentTarget.value as typeof preferences.nativeSuite.motion.effect)}><option value="off">Off</option><option value="field">SOL Flow</option><option value="work-field">Work Field</option><option value="embers">Ember Drift</option><option value="snow">Quiet Snow</option><option value="rain">Signal Rain</option><option value="signal">Click Signal only</option></select></label>
                {preferences.nativeSuite.motion.effect !== "off" && preferences.nativeSuite.motion.effect !== "signal" && <PreferenceSlider label="Effect amount" min={1} max={24} value={preferences.nativeSuite.motion.particleCount} onCommit={particleCount => updateMotionEffect({particleCount})} />}
                {preferences.nativeSuite.motion.effect !== "off" && <fieldset className="solcord-effect-color">
                    <legend>Effect color</legend>
                    <div role="radiogroup" aria-label="Effect color">
                        {[...SOLCORD_EFFECT_COLORS, ...(SOLCORD_EFFECT_COLORS.some(option => option.value === preferences.nativeSuite.motion.color) ? [] : [{label: "Custom", value: preferences.nativeSuite.motion.color}])].map(option => <button key={option.value} type="button" role="radio" aria-checked={preferences.nativeSuite.motion.color === option.value} aria-label={`Use ${option.label} effect color`} onClick={() => updateMotionEffect({color: option.value})}><i aria-hidden="true" style={{backgroundColor: option.value}} /><span>{option.label}</span></button>)}
                    </div>
                </fieldset>}
                {preferences.nativeSuite.motion.effect !== "off" && <PreferenceSlider label="Effect opacity" suffix="%" min={10} max={100} value={preferences.nativeSuite.motion.opacityPercent} onCommit={opacityPercent => updateMotionEffect({opacityPercent})} />}
                {preferences.nativeSuite.motion.effect !== "off" && preferences.nativeSuite.motion.effect !== "signal" && <PreferenceSlider label="Effect speed" suffix="%" min={25} max={300} value={preferences.nativeSuite.motion.speedPercent} onCommit={speedPercent => updateMotionEffect({speedPercent})} />}
                <label>Message shape<select value={appearance.messageShape} onChange={event => update({...appearance, messageShape: event.currentTarget.value as SolcordAppearancePreferences["messageShape"]})}><option value="discord">Discord default</option><option value="seamed">Quiet 1px seams</option></select></label>
            </div>
            <p className="solcord-save-status" role="status" aria-live="polite">{saveStatus}</p>
            <details className="solcord-secondary-tools"><summary>Animation surfaces</summary><div className="solcord-control-grid">{([["messages", "Messages"], ["channels", "Channels"], ["servers", "Servers"], ["members", "Members"], ["modals", "Dialogs"], ["popouts", "Menus and popouts"], ["settings", "Settings"], ["tooltips", "Tooltips"], ["threads", "Threads"]] as const).map(([key, label]) => <label key={key}><SolcordSwitch label={`Animate ${label}`} checked={preferences.nativeSuite.motion.surfaces[key]} onChange={value => updateMotionEffect({surfaces: {...preferences.nativeSuite.motion.surfaces, [key]: value}})} /> {label}</label>)}</div></details>
            <div className={`solcord-live-preview solcord-mode-${appearance.mode} solcord-accent-${appearance.accent}`}><span>Appearance preview</span><strong>Reply context stays readable at every density.</strong><small>Focus, warning, success, and danger keep distinct semantic colors.</small><button type="button">Keyboard focus sample</button></div>
        </Section>
        <AccessibilityControls />
    </>;
}

function FriendWatchPanel() {
    const state = useStateFromStores([SolcordSettings, SolcordRuntime], () => ({preferences: SolcordSettings.slice("productPreferences"), events: SolcordRuntime.friendWatchEvents(), persistent: SolcordRuntime.friendWatchPersistent()}));
    const policy = state.preferences.friendWatch;
    const storageDescription = !policy.enabled
        ? "Off. No relationship history is stored."
        : state.persistent
            ? "On. History is encrypted, local, and isolated to this account."
            : "On for this session only. Persistent storage is unavailable.";
    const update = useSolcordWrite((next: Partial<typeof policy>) => {
        const current = SolcordSettings.slice("productPreferences");
        return SolcordRuntime.setProductPreferences({...current, friendWatch: {...current.friendWatch, ...next}});
    });
    return <Section title="Friend Watch" summary="Optional local history for relationship changes already seen by Discord.">
        <div className="solcord-setting-list">
            <label className="solcord-setting-row"><span><strong>Keep relationship history</strong><small>Off by default. Records only relationship changes already loaded in this client.</small></span><SolcordSwitch label="Keep relationship history" checked={policy.enabled} onChange={value => update({enabled: value})} /></label>
        </div>
        <p className="solcord-privacy-summary">{storageDescription} Changing accounts clears in-memory history.</p>
        {policy.enabled && <>
            <details className="solcord-secondary-tools"><summary>Retention and notifications</summary><div className="solcord-setting-list">
                <label className="solcord-setting-row"><span><strong>Display snapshots</strong><small>Keep the already-loaded display name in encrypted history.</small></span><SolcordSwitch label="Keep display snapshots" checked={policy.includeDisplaySnapshot} onChange={value => update({includeDisplaySnapshot: value})} /></label>
                <label className="solcord-setting-row"><span><strong>Retention</strong><small>Older entries are removed automatically.</small></span><select value={policy.retentionDays} onChange={event => update({retentionDays: Number(event.currentTarget.value) as 7 | 30 | 90})}><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></select></label>
                <label className="solcord-setting-row"><span><strong>Notifications</strong><small>Local summaries only.</small></span><select value={policy.digest} onChange={event => update({digest: event.currentTarget.value as typeof policy.digest})}><option value="off">Off</option><option value="daily">Daily</option><option value="per-event">Per event</option></select></label>
            </div></details>
            {state.events.length > 0 && <div className="solcord-actions"><ActionButton onClick={() => SolcordRuntime.exportFriendWatch("json")}>Export JSON</ActionButton><ActionButton onClick={() => SolcordRuntime.exportFriendWatch("csv")}>Export CSV</ActionButton><ActionButton tone="danger" onClick={() => {if (window.confirm("Clear this account's local Friend Watch history?")) return SolcordRuntime.clearFriendWatch();}}>Clear history</ActionButton></div>}
            <div className="solcord-people-history" aria-label="Friend Watch relationship history">{state.events.slice(-100).reverse().map(event => <article key={event.eventId}><div><strong>{event.transition === "reconciled" ? "Account scope" : event.displayLabel ?? `Local relationship •${(event.subjectKey ?? event.subjectId).slice(-4)}`}</strong><span>{event.label}</span></div><small>{timestamp(event.observedAt)} · {event.source} · {event.confidence}</small></article>)}{!state.events.length && <p className="solcord-empty">No relationship change has been observed yet.</p>}</div>
        </>}
    </Section>;
}

function ReturnLaterPanel() {
    const items = useStateFromStores(SolcordRuntime, () => SolcordRuntime.returnLaterItems());
    const [label, setLabel] = useState("");
    const [delay, setDelay] = useState(24 * 60 * 60 * 1_000);
    const [status, setStatus] = useState("");
    const add = () => {
        const added = SolcordRuntime.addCurrentViewToReturnLater(label, Date.now() + delay);
        setStatus(added ? "Saved the last visible DM or channel for this account session. It clears on account switch or Discord restart." : "Nothing was saved. Open a specific DM or channel and use Ctrl+Alt+K, then choose Save current DM or channel for later.");
        if (added) setLabel("");
    };
    return <Section title="Return Later" summary="Keep a session-only reminder for a DM or channel without sending or marking anything read.">
        <div className="solcord-inline-field">
            <input value={label} maxLength={80} placeholder="Optional private label" aria-label="Return Later label" onChange={event => setLabel(event.currentTarget.value)} />
            <select aria-label="Return Later due time" value={delay} onChange={event => setDelay(Number(event.currentTarget.value))}><option value={60 * 60 * 1_000}>In one hour</option><option value={24 * 60 * 60 * 1_000}>Tomorrow</option><option value={7 * 24 * 60 * 60 * 1_000}>In seven days</option></select>
            <ActionButton tone="accent" onClick={add}>Save current view</ActionButton>
        </div>
        {status && <p role="status" className="solcord-import-status">{status}</p>}
        <p className="solcord-key-hint">From any specific DM or channel, press <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>K</kbd> and choose Save current DM or channel for later. Routes and labels stay only in memory for this account.</p>
        <div className="solcord-people-history" aria-label="Return Later reminders">{items.map(item => <article key={item.id}><div><strong>{item.label}</strong><span>Due {timestamp(item.dueAt)}</span></div><div className="solcord-actions"><ActionButton onClick={() => SolcordRuntime.openReturnLater(item.id)}>Open</ActionButton><ActionButton onClick={() => SolcordRuntime.snoozeReturnLater(item.id, 24 * 60 * 60 * 1_000)}>Snooze one day</ActionButton><ActionButton onClick={() => SolcordRuntime.completeReturnLater(item.id)}>Complete</ActionButton></div></article>)}{!items.length && <p className="solcord-empty">No session reminder is due. Open a DM or channel and save that view when you want to return.</p>}</div>
    </Section>;
}

function SetupManagement({openSetup}: {openSetup: () => void}) {
    const document = useStateFromStores(SolcordSettings, () => SolcordSettings.readonlySnapshot());
    const [status, setStatus] = useState("");
    if (document.onboarding.status === "pending") return null;
    return <section className="solcord-setup-management" aria-label="Solcord setup management">
        <div><strong>Setup {document.onboarding.status}</strong><span>{document.onboarding.completedAt ? ` · ${timestamp(document.onboarding.completedAt)}` : ""}</span><p>Reopen the complete preview or roll back the latest staged setup transaction.</p></div>
        <div className="solcord-actions"><ActionButton onClick={openSetup}>Reopen setup</ActionButton><ActionButton tone="danger" disabled={!document.setupTransactions.length} onClick={() => {
            if (!window.confirm("Roll back the latest Solcord setup transaction? Files added by that transaction are removed only when their hashes are unchanged, and previous enabled states are restored.")) return;
            return SolcordRuntime.rollbackLatestSetup().then(result => {
                const message = {
                    complete: `Latest setup transaction rolled back; ${result.removed} unchanged staged file(s) were removed and none were preserved.`,
                    partial: `Rollback is incomplete: ${result.removed} unchanged file(s) removed and ${result.preserved} locally changed file(s) preserved, or an addon state remained held.`,
                    unavailable: "No complete setup transaction was available to roll back.",
                    failed: "Rollback could not be confirmed. No locally changed file was overwritten; review Plugin Doctor and the setup journal."
                }[result.status];
                setStatus(message);
                const options = {forceShow: true, timeout: 6_000, group: "solcord-setup-rollback"};
                if (result.status === "complete") Toasts.success(message, options);
                else if (result.status === "unavailable") Toasts.info(message, options);
                else Toasts.warning(message, options);
            }).catch(() => {
                const message = "Rollback failed closed before completion. Review Plugin Doctor and the setup journal.";
                setStatus(message);
                Toasts.error(message, {forceShow: true, timeout: 6_000, group: "solcord-setup-rollback"});
            });
        }}>Roll back latest setup</ActionButton></div>
        {status && <p role="status">{status}</p>}
    </section>;
}

function FakeDeafenControls() {
    const state = useStateFromStores([SolcordSettings, SolcordRuntime], () => ({
        consent: SolcordSettings.slice("powerLab")["fake-deafen"],
        status: SolcordRuntime.fakeDeafenStatus(),
        provider: SolcordRuntime.fakeDeafenProvider()
    }));
    const [actionStatus, setActionStatus] = useState("");
    const toggleFakeDeafen = (enabled: boolean) => {
        return SolcordRuntime.setPowerExperiment("fake-deafen", enabled, enabled).then(succeeded => {
            const status = SolcordRuntime.fakeDeafenStatus();
            setActionStatus(status.phase === "attention"
                ? status.detail
                : succeeded
                    ? (enabled ? "Direct voice control is ready." : "Adapter is idle. The adjacent button will load it again when clicked.")
                    : "The adapter failed closed.");
        });
    };
    const experiment = SOLCORD_POWER_LAB.find(candidate => candidate.id === "fake-deafen")!;
    const communityProvider = state.provider === "community";
    return <Section title="Fake Deafen" summary="A direct built-in control beside Discord's normal Deafen button.">
        <div className="solcord-power-control"><div><span className={`solcord-status solcord-status-${communityProvider || state.status.phase === "armed" ? "active" : state.status.phase === "attention" ? "failed" : "starting"}`}>{communityProvider ? "community plugin active" : state.status.phase}</span><p>{communityProvider ? "Solcord leaves the separate plugin untouched and does not stack a second gateway patch." : state.status.detail}</p></div><SolcordSwitch label="Keep Fake Deafen adapter ready" checked={state.consent.enabled} disabled={communityProvider} onChange={toggleFakeDeafen} /></div>
        <p className="solcord-key-hint">In a voice call, use the <strong>F</strong>-badged button immediately beside normal Deafen. One click turns Fake Deafen on; the next click restores normal voice state. There is no per-call confirmation.</p>
        <details className="solcord-secondary-tools"><summary>Behavior and automatic cleanup</summary><p>{experiment.summary} This changes only the voice-state information your client sends; it does not grant permissions or affect other accounts. Solcord restores or disarms on disconnect, channel change, account change, adapter drift, recovery mode, or module disable.</p></details>
        {actionStatus && <p role="status" className="solcord-import-status">{actionStatus}</p>}
    </Section>;
}

export default function SolcordPanel() {
    const recoveryMode = useStateFromStores(SolcordRuntime, () => SolcordRuntime.recoveryMode);
    const onboarding = useStateFromStores(SolcordSettings, () => SolcordSettings.slice("onboarding"));
    const productPreferences = useStateFromStores(SolcordSettings, () => SolcordSettings.slice("productPreferences"));
    const appearance = productPreferences.appearance;
    const [workspace, setWorkspace] = useState<SolcordWorkspaceId>("overview");
    const [workspaceQuery, setWorkspaceQuery] = useState("");
    const [workspaceFocus, setWorkspaceFocus] = useState<"catalog" | "setup">();
    const workspaceRef = useRef<HTMLDivElement | null>(null);
    const selectedWorkspace = SOLCORD_WORKSPACES.find(item => item.id === workspace)!;
    const visibleWorkspaces = findSolcordWorkspaces(workspaceQuery);
    const navigateFromSearch = (next: SolcordWorkspaceId) => {
        setWorkspace(next);
        setWorkspaceQuery("");
        setWorkspaceFocus(undefined);
    };
    const navigateFromCompactMenu = (event: React.MouseEvent<HTMLButtonElement>, next: SolcordWorkspaceId) => {
        event.currentTarget.closest("details")?.removeAttribute("open");
        navigateFromSearch(next);
    };
    useEffect(() => {
        const focusCatalog = workspace === "extensions" && workspaceFocus === "catalog";
        const focusSetup = workspace === "overview" && workspaceFocus === "setup";
        if (!focusCatalog && !focusSetup) return;
        const frame = requestAnimationFrame(() => {
            const target = focusCatalog
                ? workspaceRef.current?.querySelector<HTMLElement>(".solcord-catalog-table")?.closest<HTMLElement>(".solcord-section")
                : workspaceRef.current?.querySelector<HTMLElement>(".solcord-wizard");
            scrollSolcordSettingsTarget(target ?? null, "target");
            target?.querySelector<HTMLElement>("input, select, button, [href]")?.focus({preventScroll: true});
            setWorkspaceFocus(undefined);
        });
        return () => cancelAnimationFrame(frame);
    }, [workspace, workspaceFocus]);
    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            scrollSolcordSettingsTarget(workspaceRef.current, "upward-only");
            workspaceRef.current?.querySelector<HTMLElement>(".solcord-workspace-heading h2")?.focus({preventScroll: true});
        });
        return () => cancelAnimationFrame(frame);
    }, [onboarding.status, workspace]);
    const openSetup = () => {
        if (SolcordSettings.slice("onboarding").status !== "pending") SolcordSettings.reopenOnboarding();
        setWorkspaceFocus("setup");
        setWorkspace("overview");
    };
    return <SolcordActionErrorContext.Provider value={() => Toasts.error("That change did not finish. Try again, or open Recovery.", {forceShow: true, group: "solcord-setting-error"})}><main role="main" aria-label="Solcord Control Center" className={`solcord-panel solcord-density-${appearance.density} solcord-motion-${appearance.motion}`}>
        <header className="solcord-header">
            <div className="solcord-mark" aria-hidden="true"><img src={solcordMark} alt="" /></div>
            <div className="solcord-header-copy"><h1>Solcord</h1><p>Control Center</p>{!Config.isCleanCandidateBuild && <span className="solcord-build-warning" role="status">Diagnostic build</span>}</div>
        </header>
        {recoveryMode && <div className="solcord-recovery-banner" role="alert">
            <div><strong>Safe Start</strong><p>Solcord features are paused after interrupted launches.</p></div>
            <ActionButton onClick={() => SolcordRuntime.leaveRecoveryMode()}>Resume Solcord</ActionButton>
        </div>}
        <div className={`solcord-control-center${onboarding.status === "pending" ? " solcord-control-center-setup" : ""}`}>
            <nav className="solcord-workspace-nav" aria-label="Solcord settings">
                <label className="solcord-workspace-search"><span className="sr-only">Filter Solcord settings</span><input type="search" value={workspaceQuery} placeholder="Find a setting" onChange={event => setWorkspaceQuery(event.currentTarget.value)} /></label>
                <div className="solcord-workspace-nav-list" aria-label={workspaceQuery.trim() ? `${visibleWorkspaces.length} matching Solcord sections` : undefined}>{WORKSPACE_GROUPS.map(group => {
                    const items = visibleWorkspaces.filter(item => group.ids.includes(item.id));
                    return items.length ? <section key={group.label} aria-label={group.label}><p>{group.label}</p>{items.map(item => <button key={item.id} type="button" aria-current={workspace === item.id ? "page" : undefined} onClick={() => navigateFromSearch(item.id)}><strong>{item.label}</strong></button>)}</section> : null;
                })}{!visibleWorkspaces.length && <p className="solcord-nav-empty">No matching setting</p>}</div>
                <details className="solcord-workspace-menu"><summary aria-label={`Change workspace. Current workspace: ${selectedWorkspace.label}`}>Workspaces</summary><div>{SOLCORD_WORKSPACES.map(item => <button key={item.id} type="button" aria-current={workspace === item.id ? "page" : undefined} onClick={event => navigateFromCompactMenu(event, item.id)}>{item.label}</button>)}</div></details>
            </nav>
            <div ref={workspaceRef} className="solcord-workspace" data-workspace={workspace}>
                {workspace === "overview" && onboarding.status === "pending" ? <SetupWizard /> : <>
                <header className="solcord-workspace-heading"><h2 tabIndex={-1}>{selectedWorkspace.label}</h2><p>{selectedWorkspace.summary}</p></header>
                {workspace === "overview" && <>
                    {onboarding.status === "skipped" && <div className="solcord-setup-reminder"><span><strong>Setup is saved for later.</strong><small>Nothing changed. Resume whenever you are ready.</small></span><ActionButton onClick={openSetup}>Resume</ActionButton></div>}
                    <SessionPulse openWorkspace={setWorkspace} openSetup={openSetup} />
                </>}
                {workspace === "appearance" && <><AppearanceWorkspace /><BuiltInFeatureSwitches scope="appearance" /></>}
                {workspace === "performance" && <><PerformanceProfileControls /><PerformanceControls /></>}
                {workspace === "privacy" && <><PrivacyProtectionPanel /><BuiltInFeatureSwitches scope="privacy" /><StreamShieldControls /><LinkWorkbench />{productPreferences.safety.attachmentGuard && <AttachmentGuardWorkbench />}<ScreenshotScrubber /><MessageTimelinePanel /></>}
                {workspace === "chat" && <><BaselineToolsPanel /><BuiltInFeatureSwitches scope="chat" /><NativeSuitePanel key="chat" scope="chat" /><ReturnLaterPanel /></>}
                {workspace === "voice" && <><ActivityBridge /><BuiltInFeatureSwitches scope="voice" /><FakeDeafenControls /><NativeSuitePanel key="voice" scope="voice" /><StreamAudienceGuardControls /></>}
                {workspace === "friends" && <><FriendWatchPanel /><BuiltInFeatureSwitches scope="friends" /><NativeSuitePanel key="friends" scope="friends" /></>}
                {workspace === "extensions" && <>
                    <ProviderMigrationStatus />
                    <div className="solcord-all-clear"><strong>Built-ins live with their features</strong><span>Message, voice, privacy, and people tools are managed in the matching workspace.</span></div>
                    <NativeSuitePanel key="status" scope="status" />
                    <details className="solcord-secondary-tools"><summary>Technical details</summary><p>Read-only lifecycle and owned-resource status. Feature controls stay in their matching workspace.</p><RuntimeStatusDetails /></details>
                    <details className="solcord-extension-disclosure"><summary>Community plugins</summary><p>Optional plugins, migration, and troubleshooting details stay here until you need them.</p><CuratedAddonSet /><CatalogBrowser /></details>
                </>}
                {workspace === "recovery" && <><SetupManagement openSetup={openSetup} /><PluginRecovery /><ProfilesAndHistory /><details className="solcord-secondary-tools"><summary>About and technical information</summary><AboutSolcord /></details></>}
                </>}
            </div>
        </div>
    </main></SolcordActionErrorContext.Provider>;
}
