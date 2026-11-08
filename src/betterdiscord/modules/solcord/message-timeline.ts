import type {SolcordTimelinePolicy} from "./contracts";


export type TimelineEventKind = "create" | "edit" | "delete" | "bulk-delete" | "recovery";

export interface TimelineAttachmentMetadata {
    name: string;
    contentType?: string;
    size?: number;
}

export interface TimelineEvent {
    eventId: string;
    kind: TimelineEventKind;
    observedAt: number;
    messageId: string;
    channelId: string;
    authorId?: string;
    authorLabel?: string;
    authorIsBot?: boolean;
    mentionedCurrentUser?: boolean;
    content?: string;
    attachments?: TimelineAttachmentMetadata[];
}

export interface TimelineMessageState {
    messageId: string;
    channelId: string;
    authorId?: string;
    authorLabel?: string;
    authorIsBot: boolean;
    mentionedCurrentUser: boolean;
    content: string;
    createdAt: number;
    updatedAt: number;
    deletedAt?: number;
    ghostPingAt?: number;
    purged?: boolean;
    edits: Array<{at: number; content: string;}>;
    attachments: TimelineAttachmentMetadata[];
}

export type DiscordTimelineDispatchType = "MESSAGE_CREATE" | "MESSAGE_UPDATE" | "MESSAGE_DELETE" | "MESSAGE_DELETE_BULK";
export type NormalizedDiscordTimelineEvent = Omit<TimelineEvent, "eventId" | "observedAt">;

export function resolveTimelineEventIdentity(
    event: NormalizedDiscordTimelineEvent,
    known?: {authorId?: string; authorIsBot?: boolean; authorLabel?: string; channelId: string;}
): NormalizedDiscordTimelineEvent | undefined {
    if (known && known.channelId !== event.channelId) return;
    if (known?.authorId && event.authorId && known.authorId !== event.authorId) return;
    if (event.kind === "edit" && !known?.authorId && !event.authorId) return;
    return {...known,
...event,
        ...(known?.authorId ? {authorId: known.authorId, authorIsBot: known.authorIsBot, authorLabel: known.authorLabel} : {})};
}

export function timelineAuthorPolicyAllows(event: NormalizedDiscordTimelineEvent, filters: SolcordTimelinePolicy["filters"], accountId?: string, blocked = false): boolean {
    if (event.kind === "delete" || event.kind === "bulk-delete") return true;
    if (filters.alwaysLogGhostPings && event.mentionedCurrentUser) return true;
    if ((filters.ignoreSelf || filters.ignoreBots || filters.ignoreBlockedUsers) && !event.authorId) return false;
    if (filters.ignoreSelf && event.authorId === accountId) return false;
    if (filters.ignoreBots && event.authorIsBot !== false) return false;
    return !(filters.ignoreBlockedUsers && blocked);
}

const MAX_CONTENT_CHARS = 64_000;
const MAX_AUTHOR_CHARS = 160;
const MAX_ATTACHMENTS = 20;
export const MAX_TIMELINE_BULK_EVENTS = 500;

const DEFAULT_JOURNAL_LIMITS = Object.freeze({
    records: 20_000,
    seenEvents: 80_000,
    editsPerRecord: 100,
    snapshotRecords: 250,
    estimatedBytes: 262_144_000
});
const RECORD_OVERHEAD_BYTES = 192;
const EDIT_OVERHEAD_BYTES = 24;
const ATTACHMENT_OVERHEAD_BYTES = 48;

export interface TimelineJournalLimits {
    records: number;
    seenEvents: number;
    editsPerRecord: number;
    snapshotRecords: number;
    estimatedBytes: number;
}

export interface TimelineAccountIdentity {
    accountId?: string;
    generation: number;
}

function textBytes(value: string): number {
    return new TextEncoder().encode(value).byteLength;
}

function safeId(value: unknown): string | undefined {
    return typeof value === "string" && /^\d{1,32}$/.test(value) ? value : undefined;
}

export function normalizeTimelineAccountId(value: unknown): string | undefined {
    return safeId(value);
}

export class TimelineAccountGuard {
    #accountId?: string;
    #generation = 0;
    #initialized = false;

