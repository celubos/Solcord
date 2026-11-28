// SPDX-License-Identifier: Apache-2.0

/**
 * Shared filesystem mechanics for Solcord's main-process stores.
 *
 * The primitives (verified atomic replacement, recovery after an interrupted
 * replacement, the safeStorage-wrapped identity key) are used by every encrypted
 * store. `SolcordPrivateStoreFiles` combines them into the account-obscured layout
 * shared by People and Spaces, Audience Guard, and Local Identity Notes: an
 * owner-only root under the BetterDiscord data folder, one HMAC-named directory per
 * account, and one encrypted document per directory. Each store supplies its own
 * names, limits, validation and exact error messages; nothing here decides what a
 * store contains.
 *
 * The smaller helpers serve the setup, timeline and provider-archive modules.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import {app, safeStorage} from "electron";

import {resolveSolcordBetterDiscordRoot} from "./solcord-data-root";


const STORE_DIRECTORY = /^store-[0-9a-f]{40}$/;
const IDENTITY_FILE = "identity.sc-key";

type ErrorConstructorLike = new (message: string) => Error;

function solcordBetterDiscordRoot(): string {
    return resolveSolcordBetterDiscordRoot(app.getPath("userData"));
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqueSibling(target: string, suffix: "old" | "tmp"): string {
    return `${target}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.${suffix}`;
}

function assertRegularFile(file: string, message: string): void {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new TypeError(message);
}

/** Throws unless `target` lies strictly inside `root`; `root` itself is rejected too. */
export function assertSolcordPathInside(target: string, root: string, message: string, ErrorType: ErrorConstructorLike = TypeError): void {
    const resolvedRoot = path.resolve(root);
    const resolvedTarget = path.resolve(target);
    if (resolvedTarget === resolvedRoot || !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) throw new ErrorType(message);
}

/** Runs asynchronous operations one at a time, in call order, whether earlier ones resolve or reject. */
export class SolcordSerialQueue {
    #tail: Promise<void> = Promise.resolve();

    run<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.#tail.then(operation, operation);
        this.#tail = result.then(() => undefined, () => undefined);
        return result;
    }
}

/**
 * Writes UTF-8 text to an owner-only temporary file, fsyncs it, and renames it over
 * `target`. The temporary file is removed when any step fails.
 */
export function writeSolcordTextAtomically(target: string, content: string): void {
    const temporary = uniqueSibling(target, "tmp");
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    try {
        fs.writeFileSync(descriptor, content, {encoding: "utf8"});
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        fs.renameSync(temporary, target);
    }
    catch (error) {
        try {fs.closeSync(descriptor);}
        catch {/* already closed */}
        try {if (fs.existsSync(temporary)) fs.unlinkSync(temporary);}
        catch {/* best effort */}
        throw error;
    }
}

export interface SolcordManagedDirectoryMessages {
    /** `target` is lexically outside the BetterDiscord data root. */
    escapesRoot: string;
    /** A directory on the way is a link, junction or non-directory. */
    unsafeNode: string;
    /** `target` resolves outside the real BetterDiscord data root. */
    resolvesOutside: string;
}

function assertManagedDirectoryNode(directory: string, message: string): void {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new TypeError(message);
}

/**
 * Ensures `target` is the BetterDiscord data root or a directory beneath it.
 * Missing levels are created owner-only (0o700) when `create` is true; otherwise a
 * missing directory returns false. Links, junctions and real paths that leave the
 * real data root are rejected.
 */
export function ensureSolcordManagedDirectory(target: string, create: boolean, messages: SolcordManagedDirectoryMessages): boolean {
    const base = path.resolve(solcordBetterDiscordRoot());
    const resolved = path.resolve(target);
    if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) throw new TypeError(messages.escapesRoot);

    if (!fs.existsSync(base)) {
        if (!create) return false;
        fs.mkdirSync(base, {recursive: true, mode: 0o700});
    }
    assertManagedDirectoryNode(base, messages.unsafeNode);
    if (resolved === base) return true;

    if (!fs.existsSync(resolved)) {
        if (!create) return false;
        const parent = path.dirname(resolved);
        if (parent !== base) ensureSolcordManagedDirectory(parent, true, messages);
        fs.mkdirSync(resolved, {recursive: false, mode: 0o700});
    }
    assertManagedDirectoryNode(resolved, messages.unsafeNode);
    const realBase = fs.realpathSync.native(base);
    const realTarget = fs.realpathSync.native(resolved);
    if (realTarget !== realBase && !realTarget.startsWith(`${realBase}${path.sep}`)) throw new TypeError(messages.resolvesOutside);
    return true;
}

