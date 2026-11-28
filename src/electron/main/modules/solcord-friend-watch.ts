// SPDX-License-Identifier: Apache-2.0

import crypto from "crypto";
import fs from "fs";
import path from "path";
import {app, safeStorage} from "electron";

import type {SolcordRelationshipChangeTransition, SolcordRelationshipEvent} from "@common/solcord/friend-watch";

import {resolveSolcordBetterDiscordRoot} from "./solcord-data-root";
import {assertSolcordPathInside, recoverSolcordReplacedFile, solcordReplacementArtifacts, SolcordSerialQueue, writeSolcordFileAtomically} from "./solcord-private-store-files";

interface FriendWatchRequest {
    events?: unknown[];
    retentionDays?: unknown;
}

interface EncryptedEnvelope {
    version: 2;
    iv: string;
    tag: string;
    ciphertext: string;
}

const MAX_EVENTS = 10_000;
const MAX_PLAINTEXT_BYTES = 25 * 1024 * 1024;
const MAX_ENVELOPE_BYTES = 36 * 1024 * 1024;
const MAX_BATCH_EVENTS = 256;
const MAX_BATCH_BYTES = 2 * 1024 * 1024;
const MAX_WRAPPED_KEY_BYTES = 8 * 1024;
const STORE_DIRECTORY = /^store-[0-9a-f]{40}$/;
const ACCOUNT_TRANSIENT_FILE = /^(?:data\.sc-key|events\.scdb)\.\d+\.[0-9a-f]{8}\.(?:old|tmp)$/;
const EVENT_ARTIFACTS = solcordReplacementArtifacts("events.scdb");
const TRANSITIONS = new Set<string>([
    "incoming-request-received",
    "incoming-request-cancelled",
    "outgoing-request-sent",
    "outgoing-request-cancelled",
    "friendship-established",
    "relationship-ended",
    "blocked-by-you",
    "unblocked-by-you",
    "reconciled"
]);
const SOURCES = new Set<string>(["confirmed-owner-action", "observed-store-transition", "reconciliation"]);
const CONFIDENCE = new Set<string>(["confirmed", "observed", "unknown"]);

function validAccount(value: unknown): value is string {
    return typeof value === "string" && /^\d{1,32}$/.test(value);
}

function normalizeEvent(value: unknown): SolcordRelationshipEvent | undefined {
    if (!value || typeof value !== "object") return;
    const event = value as Record<string, unknown>;
    if (event.schemaVersion !== 1 || typeof event.eventId !== "string" || !/^[a-zA-Z0-9_-]{8,96}$/.test(event.eventId)) return;
    const transition = TRANSITIONS.has(String(event.transition)) ? event.transition as SolcordRelationshipEvent["transition"] : undefined;
    const subjectId = validAccount(event.subjectId) ? event.subjectId : undefined;
    const subjectKey = typeof event.subjectKey === "string" && /^[0-9a-f]{64}$/.test(event.subjectKey) ? event.subjectKey : undefined;
    const validSubject = transition === "reconciled" ? !subjectId && !subjectKey : Boolean(subjectId || subjectKey) && !(subjectId && subjectKey);
    if (!transition || !validSubject || !SOURCES.has(String(event.source)) || !CONFIDENCE.has(String(event.confidence))) return;
    if (!Number.isSafeInteger(event.observedAt) || Number(event.observedAt) < 0 || typeof event.label !== "string") return;
    const normalizedBase = {
        eventId: event.eventId,
        observedAt: Number(event.observedAt),
        label: event.label.slice(0, 160),
        source: event.source as SolcordRelationshipEvent["source"],
        confidence: event.confidence as SolcordRelationshipEvent["confidence"],
        schemaVersion: 1 as const,
        ...(typeof event.displayLabel === "string" && event.displayLabel.trim() ? {displayLabel: event.displayLabel.trim().slice(0, 160)} : {})
    };
    const normalized: SolcordRelationshipEvent = transition === "reconciled"
        ? {...normalizedBase, transition}
        : subjectId
            ? {...normalizedBase, transition: transition as SolcordRelationshipChangeTransition, subjectId}
            : {...normalizedBase, transition: transition as SolcordRelationshipChangeTransition, subjectKey: subjectKey!};
    return Buffer.byteLength(JSON.stringify(normalized), "utf8") <= 2_048 ? normalized : undefined;
}

