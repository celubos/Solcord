// SPDX-License-Identifier: Apache-2.0

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {app} from "electron";

import {planSolcordV2ProviderRetirement, SOLCORD_V2_REPLACEMENT_MANIFEST, type SolcordV2RetirementPlan} from "@common/solcord/v2-replacement-manifest";

import {resolveSolcordBetterDiscordRoot} from "./solcord-data-root";
import {SolcordSerialQueue, writeSolcordTextAtomically} from "./solcord-private-store-files";


interface ProviderFileRecord {
    fileName: string;
    sha256: string;
    sizeBytes: number;
}

interface PendingPreview {
    createdAt: number;
    root: string;
    records: ProviderFileRecord[];
    snapshots: ProviderFileSnapshot[];
    plan: SolcordV2RetirementPlan;
}

interface ProviderFileIdentity {
    device: bigint;
    inode: bigint;
}

interface ProviderFileSnapshot {
    record: ProviderFileRecord;
    identity: ProviderFileIdentity;
}

export interface SolcordProviderArchiveOptions {
    attestReplacementHealth?: (fileName: string) => boolean;
    now?: () => number;
    moveCheckpoint?: (checkpoint: string, paths: {source: string; staging: string; destination: string;}) => void;
}

interface ArchiveJournal {
    version: 2;
    transactionId: string;
    createdAt: number;
    files: ProviderFileRecord[];
}

const SHA256 = /^[0-9a-f]{64}$/;
const TRANSACTION_ID = /^[a-z0-9]+-[0-9a-f]{16}$/;
const PREVIEW_TTL_MS = 10 * 60 * 1000;
const MAX_REPLACEMENT_READY_FILES = 256;
const MAX_OUTSTANDING_PREVIEWS = 16;
const MAX_PLUGIN_BYTES = 8 * 1024 * 1024;
const MAX_JOURNAL_BYTES = 128 * 1024;

function digest(value: Buffer | string): string {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function hasUnsafeControl(value: string): boolean {
    return [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function safeManifestFileName(value: unknown): string {
    if (typeof value !== "string" || path.basename(value) !== value || !value.endsWith(".plugin.js")) throw new TypeError("Invalid V2 provider filename.");
    if (!SOLCORD_V2_REPLACEMENT_MANIFEST.entries.some(entry => entry.fileName.toLowerCase() === value.toLowerCase())) throw new TypeError("Provider is not part of the V2 migration manifest.");
    return SOLCORD_V2_REPLACEMENT_MANIFEST.entries.find(entry => entry.fileName.toLowerCase() === value.toLowerCase())!.fileName;
}

function safeConsumerList(value: unknown): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 128) throw new TypeError("Invalid BDFDB consumer list.");
    return [...new Set(value.map(item => {
        if (typeof item !== "string" || item.length < 1 || item.length > 120 || hasUnsafeControl(item)) throw new TypeError("Invalid BDFDB consumer.");
        return item;
    }))].sort((left, right) => left.localeCompare(right, "en-US"));
}

function ensureOrdinaryDirectory(target: string, create = false): void {
    if (!fs.existsSync(target)) {
        if (!create) throw new Error("Solcord provider directory is missing.");
        fs.mkdirSync(target, {recursive: true, mode: 0o700});
    }
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink() || path.relative(path.resolve(target), path.resolve(fs.realpathSync.native(target))) !== "") throw new TypeError("Solcord provider directory is not an ordinary directory.");
}

function ensureInside(root: string, target: string): void {
    const relative = path.relative(root, target);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new TypeError("Solcord provider path escapes its root.");
}

function sameIdentity(left: ProviderFileIdentity, right: ProviderFileIdentity): boolean {
    return left.device === right.device && left.inode === right.inode;
}

function sameRecord(left: ProviderFileRecord, right: ProviderFileRecord): boolean {
    return left.fileName === right.fileName && left.sha256 === right.sha256 && left.sizeBytes === right.sizeBytes;
}