/** Recognizes the `<fileName>.<pid>.<8 hex>.old` backups and `.tmp` files an interrupted replacement leaves. */
export interface SolcordReplacementArtifacts {
    isBackup(name: string): boolean;
    isTemporary(name: string): boolean;
}

export function solcordReplacementArtifacts(fileName: string): SolcordReplacementArtifacts {
    const escaped = escapeRegExp(fileName);
    const backup = new RegExp(`^${escaped}\\.\\d+\\.[0-9a-f]{8}\\.old$`);
    const temporary = new RegExp(`^${escaped}\\.\\d+\\.[0-9a-f]{8}\\.tmp$`);
    return {isBackup: name => backup.test(name), isTemporary: name => temporary.test(name)};
}

export interface SolcordAtomicWriteOptions {
    /** Keep an existing target as a backup until the new file passes `verify`, then delete it. */
    replace?: boolean;
    /** Thrown as a TypeError when an existing target to replace is not a regular file. */
    unsafeTarget: string;
    /** Runs on the new file after the rename; when it fails during a replacement, the previous file is restored. */
    verify?(file: string): void;
    /** Also run `verify` when no previous file was replaced. */
    verifyNewFile?: boolean;
}

/**
 * Writes `content` to an owner-only (0o600) temporary file, fsyncs it, and renames
 * it to `target`. The temporary file never outlives the call.
 */
export function writeSolcordFileAtomically(target: string, content: Buffer | string, options: SolcordAtomicWriteOptions): void {
    const temporary = uniqueSibling(target, "tmp");
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    try {
        fs.writeFileSync(descriptor, content);
        fs.fsyncSync(descriptor);
    }
    finally {fs.closeSync(descriptor);}
    try {
        if (options.replace && fs.existsSync(target)) {
            assertRegularFile(target, options.unsafeTarget);
            const backup = uniqueSibling(target, "old");
            fs.renameSync(target, backup);
            try {
                fs.renameSync(temporary, target);
                options.verify?.(target);
                fs.unlinkSync(backup);
            }
            catch (error) {
                if (!fs.existsSync(target) && fs.existsSync(backup)) fs.renameSync(backup, target);
                throw error;
            }
        }
        else {
            fs.renameSync(temporary, target);
            if (options.verifyNewFile) options.verify?.(target);
        }
    }
    finally {
        try {if (fs.existsSync(temporary)) fs.unlinkSync(temporary);}
        catch {/* preserve primary error */}
    }
}

export interface SolcordRecoveryOptions {
    artifacts: SolcordReplacementArtifacts;
    /** Throws unless the file at the given path is a valid document. */
    verify(file: string): void;
    /** Extra check for each backup or temporary path before it is inspected. */
    assertArtifact?(file: string): void;
    messages: {
        ambiguous: string;
        unsafeArtifact: string;
        /** When set, an existing target that is not a regular file is rejected before any backup is weighed. */
        unsafeTarget?: string;
    };
}

/**
 * Finishes or reverts an interrupted replacement of `target`: restores a lone backup
 * when the target is missing, keeps whichever of target and backup passes `verify`,
 * and removes temporary files. More than one backup is ambiguous and left untouched.
 */
export function recoverSolcordReplacedFile(target: string, options: SolcordRecoveryOptions): void {
    const {artifacts, messages} = options;
    const directory = path.dirname(target);
    const names = fs.readdirSync(directory);
    const backups = names.filter(name => artifacts.isBackup(name));
    const temporary = names.filter(name => artifacts.isTemporary(name));
    if (backups.length > 1) throw new TypeError(messages.ambiguous);
    for (const name of [...backups, ...temporary]) {
        const candidate = path.join(directory, name);
        options.assertArtifact?.(candidate);
        assertRegularFile(candidate, messages.unsafeArtifact);
    }
    if (!fs.existsSync(target) && backups.length === 1) fs.renameSync(path.join(directory, backups[0]), target);
    if (messages.unsafeTarget && fs.existsSync(target)) assertRegularFile(target, messages.unsafeTarget);
    const backup = backups.map(name => path.join(directory, name)).find(fs.existsSync);
    if (fs.existsSync(target) && backup) {
        try {
            options.verify(target);
            fs.unlinkSync(backup);
        }
        catch {
            const displaced = uniqueSibling(target, "old");
            fs.renameSync(target, displaced);
            try {
                fs.renameSync(backup, target);
                options.verify(target);
                fs.unlinkSync(displaced);
            }
            catch (error) {
                if (!fs.existsSync(target) && fs.existsSync(displaced)) fs.renameSync(displaced, target);
                throw error;
            }
        }
    }
    for (const name of temporary) fs.unlinkSync(path.join(directory, name));
}