function normalizeRequest(value: unknown, operation: "append" | "read" | "clear"): {events: SolcordRelationshipEvent[]; retentionDays: 7 | 30 | 90;} {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid Friend Watch request.");
    const request = value as FriendWatchRequest & Record<string, unknown>;
    if (Object.hasOwn(request, "accountId") || Object.hasOwn(request, "accountScope")) throw new TypeError("Friend Watch requests cannot select an account.");
    if (operation === "append" && (!Array.isArray(request.events) || request.events.length > MAX_BATCH_EVENTS)) throw new TypeError("Invalid Friend Watch append batch.");
    if (operation !== "append" && request.events !== undefined) throw new TypeError("Friend Watch read or clear cannot include events.");
    const events = operation === "append" ? (request.events as unknown[]).map(raw => {
        const event = normalizeEvent(raw);
        if (!event) throw new TypeError("Invalid Friend Watch event.");
        return event;
    }) : [];
    if (Buffer.byteLength(JSON.stringify(events), "utf8") > MAX_BATCH_BYTES) throw new RangeError("Friend Watch append exceeds its batch limit.");
    const retentionDays = request.retentionDays === 7 || request.retentionDays === 90 ? request.retentionDays : 30;
    return {events, retentionDays};
}

function prune(events: readonly SolcordRelationshipEvent[], retentionDays: 7 | 30 | 90, now = Date.now()): SolcordRelationshipEvent[] {
    const cutoff = now - retentionDays * 24 * 60 * 60 * 1_000;
    const unique = new Map<string, SolcordRelationshipEvent>();
    for (const event of events) if (event.observedAt >= cutoff) unique.set(event.eventId, event);
    const result = [...unique.values()].sort((left, right) => left.observedAt - right.observedAt).slice(-MAX_EVENTS);
    while (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_PLAINTEXT_BYTES && result.length) result.shift();
    return result;
}

export class SolcordFriendWatchStorage {
    #identityKey?: Buffer;
    #session = new Map<string, SolcordRelationshipEvent[]>();
    #persistenceFailed = false;
    #queue = new SolcordSerialQueue();

    status(): {persistent: boolean; sessionOnly: boolean; reason?: string;} {
        const persistent = this.#secureAvailable();
        return persistent ? {persistent: true, sessionOnly: false} : {persistent: false, sessionOnly: true, reason: "Electron safeStorage is unavailable or failed validation; Friend Watch remains in memory only."};
    }

