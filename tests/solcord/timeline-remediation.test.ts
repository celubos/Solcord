import {describe, expect, spyOn, test} from "bun:test";
import {chunkTimelineEvents, drainTimelineChunks, fitTimelineEventBytes, timelineSerializedBytes, TIMELINE_MAX_APPEND_BYTES, TIMELINE_MAX_EVENT_BYTES} from "../../src/common/solcord/timeline-limits";
import {mapSolcordVisibleRecords} from "../../src/common/solcord/bounded-selector";
import {SolcordAccountReadCoalescer} from "../../src/common/solcord/account-read";
import {MessageTimelineJournal, resolveTimelineEventIdentity, timelineAuthorPolicyAllows, type TimelineEvent} from "../../src/betterdiscord/modules/solcord/message-timeline";
import type {SolcordTimelinePolicy} from "../../src/betterdiscord/modules/solcord/contracts";

const policy = {enabled: true,
retention: "manual",
content: "text-only",
textBudgetBytes: 262_144_000,
    filters: {ignoreSelf: true, ignoreBots: true, ignoreBlockedUsers: true, alwaysLogGhostPings: false}} as SolcordTimelinePolicy;
const event = (index: number): TimelineEvent => ({eventId: `batch-${index}`, kind: "create", observedAt: Date.now(), messageId: String(index + 1), channelId: "200", content: `message ${index}`});

