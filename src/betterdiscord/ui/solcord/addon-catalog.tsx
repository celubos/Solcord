import React from "react";

import {useStateFromStores} from "@ui/hooks";
import PluginManager from "@modules/pluginmanager";
import SolcordRuntime from "@modules/solcord/runtime";
import SolcordSettings from "@modules/solcord/store";
import PluginDoctor from "@modules/solcord/doctor";
import {SOLCORD_CATALOG_SNAPSHOT, SOLCORD_RUNTIME_ADDONS} from "@common/solcord/addon-trust.generated";
import type {AddonCandidate} from "@common/solcord/addon-catalog.generated";
import {loadSolcordCatalogDetails} from "@modules/solcord/catalog-details";
import {isSolcordBuiltInAddon, resolveCommunityAddon} from "@common/solcord/builtin-addons";
import {inferSolcordPermissionCard, type SolcordPermissionCard} from "@common/solcord/product";

import {SOLCORD_ADDON_GROUPS, SOLCORD_ADDON_PRESENTATION, visibleSolcordCommunityGroups} from "./catalog";
import SolcordSwitch from "./switch";
import {useSolcordAction} from "./use-action";

const {useEffect, useMemo, useState} = React;
const OFFICIAL_PLUGIN_STORE = "https://betterdiscord.app/plugins";

function useCatalogDetails() {
    const [records, setRecords] = useState<readonly AddonCandidate[]>([]);
    const [error, setError] = useState("");
    useEffect(() => {
        let active = true;
        loadSolcordCatalogDetails().then(value => {if (active) setRecords(value);}, () => {if (active) setError("The local catalog could not be verified. Privacy and integrity checks remain active.");});
        return () => {active = false;};
    }, []);
    return {records, error};
}