    append(rawAccount: unknown, rawRequest: unknown): Promise<{events: SolcordRelationshipEvent[]; persistent: boolean;}> {
        const account = this.#account(rawAccount);
        const request = normalizeRequest(rawRequest, "append");
        return this.#queue.run(async () => {
            if (!this.#secureAvailable()) return {events: this.#appendSession(account, request), persistent: false};
            try {
                const directory = this.#accountDirectory(account, true)!;
                const key = this.#dataKey(directory, true)!;
                try {
                    const existing = this.#readFile(directory, key);
                    const persisted = request.events.map(event => this.#persistedEvent(account, event));
                    const events = prune([...existing, ...persisted], request.retentionDays);
                    this.#writeFile(directory, key, events);
                    return {events, persistent: true};
                }
                finally {key.fill(0);}
            }
            catch {
                this.#persistenceFailed = true;
                return {events: this.#appendSession(account, request), persistent: false};
            }
        });
    }

    read(rawAccount: unknown, rawRequest: unknown): Promise<{events: SolcordRelationshipEvent[]; persistent: boolean; complete: boolean;}> {
        const account = this.#account(rawAccount);
        const request = normalizeRequest(rawRequest, "read");
        return this.#queue.run(async () => {
            if (!this.#secureAvailable()) return {events: prune(this.#session.get(account) ?? [], request.retentionDays), persistent: false, complete: true};
            try {
                const directory = this.#accountDirectory(account, false);
                if (!directory) return {events: [], persistent: true, complete: true};
                const key = this.#dataKey(directory, false);
                if (!key) return {events: [], persistent: true, complete: true};
                try {
                    const events = prune(this.#readFile(directory, key), request.retentionDays);
                    this.#writeFile(directory, key, events);
                    return {events, persistent: true, complete: true};
                }
                finally {key.fill(0);}
            }
            catch {
                this.#persistenceFailed = true;
                return {events: prune(this.#session.get(account) ?? [], request.retentionDays), persistent: false, complete: false};
            }
        });
    }

    clear(rawAccount: unknown, rawRequest: unknown): Promise<{cleared: number; persistent: boolean; complete: boolean;}> {
        const account = this.#account(rawAccount);
        normalizeRequest(rawRequest, "clear");
        return this.#queue.run(async () => {
            const session = this.#session.get(account)?.length ?? 0;
            this.#session.delete(account);
            try {
                const directory = this.#accountDirectory(account, false);
                if (!directory) return {cleared: session, persistent: this.#secureAvailable(), complete: true};
                this.#assertDirectory(directory);
                let cleared = session;
                const names = fs.readdirSync(directory);
                for (const name of names) {
                    if (name !== "events.scdb" && name !== "data.sc-key" && !ACCOUNT_TRANSIENT_FILE.test(name)) continue;
                    const file = path.join(directory, name);
                    const stat = fs.lstatSync(file);
                    if (!stat.isFile() || stat.isSymbolicLink()) return {cleared, persistent: false, complete: false};
                    fs.unlinkSync(file);
                    cleared++;
                }
                const remaining = fs.readdirSync(directory);
                if (remaining.length === 0) {
                    fs.rmdirSync(directory);
                    return {cleared, persistent: this.#secureAvailable(), complete: true};
                }
                return {cleared, persistent: false, complete: false};
            }
            catch {return {cleared: session, persistent: false, complete: false};}
        });
    }

    #account(value: unknown): string {
        if (!validAccount(value)) throw new TypeError("Invalid Friend Watch account scope.");
        return value;
    }

    #secureAvailable(): boolean {
        if (this.#persistenceFailed) return false;
        try {return safeStorage.isEncryptionAvailable();}
        catch {this.#persistenceFailed = true; return false;}
    }

    #appendSession(account: string, request: {events: SolcordRelationshipEvent[]; retentionDays: 7 | 30 | 90;}): SolcordRelationshipEvent[] {
        const events = prune([...(this.#session.get(account) ?? []), ...request.events], request.retentionDays);
        this.#session.set(account, events);
        return events;
    }

    #persistedEvent(account: string, event: SolcordRelationshipEvent): SolcordRelationshipEvent {
        if (event.transition === "reconciled") return event;
        if (!event.subjectId) return event;
        const identity = this.#identity(true);
        if (!identity) throw new Error("Friend Watch identity key is unavailable.");
        const subjectKey = crypto.createHmac("sha256", identity).update(account, "utf8").update("\0", "utf8").update(event.subjectId, "utf8").digest("hex");
        const {subjectId: _subjectId, ...rest} = event;
        return {...rest, subjectKey};
    }

    #root(create: boolean): string | undefined {
        const base = path.resolve(resolveSolcordBetterDiscordRoot(app.getPath("userData")));
        const root = path.join(base, "solcord-friend-watch-v1");
        if (!fs.existsSync(base)) {
            if (!create) return;
            fs.mkdirSync(base, {recursive: true, mode: 0o700});
        }
        this.#assertDirectory(base);
        if (!fs.existsSync(root)) {
            if (!create) return;
            fs.mkdirSync(root, {mode: 0o700});
        }
        this.#assertDirectory(root);
        const realBase = fs.realpathSync.native(base);
        const realRoot = fs.realpathSync.native(root);
        if (!realRoot.startsWith(`${realBase}${path.sep}`)) throw new TypeError("Friend Watch root escapes BetterDiscord.");
        return root;
    }

    #identity(create: boolean): Buffer | undefined {
        const root = this.#root(create);
        if (!root) return;
        if (this.#identityKey) return this.#identityKey;
        const file = path.join(root, "identity.sc-key");
        if (fs.existsSync(file)) {this.#identityKey = this.#readWrappedKey(file, root);}
        else if (create) {
            const key = crypto.randomBytes(32);
            try {
                this.#atomicWrite(file, this.#wrapKey(key), root);
                this.#identityKey = key;
            }
            catch (error) {
                key.fill(0);
                throw error;
            }
        }
        return this.#identityKey;
    }

    #accountDirectory(account: string, create: boolean): string | undefined {
        const root = this.#root(create);
        const identity = this.#identity(create);
        if (!root || !identity) return;
        const opaque = crypto.createHmac("sha256", identity).update(account, "utf8").digest("hex").slice(0, 40);
        const directory = path.join(root, `store-${opaque}`);
        if (!STORE_DIRECTORY.test(path.basename(directory))) throw new TypeError("Invalid Friend Watch store name.");
        if (!fs.existsSync(directory)) {
            if (!create) return;
            fs.mkdirSync(directory, {mode: 0o700});
        }
        this.#assertDirectory(directory);
        if (!fs.realpathSync.native(directory).startsWith(`${fs.realpathSync.native(root)}${path.sep}`)) throw new TypeError("Friend Watch store escapes its root.");
        return directory;
    }

    #dataKey(directory: string, create: boolean): Buffer | undefined {
        const file = path.join(directory, "data.sc-key");
        if (fs.existsSync(file)) return this.#readWrappedKey(file, directory);
        if (!create) return;
        const key = crypto.randomBytes(32);
        try {this.#atomicWrite(file, this.#wrapKey(key), directory); return key;}
        catch (error) {key.fill(0); throw error;}
    }

    #wrapKey(key: Buffer): string {
        const encrypted = Buffer.from(safeStorage.encryptString(key.toString("base64")));
        try {
            const serialized = encrypted.toString("base64");
            if (encrypted.length === 0 || Buffer.byteLength(serialized, "utf8") > MAX_WRAPPED_KEY_BYTES) throw new RangeError("Friend Watch wrapped key exceeds its limit.");
            return serialized;
        }
        finally {encrypted.fill(0);}
    }

    #readWrappedKey(file: string, root: string): Buffer {
        this.#assertInside(file, root);
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_WRAPPED_KEY_BYTES) throw new TypeError("Invalid Friend Watch wrapped key.");
        const wrapped = Buffer.from(fs.readFileSync(file, "utf8"), "base64");
        const key = Buffer.from(safeStorage.decryptString(wrapped), "base64");
        if (key.length !== 32) throw new TypeError("Invalid Friend Watch key length.");
        return key;
    }