    observe(value: unknown): TimelineAccountIdentity {
        const accountId = normalizeTimelineAccountId(value);
        if (!this.#initialized || accountId !== this.#accountId) {
            this.#initialized = true;
            this.#accountId = accountId;
            this.#generation++;
        }
        return {accountId: this.#accountId, generation: this.#generation};
    }

    matches(identity: TimelineAccountIdentity, value: unknown): boolean {
        const current = this.observe(value);
        return current.accountId !== undefined
            && current.accountId === identity.accountId
            && current.generation === identity.generation;
    }
}

export function timelineEventAccountMatches(activeAccountId: string | undefined, currentAccountId: unknown, ready: boolean): currentAccountId is string {
    const current = normalizeTimelineAccountId(currentAccountId);
    return ready && current !== undefined && current === activeAccountId;
}

function safeContent(value: unknown): string {
    return typeof value === "string" ? value.slice(0, MAX_CONTENT_CHARS) : "";
}

function safeAttachments(value: unknown): TimelineAttachmentMetadata[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap(item => {
        if (!item || typeof item !== "object") return [];
        const candidate = item as Record<string, unknown>;
        if (typeof candidate.name !== "string") return [];
        return [{
            name: candidate.name.slice(0, 260),
            ...(typeof candidate.contentType === "string" ? {contentType: candidate.contentType.slice(0, 160)} : {}),
            ...(typeof candidate.size === "number" && Number.isSafeInteger(candidate.size) && candidate.size >= 0 ? {size: candidate.size} : {})
        }];
    }).slice(0, MAX_ATTACHMENTS);
}

function safeDiscordAttachments(value: unknown): TimelineAttachmentMetadata[] {
    if (!Array.isArray(value)) return [];
    return safeAttachments(value.map(item => {
        if (!item || typeof item !== "object") return item;
        const candidate = item as Record<string, unknown>;
        return {
            name: candidate.filename ?? candidate.name,
            contentType: candidate.content_type ?? candidate.contentType,
            size: candidate.size
        };
    }));
}

function discordMessageRecord(payload: Record<string, unknown>): Record<string, unknown> | undefined {
    const nested = payload.message ?? payload.messageRecord;
    if (nested && typeof nested === "object") return nested as Record<string, unknown>;
    return typeof payload.id === "string" && (typeof payload.channel_id === "string" || typeof payload.channelId === "string") ? payload : undefined;
}

/**
 * Normalize only the dispatcher shapes Solcord has reviewed. This deliberately
 * stays source-independent and content-bounded so storage/runtime code does not
 * need to depend on a community message logger or Discord model prototype.
 */
export function normalizeDiscordTimelineDispatch(type: DiscordTimelineDispatchType, value: unknown, currentUserId?: string): NormalizedDiscordTimelineEvent[] {
    if (!value || typeof value !== "object") return [];
    const payload = value as Record<string, unknown>;
    const message = discordMessageRecord(payload);
    const channelId = safeId(message?.channel_id ?? message?.channelId ?? payload.channel_id ?? payload.channelId);

    if (type === "MESSAGE_DELETE_BULK") {
        if (!channelId) return [];
        const rawIds = payload.ids ?? payload.messageIds ?? (Array.isArray(payload.messages)
            ? payload.messages.map(entry => entry && typeof entry === "object" ? (entry as Record<string, unknown>).id : entry)
            : undefined);
        return boundedTimelineMessageIds(rawIds).map(messageId => ({kind: "bulk-delete", messageId, channelId}));
    }

    const messageId = safeId(message?.id ?? payload.id ?? payload.messageId);
    if (!messageId || !channelId) return [];
    if (type === "MESSAGE_DELETE") return [{kind: "delete", messageId, channelId}];
    if (!message) return [];

    const author = message.author && typeof message.author === "object" ? message.author as Record<string, unknown> : undefined;
    const authorId = safeId(author?.id);
    const authorLabel = typeof author?.global_name === "string"
        ? author.global_name
        : typeof author?.globalName === "string"
            ? author.globalName
            : typeof author?.username === "string"
                ? author.username
                : undefined;
    const attachments = safeDiscordAttachments(message.attachments);
    const hasMentionList = Array.isArray(message.mentions);
    const mentions = hasMentionList ? message.mentions as unknown[] : [];
    const mentionedCurrentUser = Boolean(currentUserId && mentions.some(item => {
        if (typeof item === "string") return item === currentUserId;
        return item && typeof item === "object" && (item as Record<string, unknown>).id === currentUserId;
    }));
    return [{
        kind: type === "MESSAGE_CREATE" ? "create" : "edit",
        messageId,
        channelId,
        ...(authorId ? {authorId} : {}),
        ...(authorLabel ? {authorLabel: authorLabel.slice(0, MAX_AUTHOR_CHARS)} : {}),
        ...(authorId && type === "MESSAGE_CREATE" ? {authorIsBot: author?.bot === true} : typeof author?.bot === "boolean" ? {authorIsBot: author.bot} : {}),
        ...(currentUserId && hasMentionList ? {mentionedCurrentUser} : {}),
        ...(typeof message.content === "string" ? {content: safeContent(message.content)} : {}),
        ...(attachments.length ? {attachments} : {})
    }];
}

function retentionCutoff(policy: SolcordTimelinePolicy, now: number): number {
    const duration = {
        "session": 0,
        "24-hours": 24 * 60 * 60 * 1_000,
        "7-days": 7 * 24 * 60 * 60 * 1_000,
        "30-days": 30 * 24 * 60 * 60 * 1_000,
        "90-days": 90 * 24 * 60 * 60 * 1_000,
        "manual": Number.POSITIVE_INFINITY
    }[policy.retention];
    return duration === Number.POSITIVE_INFINITY ? 0 : now - duration;
}

export function channelIsInTimelineScope(channel: {id?: unknown; type?: unknown; guild_id?: unknown;} | undefined, policy: SolcordTimelinePolicy): boolean {
    if (!policy.enabled) return false;
    if (!channel) return false;
    const id = safeId(channel.id);
    if (!id) return false;
    const type = typeof channel.type === "number" ? channel.type : -1;
    if (type === 1 || type === 3) return true;
    return policy.scope === "selected-channels" && policy.serverChannelIds.includes(id);
}

export function normalizeTimelineEvent(value: unknown): TimelineEvent | undefined {
    if (!value || typeof value !== "object") return;
    const candidate = value as Record<string, unknown>;
    const eventId = typeof candidate.eventId === "string" && /^[a-zA-Z0-9_-]{1,96}$/.test(candidate.eventId) ? candidate.eventId : undefined;
    const messageId = safeId(candidate.messageId);
    const channelId = safeId(candidate.channelId);
    const kind = typeof candidate.kind === "string" && ["create", "edit", "delete", "bulk-delete", "recovery"].includes(candidate.kind) ? candidate.kind as TimelineEventKind : undefined;
    if (!eventId || !messageId || !channelId || !kind) return;
    return {
        eventId,
        kind,
        observedAt: typeof candidate.observedAt === "number" && Number.isSafeInteger(candidate.observedAt) && candidate.observedAt >= 0 ? candidate.observedAt : Date.now(),
        messageId,
        channelId,
        ...(safeId(candidate.authorId) ? {authorId: safeId(candidate.authorId)} : {}),
        ...(typeof candidate.authorLabel === "string" ? {authorLabel: candidate.authorLabel.slice(0, MAX_AUTHOR_CHARS)} : {}),
        ...(typeof candidate.authorIsBot === "boolean" ? {authorIsBot: candidate.authorIsBot} : {}),
        ...(typeof candidate.mentionedCurrentUser === "boolean" ? {mentionedCurrentUser: candidate.mentionedCurrentUser} : {}),
        ...(typeof candidate.content === "string" ? {content: safeContent(candidate.content)} : {}),
        ...(Array.isArray(candidate.attachments) ? {attachments: safeAttachments(candidate.attachments)} : {})
    };
}

export function boundedTimelineMessageIds(value: unknown, limit = MAX_TIMELINE_BULK_EVENTS): string[] {
    const values = Array.isArray(value) ? value : value instanceof Set ? [...value] : undefined;
    if (!values) return [];
    const boundedLimit = Math.min(MAX_TIMELINE_BULK_EVENTS, Math.max(0, Math.floor(Number.isFinite(limit) ? limit : MAX_TIMELINE_BULK_EVENTS)));
    if (boundedLimit === 0) return [];
    const ids = new Set<string>();
    for (const valueId of values) {
        const id = safeId(valueId);
        if (!id) continue;
        ids.add(id);
        if (ids.size >= boundedLimit) break;
    }
    return [...ids];
}

function boundedPositiveInteger(value: unknown, maximum: number): number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : maximum;
}

