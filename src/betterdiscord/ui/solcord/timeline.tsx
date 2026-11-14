import React from "react";

import {useStateFromStores} from "@ui/hooks";
import SolcordRuntime from "@modules/solcord/runtime";
import SolcordSettings from "@modules/solcord/store";
import type {SolcordTimelinePolicy} from "@modules/solcord/contracts";
import {timelineMessageVersions, type TimelineConversation, type TimelineHistoryFilter, type TimelineMessageState} from "@modules/solcord/message-timeline";
import {TIMELINE_MAX_STORED_EVENTS} from "@common/solcord/timeline-limits";
import SolcordSwitch from "./switch";
import ActionButton from "./action-button";
import {useSolcordWrite} from "./use-action";

const {useDeferredValue, useState} = React;

const PAGE_SIZE = 50;
const FILTERS: ReadonlyArray<{id: TimelineHistoryFilter; label: string; count: "changes" | "deleted" | "edited" | "ghostPings" | "all";}> = [
    {id: "changes", label: "Deleted & edited", count: "changes"},
    {id: "deleted", label: "Deleted", count: "deleted"},
    {id: "edited", label: "Edited", count: "edited"},
    {id: "ghost-pings", label: "Ghost pings", count: "ghostPings"},
    {id: "all", label: "Everything saved", count: "all"}
];
const RETENTION_LABELS: Record<SolcordTimelinePolicy["retention"], string> = {
    "session": "Until Discord closes (nothing written to disk)",
    "24-hours": "1 day",
    "7-days": "7 days",
    "30-days": "30 days",
    "90-days": "90 days",
    "manual": "Until I erase it"
};
const SKIP_FILTERS = [
    ["ignoreSelf", "Skip my own messages"],
    ["ignoreBots", "Skip bots"],
    ["ignoreBlockedUsers", "Skip blocked users"],
    ["ignoreMutedChannels", "Skip muted channels"],
    ["ignoreMutedGuilds", "Skip muted servers"],
    ["ignoreNsfw", "Skip age-restricted channels"]
] as const;
const dateFormat = new Intl.DateTimeFormat(undefined, {dateStyle: "medium", timeStyle: "short"});

function time(value: number): React.ReactNode {
    return <time dateTime={new Date(value).toISOString()}>{dateFormat.format(value)}</time>;
}

function count(value: number): string {
    return value.toLocaleString();
}

