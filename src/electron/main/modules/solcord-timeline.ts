import crypto from "crypto";
import fs from "fs";
import path from "path";
import {app, safeStorage} from "electron";

import {resolveSolcordBetterDiscordRoot} from "./solcord-data-root";
import {TIMELINE_MAX_EVENT_BYTES, TIMELINE_MAX_APPEND_BYTES, TIMELINE_MAX_APPEND_EVENTS} from "@common/solcord/timeline-limits";


interface TimelineEvent {
    eventId: string;
    kind: "create" | "edit" | "delete" | "bulk-delete" | "recovery";
    observedAt: number;
    messageId: string;
    channelId: string;
    authorId?: string;
    authorLabel?: string;
    authorIsBot?: boolean;
    mentionedCurrentUser?: boolean;
    content?: string;
    attachments?: Array<{name: string; contentType?: string; size?: number;}>;
}

interface TimelinePolicy {
    retention: "session" | "24-hours" | "7-days" | "30-days" | "90-days" | "manual";
    textBudgetBytes: number;
}

interface TimelineRequest {
    events?: unknown[];
    policy?: Partial<TimelinePolicy>;
    clearOpaqueStores?: boolean;
}

interface TimelineEnvelope {
    version: 1;
    iv: string;
    tag: string;
    ciphertext: string;
}

const TEXT_BUDGET_BYTES = 262_144_000;
const MAX_EVENT_BYTES = TIMELINE_MAX_EVENT_BYTES;
const MAX_APPEND_BYTES = TIMELINE_MAX_APPEND_BYTES;
const MAX_APPEND_EVENTS = TIMELINE_MAX_APPEND_EVENTS;
const MAX_READ_BYTES = 32 * 1024 * 1024;
const MAX_READ_EVENTS = 10_000;
const MAX_SEGMENT_BYTES = 160 * 1024;
const MAX_WRAPPED_KEY_BYTES = 8 * 1024;
const STORE_DIRECTORY = /^store-[0-9a-f]{40}$/;
const SEGMENT_FILE = /^\d{16}-[0-9a-f]{16}\.scseg$/;
const TEMPORARY_FILE = /^(?:\d{16}-[0-9a-f]{16}\.scseg|data\.sc-key)\.\d+\.[0-9a-f]{8}\.tmp$/;
const IDENTITY_TEMPORARY_FILE = /^identity\.sc-key\.\d+\.[0-9a-f]{8}\.tmp$/;

export interface TimelineClearResult {
    cleared: number;
    complete: boolean;
    remaining: number;
    opaqueStores: number;
    requiresOpaqueRecovery: boolean;
}

export interface TimelineReadResult {
    events: TimelineEvent[];
    persistent: boolean;
    /** True only when every eligible segment was returned and the requested retention policy was durably applied. */
    complete: boolean;
    /** True when otherwise-readable eligible segments were omitted by the bounded read limits. */
    truncated: boolean;
    omittedSegments: number;
    unreadableSegments: number;
    retentionApplied: boolean;
}

interface TimelineStorageLimits {
    readBytes?: number;
    readEvents?: number;
}

interface TimelinePruneResult {
    removed: number;
    complete: boolean;
}

function validId(value: unknown): value is string {
    return typeof value === "string" && /^\d{1,32}$/.test(value);
}

