// SPDX-License-Identifier: Apache-2.0

import fs from "fs";
import path from "path";
import {safeStorage} from "electron";

import {SolcordPrivateStoreFiles, SolcordSerialQueue} from "./solcord-private-store-files";

interface AudienceEntry {
    userId: string;
    label?: string;
}

interface AudiencePolicy {
    version: 1;
    entries: AudienceEntry[];
}

const ACCOUNT_ID = /^\d{1,32}$/;
const MAX_ENTRIES = 100;
const MAX_POLICY_BYTES = 32 * 1024;
const MAX_WRAPPED_BYTES = 64 * 1024;

function normalizeEntries(value: unknown): AudienceEntry[] {
    if (!Array.isArray(value)) return [];
    const result: AudienceEntry[] = [];
    const seen = new Set<string>();
    for (const candidate of value) {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
        const entry = candidate as Record<string, unknown>;
        if (typeof entry.userId !== "string" || !ACCOUNT_ID.test(entry.userId) || seen.has(entry.userId)) continue;
        seen.add(entry.userId);
        const printableLabel = typeof entry.label === "string" ? [...entry.label].map(character => {
            const code = character.charCodeAt(0);
            return code < 32 || code === 127 ? " " : character;
        }).join("") : "";
        const label = printableLabel.replace(/\s+/g, " ").trim().slice(0, 80);
        result.push({userId: entry.userId, ...(label ? {label} : {})});
        if (result.length === MAX_ENTRIES) break;
    }
    return result;
}

function normalizePolicy(value: unknown): AudiencePolicy {
    const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const policy = {version: 1 as const, entries: normalizeEntries(record.entries)};
    if (Buffer.byteLength(JSON.stringify(policy), "utf8") > MAX_POLICY_BYTES) throw new RangeError("Audience Guard policy exceeds its storage limit.");
    return policy;
}

export class SolcordAudienceGuardStorage {
    #session = new Map<string, AudiencePolicy>();
    #files = new SolcordPrivateStoreFiles<AudiencePolicy>({
        directoryName: "solcord-audience-guard-v1",
        fileName: "policy.scdb",
        maxWrappedBytes: MAX_WRAPPED_BYTES,
        normalize: normalizePolicy,
        messages: {
            unsafeDirectory: "Audience Guard storage directory is unsafe.",
            linkedDirectory: "Audience Guard storage directory resolves through a link.",
            pathEscapesRoot: "Audience Guard storage path escapes its root.",
            invalidIdentityFile: "Invalid Audience Guard identity file.",
            invalidIdentityKey: "Invalid Audience Guard identity key.",
            invalidStoreDirectory: "Invalid Audience Guard store directory.",
            invalidStoreFile: "Invalid Audience Guard policy file.",
            invalidEnvelope: "Invalid Audience Guard policy envelope.",
            invalidEncryptedDocument: "Invalid Audience Guard encrypted policy.",
            ambiguousRecovery: "Ambiguous Audience Guard recovery state.",
            unsafeRecoveryArtifact: "Unsafe Audience Guard recovery artifact.",
            unsafeTarget: "Audience Guard policy target is unsafe."
        }
    });
    #failed = false;
    #queue = new SolcordSerialQueue();

    status(): {persistent: boolean; sessionOnly: boolean; reason?: string;} {
        return this.#secureAvailable()
            ? {persistent: true, sessionOnly: false}
            : {persistent: false, sessionOnly: true, reason: "Electron safeStorage is unavailable; the Audience Guard denylist remains in memory only."};
    }

    read(rawAccount: unknown, rawRequest: unknown): Promise<{policy: AudiencePolicy; persistent: boolean; complete: boolean;}> {
        const account = this.#account(rawAccount);
        this.#emptyRequest(rawRequest);
        return this.#queue.run(async () => {
            if (!this.#secureAvailable()) return {policy: structuredClone(this.#session.get(account) ?? {version: 1, entries: []}), persistent: false, complete: true};
            try {
                const directory = this.#files.accountDirectory(account, false);
                if (!directory) return {policy: {version: 1, entries: []}, persistent: true, complete: true};
                this.#files.recover(directory);
                const file = path.join(directory, this.#files.fileName);
                if (!fs.existsSync(file)) return {policy: {version: 1, entries: []}, persistent: true, complete: true};
                return {policy: this.#files.readFile(file), persistent: true, complete: true};
            }
            catch {
                this.#failed = true;
                return {policy: structuredClone(this.#session.get(account) ?? {version: 1, entries: []}), persistent: false, complete: false};
            }
        });
    }

    write(rawAccount: unknown, rawRequest: unknown): Promise<{policy: AudiencePolicy; persistent: boolean; complete: boolean;}> {
        const account = this.#account(rawAccount);
        if (!rawRequest || typeof rawRequest !== "object" || Array.isArray(rawRequest)) throw new TypeError("Invalid Audience Guard write request.");
        const request = rawRequest as Record<string, unknown>;
        if (Object.hasOwn(request, "accountId") || Object.hasOwn(request, "accountScope")) throw new TypeError("Audience Guard requests cannot select an account.");
        const policy = normalizePolicy(request.policy);
        this.#session.set(account, structuredClone(policy));
        return this.#queue.run(async () => {
            if (!this.#secureAvailable()) return {policy: structuredClone(policy), persistent: false, complete: true};
            try {
                const directory = this.#files.accountDirectory(account, true)!;
                this.#files.recover(directory);
                const file = path.join(directory, this.#files.fileName);
                this.#files.assertWithin(file, directory);
                this.#files.writeEncrypted(file, policy);
                return {policy: structuredClone(policy), persistent: true, complete: true};
            }
            catch {
                this.#failed = true;
                return {policy: structuredClone(policy), persistent: false, complete: false};
            }
        });
    }

    clear(rawAccount: unknown, rawRequest: unknown): Promise<{cleared: number; persistent: boolean; complete: boolean;}> {
        const account = this.#account(rawAccount);
        this.#emptyRequest(rawRequest);
        const cleared = this.#session.get(account)?.entries.length ?? 0;
        this.#session.delete(account);
        return this.#queue.run(async () => {
            try {
                const directory = this.#files.accountDirectory(account, false);
                if (!directory) return {cleared, persistent: this.#secureAvailable(), complete: true};
                this.#files.assertDirectory(directory);
                if (!this.#files.removeStoreFiles(directory)) return {cleared, persistent: false, complete: false};
                if (fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
                return {cleared, persistent: this.#secureAvailable(), complete: true};
            }
            catch {return {cleared, persistent: false, complete: false};}
        });
    }

    #account(value: unknown): string {
        if (typeof value !== "string" || !ACCOUNT_ID.test(value)) throw new TypeError("Invalid Audience Guard account scope.");
        return value;
    }

    #emptyRequest(value: unknown): void {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid Audience Guard request.");
        const request = value as Record<string, unknown>;
        if (Object.keys(request).length || Object.hasOwn(request, "accountId") || Object.hasOwn(request, "accountScope")) throw new TypeError("Audience Guard request must be empty and cannot select an account.");
    }

    #secureAvailable(): boolean {
        if (this.#failed) return false;
        try {return safeStorage.isEncryptionAvailable();}
        catch {return false;}
    }
}

export default new SolcordAudienceGuardStorage();
