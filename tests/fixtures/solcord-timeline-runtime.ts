// SPDX-License-Identifier: Apache-2.0

import {runtimeMethodFixture} from "./solcord-method-fixture";
import {SolcordDisposalScope} from "../../src/betterdiscord/modules/solcord/disposal";
import type {SolcordTimelinePolicy} from "../../src/betterdiscord/modules/solcord/contracts";
import {channelIsInTimelineScope, MessageTimelineJournal, normalizeDiscordTimelineDispatch, normalizeTimelineAccountId, resolveTimelineEventIdentity, timelineAuthorPolicyAllows, TimelineAccountGuard, timelineEventAccountMatches, type TimelineEvent} from "../../src/betterdiscord/modules/solcord/message-timeline";
import {chunkTimelineEvents, drainTimelineChunks, fitTimelineEventBytes, timelineSerializedBytes} from "../../src/common/solcord/timeline-limits";

export interface TimelineFixtureRead {
    events: TimelineEvent[];
    persistent: boolean;
    complete: boolean;
    truncated: boolean;
    omittedSegments: number;
    unreadableSegments: number;
    retentionApplied: boolean;
}

export const completeTimelineRead = (events: TimelineEvent[] = []): TimelineFixtureRead => ({events, persistent: true, complete: true, truncated: false, omittedSegments: 0, unreadableSegments: 0, retentionApplied: true});

export function createTimelineRuntimeFixture(options: {
    read?: (accountId: string) => Promise<TimelineFixtureRead>;
    appendRetentionApplied?: boolean;
} = {}) {
    let account = "100";
    const userListeners = new Set<() => void>();
    const handlers = new Map<string, Set<(payload: Record<string, unknown>) => void>>();
    const activeOperations = new Set<Promise<unknown>>();
    const health: Array<{maturity?: string; detail?: string;}> = [];
    const appended: Array<{accountId: string; events: TimelineEvent[];}> = [];
    const policy = {
        enabled: true,
scope: "dm-only",
serverChannelIds: [],
retention: "7-days",
content: "text-only",
        textBudgetBytes: 262_144_000,
mediaBudgetBytes: 1_073_741_824,
        filters: {ignoreSelf: false, ignoreBots: true, ignoreBlockedUsers: true, ignoreMutedChannels: false, ignoreMutedGuilds: false, ignoreNsfw: false, alwaysLogDms: false, alwaysLogGhostPings: false},
        display: {showDeletedMessages: true, showEditedMessages: true, showPurgedMessages: true, showDeletedCount: true, showEditedCount: true, reverseOrder: false, maxShownEdits: 10}
    } satisfies SolcordTimelinePolicy;
    const journal = new MessageTimelineJournal();
    const scope = new SolcordDisposalScope();
    const dispatcher = {
        dispatch() {},
        subscribe(type: string, callback: (payload: Record<string, unknown>) => void) {
            const subscriptions = handlers.get(type) ?? new Set(); subscriptions.add(callback); handlers.set(type, subscriptions);
        },
        unsubscribe(type: string, callback: (payload: Record<string, unknown>) => void) {handlers.get(type)?.delete(callback);}
    };
    const stores: Record<string, unknown> = {
        ChannelStore: {getChannel: (id: string) => ({id, type: 1})},
        MessageStore: {getMessage: () => undefined, getMessages: () => []},
        SelectedChannelStore: {getChannelId: () => "200"},
        UserStore: {getCurrentUser: () => ({id: account}), addChangeListener: (listener: () => void) => userListeners.add(listener), removeChangeListener: (listener: () => void) => userListeners.delete(listener)},
        RelationshipStore: {getRelationshipType: () => 1}
    };
    const state = {
        timeline: journal,
        timelineAccountGuard: new TimelineAccountGuard(),
        timelinePersistent: false,
        timelineUnpersisted: false,
        timelineRetentionDirty: false,
        timelineIncompleteAccounts: new Set<string>(),
        flushTimelinePersistence: undefined as (() => Promise<boolean>) | undefined,
        timelinePolicyChanged: undefined as (() => void) | undefined,
        resetTimelinePersistence: undefined as (() => void) | undefined,
        withTimelineAccount(accountId: string, operation: (capability: string) => Promise<unknown>, isCurrent: () => boolean) {
            const pending = (async () => {
                if (!isCurrent()) throw new Error("FixtureAccountChangedBeforeRequest");
                const result = await operation(accountId);
                if (!isCurrent()) throw new Error("FixtureAccountChangedDuringRequest");
                return result;
            })();
            activeOperations.add(pending);
            void pending.then(() => activeOperations.delete(pending), () => activeOperations.delete(pending));
            return pending;
        },
        releaseTimelineAccount: async () => {},
        setHealth: (_id: string, update: {maturity?: string; detail?: string;}) => health.push(update)
    };
    const method = runtimeMethodFixture("#startMessageTimeline", {
        DiscordModules: {Dispatcher: dispatcher},
getStore: (name: string) => stores[name],
        SolcordSettings: {slice: () => policy},
        getLazy: async () => {throw new Error("Fixture did not supply a usable dispatcher.");},
Filters: {},
        TIMELINE_IPC: {
            status: async () => ({persistent: true}),
            read: options.read ?? (async () => completeTimelineRead()),
            append: async (accountId: string, request: {events: TimelineEvent[];}) => {
                appended.push({accountId, events: request.events});
                return {persistent: true, retentionApplied: options.appendRetentionApplied !== false};
            }
        },
        channelIsInTimelineScope,
normalizeDiscordTimelineDispatch,
normalizeTimelineAccountId,
resolveTimelineEventIdentity,
        timelineAuthorPolicyAllows,
timelineEventAccountMatches,
chunkTimelineEvents,
drainTimelineChunks,
fitTimelineEventBytes,
timelineSerializedBytes
    });
    return {
        state,
journal,
health,
appended,
        start: () => method.call(state, scope) as Promise<void>,
        changeAccount(value: string) {account = value; for (const listener of userListeners) listener();},
        dispatch(type: string, payload: Record<string, unknown>) {for (const handler of handlers.get(type) ?? []) handler(payload);},
        async settle() {
            for (let attempt = 0; attempt < 20; attempt++) {
                await Promise.allSettled([...activeOperations]);
                await Promise.resolve();
                if (!activeOperations.size) return;
            }
            throw new Error("Timeline fixture did not reach a settled capability queue.");
        },
        dispose() {scope.dispose();}
    };
}
