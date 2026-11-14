import {describe, expect, test} from "bun:test";

import type {SolcordTimelinePolicy} from "../../src/betterdiscord/modules/solcord/contracts";
import {
    boundedTimelineMessageIds,
    channelIsInTimelineScope,
    describeTimelineConversation,
    MessageTimelineJournal,
    normalizeDiscordTimelineDispatch,
    normalizeTimelineAccountId,
    normalizeTimelineEvent,
    TimelineAccountGuard,
    timelineEventAccountMatches,
    timelineMessageVersions,
    type TimelineEvent
} from "../../src/betterdiscord/modules/solcord/message-timeline";


const DAY = 24 * 60 * 60 * 1_000;

function policy(overrides: Partial<SolcordTimelinePolicy> = {}): SolcordTimelinePolicy {
    return {
        enabled: true,
        scope: "dm-only",
        serverChannelIds: [],
        retention: "7-days",
        content: "text-only",
        textBudgetBytes: 262_144_000,
        mediaBudgetBytes: 1_073_741_824,
        ...overrides
    } as SolcordTimelinePolicy;
}

function event(eventId: string, kind: TimelineEvent["kind"], observedAt: number, messageId = "100", content?: string): TimelineEvent {
    return {eventId, kind, observedAt, messageId, channelId: "200", ...(content === undefined ? {} : {content})};
}

