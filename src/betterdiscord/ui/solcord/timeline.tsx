import React from "react";

import {useStateFromStores} from "@ui/hooks";
import SolcordRuntime from "@modules/solcord/runtime";
import SolcordSettings from "@modules/solcord/store";
import type {SolcordTimelinePolicy} from "@modules/solcord/contracts";
import SolcordSwitch from "./switch";
import ActionButton from "./action-button";
import {useSolcordWrite} from "./use-action";

const {useState} = React;

function bytesLabel(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function time(value: number): string {
    return new Date(value).toLocaleString();
}

function storageLabel(enabled: boolean, retention: SolcordTimelinePolicy["retention"], persistent: boolean): string {
    if (!enabled) return "Not in use while Timeline is off";
    if (retention === "session") return "Session only by choice";
    return persistent ? "AES-256-GCM · safeStorage-wrapped key" : "Session only · encrypted persistence unavailable";
}

export default function MessageTimelinePanel() {
    const [statusMessage, setStatusMessage] = useState("");
    const state = useStateFromStores([SolcordRuntime, SolcordSettings], () => ({
        policy: SolcordSettings.slice("timelinePolicy"),
        status: SolcordRuntime.timelineStatus(),
        entries: SolcordRuntime.timelineView(),
        currentChannel: SolcordRuntime.timelineCurrentChannel()
    }), undefined, (left, right) => left.policy === right.policy && left.entries === right.entries
        && left.status.records === right.status.records && left.status.deleted === right.status.deleted
        && left.status.edited === right.status.edited && left.status.ghostPings === right.status.ghostPings
        && left.status.textBytes === right.status.textBytes && left.status.persistent === right.status.persistent
        && left.currentChannel.eligible === right.currentChannel.eligible && left.currentChannel.included === right.currentChannel.included);
    const update = useSolcordWrite((value: Partial<SolcordTimelinePolicy>) => SolcordRuntime.setTimelinePolicy(value), () => setStatusMessage("The setting was not saved. Try again, or open Recovery."));
    const clear = async () => {
        if (!window.confirm("Clear the active account’s Solcord Message Timeline? This removes the encrypted local segments and the current renderer journal. It cannot be undone.")) return;
        let outcome = await SolcordRuntime.clearTimeline(false);
        if (outcome.status === "complete") {
            setStatusMessage(`Message Timeline cleared. ${outcome.cleared} local record or segment item(s) were removed; none remain.`);
            return;
        }
        if (outcome.requiresOpaqueRecovery) {
            setStatusMessage(`Timeline clear is incomplete: ${outcome.remaining} item(s) remain across ${outcome.opaqueStores} encrypted store(s). Renderer history remains visible until cleanup is confirmed complete.`);
            if (!window.confirm(`Solcord could not map ${outcome.opaqueStores} encrypted Timeline store(s) to the active account because the previous safeStorage identity is unavailable. Clear every opaque Solcord Timeline store now? This can remove Timeline history from other local Discord accounts and cannot be undone.`)) return;
            outcome = await SolcordRuntime.clearTimeline(true);
            if (outcome.status === "complete") {
                setStatusMessage(`All opaque Timeline stores were cleared. ${outcome.cleared} local record or segment item(s) were removed; none remain.`);
                return;
            }
        }
        setStatusMessage(outcome.status === "unavailable"
            ? "Timeline was not cleared because no validated account scope or private storage capability was available."
            : `Timeline clear was not confirmed complete; ${outcome.remaining} item(s) remain. Renderer history was kept visible so the result is not misrepresented.`);
    };
    const exportTimeline = async () => {
        if (!window.confirm("Export the current account’s private Message Timeline as readable JSON? The export can contain message text, edits, channel/message identifiers, and attachment metadata. Keep it private.")) return;
        const outcome = await SolcordRuntime.exportTimeline();
        setStatusMessage(outcome.status === "complete"
            ? "Timeline export downloaded locally. The bounded read was complete."
            : outcome.status === "incomplete"
                ? `Timeline export was refused because the local read was incomplete: ${outcome.omittedSegments} segment(s) omitted, ${outcome.unreadableSegments} unreadable, retention ${outcome.retentionApplied ? "applied" : "incomplete"}. No partial export was written.`
                : "Timeline export was unavailable for the current account scope.");
    };
    const toggleCurrentChannel = async () => {
        const included = !state.currentChannel.included;
        setStatusMessage(await SolcordRuntime.setCurrentChannelInTimeline(included) ? `Current server channel ${included ? "added to" : "removed from"} Timeline scope.` : "Open a server text channel before changing its Timeline scope.");
    };
    const visibleEntries = state.entries.filter(entry => {
        if (entry.purged && !state.policy.display.showPurgedMessages) return false;
        if (entry.deletedAt && !state.policy.display.showDeletedMessages) return false;
        if (entry.edits.length && !state.policy.display.showEditedMessages && !entry.deletedAt) return false;
        return true;
    });
    if (state.policy.display.reverseOrder) visibleEntries.reverse();
    return <section className="solcord-section">
        <div className="solcord-section-heading"><h2>Message Timeline</h2><p>A private local journal for messages this running client actually observes. Persistent segments are encrypted when secure storage is available; DMs are the default and servers require channel-by-channel opt-in.</p></div>
        <div className="solcord-timeline-toolbar">
            <label><SolcordSwitch label="Enable Message Timeline" checked={state.policy.enabled} onChange={value => update({enabled: value})} /> Timeline {state.policy.enabled ? "on" : "off"}</label>
            <label>Retention<select value={state.policy.retention} onChange={event => update({retention: event.currentTarget.value as SolcordTimelinePolicy["retention"]})}><option value="session">Session</option><option value="24-hours">24 hours</option><option value="7-days">7 days</option><option value="30-days">30 days</option><option value="90-days">90 days</option><option value="manual">Manual clear</option></select></label>
            <label>Content<select value={state.policy.content} onChange={event => update({content: event.currentTarget.value as SolcordTimelinePolicy["content"]})}><option value="text-only">Text only</option><option value="text-and-metadata">Text + attachment metadata</option><option value="encrypted-media" disabled>Encrypted media — not accepted</option></select></label>
            <ActionButton disabled={!state.currentChannel.eligible} onClick={toggleCurrentChannel}>{state.currentChannel.included ? "Remove current server channel" : "Add current server channel"}</ActionButton>
            <ActionButton onClick={exportTimeline}>Export JSON</ActionButton>
            <ActionButton tone="danger" onClick={clear}>Clear Timeline</ActionButton>
        </div>
        <details className="solcord-secondary-tools"><summary>Filters and display</summary>
            <div className="solcord-control-grid">
                {([[
                    "ignoreSelf", "Ignore my messages"
                ], ["ignoreBots", "Ignore bots"], ["ignoreBlockedUsers", "Ignore blocked users"], ["ignoreMutedChannels", "Ignore muted channels"], ["ignoreMutedGuilds", "Ignore muted servers"], ["ignoreNsfw", "Ignore age-restricted channels"], ["alwaysLogDms", "Always include DMs"], ["alwaysLogGhostPings", "Keep ghost pings"]] as const).map(([key, label]) => <label key={key}><SolcordSwitch label={label} checked={state.policy.filters[key]} onChange={value => update({filters: {...state.policy.filters, [key]: value}})} /> {label}</label>)}
                {([[
                    "showDeletedMessages", "Show deleted"
                ], ["showEditedMessages", "Show edited"], ["showPurgedMessages", "Show bulk-deleted"], ["showDeletedCount", "Show deleted count"], ["showEditedCount", "Show edited count"], ["reverseOrder", "Oldest first"]] as const).map(([key, label]) => <label key={key}><SolcordSwitch label={label} checked={state.policy.display[key]} onChange={value => update({display: {...state.policy.display, [key]: value}})} /> {label}</label>)}
                <label>Edit versions<input type="number" min="1" max="100" value={state.policy.display.maxShownEdits} onChange={event => update({display: {...state.policy.display, maxShownEdits: Number(event.currentTarget.value)}})} /></label>
            </div>
        </details>
        <dl className="solcord-facts solcord-timeline-facts">
            <div><dt>Storage</dt><dd>{storageLabel(state.policy.enabled, state.policy.retention, state.status.persistent)}</dd></div>
            <div><dt>Observed records</dt><dd>{state.status.records}</dd></div>
            {(state.policy.display.showDeletedCount || state.policy.display.showEditedCount) && <div><dt>Deleted / edited</dt><dd>{state.policy.display.showDeletedCount ? state.status.deleted : "—"} / {state.policy.display.showEditedCount ? state.status.edited : "—"}</dd></div>}
            <div><dt>Ghost pings</dt><dd>{state.status.ghostPings}</dd></div>
            <div><dt>Text used</dt><dd>{bytesLabel(state.status.textBytes)} of 250 MiB</dd></div>
            <div><dt>Server opt-ins</dt><dd>{state.policy.serverChannelIds.length}</dd></div>
        </dl>
        {statusMessage && <p className="solcord-import-status" role="status">{statusMessage}</p>}
        <div className="solcord-timeline-list" aria-label="Observed Message Timeline records">
            {visibleEntries.slice(0, 100).map(entry => <article key={entry.messageId} className={`solcord-timeline-entry ${entry.deletedAt ? "solcord-timeline-deleted" : ""}`}>
                <header><strong>{entry.authorLabel || "Observed user"}</strong><time>{time(entry.updatedAt)}</time>{entry.deletedAt && <span className="solcord-deleted-label">{entry.purged ? "Bulk deleted" : "Deleted"}</span>}{entry.ghostPingAt && <span className="solcord-deleted-label">Ghost ping</span>}{entry.edits.length > 0 && <span className="solcord-edited-label">Edited · {entry.edits.length}</span>}</header>
                <p>{entry.content || <em>No text content</em>}</p>
                {entry.edits.length > 0 && <details><summary>Edit history</summary><ol>{entry.edits.slice(-state.policy.display.maxShownEdits).reverse().map((edit, index) => <li key={`${edit.at}-${index}`}><time>{time(edit.at)}</time><p>{edit.content || <em>Empty text</em>}</p></li>)}</ol></details>}
                {entry.attachments.length > 0 && <ul className="solcord-attachment-metadata">{entry.attachments.map((attachment, index) => <li key={`${attachment.name}-${index}`}>{attachment.name}{attachment.contentType ? ` · ${attachment.contentType}` : ""}{typeof attachment.size === "number" ? ` · ${bytesLabel(attachment.size)}` : ""}</li>)}</ul>}
            </article>)}
            {!state.entries.length && <p className="solcord-empty">No in-scope message event has been observed in this session. Solcord does not backfill history.</p>}
            {state.entries.length > 0 && !visibleEntries.length && <p className="solcord-empty">No records match the selected display filters.</p>}
            {visibleEntries.length > 100 && <p className="solcord-empty">Showing the 100 {state.policy.display.reverseOrder ? "oldest" : "most recent"} matching records. Export includes the complete bounded local event set only when its read succeeds.</p>}
        </div>
        <p className="solcord-callout">Message meaning never depends on color: deleted entries carry a “Deleted” label and edit history carries an “Edited” label. Message bodies and identifiers are excluded from Solcord diagnostics and ordinary settings exports.</p>
    </section>;
}
