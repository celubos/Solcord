// SPDX-License-Identifier: Apache-2.0

export type PrivacyProfile = "strict" | "standard" | "custom";

export type OutboundDataClass =
    | "core-discord"
    | "telemetry"
    | "crash-reporting"
    | "activity-discovery"
    | "solcord-updates"
    | "community-addons"
    | "external-providers";

export type PrivacyCapabilityState = "Protected" | "NeedsReview" | "Degraded" | "Unsupported";
export type PrivacyDecision = "allow" | "block" | "hold";
export type PrivacyDecisionResult = "applied" | "not-applicable" | "adapter-drift" | "declaration-required";

/** Content-free by construction. Never add URLs, payloads, identifiers, or file paths. */
export interface PrivacyDecisionReceipt {
    sequence: number;
    timeBucket: number;
    dataClass: OutboundDataClass;
    decision: PrivacyDecision;
    result: PrivacyDecisionResult;
}

export interface SolcordPrivacyPreferences {
    profile: PrivacyProfile;
    migrationPending: boolean;
    telemetry: "block" | "allow";
    crashReporting: "block-optional" | "allow";
    activityDiscovery: "block" | "allow";
    updates: "manual" | "automatic";
    communityAddons: "declared-local-only" | "review-required";
    externalProviders: "off" | "approved-only";
    migratedAt?: number;
}

export interface PrivacyCapabilityRecord {
    dataClass: OutboundDataClass;
    state: PrivacyCapabilityState;
    summary: string;
}

export function privacyCapabilityStateLabel(state: PrivacyCapabilityState): string {
    return state === "NeedsReview" ? "Needs review" : state;
}

const HOUR_MS = 60 * 60 * 1_000;
const OUTBOUND_DATA_CLASSES: readonly OutboundDataClass[] = ["core-discord", "telemetry", "crash-reporting", "activity-discovery", "solcord-updates", "community-addons", "external-providers"];
const PRIVACY_DECISIONS: readonly PrivacyDecision[] = ["allow", "block", "hold"];
const PRIVACY_RESULTS: readonly PrivacyDecisionResult[] = ["applied", "not-applicable", "adapter-drift", "declaration-required"];

export function privacyReceiptTimeBucket(now: number): number {
    if (!Number.isFinite(now) || now < 0) return 0;
    return Math.floor(now / HOUR_MS) * HOUR_MS;
}

export function createPrivacyDecisionReceipt(sequence: number, now: number, dataClass: OutboundDataClass, decision: PrivacyDecision, result: PrivacyDecisionResult): PrivacyDecisionReceipt {
    return {
        sequence: Number.isSafeInteger(sequence) && sequence > 0 ? sequence : 1,
        timeBucket: privacyReceiptTimeBucket(now),
        dataClass,
        decision,
        result
    };
}

export function defaultStrictPrivacyPreferences(): SolcordPrivacyPreferences {
    return {
        profile: "strict",
        migrationPending: false,
        telemetry: "block",
        crashReporting: "block-optional",
        activityDiscovery: "block",
        updates: "manual",
        communityAddons: "declared-local-only",
        externalProviders: "off"
    };
}

export function legacyPrivacyPreferences(): SolcordPrivacyPreferences {
    return {
        profile: "standard",
        migrationPending: true,
        telemetry: "allow",
        crashReporting: "allow",
        activityDiscovery: "allow",
        updates: "automatic",
        communityAddons: "review-required",
        externalProviders: "approved-only"
    };
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function choice<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
    return values.includes(value as T) ? value as T : fallback;
}

export function normalizePrivacyPreferences(value: unknown, fallback: SolcordPrivacyPreferences = defaultStrictPrivacyPreferences()): SolcordPrivacyPreferences {
    const source = record(value);
    const profile = choice(source.profile, ["strict", "standard", "custom"] as const, fallback.profile);
    const strict = profile === "strict";
    return {
        profile,
        migrationPending: source.migrationPending === true,
        telemetry: strict ? "block" : choice(source.telemetry, ["block", "allow"] as const, fallback.telemetry),
        crashReporting: strict ? "block-optional" : choice(source.crashReporting, ["block-optional", "allow"] as const, fallback.crashReporting),
        activityDiscovery: strict ? "block" : choice(source.activityDiscovery, ["block", "allow"] as const, fallback.activityDiscovery),
        updates: strict ? "manual" : choice(source.updates, ["manual", "automatic"] as const, fallback.updates),
        communityAddons: strict ? "declared-local-only" : choice(source.communityAddons, ["declared-local-only", "review-required"] as const, fallback.communityAddons),
        externalProviders: strict ? "off" : choice(source.externalProviders, ["off", "approved-only"] as const, fallback.externalProviders),
        ...(typeof source.migratedAt === "number" && Number.isFinite(source.migratedAt) && source.migratedAt >= 0 ? {migratedAt: source.migratedAt} : {})
    };
}

export function applyPrivacyProfile(previous: SolcordPrivacyPreferences, profile: PrivacyProfile, now = Date.now()): SolcordPrivacyPreferences {
    if (profile === "strict") return {...defaultStrictPrivacyPreferences(), migratedAt: now};
    if (profile === "standard") return {...legacyPrivacyPreferences(), migrationPending: false, migratedAt: now};
    return {...previous, profile: "custom", migrationPending: false, migratedAt: now};
}

export function boundPrivacyReceipts(value: unknown, maximum = 100): PrivacyDecisionReceipt[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap(candidate => {
        const item = record(candidate);
        if (!Number.isSafeInteger(item.sequence) || Number(item.sequence) <= 0) return [];
        if (!Number.isSafeInteger(item.timeBucket) || Number(item.timeBucket) < 0) return [];
        const dataClass = typeof item.dataClass === "string" && OUTBOUND_DATA_CLASSES.includes(item.dataClass as OutboundDataClass) ? item.dataClass as OutboundDataClass : undefined;
        const decision = typeof item.decision === "string" && PRIVACY_DECISIONS.includes(item.decision as PrivacyDecision) ? item.decision as PrivacyDecision : undefined;
        const result = typeof item.result === "string" && PRIVACY_RESULTS.includes(item.result as PrivacyDecisionResult) ? item.result as PrivacyDecisionResult : undefined;
        if (!dataClass || !decision || !result) return [];
        return [{sequence: Number(item.sequence), timeBucket: Number(item.timeBucket), dataClass, decision, result}];
    }).sort((left, right) => left.sequence - right.sequence).slice(-Math.max(1, Math.min(500, maximum)));
}
