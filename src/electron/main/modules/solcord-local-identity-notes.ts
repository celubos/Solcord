// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import {safeStorage} from "electron";

import {SolcordPrivateStoreFiles, SolcordSerialQueue} from "./solcord-private-store-files";


export interface SolcordStoredIdentityNote {
    subjectId: string;
    text: string;
    tags: string[];
    updatedAt: number;
}

interface IdentityNoteDocument {
    version: 1;
    notes: SolcordStoredIdentityNote[];
}

const ACCOUNT_ID = /^\d{1,32}$/;
const MAX_NOTES = 500;
const MAX_DOCUMENT_BYTES = 512 * 1024;
const MAX_WRAPPED_BYTES = 1024 * 1024;
const EMPTY_DOCUMENT: IdentityNoteDocument = {version: 1, notes: []};

function printableText(value: unknown, maximumLength: number, label: string): string {
    if (typeof value !== "string" || value.length > maximumLength || [...value].some(character => {
        const code = character.charCodeAt(0);
        return code === 0 || code === 8 || code === 11 || code === 12 || code === 127;
    })) throw new TypeError(`Invalid ${label}.`);
    return value;
}

function normalizeTags(value: unknown): string[] {
    if (!Array.isArray(value)) throw new TypeError("Invalid identity note tags.");
    const result: string[] = [];
    const seen = new Set<string>();
    for (const candidate of value) {
        const tag = printableText(candidate, 24, "identity note tag").trim();
        if (!tag || seen.has(tag)) continue;
        seen.add(tag);
        result.push(tag);
        if (result.length > 8) throw new RangeError("An identity note supports at most eight tags.");
    }
    return result;
}

function normalizeNote(value: unknown, updatedAt = Date.now()): SolcordStoredIdentityNote {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid identity note.");
    const note = value as Record<string, unknown>;
    if (typeof note.subjectId !== "string" || !ACCOUNT_ID.test(note.subjectId)) throw new TypeError("Invalid identity note subject.");
    const timestamp = typeof note.updatedAt === "number" ? note.updatedAt : updatedAt;
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new TypeError("Invalid identity note timestamp.");
    return {subjectId: note.subjectId, text: printableText(note.text, 280, "identity note text"), tags: normalizeTags(note.tags), updatedAt: timestamp};
}

function normalizeDocument(value: unknown): IdentityNoteDocument {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid identity note document.");
    const record = value as Record<string, unknown>;
    if (record.version !== 1 || !Array.isArray(record.notes)) throw new TypeError("Invalid identity note document version.");
    const notes = new Map<string, SolcordStoredIdentityNote>();
    for (const candidate of record.notes) {
        const note = normalizeNote(candidate);
        notes.set(note.subjectId, note);
        if (notes.size > MAX_NOTES) throw new RangeError("Local identity note limit reached.");
    }
    const document: IdentityNoteDocument = {version: 1, notes: [...notes.values()].sort((left, right) => right.updatedAt - left.updatedAt)};
    if (Buffer.byteLength(JSON.stringify(document), "utf8") > MAX_DOCUMENT_BYTES) throw new RangeError("Local identity notes exceed their storage limit.");
    return document;
}

function cloneDocument(document: IdentityNoteDocument): IdentityNoteDocument {
    return structuredClone(document);
}

