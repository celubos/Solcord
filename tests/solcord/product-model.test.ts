// SPDX-License-Identifier: Apache-2.0

import {describe, expect, test} from "bun:test";

import {
    expandedSolcordPermissions,
    findSolcordWorkspaces,
    inferSolcordPermissionCard,
    normalizeSolcordMediaShelfUrl,
    normalizeSolcordProductPreferences,
    prioritizeSolcordPulse,
    resolveSolcordPerformancePolicy,
    SOLCORD_SETUP_STEPS,
    SOLCORD_WORKSPACES
} from "../../src/common/solcord/product";

describe("Solcord V2 product model", () => {
    test("finds the built-in Fake Deafen controls by feature name without creating a duplicate workspace", () => {
        for (const query of ["Fake Deafen", "fakedeafen", "  FAKE   DEAFEN  ", "Power Lab", "audio console"]) {
            expect(findSolcordWorkspaces(query).map(workspace => workspace.id)).toEqual(["voice"]);
        }
        expect(findSolcordWorkspaces("appearance reading").map(workspace => workspace.id)).toEqual(["appearance"]);
        expect(findSolcordWorkspaces("unknown feature")).toEqual([]);
        expect(findSolcordWorkspaces(" ")).toEqual([...SOLCORD_WORKSPACES]);
    });

    test("finds Message History by the words people use for a deleted-message logger", () => {
        for (const query of ["deleted messages", "edited", "message logger", "ghost ping", "Message History", "timeline"]) {
            expect(findSolcordWorkspaces(query).map(workspace => workspace.id)).toEqual(["history"]);
        }
    });

    test("owns ten task-oriented Control Center workspaces and five resumable setup steps", () => {
        expect(SOLCORD_WORKSPACES.map(workspace => workspace.id)).toEqual([
            "overview",
            "appearance",
            "performance",
            "privacy",
            "chat",
            "history",
            "voice",
            "friends",
            "extensions",
            "recovery"
        ]);
        expect(SOLCORD_SETUP_STEPS).toEqual(["Welcome", "Privacy", "Appearance", "Features", "Review and Apply"]);
    });

    test("normalizes hostile or obsolete preferences to conservative local defaults", () => {
        const normalized = normalizeSolcordProductPreferences({
            appearance: {mode: "remote-theme", accent: "crypto", density: "tiny", motion: "forced", messageShape: "bubbles"},
            safety: {linkLens: "yes", domainMemory: "auto-open", attachmentGuard: 1, privacyModeReady: null},
            friendWatch: {enabled: "yes", retentionDays: 3650, includeDisplaySnapshot: 0, digest: "cloud"},
            returnLaterRetentionDays: -1
        });

        expect(normalized.appearance).toEqual({mode: "follow-discord", accent: "glacier", density: "comfortable", motion: "follow-system", messageShape: "discord"});
        expect(normalized.safety).toEqual({linkLens: true, domainMemory: "warn-only", attachmentGuard: true, privacyModeReady: true});
        expect(normalized.friendWatch).toEqual({enabled: false, retentionDays: 30, includeDisplaySnapshot: true, digest: "daily"});
        expect(normalized.returnLaterRetentionDays).toBe(30);
        expect(normalized.performanceProfile).toBe("balanced");
        expect(normalized.baseline).toEqual({layoutCollapse: false, collapsedRegions: [], embedControls: false, crossPlatformAutoscroll: false, messageLinkPreview: false, mediaShelf: []});
    });

    test("normalizes baseline tools without accepting arbitrary media hosts or unbounded entries", () => {
        const normalized = normalizeSolcordProductPreferences({
            performanceProfile: "visual",
            baseline: {
                layoutCollapse: true,
                collapsedRegions: ["guilds", "guilds", "channels", "invalid"],
                embedControls: true,
                crossPlatformAutoscroll: true,
                messageLinkPreview: true,
                mediaShelf: [
                    {id: "one", label: "  reference  ", url: "https://cdn.discordapp.com/attachments/a/b/image.gif", kind: "gif"},
                    {id: "two", label: "tracker", url: "https://example.com/pixel.gif", kind: "gif"},
                    {id: "three", label: "wrong protocol", url: "http://media.discordapp.net/a.gif", kind: "gif"},
                    {id: "four", label: "signed", url: "https://cdn.discordapp.com/attachments/a/b/image.gif?ex=secret&is=signature", kind: "gif"},
                    {id: "five", label: "fragment", url: "https://media.discordapp.net/a.gif#private", kind: "gif"}
                ]
            }
        });

        expect(normalized.performanceProfile).toBe("visual");
        expect(normalized.baseline.collapsedRegions).toEqual(["guilds", "channels"]);
        expect(normalized.baseline.mediaShelf).toEqual([
            {id: "one", label: "reference", url: "https://cdn.discordapp.com/attachments/a/b/image.gif", kind: "gif"}
        ]);
        expect(normalizeSolcordMediaShelfUrl("https://user:secret@cdn.discordapp.com/a.gif")).toBeUndefined();
        expect(normalizeSolcordMediaShelfUrl("https://cdn.discordapp.com:444/a.gif")).toBeUndefined();
    });

    test("scrubs account-derived Discord ids from ordinary preferences", () => {
        const normalized = normalizeSolcordProductPreferences({
            nativeSuite: {
                pinnedDmIds: ["111222333"],
                hiddenGuildIds: ["444555666"],
                guildAliases: {444555666: "Private server"},
                focusChannelIds: ["777888999"]
            }
        });

        expect(normalized.nativeSuite).toMatchObject({pinnedDmIds: [], hiddenGuildIds: [], guildAliases: {}, focusChannelIds: []});
    });

    test("normalizes bounded Composer Toolkit preferences", () => {
        const normalized = normalizeSolcordProductPreferences({nativeSuite: {composer: {
            doubleClickReplyModifier: "shift",
            splitBoundary: "newlines",
            preserveBlankLines: true,
            splitLimit: 99_000,
            maxSplitParts: 99,
            attachmentThreshold: -1,
            counterWarningPercent: 999,
            timestampFormat: "iso"
        }}});
        expect(normalized.nativeSuite.composer).toEqual({
            doubleClickReplyModifier: "shift",
            splitBoundary: "newlines",
            preserveBlankLines: true,
            splitLimit: 4_000,
            maxSplitParts: 20,
            attachmentThreshold: 0,
            counterWarningPercent: 100,
            timestampFormat: "iso"
        });
    });

    test("normalizes secondary provider options without accepting unbounded effects", () => {
        const normalized = normalizeSolcordProductPreferences({nativeSuite: {
            people: {showRelationshipDates: false, showMutualGuildCounts: false, pinIcon: false, pinUnreadAmount: false, pinChannelAmount: false, sortPinnedByRecent: true, serverHiderStreamOnly: true, pinCategories: {friends: false, groups: true, bots: false, blocked: true, others: false}},
            voiceActivity: {memberList: false, dmList: false, peopleList: false, highlightCurrentChannel: false, statusIcons: false, currentUser: false},
            timestamps: {chat: false, embeds: false, markup: false, auditLogs: false, chatTooltips: false, editedTooltips: false, markupTooltips: false},
            voiceNotes: {downloadButton: false, stripMetadata: true},
            notifications: {includeDms: false, includeGuilds: false, includeMuted: true},
            motion: {effect: "rain", particleCount: 9_999, color: "#AABBCC", opacityPercent: 5, speedPercent: 5_000, starAngleDegrees: -500, surfaces: {messages: false, channels: false}}
        }});

        expect(normalized.nativeSuite.people).toEqual({showRelationshipDates: false, showMutualGuildCounts: false, pinIcon: false, pinUnreadAmount: false, pinChannelAmount: false, sortPinnedByRecent: true, serverHiderStreamOnly: true, pinCategories: {friends: false, groups: true, bots: false, blocked: true, others: false}});
        expect(normalized.nativeSuite.voiceActivity).toEqual({memberList: false, dmList: false, peopleList: false, highlightCurrentChannel: false, statusIcons: false, currentUser: false});
        expect(normalized.nativeSuite.notifications).toEqual({includeDms: false, includeGuilds: false, includeMuted: true});
        expect(normalized.nativeSuite.timestamps).toEqual({chat: false, embeds: false, markup: false, auditLogs: false, chatTooltips: false, editedTooltips: false, markupTooltips: false});
        expect(normalized.nativeSuite.voiceNotes).toEqual({downloadButton: false, stripMetadata: true});
        expect(normalized.nativeSuite.motion).toEqual({effect: "rain", particleCount: 24, color: "#aabbcc", opacityPercent: 10, speedPercent: 300, starAngleDegrees: -75, surfaces: {messages: false, channels: false, servers: true, members: true, modals: true, popouts: true, settings: true, tooltips: true, threads: true}});
        expect(normalizeSolcordProductPreferences({nativeSuite: {motion: {effect: "work-field"}}}).nativeSuite.motion.effect).toBe("work-field");
        expect(normalizeSolcordProductPreferences({nativeSuite: {motion: {effect: "embers"}}}).nativeSuite.motion.effect).toBe("embers");
        expect(normalizeSolcordProductPreferences({nativeSuite: {motion: {effect: "remote-css", particleCount: -2, color: "url(bad)", opacityPercent: 900, speedPercent: -2, starAngleDegrees: 900}}}).nativeSuite.motion).toEqual({effect: "field", particleCount: 1, color: "#9fb8ff", opacityPercent: 100, speedPercent: 25, starAngleDegrees: 75, surfaces: {messages: true, channels: true, servers: true, members: true, modals: true, popouts: true, settings: true, tooltips: true, threads: true}});
    });

    test("resolves performance and motion without overriding reduced-motion safety", () => {
        expect(resolveSolcordPerformancePolicy("lean", "full", false)).toMatchObject({sampleSeconds: 15, effectiveMotion: "subtle", ambientEffects: false});
        expect(resolveSolcordPerformancePolicy("balanced", "full", false)).toMatchObject({sampleSeconds: 5, effectiveMotion: "full", ambientEffects: true});
        expect(resolveSolcordPerformancePolicy("visual", "follow-system", false)).toMatchObject({effectiveMotion: "full", ambientEffects: true});
        expect(resolveSolcordPerformancePolicy("visual", "full", true)).toMatchObject({effectiveMotion: "reduced", ambientEffects: false});
    });

    test("keeps Session Pulse bounded, unique, deterministic, and priority ordered", () => {
        const signals = prioritizeSolcordPulse([
            {id: "healthy", priority: 1, tone: "ok", label: "healthy", detail: "ok"},
            {id: "recovery", priority: 130, tone: "danger", label: "recovery", detail: "held"},
            {id: "addons", priority: 90.4, tone: "danger", label: "addons", detail: "held"},
            {id: "drift", priority: 80, tone: "attention", label: "drift", detail: "held"},
            {id: "addons", priority: 99, tone: "danger", label: "duplicate", detail: "ignored"}
        ]);

        expect(signals.map(signal => [signal.id, signal.priority])).toEqual([["recovery", 100], ["addons", 90], ["drift", 80]]);
    });

    test("requires re-review only for newly expanded capabilities", () => {
        const baseline = {network: false, filesystem: true, patching: false, messageAccess: "metadata" as const, accountContext: false, localStorage: true};
        const expanded = {...baseline, network: true, patching: true, messageAccess: "content" as const};
        expect(expandedSolcordPermissions(baseline, expanded)).toEqual(["network", "patching", "messageAccess:content"]);
        expect(expandedSolcordPermissions(expanded, baseline)).toEqual([]);
    });

    test("turns reviewed catalog signals into conservative display-only permission cards", () => {
        expect(inferSolcordPermissionCard({
            networkBehavior: ["no-static-network-signal"],
            accountActions: ["message-send-path"],
            cleanupBehavior: {resources: ["patcher"], cleanup: ["settings"]},
            tags: ["chat"]
        })).toEqual({network: false, filesystem: false, patching: true, messageAccess: "content", accountContext: true, localStorage: true});
        expect(inferSolcordPermissionCard({networkBehavior: ["CODE_REVIEW_REQUIRED"], accountActions: ["CODE_REVIEW_REQUIRED"], cleanupBehavior: "RUNTIME_REVIEW_REQUIRED", tags: []})).toMatchObject({network: true, patching: true, accountContext: true});
    });
});
