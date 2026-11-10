import Store from "@stores/base";
import JsonStore from "@stores/json";
import Config from "@stores/config";
import fs from "@polyfill/fs";
import crypto from "crypto";
import path from "path";
import {isSolcordBuiltInAddon} from "@common/solcord/builtin-addons";
import {recommendedSolcordSetupAddons, resolveSolcordSetupPlan, SOLCORD_RECOMMENDED_SETUP_ADDONS} from "@common/solcord/setup-catalog";
import {normalizeSolcordProductPreferences} from "@common/solcord/product";
import {SOLCORD_PRODUCT_IDENTITY} from "@common/solcord/product-identity";
import {defaultStrictPrivacyPreferences} from "@common/solcord/privacy";

import type {
    SolcordAddonMode,
    SolcordAddonProvider,
    SolcordCuratedAddonState,
    SolcordModuleId,
    SolcordModuleSettings,
    SolcordOnboardingState,
    SolcordPowerConsent,
    SolcordPowerExperimentId,
    SolcordProfile,
    SolcordSetupDraft,
    SolcordSetupTransactionRecord,
    SolcordSettingsDocument,
    SolcordSnapshot,
    SolcordThemeId,
    SolcordTimelinePolicy
} from "./contracts";


export const SOLCORD_SCHEMA_VERSION = 10;
export const SOLCORD_CONSENT_VERSION = 3;
export const SOLCORD_ONBOARDING_VERSION = 5;
const MAX_SNAPSHOTS = 20;
const MAX_LEDGER_ENTRIES = 100;
const MAX_PROFILES = 50;
const MAX_MIGRATION_ENTRIES = 30;
const MAX_SETUP_TRANSACTIONS = 10;

export const SOLCORD_THEMES: Array<{id: SolcordThemeId; name: string; fileName: string;}> = [
    {id: "solcord-default", name: "Solcord Default", fileName: "Solcord-Default.theme.css"},
    {id: "obsidian-thread", name: "Obsidian Thread", fileName: "Solcord-ObsidianThread.theme.css"},
    {id: "carbon-ember", name: "Carbon Ember", fileName: "Solcord-CarbonEmber.theme.css"},
    {id: "midnight-glass", name: "Midnight Glass", fileName: "Solcord-MidnightGlass.theme.css"},
    {id: "paper-signal", name: "Paper Signal", fileName: "Solcord-PaperSignal.theme.css"},
    {id: "threadline", name: "Threadline", fileName: "Solcord-Threadline.theme.css"},
    {id: "signal-block", name: "Signal Block", fileName: "Solcord-SignalBlock.theme.css"},
    {id: "relay-classic", name: "Relay Classic", fileName: "Solcord-RelayClassic.theme.css"},
    {id: "workshop", name: "Workshop", fileName: "Solcord-Workshop.theme.css"},
    {id: "quiet-read", name: "Quiet Read", fileName: "Solcord-QuietRead.theme.css"},
    {id: "night-transit", name: "Night Transit", fileName: "Solcord-NightTransit.theme.css"}
];

export const SOLCORD_PRESET_ADDONS = [
    "DoNotTrack", "InvisibleTyping", "DoubleClickToReply", "PinDMs", "MessagePeek", "FileNameRandomization", "BlurNSFW",
    "VoiceMessages", "VoiceActivity", "ShowSpectators", "CallTimeCounter", "BetterVolume", "AudioOptions", "NotifyWhenMuted",
    "Translator", "SplitLargeMessages", "CharCounter", "SpellCheck", "InsertTimestamps",
    "ServerHider", "ServerDetails", "ReadAllNotificationsButton", "BetterFolders", "PersonalPins", "PermissionsViewer", "ActivityFilter",
    "DiscordEffects", "CompleteTimestamps", "BetterFriendList", "BetterAnimations", "EditServers", "ImageUtilities", "HideDisabledEmojis", "BetterSearchPage", "RevealAllSpoilers", "ViewProfilePicture"
] as const;

export const SOLCORD_POWER_EXPERIMENTS: SolcordPowerExperimentId[] = ["voice-anchor", "expression-relay", "decor", "fake-deafen", "fake-mute", "stream-rtc"];

export function reopenOnboardingState(current: SolcordOnboardingState): SolcordOnboardingState {
    return {
        version: SOLCORD_ONBOARDING_VERSION,
        status: "pending",
        lastStep: current.status === "skipped" ? current.lastStep : 0,
        ...(current.status === "skipped" && current.draft ? {draft: clone(current.draft)} : {})
    };
}

export const MODULE_DEFAULTS: Record<SolcordModuleId, SolcordModuleSettings> = {
    "activity-bridge": {enabled: true, values: {}},
    "plugin-doctor": {enabled: true, values: {failureThreshold: 3, failureWindowMinutes: 10}},
    "drift-radar": {enabled: true, values: {}},
    "performance-hud": {enabled: true, values: {showOverlay: false, sampleSeconds: 5}},
    "workspace-profiles": {enabled: true, values: {activeProfile: "activities"}},
    "command-deck": {enabled: true, values: {shortcut: "Ctrl+Alt+K"}},
    "link-lens": {enabled: false, values: {confirmAllExternal: false, removeTrackers: true}},
    "stream-shield": {enabled: false, values: {manualActive: false, previewActive: false, redactGuilds: true, redactChannels: true, redactDMs: true, redactNotifications: true, redactNotes: true, redactAccount: true}},
    "stream-audience-guard": {enabled: false, values: {preventStart: true, stopOnJoin: true, stopOnWatch: false}},
    "settings-time-machine": {enabled: true, values: {}},
    "accessibility-toolkit": {enabled: false, values: {reducedMotion: true, roleContrast: true, readingRuler: false, readingWidth: 0}},
    "friend-watch": {enabled: false, values: {retentionDays: 30, digest: "daily"}},
    "message-timeline": {enabled: false, values: {scope: "dm-only", retention: "7-days", content: "text-only"}}
};

function clone<T>(value: T): T {
    return structuredClone(value);
}

