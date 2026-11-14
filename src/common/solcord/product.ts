// SPDX-License-Identifier: Apache-2.0

import {defaultStrictPrivacyPreferences, normalizePrivacyPreferences, type SolcordPrivacyPreferences} from "./privacy";

export type SolcordWorkspaceId =
    | "overview"
    | "appearance"
    | "performance"
    | "privacy"
    | "chat"
    | "history"
    | "voice"
    | "friends"
    | "extensions"
    | "recovery";
export type SolcordVisualMode = "follow-discord" | "solcord-dark" | "solcord-light" | "oled";
export type SolcordAccent = "system" | "glacier" | "signal" | "coral" | "forest";
export type SolcordDensity = "comfortable" | "compact";
export type SolcordMotion = "follow-system" | "full" | "subtle" | "reduced";
export type SolcordMessageShape = "discord" | "seamed";
export type SolcordSetupPreset = "recommended" | "minimal" | "power-user";
export type SolcordPerformanceProfile = "lean" | "balanced" | "visual";
export type SolcordLayoutRegion = "guilds" | "channels" | "members";
export type SolcordMediaKind = "gif" | "sticker" | "emoji";

export interface SolcordMediaShelfItem {
    id: string;
    label: string;
    url: string;
    kind: SolcordMediaKind;
}

const SOLCORD_MEDIA_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

export function normalizeSolcordMediaShelfUrl(value: unknown): string | undefined {
    if (typeof value !== "string" || value.length > 2_048) return;
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return;
        if (!SOLCORD_MEDIA_HOSTS.has(url.hostname) || !url.pathname.startsWith("/") || url.pathname.includes("\\")) return;
        return url.toString();
    }
    catch {return;}
}

export interface SolcordBaselinePreferences {
    layoutCollapse: boolean;
    collapsedRegions: SolcordLayoutRegion[];
    embedControls: boolean;
    crossPlatformAutoscroll: boolean;
    messageLinkPreview: boolean;
    mediaShelf: SolcordMediaShelfItem[];
}

export interface SolcordAppearancePreferences {
    mode: SolcordVisualMode;
    accent: SolcordAccent;
    density: SolcordDensity;
    motion: SolcordMotion;
    messageShape: SolcordMessageShape;
}

export interface SolcordSafetyPreferences {
    linkLens: boolean;
    domainMemory: "off" | "warn-only";
    attachmentGuard: boolean;
    privacyModeReady: boolean;
}

export interface SolcordFriendWatchPolicy {
    enabled: boolean;
    retentionDays: 7 | 30 | 90;
    includeDisplaySnapshot: boolean;
    digest: "off" | "daily" | "per-event";
}

export interface SolcordProductPreferences {
    performanceProfile: SolcordPerformanceProfile;
    appearance: SolcordAppearancePreferences;
    safety: SolcordSafetyPreferences;
    privacy: SolcordPrivacyPreferences;
    friendWatch: SolcordFriendWatchPolicy;
    returnLaterRetentionDays: 7 | 30 | 90;
    nativeSuite: {
        pinnedDmIds: string[];
        hiddenGuildIds: string[];
        guildAliases: Record<string, string>;
        focusChannelIds: string[];
        voiceHealthEnabled: boolean;
        translation: {provider: "off" | "local" | "deepl" | "libretranslate"; endpoint: string; sourceLanguage: string; targetLanguage: string;};
        people: {
            showRelationshipDates: boolean;
            showMutualGuildCounts: boolean;
            pinIcon: boolean;
            pinUnreadAmount: boolean;
            pinChannelAmount: boolean;
            sortPinnedByRecent: boolean;
            serverHiderStreamOnly: boolean;
            pinCategories: {
                friends: boolean;
                groups: boolean;
                bots: boolean;
                blocked: boolean;
                others: boolean;
            };
        };
        voiceActivity: {
            memberList: boolean;
            dmList: boolean;
            peopleList: boolean;
            highlightCurrentChannel: boolean;
            statusIcons: boolean;
            currentUser: boolean;
        };
        notifications: {
            includeDms: boolean;
            includeGuilds: boolean;
            includeMuted: boolean;
        };
        timestamps: {
            chat: boolean;
            embeds: boolean;
            markup: boolean;
            auditLogs: boolean;
            chatTooltips: boolean;
            editedTooltips: boolean;
            markupTooltips: boolean;
        };
        voiceNotes: {downloadButton: boolean; stripMetadata: boolean;};
        motion: {
            effect: "off" | "signal" | "field" | "work-field" | "embers" | "snow" | "rain" | "stars";
            particleCount: number;
            color: string;
            opacityPercent: number;
            speedPercent: number;
            starAngleDegrees: number;
            surfaces: {
                messages: boolean;
                channels: boolean;
                servers: boolean;
                members: boolean;
                modals: boolean;
                popouts: boolean;
                settings: boolean;
                tooltips: boolean;
                threads: boolean;
            };
        };
        composer: {
            doubleClickReplyModifier: "none" | "ctrl" | "shift" | "alt";
            splitBoundary: "balanced" | "newlines";
            preserveBlankLines: boolean;
            splitLimit: number;
            maxSplitParts: number;
            attachmentThreshold: number;
            counterWarningPercent: number;
            timestampFormat: "full" | "compact" | "iso";
        };
    };
    baseline: SolcordBaselinePreferences;
}