function normalizeEvent(value: unknown): TimelineEvent | undefined {
    if (!value || typeof value !== "object") return;
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.eventId !== "string" || !/^[a-zA-Z0-9_-]{1,96}$/.test(candidate.eventId)) return;
    if (!validId(candidate.messageId) || !validId(candidate.channelId)) return;
    if (typeof candidate.kind !== "string" || !["create", "edit", "delete", "bulk-delete", "recovery"].includes(candidate.kind)) return;
    const attachments = Array.isArray(candidate.attachments) ? candidate.attachments.flatMap(item => {
        if (!item || typeof item !== "object") return [];
        const attachment = item as Record<string, unknown>;
        if (typeof attachment.name !== "string") return [];
        return [{
            name: attachment.name.slice(0, 260),
            ...(typeof attachment.contentType === "string" ? {contentType: attachment.contentType.slice(0, 160)} : {}),
            ...(typeof attachment.size === "number" && Number.isSafeInteger(attachment.size) && attachment.size >= 0 ? {size: attachment.size} : {})
        }];
    }).slice(0, 20) : undefined;
    const event: TimelineEvent = {
        eventId: candidate.eventId,
        kind: candidate.kind as TimelineEvent["kind"],
        observedAt: typeof candidate.observedAt === "number" && Number.isSafeInteger(candidate.observedAt) && candidate.observedAt >= 0 ? candidate.observedAt : Date.now(),
        messageId: candidate.messageId,
        channelId: candidate.channelId,
        ...(validId(candidate.authorId) ? {authorId: candidate.authorId} : {}),
        ...(typeof candidate.authorLabel === "string" ? {authorLabel: candidate.authorLabel.slice(0, 160)} : {}),
        ...(typeof candidate.authorIsBot === "boolean" ? {authorIsBot: candidate.authorIsBot} : {}),
        ...(typeof candidate.mentionedCurrentUser === "boolean" ? {mentionedCurrentUser: candidate.mentionedCurrentUser} : {}),
        ...(typeof candidate.content === "string" ? {content: candidate.content.slice(0, 64_000)} : {}),
        ...(attachments ? {attachments} : {})
    };
    return Buffer.byteLength(JSON.stringify(event), "utf8") <= MAX_EVENT_BYTES ? event : undefined;
}

function normalizeAccountScope(value: unknown): string {
    if (!validId(value)) throw new TypeError("Invalid main-process timeline account scope.");
    return value;
}

function normalizeRequest(value: unknown, operation: "append" | "read" | "clear"): {events: TimelineEvent[]; policy: TimelinePolicy; clearOpaqueStores: boolean;} {
    if (!value || typeof value !== "object") throw new TypeError("Invalid timeline request.");
    const request = value as TimelineRequest;
    if (Object.hasOwn(request, "accountId")) throw new TypeError("Timeline requests cannot select an account.");
    if (operation !== "append" && request.events !== undefined) throw new TypeError("Timeline read and clear requests cannot contain message events.");
    if (operation === "append" && (!Array.isArray(request.events) || request.events.length > MAX_APPEND_EVENTS)) throw new TypeError("Timeline append contains an invalid event batch.");
    if (operation !== "clear" && request.clearOpaqueStores !== undefined) throw new TypeError("Only Timeline clear may request opaque recovery.");
    if (request.clearOpaqueStores !== undefined && typeof request.clearOpaqueStores !== "boolean") throw new TypeError("Invalid Timeline opaque-recovery choice.");
    const events = operation === "append" ? (request.events as unknown[]).map(event => {
        const normalized = normalizeEvent(event);
        if (!normalized) throw new TypeError("Timeline append contains an invalid event.");
        return normalized;
    }) : [];
    if (Buffer.byteLength(JSON.stringify(events), "utf8") > MAX_APPEND_BYTES) throw new RangeError("Timeline append exceeds the batch size limit.");
    const retention = typeof request.policy?.retention === "string" && ["session", "24-hours", "7-days", "30-days", "90-days", "manual"].includes(request.policy.retention)
        ? request.policy.retention
        : "7-days";
    return {events, policy: {retention, textBudgetBytes: TEXT_BUDGET_BYTES}, clearOpaqueStores: request.clearOpaqueStores === true};
}

function retentionCutoff(retention: TimelinePolicy["retention"], now = Date.now()): number {
    const duration = {
        "session": 0,
        "24-hours": 86_400_000,
        "7-days": 604_800_000,
        "30-days": 2_592_000_000,
        "90-days": 7_776_000_000,
        "manual": Number.POSITIVE_INFINITY
    }[retention];
    return duration === Number.POSITIVE_INFINITY ? 0 : now - duration;
}

export class SolcordTimelineStorage {
    #identityKey?: Buffer;
    #persistenceFailure?: string;
    #session = new Map<string, TimelineEvent[]>();
    #queue = Promise.resolve();
    #readBytes: number;
    #readEvents: number;

    constructor(limits: TimelineStorageLimits = {}) {
        const readBytes = limits.readBytes ?? MAX_READ_BYTES;
        const readEvents = limits.readEvents ?? MAX_READ_EVENTS;
        if (!Number.isSafeInteger(readBytes) || readBytes < 1 || readBytes > MAX_READ_BYTES) throw new RangeError("Invalid Timeline read byte limit.");
        if (!Number.isSafeInteger(readEvents) || readEvents < 1 || readEvents > MAX_READ_EVENTS) throw new RangeError("Invalid Timeline read event limit.");
        this.#readBytes = readBytes;
        this.#readEvents = readEvents;
    }