function snapshotPath(target: string, fileName: string): ProviderFileSnapshot {
    const canonicalFileName = safeManifestFileName(fileName);
    const before = fs.lstatSync(target, {bigint: true});
    if (!before.isFile() || before.isSymbolicLink() || before.size <= 0n || before.size > BigInt(MAX_PLUGIN_BYTES) || before.ino <= 0n) throw new TypeError(`Provider ${canonicalFileName} is not a bounded ordinary file.`);
    const descriptor = fs.openSync(target, "r");
    try {
        const opened = fs.fstatSync(descriptor, {bigint: true});
        const beforeIdentity = {device: before.dev, inode: before.ino};
        const openedIdentity = {device: opened.dev, inode: opened.ino};
        if (!opened.isFile() || opened.size <= 0n || opened.size > BigInt(MAX_PLUGIN_BYTES) || !sameIdentity(beforeIdentity, openedIdentity)) throw new TypeError(`Provider ${canonicalFileName} changed while it was inspected.`);
        const bytes = fs.readFileSync(descriptor);
        const after = fs.lstatSync(target, {bigint: true});
        const afterIdentity = {device: after.dev, inode: after.ino};
        if (!after.isFile() || after.isSymbolicLink() || !sameIdentity(openedIdentity, afterIdentity) || after.size !== opened.size || bytes.byteLength !== Number(opened.size)) throw new TypeError(`Provider ${canonicalFileName} changed while it was inspected.`);
        return {
            record: {fileName: canonicalFileName, sha256: digest(bytes), sizeBytes: bytes.byteLength},
            identity: openedIdentity
        };
    }
    finally {fs.closeSync(descriptor);}
}

function inspectPlugin(root: string, fileName: string): ProviderFileSnapshot | undefined {
    const target = path.join(root, safeManifestFileName(fileName));
    ensureInside(root, target);
    if (!fs.existsSync(target)) return;
    return snapshotPath(target, fileName);
}

function restoreInterruptedMove(source: string, staging: string, destination: string, expected: ProviderFileSnapshot): boolean {
    try {
        let destinationMatches = false;
        let destinationSnapshot: ProviderFileSnapshot | undefined;
        if (fs.existsSync(destination)) {
            destinationSnapshot = snapshotPath(destination, expected.record.fileName);
            destinationMatches = sameIdentity(destinationSnapshot.identity, expected.identity) && sameRecord(destinationSnapshot.record, expected.record);
        }
        if (!fs.existsSync(staging)) {
            if (fs.existsSync(source)) return true;
            if (!destinationMatches) return false;
            fs.renameSync(destination, source);
            const restored = snapshotPath(source, expected.record.fileName);
            return sameIdentity(restored.identity, expected.identity) && sameRecord(restored.record, expected.record);
        }
        const stagingSnapshot = snapshotPath(staging, expected.record.fileName);
        if (fs.existsSync(source)) return false;
        const destinationIsStaging = destinationSnapshot
            && sameIdentity(destinationSnapshot.identity, stagingSnapshot.identity)
            && sameRecord(destinationSnapshot.record, stagingSnapshot.record);
        const unexpectedDestination = Boolean(destinationSnapshot && !destinationMatches && !destinationIsStaging);
        if (destinationMatches || destinationIsStaging) fs.unlinkSync(destination);
        fs.renameSync(staging, source);
        const restored = snapshotPath(source, expected.record.fileName);
        return !unexpectedDestination && sameIdentity(restored.identity, stagingSnapshot.identity) && sameRecord(restored.record, stagingSnapshot.record);
    }
    catch {return false;}
}