function bytesLabel(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function scopeLabel(policy: SolcordTimelinePolicy): string {
    const servers = policy.scope === "selected-channels" ? policy.serverChannelIds.length : 0;
    return `direct messages and group DMs${servers ? ` plus ${servers} server channel${servers === 1 ? "" : "s"} you added` : ""}`;
}

type StorageState = "off" | "starting" | "encrypted" | "session-choice" | "memory-fallback" | "attention";

function storageState(policy: SolcordTimelinePolicy, persistent: boolean, health: {status: string; detail: string;} | undefined): StorageState {
    if (!policy.enabled) return "off";
    if (policy.retention === "session") return "session-choice";
    if (!health || health.status === "starting" || health.status === "stopped") return "starting";
    if (health.status !== "active") return "attention";
    return persistent ? "encrypted" : "memory-fallback";
}

const STORAGE_COPY: Record<StorageState, string> = {
    "off": "Nothing new is being saved. History saved earlier stays encrypted on this computer, hidden, until it expires or you erase it.",
    "starting": "Opening this account's encrypted history…",
    "encrypted": "Saved only on this computer, never uploaded. Each saved event is encrypted with AES-256-GCM, and its key is protected by your system's secure storage (Electron safeStorage). Files live in Solcord's data folder under solcord-timeline-v1.",
    "session-choice": "Kept in memory only, by your choice. Nothing is written to disk, and history is erased when Discord closes.",
    "memory-fallback": "Secure storage is not available on this system, so history is kept in memory only and is erased when Discord closes. Nothing unencrypted is written to disk.",
    "attention": "Message History needs attention. Open Extensions › Technical details for the exact status, or turn it off and on again."
};

function versionLabel(kind: ReturnType<typeof timelineMessageVersions>[number]["kind"], deleted: boolean): string {
    switch (kind) {
        case "original": return "Original";
        case "earliest-kept": return "Earliest saved version";
        case "edit": return "Edited to";
        default: return deleted ? "Last version before deletion" : "Current";
    }
}

function HistoryEntry({entry, conversation, maxVersions, onOpen}: {entry: TimelineMessageState; conversation: TimelineConversation; maxVersions: number; onOpen(entry: TimelineMessageState): unknown;}) {
    const deleted = entry.deletedAt !== undefined;
    const versions = timelineMessageVersions(entry);
    const earlier = versions.slice(0, -1).slice(-maxVersions);
    const headingId = `solcord-history-${entry.messageId}`;
    return <li>
        <article className={`solcord-history-entry${deleted ? " solcord-history-deleted" : ""}`} aria-labelledby={headingId}>
            <header>
                <span className="solcord-history-badges">
                    {deleted && <span className="solcord-history-badge solcord-history-badge-deleted">{entry.purged ? "Bulk deleted" : "Deleted"}</span>}
                    {entry.edits.length > 0 && <span className="solcord-history-badge solcord-history-badge-edited">Edited {entry.edits.length === 1 ? "once" : `${entry.edits.length} times`}</span>}
                    {entry.ghostPingAt !== undefined && <span className="solcord-history-badge solcord-history-badge-ghost">Ghost ping</span>}
                </span>
                <h4 id={headingId}>{entry.authorLabel || "Unknown author"}</h4>
                <span className="solcord-history-where">{conversation.label}</span>
            </header>
            <dl className="solcord-history-times">
                <div><dt>First seen</dt><dd>{time(entry.createdAt)}</dd></div>
                {deleted && <div><dt>Deleted</dt><dd>{time(entry.deletedAt!)}</dd></div>}
                {!deleted && entry.edits.length > 0 && <div><dt>Last edited</dt><dd>{time(entry.edits[entry.edits.length - 1].at)}</dd></div>}
            </dl>
            <p className="solcord-history-text"><span className="sr-only">{versionLabel("current", deleted)}: </span>{entry.content || <em>No text (attachment or embed only)</em>}</p>
            {earlier.length > 0 && <details className="solcord-history-versions">
                <summary>Show {earlier.length === 1 ? "the earlier version" : `${earlier.length} earlier versions`}</summary>
                <ol>{earlier.map((version, index) => <li key={`${version.observedAt ?? "trimmed"}-${index}`}>
                    <span className="solcord-history-version-label">{versionLabel(version.kind, deleted)}{version.observedAt !== undefined && <> · {time(version.observedAt)}</>}</span>
                    <p>{version.content || <em>Empty text</em>}</p>
                </li>)}</ol>
                {versions.length - 1 > earlier.length && <p className="solcord-empty">{versions.length - 1 - earlier.length} older version(s) hidden by the “Versions shown” setting.</p>}
            </details>}
            {entry.attachments.length > 0 && <ul className="solcord-attachment-metadata" aria-label="Attachment names">{entry.attachments.map((attachment, index) => <li key={`${attachment.name}-${index}`}>{attachment.name}{typeof attachment.size === "number" ? ` · ${bytesLabel(attachment.size)}` : ""}</li>)}</ul>}
            {conversation.kind !== "unknown" && <div className="solcord-history-actions"><ActionButton onClick={() => onOpen(entry)}>Open conversation</ActionButton></div>}
        </article>
    </li>;
}

export default function MessageTimelinePanel() {
    const [statusMessage, setStatusMessage] = useState("");
    const [filter, setFilter] = useState<TimelineHistoryFilter>("changes");
    const [search, setSearch] = useState("");
    const [where, setWhere] = useState<"all" | "current">("all");
    const [limit, setLimit] = useState(PAGE_SIZE);
    const [confirming, setConfirming] = useState<"none" | "erase" | "erase-opaque" | "export">("none");
    const deferredSearch = useDeferredValue(search);

    const base = useStateFromStores([SolcordRuntime, SolcordSettings], () => ({
        policy: SolcordSettings.slice("timelinePolicy"),
        status: SolcordRuntime.timelineStatus(),
        health: SolcordRuntime.health().find(item => item.id === "message-timeline"),
        currentChannel: SolcordRuntime.timelineCurrentChannel()
    }), undefined, (left, right) => left.policy === right.policy
        && left.status.records === right.status.records && left.status.deleted === right.status.deleted
        && left.status.edited === right.status.edited && left.status.ghostPings === right.status.ghostPings
        && left.status.textBytes === right.status.textBytes && left.status.persistent === right.status.persistent
        && left.health?.status === right.health?.status && left.health?.detail === right.health?.detail
        && left.currentChannel.eligible === right.currentChannel.eligible && left.currentChannel.included === right.currentChannel.included
        && left.currentChannel.channelId === right.currentChannel.channelId);
    const {policy, status, health, currentChannel} = base;
    const channelId = where === "current" ? currentChannel.channelId : undefined;
    const order = policy.display.reverseOrder ? "oldest" : "newest";
    const page = useStateFromStores([SolcordRuntime, SolcordSettings], () => SolcordRuntime.timelineHistory({
        filter, search: deferredSearch, channelId, limit, order, includePurged: policy.display.showPurgedMessages
    }), [filter, deferredSearch, channelId, limit, order, policy.display.showPurgedMessages]);

    const update = useSolcordWrite((value: Partial<SolcordTimelinePolicy>) => SolcordRuntime.setTimelinePolicy(value), () => setStatusMessage("That setting was not saved. Try again, or open Recovery if it keeps failing."));
    const state = storageState(policy, status.persistent, health);
    const conversations = new Map<string, TimelineConversation>();
    const conversation = (id: string) => {
        let value = conversations.get(id);
        if (!value) conversations.set(id, value = SolcordRuntime.timelineConversation(id));
        return value;
    };

    const resetPage = () => setLimit(PAGE_SIZE);
    const openConversation = (entry: TimelineMessageState) => {
        if (!SolcordRuntime.openTimelineConversation(entry.channelId, entry.messageId)) setStatusMessage("That conversation is not loaded in Discord right now, so it could not be opened.");
    };
    const erase = async (clearOpaqueStores: boolean) => {
        const outcome = await SolcordRuntime.clearTimeline(clearOpaqueStores);
        if (outcome.status === "complete") {
            setConfirming("none");
            setStatusMessage(clearOpaqueStores ? "All saved Message History on this computer was erased, including stores Solcord could not match to an account." : "Message History for this account was erased from this computer.");
            return;
        }
        if (!clearOpaqueStores && outcome.requiresOpaqueRecovery) {
            setConfirming("erase-opaque");
            setStatusMessage(`Erase is incomplete: ${outcome.remaining} encrypted item(s) remain in ${outcome.opaqueStores} store(s) that Solcord cannot match to this account, because the system key that identified them is no longer available. Your visible history was kept so nothing is misreported.`);
            return;
        }
        setConfirming("none");
        setStatusMessage(outcome.status === "unavailable"
            ? "Nothing was erased: Discord has not finished signing in to an account yet. Try again in a moment."
            : `Erase was not confirmed: ${outcome.remaining} item(s) remain. Your visible history was kept; try again, or restart Discord and retry.`);
    };
    const exportHistory = async () => {
        const outcome = await SolcordRuntime.exportTimeline();
        setConfirming("none");
        setStatusMessage(outcome.status === "complete"
            ? "Export saved through Discord's download prompt. The file contains readable message text; keep it private."
            : outcome.status === "incomplete"
                ? `No file was written, because part of the saved history could not be read (${outcome.omittedSegments} skipped, ${outcome.unreadableSegments} unreadable). Wait for saving to finish and try again.`
                : "Export is unavailable until Discord finishes signing in to an account.");
    };
    const toggleCurrentChannel = async () => {
        const included = !currentChannel.included;
        setStatusMessage(await SolcordRuntime.setCurrentChannelInTimeline(included)
            ? `The server channel open behind this window was ${included ? "added to" : "removed from"} Message History.`
            : "Open a server text channel in Discord first, then return here to add it.");
    };

    const deletedSummary = `${count(status.deleted)} deleted · ${count(status.edited)} edited · ${count(status.ghostPings)} ghost ping${status.ghostPings === 1 ? "" : "s"}`;
    const emptyText = !policy.enabled
        ? "Message History is off, so there is nothing to show. Turn it on to start saving messages Solcord sees from now on."
        : status.records === 0
            ? `Nothing saved yet. Solcord is watching ${scopeLabel(policy)}. Messages it sees from now on will appear here if they are deleted or edited.`
            : deferredSearch.trim()
                ? "No saved message matches that search."
                : where === "current"
                    ? "Nothing in the conversation open behind this window matches."
                    : filter === "all" ? "No saved messages match these choices." : `No ${FILTERS.find(item => item.id === filter)!.label.toLowerCase()} messages yet.`;

    return <section className="solcord-section solcord-history" aria-labelledby="solcord-history-title">
        <div className="solcord-history-intro">
            <div className="solcord-history-switch">
                <SolcordSwitch label="Save deleted and edited messages" checked={policy.enabled} onChange={value => update({enabled: value})} />
                <div>
                    <h3 id="solcord-history-title">Deleted &amp; Edited Messages</h3>
                    <p>{policy.enabled ? <>On · saving {scopeLabel(policy)}.</> : "Off · nothing new is being saved."}</p>
                </div>
            </div>
            <p>When this is on, Solcord keeps a private copy of messages it sees in the conversations you choose. If someone later deletes or edits one, you can still read it here. It cannot recover messages deleted before Solcord saw them, and it never reads hidden channels or fetches old history.</p>
            <dl className="solcord-facts solcord-history-facts">
                <div><dt>Stored</dt><dd>{STORAGE_COPY[state]}</dd></div>
                <div><dt>Kept for</dt><dd>{policy.retention === "session" ? RETENTION_LABELS.session : policy.retention === "manual" ? "Until you erase it" : `${RETENTION_LABELS[policy.retention]} after Solcord first sees each message`}. At most {count(TIMELINE_MAX_STORED_EVENTS)} saved events per account; the oldest are removed first.</dd></div>
                <div><dt>Saved now</dt><dd>{count(status.records)} message{status.records === 1 ? "" : "s"} ({deletedSummary}) · {bytesLabel(status.textBytes)} of text</dd></div>
            </dl>
            {state === "attention" && health?.detail && <p className="solcord-callout" role="alert">{health.detail}</p>}
        </div>

        <div className="solcord-history-toolbar">
            <div className="solcord-history-filters" role="group" aria-label="Show">
                {FILTERS.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => {setFilter(item.id); resetPage();}}>
                    {item.label} <span className="solcord-history-count">{count(page.counts[item.count])}</span>
                </button>)}
            </div>
            <div className="solcord-history-search">
                <label>Search<input type="search" value={search} placeholder="Text, name, or file name" onChange={event => {setSearch(event.currentTarget.value); resetPage();}} /></label>
                <label>Conversation<select value={where} onChange={event => {setWhere(event.currentTarget.value as "all" | "current"); resetPage();}}>
                    <option value="all">All conversations</option>
                    <option value="current" disabled={!currentChannel.channelId}>Only the one open behind this window</option>
                </select></label>
                <label>Order<select value={order} onChange={event => update({display: {...policy.display, reverseOrder: event.currentTarget.value === "oldest"}})}>
                    <option value="newest">Newest activity first</option>
                    <option value="oldest">Oldest activity first</option>
                </select></label>
            </div>
        </div>

        {statusMessage && <p className="solcord-import-status" role="status">{statusMessage}</p>}
        <p className="solcord-history-summary" aria-live="polite">{page.matched ? `Showing ${count(page.entries.length)} of ${count(page.matched)}` : ""}</p>
        {page.entries.length > 0
            ? <ol className="solcord-history-list" aria-label="Saved messages">{page.entries.map(entry => <HistoryEntry key={entry.messageId} entry={entry} conversation={conversation(entry.channelId)} maxVersions={policy.display.maxShownEdits} onOpen={openConversation} />)}</ol>
            : <p className="solcord-empty">{emptyText}</p>}
        {page.matched > page.entries.length && <div className="solcord-history-more"><ActionButton onClick={() => setLimit(value => value + PAGE_SIZE)}>Show {count(Math.min(PAGE_SIZE, page.matched - page.entries.length))} more</ActionButton></div>}

        <details className="solcord-secondary-tools">
            <summary>What gets saved</summary>
            <div className="solcord-history-settings">
                <label>Keep history for<select value={policy.retention} onChange={event => update({retention: event.currentTarget.value as SolcordTimelinePolicy["retention"]})}>
                    {(Object.keys(RETENTION_LABELS) as Array<SolcordTimelinePolicy["retention"]>).map(value => <option key={value} value={value}>{RETENTION_LABELS[value]}</option>)}
                </select></label>
                <label>Save<select value={policy.content} onChange={event => update({content: event.currentTarget.value as SolcordTimelinePolicy["content"]})}>
                    <option value="text-only">Text only</option>
                    <option value="text-and-metadata">Text and attachment names</option>
                    <option value="encrypted-media" disabled>Attachment files (not available)</option>
                </select></label>
                <label>Versions shown per message<select value={policy.display.maxShownEdits} onChange={event => update({display: {...policy.display, maxShownEdits: Number(event.currentTarget.value)}})}>
                    {[...new Set([5, 10, 25, 50, 100, policy.display.maxShownEdits])].sort((left, right) => left - right).map(value => <option key={value} value={value}>{value}</option>)}
                </select></label>
            </div>
            <div className="solcord-history-scope">
                <p><strong>Server channels.</strong> Direct messages and group DMs are always included. Server channels are saved only if you add them one at a time. {policy.serverChannelIds.length ? `${policy.serverChannelIds.length} added.` : "None added."}</p>
                <div className="solcord-history-actions">
                    <ActionButton disabled={!currentChannel.eligible} onClick={toggleCurrentChannel}>{currentChannel.included ? "Remove the open server channel" : "Add the open server channel"}</ActionButton>
                    {policy.serverChannelIds.length > 0 && <ActionButton onClick={async () => {if (await update({scope: "dm-only", serverChannelIds: []})) setStatusMessage("All server channels were removed. Only direct messages and group DMs are saved now.");}}>Remove all server channels</ActionButton>}
                </div>
                {!currentChannel.eligible && <p className="solcord-empty">To add a server channel, open it in Discord, then come back here.</p>}
            </div>
            <div className="solcord-control-grid">
                {SKIP_FILTERS.map(([key, label]) => <label key={key}><SolcordSwitch label={label} checked={policy.filters[key]} onChange={value => update({filters: {...policy.filters, [key]: value}})} /> {label}</label>)}
                <label><SolcordSwitch label="Always save direct messages, even when muted" checked={policy.filters.alwaysLogDms} onChange={value => update({filters: {...policy.filters, alwaysLogDms: value}})} /> Always save direct messages, even when muted</label>
                <label><SolcordSwitch label="Always keep messages that mentioned me" checked={policy.filters.alwaysLogGhostPings} onChange={value => update({filters: {...policy.filters, alwaysLogGhostPings: value}})} /> Always keep messages that mentioned me (ghost pings), even from skipped authors</label>
                <label><SolcordSwitch label="Show bulk-deleted messages" checked={policy.display.showPurgedMessages} onChange={value => update({display: {...policy.display, showPurgedMessages: value}})} /> Show bulk-deleted messages</label>
            </div>
        </details>

        <details className="solcord-secondary-tools" open={confirming !== "none" || undefined}>
            <summary>Export or erase</summary>
            <p>Export saves a readable JSON copy of this account&rsquo;s saved history through Discord&rsquo;s download prompt. Erase permanently deletes this account&rsquo;s saved history from this computer. Turning Message History off does not erase anything.</p>
            {confirming === "export" ? <div className="solcord-history-confirm" role="group" aria-label="Confirm export">
                <p>The export contains readable message text, edit history, and channel and message identifiers. Save it somewhere private.</p>
                <ActionButton tone="accent" onClick={exportHistory}>Export file</ActionButton>
                <ActionButton onClick={() => setConfirming("none")}>Cancel</ActionButton>
            </div> : confirming === "erase" ? <div className="solcord-history-confirm" role="group" aria-label="Confirm erase">
                <p>Permanently erase {count(status.records)} saved message{status.records === 1 ? "" : "s"} for this account? This cannot be undone.</p>
                <ActionButton tone="danger" onClick={() => erase(false)}>Erase permanently</ActionButton>
                <ActionButton onClick={() => setConfirming("none")}>Cancel</ActionButton>
            </div> : confirming === "erase-opaque" ? <div className="solcord-history-confirm" role="group" aria-label="Confirm erasing unmatched stores">
                <p>Erase every saved Message History store on this computer, including ones that may belong to other Discord accounts? This cannot be undone.</p>
                <ActionButton tone="danger" onClick={() => erase(true)}>Erase all stores</ActionButton>
                <ActionButton onClick={() => setConfirming("none")}>Keep them</ActionButton>
            </div> : <div className="solcord-history-actions">
                <ActionButton onClick={() => {setStatusMessage(""); setConfirming("export");}}>Export…</ActionButton>
                <ActionButton tone="danger" onClick={() => {setStatusMessage(""); setConfirming("erase");}}>Erase history…</ActionButton>
            </div>}
        </details>
    </section>;
}
