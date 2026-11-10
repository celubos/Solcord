import crypto from "crypto";

import {SOLCORD_RUNTIME_ADDONS, SOLCORD_RUNTIME_DEPENDENCIES, SOLCORD_RUNTIME_THEMES} from "@common/solcord/addon-trust.generated";


export type AddonIntegrityKind = "addon" | "dependency" | "theme";
export type AddonIntegrityState = "missing" | "match" | "mismatch" | "unreadable" | "unsafe" | "unavailable";

export interface AddonIntegrityRecord {
    kind: AddonIntegrityKind;
    name: string;
    status: AddonIntegrityState;
    reviewedSha256: string;
    installedSha256?: string;
}

export interface AddonIntegritySummary {
    total: number;
    match: number;
    missing: number;
    attention: number;
    unavailable: number;
}

export interface ReviewedExecutionCheck {
    reviewed: boolean;
    matches: boolean;
    name?: string;
    reviewedSha256?: string;
}

export interface ReviewedExecutionOwnership {
    kind: "plugin" | "theme";
    fileName: string;
    reviewedSha256: string;
}

export interface IntegrityOwnershipState {
    curatedAddons: Record<string, {selected?: boolean; enabled?: boolean; reviewedSha256?: string;}>;
    selectedTheme: string;
    hasSetupTransaction: boolean;
}

interface ReviewedExecutionCandidate {
    fileName: string;
    name: string;
    sourceSha256: string;
    declaredNames: readonly string[];
}

const SHA256 = /^[0-9a-f]{64}$/;
const MAX_AUDIT_RECORDS = 64;
const QUARANTINE_STATES = new Set<AddonIntegrityState>(["mismatch", "unreadable", "unsafe", "unavailable"]);
let REVIEWED_EXECUTION_OWNERSHIP = new Map<string, string>();