function moveVerified(
    sourceRoot: string,
    destinationRoot: string,
    expected: ProviderFileSnapshot,
    phase: string,
    checkpoint?: SolcordProviderArchiveOptions["moveCheckpoint"]
): void {
    ensureOrdinaryDirectory(sourceRoot);
    ensureOrdinaryDirectory(destinationRoot);
    const source = path.join(sourceRoot, expected.record.fileName);
    const destination = path.join(destinationRoot, expected.record.fileName);
    const staging = path.join(sourceRoot, `.${expected.record.fileName}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.move`);
    ensureInside(sourceRoot, source);
    ensureInside(sourceRoot, staging);
    ensureInside(destinationRoot, destination);
    if (fs.existsSync(destination)) throw new Error(`Provider ${expected.record.fileName} destination is no longer absent.`);

    const immediatelyBefore = snapshotPath(source, expected.record.fileName);
    if (!sameIdentity(immediatelyBefore.identity, expected.identity) || !sameRecord(immediatelyBefore.record, expected.record)) throw new Error(`Provider ${expected.record.fileName} changed before ${phase}.`);
    checkpoint?.(`${phase}-after-source-check`, {source, staging, destination});

    try {
        fs.renameSync(source, staging);
        const immediatelyAfterRename = snapshotPath(staging, expected.record.fileName);
        if (!sameIdentity(immediatelyAfterRename.identity, expected.identity) || !sameRecord(immediatelyAfterRename.record, expected.record)) throw new Error(`Provider ${expected.record.fileName} changed during ${phase}.`);
        checkpoint?.(`${phase}-after-staged-rename`, {source, staging, destination});
        const beforePublish = snapshotPath(staging, expected.record.fileName);
        if (!sameIdentity(beforePublish.identity, expected.identity) || !sameRecord(beforePublish.record, expected.record)) throw new Error(`Provider ${expected.record.fileName} changed before ${phase} publish.`);

        // Hard-link publication is an exclusive, no-overwrite destination claim.
        // The uniquely named staging move makes the source identity inspectable
        // immediately before and after rename while keeping rollback possible.
        fs.linkSync(staging, destination);
        const published = snapshotPath(destination, expected.record.fileName);
        if (!sameIdentity(published.identity, expected.identity) || !sameRecord(published.record, expected.record)) throw new Error(`Provider ${expected.record.fileName} changed during ${phase} publish.`);
        fs.unlinkSync(staging);
        const completed = snapshotPath(destination, expected.record.fileName);
        if (!sameIdentity(completed.identity, expected.identity) || !sameRecord(completed.record, expected.record)) throw new Error(`Provider ${expected.record.fileName} changed after ${phase}.`);
    }
    catch (error) {
        if (!restoreInterruptedMove(source, staging, destination, expected)) throw new AggregateError([error], `Provider ${expected.record.fileName} ${phase} failed and requires manual recovery.`);
        throw error;
    }
}

function readJournal(root: string, transactionId: string): ArchiveJournal {
    if (!TRANSACTION_ID.test(transactionId)) throw new TypeError("Invalid V2 archive transaction id.");
    const target = path.join(root, `${transactionId}.json`);
    ensureInside(root, target);
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_JOURNAL_BYTES) throw new TypeError("Invalid V2 archive journal.");
    const raw = JSON.parse(fs.readFileSync(target, "utf8")) as Partial<ArchiveJournal>;
    if (raw.version !== 2 || raw.transactionId !== transactionId || !Number.isSafeInteger(raw.createdAt) || !Array.isArray(raw.files) || raw.files.length > SOLCORD_V2_REPLACEMENT_MANIFEST.entries.length) throw new TypeError("Invalid V2 archive journal.");
    const seen = new Set<string>();
    const files = raw.files.map(record => {
        if (!record || typeof record.sha256 !== "string" || !SHA256.test(record.sha256) || !Number.isSafeInteger(record.sizeBytes) || record.sizeBytes <= 0 || record.sizeBytes > MAX_PLUGIN_BYTES) throw new TypeError("Invalid V2 archive record.");
        const fileName = safeManifestFileName(record.fileName);
        if (seen.has(fileName.toLowerCase())) throw new TypeError("Duplicate V2 archive record.");
        seen.add(fileName.toLowerCase());
        return {fileName, sha256: record.sha256, sizeBytes: record.sizeBytes};
    });
    return {version: 2, transactionId, createdAt: raw.createdAt!, files};
}

export class SolcordProviderArchive {
    #previews = new Map<string, PendingPreview>();
    #queue = new SolcordSerialQueue();
    readonly #attestReplacementHealth?: SolcordProviderArchiveOptions["attestReplacementHealth"];
    readonly #now: () => number;
    readonly #moveCheckpoint?: SolcordProviderArchiveOptions["moveCheckpoint"];

    constructor(options: SolcordProviderArchiveOptions = {}) {
        this.#attestReplacementHealth = options.attestReplacementHealth;
        this.#now = options.now ?? Date.now;
        this.#moveCheckpoint = options.moveCheckpoint;
    }