    #readFile(directory: string, key: Buffer): SolcordRelationshipEvent[] {
        this.#recoverAtomicFile(directory, key);
        const file = path.join(directory, "events.scdb");
        if (!fs.existsSync(file)) return [];
        return this.#readEnvelopeFile(file, key);
    }

    #readEnvelopeFile(file: string, key: Buffer): SolcordRelationshipEvent[] {
        const directory = path.dirname(file);
        this.#assertInside(file, directory);
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_ENVELOPE_BYTES) throw new TypeError("Invalid Friend Watch data file.");
        const envelope = JSON.parse(fs.readFileSync(file, "utf8")) as EncryptedEnvelope;
        const plaintext = this.#decrypt(key, envelope, directory);
        try {
            if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new RangeError("Friend Watch plaintext exceeds its limit.");
            const parsed = JSON.parse(plaintext.toString("utf8"));
            if (!Array.isArray(parsed) || parsed.length > MAX_EVENTS) throw new TypeError("Invalid Friend Watch data payload.");
            return parsed.map(raw => {
                const event = normalizeEvent(raw);
                if (!event) throw new TypeError("Invalid Friend Watch stored event.");
                return event;
            });
        }
        finally {plaintext.fill(0);}
    }

    #writeFile(directory: string, key: Buffer, events: SolcordRelationshipEvent[]): void {
        this.#recoverAtomicFile(directory, key);
        const plaintext = Buffer.from(JSON.stringify(events), "utf8");
        try {
            if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new RangeError("Friend Watch data exceeds its limit.");
            const iv = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
            cipher.setAAD(this.#accountAad(directory));
            const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
            const envelope: EncryptedEnvelope = {version: 2, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64")};
            this.#atomicWrite(path.join(directory, "events.scdb"), JSON.stringify(envelope), directory, true);
        }
        finally {plaintext.fill(0);}
    }

    #decrypt(key: Buffer, envelope: EncryptedEnvelope, directory: string): Buffer {
        if (envelope?.version !== 2 || ![envelope.iv, envelope.tag, envelope.ciphertext].every(value => typeof value === "string" && /^[a-zA-Z0-9+/]*={0,2}$/.test(value))) throw new TypeError("Invalid Friend Watch envelope.");
        const iv = Buffer.from(envelope.iv, "base64");
        const tag = Buffer.from(envelope.tag, "base64");
        const ciphertext = Buffer.from(envelope.ciphertext, "base64");
        if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > MAX_PLAINTEXT_BYTES) throw new TypeError("Invalid Friend Watch envelope lengths.");
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAAD(this.#accountAad(directory));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    }

    #accountAad(directory: string): Buffer {
        const store = path.basename(directory);
        if (!STORE_DIRECTORY.test(store)) throw new TypeError("Invalid Friend Watch account context.");
        return Buffer.from(`solcord-friend-watch-v2\0${store}`, "utf8");
    }

    #assertDirectory(directory: string): void {
        const stat = fs.lstatSync(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new TypeError("Friend Watch directory is unsafe.");
    }

    #assertInside(target: string, root: string): void {
        assertSolcordPathInside(target, root, "Friend Watch path escapes its root.");
    }

    #recoverAtomicFile(directory: string, key: Buffer): void {
        this.#assertDirectory(directory);
        recoverSolcordReplacedFile(path.join(directory, "events.scdb"), {
            artifacts: EVENT_ARTIFACTS,
            verify: file => {this.#readEnvelopeFile(file, key);},
            assertArtifact: file => this.#assertInside(file, directory),
            messages: {ambiguous: "Ambiguous Friend Watch recovery state.", unsafeArtifact: "Unsafe Friend Watch recovery artifact.", unsafeTarget: "Friend Watch target is unsafe."}
        });
    }

    /** Every Friend Watch file is fsynced again after its rename. */
    #atomicWrite(target: string, content: string, root: string, replace = false): void {
        this.#assertInside(target, root);
        writeSolcordFileAtomically(target, content, {replace, unsafeTarget: "Friend Watch target is unsafe.", verify: file => this.#flushFile(file), verifyNewFile: true});
    }

    #flushFile(file: string): void {
        const descriptor = fs.openSync(file, "r+");
        try {fs.fsyncSync(descriptor);}
        finally {fs.closeSync(descriptor);}
    }
}

export default new SolcordFriendWatchStorage();