function normalizeIdentity(value: string): string {
    return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function executionKey(kind: "plugin" | "theme", fileName: string): string {
    return `${kind}\0${normalizeIdentity(fileName)}`;
}

export function configureReviewedExecutionOwnership(records: readonly ReviewedExecutionOwnership[]): void {
    const next = new Map<string, string>();
    for (const record of records) {
        if (!SHA256.test(record.reviewedSha256)) continue;
        const candidates: readonly ReviewedExecutionCandidate[] = record.kind === "theme" ? REVIEWED_THEMES : REVIEWED_PLUGINS;
        const candidate = candidates.find(entry => normalizeIdentity(entry.fileName) === normalizeIdentity(record.fileName));
        if (!candidate || candidate.sourceSha256 !== record.reviewedSha256) continue;
        next.set(executionKey(record.kind, candidate.fileName), candidate.sourceSha256);
    }
    REVIEWED_EXECUTION_OWNERSHIP = next;
}

export function integrityRecordIsAccepted(record: AddonIntegrityRecord, state: IntegrityOwnershipState): boolean {
    if (!state.hasSetupTransaction) return false;
    const acceptedAddons = SOLCORD_RUNTIME_ADDONS.filter(candidate => {
        const configured = state.curatedAddons[candidate.name];
        return configured?.reviewedSha256 === candidate.sourceSha256 && (configured.selected === true || configured.enabled === true);
    });
    if (record.kind === "addon") return acceptedAddons.some(candidate => candidate.name === record.name);
    if (record.kind === "dependency") return acceptedAddons.some(candidate => candidate.dependencies.some(name => name === record.name));
    return SOLCORD_RUNTIME_THEMES.some(theme => theme.name === record.name && theme.id === state.selectedTheme);
}

const REVIEWED_PLUGINS: ReviewedExecutionCandidate[] = [...SOLCORD_RUNTIME_ADDONS, ...SOLCORD_RUNTIME_DEPENDENCIES].map(candidate => ({
    fileName: candidate.fileName,
    name: candidate.name,
    sourceSha256: candidate.sourceSha256,
    declaredNames: [candidate.name]
}));
const REVIEWED_THEMES: ReviewedExecutionCandidate[] = SOLCORD_RUNTIME_THEMES.map(candidate => ({
    fileName: candidate.fileName,
    name: candidate.name,
    sourceSha256: candidate.sourceSha256,
    declaredNames: [...new Set([candidate.name, candidate.declaredName])]
}));

const EXPECTED: AddonIntegrityRecord[] = [
    ...SOLCORD_RUNTIME_ADDONS.map(candidate => ({kind: "addon" as const, name: candidate.name, status: "unavailable" as const, reviewedSha256: candidate.sourceSha256})),
    ...SOLCORD_RUNTIME_DEPENDENCIES.map(candidate => ({kind: "dependency" as const, name: candidate.name, status: "unavailable" as const, reviewedSha256: candidate.sourceSha256})),
    ...SOLCORD_RUNTIME_THEMES.map(candidate => ({kind: "theme" as const, name: candidate.name, status: "unavailable" as const, reviewedSha256: candidate.sourceSha256}))
];

function recordKey(kind: AddonIntegrityKind, name: string): string {
    return `${kind}\0${name}`;
}

/**
 * Synchronous sink guard for live addon reloads. Startup and transaction
 * audits remain authoritative lifecycle checks, but reviewed bytes must also
 * match immediately before JavaScript evaluation or CSS injection.
 * Unreviewed owner files retain ordinary BetterDiscord behavior.
 */
export function checkReviewedExecution(kind: "plugin" | "theme", fileName: string, _declaredName: string | undefined, content: string): ReviewedExecutionCheck {
    const candidates: readonly ReviewedExecutionCandidate[] = kind === "theme" ? REVIEWED_THEMES : REVIEWED_PLUGINS;
    const candidate = candidates.find(entry => normalizeIdentity(entry.fileName) === normalizeIdentity(fileName));
    if (!candidate || REVIEWED_EXECUTION_OWNERSHIP.get(executionKey(kind, candidate.fileName)) !== candidate.sourceSha256) return {reviewed: false, matches: true};
    const actual = crypto.createHash("sha256").update(content, "utf8").digest("hex");
    return {
        reviewed: true,
        matches: actual === candidate.sourceSha256,
        name: candidate.name,
        reviewedSha256: candidate.sourceSha256
    };
}

export function unavailableIntegrityRecords(): AddonIntegrityRecord[] {
    return EXPECTED.map(record => ({...record}));
}

export function normalizeIntegrityAudit(raw: unknown): AddonIntegrityRecord[] {
    const records = unavailableIntegrityRecords();
    if (!Array.isArray(raw) || raw.length > MAX_AUDIT_RECORDS) return records;

    const indices = new Map(records.map((record, index) => [recordKey(record.kind, record.name), index]));
    const seen = new Set<string>();
    for (const value of raw) {
        if (!value || typeof value !== "object") continue;
        const candidate = value as Partial<AddonIntegrityRecord>;
        if ((candidate.kind !== "addon" && candidate.kind !== "dependency" && candidate.kind !== "theme") || typeof candidate.name !== "string") continue;
        const key = recordKey(candidate.kind, candidate.name);
        const index = indices.get(key);
        if (index === undefined || seen.has(key)) continue;
        seen.add(key);
        const expected = records[index];
        if (candidate.reviewedSha256 !== expected.reviewedSha256 || !SHA256.test(candidate.reviewedSha256)) continue;
        if (candidate.status !== "missing" && candidate.status !== "match" && candidate.status !== "mismatch" && candidate.status !== "unreadable" && candidate.status !== "unsafe") continue;

        const installedSha256 = typeof candidate.installedSha256 === "string" && SHA256.test(candidate.installedSha256) ? candidate.installedSha256 : undefined;
        if (candidate.status === "match" && installedSha256 !== expected.reviewedSha256) continue;
        if (candidate.status === "mismatch" && (!installedSha256 || installedSha256 === expected.reviewedSha256)) continue;
        records[index] = {
            ...expected,
            status: candidate.status,
            ...((candidate.status === "match" || candidate.status === "mismatch") && installedSha256 ? {installedSha256} : {})
        };
    }
    return records;
}

export function integrityBlocksExecution(record: AddonIntegrityRecord | undefined): boolean {
    return !record || record.status !== "match";
}

export function reviewBlocksEnable(reviewed: {installable?: boolean;} | undefined, solcordBuiltIn = false): boolean {
    return !solcordBuiltIn && reviewed?.installable !== true;
}

export function integrityRequiresQuarantine(record: AddonIntegrityRecord | undefined): boolean {
    return Boolean(record && QUARANTINE_STATES.has(record.status));
}

export function integrityFailureReason(record: AddonIntegrityRecord): string | undefined {
    if (!integrityBlocksExecution(record)) return;
    return {
        mismatch: "Installed bytes differ from Solcord's reviewed hash; the addon was disabled and quarantined.",
        unreadable: "Installed bytes could not be read safely; the addon was disabled and quarantined.",
        unsafe: "The installed addon path failed link and file safety checks; the addon was disabled and quarantined.",
        unavailable: "The integrity audit was unavailable or incomplete; the reviewed addon was kept off.",
        match: undefined,
        missing: undefined
    }[record.status];
}

export function summarizeIntegrity(records: readonly AddonIntegrityRecord[]): AddonIntegritySummary {
    return {
        total: records.length,
        match: records.filter(record => record.status === "match").length,
        missing: records.filter(record => record.status === "missing").length,
        attention: records.filter(record => record.status === "mismatch" || record.status === "unreadable" || record.status === "unsafe").length,
        unavailable: records.filter(record => record.status === "unavailable").length
    };
}