    preview(rawRequest: unknown): Promise<{previewId: string; records: ProviderFileRecord[]; plan: SolcordV2RetirementPlan;}> {
        return this.#queue.run(async () => {
            const request = rawRequest && typeof rawRequest === "object" && !Array.isArray(rawRequest) ? rawRequest as Record<string, unknown> : {};
            if (!Array.isArray(request.replacementReadyFiles)) throw new TypeError("V2 replacement readiness is required.");
            if (request.replacementReadyFiles.length > MAX_REPLACEMENT_READY_FILES) throw new RangeError("V2 replacement readiness exceeds its limit.");
            const declaredReady = request.replacementReadyFiles.map(safeManifestFileName);
            const ready = [...new Set(declaredReady)].filter(fileName => this.#replacementIsHealthy(fileName));
            const consumers = safeConsumerList(request.retainedBdfdbConsumers);
            const now = this.#now();
            for (const [id, pending] of this.#previews) if (now - pending.createdAt > PREVIEW_TTL_MS) this.#previews.delete(id);
            if (ready.length && this.#previews.size >= MAX_OUTSTANDING_PREVIEWS) throw new Error("Too many outstanding V2 provider previews.");
            const root = this.#pluginRoot();
            const snapshots = SOLCORD_V2_REPLACEMENT_MANIFEST.entries.flatMap(entry => {
                const snapshot = inspectPlugin(root, entry.fileName);
                return snapshot ? [snapshot] : [];
            });
            const records = snapshots.map(snapshot => snapshot.record);
            const plan = planSolcordV2ProviderRetirement({presentFiles: records.map(record => record.fileName), replacementReadyFiles: ready, retainedBdfdbConsumers: consumers});
            const planned = new Set(plan.steps.map(step => step.fileName.toLowerCase()));
            const selectedSnapshots = snapshots.filter(snapshot => planned.has(snapshot.record.fileName.toLowerCase()));
            const selectedRecords = selectedSnapshots.map(snapshot => snapshot.record);
            const previewId = crypto.randomBytes(24).toString("base64url");
            if (selectedRecords.length) this.#previews.set(previewId, {createdAt: now, root, records: selectedRecords, snapshots: selectedSnapshots, plan});
            return {previewId, records: structuredClone(selectedRecords), plan: structuredClone(plan)};
        });
    }

    apply(rawPreviewId: unknown): Promise<{transactionId: string; archived: ProviderFileRecord[]; archiveDirectory: string;}> {
        return this.#queue.run(async () => {
            if (typeof rawPreviewId !== "string") throw new TypeError("Invalid V2 provider preview id.");
            const pending = this.#previews.get(rawPreviewId);
            this.#previews.delete(rawPreviewId);
            if (!pending || this.#now() - pending.createdAt > PREVIEW_TTL_MS) throw new Error("V2 provider preview expired.");
            if (!pending.plan.steps.length) throw new Error("V2 provider migration has no replacement-ready source files.");
            if (pending.root !== this.#pluginRoot()) throw new Error("V2 provider root changed after review.");
            for (const step of pending.plan.steps) if (!this.#replacementIsHealthy(step.fileName)) throw new Error(`Provider ${step.fileName} replacement health changed after review.`);
            for (const expected of pending.snapshots) {
                const current = inspectPlugin(pending.root, expected.record.fileName);
                if (!current || !sameIdentity(current.identity, expected.identity) || !sameRecord(current.record, expected.record)) throw new Error(`Provider ${expected.record.fileName} changed after review.`);
            }

            const transactionId = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString("hex")}`;
            const root = this.#archiveRoot();
            ensureOrdinaryDirectory(root, true);
            const transactionRoot = path.join(root, transactionId);
            ensureInside(root, transactionRoot);
            fs.mkdirSync(transactionRoot, {recursive: false, mode: 0o700});
            ensureOrdinaryDirectory(transactionRoot);
            const journal: ArchiveJournal = {version: 2, transactionId, createdAt: Date.now(), files: pending.records};
            const journalPath = path.join(root, `${transactionId}.json`);
            writeSolcordTextAtomically(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
            const moved: ProviderFileRecord[] = [];
            try {
                for (const expected of pending.snapshots) {
                    moveVerified(pending.root, transactionRoot, expected, "apply", this.#moveCheckpoint);
                    moved.push(expected.record);
                }
                writeSolcordTextAtomically(path.join(root, `${transactionId}.complete`), `${digest(fs.readFileSync(journalPath))}\n`);
                return {transactionId, archived: structuredClone(moved), archiveDirectory: transactionRoot};
            }
            catch (error) {
                let restored = true;
                for (const record of moved.reverse()) {
                    try {
                        const current = inspectPlugin(transactionRoot, record.fileName);
                        if (!current) {restored = false; continue;}
                        moveVerified(transactionRoot, pending.root, current, "apply-recovery", this.#moveCheckpoint);
                    }
                    catch {restored = false;}
                }
                writeSolcordTextAtomically(path.join(root, `${transactionId}.${restored ? "rolledback" : "incomplete"}`), `${restored ? "apply-failed" : "manual-recovery-required"}\n`);
                throw error;
            }
        });
    }

    rollback(rawTransactionId: unknown): Promise<{complete: boolean; restored: ProviderFileRecord[]; blocked: string[];}> {
        return this.#queue.run(async () => {
            if (typeof rawTransactionId !== "string" || !TRANSACTION_ID.test(rawTransactionId)) throw new TypeError("Invalid V2 archive transaction id.");
            const root = this.#archiveRoot();
            ensureOrdinaryDirectory(root);
            const journal = readJournal(root, rawTransactionId);
            const transactionRoot = path.join(root, rawTransactionId);
            ensureOrdinaryDirectory(transactionRoot);
            const pluginRoot = this.#pluginRoot();
            const restored: ProviderFileRecord[] = [];
            const blocked: string[] = [];
            for (const record of journal.files) {
                const source = path.join(transactionRoot, record.fileName);
                const destination = path.join(pluginRoot, record.fileName);
                if (fs.existsSync(destination) || !fs.existsSync(source)) {blocked.push(record.fileName); continue;}
                const sourceSnapshot = inspectPlugin(transactionRoot, record.fileName);
                if (!sourceSnapshot || !sameRecord(sourceSnapshot.record, record)) {blocked.push(record.fileName); continue;}
                try {
                    moveVerified(transactionRoot, pluginRoot, sourceSnapshot, "rollback", this.#moveCheckpoint);
                    restored.push(record);
                }
                catch {blocked.push(record.fileName);}
            }
            const complete = blocked.length === 0;
            writeSolcordTextAtomically(path.join(root, `${rawTransactionId}.${complete ? "restored" : "incomplete"}`), `${complete ? "owner-rollback" : "manual-recovery-required"}\n`);
            return {complete, restored: structuredClone(restored), blocked};
        });
    }

    #pluginRoot(): string {
        const betterDiscordRoot = resolveSolcordBetterDiscordRoot(app.getPath("userData"));
        ensureOrdinaryDirectory(betterDiscordRoot, true);
        const root = path.join(betterDiscordRoot, "plugins");
        ensureOrdinaryDirectory(root, true);
        return root;
    }

    #archiveRoot(): string {
        const betterDiscordRoot = resolveSolcordBetterDiscordRoot(app.getPath("userData"));
        return path.join(betterDiscordRoot, "solcord-provider-archive-v2");
    }

    #replacementIsHealthy(fileName: string): boolean {
        try {return this.#attestReplacementHealth?.(fileName) === true;}
        catch {return false;}
    }
}

/**
 * Main-process half of the replacement-health gate. The renderer must first
 * demonstrate that the matching live adapter started; this check independently
 * confines retirement to replacement contracts compiled into this Solcord
 * build. It is deliberately not a claim that the main process can observe
 * Discord renderer health.
 */
export function hasCompiledSolcordV2Replacement(fileName: string): boolean {
    try {
        const safe = safeManifestFileName(fileName);
        return SOLCORD_V2_REPLACEMENT_MANIFEST.entries.some(entry => entry.fileName === safe);
    }
    catch {return false;}
}

export default new SolcordProviderArchive({attestReplacementHealth: hasCompiledSolcordV2Replacement});