    status(): {persistent: boolean; sessionOnly: boolean; reason?: string;} {
        const persistent = this.#secureStorageAvailable();
        return persistent
            ? {persistent: true, sessionOnly: false}
            : {persistent: false, sessionOnly: true, reason: this.#persistenceFailure ?? "Electron safeStorage is unavailable; timeline data remains in memory only."};
    }

    append(rawAccountScope: unknown, rawRequest: unknown): Promise<{stored: number; persistent: boolean; retentionApplied: boolean;}> {
        const accountScope = normalizeAccountScope(rawAccountScope);
        const request = normalizeRequest(rawRequest, "append");
        return this.#serialized(async () => {
            if (request.policy.retention === "session") {
                const purge = this.#purgePersistentForSession(accountScope);
                return {...this.#appendSession(accountScope, request), retentionApplied: purge.complete};
            }
            if (!this.#secureStorageAvailable()) {
                const opaque = this.#opaqueRecoveryRequired(0);
                return {...this.#appendSession(accountScope, request), retentionApplied: opaque.complete};
            }

            let directory: string;
            let key: Buffer;
            try {
                directory = this.#accountDirectory(accountScope, true)!;
                key = this.#dataKey(directory, true)!;
                this.#cleanupTemporaryFiles(directory);
            }
            catch {
                this.#disablePersistence();
                const opaque = this.#opaqueRecoveryRequired(0);
                return {...this.#appendSession(accountScope, request), retentionApplied: opaque.complete};
            }

            const written: string[] = [];
            try {
                for (const event of request.events) {
                    const payload = Buffer.from(JSON.stringify(event), "utf8");
                    try {
                        const envelope = this.#encrypt(key, payload);
                        const sequence = `${String(event.observedAt).padStart(16, "0")}-${crypto.randomBytes(8).toString("hex")}.scseg`;
                        const target = path.join(directory, sequence);
                        this.#atomicWrite(target, `${JSON.stringify(envelope)}\n`);
                        written.push(target);
                    }
                    finally {payload.fill(0);}
                }
                const prune = this.#pruneFiles(directory, request.policy, key);
                return {stored: request.events.length, persistent: true, retentionApplied: prune.complete};
            }
            catch {
                for (const file of written) this.#removeWrittenSegment(file, directory);
                this.#disablePersistence();
                return {...this.#appendSession(accountScope, request), retentionApplied: false};
            }
            finally {key.fill(0);}
        });
    }

    read(rawAccountScope: unknown, rawRequest: unknown): Promise<TimelineReadResult> {
        const accountScope = normalizeAccountScope(rawAccountScope);
        const request = normalizeRequest(rawRequest, "read");
        return this.#serialized(async () => {
            if (request.policy.retention === "session") {
                const purge = this.#purgePersistentForSession(accountScope);
                return this.#memoryReadResult(accountScope, request.policy, purge.complete);
            }
            if (!this.#secureStorageAvailable()) {
                const opaque = this.#opaqueRecoveryRequired(0);
                return this.#memoryReadResult(accountScope, request.policy, opaque.complete);
            }
            let directory: string | undefined;
            let key: Buffer | undefined;
            try {
                directory = this.#accountDirectory(accountScope, false);
                if (!directory) return this.#emptyReadResult(true);
                key = this.#dataKey(directory, false);
                if (!key) return this.#emptyReadResult(true);
            }
            catch {
                this.#disablePersistence();
                const opaque = this.#opaqueRecoveryRequired(0);
                return this.#memoryReadResult(accountScope, request.policy, opaque.complete);
            }

            try {
                return this.#readPersistent(directory, key, request.policy);
            }
            finally {key.fill(0);}
        });
    }

    clear(rawAccountScope: unknown, rawRequest: unknown): Promise<TimelineClearResult> {
        const accountScope = normalizeAccountScope(rawAccountScope);
        const request = normalizeRequest(rawRequest, "clear");
        return this.#serialized(async () => {
            const memoryCount = request.clearOpaqueStores
                ? [...this.#session.values()].reduce((sum, events) => sum + events.length, 0)
                : this.#session.get(accountScope)?.length ?? 0;
            if (request.clearOpaqueStores) this.#session.clear();
            else this.#session.delete(accountScope);

            if (request.clearOpaqueStores) return this.#clearOpaqueStores(memoryCount);
            if (!this.#secureStorageAvailable() && !this.#identityKey) return this.#opaqueRecoveryRequired(memoryCount);
            try {
                const directory = this.#accountDirectory(accountScope, false);
                if (!directory) return {cleared: memoryCount, complete: true, remaining: 0, opaqueStores: 0, requiresOpaqueRecovery: false};
                return this.#clearStoreDirectories([directory], memoryCount, 0, false);
            }
            catch {
                this.#disablePersistence();
                return this.#opaqueRecoveryRequired(memoryCount);
            }
        });
    }

    #serialized<T>(task: () => Promise<T>): Promise<T> {
        const result = this.#queue.then(task, task);
        this.#queue = result.then(() => undefined, () => undefined);
        return result;
    }