export class SolcordLocalIdentityNotesStorage {
    #session = new Map<string, IdentityNoteDocument>();
    #files = new SolcordPrivateStoreFiles<IdentityNoteDocument>({
        directoryName: "solcord-local-identity-notes-v1",
        fileName: "notes.scdb",
        maxWrappedBytes: MAX_WRAPPED_BYTES,
        normalize: normalizeDocument,
        messages: {
            unsafeDirectory: "Identity note storage directory is unsafe.",
            linkedDirectory: "Identity note storage directory is unsafe.",
            pathEscapesRoot: "Identity note storage path escaped its root.",
            invalidIdentityFile: "Invalid identity note storage key.",
            invalidIdentityKey: "Invalid identity note storage key.",
            invalidStoreDirectory: "Invalid identity note store directory.",
            invalidStoreFile: "Invalid identity note file.",
            invalidEncryptedDocument: "Invalid encrypted identity note document.",
            ambiguousRecovery: "Ambiguous identity note recovery state.",
            unsafeRecoveryArtifact: "Unsafe identity note recovery artifact.",
            unsafeTarget: "Identity note target is unsafe."
        }
    });
    #failed = false;
    #queue = new SolcordSerialQueue();

    status(): {persistent: boolean; sessionOnly: boolean; reason?: string;} {
        return this.#secureAvailable()
            ? {persistent: true, sessionOnly: false}
            : {persistent: false, sessionOnly: true, reason: "Electron safeStorage is unavailable; Local Identity Notes remain in memory only for this session."};
    }

    read(rawAccount: unknown, rawRequest: unknown): Promise<{notes: SolcordStoredIdentityNote[]; persistent: boolean; complete: boolean;}> {
        const account = this.#account(rawAccount);
        this.#emptyRequest(rawRequest);
        return this.#queue.run(async () => {
            const result = this.#readDocument(account);
            return {notes: result.document.notes, persistent: result.persistent, complete: result.complete};
        });
    }

    write(rawAccount: unknown, rawRequest: unknown): Promise<{note: SolcordStoredIdentityNote; persistent: boolean; complete: boolean;}> {
        const account = this.#account(rawAccount);
        if (!rawRequest || typeof rawRequest !== "object" || Array.isArray(rawRequest)) throw new TypeError("Invalid identity note write request.");
        const request = rawRequest as Record<string, unknown>;
        this.#rejectAuthority(request);
        if (request.storage !== "secure-only" || Object.keys(request).some(key => !["subjectId", "note", "tags", "storage"].includes(key))) throw new TypeError("Identity note writes require the reviewed secure-only intent.");
        const note = normalizeNote({subjectId: request.subjectId, text: request.note, tags: request.tags});
        return this.#queue.run(async () => {
            const current = this.#readDocument(account);
            const notes = new Map(current.document.notes.map(item => [item.subjectId, item]));
            if (!notes.has(note.subjectId) && notes.size >= MAX_NOTES) throw new RangeError("Local identity note limit reached.");
            notes.set(note.subjectId, note);
            const document = normalizeDocument({version: 1, notes: [...notes.values()]});
            this.#session.set(account, cloneDocument(document));
            const stored = document.notes.find(item => item.subjectId === note.subjectId)!;
            if (!this.#secureAvailable()) return {note: structuredClone(stored), persistent: false, complete: true};
            try {
                this.#writeDocument(account, document);
                return {note: structuredClone(stored), persistent: true, complete: true};
            }
            catch {
                this.#failed = true;
                return {note: structuredClone(stored), persistent: false, complete: false};
            }
        });
    }

    remove(rawAccount: unknown, rawRequest: unknown): Promise<{removed: boolean; persistent: boolean; complete: boolean;}> {
        const account = this.#account(rawAccount);
        if (!rawRequest || typeof rawRequest !== "object" || Array.isArray(rawRequest)) throw new TypeError("Invalid identity note remove request.");
        const request = rawRequest as Record<string, unknown>;
        this.#rejectAuthority(request);
        if (typeof request.subjectId !== "string" || !ACCOUNT_ID.test(request.subjectId) || Object.keys(request).some(key => key !== "subjectId")) throw new TypeError("Invalid identity note subject.");
        return this.#queue.run(async () => {
            const current = this.#readDocument(account);
            const notes = new Map(current.document.notes.map(item => [item.subjectId, item]));
            const removed = notes.delete(request.subjectId as string);
            const document = normalizeDocument({version: 1, notes: [...notes.values()]});
            this.#session.set(account, cloneDocument(document));
            if (!this.#secureAvailable()) return {removed, persistent: false, complete: true};
            try {
                this.#writeDocument(account, document);
                return {removed, persistent: true, complete: true};
            }
            catch {
                this.#failed = true;
                return {removed, persistent: false, complete: false};
            }
        });
    }

    clear(rawAccount: unknown, rawRequest: unknown): Promise<{cleared: number; persistent: boolean; complete: boolean;}> {
        const account = this.#account(rawAccount);
        this.#emptyRequest(rawRequest);
        return this.#queue.run(async () => {
            const current = this.#readDocument(account);
            const cleared = current.document.notes.length;
            this.#session.delete(account);
            try {
                const directory = this.#files.accountDirectory(account, false);
                if (!directory) return {cleared, persistent: this.#secureAvailable(), complete: true};
                if (!this.#files.removeStoreFiles(directory)) throw new TypeError("Unsafe identity note residue.");
                if (fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
                return {cleared, persistent: this.#secureAvailable(), complete: true};
            }
            catch {return {cleared, persistent: false, complete: false};}
        });
    }

    #readDocument(account: string): {document: IdentityNoteDocument; persistent: boolean; complete: boolean;} {
        const fallback = cloneDocument(this.#session.get(account) ?? EMPTY_DOCUMENT);
        if (!this.#secureAvailable()) return {document: fallback, persistent: false, complete: true};
        try {
            const file = this.#notesFile(account, false);
            if (!file) return {document: fallback, persistent: true, complete: true};
            const directory = path.dirname(file);
            this.#files.recover(directory);
            if (!fs.existsSync(file)) return {document: fallback, persistent: true, complete: true};
            const document = this.#files.readFile(file);
            this.#session.set(account, cloneDocument(document));
            return {document, persistent: true, complete: true};
        }
        catch {
            this.#failed = true;
            return {document: fallback, persistent: false, complete: false};
        }
    }

    #writeDocument(account: string, document: IdentityNoteDocument): void {
        const file = this.#notesFile(account, true)!;
        this.#files.recover(path.dirname(file));
        this.#files.writeEncrypted(file, document);
    }

    #account(value: unknown): string {
        if (typeof value !== "string" || !ACCOUNT_ID.test(value)) throw new TypeError("Invalid identity note account scope.");
        return value;
    }

    #emptyRequest(value: unknown): void {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid identity note request.");
        const request = value as Record<string, unknown>;
        this.#rejectAuthority(request);
        if (Object.keys(request).length) throw new TypeError("Identity note request must be empty.");
    }

    #rejectAuthority(request: Record<string, unknown>): void {
        if (Object.hasOwn(request, "accountId") || Object.hasOwn(request, "accountScope") || Object.hasOwn(request, "capability")) throw new TypeError("Identity note requests cannot select their authority.");
    }

    #secureAvailable(): boolean {
        if (this.#failed) return false;
        try {return safeStorage.isEncryptionAvailable();}
        catch {return false;}
    }

    #notesFile(account: string, create: boolean): string | undefined {
        const directory = this.#files.accountDirectory(account, create);
        if (!directory) return;
        const file = path.join(directory, this.#files.fileName);
        this.#files.assertWithin(file, directory);
        const hasTransient = fs.readdirSync(directory).some(name => this.#files.isTransientFile(name));
        return fs.existsSync(file) || hasTransient || create ? file : undefined;
    }
}

export default new SolcordLocalIdentityNotesStorage();