export interface SolcordIdentityKeyOptions {
    maxWrappedBytes: number;
    /** Stores a newly wrapped key at `file`. */
    write(file: string, wrapped: Buffer): void;
    messages: {
        invalidFile: string;
        invalidKey: string;
        /**
         * When set, a missing key is fatal while anything else remains beside it:
         * retained files could not be assigned to an account, and a new key would
         * orphan them.
         */
        missingWithArtifacts?: string;
    };
}

/**
 * A 32-byte identity key kept as `identity.sc-key`, wrapped with Electron
 * safeStorage, and cached by this instance once loaded or created.
 */
export class SolcordIdentityKeyFile {
    readonly #options: SolcordIdentityKeyOptions;
    #identity?: Buffer;

    constructor(options: SolcordIdentityKeyOptions) {
        this.#options = options;
    }

    /**
     * Returns a copy of the key for the caller to zero after use. `root` is resolved
     * only when the key is not cached yet; it returns undefined when the store does
     * not exist. A missing key is created only when `create` is true.
     */
    get(root: () => string | undefined, create: boolean): Buffer | undefined {
        if (this.#identity) return Buffer.from(this.#identity);
        const directory = root();
        if (!directory) return;
        const file = path.join(directory, IDENTITY_FILE);
        const {messages} = this.#options;
        let identity: Buffer;
        if (fs.existsSync(file)) {
            const stat = fs.lstatSync(file);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > this.#options.maxWrappedBytes) throw new TypeError(messages.invalidFile);
            identity = Buffer.from(safeStorage.decryptString(fs.readFileSync(file)), "base64");
            if (identity.length !== 32) throw new TypeError(messages.invalidKey);
        }
        else {
            if (messages.missingWithArtifacts && fs.readdirSync(directory).length) throw new TypeError(messages.missingWithArtifacts);
            if (!create) return;
            identity = crypto.randomBytes(32);
            try {this.#options.write(file, safeStorage.encryptString(identity.toString("base64")));}
            catch (error) {
                identity.fill(0);
                throw error;
            }
        }
        this.#identity = Buffer.from(identity);
        return identity;
    }
}

/** Every message is thrown as a TypeError, exactly as written. */
export interface SolcordPrivateStoreMessages {
    /** A store directory is missing, not a directory, or is itself a link. */
    unsafeDirectory: string;
    /** A store directory's real path differs from its path (a parent link or junction). */
    linkedDirectory: string;
    pathEscapesRoot: string;
    /** See `SolcordIdentityKeyOptions`. */
    identityMissingWithArtifacts?: string;
    invalidIdentityFile: string;
    invalidIdentityKey: string;
    invalidStoreDirectory: string;
    invalidStoreFile: string;
    /** When set, the bytes actually read are bounds-checked again after the stat check. */
    invalidEnvelope?: string;
    invalidEncryptedDocument: string;
    ambiguousRecovery: string;
    unsafeRecoveryArtifact: string;
    unsafeTarget: string;
}

export interface SolcordPrivateStoreOptions<T> {
    /** Directory under the BetterDiscord data root, for example `solcord-people-state-v1`. */
    directoryName: string;
    /** Encrypted document inside each account directory, for example `state.scdb`. */
    fileName: string;
    /** Upper bound for the wrapped identity key and the wrapped document. */
    maxWrappedBytes: number;
    /** Validates a decrypted document; throws when it is not acceptable. */
    normalize(value: unknown): T;
    messages: SolcordPrivateStoreMessages;
}

/**
 * Files for one encrypted private store. Each storage instance owns its own
 * instance, so the unwrapped identity key is cached per storage instance.
 */
export class SolcordPrivateStoreFiles<T> {
    readonly fileName: string;
    readonly #options: SolcordPrivateStoreOptions<T>;
    readonly #messages: SolcordPrivateStoreMessages;
    readonly #artifacts: SolcordReplacementArtifacts;
    readonly #identity: SolcordIdentityKeyFile;

    constructor(options: SolcordPrivateStoreOptions<T>) {
        this.#options = options;
        this.#messages = options.messages;
        this.fileName = options.fileName;
        this.#artifacts = solcordReplacementArtifacts(options.fileName);
        this.#identity = new SolcordIdentityKeyFile({
            maxWrappedBytes: options.maxWrappedBytes,
            write: (file, wrapped) => this.#atomicWrite(file, wrapped, false),
            messages: {
                invalidFile: options.messages.invalidIdentityFile,
                invalidKey: options.messages.invalidIdentityKey,
                missingWithArtifacts: options.messages.identityMissingWithArtifacts
            }
        });
    }

    /** Whether `name` is a backup or temporary file left by an interrupted replacement. */
    isTransientFile(name: string): boolean {
        return this.#artifacts.isBackup(name) || this.#artifacts.isTemporary(name);
    }