    #secureStorageAvailable(): boolean {
        if (this.#persistenceFailure) return false;
        try {
            const available = safeStorage.isEncryptionAvailable();
            if (!available) this.#persistenceFailure = "Electron safeStorage is unavailable; timeline data remains in memory only.";
            return available;
        }
        catch {
            this.#disablePersistence();
            return false;
        }
    }

    #disablePersistence(): void {
        this.#persistenceFailure = "Secure timeline storage failed validation; timeline data remains in memory only for this session.";
    }

    #appendSession(accountScope: string, request: {events: TimelineEvent[]; policy: TimelinePolicy;}): {stored: number; persistent: false;} {
        const existing = this.#session.get(accountScope) ?? [];
        existing.push(...request.events);
        this.#session.set(accountScope, this.#pruneMemory(existing, request.policy));
        return {stored: request.events.length, persistent: false};
    }

    #emptyReadResult(persistent: boolean, retentionApplied = true): TimelineReadResult {
        return {
            events: [],
            persistent,
            complete: retentionApplied,
            truncated: false,
            omittedSegments: 0,
            unreadableSegments: 0,
            retentionApplied
        };
    }

    #memoryReadResult(accountScope: string, policy: TimelinePolicy, retentionApplied: boolean): TimelineReadResult {
        const events = this.#pruneMemory(this.#session.get(accountScope) ?? [], policy);
        if (events.length > 0) this.#session.set(accountScope, events);
        else this.#session.delete(accountScope);
        return {
            events: [...events],
            persistent: false,
            complete: retentionApplied,
            truncated: false,
            omittedSegments: 0,
            unreadableSegments: 0,
            retentionApplied
        };
    }

    /** Session retention is a deletion request, not merely a renderer filter. */
    #purgePersistentForSession(accountScope: string): TimelineClearResult {
        try {
            if (this.#identityKey || this.#secureStorageAvailable()) {
                const directory = this.#accountDirectory(accountScope, false);
                if (!directory) return {cleared: 0, complete: true, remaining: 0, opaqueStores: 0, requiresOpaqueRecovery: false};
                return this.#clearStoreDirectories([directory], 0, 0, false);
            }
        }
        catch {this.#disablePersistence();}

        // Without the identity key the account directory cannot be selected safely. Never
        // broaden this account-scoped retention change into deletion of every opaque account
        // store. Report the residue and require the separate explicit recovery action.
        return this.#opaqueRecoveryRequired(0);
    }

    #opaqueRecoveryRequired(memoryCount: number): TimelineClearResult {
        try {
            const stores = this.#opaqueStoreDirectories();
            const remaining = stores.unsafe + this.#rootIdentityTemporaryCount() + stores.directories.reduce((sum, directory) => {
                try {
                    this.#assertExistingSafeDirectory(directory);
                    return sum + fs.readdirSync(directory).length;
                }
                catch {return sum + 1;}
            }, 0);
            return {
                cleared: memoryCount,
                complete: remaining === 0,
                remaining,
                opaqueStores: stores.directories.length + stores.unsafe,
                requiresOpaqueRecovery: remaining > 0
            };
        }
        catch {
            return {cleared: memoryCount, complete: false, remaining: 1, opaqueStores: 1, requiresOpaqueRecovery: true};
        }
    }

    #clearOpaqueStores(memoryCount: number): TimelineClearResult {
        try {
            const stores = this.#opaqueStoreDirectories();
            const rootTemporary = this.#clearRootIdentityTemporaryFiles();
            const result = this.#clearStoreDirectories(stores.directories, memoryCount + rootTemporary.cleared, stores.unsafe, true);
            const remaining = result.remaining + rootTemporary.remaining;
            return {...result, complete: remaining === 0, remaining, requiresOpaqueRecovery: remaining > 0};
        }
        catch {
            this.#disablePersistence();
            return {cleared: memoryCount, complete: false, remaining: 1, opaqueStores: 1, requiresOpaqueRecovery: true};
        }
    }

    #opaqueStoreDirectories(): {directories: string[]; unsafe: number;} {
        const root = this.#root(false);
        if (!root) return {directories: [], unsafe: 0};
        this.#assertExistingSafeDirectory(root);
        const directories: string[] = [];
        let unsafe = 0;
        for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
            if (entry.name === "identity.sc-key") {
                if (!entry.isFile() || entry.isSymbolicLink()) unsafe++;
                continue;
            }
            if (IDENTITY_TEMPORARY_FILE.test(entry.name)) continue;
            if (!STORE_DIRECTORY.test(entry.name)) {
                unsafe++;
                continue;
            }
            if (!entry.isDirectory() || entry.isSymbolicLink()) {
                unsafe++;
                continue;
            }
            const directory = path.join(root, entry.name);
            try {
                this.#assertExistingSafeDirectory(directory);
                directories.push(directory);
            }
            catch {unsafe++;}
        }
        return {directories, unsafe};
    }

    #rootIdentityTemporaryCount(): number {
        const root = this.#root(false);
        if (!root) return 0;
        this.#assertExistingSafeDirectory(root);
        return fs.readdirSync(root, {withFileTypes: true}).filter(entry => IDENTITY_TEMPORARY_FILE.test(entry.name)).length;
    }

    #clearRootIdentityTemporaryFiles(): {cleared: number; remaining: number;} {
        const root = this.#root(false);
        if (!root) return {cleared: 0, remaining: 0};
        this.#assertExistingSafeDirectory(root);
        let cleared = 0;
        let remaining = 0;
        for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
            if (!IDENTITY_TEMPORARY_FILE.test(entry.name)) continue;
            const file = path.join(root, entry.name);
            try {
                this.#assertInside(file, root);
                const stat = fs.lstatSync(file);
                if (!stat.isFile() || stat.isSymbolicLink()) {
                    remaining++;
                    continue;
                }
                fs.unlinkSync(file);
                cleared++;
            }
            catch {remaining++;}
        }
        return {cleared, remaining};
    }

    #clearStoreDirectories(directories: string[], memoryCount: number, unsafe: number, opaque: boolean): TimelineClearResult {
        let cleared = memoryCount;
        let remaining = unsafe;
        for (const directory of directories) {
            try {
                this.#assertExistingSafeDirectory(directory);
                const entries = fs.readdirSync(directory, {withFileTypes: true}).sort((left, right) => {
                    if (left.name === "data.sc-key") return 1;
                    if (right.name === "data.sc-key") return -1;
                    return left.name.localeCompare(right.name);
                });
                for (const entry of entries) {
                    if (entry.name !== "data.sc-key" && !SEGMENT_FILE.test(entry.name) && !TEMPORARY_FILE.test(entry.name)) continue;
                    const file = path.join(directory, entry.name);
                    try {
                        this.#assertInside(file, directory);
                        const stat = fs.lstatSync(file);
                        if (stat.isDirectory()) continue;
                        fs.unlinkSync(file);
                        cleared++;
                    }
                    catch {/* counted by the final directory scan */}
                }
                const leftovers = fs.readdirSync(directory);
                remaining += leftovers.length;
                if (leftovers.length === 0) fs.rmdirSync(directory);
            }
            catch {remaining++;}
        }
        return {
            cleared,
            complete: remaining === 0,
            remaining,
            opaqueStores: opaque ? directories.length + unsafe : 0,
            requiresOpaqueRecovery: remaining > 0
        };
    }

    #betterDiscordRoot(): string {
        return resolveSolcordBetterDiscordRoot(app.getPath("userData"));
    }

    #root(create: boolean): string | undefined {
        const root = path.join(this.#betterDiscordRoot(), "solcord-timeline-v1");
        return this.#ensureSafeDirectory(root, create) ? root : undefined;
    }

    #identity(create: boolean): Buffer | undefined {
        const root = this.#root(create);
        if (!root) return;
        if (this.#identityKey) return this.#identityKey;
        const file = path.join(root, "identity.sc-key");
        if (fs.existsSync(file)) {
            this.#identityKey = this.#readWrappedKey(file, root);
        }
        else {
            if (!create) return;
            this.#identityKey = crypto.randomBytes(32);
            try {
                const wrapped = this.#wrapKey(this.#identityKey);
                this.#atomicWrite(file, wrapped.toString("base64"));
            }
            catch (error) {
                this.#identityKey.fill(0);
                this.#identityKey = undefined;
                throw error;
            }
        }
        if (this.#identityKey.length !== 32) throw new Error("Invalid Solcord timeline identity key.");
        return this.#identityKey;
    }

    #accountDirectory(accountId: string, create: boolean): string | undefined {
        const identity = this.#identity(create);
        const root = this.#root(create);
        if (!identity || !root) return;
        const opaque = crypto.createHmac("sha256", identity).update(accountId, "utf8").digest("hex").slice(0, 40);
        const directory = path.join(root, `store-${opaque}`);
        if (!this.#ensureSafeDirectory(directory, create)) return;
        return directory;
    }

    #dataKey(directory: string, create: boolean): Buffer | undefined {
        if (!this.#ensureSafeDirectory(directory, create)) return;
        const file = path.join(directory, "data.sc-key");
        if (fs.existsSync(file)) {
            return this.#readWrappedKey(file, directory);
        }
        if (!create) return;
        const key = crypto.randomBytes(32);
        try {
            const wrapped = this.#wrapKey(key);
            this.#atomicWrite(file, wrapped.toString("base64"));
            return key;
        }
        catch (error) {
            key.fill(0);
            throw error;
        }
    }

    #readWrappedKey(file: string, root: string): Buffer {
        this.#assertInside(file, root);
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_WRAPPED_KEY_BYTES) throw new TypeError("Invalid Solcord wrapped key file.");
        const encoded = fs.readFileSync(file, "utf8").trim();
        if (!encoded || !/^[a-zA-Z0-9+/]+={0,2}$/.test(encoded)) throw new TypeError("Invalid Solcord wrapped key encoding.");
        const wrapped = Buffer.from(encoded, "base64");
        const plaintext = safeStorage.decryptString(wrapped);
        if (!/^[a-zA-Z0-9+/]+={0,2}$/.test(plaintext)) throw new TypeError("Invalid Solcord unwrapped key encoding.");
        const key = Buffer.from(plaintext, "base64");
        if (key.length !== 32) throw new TypeError("Invalid Solcord unwrapped key length.");
        return key;
    }

    #wrapKey(key: Buffer): Buffer {
        const wrapped = safeStorage.encryptString(key.toString("base64"));
        if (!Buffer.isBuffer(wrapped) || wrapped.length <= 0 || wrapped.length > MAX_WRAPPED_KEY_BYTES) throw new TypeError("Invalid Solcord wrapped key result.");
        return wrapped;
    }

    #encrypt(key: Buffer, plaintext: Buffer): TimelineEnvelope {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        return {version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64")};
    }

    #decrypt(key: Buffer, envelope: TimelineEnvelope): Buffer {
        if (envelope?.version !== 1 || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.ciphertext !== "string") throw new TypeError("Unsupported timeline segment.");
        if (![envelope.iv, envelope.tag, envelope.ciphertext].every(value => /^[a-zA-Z0-9+/]*={0,2}$/.test(value))) throw new TypeError("Invalid timeline segment encoding.");
        const iv = Buffer.from(envelope.iv, "base64");
        const tag = Buffer.from(envelope.tag, "base64");
        const ciphertext = Buffer.from(envelope.ciphertext, "base64");
        if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > MAX_EVENT_BYTES) throw new TypeError("Invalid timeline segment envelope.");
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    }

    #segmentFiles(directory: string): string[] {
        this.#assertExistingSafeDirectory(directory);
        const resolved = path.resolve(directory);
        return fs.readdirSync(resolved, {withFileTypes: true})
            .filter(entry => entry.isFile() && SEGMENT_FILE.test(entry.name))
            .map(entry => path.join(resolved, entry.name))
            .sort();
    }

    #readPersistent(directory: string, key: Buffer, policy: TimelinePolicy): TimelineReadResult {
        const cutoff = retentionCutoff(policy.retention);
        const events: TimelineEvent[] = [];
        let bytes = 0;
        let omittedSegments = 0;
        let unreadableSegments = 0;
        let retentionApplied = true;
        let readBoundReached = false;

        // Read newest-first so a bounded read/export is a contiguous recent suffix rather
        // than an arbitrary old prefix. Reverse once before returning chronological events.
        for (const file of this.#segmentFiles(directory).reverse()) {
            let plaintext: Buffer | undefined;
            try {
                const stat = fs.lstatSync(file);
                if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_SEGMENT_BYTES) {
                    unreadableSegments++;
                    retentionApplied = false;
                    continue;
                }
                const envelope = JSON.parse(fs.readFileSync(file, "utf8")) as TimelineEnvelope;
                plaintext = this.#decrypt(key, envelope);
                const event = normalizeEvent(JSON.parse(plaintext.toString("utf8")));
                if (!event) {
                    unreadableSegments++;
                    retentionApplied = false;
                    continue;
                }

                if (event.observedAt < cutoff) {
                    try {fs.unlinkSync(file);}
                    catch {retentionApplied = false;}
                    continue;
                }

                if (readBoundReached || events.length >= this.#readEvents || bytes + stat.size > this.#readBytes) {
                    readBoundReached = true;
                    omittedSegments++;
                    continue;
                }
                bytes += stat.size;
                events.push(event);
            }
            catch {
                unreadableSegments++;
                retentionApplied = false;
            }
            finally {plaintext?.fill(0);}
        }

        if (!this.#removeEmptyAccountStore(directory)) retentionApplied = false;
        const truncated = omittedSegments > 0;
        return {
            events: events.reverse(),
            persistent: true,
            complete: retentionApplied && !truncated && unreadableSegments === 0,
            truncated,
            omittedSegments,
            unreadableSegments,
            retentionApplied
        };
    }

    #pruneFiles(directory: string, policy: TimelinePolicy, key: Buffer): TimelinePruneResult {
        const cutoff = retentionCutoff(policy.retention);
        let removed = 0;
        let complete = true;
        for (const file of this.#segmentFiles(directory)) {
            let plaintext: Buffer | undefined;
            try {
                const stat = fs.lstatSync(file);
                if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_SEGMENT_BYTES) {
                    complete = false;
                    continue;
                }
                const envelope = JSON.parse(fs.readFileSync(file, "utf8")) as TimelineEnvelope;
                plaintext = this.#decrypt(key, envelope);
                const event = normalizeEvent(JSON.parse(plaintext.toString("utf8")));
                if (!event) {
                    complete = false;
                    continue;
                }
                if (event.observedAt < cutoff) {
                    fs.unlinkSync(file);
                    removed++;
                }
            }
            catch {complete = false;}
            finally {plaintext?.fill(0);}
        }

        const remaining = this.#segmentFiles(directory).map(file => ({file, stat: fs.lstatSync(file)})).filter(item => item.stat.isFile() && !item.stat.isSymbolicLink());
        let total = remaining.reduce((sum, item) => sum + item.stat.size, 0);
        for (const item of remaining) {
            if (total <= TEXT_BUDGET_BYTES) break;
            try {
                fs.unlinkSync(item.file);
                total -= item.stat.size;
                removed++;
            }
            catch {complete = false;}
        }
        if (!this.#removeEmptyAccountStore(directory)) complete = false;
        return {removed, complete};
    }

    #removeEmptyAccountStore(directory: string): boolean {
        try {
            this.#assertExistingSafeDirectory(directory);
            if (this.#segmentFiles(directory).length > 0) return true;
            for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
                if (!TEMPORARY_FILE.test(entry.name)) continue;
                const file = path.join(directory, entry.name);
                const stat = fs.lstatSync(file);
                if (!stat.isFile() || stat.isSymbolicLink()) return false;
                fs.unlinkSync(file);
            }
            const key = path.join(directory, "data.sc-key");
            if (fs.existsSync(key)) {
                const stat = fs.lstatSync(key);
                if (!stat.isFile() || stat.isSymbolicLink()) return false;
                fs.unlinkSync(key);
            }
            if (fs.readdirSync(directory).length > 0) return false;
            fs.rmdirSync(directory);
            return true;
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
            return false;
        }
    }

    #pruneMemory(events: TimelineEvent[], policy: TimelinePolicy): TimelineEvent[] {
        const cutoff = retentionCutoff(policy.retention);
        const filtered = events.filter(event => policy.retention === "session" || event.observedAt >= cutoff).slice(-MAX_READ_EVENTS);
        let bytes = filtered.reduce((sum, event) => sum + Buffer.byteLength(JSON.stringify(event), "utf8"), 0);
        while (bytes > TEXT_BUDGET_BYTES && filtered.length) {
            const removed = filtered.shift();
            if (!removed) break;
            bytes -= Buffer.byteLength(JSON.stringify(removed), "utf8");
        }
        return filtered;
    }

    #cleanupTemporaryFiles(directory: string): void {
        this.#assertExistingSafeDirectory(directory);
        const cutoff = Date.now() - 86_400_000;
        for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
            if (!entry.isFile() || !TEMPORARY_FILE.test(entry.name)) continue;
            const file = path.join(directory, entry.name);
            const stat = fs.lstatSync(file);
            if (stat.isFile() && !stat.isSymbolicLink() && stat.mtimeMs < cutoff) fs.unlinkSync(file);
        }
    }

    #removeWrittenSegment(file: string, directory: string): void {
        try {
            this.#assertInside(file, directory);
            const stat = fs.lstatSync(file);
            if (stat.isFile() && !stat.isSymbolicLink()) fs.unlinkSync(file);
        }
        catch {/* preserve ambiguous state */}
    }

    #ensureSafeDirectory(target: string, create: boolean): boolean {
        const base = path.resolve(this.#betterDiscordRoot());
        const resolved = path.resolve(target);
        if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) throw new TypeError("Timeline directory escapes the BetterDiscord root.");

        if (!fs.existsSync(base)) {
            if (!create) return false;
            fs.mkdirSync(base, {recursive: true, mode: 0o700});
        }
        this.#assertDirectoryNode(base);
        if (resolved === base) return true;

        if (!fs.existsSync(resolved)) {
            if (!create) return false;
            const parent = path.dirname(resolved);
            if (parent !== base) this.#ensureSafeDirectory(parent, true);
            fs.mkdirSync(resolved, {recursive: false, mode: 0o700});
        }
        this.#assertDirectoryNode(resolved);
        const realBase = fs.realpathSync.native(base);
        const realTarget = fs.realpathSync.native(resolved);
        if (realTarget !== realBase && !realTarget.startsWith(`${realBase}${path.sep}`)) throw new TypeError("Timeline directory resolves through a link outside BetterDiscord.");
        return true;
    }

    #assertDirectoryNode(directory: string): void {
        const stat = fs.lstatSync(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new TypeError("Timeline directory is a link or non-directory.");
    }

    #assertExistingSafeDirectory(directory: string): void {
        if (!this.#ensureSafeDirectory(directory, false)) throw new Error("Expected Solcord timeline directory is missing.");
    }

    #assertInside(target: string, root: string): void {
        const resolvedRoot = path.resolve(root);
        const resolvedTarget = path.resolve(target);
        if (resolvedTarget === resolvedRoot || !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) throw new TypeError("Unsafe Solcord timeline path.");
    }

    #atomicWrite(target: string, content: string): void {
        this.#assertExistingSafeDirectory(path.dirname(target));
        const temporary = `${target}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
        fs.writeFileSync(temporary, content, {encoding: "utf8", flag: "wx", mode: 0o600});
        try {
            fs.renameSync(temporary, target);
        }
        catch (error) {
            try {if (fs.existsSync(temporary)) fs.unlinkSync(temporary);}
            catch {/* best effort */}
            throw error;
        }
    }
}

export default new SolcordTimelineStorage();