function formatBytes(bytes: number): string {
    return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function PermissionCard({permissions}: {permissions: SolcordPermissionCard;}) {
    const labels = [
        permissions.network && "Network",
        permissions.filesystem && "Files",
        permissions.patching && "Discord patches",
        permissions.messageAccess !== "none" && `Messages: ${permissions.messageAccess}`,
        permissions.accountContext && "Account context",
        permissions.localStorage && "Local storage"
    ].filter(Boolean);
    return <small className="solcord-permission-card" aria-label="Conservative static capability signals">Capability signals: {labels.length ? labels.join(" · ") : "none found in the reviewed snapshot"}. A signal is not permission to run.</small>;
}

export function CuratedAddonSet() {
    const [message, setMessage] = useState("");
    const {records: catalogDetails} = useCatalogDetails();
    const state = useStateFromStores([PluginManager, SolcordSettings, PluginDoctor, SolcordRuntime], () => {
        const settings = SolcordSettings.snapshot();
        const quarantines = new Map(PluginDoctor.snapshot().filter(record => record.quarantinedAt).map(record => [record.addonId, record]));
        const integrity = SolcordRuntime.integrityStatus();
        const adapterStatus = SolcordRuntime.curatedAdapterStatus();
        return {
            onboarding: settings.onboarding,
            integrity,
            addons: SOLCORD_RUNTIME_ADDONS.map(candidate => {
                const configured = settings.curatedAddons[candidate.name];
                const builtIn = isSolcordBuiltInAddon(candidate.name, configured?.mode);
                const addon = resolveCommunityAddon(PluginManager, candidate.name, candidate.fileName);
                const catalog = catalogDetails.find(record => record.type === "plugin" && record.name === candidate.name);
                return {
                    ...candidate,
                    configured,
                    builtIn,
                    installed: builtIn || Boolean(addon),
                    enabled: builtIn ? configured?.enabled === true : Boolean(addon && PluginManager.isEnabled(addon.filename)),
                    communityEnabled: Boolean(addon && PluginManager.isEnabled(addon.filename)),
                    adapter: adapterStatus[candidate.name],
                    permissions: catalog ? inferSolcordPermissionCard(catalog) : undefined,
                    quarantine: configured?.quarantineReason || quarantines.get(candidate.name)?.quarantineReason || quarantines.get(candidate.fileName)?.quarantineReason,
                    integrity: integrity.records.find(record => record.kind === "addon" && record.name === candidate.name)
                };
            })
        };
    }, [catalogDetails]);
    const {pending: busy, run: toggle} = useSolcordAction(async (name: string, enabled: boolean) => {
        setMessage("");
        const succeeded = await SolcordRuntime.setCuratedAddonEnabled(name, enabled);
        setMessage(succeeded ? `${SOLCORD_ADDON_PRESENTATION.get(name)?.label ?? name} ${enabled ? "enabled" : "disabled"}.` : `${name} stayed off because a security, dependency, integrity, action, or runtime gate is not accepted.`);
    }, () => setMessage("The plugin change did not finish. Try again, or open Recovery."));
    const canManage = state.onboarding.status === "complete";
    const communityGroups = visibleSolcordCommunityGroups(SOLCORD_ADDON_GROUPS, state.addons);
    return <section className="solcord-section">
        <div className="solcord-section-heading"><h3>Installed community plugins</h3><p>Optional files installed separately from Solcord&apos;s built-in tools.</p></div>
        <details className="solcord-secondary-tools"><summary>Integrity summary</summary><p>{state.integrity.summary.match} verified · {state.integrity.summary.missing} optional file(s) absent · {state.integrity.summary.attention + state.integrity.summary.unavailable} held for review. An absent optional file is not an error.</p></details>
        {communityGroups.length > 0 && !canManage && <p className="solcord-callout">Complete First Setup once to establish a rollback point before changing community plugins.</p>}
        {communityGroups.length > 0 ? <div className="solcord-curated-groups">
            {communityGroups.map(group => <details key={group.id}>
                <summary><span><strong>{group.title}</strong><small>{group.summary}</small></span><span>{group.addons.filter(addon => state.addons.find(item => item.name === addon.name)?.enabled).length} / {group.addons.length} on</span></summary>
                <div className="solcord-curated-list">
                    {group.addons.map(presentation => {
                        const addon = state.addons.find(item => item.name === presentation.name)!;
                        const visibleState = addon.quarantine ? "Quarantined" : addon.adapter?.conflict ? "Conflict" : addon.enabled ? "On" : addon.installed ? "Off" : "Not installed";
                        const visibleTone = addon.quarantine || addon.adapter?.conflict ? "solcord-status-quarantined" : addon.enabled ? "solcord-status-active" : "solcord-status-stopped";
                        return <div className="solcord-curated-row" key={addon.name}>
                            <div><div className="solcord-module-name"><strong>{presentation.label}</strong><span className={`solcord-status ${visibleTone}`}>{visibleState}</span></div><p>{presentation.summary}</p><details className="solcord-secondary-tools"><summary>Technical details</summary><p>{addon.installed ? `Local ${addon.version}` : "Catalog reference only"} · {addon.installable ? "runtime accepted" : addon.securityDisposition.toLocaleLowerCase()} · {addon.integrity?.status ?? "integrity unavailable"}</p>{addon.permissions && <PermissionCard permissions={addon.permissions} />}{addon.integrity?.installedSha256 && <small>Reviewed <code>{addon.integrity.reviewedSha256.slice(0, 12)}…</code> · installed <code>{addon.integrity.installedSha256.slice(0, 12)}…</code></small>}{addon.adapter?.conflict && <small className="solcord-error">{addon.adapter.reason}</small>}{addon.enabled && !addon.installable && <small className="solcord-error">Owner-enabled local state is preserved, but Solcord will not re-enable this candidate.</small>}{addon.quarantine && <small className="solcord-error">{addon.quarantine}</small>}</details></div>
                            <label className="solcord-toggle"><SolcordSwitch label={presentation.label} checked={addon.enabled} disabled={!canManage || !addon.installed || busy || (!addon.enabled && !addon.builtIn && !addon.installable)} onChange={value => toggle(addon.name, value)} /><span>{addon.enabled ? "On" : "Off"}</span></label>
                        </div>;
                    })}
                </div>
            </details>)}
        </div> : <p className="solcord-empty">No reviewed community plugin is installed or held for review. Built-in tools are managed in their workspaces.</p>}
        {message && <p className="solcord-import-status" role="status">{message}</p>}
    </section>;
}

export function CatalogBrowser() {
    const {records: catalogDetails, error} = useCatalogDetails();
    const [query, setQuery] = useState("");
    const [type, setType] = useState<"all" | "plugin" | "theme">("all");
    const [disposition, setDisposition] = useState("all");
    const integrity = useStateFromStores(SolcordRuntime, () => SolcordRuntime.integrityStatus());
    const matches = useMemo(() => {
        const needle = query.trim().toLocaleLowerCase();
        return catalogDetails.filter(candidate => {
            if (type !== "all" && candidate.type !== type) return false;
            if (disposition !== "all" && candidate.targetDisposition !== disposition) return false;
            return !needle || `${candidate.name} ${candidate.description} ${candidate.author} ${candidate.tags.join(" ")}`.toLocaleLowerCase().includes(needle);
        });
    }, [catalogDetails, query, type, disposition]);
    const visible = matches.slice(0, 80);
    return <section className="solcord-section">
        {error && <p className="solcord-error" role="alert">{error}</p>}
        {!error && !catalogDetails.length && <p role="status">Loading local catalog…</p>}
        <div className="solcord-section-heading"><h3>Catalog snapshot</h3><p>Reference entries from the BetterDiscord store. Browsing does not download or enable plugins or themes.</p><div className="solcord-actions"><button className="solcord-action" type="button" onClick={() => window.open(OFFICIAL_PLUGIN_STORE, "_blank", "noopener,noreferrer")}>Open official plugin store</button></div></div>
        <dl className="solcord-facts solcord-catalog-facts"><div><dt>Plugins</dt><dd>{SOLCORD_CATALOG_SNAPSHOT.pluginCount} · <code>{SOLCORD_CATALOG_SNAPSHOT.pluginSha256.slice(0, 12)}…</code></dd></div><div><dt>Themes</dt><dd>{SOLCORD_CATALOG_SNAPSHOT.themeCount} · <code>{SOLCORD_CATALOG_SNAPSHOT.themeSha256.slice(0, 12)}…</code></dd></div><div><dt>Review date</dt><dd>{SOLCORD_CATALOG_SNAPSHOT.reviewedAt}</dd></div><div><dt>Installed integrity</dt><dd>{integrity.summary.match} verified · {integrity.summary.missing} missing · {integrity.summary.attention + integrity.summary.unavailable} held</dd></div></dl>
        <div className="solcord-catalog-controls">
            <label>Search<input type="search" value={query} onChange={event => setQuery(event.currentTarget.value)} placeholder="name, author, tag, behavior" /></label>
            <label>Type<select value={type} onChange={event => setType(event.currentTarget.value as typeof type)}><option value="all">Plugins and themes</option><option value="plugin">Plugins</option><option value="theme">Themes</option></select></label>
            <label>Disposition<select value={disposition} onChange={event => setDisposition(event.currentTarget.value)}><option value="all">All dispositions</option><option value="CURATED">Curated target</option><option value="OPTIONAL">Optional</option><option value="POWER_LAB">Power Lab</option><option value="HOLD">Hold</option><option value="REJECT">Reject</option></select></label>
        </div>
        <p className="solcord-catalog-count">{matches.length} matches{matches.length > visible.length ? ` · showing first ${visible.length}` : ""}</p>
        <div className="solcord-catalog-table" role="table" aria-label="Metadata-indexed BetterDiscord catalog snapshot">
            {visible.map(candidate => <div className="solcord-catalog-row" role="row" key={`${candidate.type}-${candidate.catalogId}`}>
                <div role="cell"><strong>{candidate.name}</strong><small>{candidate.type} · {candidate.author} · {candidate.tags.slice(0, 4).join(", ") || "untagged"}</small></div>
                <p role="cell">{candidate.description}</p>
                <div role="cell"><span className="solcord-review-chip">{candidate.targetDisposition}</span><span className="solcord-review-chip">{candidate.securityDisposition}</span><small>{candidate.requestedByPreset ? "preset candidate · separate security/dependency/action/runtime gates apply" : `${candidate.licenseStatus.toLocaleLowerCase()} license · ${candidate.runtimeStatus.toLocaleLowerCase()} runtime`}</small></div>
            </div>)}
        </div>
        {!visible.length && <p className="solcord-empty">No catalog record matches these filters.</p>}
        <p className="solcord-callout">Catalog payloads are not bundled here. The aggressive pack totals {formatBytes(SOLCORD_RUNTIME_ADDONS.reduce((sum, addon) => sum + addon.sizeBytes, 0))} before BDFDB and themes. Every community candidate is currently non-installable, so setup cannot fetch or stage one.</p>
    </section>;
}
