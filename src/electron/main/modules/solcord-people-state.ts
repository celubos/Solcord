// SPDX-License-Identifier: Apache-2.0

import fs from "fs";
import path from "path";
import {safeStorage} from "electron";

import {SolcordPrivateStoreFiles, SolcordSerialQueue} from "./solcord-private-store-files";

export interface SolcordPeoplePrivateState {
    version: 3;
    pinnedDmIds: string[];
    hiddenGuildIds: string[];
    guildAliases: Record<string, string>;
    favoriteFriendIds: string[];
    hiddenFriendIds: string[];
    ignoredVoiceChannelIds: string[];
    ignoredVoiceGuildIds: string[];
}

const DISCORD_ID = /^\d{1,32}$/;
const MAX_IDS = 500;
const MAX_ALIAS_LENGTH = 80;
const MAX_DOCUMENT_BYTES = 128 * 1024;
const MAX_WRAPPED_BYTES = 256 * 1024;

function normalizeIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const result: string[] = [];
    const seen = new Set<string>();
    for (const candidate of value) {
        if (typeof candidate !== "string" || !DISCORD_ID.test(candidate) || seen.has(candidate)) continue;
        seen.add(candidate);
        result.push(candidate);
        if (result.length === MAX_IDS) break;
    }
    return result;
}

function normalizeAlias(value: unknown): string {
    if (typeof value !== "string") return "";
    return [...value]
        .map(character => {
            const code = character.charCodeAt(0);
            return code < 32 || code === 127 ? " " : character;
        })
        .join("")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_ALIAS_LENGTH);
}

export function normalizeSolcordPeoplePrivateState(value: unknown): SolcordPeoplePrivateState {
    const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const aliases = record.guildAliases && typeof record.guildAliases === "object" && !Array.isArray(record.guildAliases)
        ? record.guildAliases as Record<string, unknown>
        : {};
    const guildAliases: Record<string, string> = {};
    for (const [guildId, rawAlias] of Object.entries(aliases)) {
        if (!DISCORD_ID.test(guildId)) continue;
        const alias = normalizeAlias(rawAlias);
        if (alias) guildAliases[guildId] = alias;
        if (Object.keys(guildAliases).length === MAX_IDS) break;
    }
    const state: SolcordPeoplePrivateState = {
        version: 3,
        pinnedDmIds: normalizeIds(record.pinnedDmIds),
        hiddenGuildIds: normalizeIds(record.hiddenGuildIds),
        guildAliases,
        favoriteFriendIds: normalizeIds(record.favoriteFriendIds),
        hiddenFriendIds: normalizeIds(record.hiddenFriendIds),
        ignoredVoiceChannelIds: normalizeIds(record.ignoredVoiceChannelIds),
        ignoredVoiceGuildIds: normalizeIds(record.ignoredVoiceGuildIds)
    };
    if (Buffer.byteLength(JSON.stringify(state), "utf8") > MAX_DOCUMENT_BYTES) throw new RangeError("People and Spaces state exceeds its storage limit.");
    return state;
}

const EMPTY_STATE: SolcordPeoplePrivateState = {version: 3, pinnedDmIds: [], hiddenGuildIds: [], guildAliases: {}, favoriteFriendIds: [], hiddenFriendIds: [], ignoredVoiceChannelIds: [], ignoredVoiceGuildIds: []};