export const SOLCORD_WORKSPACES = Object.freeze([
    {id: "overview", label: "Overview", summary: "Current state and the next useful action."},
    {id: "appearance", label: "Appearance & Accessibility", summary: "Theme, density, motion, and reading aids."},
    {id: "performance", label: "Performance", summary: "Choose a resource profile and inspect local cost."},
    {id: "privacy", label: "Privacy & Safety", summary: "Tracking protection, private data, links, and uploads."},
    {id: "chat", label: "Chat & Composer", summary: "Writing, drafts, and message tools."},
    {id: "history", label: "Message History", summary: "Deleted and edited messages Solcord saw, stored only on this computer."},
    {id: "voice", label: "Voice & Activities", summary: "Calls, Activities, streams, and experiments."},
    {id: "friends", label: "Friends & Spaces", summary: "People, servers, notes, and reminders."},
    {id: "extensions", label: "Extensions", summary: "Built-ins, community software, and optional migration."},
    {id: "recovery", label: "Recovery", summary: "Repair, rollback, snapshots, and technical details."}
] satisfies ReadonlyArray<{id: SolcordWorkspaceId; label: string; summary: string;}>);

/** Feature aliases supplement route labels without expanding normal page copy. */
const SOLCORD_WORKSPACE_SEARCH_TERMS: Partial<Record<SolcordWorkspaceId, string>> = {
    history: "deleted edited message logger timeline ghost ping removed messages edit history",
    voice: "fake deafen fakedeafen power lab audience guard voice note audio console"
};

export function findSolcordWorkspaces(query: string) {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return SOLCORD_WORKSPACES.filter(workspace => {
        const text = `${workspace.label} ${workspace.summary} ${SOLCORD_WORKSPACE_SEARCH_TERMS[workspace.id] ?? ""}`.toLowerCase();
        return terms.every(term => text.includes(term));
    });
}

export const SOLCORD_SETUP_STEPS = Object.freeze([
    "Welcome",
    "Privacy",
    "Appearance",
    "Features",
    "Review and Apply"
] as const);

export interface SolcordPerformancePolicy {
    sampleSeconds: number;
    effectiveMotion: "full" | "subtle" | "reduced";
    ambientEffects: boolean;
    description: string;
}

export const SOLCORD_PERFORMANCE_POLICIES: Readonly<Record<SolcordPerformanceProfile, Readonly<SolcordPerformancePolicy>>> = Object.freeze({
    lean: Object.freeze({sampleSeconds: 15, effectiveMotion: "reduced", ambientEffects: false, description: "Minimum background work and no ambient motion."}),
    balanced: Object.freeze({sampleSeconds: 5, effectiveMotion: "subtle", ambientEffects: false, description: "Responsive controls with short interaction-led motion."}),
    visual: Object.freeze({sampleSeconds: 5, effectiveMotion: "full", ambientEffects: true, description: "Full interaction motion while keeping chat and long lists still."})
});