describe("Timeline audit regressions", () => {
    test("a failed second append remains queued and retry does not replay the acknowledged first chunk", async () => {
        const chunks = chunkTimelineEvents(Array.from({length: 250}, (_, index) => event(index)));
        const written: string[] = [];
        let calls = 0;
        const failed = drainTimelineChunks(chunks, async chunk => {
            if (++calls === 2) throw new Error("second chunk failed");
            written.push(...chunk.map(item => item.eventId));
        }, () => true).then(() => undefined, error => error as Error);
        expect((await failed)?.message).toBe("second chunk failed");
        expect(written).toHaveLength(100);
        expect(chunks).toHaveLength(2);
        expect(await drainTimelineChunks(chunks, async chunk => {written.push(...chunk.map(item => item.eventId));}, () => true)).toBeTrue();
        expect(written).toEqual(Array.from({length: 250}, (_, index) => `batch-${index}`));
        expect(chunks).toHaveLength(0);
    });

    test("an account change during an append prevents dequeueing a replacement account's pending data", async () => {
        const chunks = [[event(1)]];
        let current = true;
        const replacement = [event(2)];
        expect(await drainTimelineChunks(chunks, async () => {
            current = false; chunks.splice(0, 1, replacement);
        }, () => current)).toBeFalse();
        expect(chunks[0]).toBe(replacement);
    });

    test("relationship enrichment is bounded to the same first 1,000 accepted records", () => {
        let enriched = 0;
        const rows = mapSolcordVisibleRecords(Array.from({length: 5_000}, (_, index) => index), value => value % 2 === 0 ? value : undefined,
            value => {enriched++; return {id: value, detail: `cached-${value}`};});
        expect(enriched).toBe(1_000);
        expect(rows.map(row => row.id)).toEqual(Array.from({length: 1_000}, (_, index) => index * 2));
    });

    test("100 same-account policy refreshes share one read and an old completion cannot clear a replacement read", async () => {
        const reads = new SolcordAccountReadCoalescer<boolean>();
        let count = 0;
        let resolveA!: (value: boolean) => void;
        let resolveB!: (value: boolean) => void;
        const first = reads.load("100", () => {count++; return new Promise(resolve => {resolveA = resolve;});});
        for (let index = 0; index < 100; index++) expect(reads.load("100", () => {throw new Error("duplicate read");})).toBe(first);
        expect(count).toBe(1);
        const second = reads.load("200", () => {count++; return new Promise(resolve => {resolveB = resolve;});});
        resolveA(true); await first;
        expect(reads.pendingAccountId).toBe("200");
        resolveB(false); expect(await second).toBeFalse();
        expect(reads.pendingAccountId).toBeUndefined();
        expect(count).toBe(2);
    });
    for (const count of [100, 101, 250]) {
test(`${count} observed events fit native append count and byte limits in order`, () => {
        const input = Array.from({length: count}, (_, index) => event(index));
        const chunks = chunkTimelineEvents(input);
        expect(chunks.flat()).toEqual(input);
        expect(chunks.every(chunk => chunk.length <= 100 && timelineSerializedBytes(chunk) <= TIMELINE_MAX_APPEND_BYTES)).toBeTrue();
        expect(chunks).toHaveLength(Math.ceil(count / 100));
    });
}

    test("large UTF-8 text is bounded identically before display and append", () => {
        const input = {...event(1), content: "🟢漢".repeat(22_000)};
        const bounded = fitTimelineEventBytes(input);
        expect(timelineSerializedBytes(bounded)).toBeLessThanOrEqual(TIMELINE_MAX_EVENT_BYTES);
        expect(bounded.content.length).toBeLessThan(input.content.length);
        expect(bounded.content.endsWith("\ud83d")).toBeFalse();
        expect(chunkTimelineEvents(Array.from({length: 100}, () => bounded)).length).toBeGreaterThan(1);
    });

    test("partial edits cannot invent an author or erase a known bot/blocked identity", () => {
        const edit = {...event(1), kind: "edit" as const, authorId: undefined, content: "edited"};
        expect(resolveTimelineEventIdentity(edit)).toBeUndefined();
        for (const [known, blocked] of [
            [{channelId: "200", authorId: "300", authorIsBot: true}, false],
            [{channelId: "200", authorId: "301", authorIsBot: false}, true],
            [{channelId: "200", authorId: "400", authorIsBot: false}, false]
        ] as const) {
            const resolved = resolveTimelineEventIdentity(edit, known)!;
            expect(timelineAuthorPolicyAllows(resolved, policy.filters, "400", blocked)).toBeFalse();
        }
        expect(resolveTimelineEventIdentity({...edit, channelId: "201"}, {channelId: "200", authorId: "300", authorIsBot: false})).toBeUndefined();
    });

    test("10k event replay performs one retention scan and stable UI reads do no repeated sort/clone", () => {
        const journal = new MessageTimelineJournal();
        const prune = spyOn(journal, "prune");
        journal.hydrate(Array.from({length: 10_000}, (_, index) => event(index)), policy);
        expect(prune).toHaveBeenCalledTimes(1);
        expect(journal.status().records).toBe(10_000);
        const view = journal.view();
        expect(journal.view()).toBe(view);
        expect(Object.isFrozen(view)).toBeTrue();
        const defensive = journal.snapshot();
        defensive[0].content = "outside mutation";
        expect(journal.view()[0].content).not.toBe("outside mutation");
        prune.mockRestore();
    });

    test("idle deadline pruning removes content and invalidates the visible snapshot", () => {
        const journal = new MessageTimelineJournal();
        const timed = {...policy, retention: "24-hours" as const};
        journal.apply({...event(1), observedAt: 10_000}, timed, 10_000);
        const before = journal.view();
        expect(journal.prune(timed, 10_000 + 86_400_001)).toBe(1);
        expect(journal.view()).not.toBe(before);
        expect(journal.view()).toHaveLength(0);
        expect(journal.status().textBytes).toBe(0);
    });

    test("an actual journal change copies only the changed visible record", () => {
        const journal = new MessageTimelineJournal();
        journal.hydrate([event(0), event(1)], policy);
        const before = journal.view();
        journal.apply({...event(1), kind: "edit", eventId: "edited-record", content: "new text"}, policy);
        const after = journal.view();
        expect(after.find(item => item.messageId === "1")!).toBe(before.find(item => item.messageId === "1")!);
        expect(after.find(item => item.messageId === "2")!).not.toBe(before.find(item => item.messageId === "2")!);
    });
});