export class SolcordPeopleStateStorage {
    #session = new Map<string, SolcordPeoplePrivateState>();
    #files = new SolcordPrivateStoreFiles<SolcordPeoplePrivateState>({
        directoryName: "solcord-people-state-v1",
        fileName: "state.scdb",
        maxWrappedBytes: MAX_WRAPPED_BYTES,
        normalize: normalizeSolcordPeoplePrivateState,
        messages: {
            unsafeDirectory: "People and Spaces storage directory is unsafe.",
            linkedDirectory: "People and Spaces storage directory resolves through a link.",
            pathEscapesRoot: "People and Spaces storage path escapes its root.",
            identityMissingWithArtifacts: "People and Spaces identity is missing while storage artifacts remain.",
            invalidIdentityFile: "Invalid People and Spaces identity file.",
            invalidIdentityKey: "Invalid People and Spaces identity key.",
            invalidStoreDirectory: "Invalid People and Spaces store directory.",
            invalidStoreFile: "Invalid People and Spaces state file.",
            invalidEncryptedDocument: "Invalid encrypted People and Spaces state.",
            ambiguousRecovery: "Ambiguous People and Spaces recovery state.",
            unsafeRecoveryArtifact: "Unsafe People and Spaces recovery artifact.",
            unsafeTarget: "People and Spaces state target is unsafe."
        }
    });
    #failed = false;
    #queue = new SolcordSerialQueue();

    status(): {persistent: boolean; sessionOnly: boolean; reason?: string;} {
        return this.#secureAvailable()
            ? {persistent: true, sessionOnly: false}
            : {persistent: false, sessionOnly: true, reason: "Electron safeStorage is unavailable; People and Spaces changes remain in memory only."};
    }

    read(rawAccount: unknown, rawRequest: unknown): Promise<{state: SolcordPeoplePrivateState; persistent: boolean; complete: boolean;}> {
        const account = this.#account(rawAccount);
        this.#emptyRequest(rawRequest);
        return this.#queue.run(async () => {
            if (!this.#secureAvailable()) return {state: structuredClone(this.#session.get(account) ?? EMPTY_STATE), persistent: false, complete: true};
            try {
                const directory = this.#files.accountDirectory(account, false);
                if (!directory) return {state: structuredClone(EMPTY_STATE), persistent: true, complete: true};
                this.#files.recover(directory);
                const file = path.join(directory, this.#files.fileName);
                if (!fs.existsSync(file)) return {state: structuredClone(EMPTY_STATE), persistent: true, complete: true};
                return {state: this.#files.readFile(file), persistent: true, complete: true};
            }
            catch {
                this.#failed = true;
                return {state: structuredClone(this.#session.get(account) ?? EMPTY_STATE), persistent: false, complete: false};
            }
        });
    }

    write(rawAccount: unknown, rawRequest: unknown): Promise<{state: SolcordPeoplePrivateState; persistent: boolean; complete: boolean;}> {
        const account = this.#account(rawAccount);
        if (!rawRequest || typeof rawRequest !== "object" || Array.isArray(rawRequest)) throw new TypeError("Invalid People and Spaces write request.");
        const request = rawRequest as Record<string, unknown>;
        if (Object.hasOwn(request, "accountId") || Object.hasOwn(request, "accountScope")) throw new TypeError("People and Spaces requests cannot select an account.");
        const state = normalizeSolcordPeoplePrivateState(request.state);
        this.#session.set(account, structuredClone(state));
        return this.#queue.run(async () => {
            if (!this.#secureAvailable()) return {state: structuredClone(state), persistent: false, complete: true};
            try {
                const directory = this.#files.accountDirectory(account, true)!;
                this.#files.recover(directory);
                this.#files.writeEncrypted(path.join(directory, this.#files.fileName), state);
                return {state: structuredClone(state), persistent: true, complete: true};
            }
            catch {
                this.#failed = true;
                return {state: structuredClone(state), persistent: false, complete: false};
            }
        });
    }

    clear(rawAccount: unknown, rawRequest: unknown): Promise<{cleared: boolean; persistent: boolean; complete: boolean;}> {
        const account = this.#account(rawAccount);
        this.#emptyRequest(rawRequest);
        const cleared = this.#session.delete(account);
        return this.#queue.run(async () => {
            try {
                const directory = this.#files.accountDirectory(account, false);
                if (!directory) return {cleared, persistent: this.#secureAvailable(), complete: true};
                this.#files.assertDirectory(directory);
                if (!this.#files.removeStoreFiles(directory)) return {cleared, persistent: false, complete: false};
                if (fs.readdirSync(directory).length !== 0) return {cleared, persistent: false, complete: false};
                fs.rmdirSync(directory);
                return {cleared: true, persistent: this.#secureAvailable(), complete: true};
            }
            catch {return {cleared, persistent: false, complete: false};}
        });
    }

    #account(value: unknown): string {
        if (typeof value !== "string" || !DISCORD_ID.test(value)) throw new TypeError("Invalid People and Spaces account scope.");
        return value;
    }

    #emptyRequest(value: unknown): void {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid People and Spaces request.");
        const request = value as Record<string, unknown>;
        if (Object.keys(request).length || Object.hasOwn(request, "accountId") || Object.hasOwn(request, "accountScope")) throw new TypeError("People and Spaces request must be empty and cannot select an account.");
    }

    #secureAvailable(): boolean {
        if (this.#failed) return false;
        try {return safeStorage.isEncryptionAvailable();}
        catch {return false;}
    }
}

export default new SolcordPeopleStateStorage();