describe("Message Timeline model", () => {
    test("accepts events only for the ready active account and rejects switch windows", () => {
        expect(normalizeTimelineAccountId("123456789012345678")).toBe("123456789012345678");
        expect(normalizeTimelineAccountId("../123")).toBeUndefined();
        expect(timelineEventAccountMatches("123", "123", true)).toBeTrue();
        expect(timelineEventAccountMatches("123", "456", true)).toBeFalse();
        expect(timelineEventAccountMatches("123", "123", false)).toBeFalse();
        expect(timelineEventAccountMatches(undefined, undefined, true)).toBeFalse();
    });

    test("invalidates a captured account generation across a delayed account switch", async () => {
        const guard = new TimelineAccountGuard();
        let currentAccount: string | undefined = "123";
        const captured = guard.observe(currentAccount);
        expect(guard.matches(captured, currentAccount)).toBeTrue();

        const delayedValidation = (async () => {
            await Promise.resolve();
            return guard.matches(captured, currentAccount);
        })();
        currentAccount = "456";

        expect(await delayedValidation).toBeFalse();
        const switched = guard.observe(currentAccount);
        expect(switched.generation).toBeGreaterThan(captured.generation);
        expect(guard.matches(switched, currentAccount)).toBeTrue();
        currentAccount = undefined;
        expect(guard.matches(switched, currentAccount)).toBeFalse();
    });

    test("includes only enabled DM/GDM scope or explicitly selected server channels", () => {
        expect(channelIsInTimelineScope({id: "1", type: 1}, policy({enabled: false}))).toBeFalse();
        expect(channelIsInTimelineScope({id: "1", type: 1}, policy())).toBeTrue();
        expect(channelIsInTimelineScope({id: "2", type: 3}, policy())).toBeTrue();
        expect(channelIsInTimelineScope({id: "3", type: 0, guild_id: "9"}, policy())).toBeFalse();
        expect(channelIsInTimelineScope({id: "3", type: 0, guild_id: "9"}, policy({scope: "selected-channels", serverChannelIds: ["3"]}))).toBeTrue();
        expect(channelIsInTimelineScope({id: "4", type: 0, guild_id: "9"}, policy({scope: "selected-channels", serverChannelIds: ["3"]}))).toBeFalse();
        expect(channelIsInTimelineScope({id: "not-a-snowflake", type: 1}, policy())).toBeFalse();
        expect(channelIsInTimelineScope(undefined, policy())).toBeFalse();
    });

    test("normalizes bounded local-only event fields and rejects malformed identities", () => {
        const normalized = normalizeTimelineEvent({
            eventId: "event_OK-1",
            kind: "create",
            observedAt: 10,
            messageId: "123",
            channelId: "456",
            authorLabel: "a".repeat(200),
            content: "x".repeat(70_000),
            attachments: Array.from({length: 25}, (_, index) => ({name: `file-${index}`.repeat(80), contentType: "image/png", size: index}))
        });

        expect(normalized?.authorLabel).toHaveLength(160);
        expect(normalized?.content).toHaveLength(64_000);
        expect(normalized?.attachments).toHaveLength(20);
        expect(normalized?.attachments?.[0].name.length).toBeLessThanOrEqual(260);
        expect(normalizeTimelineEvent({eventId: "bad id", kind: "create", messageId: "1", channelId: "2"})).toBeUndefined();
        expect(normalizeTimelineEvent({eventId: "ok", kind: "unknown", messageId: "1", channelId: "2"})).toBeUndefined();
        expect(normalizeTimelineEvent({eventId: "ok", kind: "create", messageId: "../1", channelId: "2"})).toBeUndefined();
        expect(normalizeTimelineEvent(null)).toBeUndefined();
    });

    test("normalizes current and legacy Discord dispatcher shapes without a logger dependency", () => {
        expect(normalizeDiscordTimelineDispatch("MESSAGE_CREATE", {message: {
            id: "101",
            channelId: "201",
            content: "hello",
            author: {globalName: "Display name"},
            attachments: [{filename: "note.txt", content_type: "text/plain", size: 12}]
        }})).toEqual([{
            kind: "create",
            messageId: "101",
            channelId: "201",
            authorLabel: "Display name",
            content: "hello",
            attachments: [{name: "note.txt", contentType: "text/plain", size: 12}]
        }]);
        expect(normalizeDiscordTimelineDispatch("MESSAGE_UPDATE", {
            messageRecord: {id: "101", content: "edited", author: {global_name: "Legacy"}},
            channel_id: "201"
        })).toEqual([{kind: "edit", messageId: "101", channelId: "201", authorLabel: "Legacy", content: "edited"}]);
        expect(normalizeDiscordTimelineDispatch("MESSAGE_DELETE", {message: {id: "101", channel_id: "201"}})).toEqual([{kind: "delete", messageId: "101", channelId: "201"}]);
        expect(normalizeDiscordTimelineDispatch("MESSAGE_DELETE_BULK", {channelId: "201", ids: new Set(["101", "102", "../bad"])})).toEqual([
            {kind: "bulk-delete", messageId: "101", channelId: "201"},
            {kind: "bulk-delete", messageId: "102", channelId: "201"}
        ]);
        expect(normalizeDiscordTimelineDispatch("MESSAGE_CREATE", {message: {id: "../bad", channel_id: "201"}})).toEqual([]);
        expect(normalizeDiscordTimelineDispatch("MESSAGE_DELETE", null)).toEqual([]);
    });

    test("hydrates out-of-order observations chronologically and preserves edit/delete/recovery order", () => {
        const journal = new MessageTimelineJournal();
        journal.hydrate([
            event("recover", "recovery", 40),
            event("delete", "delete", 30),
            event("edit", "edit", 20, "100", "second"),
            event("create", "create", 10, "100", "first")
        ], policy(), 50);

        expect(journal.snapshot()).toEqual([expect.objectContaining({
            messageId: "100",
            content: "second",
            createdAt: 10,
            updatedAt: 40,
            deletedAt: 30,
            edits: [{at: 20, content: "first"}]
        })]);
        expect(journal.status()).toEqual({records: 1, deleted: 1, edited: 1, ghostPings: 0, textBytes: 11});
    });

    test("preserves author facts and marks observed ghost pings without treating partial edits as mention removal", () => {
        const userId = "999";
        expect(normalizeDiscordTimelineDispatch("MESSAGE_CREATE", {message: {
            id: "101",
            channel_id: "201",
            content: "hello",
            author: {id: "123", username: "Helper", bot: true},
            mentions: [{id: userId}]
        }}, userId)).toEqual([{
            kind: "create",
            messageId: "101",
            channelId: "201",
            authorId: "123",
            authorLabel: "Helper",
            authorIsBot: true,
            mentionedCurrentUser: true,
            content: "hello"
        }]);
        expect(normalizeDiscordTimelineDispatch("MESSAGE_UPDATE", {
            message: {id: "101", channel_id: "201", content: "partial update"}
        }, userId)).toEqual([{
            kind: "edit",
            messageId: "101",
            channelId: "201",
            content: "partial update"
        }]);

        const journal = new MessageTimelineJournal();
        journal.apply({
            eventId: "create-mentioned",
            kind: "create",
            observedAt: 1,
            messageId: "101",
            channelId: "201",
            authorId: "123",
            authorIsBot: true,
            mentionedCurrentUser: true,
            content: "hello"
        }, policy(), 1);
        journal.apply({
            eventId: "partial-edit",
            kind: "edit",
            observedAt: 2,
            messageId: "101",
            channelId: "201",
            content: "still mentioned"
        }, policy(), 2);
        expect(journal.snapshot()[0]).toMatchObject({mentionedCurrentUser: true, authorId: "123", authorIsBot: true});
        expect(journal.status().ghostPings).toBe(0);

        journal.apply({
            eventId: "mention-removed",
            kind: "edit",
            observedAt: 3,
            messageId: "101",
            channelId: "201",
            mentionedCurrentUser: false,
            content: "mention removed"
        }, policy(), 3);
        expect(journal.snapshot()[0]).toMatchObject({mentionedCurrentUser: false, ghostPingAt: 3});
        expect(journal.status().ghostPings).toBe(1);
    });

    test("applies create, edit, delete, and bulk-delete idempotently", () => {
        const journal = new MessageTimelineJournal();
        const activePolicy = policy();
        expect(journal.apply(event("edit-missing", "edit", 1, "999", "ignored"), activePolicy, 1)).toBeFalse();
        expect(journal.apply(event("create-1", "create", 2, "100", "one"), activePolicy, 2)).toBeTrue();
        expect(journal.apply(event("create-1", "create", 2, "100", "changed"), activePolicy, 2)).toBeFalse();
        expect(journal.apply(event("create-2", "create", 3, "101", "two"), activePolicy, 3)).toBeTrue();
        expect(journal.apply(event("bulk-1", "bulk-delete", 4, "100"), activePolicy, 4)).toBeTrue();
        expect(journal.apply(event("bulk-2", "bulk-delete", 4, "101"), activePolicy, 4)).toBeTrue();
        expect(journal.snapshot().every(item => item.deletedAt === 4)).toBeTrue();
    });

    test("bounds bulk message expansion, removes malformed ids, and deduplicates", () => {
        const ids = Array.from({length: 800}, (_, index) => String(index + 1));
        ids.splice(10, 0, "1", "../2", "not-a-snowflake");
        const bounded = boundedTimelineMessageIds(ids);
        expect(bounded).toHaveLength(500);
        expect(bounded[0]).toBe("1");
        expect(new Set(bounded).size).toBe(bounded.length);
        expect(bounded).not.toContain("../2");
        expect(boundedTimelineMessageIds(ids, 0)).toEqual([]);
        expect(boundedTimelineMessageIds(new Set(["3", "3", "4"]))).toEqual(["3", "4"]);
    });

    test("hard-bounds zero-text records, edit history, dedupe state, and snapshot work", () => {
        const journal = new MessageTimelineJournal({records: 3, seenEvents: 4, editsPerRecord: 2, snapshotRecords: 2, estimatedBytes: 4_096});
        const activePolicy = policy({retention: "session"});
        for (let index = 1; index <= 10; index++) {
            expect(journal.apply(event(`create-${index}`, "create", index, String(100 + index), ""), activePolicy, index)).toBeTrue();
        }

        expect(journal.status()).toMatchObject({records: 3, textBytes: 0});
        expect(journal.snapshot().map(item => item.messageId)).toEqual(["110", "109"]);

        expect(journal.apply(event("unknown-event", "delete", 20, "999"), activePolicy, 20)).toBeFalse();
        expect(journal.apply(event("unknown-event", "create", 21, "111", ""), activePolicy, 21)).toBeTrue();
        for (let index = 0; index < 8; index++) journal.apply(event(`edit-${index}`, "edit", 30 + index, "111", index % 2 ? "" : "x"), activePolicy, 40);
        expect(journal.snapshot(undefined, 10).find(item => item.messageId === "111")?.edits).toHaveLength(2);
        expect(journal.status().records).toBeLessThanOrEqual(3);
    });

    test("accounts for attachment metadata in the renderer memory budget", () => {
        const limits = {records: 10, seenEvents: 20, editsPerRecord: 5, snapshotRecords: 10, estimatedBytes: 320};
        const withMetadata = new MessageTimelineJournal(limits);
        const textOnly = new MessageTimelineJournal(limits);
        const attachment = {name: "x".repeat(260), contentType: "application/octet-stream", size: 42};
        const create: TimelineEvent = {...event("metadata", "create", 1, "100", ""), attachments: [attachment]};

        expect(withMetadata.apply(create, policy({content: "text-and-metadata"}), 1)).toBeFalse();
        expect(withMetadata.status().records).toBe(0);
        expect(textOnly.apply(create, policy({content: "text-only"}), 1)).toBeTrue();
        expect(textOnly.status().records).toBe(1);
    });

    test("prunes expired records while retaining the cutoff boundary", () => {
        const now = 10 * DAY;
        const journal = new MessageTimelineJournal();
        const oneDay = policy({retention: "24-hours"});
        journal.hydrate([
            event("expired", "create", now - DAY - 1, "100", "expired"),
            event("boundary", "create", now - DAY, "101", "boundary"),
            event("recent", "create", now - 1, "102", "recent")
        ], oneDay, now);

        expect(journal.snapshot().map(item => item.messageId)).toEqual(["102", "101"]);
    });

    test("enforces the text hard cap even for session retention and counts UTF-8 bytes", () => {
        const journal = new MessageTimelineJournal();
        const tinySessionBudget = policy({retention: "session", textBudgetBytes: 5 as SolcordTimelinePolicy["textBudgetBytes"]});
        expect(journal.apply(event("old", "create", 1, "100", "old"), tinySessionBudget, 2)).toBeTrue();
        expect(journal.apply(event("new", "create", 2, "101", "éé"), tinySessionBudget, 2)).toBeTrue();

        expect(journal.snapshot().map(item => item.messageId)).toEqual(["101"]);
        expect(journal.status().textBytes).toBe(4);
    });

    test("stores attachment metadata only when the selected content policy permits it", () => {
        const attachment = {name: "image.png", contentType: "image/png", size: 42};
        const create: TimelineEvent = {...event("create", "create", 1, "100", "hello"), attachments: [attachment]};
        const textOnly = new MessageTimelineJournal();
        const withMetadata = new MessageTimelineJournal();

        textOnly.apply(create, policy({content: "text-only"}), 1);
        withMetadata.apply(create, policy({content: "text-and-metadata"}), 1);
        expect(textOnly.snapshot()[0].attachments).toEqual([]);
        expect(withMetadata.snapshot()[0].attachments).toEqual([attachment]);
    });

    test("a repeated create for a known message keeps its edit history and deleted state", () => {
        const journal = new MessageTimelineJournal();
        const activePolicy = policy({retention: "manual"});
        journal.apply(event("create", "create", 1, "100", "first"), activePolicy, 1);
        journal.apply(event("edit", "edit", 2, "100", "second"), activePolicy, 2);
        // A reconnect replay or seed race repeats the create with the current text.
        expect(journal.apply(event("replayed-create", "create", 3, "100", "second"), activePolicy, 3)).toBeFalse();
        expect(journal.snapshot()[0]).toMatchObject({content: "second", edits: [{at: 2, content: "first"}]});

        journal.apply(event("delete", "delete", 4, "100"), activePolicy, 4);
        expect(journal.apply(event("late-create", "create", 5, "100", "resurrected?"), activePolicy, 5)).toBeFalse();
        expect(journal.snapshot()[0]).toMatchObject({content: "second", deletedAt: 4, edits: [{at: 2, content: "first"}]});

        // A create carrying different text than the record is an observed change.
        journal.apply(event("create-b", "create", 6, "101", "alpha"), activePolicy, 6);
        expect(journal.apply(event("create-b-again", "create", 7, "101", "beta"), activePolicy, 7)).toBeTrue();
        expect(journal.snapshot().find(item => item.messageId === "101")).toMatchObject({content: "beta", edits: [{at: 7, content: "alpha"}], createdAt: 6});
    });

    test("retention counts from first capture so a session never shows what a restart cannot restore", () => {
        const sevenDays = policy({retention: "7-days"});
        const created = 100 * DAY;
        const journal = new MessageTimelineJournal();
        journal.apply(event("create", "create", created, "100", "kept briefly"), sevenDays, created);
        journal.apply(event("delete", "delete", created + 6 * DAY, "100"), sevenDays, created + 6 * DAY);
        expect(journal.status().deleted).toBe(1);
        // The native store expires the create event by its own capture time; the
        // journal must drop the record at the same moment instead of 6 days later.
        expect(journal.prune(sevenDays, created + 7 * DAY + 1)).toBe(1);
        expect(journal.status().records).toBe(0);

        const restarted = new MessageTimelineJournal();
        restarted.hydrate([event("delete", "delete", created + 6 * DAY, "100")], sevenDays, created + 7 * DAY + 1);
        expect(restarted.status().records).toBe(0);
    });

    test("budget eviction removes the oldest-captured record first, like the native store", () => {
        const journal = new MessageTimelineJournal({records: 2});
        const activePolicy = policy({retention: "manual"});
        journal.apply(event("old", "create", 1, "100", "old"), activePolicy, 1);
        journal.apply(event("mid", "create", 2, "101", "mid"), activePolicy, 2);
        journal.apply(event("old-delete", "delete", 3, "100"), activePolicy, 3);
        journal.apply(event("new", "create", 4, "102", "new"), activePolicy, 4);
        expect(journal.snapshot().map(item => item.messageId).sort()).toEqual(["101", "102"]);
    });

    test("history queries cover every retained record, not only the newest snapshot window", () => {
        const journal = new MessageTimelineJournal();
        const activePolicy = policy({retention: "manual"});
        const events: TimelineEvent[] = [];
        for (let index = 0; index < 600; index++) events.push({...event(`c-${index}`, "create", index + 1, String(1_000 + index), `message ${index}`), channelId: index % 2 ? "201" : "200"});
        events.push({...event("delete-old", "delete", 700, "1003"), channelId: "201"});
        events.push({...event("edit-old", "edit", 701, "1005", "message 5 corrected"), channelId: "201"});
        events.push({...event("bulk-old", "bulk-delete", 702, "1007"), channelId: "201"});
        events.push({...event("ghost", "create", 703, "2000", "@you"), mentionedCurrentUser: true});
        events.push({...event("ghost-delete", "delete", 704, "2000")});
        for (let index = 0; index < 300; index++) events.push(event(`late-${index}`, "create", 800 + index, String(3_000 + index), `later ${index}`));
        journal.hydrate(events, activePolicy, 2_000);

        // The legacy 250-record view is entirely newer messages and misses every change.
        expect(journal.view().some(item => item.deletedAt !== undefined || item.edits.length > 0)).toBeFalse();
        const changes = journal.query({filter: "changes"});
        expect(changes.entries.map(item => item.messageId)).toEqual(["2000", "1007", "1005", "1003"]);
        expect(changes.counts).toEqual({all: 901, changes: 4, deleted: 3, edited: 1, ghostPings: 1});
        expect(journal.query({filter: "deleted", includePurged: false}).entries.map(item => item.messageId)).toEqual(["2000", "1003"]);
        expect(journal.query({filter: "edited"}).entries.map(item => item.messageId)).toEqual(["1005"]);
        expect(journal.query({filter: "ghost-pings"}).entries.map(item => item.messageId)).toEqual(["2000"]);
        expect(journal.query({filter: "changes", channelId: "201"}).entries.map(item => item.messageId)).toEqual(["1007", "1005", "1003"]);
        expect(journal.query({filter: "changes", channelId: "200"}).entries.map(item => item.messageId)).toEqual(["2000"]);
        expect(journal.query({filter: "all", search: "CORRECTED"}).entries.map(item => item.messageId)).toEqual(["1005"]);
        expect(journal.query({filter: "all", search: "message 5"}).entries.map(item => item.messageId)).toContain("1005");
        expect(journal.query({filter: "changes", order: "oldest"}).entries.map(item => item.messageId)).toEqual(["1003", "1005", "1007", "2000"]);

        const firstPage = journal.query({filter: "all", limit: 50});
        expect(firstPage.entries).toHaveLength(50);
        expect(firstPage.matched).toBe(901);
        expect(journal.query({filter: "all", limit: 50})).toBe(firstPage);
        const larger = journal.query({filter: "all", limit: 100});
        expect(larger.entries.slice(0, 50)).toEqual([...firstPage.entries]);
        expect(larger.entries[0]).toBe(firstPage.entries[0]);
        expect(Object.isFrozen(larger.entries[0])).toBeTrue();
        expect(journal.query({filter: "all", limit: 50_000}).entries).toHaveLength(901);

        journal.apply(event("delete-new", "delete", 2_001, "3299"), activePolicy, 2_001);
        const after = journal.query({filter: "all", limit: 50});
        expect(after).not.toBe(firstPage);
        expect(journal.query({filter: "changes"}).counts.deleted).toBe(4);
    });

    test("edit history is presented as versions with the time each version was first seen", () => {
        const journal = new MessageTimelineJournal({editsPerRecord: 2});
        const activePolicy = policy({retention: "manual"});
        journal.apply(event("create", "create", 10, "100", "v1"), activePolicy, 10);
        journal.apply(event("edit-1", "edit", 20, "100", "v2"), activePolicy, 20);
        expect(timelineMessageVersions(journal.snapshot()[0])).toEqual([
            {content: "v1", observedAt: 10, kind: "original"},
            {content: "v2", observedAt: 20, kind: "current"}
        ]);
        journal.apply(event("edit-2", "edit", 30, "100", "v3"), activePolicy, 30);
        expect(timelineMessageVersions(journal.snapshot()[0])).toEqual([
            {content: "v1", observedAt: 10, kind: "original"},
            {content: "v2", observedAt: 20, kind: "edit"},
            {content: "v3", observedAt: 30, kind: "current"}
        ]);
        journal.apply(event("edit-3", "edit", 40, "100", "v4"), activePolicy, 40);
        const trimmed = journal.snapshot()[0];
        expect(trimmed.editsTrimmed).toBeTrue();
        expect(timelineMessageVersions(trimmed)).toEqual([
            {content: "v2", kind: "earliest-kept"},
            {content: "v3", observedAt: 30, kind: "edit"},
            {content: "v4", observedAt: 40, kind: "current"}
        ]);
        expect(timelineMessageVersions({content: "only", createdAt: 5, edits: []})).toEqual([{content: "only", observedAt: 5, kind: "current"}]);
    });

    test("conversation labels come from live stores and fail closed when unavailable", () => {
        const names = new Map([["11", "Ana"], ["12", "Ben"], ["13", "Cy"], ["14", "Dee"]]);
        const userName = (id: string) => names.get(id);
        expect(describeTimelineConversation({channel: {id: "1", type: 1, recipients: ["11"]}, userName})).toEqual({kind: "dm", label: "Direct message · Ana"});
        expect(describeTimelineConversation({channel: {id: "1", type: 1, rawRecipients: [{id: "12"}]}, userName})).toEqual({kind: "dm", label: "Direct message · Ben"});
        expect(describeTimelineConversation({channel: {id: "2", type: 3, name: "", recipients: ["11", "12", "13", "14"]}, userName})).toEqual({kind: "group", label: "Group DM · Ana, Ben, Cy +1"});
        expect(describeTimelineConversation({channel: {id: "2", type: 3, name: "Trip", recipients: []}, userName})).toEqual({kind: "group", label: "Group DM · Trip"});
        expect(describeTimelineConversation({channel: {id: "3", type: 0, name: "general", guild_id: "9"}, guildName: () => "Home"})).toEqual({kind: "server", guildId: "9", label: "#general · Home"});
        expect(describeTimelineConversation({channel: {id: "3", type: 0, name: "general", guild_id: "9"}, guildName: () => {throw new Error("store drift");}})).toEqual({kind: "server", guildId: "9", label: "#general"});
        expect(describeTimelineConversation({channel: {id: "1", type: 1, recipients: ["11"]}, userName: () => {throw new Error("store drift");}})).toEqual({kind: "dm", label: "Direct message"});
        expect(describeTimelineConversation({channel: undefined})).toEqual({kind: "unknown", label: "Conversation not loaded"});
        expect(describeTimelineConversation({channel: {id: "../1", type: 1}})).toEqual({kind: "unknown", label: "Conversation not loaded"});
    });

    test("returns defensive snapshots and clear resets records and event idempotency", () => {
        const journal = new MessageTimelineJournal();
        const create = event("create", "create", 1, "100", "original");
        journal.apply(create, policy(), 1);
        const snapshot = journal.snapshot();
        snapshot[0].content = "mutated";
        expect(journal.snapshot()[0].content).toBe("original");

        journal.clear();
        expect(journal.status().records).toBe(0);
        expect(journal.apply(create, policy(), 1)).toBeTrue();
        expect(journal.has("100")).toBeTrue();
    });
});