export function resolveSolcordPerformancePolicy(profile: SolcordPerformanceProfile, motion: SolcordMotion, reduceMotion: boolean): SolcordPerformancePolicy {
    const base = SOLCORD_PERFORMANCE_POLICIES[profile];
    if (reduceMotion || motion === "reduced") return {...base, effectiveMotion: "reduced", ambientEffects: false};
    if (motion === "full") return {...base, effectiveMotion: profile === "lean" ? "subtle" : "full", ambientEffects: profile !== "lean"};
    if (motion === "subtle") return {...base, effectiveMotion: "subtle", ambientEffects: false};
    return {...base};
}

export function defaultSolcordProductPreferences(): SolcordProductPreferences {
    return {
        performanceProfile: "balanced",
        appearance: {mode: "follow-discord", accent: "glacier", density: "comfortable", motion: "follow-system", messageShape: "discord"},
        safety: {linkLens: true, domainMemory: "warn-only", attachmentGuard: true, privacyModeReady: true},
        privacy: defaultStrictPrivacyPreferences(),
        friendWatch: {enabled: false, retentionDays: 30, includeDisplaySnapshot: true, digest: "daily"},
        returnLaterRetentionDays: 30,
        nativeSuite: {
            pinnedDmIds: [],
            hiddenGuildIds: [],
            guildAliases: {},
            focusChannelIds: [],
            voiceHealthEnabled: false,
            translation: {provider: "local", endpoint: "", sourceLanguage: "auto", targetLanguage: "EN"},
            people: {showRelationshipDates: true, showMutualGuildCounts: true, pinIcon: true, pinUnreadAmount: true, pinChannelAmount: true, sortPinnedByRecent: false, serverHiderStreamOnly: false, pinCategories: {friends: true, groups: true, bots: true, blocked: true, others: true}},
            voiceActivity: {memberList: true, dmList: true, peopleList: true, highlightCurrentChannel: true, statusIcons: true, currentUser: true},
            notifications: {includeDms: true, includeGuilds: true, includeMuted: false},
            timestamps: {chat: true, embeds: true, markup: true, auditLogs: true, chatTooltips: true, editedTooltips: true, markupTooltips: true},
            voiceNotes: {downloadButton: true, stripMetadata: false},
            motion: {effect: "field", particleCount: 10, color: "#9fb8ff", opacityPercent: 42, speedPercent: 100, starAngleDegrees: -28, surfaces: {messages: true, channels: true, servers: true, members: true, modals: true, popouts: true, settings: true, tooltips: true, threads: true}},
            composer: {doubleClickReplyModifier: "none", splitBoundary: "balanced", preserveBlankLines: false, splitLimit: 2_000, maxSplitParts: 0, attachmentThreshold: 0, counterWarningPercent: 80, timestampFormat: "full"}
        },
        baseline: {layoutCollapse: false, collapsedRegions: [], embedControls: false, crossPlatformAutoscroll: false, messageLinkPreview: false, mediaShelf: []}
    };
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function choice<T extends string | number>(value: unknown, values: readonly T[], fallback: T): T {
    return values.includes(value as T) ? value as T : fallback;
}

const LEGACY_VISUAL_MODE_DARK = String.fromCharCode(115, 111, 117, 108, 45, 100, 97, 114, 107);
const LEGACY_VISUAL_MODE_LIGHT = String.fromCharCode(115, 111, 117, 108, 45, 108, 105, 103, 104, 116);

function normalizeVisualMode(value: unknown): SolcordVisualMode {
    if (value === LEGACY_VISUAL_MODE_DARK) return "solcord-dark";
    if (value === LEGACY_VISUAL_MODE_LIGHT) return "solcord-light";
    return choice(value, ["follow-discord", "solcord-dark", "solcord-light", "oled"] as const, "follow-discord");
}

export function normalizeSolcordTranslationEndpoint(value: unknown): string {
    if (typeof value !== "string" || value.length > 500) return "";
    try {
        const url = new URL(value);
        if (url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash) return url.toString();
    }
    catch {/* invalid endpoint stays empty */}
    return "";
}

export function isSolcordTranslationLanguage(value: unknown, allowAuto = false): value is string {
    return typeof value === "string" && ((allowAuto && value === "auto") || /^[A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(value));
}

export function normalizeSolcordProductPreferences(value: unknown): SolcordProductPreferences {
    const source = record(value);
    const appearance = record(source.appearance);
    const safety = record(source.safety);
    const privacy = record(source.privacy);
    const friendWatch = record(source.friendWatch);
    const nativeSuite = record(source.nativeSuite);
    const translation = record(nativeSuite.translation);
    const people = record(nativeSuite.people);
    const pinCategories = record(people.pinCategories);
    const voiceActivity = record(nativeSuite.voiceActivity);
    const notifications = record(nativeSuite.notifications);
    const timestamps = record(nativeSuite.timestamps);
    const voiceNotes = record(nativeSuite.voiceNotes);
    const motion = record(nativeSuite.motion);
    const motionSurfaces = record(motion.surfaces);
    const composer = record(nativeSuite.composer);
    const baseline = record(source.baseline);
    return {
        performanceProfile: choice(source.performanceProfile, ["lean", "balanced", "visual"] as const, "balanced"),
        appearance: {
            mode: normalizeVisualMode(appearance.mode),
            accent: choice(appearance.accent, ["system", "glacier", "signal", "coral", "forest"] as const, "glacier"),
            density: choice(appearance.density, ["comfortable", "compact"] as const, "comfortable"),
            motion: choice(appearance.motion, ["follow-system", "full", "subtle", "reduced"] as const, "follow-system"),
            messageShape: choice(appearance.messageShape, ["discord", "seamed"] as const, "discord")
        },
        safety: {
            linkLens: safety.linkLens !== false,
            domainMemory: choice(safety.domainMemory, ["off", "warn-only"] as const, "warn-only"),
            attachmentGuard: safety.attachmentGuard !== false,
            privacyModeReady: safety.privacyModeReady !== false
        },
        privacy: normalizePrivacyPreferences(privacy),
        friendWatch: {
            enabled: friendWatch.enabled === true,
            retentionDays: choice(friendWatch.retentionDays, [7, 30, 90] as const, 30),
            includeDisplaySnapshot: friendWatch.includeDisplaySnapshot !== false,
            digest: choice(friendWatch.digest, ["off", "daily", "per-event"] as const, "daily")
        },
        returnLaterRetentionDays: choice(source.returnLaterRetentionDays, [7, 30, 90] as const, 30),
        nativeSuite: {
            // Account-derived Discord IDs belong to private account stores or
            // session state, never normal settings, snapshots, or profiles.
            pinnedDmIds: [],
            hiddenGuildIds: [],
            guildAliases: {},
            focusChannelIds: [],
            voiceHealthEnabled: nativeSuite.voiceHealthEnabled === true,
            translation: {
                provider: choice(translation.provider, ["off", "local", "deepl", "libretranslate"] as const, "local"),
                endpoint: normalizeSolcordTranslationEndpoint(translation.endpoint),
                sourceLanguage: isSolcordTranslationLanguage(translation.sourceLanguage, true) ? translation.sourceLanguage : "auto",
                targetLanguage: isSolcordTranslationLanguage(translation.targetLanguage) ? translation.targetLanguage : "EN"
            },
            people: {
                showRelationshipDates: people.showRelationshipDates !== false,
                showMutualGuildCounts: people.showMutualGuildCounts !== false,
                pinIcon: people.pinIcon !== false,
                pinUnreadAmount: people.pinUnreadAmount !== false,
                pinChannelAmount: people.pinChannelAmount !== false,
                sortPinnedByRecent: people.sortPinnedByRecent === true,
                serverHiderStreamOnly: people.serverHiderStreamOnly === true,
                pinCategories: {
                    friends: pinCategories.friends !== false,
                    groups: pinCategories.groups !== false,
                    bots: pinCategories.bots !== false,
                    blocked: pinCategories.blocked !== false,
                    others: pinCategories.others !== false
                }
            },
            voiceActivity: {
                memberList: voiceActivity.memberList !== false,
                dmList: voiceActivity.dmList !== false,
                peopleList: voiceActivity.peopleList !== false,
                highlightCurrentChannel: voiceActivity.highlightCurrentChannel !== false,
                statusIcons: voiceActivity.statusIcons !== false,
                currentUser: voiceActivity.currentUser !== false
            },
            notifications: {
                includeDms: notifications.includeDms !== false,
                includeGuilds: notifications.includeGuilds !== false,
                includeMuted: notifications.includeMuted === true
            },
            timestamps: {
                chat: timestamps.chat !== false,
                embeds: timestamps.embeds !== false,
                markup: timestamps.markup !== false,
                auditLogs: timestamps.auditLogs !== false,
                chatTooltips: timestamps.chatTooltips !== false,
                editedTooltips: timestamps.editedTooltips !== false,
                markupTooltips: timestamps.markupTooltips !== false
            },
            voiceNotes: {downloadButton: voiceNotes.downloadButton !== false, stripMetadata: voiceNotes.stripMetadata === true},
            motion: {
                // `stars` remains readable as a migration alias, but the UI no longer
                // offers it and Motion Studio renders it through the owner-approved field.
                effect: choice(motion.effect, ["off", "signal", "field", "work-field", "embers", "snow", "rain", "stars"] as const, "field"),
                particleCount: Math.max(1, Math.min(24, Number.isFinite(motion.particleCount) ? Math.floor(motion.particleCount as number) : 10)),
                color: typeof motion.color === "string" && /^#[0-9a-f]{6}$/i.test(motion.color) ? motion.color.toLowerCase() : "#9fb8ff",
                opacityPercent: Math.max(10, Math.min(100, Number.isFinite(motion.opacityPercent) ? Math.floor(motion.opacityPercent as number) : 42)),
                speedPercent: Math.max(25, Math.min(300, Number.isFinite(motion.speedPercent) ? Math.floor(motion.speedPercent as number) : 100)),
                starAngleDegrees: Math.max(-75, Math.min(75, Number.isFinite(motion.starAngleDegrees) ? Math.floor(motion.starAngleDegrees as number) : -28)),
                surfaces: {
                    messages: motionSurfaces.messages !== false,
                    channels: motionSurfaces.channels !== false,
                    servers: motionSurfaces.servers !== false,
                    members: motionSurfaces.members !== false,
                    modals: motionSurfaces.modals !== false,
                    popouts: motionSurfaces.popouts !== false,
                    settings: motionSurfaces.settings !== false,
                    tooltips: motionSurfaces.tooltips !== false,
                    threads: motionSurfaces.threads !== false
                }
            },
            composer: {
                doubleClickReplyModifier: choice(composer.doubleClickReplyModifier, ["none", "ctrl", "shift", "alt"] as const, "none"),
                splitBoundary: choice(composer.splitBoundary, ["balanced", "newlines"] as const, "balanced"),
                preserveBlankLines: composer.preserveBlankLines === true,
                splitLimit: Math.max(1_000, Math.min(4_000, Number.isFinite(composer.splitLimit) ? Math.floor(composer.splitLimit as number) : 2_000)),
                maxSplitParts: Math.max(0, Math.min(20, Number.isFinite(composer.maxSplitParts) ? Math.floor(composer.maxSplitParts as number) : 0)),
                attachmentThreshold: Math.max(0, Math.min(64_000, Number.isFinite(composer.attachmentThreshold) ? Math.floor(composer.attachmentThreshold as number) : 0)),
                counterWarningPercent: Math.max(50, Math.min(100, Number.isFinite(composer.counterWarningPercent) ? Math.floor(composer.counterWarningPercent as number) : 80)),
                timestampFormat: choice(composer.timestampFormat, ["full", "compact", "iso"] as const, "full")
            }
        },
        baseline: {
            layoutCollapse: baseline.layoutCollapse === true,
            collapsedRegions: [...new Set((Array.isArray(baseline.collapsedRegions) ? baseline.collapsedRegions : []).filter((region): region is SolcordLayoutRegion => ["guilds", "channels", "members"].includes(String(region))))].slice(0, 3),
            embedControls: baseline.embedControls === true,
            crossPlatformAutoscroll: baseline.crossPlatformAutoscroll === true,
            messageLinkPreview: baseline.messageLinkPreview === true,
            mediaShelf: (Array.isArray(baseline.mediaShelf) ? baseline.mediaShelf : []).flatMap((candidate, index) => {
                const item = record(candidate);
                if (typeof item.label !== "string") return [];
                const url = normalizeSolcordMediaShelfUrl(item.url);
                if (!url) return [];
                return [{
                        id: typeof item.id === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(item.id) ? item.id : `media-${index + 1}`,
                        label: item.label.trim().slice(0, 64) || "Saved media",
                        url,
                        kind: choice(item.kind, ["gif", "sticker", "emoji"] as const, "gif")
                    }];
            }).slice(0, 200)
        }
    };
}

export interface SolcordPulseSignal {
    id: string;
    priority: number;
    tone: "ok" | "attention" | "danger";
    label: string;
    detail: string;
    action?: string;
}

export function prioritizeSolcordPulse(signals: readonly SolcordPulseSignal[]): SolcordPulseSignal[] {
    const unique = new Map<string, SolcordPulseSignal>();
    for (const signal of signals) {
        if (!signal.id || unique.has(signal.id)) continue;
        unique.set(signal.id, {...signal, priority: Math.max(0, Math.min(100, Math.round(signal.priority)))});
    }
    return [...unique.values()].sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id)).slice(0, 3);
}