function stateTextBytes(state: TimelineMessageState): number {
    return textBytes(state.content) + state.edits.reduce((sum, edit) => sum + textBytes(edit.content), 0);
}

function estimatedStateBytes(state: TimelineMessageState): number {
    let used = RECORD_OVERHEAD_BYTES;
    used += textBytes(state.messageId);
    used += textBytes(state.channelId);
    used += textBytes(state.authorId ?? "");
    used += textBytes(state.authorLabel ?? "");
    used += stateTextBytes(state);
    used += state.edits.length * EDIT_OVERHEAD_BYTES;
    for (const attachment of state.attachments) {
        used += ATTACHMENT_OVERHEAD_BYTES;
        used += textBytes(attachment.name);
        used += textBytes(attachment.contentType ?? "");
    }
    return used;
}

export class MessageTimelineJournal {
    #messages = new Map<string, TimelineMessageState>();
    #seenEvents = new Map<string, string>();
    #eventsByMessage = new Map<string, Set<string>>();
    #textBytes = 0;
    #estimatedBytes = 0;
    #limits: TimelineJournalLimits;
    #batching = false;
    #viewCache?: {key: string; value: readonly TimelineMessageState[];};
    #recordViews = new WeakMap<TimelineMessageState, TimelineMessageState>();
    #statusCache?: {records: number; deleted: number; edited: number; ghostPings: number; textBytes: number;};