    /**
     * Returns the account's store directory, creating it owner-only when `create` is
     * true. Returns undefined when the root, identity key or directory does not exist
     * and `create` is false.
     */
    accountDirectory(account: string, create: boolean): string | undefined {
        const root = this.#root(create);
        if (!root) return;
        const identity = this.#identity.get(() => this.#root(create), create);
        if (!identity) return;
        let opaque: string;
        try {opaque = crypto.createHmac("sha256", identity).update(account, "utf8").digest("hex").slice(0, 40);}
        finally {identity.fill(0);}
        const directory = path.join(root, `store-${opaque}`);
        if (!STORE_DIRECTORY.test(path.basename(directory))) throw new TypeError(this.#messages.invalidStoreDirectory);
        if (!fs.existsSync(directory)) {
            if (!create) return;
            fs.mkdirSync(directory, {recursive: false, mode: 0o700});
        }
        this.assertDirectory(directory);
        this.assertWithin(directory, root);
        return directory;
    }

    /** Throws unless `directory` is a real directory reached without any link or junction. */
    assertDirectory(directory: string): void {
        const stat = fs.lstatSync(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new TypeError(this.#messages.unsafeDirectory);
        if (path.resolve(fs.realpathSync.native(directory)) !== path.resolve(directory)) throw new TypeError(this.#messages.linkedDirectory);
    }

    assertWithin(target: string, root: string): void {
        assertSolcordPathInside(target, root, this.#messages.pathEscapesRoot);
    }

    /** Reads, decrypts and normalizes a stored document. */
    readFile(file: string): T {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > this.#options.maxWrappedBytes) throw new TypeError(this.#messages.invalidStoreFile);
        const wrapped = fs.readFileSync(file);
        if (this.#messages.invalidEnvelope && (wrapped.length <= 0 || wrapped.length > this.#options.maxWrappedBytes)) throw new TypeError(this.#messages.invalidEnvelope);
        return this.#options.normalize(JSON.parse(safeStorage.decryptString(wrapped)));
    }

    /** Encrypts `document` and replaces `target` with it, keeping the previous file until the new one reads back. */
    writeEncrypted(target: string, document: T): void {
        const wrapped = safeStorage.encryptString(JSON.stringify(document));
        if (!Buffer.isBuffer(wrapped) || wrapped.length <= 0 || wrapped.length > this.#options.maxWrappedBytes) throw new TypeError(this.#messages.invalidEncryptedDocument);
        this.#atomicWrite(target, wrapped, true);
    }

    /** Finishes or reverts an interrupted replacement of the document in `directory`. */
    recover(directory: string): void {
        this.assertDirectory(directory);
        const target = path.join(directory, this.fileName);
        this.assertWithin(target, directory);
        recoverSolcordReplacedFile(target, {
            artifacts: this.#artifacts,
            verify: file => this.readFile(file),
            assertArtifact: file => this.assertWithin(file, directory),
            messages: {ambiguous: this.#messages.ambiguousRecovery, unsafeArtifact: this.#messages.unsafeRecoveryArtifact}
        });
    }

    /**
     * Deletes the document and its transient files from `directory`. Returns false as
     * soon as one of them is not a regular file; files already deleted stay deleted.
     */
    removeStoreFiles(directory: string): boolean {
        for (const name of fs.readdirSync(directory)) {
            if (name !== this.fileName && !this.#artifacts.isTemporary(name) && !this.#artifacts.isBackup(name)) continue;
            const file = path.join(directory, name);
            const stat = fs.lstatSync(file);
            if (!stat.isFile() || stat.isSymbolicLink()) return false;
            fs.unlinkSync(file);
        }
        return true;
    }

    #root(create: boolean): string | undefined {
        const betterDiscord = path.resolve(solcordBetterDiscordRoot());
        const root = path.join(betterDiscord, this.#options.directoryName);
        if (!fs.existsSync(betterDiscord)) {
            if (!create) return;
            fs.mkdirSync(betterDiscord, {recursive: true, mode: 0o700});
        }
        this.assertDirectory(betterDiscord);
        if (!fs.existsSync(root)) {
            if (!create) return;
            fs.mkdirSync(root, {recursive: false, mode: 0o700});
        }
        this.assertDirectory(root);
        this.assertWithin(root, betterDiscord);
        return root;
    }

    #atomicWrite(target: string, content: Buffer, replace: boolean): void {
        const directory = path.dirname(target);
        this.assertDirectory(directory);
        this.assertWithin(target, directory);
        writeSolcordFileAtomically(target, content, {replace, unsafeTarget: this.#messages.unsafeTarget, verify: file => this.readFile(file)});
    }
}