export interface SolcordPermissionCard {
    network: boolean;
    filesystem: boolean;
    patching: boolean;
    messageAccess: "none" | "metadata" | "content";
    accountContext: boolean;
    localStorage: boolean;
}

export function expandedSolcordPermissions(previous: SolcordPermissionCard, next: SolcordPermissionCard): string[] {
    const expanded: string[] = [];
    for (const key of ["network", "filesystem", "patching", "accountContext", "localStorage"] as const) {
        if (!previous[key] && next[key]) expanded.push(key);
    }
    const access = {none: 0, metadata: 1, content: 2} as const;
    if (access[next.messageAccess] > access[previous.messageAccess]) expanded.push(`messageAccess:${next.messageAccess}`);
    return expanded;
}

export interface SolcordCatalogCapabilitySignals {
    networkBehavior: readonly string[];
    accountActions: readonly string[];
    cleanupBehavior: unknown;
    tags: readonly string[];
}

/** Conservative presentation adapter for already-reviewed catalog signals; it grants no capability. */
export function inferSolcordPermissionCard(candidate: SolcordCatalogCapabilitySignals): SolcordPermissionCard {
    const network = candidate.networkBehavior.map(value => value.toLowerCase());
    const actions = candidate.accountActions.map(value => value.toLowerCase());
    const cleanup = JSON.stringify(candidate.cleanupBehavior).toLowerCase();
    const tags = candidate.tags.map(value => value.toLowerCase());
    const actionText = actions.join(" ");
    const hasExplicitNoNetwork = network.length > 0 && network.every(value => value === "no-static-network-signal");
    const content = /message|draft|composer|typing|upload|attachment/.test(actionText);
    const metadata = content || tags.some(tag => ["chat", "text", "server", "voice", "user", "role"].includes(tag));
    return {
        network: !hasExplicitNoNetwork,
        filesystem: /file|download|upload|config|storage/.test(`${actionText} ${cleanup}`),
        patching: /patch/.test(cleanup) || cleanup === "\"runtime_review_required\"",
        messageAccess: content ? "content" : metadata ? "metadata" : "none",
        accountContext: actions.some(value => value !== "no-static-account-action-signal"),
        localStorage: /storage|settings|config|data/.test(cleanup)
    };
}