    constructor(limits: Partial<TimelineJournalLimits> = {}) {
        this.#limits = {
            records: boundedPositiveInteger(limits.records, DEFAULT_JOURNAL_LIMITS.records),
            seenEvents: boundedPositiveInteger(limits.seenEvents, DEFAULT_JOURNAL_LIMITS.seenEvents),
            editsPerRecord: boundedPositiveInteger(limits.editsPerRecord, DEFAULT_JOURNAL_LIMITS.editsPerRecord),
            snapshotRecords: boundedPositiveInteger(limits.snapshotRecords, DEFAULT_JOURNAL_LIMITS.snapshotRecords),
            estimatedBytes: boundedPositiveInteger(limits.estimatedBytes, DEFAULT_JOURNAL_LIMITS.estimatedBytes)
        };
    }

    hydrate(events: TimelineEvent[], policy: SolcordTimelinePolicy, now = Date.now()): void {
        this.clear();
        const ordered = events
            .map((event, index) => ({event: normalizeTimelineEvent(event), index}))
            .filter((entry): entry is {event: TimelineEvent; index: number;} => Boolean(entry.event))
            .sort((left, right) => left.event.observedAt - right.event.observedAt || left.index - right.index);
        this.applyBatch(ordered.map(({event}) => event), policy, now);
    }

    /** Replay and bulk dispatch prune once, rather than scanning N records N times. */
    applyBatch(events: readonly TimelineEvent[], policy: SolcordTimelinePolicy, now = Date.now()): TimelineEvent[] {
        this.#batching = true;
        let changed: TimelineEvent[];
        try {changed = events.filter(event => this.apply(event, policy, now));}
        finally {this.#batching = false; this.prune(policy, now);}
        return changed;
    }

    apply(raw: TimelineEvent, policy: SolcordTimelinePolicy, now = Date.now()): boolean {
        const event = normalizeTimelineEvent(raw);
        if (!event || this.#eventWasSeen(event.eventId)) return false;
        const current = this.#messages.get(event.messageId);
        let changed = false;

        if (event.kind === "create") {
            if (current) this.#deleteMessage(event.messageId);
            this.#setMessage({
                messageId: event.messageId,
                channelId: event.channelId,
                authorId: event.authorId,
                authorLabel: event.authorLabel,
                authorIsBot: event.authorIsBot === true,
                mentionedCurrentUser: event.mentionedCurrentUser === true,
                content: safeContent(event.content),
                createdAt: event.observedAt,
                updatedAt: event.observedAt,
                edits: [],
                attachments: policy.content === "text-only" ? [] : safeAttachments(event.attachments)
            });
            changed = true;
        }
        else if (event.kind === "edit" && current) {
            const previousTextBytes = stateTextBytes(current);
            const previousEstimatedBytes = estimatedStateBytes(current);
            if (event.content !== undefined && event.content !== current.content) current.edits.push({at: event.observedAt, content: current.content});
            if (current.edits.length > this.#limits.editsPerRecord) current.edits.splice(0, current.edits.length - this.#limits.editsPerRecord);
            if (event.content !== undefined) current.content = safeContent(event.content);
            if (event.mentionedCurrentUser !== undefined) {
                if (current.mentionedCurrentUser && !event.mentionedCurrentUser) current.ghostPingAt = event.observedAt;
                current.mentionedCurrentUser = event.mentionedCurrentUser;
            }
            if (event.attachments) current.attachments = policy.content === "text-only" ? [] : safeAttachments(event.attachments);
            current.updatedAt = event.observedAt;
            this.#touchMessage(current, previousTextBytes, previousEstimatedBytes);
            changed = true;
        }
        else if ((event.kind === "delete" || event.kind === "bulk-delete") && current) {
            const previousTextBytes = stateTextBytes(current);
            const previousEstimatedBytes = estimatedStateBytes(current);
            current.deletedAt = event.observedAt;
            current.purged = event.kind === "bulk-delete";
            if (current.mentionedCurrentUser) current.ghostPingAt = event.observedAt;
            current.updatedAt = event.observedAt;
            this.#touchMessage(current, previousTextBytes, previousEstimatedBytes);
            changed = true;
        }
        else if (event.kind === "recovery" && current) {
            const previousTextBytes = stateTextBytes(current);
            const previousEstimatedBytes = estimatedStateBytes(current);
            current.updatedAt = Math.max(current.updatedAt, event.observedAt);
            this.#touchMessage(current, previousTextBytes, previousEstimatedBytes);
            changed = true;
        }

        if (!changed) return false;
        this.#rememberEvent(event.eventId, event.messageId);
        if (!this.#batching) this.prune(policy, now);
        return this.#messages.has(event.messageId);
    }

    prune(policy: SolcordTimelinePolicy, now = Date.now()): number {
        const before = this.#messages.size;
        if (policy.retention !== "session") {
            const cutoff = retentionCutoff(policy, now);
            for (const [id, state] of this.#messages) if (state.updatedAt < cutoff) this.#deleteMessage(id);
        }

        const requestedBudget = Number(policy.textBudgetBytes);
        const textBudgetBytes = Number.isFinite(requestedBudget)
            ? Math.min(262_144_000, Math.max(0, Math.floor(requestedBudget)))
            : 262_144_000;
        while (this.#messages.size > this.#limits.records || this.#textBytes > textBudgetBytes || this.#estimatedBytes > this.#limits.estimatedBytes) {
            const oldest = this.#messages.keys().next().value as string | undefined;
            if (!oldest) break;
            this.#deleteMessage(oldest);
        }
        return before - this.#messages.size;
    }

    snapshot(channelId?: string, requestedLimit = this.#limits.snapshotRecords): TimelineMessageState[] {
        return this.view(channelId, requestedLimit).map(state => structuredClone(state));
    }

    /** Immutable, revision-stable selector for the UI; snapshot() remains defensive. */
    view(channelId?: string, requestedLimit = this.#limits.snapshotRecords): readonly TimelineMessageState[] {
        const limit = boundedPositiveInteger(requestedLimit, this.#limits.snapshotRecords);
        const key = `${channelId ?? ""}:${limit}`;
        if (this.#viewCache?.key === key) return this.#viewCache.value;
        const value = Object.freeze([...this.#messages.values()]
            .filter(state => !channelId || state.channelId === channelId)
            .sort((left, right) => right.updatedAt - left.updatedAt)
            .slice(0, limit)
            .map(state => {
                const cached = this.#recordViews.get(state);
                if (cached) return cached;
                const copy = structuredClone(state);
                copy.edits.forEach(Object.freeze);
                copy.attachments.forEach(Object.freeze);
                Object.freeze(copy.edits);
                Object.freeze(copy.attachments);
                Object.freeze(copy);
                this.#recordViews.set(state, copy);
                return copy;
            }));
        this.#viewCache = {key, value};
        return value;
    }

    has(messageId: string): boolean {
        return this.#messages.has(messageId);
    }

    identity(messageId: string): Pick<TimelineMessageState, "authorId" | "authorIsBot" | "authorLabel" | "channelId"> | undefined {
        const state = this.#messages.get(messageId);
        return state ? {authorId: state.authorId, authorIsBot: state.authorIsBot, authorLabel: state.authorLabel, channelId: state.channelId} : undefined;
    }

    status(): {records: number; deleted: number; edited: number; ghostPings: number; textBytes: number;} {
        if (this.#statusCache) return this.#statusCache;
        let deleted = 0;
        let edited = 0;
        let ghostPings = 0;
        for (const state of this.#messages.values()) {
            if (state.deletedAt !== undefined) deleted++;
            if (state.edits.length > 0) edited++;
            if (state.ghostPingAt !== undefined) ghostPings++;
        }
        return this.#statusCache = Object.freeze({
            records: this.#messages.size,
            deleted,
            edited,
            ghostPings,
            textBytes: this.#textBytes
        });
    }

    clear(): void {
        this.#invalidateViews();
        this.#recordViews = new WeakMap();
        this.#messages.clear();
        this.#seenEvents.clear();
        this.#eventsByMessage.clear();
        this.#textBytes = 0;
        this.#estimatedBytes = 0;
    }

    #setMessage(state: TimelineMessageState): void {
        this.#invalidateViews();
        this.#messages.set(state.messageId, state);
        this.#textBytes += stateTextBytes(state);
        this.#estimatedBytes += estimatedStateBytes(state);
    }

    #touchMessage(state: TimelineMessageState, previousTextBytes: number, previousEstimatedBytes: number): void {
        this.#invalidateViews();
        this.#recordViews.delete(state);
        this.#textBytes += stateTextBytes(state) - previousTextBytes;
        this.#estimatedBytes += estimatedStateBytes(state) - previousEstimatedBytes;
        this.#messages.delete(state.messageId);
        this.#messages.set(state.messageId, state);
    }

    #deleteMessage(messageId: string): void {
        this.#invalidateViews();
        const state = this.#messages.get(messageId);
        if (state) {
            this.#textBytes = Math.max(0, this.#textBytes - stateTextBytes(state));
            this.#estimatedBytes = Math.max(0, this.#estimatedBytes - estimatedStateBytes(state));
            this.#messages.delete(messageId);
        }
        const eventIds = this.#eventsByMessage.get(messageId);
        if (eventIds) for (const eventId of eventIds) this.#seenEvents.delete(eventId);
        this.#eventsByMessage.delete(messageId);
    }

    #invalidateViews(): void {this.#viewCache = undefined; this.#statusCache = undefined;}

    #eventWasSeen(eventId: string): boolean {
        const messageId = this.#seenEvents.get(eventId);
        if (!messageId) return false;
        this.#seenEvents.delete(eventId);
        this.#seenEvents.set(eventId, messageId);
        return true;
    }

    #rememberEvent(eventId: string, messageId: string): void {
        this.#seenEvents.set(eventId, messageId);
        const messageEvents = this.#eventsByMessage.get(messageId) ?? new Set<string>();
        messageEvents.add(eventId);
        this.#eventsByMessage.set(messageId, messageEvents);
        while (this.#seenEvents.size > this.#limits.seenEvents) {
            const oldest = this.#seenEvents.entries().next().value as [string, string] | undefined;
            if (!oldest) break;
            this.#seenEvents.delete(oldest[0]);
            const events = this.#eventsByMessage.get(oldest[1]);
            events?.delete(oldest[0]);
            if (!events?.size) this.#eventsByMessage.delete(oldest[1]);
        }
    }
}