function freezeSettingsSnapshot<T>(value: T): T {
    if (value && typeof value === "object") {
        for (const child of Object.values(value)) freezeSettingsSnapshot(child);
        Object.freeze(value);
    }
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function stringChoice<T extends string | number>(value: unknown, choices: readonly T[], fallback: T): T {
    return (typeof value === "string" || typeof value === "number") && choices.includes(value as T) ? value as T : fallback;
}

export function defaultTimelinePolicy(): SolcordTimelinePolicy {
    return {
        enabled: false,
        scope: "dm-only",
        serverChannelIds: [],
        retention: "7-days",
        content: "text-only",
        textBudgetBytes: 262_144_000,
        mediaBudgetBytes: 1_073_741_824,
        filters: {
            ignoreSelf: false,
            ignoreBots: false,
            ignoreBlockedUsers: false,
            ignoreMutedChannels: false,
            ignoreMutedGuilds: false,
            ignoreNsfw: false,
            alwaysLogDms: true,
            alwaysLogGhostPings: true
        },
        display: {
            showDeletedMessages: true,
            showEditedMessages: true,
            showPurgedMessages: true,
            showDeletedCount: true,
            showEditedCount: true,
            reverseOrder: false,
            maxShownEdits: 10
        }
    };
}

export function deferOnboardingState(current: SolcordOnboardingState, completedAt = Date.now()): SolcordOnboardingState {
    return {
        version: SOLCORD_ONBOARDING_VERSION,
        status: "skipped",
        lastStep: current.lastStep,
        ...(current.draft ? {draft: clone(current.draft)} : {}),
        completedAt
    };
}

function normalizeTimelinePolicy(value: unknown): SolcordTimelinePolicy {
    const record = isRecord(value) ? value : {};
    const filters = isRecord(record.filters) ? record.filters : {};
    const display = isRecord(record.display) ? record.display : {};
    const ids = Array.isArray(record.serverChannelIds)
        ? [...new Set(record.serverChannelIds.filter((id): id is string => typeof id === "string" && /^\d{1,32}$/.test(id)))].slice(0, 500)
        : [];
    return {
        enabled: record.enabled === true,
        scope: stringChoice(record.scope, ["dm-only", "selected-channels"] as const, "dm-only"),
        serverChannelIds: ids,
        retention: stringChoice(record.retention, ["session", "24-hours", "7-days", "30-days", "90-days", "manual"] as const, "7-days"),
        content: stringChoice(record.content, ["text-only", "text-and-metadata", "encrypted-media"] as const, "text-only"),
        textBudgetBytes: 262_144_000,
        mediaBudgetBytes: stringChoice(record.mediaBudgetBytes, [268_435_456, 1_073_741_824, 5_368_709_120] as const, 1_073_741_824),
        filters: {
            ignoreSelf: filters.ignoreSelf === true,
            ignoreBots: filters.ignoreBots === true,
            ignoreBlockedUsers: filters.ignoreBlockedUsers === true,
            ignoreMutedChannels: filters.ignoreMutedChannels === true,
            ignoreMutedGuilds: filters.ignoreMutedGuilds === true,
            ignoreNsfw: filters.ignoreNsfw === true,
            alwaysLogDms: filters.alwaysLogDms !== false,
            alwaysLogGhostPings: filters.alwaysLogGhostPings !== false
        },
        display: {
            showDeletedMessages: display.showDeletedMessages !== false,
            showEditedMessages: display.showEditedMessages !== false,
            showPurgedMessages: display.showPurgedMessages !== false,
            showDeletedCount: display.showDeletedCount !== false,
            showEditedCount: display.showEditedCount !== false,
            reverseOrder: display.reverseOrder === true,
            maxShownEdits: Math.floor(boundedNumber(display.maxShownEdits, 10, 1, 100))
        }
    };
}

export function defaultCuratedAddons(): Record<string, SolcordCuratedAddonState> {
    const recommended = new Set<string>(SOLCORD_RECOMMENDED_SETUP_ADDONS);
    return Object.fromEntries(SOLCORD_PRESET_ADDONS.map(name => [name, {
        selected: recommended.has(name),
        enabled: false,
        mode: name === "SplitLargeMessages" ? "guarded" : "default",
        provider: isSolcordBuiltInAddon(name, name === "SplitLargeMessages" ? "guarded" : "default") ? "prefer-solcord" : "prefer-community"
    }])) as Record<string, SolcordCuratedAddonState>;
}

function normalizeAddonMode(value: unknown, name: string): SolcordAddonMode {
    const fallback: SolcordAddonMode = name === "SplitLargeMessages" ? "guarded" : "default";
    return stringChoice(value, ["default", "guarded", "native"] as const, fallback);
}

function normalizeAddonProvider(value: unknown, name?: string, mode?: SolcordAddonMode): SolcordAddonProvider {
    const fallback = name && isSolcordBuiltInAddon(name, mode) ? "prefer-solcord" : "prefer-community";
    return stringChoice(value, ["prefer-community", "prefer-solcord"] as const, fallback);
}

function normalizeCuratedAddons(value: unknown): Record<string, SolcordCuratedAddonState> {
    const record = isRecord(value) ? value : {};
    const normalized = defaultCuratedAddons();
    for (const name of SOLCORD_PRESET_ADDONS) {
        const candidate = record[name];
        if (!isRecord(candidate)) continue;
        const mode = normalizeAddonMode(candidate.mode, name);
        const builtInCanExecute = !isSolcordBuiltInAddon(name, mode)
            || resolveSolcordSetupPlan([name], {[name]: mode}).executableAddons.includes(name);
        normalized[name] = {
            selected: typeof candidate.selected === "boolean" ? candidate.selected : normalized[name].selected,
            enabled: candidate.enabled === true && builtInCanExecute,
            mode,
            provider: normalizeAddonProvider(candidate.provider, name, mode),
            ...(typeof candidate.reviewedSha256 === "string" && /^[0-9a-f]{64}$/i.test(candidate.reviewedSha256) ? {reviewedSha256: candidate.reviewedSha256.toLowerCase()} : {}),
            ...(typeof candidate.quarantineReason === "string" ? {quarantineReason: candidate.quarantineReason.slice(0, 160)} : {})
        };
    }
    return normalized;
}

function defaultPowerLab(): Record<SolcordPowerExperimentId, SolcordPowerConsent> {
    return Object.fromEntries(SOLCORD_POWER_EXPERIMENTS.map(id => [id, {enabled: false, acknowledgementVersion: 0}])) as Record<SolcordPowerExperimentId, SolcordPowerConsent>;
}

function normalizePowerLab(value: unknown): Record<SolcordPowerExperimentId, SolcordPowerConsent> {
    const record = isRecord(value) ? value : {};
    const result = defaultPowerLab();
    for (const id of SOLCORD_POWER_EXPERIMENTS) {
        const candidate = record[id];
        if (!isRecord(candidate)) continue;
        result[id] = {
            enabled: candidate.enabled === true && boundedNumber(candidate.acknowledgementVersion, 0, 0, 100) === SOLCORD_CONSENT_VERSION,
            acknowledgementVersion: boundedNumber(candidate.acknowledgementVersion, 0, 0, 100),
            ...(typeof candidate.acknowledgedAt === "number" ? {acknowledgedAt: boundedNumber(candidate.acknowledgedAt, 0, 0, Number.MAX_SAFE_INTEGER)} : {})
        };
    }
    return result;
}

function normalizeOnboarding(value: unknown): SolcordOnboardingState {
    const record = isRecord(value) ? value : {};
    const priorVersion = boundedNumber(record.version, 0, 0, SOLCORD_ONBOARDING_VERSION);
    const priorStatus = stringChoice(record.status, ["pending", "complete", "skipped"] as const, "pending");
    const requiresProviderReview = priorVersion < SOLCORD_ONBOARDING_VERSION && priorStatus !== "pending";
    return {
        version: SOLCORD_ONBOARDING_VERSION,
        status: requiresProviderReview ? "pending" : priorStatus,
        lastStep: requiresProviderReview ? 0 : boundedNumber(record.lastStep, 0, 0, 4),
        ...(isRecord(record.draft) ? {draft: normalizeSetupDraft(record.draft)} : {}),
        ...(!requiresProviderReview && typeof record.completedAt === "number" ? {completedAt: boundedNumber(record.completedAt, 0, 0, Number.MAX_SAFE_INTEGER)} : {})
    };
}

function normalizeModule(id: SolcordModuleId, value: unknown): SolcordModuleSettings {
    const defaults = MODULE_DEFAULTS[id];
    if (!isRecord(value)) return clone(defaults);
    const values = clone(defaults.values);
    if (isRecord(value.values)) {
        for (const [key, fallback] of Object.entries(defaults.values)) {
            const candidate = value.values[key];
            if (typeof candidate === typeof fallback) values[key] = candidate;
        }
    }
    if (id === "performance-hud") values.sampleSeconds = boundedNumber(values.sampleSeconds, 5, 2, 30);
    if (id === "plugin-doctor") {
        values.failureThreshold = boundedNumber(values.failureThreshold, 3, 3, 10);
        values.failureWindowMinutes = boundedNumber(values.failureWindowMinutes, 10, 1, 60);
    }
    if (id === "accessibility-toolkit") values.readingWidth = boundedNumber(values.readingWidth, 0, 0, 1_200);
    if (id === "friend-watch") {
        values.retentionDays = stringChoice(values.retentionDays, [7, 30, 90] as const, 30);
        values.digest = stringChoice(values.digest, ["off", "daily", "per-event"] as const, "daily");
    }
    if (id === "message-timeline") {
        values.scope = stringChoice(values.scope, ["dm-only", "selected-channels"] as const, "dm-only");
        values.retention = stringChoice(values.retention, ["session", "24-hours", "7-days", "30-days", "90-days", "manual"] as const, "7-days");
        values.content = stringChoice(values.content, ["text-only", "text-and-metadata", "encrypted-media"] as const, "text-only");
    }
    return {enabled: typeof value.enabled === "boolean" ? value.enabled : defaults.enabled, values};
}

function normalizeProfile(value: unknown): SolcordProfile | null {
    if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string" || !isRecord(value.modules)) return null;
    const normalizedModules = {} as Record<SolcordModuleId, SolcordModuleSettings>;
    for (const id of Object.keys(MODULE_DEFAULTS) as SolcordModuleId[]) normalizedModules[id] = normalizeModule(id, value.modules[id]);
    const selectedPlugins = normalizeAddonFileNames(value.selectedPlugins, "plugin");
    const selectedThemes = normalizeAddonFileNames(value.selectedThemes, "theme");
    return {
        id: value.id.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64) || "profile",
        name: value.name.slice(0, 80),
        createdAt: boundedNumber(value.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
        updatedAt: boundedNumber(value.updatedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
        modules: normalizedModules,
        selectedPlugins,
        selectedThemes,
        includesThirdPartyAddons: value.includesThirdPartyAddons === true && (selectedPlugins.length > 0 || selectedThemes.length > 0)
    };
}

function normalizeProfiles(value: unknown): SolcordProfile[] {
    if (!Array.isArray(value)) return [];
    const profiles: SolcordProfile[] = [];
    const ids = new Set<string>();
    for (const candidate of value) {
        const profile = normalizeProfile(candidate);
        if (!profile || ids.has(profile.id)) continue;
        ids.add(profile.id);
        profiles.push(profile);
        if (profiles.length === MAX_PROFILES) break;
    }
    return profiles;
}

function normalizeAddonFileNames(value: unknown, kind: "plugin" | "theme"): string[] {
    if (!Array.isArray(value)) return [];
    const suffix = kind === "plugin" ? ".plugin.js" : ".theme.css";
    const pattern = kind === "plugin"
        ? /^[a-zA-Z0-9][a-zA-Z0-9 _&().+—-]{0,180}\.plugin\.js$/
        : /^[a-zA-Z0-9][a-zA-Z0-9 _&().+—-]{0,180}\.theme\.css$/;
    return [...new Set(value.filter((item): item is string => typeof item === "string" && item.endsWith(suffix) && pattern.test(item)))].slice(0, 100);
}

function safeAddonFileName(value: string, kind: "plugin" | "theme"): boolean {
    const suffix = kind === "plugin" ? ".plugin.js" : ".theme.css";
    const hasForbiddenCharacter = [...value].some(character => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127 || "<>:\"/\\|?*".includes(character);
    });
    return value.length > suffix.length
        && value.length <= 220
        && value.endsWith(suffix)
        && value.trim() === value
        && !hasForbiddenCharacter
        && !value.endsWith(".")
        && !value.endsWith(" ");
}

function normalizeAddonStateRecord(value: unknown, kind: "plugin" | "theme"): Record<string, boolean> {
    if (!isRecord(value)) return {};
    return Object.fromEntries(Object.entries(value)
        .filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean" && safeAddonFileName(entry[0], kind))
        .slice(0, 1_000));
}

function defaultProfile(id: string, name: string, enabled: SolcordModuleId[]): SolcordProfile {
    const modules = clone(MODULE_DEFAULTS);
    for (const key of Object.keys(modules) as SolcordModuleId[]) modules[key].enabled = enabled.includes(key);
    const now = Date.now();
    return {id, name, createdAt: now, updatedAt: now, modules, selectedPlugins: [], selectedThemes: [], includesThirdPartyAddons: false};
}

export function defaultProfiles(): SolcordProfile[] {
    const safety: SolcordModuleId[] = ["activity-bridge", "plugin-doctor", "drift-radar", "settings-time-machine", "command-deck"];
    return [
        defaultProfile("activities", "Activities", [...safety, "performance-hud"]),
        defaultProfile("gaming", "Gaming", [...safety, "performance-hud"]),
        defaultProfile("calls", "Calls", [...safety, "performance-hud"]),
        defaultProfile("streaming", "Streaming", [...safety, "performance-hud", "stream-shield"]),
        defaultProfile("focus", "Focus", [...safety, "accessibility-toolkit"])
    ];
}

function reconcileModulePreferenceBindings(
    modules: Record<SolcordModuleId, SolcordModuleSettings>,
    productPreferences: SolcordSettingsDocument["productPreferences"],
    authority: "modules" | "preferences"
): SolcordSettingsDocument["productPreferences"] {
    if (authority === "preferences") {
        modules["link-lens"].enabled = productPreferences.safety.linkLens;
        modules["friend-watch"].enabled = productPreferences.friendWatch.enabled;
        modules["friend-watch"].values.retentionDays = productPreferences.friendWatch.retentionDays;
        modules["friend-watch"].values.digest = productPreferences.friendWatch.digest;
        return productPreferences;
    }

    productPreferences.safety.linkLens = modules["link-lens"].enabled;
    productPreferences.friendWatch.enabled = modules["friend-watch"].enabled;
    productPreferences.friendWatch.retentionDays = modules["friend-watch"].values.retentionDays as 7 | 30 | 90;
    productPreferences.friendWatch.digest = modules["friend-watch"].values.digest as "off" | "daily" | "per-event";
    return productPreferences;
}

export function normalizeSolcordDocument(raw: unknown): SolcordSettingsDocument {
    const record = isRecord(raw) ? raw : {};
    const hasPersistedState = Object.keys(record).length > 0;
    const rawSchemaVersion = boundedNumber(record.schemaVersion, 0, 0, 10_000);
    const rawModules = isRecord(record.modules) ? record.modules : {};
    const modules = {} as Record<SolcordModuleId, SolcordModuleSettings>;
    for (const id of Object.keys(MODULE_DEFAULTS) as SolcordModuleId[]) modules[id] = normalizeModule(id, rawModules[id]);
    if (rawSchemaVersion < 4) modules["link-lens"].enabled = false;

    const profiles = normalizeProfiles(record.profiles);
    if (!profiles.length) profiles.push(...defaultProfiles());
    if (rawSchemaVersion < 4) for (const profile of profiles) profile.modules["link-lens"].enabled = false;

    const snapshots = Array.isArray(record.snapshots)
        ? record.snapshots.filter(isRecord).flatMap(snapshot => {
            if (typeof snapshot.id !== "string" || typeof snapshot.reason !== "string" || !isRecord(snapshot.modules) || !Array.isArray(snapshot.profiles)) return [];
            const snapshotModules = {} as Record<SolcordModuleId, SolcordModuleSettings>;
            for (const id of Object.keys(MODULE_DEFAULTS) as SolcordModuleId[]) snapshotModules[id] = normalizeModule(id, snapshot.modules[id]);
            if (rawSchemaVersion < 4) snapshotModules["link-lens"].enabled = false;
            const snapshotProductPreferences = normalizeSolcordProductPreferences(snapshot.productPreferences);
            if (rawSchemaVersion < 4) snapshotProductPreferences.safety.linkLens = false;
            reconcileModulePreferenceBindings(snapshotModules, snapshotProductPreferences, rawSchemaVersion < 5 ? "preferences" : "modules");
            return [{
                id: snapshot.id,
                reason: snapshot.reason.slice(0, 120),
                createdAt: boundedNumber(snapshot.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
                modules: snapshotModules,
                profiles: normalizeProfiles(snapshot.profiles),
                selectedTheme: stringChoice(snapshot.selectedTheme, SOLCORD_THEMES.map(theme => theme.id), "solcord-default"),
                curatedAddons: normalizeCuratedAddons(snapshot.curatedAddons),
                timelinePolicy: normalizeTimelinePolicy(snapshot.timelinePolicy),
                productPreferences: snapshotProductPreferences,
                activePlugins: normalizeAddonFileNames(snapshot.activePlugins, "plugin"),
                activeThemes: normalizeAddonFileNames(snapshot.activeThemes, "theme")
            } satisfies SolcordSnapshot];
        }).slice(-MAX_SNAPSHOTS)
        : [];

    const updateLedger = Array.isArray(record.updateLedger)
        ? record.updateLedger.filter(isRecord).flatMap(entry => {
            if (typeof entry.detail !== "string" || typeof entry.kind !== "string") return [];
            if (!["schema", "profile", "setting", "rollback", "runtime"].includes(entry.kind)) return [];
            return [{
                at: boundedNumber(entry.at, Date.now(), 0, Number.MAX_SAFE_INTEGER),
                kind: entry.kind as "schema" | "profile" | "setting" | "rollback" | "runtime",
                detail: entry.detail.slice(0, 160),
                version: typeof entry.version === "string" ? entry.version.slice(0, 32) : "1.0.0"
            }];
        }).slice(-MAX_LEDGER_ENTRIES)
        : [];

    const migrationProvenance = Array.isArray(record.migrationProvenance)
        ? record.migrationProvenance.filter(isRecord).flatMap(entry => {
            if (typeof entry.detail !== "string") return [];
            return [{
                at: boundedNumber(entry.at, Date.now(), 0, Number.MAX_SAFE_INTEGER),
                fromSchema: boundedNumber(entry.fromSchema, 0, 0, SOLCORD_SCHEMA_VERSION),
                toSchema: boundedNumber(entry.toSchema, SOLCORD_SCHEMA_VERSION, 0, SOLCORD_SCHEMA_VERSION),
                detail: entry.detail.slice(0, 200)
            }];
        }).slice(-MAX_MIGRATION_ENTRIES)
        : [];

    if (hasPersistedState && rawSchemaVersion !== SOLCORD_SCHEMA_VERSION) {
        migrationProvenance.push({
            at: Date.now(),
            fromSchema: rawSchemaVersion,
            toSchema: SOLCORD_SCHEMA_VERSION,
            detail: "Added bounded Composer Toolkit preferences for reply modifiers and guarded split behavior."
        });
        migrationProvenance.splice(0, Math.max(0, migrationProvenance.length - MAX_MIGRATION_ENTRIES));
    }

    const setupTransactions = Array.isArray(record.setupTransactions)
        ? record.setupTransactions.filter(isRecord).flatMap(entry => {
            if (typeof entry.id !== "string" || !/^[a-z0-9]+-[0-9a-f]{16}$/.test(entry.id) || typeof entry.snapshotId !== "string") return [];
            const priorAddonStates = normalizeAddonStateRecord(entry.priorAddonStates, "plugin");
            const priorThemeStates = normalizeAddonStateRecord(entry.priorThemeStates, "theme");
            const providerArchiveTransactionId = typeof entry.providerArchiveTransactionId === "string" && /^[a-z0-9]+-[0-9a-f]{16}$/.test(entry.providerArchiveTransactionId) ? entry.providerArchiveTransactionId : undefined;
            return [{id: entry.id, at: boundedNumber(entry.at, Date.now(), 0, Number.MAX_SAFE_INTEGER), snapshotId: entry.snapshotId.slice(0, 96), priorAddonStates, priorThemeStates, ...(providerArchiveTransactionId ? {providerArchiveTransactionId} : {})} satisfies SolcordSetupTransactionRecord];
        }).slice(-MAX_SETUP_TRANSACTIONS)
        : [];

    const curatedAddons = normalizeCuratedAddons(record.curatedAddons);
    if (rawSchemaVersion < 5) {
        for (const name of SOLCORD_PRESET_ADDONS) {
            const state = curatedAddons[name];
            if (isSolcordBuiltInAddon(name, state.mode)) state.provider = "prefer-solcord";
        }
    }

    const productPreferences = normalizeSolcordProductPreferences(record.productPreferences);
    if (rawSchemaVersion < 4) productPreferences.safety.linkLens = false;
    if (hasPersistedState && rawSchemaVersion < 7 && productPreferences.privacy.migratedAt === undefined) {
        productPreferences.privacy = {...defaultStrictPrivacyPreferences(), migrationPending: true};
    }
    reconcileModulePreferenceBindings(modules, productPreferences, rawSchemaVersion < 5 ? "preferences" : "modules");

    return {
        schemaVersion: 10,
        consentVersion: SOLCORD_CONSENT_VERSION,
        onboarding: normalizeOnboarding(record.onboarding),
        selectedTheme: stringChoice(record.selectedTheme, SOLCORD_THEMES.map(theme => theme.id), "solcord-default"),
        curatedAddons,
        timelinePolicy: normalizeTimelinePolicy(record.timelinePolicy),
        productPreferences,
        powerLab: rawSchemaVersion < 4 ? defaultPowerLab() : normalizePowerLab(record.powerLab),
        migrationProvenance,
        setupTransactions,
        modules,
        profiles,
        snapshots,
        updateLedger
    };
}

export function diffModules(before: Record<SolcordModuleId, SolcordModuleSettings>, after: Record<SolcordModuleId, SolcordModuleSettings>): string[] {
    const changes: string[] = [];
    for (const id of Object.keys(MODULE_DEFAULTS) as SolcordModuleId[]) {
        if (before[id].enabled !== after[id].enabled) changes.push(`${id}: ${before[id].enabled ? "on" : "off"} → ${after[id].enabled ? "on" : "off"}`);
        const keys = new Set([...Object.keys(before[id].values), ...Object.keys(after[id].values)]);
        for (const key of keys) {
            if (JSON.stringify(before[id].values[key]) !== JSON.stringify(after[id].values[key])) changes.push(`${id}.${key}`);
        }
    }
    return changes;
}

function portableCuratedAddons(document: SolcordSettingsDocument): Record<string, SolcordCuratedAddonState> {
    return Object.fromEntries(Object.entries(document.curatedAddons).map(([name, state]) => [name, {
        selected: state.selected,
        enabled: false,
        mode: state.mode,
        provider: state.provider
    }])) as Record<string, SolcordCuratedAddonState>;
}

function portableProductPreferences(document: SolcordSettingsDocument): SolcordSettingsDocument["productPreferences"] {
    const preferences = clone(document.productPreferences);
    preferences.nativeSuite.pinnedDmIds = [];
    preferences.nativeSuite.hiddenGuildIds = [];
    preferences.nativeSuite.guildAliases = {};
    preferences.nativeSuite.focusChannelIds = [];
    preferences.nativeSuite.translation = {...preferences.nativeSuite.translation, endpoint: ""};
    preferences.baseline.mediaShelf = [];
    return preferences;
}

export function serializeSolcordSettingsExport(document: SolcordSettingsDocument): string {
    const modules = clone(document.modules);
    modules["message-timeline"].values.scope = "dm-only";
    const exported = {
        format: "solcord-settings",
        version: 2,
        schemaVersion: document.schemaVersion,
        selectedTheme: document.selectedTheme,
        // Runtime acceptance is machine-local transaction evidence, not a
        // portable preference. Imports must re-stage and re-validate bytes.
        curatedAddons: portableCuratedAddons(document),
        timelinePolicy: {
            ...document.timelinePolicy,
            scope: "dm-only",
            serverChannelIds: []
        },
        productPreferences: portableProductPreferences(document),
        modules,
        profiles: document.profiles,
        updateLedger: document.updateLedger,
        migrationProvenance: document.migrationProvenance
    };
    return `${JSON.stringify(exported, null, 2)}\n`;
}

function booleanLabel(value: boolean): string {
    return value ? "on" : "off";
}

export function previewSolcordImportChanges(current: SolcordSettingsDocument, candidate: SolcordSettingsDocument): string[] {
    const changes = diffModules(current.modules, candidate.modules);
    const currentProfiles = new Map(current.profiles.map(profile => [profile.id, profile]));
    const candidateProfiles = new Map(candidate.profiles.map(profile => [profile.id, profile]));
    for (const id of new Set([...currentProfiles.keys(), ...candidateProfiles.keys()])) {
        const previous = currentProfiles.get(id);
        const next = candidateProfiles.get(id);
        if (!previous) changes.push(`profile ${id}: add`);
        else if (!next) changes.push(`profile ${id}: remove`);
        else if (JSON.stringify(previous) !== JSON.stringify(next)) changes.push(`profile ${id}: change`);
    }

    if (current.selectedTheme !== candidate.selectedTheme) changes.push(`theme: ${current.selectedTheme} → ${candidate.selectedTheme}`);
    for (const name of SOLCORD_PRESET_ADDONS) {
        const previous = current.curatedAddons[name];
        const next = candidate.curatedAddons[name];
        if (previous.selected !== next.selected) changes.push(`${name} selected: ${booleanLabel(previous.selected)} → ${booleanLabel(next.selected)}`);
        if (previous.enabled !== next.enabled) changes.push(`${name} enabled: ${booleanLabel(previous.enabled)} → ${booleanLabel(next.enabled)}`);
        if (previous.mode !== next.mode) changes.push(`${name} mode: ${previous.mode} → ${next.mode}`);
        if (previous.provider !== next.provider) changes.push(`${name} provider: ${previous.provider} → ${next.provider}`);
        if (previous.reviewedSha256 !== next.reviewedSha256) changes.push(`${name} review receipt: ${previous.reviewedSha256 ? "present" : "none"} → ${next.reviewedSha256 ? "present" : "none"}`);
        if (previous.quarantineReason !== next.quarantineReason) changes.push(`${name} quarantine: ${previous.quarantineReason ? "present" : "none"} → ${next.quarantineReason ? "present" : "none"}`);
    }

    const previousPolicy = current.timelinePolicy;
    const nextPolicy = candidate.timelinePolicy;
    if (previousPolicy.enabled !== nextPolicy.enabled) changes.push(`Message Timeline enabled: ${booleanLabel(previousPolicy.enabled)} → ${booleanLabel(nextPolicy.enabled)}`);
    if (previousPolicy.scope !== nextPolicy.scope) changes.push(`Message Timeline scope: ${previousPolicy.scope} → ${nextPolicy.scope}`);
    if (JSON.stringify(previousPolicy.serverChannelIds) !== JSON.stringify(nextPolicy.serverChannelIds)) {
        changes.push(`Message Timeline selected channels: ${previousPolicy.serverChannelIds.length} → ${nextPolicy.serverChannelIds.length} (identifiers hidden)`);
    }
    if (previousPolicy.retention !== nextPolicy.retention) changes.push(`Message Timeline retention: ${previousPolicy.retention} → ${nextPolicy.retention}`);
    if (previousPolicy.content !== nextPolicy.content) changes.push(`Message Timeline content: ${previousPolicy.content} → ${nextPolicy.content}`);
    if (previousPolicy.textBudgetBytes !== nextPolicy.textBudgetBytes) changes.push(`Message Timeline text budget: ${previousPolicy.textBudgetBytes} → ${nextPolicy.textBudgetBytes} bytes`);
    if (previousPolicy.mediaBudgetBytes !== nextPolicy.mediaBudgetBytes) changes.push(`Message Timeline media budget: ${previousPolicy.mediaBudgetBytes} → ${nextPolicy.mediaBudgetBytes} bytes`);
    if (JSON.stringify(current.productPreferences) !== JSON.stringify(candidate.productPreferences)) changes.push("Control Center appearance, safety, or People preferences");

    const resetPowerLab = defaultPowerLab();
    if (JSON.stringify(current.powerLab) !== JSON.stringify(resetPowerLab)) {
        const acknowledged = Object.values(current.powerLab).filter(consent => consent.acknowledgementVersion > 0 || consent.acknowledgedAt).length;
        const enabled = Object.values(current.powerLab).filter(consent => consent.enabled).length;
        changes.push(`Power Lab: clear ${acknowledged} acknowledgement(s) and disable ${enabled} experiment(s)`);
    }
    return changes;
}

export interface SolcordImportPreview {
    changes: string[];
    fingerprint: string;
}

function importState(document: SolcordSettingsDocument): object {
    return {
        modules: document.modules,
        profiles: document.profiles,
        selectedTheme: document.selectedTheme,
        curatedAddons: document.curatedAddons,
        timelinePolicy: document.timelinePolicy,
        productPreferences: document.productPreferences,
        powerLab: document.powerLab
    };
}

export function createSolcordImportPreview(current: SolcordSettingsDocument, candidate: SolcordSettingsDocument): SolcordImportPreview {
    const normalizedPair = JSON.stringify({current: importState(current), candidate: importState(candidate)});
    return {
        changes: previewSolcordImportChanges(current, candidate),
        fingerprint: crypto.createHash("sha256").update(normalizedPair, "utf8").digest("hex")
    };
}

export function verifySolcordImportAtApply(current: SolcordSettingsDocument, text: string, expectedFingerprint: string): SolcordSettingsDocument | undefined {
    if (!/^[0-9a-f]{64}$/.test(expectedFingerprint)) return;
    const candidate = parseSolcordImport(text);
    if (!candidate) return;
    if (createSolcordImportPreview(current, candidate).fingerprint !== expectedFingerprint) return;
    return candidate;
}

export function restoreSnapshotState(document: SolcordSettingsDocument, snapshotId: string): Pick<SolcordSettingsDocument, "modules" | "profiles" | "selectedTheme" | "curatedAddons" | "timelinePolicy" | "productPreferences"> | undefined {
    const snapshot = document.snapshots.find(item => item.id === snapshotId);
    if (!snapshot) return;
    return {
        modules: clone(snapshot.modules),
        profiles: snapshot.profiles.length ? clone(snapshot.profiles) : clone(document.profiles),
        selectedTheme: snapshot.selectedTheme,
        curatedAddons: clone(snapshot.curatedAddons),
        timelinePolicy: clone(snapshot.timelinePolicy),
        productPreferences: clone(snapshot.productPreferences)
    };
}

export function parseSolcordImport(text: string): SolcordSettingsDocument | undefined {
    try {
        const parsed: unknown = JSON.parse(text);
        if (!isRecord(parsed) || parsed.format !== "solcord-settings" || ![1, 2].includes(Number(parsed.version))) return;
        const normalized = normalizeSolcordDocument(parsed);
        normalized.curatedAddons = portableCuratedAddons(normalized);
        normalized.setupTransactions = [];
        return normalized;
    }
    catch {
        return;
    }
}

export function normalizeSetupDraft(value: unknown): SolcordSetupDraft {
    const record = isRecord(value) ? value : {};
    const selected = Array.isArray(record.selectedAddons)
        ? [...new Set(record.selectedAddons.filter((name): name is typeof SOLCORD_PRESET_ADDONS[number] => typeof name === "string" && SOLCORD_PRESET_ADDONS.includes(name as typeof SOLCORD_PRESET_ADDONS[number])))]
        : recommendedSolcordSetupAddons();
    const rawModes = isRecord(record.addonModes) ? record.addonModes : {};
    const rawProviders = isRecord(record.addonProviders) ? record.addonProviders : {};
    return {
        preset: stringChoice(record.preset, ["recommended", "minimal", "power-user"] as const, "recommended"),
        selectedTheme: stringChoice(record.selectedTheme, SOLCORD_THEMES.map(theme => theme.id), "solcord-default"),
        selectedAddons: selected,
        addonModes: Object.fromEntries(SOLCORD_PRESET_ADDONS.map(name => [name, normalizeAddonMode(rawModes[name], name)])),
        addonProviders: Object.fromEntries(SOLCORD_PRESET_ADDONS.map(name => {
            const mode = normalizeAddonMode(rawModes[name], name);
            return [name, normalizeAddonProvider(rawProviders[name], name, mode)];
        })),
        timelinePolicy: normalizeTimelinePolicy(record.timelinePolicy),
        productPreferences: normalizeSolcordProductPreferences(record.productPreferences)
    };
}

export function previewSetupChanges(document: SolcordSettingsDocument, rawDraft: unknown): string[] {
    const draft = normalizeSetupDraft(rawDraft);
    const plan = resolveSolcordSetupPlan(draft.selectedAddons, draft.addonModes);
    const skipped = new Map(plan.skipped.map(decision => [decision.name, decision]));
    const changes: string[] = [];
    if (document.selectedTheme !== draft.selectedTheme) changes.push(`theme: ${document.selectedTheme} → ${draft.selectedTheme}`);
    for (const name of SOLCORD_PRESET_ADDONS) {
        const skippedDecision = skipped.get(name);
        if (skippedDecision) changes.push(`${name}: skip this run — ${skippedDecision.statusLabel}`);
        const selected = draft.selectedAddons.includes(name);
        const currentlyBuiltIn = isSolcordBuiltInAddon(name, document.curatedAddons[name].mode);
        if (document.curatedAddons[name].selected !== selected) {
            if (selected && skippedDecision) changes.push(`${name}: remember request for later review`);
            else if (!selected && document.curatedAddons[name].enabled && !currentlyBuiltIn) changes.push(`${name}: remove from Solcord selection; existing owner file remains unchanged`);
            else changes.push(`${name}: ${selected ? "select" : "deselect"}`);
        }
        if (selected && !document.curatedAddons[name].enabled) {
            if (!skippedDecision) {
                changes.push(isSolcordBuiltInAddon(name, draft.addonModes[name])
                    ? `${name}: enable Solcord clean-room adapter (no community file)`
                    : `${name}: stage, verify, and enable individually`);
            }
        }
        if (!selected && document.curatedAddons[name].enabled && currentlyBuiltIn) changes.push(`${name}: disable Solcord clean-room adapter`);
        if (document.curatedAddons[name].mode !== draft.addonModes[name]) changes.push(`${name}.mode: ${document.curatedAddons[name].mode} → ${draft.addonModes[name]}`);
        if (document.curatedAddons[name].provider !== draft.addonProviders[name]) changes.push(`${name}.provider: ${document.curatedAddons[name].provider} → ${draft.addonProviders[name]}`);
    }
    if (JSON.stringify(document.timelinePolicy) !== JSON.stringify(draft.timelinePolicy)) changes.push("Message Timeline policy");
    if (JSON.stringify(document.productPreferences) !== JSON.stringify(draft.productPreferences)) changes.push("Control Center product preferences");
    return changes;
}

export function applyProductPreferenceBindings(document: SolcordSettingsDocument, rawPreferences: unknown): SolcordSettingsDocument["productPreferences"] {
    const preferences = normalizeSolcordProductPreferences(rawPreferences);
    document.productPreferences = preferences;
    return reconcileModulePreferenceBindings(document.modules, preferences, "preferences");
}

export function applyModulePreferenceBindings(document: SolcordSettingsDocument): SolcordSettingsDocument["productPreferences"] {
    return reconcileModulePreferenceBindings(document.modules, document.productPreferences, "modules");
}

class SolcordStore extends Store {
    #document = normalizeSolcordDocument(undefined);
    #slices = new Map<keyof SolcordSettingsDocument, unknown>();
    #documentView?: SolcordSettingsDocument;
    #deferred: Array<{mutate: () => unknown; resolve: (value: unknown) => void; reject: (error: unknown) => void;}> = [];
    #deferredScheduled = false;
    #collectingDeferred = false;
    #asyncWriteBusy = false;

    initialize(): void {
        let raw: unknown;
        try {
            raw = JSON.parse(fs.readFileSync(this.#filePath()).toString());
        }
        catch {
            raw = JsonStore.get("misc", "solcordV1");
        }
        this.#document = normalizeSolcordDocument(raw);
        if (isRecord(raw) && Object.keys(raw).length > 0 && raw.schemaVersion !== SOLCORD_SCHEMA_VERSION) {
            this.#appendLedger("schema", `Migrated Solcord settings atomically to schema ${SOLCORD_SCHEMA_VERSION}.`);
        }
        this.#save();
    }

    snapshot(): SolcordSettingsDocument {
        return clone(this.#document);
    }

    readonlySnapshot(): SolcordSettingsDocument {
        return this.#documentView ??= freezeSettingsSnapshot(clone(this.#document));
    }

    setValueAsync(id: SolcordModuleId, key: string, value: unknown): Promise<void> {
        return this.#defer(() => this.setValue(id, key, value));
    }

    setProductPreferencesAsync(value: unknown): Promise<SolcordSnapshot | undefined> {
        return this.#defer(() => this.setProductPreferences(value));
    }

    setTimelinePolicyAsync(value: unknown): Promise<void> {
        return this.#defer(() => this.setTimelinePolicy(value));
    }

    #defer<T>(mutate: () => T): Promise<T> {
        const result = new Promise<T>((resolve, reject) => this.#deferred.push({mutate, resolve: value => resolve(value as T), reject}));
        this.#scheduleDeferred();
        return result;
    }

    #scheduleDeferred(): void {
        if (this.#deferredScheduled || this.#asyncWriteBusy || !this.#deferred.length) return;
        this.#deferredScheduled = true;
        setTimeout(() => {this.#deferredScheduled = false; void this.#flushDeferred();}, 0);
    }

    async #flushDeferred(): Promise<void> {
        if (this.#asyncWriteBusy || !this.#deferred.length) return;
        const batch = this.#deferred.splice(0);
        const results: unknown[] = [];
        let before: SolcordSettingsDocument | undefined;
        let temporary: string | undefined;
        let staged = false;
        this.#asyncWriteBusy = true;
        try {
            before = clone(this.#document);
            const target = this.#filePath();
            temporary = `${target}.${crypto.randomBytes(12).toString("hex")}.tmp`;
            const ownedStage = temporary;
            this.#collectingDeferred = true;
            try {for (const entry of batch) results.push(entry.mutate());}
            finally {this.#collectingDeferred = false;}
            // One serialization and atomic write acknowledge the whole revision.
            // No renderer-thread filesystem operation is used on this path.
            await new Promise<void>((resolve, reject) => fs.mkdir(path.dirname(target), {recursive: true}, error => error ? reject(error) : resolve()));
            const serialized = `${JSON.stringify(this.#document)}\n`;
            await new Promise<void>((resolve, reject) => fs.writeFile(ownedStage, serialized, {flag: "wx", originalFs: false}, error => error ? reject(error) : resolve()));
            staged = true;
            await new Promise<void>((resolve, reject) => fs.rename(ownedStage, target, error => error ? reject(error) : resolve()));
            this.#slices.clear();
            this.#documentView = undefined;
            for (const [index, entry] of batch.entries()) entry.resolve(results[index]);
            try {this.emitChange();}
            catch {/* The revision is durable; an observer cannot roll it back. */}
        }
        catch (error) {
            if (before) this.#document = before;
            this.#slices.clear();
            this.#documentView = undefined;
            // A failed exclusive open may refer to an existing file we do not
            // own. Remove only a stage whose creation/write was acknowledged.
            if (staged && temporary) {
                const ownedStage = temporary;
                await new Promise<void>(resolve => fs.unlink(ownedStage, () => resolve()));
            }
            for (const entry of batch) entry.reject(error);
        }
        finally {this.#asyncWriteBusy = false; this.#scheduleDeferred();}
    }

    /** Stable immutable selector snapshots. Full mutable exports still use snapshot(). */
    slice<K extends keyof SolcordSettingsDocument>(key: K): SolcordSettingsDocument[K] {
        if (!this.#slices.has(key)) {
            this.#slices.set(key, freezeSettingsSnapshot(clone(this.#document[key])));
        }
        return this.#slices.get(key) as SolcordSettingsDocument[K];
    }

    module(id: SolcordModuleId): SolcordModuleSettings {
        return clone(this.#document.modules[id]);
    }

    setEnabled(id: SolcordModuleId, enabled: boolean): void {
        if (id === "plugin-doctor" && !enabled) return;
        if (this.#document.modules[id].enabled === enabled) return;
        this.#commit(() => {
            this.#capture(`Before ${enabled ? "enabling" : "disabling"} ${id}`);
            this.#document.modules[id].enabled = enabled;
            if (id === "link-lens" || id === "friend-watch") applyModulePreferenceBindings(this.#document);
            this.#appendLedger("setting", `${id} ${enabled ? "enabled" : "disabled"}.`);
        });
    }

    setValue(id: SolcordModuleId, key: string, value: unknown): void {
        if (!/^[a-z][A-Za-z0-9]{0,63}$/.test(key)) throw new TypeError("Invalid Solcord setting key.");
        if (!Object.hasOwn(MODULE_DEFAULTS[id].values, key)) throw new TypeError("Unknown Solcord setting key.");
        const current = this.#document.modules[id];
        const next = normalizeModule(id, {...current, values: {...current.values, [key]: value}});
        if (JSON.stringify(next) === JSON.stringify(current)) return;
        this.#commit(() => {
            this.#capture(`Before changing ${id}.${key}`);
            this.#document.modules[id] = next;
            if (id === "friend-watch") applyModulePreferenceBindings(this.#document);
            this.#appendLedger("setting", `${id}.${key} changed.`);
        });
    }

    setProductPreferences(rawPreferences: unknown): SolcordSnapshot | undefined {
        const preferences = normalizeSolcordProductPreferences(rawPreferences);
        if (JSON.stringify(preferences) === JSON.stringify(this.#document.productPreferences)) return;
        return this.#commit(() => {
            const snapshot = this.#capture("Before changing Control Center preferences");
            if (isSolcordBuiltInAddon("DiscordEffects", this.#document.curatedAddons.DiscordEffects.mode)
                && preferences.nativeSuite.motion.effect !== this.#document.productPreferences.nativeSuite.motion.effect) {
                this.#document.curatedAddons.DiscordEffects.enabled = preferences.nativeSuite.motion.effect !== "off";
            }
            applyProductPreferenceBindings(this.#document, preferences);
            this.#appendLedger("setting", "Control Center appearance, safety, or People preferences changed.");
            return snapshot;
        });
    }

    setSetupDraft(rawDraft: unknown): void {
        if (this.#document.onboarding.status !== "pending") return;
        const draft = normalizeSetupDraft(rawDraft);
        if (JSON.stringify(draft) === JSON.stringify(this.#document.onboarding.draft)) return;
        this.#commit(() => {this.#document.onboarding.draft = draft;});
    }

    setPowerExperiment(id: SolcordPowerExperimentId, enabled: boolean, acknowledged: boolean): void {
        if (!SOLCORD_POWER_EXPERIMENTS.includes(id)) throw new TypeError("Unknown Power Lab experiment.");
        if (enabled && !acknowledged) throw new Error("PowerLabAcknowledgementRequired");
        const next: SolcordPowerConsent = enabled
            ? {enabled: true, acknowledgementVersion: SOLCORD_CONSENT_VERSION, acknowledgedAt: Date.now()}
            : {enabled: false, acknowledgementVersion: 0};
        if (JSON.stringify(next) === JSON.stringify(this.#document.powerLab[id])) return;
        this.#commit(() => {
            this.#capture(`Before ${enabled ? "enabling" : "disabling"} Power Lab ${id}`);
            this.#document.powerLab[id] = next;
            this.#appendLedger("setting", `Power Lab ${id} ${enabled ? "enabled with consent" : "disabled and acknowledgement cleared"}.`);
        });
    }

    setOnboardingStep(rawStep: number): void {
        if (this.#document.onboarding.status !== "pending") return;
        const lastStep = boundedNumber(rawStep, this.#document.onboarding.lastStep, 0, 4);
        if (lastStep === this.#document.onboarding.lastStep) return;
        this.#commit(() => {this.#document.onboarding.lastStep = lastStep;});
    }

    capture(reason: string, activeAddons?: {plugins?: string[]; themes?: string[]}): SolcordSnapshot {
        return this.#commit(() => this.#capture(reason, activeAddons));
    }

    #capture(reason: string, activeAddons?: {plugins?: string[]; themes?: string[]}): SolcordSnapshot {
        const snapshot: SolcordSnapshot = {
            id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            reason: reason.slice(0, 120),
            createdAt: Date.now(),
            modules: clone(this.#document.modules),
            profiles: clone(this.#document.profiles),
            selectedTheme: this.#document.selectedTheme,
            curatedAddons: clone(this.#document.curatedAddons),
            timelinePolicy: clone(this.#document.timelinePolicy),
            productPreferences: clone(this.#document.productPreferences),
            ...(activeAddons ? {
                activePlugins: normalizeAddonFileNames(activeAddons.plugins, "plugin"),
                activeThemes: normalizeAddonFileNames(activeAddons.themes, "theme")
            } : {})
        };
        this.#document.snapshots.push(snapshot);
        this.#document.snapshots.splice(0, Math.max(0, this.#document.snapshots.length - MAX_SNAPSHOTS));
        return clone(snapshot);
    }

    saveProfile(name: string, selectedPlugins: string[] = [], selectedThemes: string[] = []): SolcordProfile {
        if (this.#document.profiles.length >= MAX_PROFILES) throw new RangeError(`Solcord keeps at most ${MAX_PROFILES} profiles.`);
        const cleanName = name.trim().slice(0, 80);
        if (!cleanName) throw new TypeError("Profile name is required.");
        const now = Date.now();
        const idBase = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "profile";
        let id = idBase;
        let suffix = 2;
        while (this.#document.profiles.some(profile => profile.id === id)) id = `${idBase}-${suffix++}`;
        const normalizedPlugins = normalizeAddonFileNames(selectedPlugins, "plugin");
        const normalizedThemes = normalizeAddonFileNames(selectedThemes, "theme");
        const profile: SolcordProfile = {
            id,
            name: cleanName,
            createdAt: now,
            updatedAt: now,
            modules: clone(this.#document.modules),
            selectedPlugins: normalizedPlugins,
            selectedThemes: normalizedThemes,
            includesThirdPartyAddons: normalizedPlugins.length > 0 || normalizedThemes.length > 0
        };
        this.#commit(() => {
            this.#document.profiles.push(profile);
            this.#appendLedger("profile", `Saved ${cleanName}.`);
        });
        return clone(profile);
    }

    rollback(snapshotId: string): boolean {
        const restored = restoreSnapshotState(this.#document, snapshotId);
        if (!restored) return false;
        this.#commit(() => {
            this.#capture(`Before rollback to ${snapshotId}`);
            this.#document.modules = restored.modules;
            this.#document.profiles = restored.profiles;
            this.#document.selectedTheme = restored.selectedTheme;
            this.#document.curatedAddons = restored.curatedAddons;
            this.#document.timelinePolicy = restored.timelinePolicy;
            this.#document.productPreferences = restored.productPreferences;
            applyModulePreferenceBindings(this.#document);
            this.#appendLedger("rollback", `Rolled back to snapshot ${snapshotId}.`);
        });
        return true;
    }

    previewProfile(profileId: string): string[] {
        const profile = this.#document.profiles.find(item => item.id === profileId);
        return profile ? diffModules(this.#document.modules, profile.modules) : [];
    }

    profile(profileId: string): SolcordProfile | undefined {
        const profile = this.#document.profiles.find(item => item.id === profileId);
        return profile ? clone(profile) : undefined;
    }

    snapshotById(snapshotId: string): SolcordSnapshot | undefined {
        const snapshot = this.#document.snapshots.find(item => item.id === snapshotId);
        return snapshot ? clone(snapshot) : undefined;
    }

    applyProfile(profileId: string, captureSnapshot = true): boolean {
        const profile = this.#document.profiles.find(item => item.id === profileId);
        if (!profile) return false;
        this.#commit(() => {
            if (captureSnapshot) this.#capture(`Before applying ${profile.name}`);
            this.#document.modules = clone(profile.modules);
            this.#document.modules["plugin-doctor"].enabled = true;
            applyModulePreferenceBindings(this.#document);
            this.#appendLedger("profile", `Applied ${profile.name}.`);
        });
        return true;
    }

    exportDocument(): string {
        return serializeSolcordSettingsExport(this.#document);
    }

    previewImport(text: string): SolcordImportPreview | undefined {
        const candidate = parseSolcordImport(text);
        if (!candidate) return;
        return createSolcordImportPreview(this.#document, candidate);
    }

    importDocument(text: string, expectedFingerprint: string): boolean {
        const candidate = verifySolcordImportAtApply(this.#document, text, expectedFingerprint);
        if (!candidate) return false;
        this.#commit(() => {
            this.#capture("Before importing settings");
            this.#document.modules = candidate.modules;
            this.#document.profiles = candidate.profiles;
            this.#document.selectedTheme = candidate.selectedTheme;
            this.#document.curatedAddons = candidate.curatedAddons;
            this.#document.timelinePolicy = candidate.timelinePolicy;
            this.#document.productPreferences = candidate.productPreferences;
            applyModulePreferenceBindings(this.#document);
            this.#document.powerLab = defaultPowerLab();
            this.#appendLedger("schema", "Imported and validated Solcord settings format 2; Power Lab acknowledgements were not imported.");
        });
        return true;
    }

    previewSetup(draft: unknown): string[] {
        return previewSetupChanges(this.#document, draft);
    }

    completeSetup(rawDraft: unknown, installResults: Record<string, {enabled: boolean; reviewedSha256?: string; quarantineReason?: string;}>, transaction: {id: string; priorAddonStates: Record<string, boolean>; priorThemeStates: Record<string, boolean>; providerArchiveTransactionId?: string;}): SolcordSetupTransactionRecord {
        const draft = normalizeSetupDraft(rawDraft);
        return this.#commit(() => {
            const snapshot = this.#capture("Before completing Solcord setup");
            this.#document.selectedTheme = draft.selectedTheme;
            this.#document.timelinePolicy = draft.timelinePolicy;
            applyProductPreferenceBindings(this.#document, draft.productPreferences);
            this.#document.modules["message-timeline"].enabled = draft.timelinePolicy.enabled;
            for (const name of SOLCORD_PRESET_ADDONS) {
                const selected = draft.selectedAddons.includes(name);
                const result = installResults[name];
                this.#document.curatedAddons[name] = {
                    selected,
                    enabled: selected ? result?.enabled === true : false,
                    mode: draft.addonModes[name],
                    provider: draft.addonProviders[name],
                    ...(typeof result?.reviewedSha256 === "string" ? {reviewedSha256: result.reviewedSha256} : {}),
                    ...(typeof result?.quarantineReason === "string" ? {quarantineReason: result.quarantineReason.slice(0, 160)} : {})
                };
            }
            this.#document.onboarding = {version: SOLCORD_ONBOARDING_VERSION, status: "complete", lastStep: 4, completedAt: Date.now()};
            const record: SolcordSetupTransactionRecord = {id: transaction.id, at: Date.now(), snapshotId: snapshot.id, priorAddonStates: clone(transaction.priorAddonStates), priorThemeStates: clone(transaction.priorThemeStates), ...(transaction.providerArchiveTransactionId ? {providerArchiveTransactionId: transaction.providerArchiveTransactionId} : {})};
            this.#document.setupTransactions.push(record);
            this.#document.setupTransactions.splice(0, Math.max(0, this.#document.setupTransactions.length - MAX_SETUP_TRANSACTIONS));
            this.#appendLedger("schema", "Completed Solcord setup transaction version 1.");
            return clone(record);
        });
    }

    abortSetupCompletion(transactionId: string): boolean {
        const transaction = this.#document.setupTransactions.at(-1);
        if (!transaction || transaction.id !== transactionId) return false;
        const restored = restoreSnapshotState(this.#document, transaction.snapshotId);
        if (!restored) return false;
        this.#commit(() => {
            this.#document.modules = restored.modules;
            this.#document.profiles = restored.profiles;
            this.#document.selectedTheme = restored.selectedTheme;
            this.#document.curatedAddons = restored.curatedAddons;
            this.#document.timelinePolicy = restored.timelinePolicy;
            this.#document.productPreferences = restored.productPreferences;
            applyModulePreferenceBindings(this.#document);
            this.#document.onboarding = {version: SOLCORD_ONBOARDING_VERSION, status: "pending", lastStep: 4};
            this.#document.setupTransactions.pop();
            this.#document.snapshots = this.#document.snapshots.filter(snapshot => snapshot.id !== transaction.snapshotId);
            this.#appendLedger("rollback", "Aborted an unacknowledged Solcord setup transaction.");
        });
        return true;
    }

    skipOnboarding(): void {
        if (this.#document.onboarding.status !== "pending") return;
        this.#commit(() => {
            this.#document.onboarding = deferOnboardingState(this.#document.onboarding);
            this.#appendLedger("schema", "Skipped Solcord setup; addon and theme state was not changed.");
        });
    }

    reopenOnboarding(): void {
        this.#commit(() => {
            this.#document.onboarding = reopenOnboardingState(this.#document.onboarding);
            this.#appendLedger("schema", "Reopened Solcord setup.");
        });
    }

    setCuratedAddonEnabled(name: string, enabled: boolean, quarantineReason?: string): void {
        if (!SOLCORD_PRESET_ADDONS.includes(name as typeof SOLCORD_PRESET_ADDONS[number])) throw new TypeError("Unknown curated addon.");
        const current = this.#document.curatedAddons[name];
        const changesBackground = name === "DiscordEffects" && isSolcordBuiltInAddon(name, current.mode)
            && (this.#document.productPreferences.nativeSuite.motion.effect !== "off") !== enabled;
        if (current.enabled === enabled && current.quarantineReason === quarantineReason && !changesBackground) return;
        this.#commit(() => {
            this.#capture(`Before ${enabled ? "enabling" : "disabling"} curated addon ${name}`);
            this.#document.curatedAddons[name] = {
                ...current,
                enabled,
                ...(quarantineReason ? {quarantineReason: quarantineReason.slice(0, 160)} : {quarantineReason: undefined})
            };
            if (changesBackground) {
                this.#document.productPreferences.nativeSuite.motion.effect = enabled ? "field" : "off";
                if (enabled && this.#document.productPreferences.appearance.motion !== "reduced") this.#document.productPreferences.appearance.motion = "full";
            }
            this.#appendLedger("setting", `${name} ${enabled ? "enabled" : "disabled"}.`);
        });
    }

    setTimelinePolicy(rawPolicy: unknown): void {
        const policy = normalizeTimelinePolicy(rawPolicy);
        if (JSON.stringify(policy) === JSON.stringify(this.#document.timelinePolicy)) return;
        this.#commit(() => {
            this.#capture("Before changing Message Timeline policy");
            this.#document.timelinePolicy = policy;
            this.#document.modules["message-timeline"].enabled = policy.enabled;
            this.#appendLedger("setting", `Message Timeline policy changed (${policy.enabled ? `${policy.scope}, ${policy.retention}, ${policy.content}` : "off"}).`);
        });
    }

    latestSetupTransaction(): SolcordSetupTransactionRecord | undefined {
        const transaction = this.#document.setupTransactions.at(-1);
        return transaction ? clone(transaction) : undefined;
    }

    #appendLedger(kind: SolcordSettingsDocument["updateLedger"][number]["kind"], detail: string): void {
        this.#document.updateLedger.push({at: Date.now(), kind, detail, version: SOLCORD_PRODUCT_IDENTITY.numericVersion});
        this.#document.updateLedger.splice(0, Math.max(0, this.#document.updateLedger.length - MAX_LEDGER_ENTRIES));
    }

    #commit<T>(mutate: () => T): T {
        if (this.#collectingDeferred) return mutate();
        // Critical synchronous setup/recovery transactions must never race an
        // async rename and overwrite a newer acknowledged revision.
        if (this.#asyncWriteBusy) throw new Error("A settings revision is being saved. Retry after it finishes.");
        const before = clone(this.#document);
        try {
            const result = mutate();
            this.#save();
            return result;
        }
        catch (error) {
            this.#document = before;
            throw error;
        }
    }

    #save(): void {
        const target = this.#filePath();
        const temporary = `${target}.${Date.now().toString(36)}.tmp`;
        fs.mkdirSync(path.dirname(target), {recursive: true});
        try {
            fs.writeFileSync(temporary, `${JSON.stringify(this.#document)}\n`);
            fs.renameSync(temporary, target);
        }
        catch (error) {
            try {
                if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
            }
            catch {/* cleanup already best-effort */}
            throw error;
        }
        this.#slices.clear();
        this.#documentView = undefined;
        try {this.emitChange();}
        catch {/* settings are already durable; isolate observer failures */}
    }

    #filePath(): string {
        return path.resolve(Config.get("channelPath"), "solcord.json");
    }
}

export default new SolcordStore();
