// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {injectDeveloperLoader} from "../../scripts/helpers/developer-inject";

export type MacChannel = "stable" | "ptb" | "canary";
export const MAC_CHANNELS = {stable: "Discord.app", ptb: "Discord PTB.app", canary: "Discord Canary.app"} as const;
export interface MacPackageManifest {
    schemaVersion: 1;
    kind: "solcord-macos-preview";
    version: string;
    candidateLabel: string;
    sourceCommit: string;
    artifact: {file: "solcord.asar"; sha256: string; bytes: number;};
    buildManifestSha256: string;
}
export interface MacReceipt {
    schemaVersion: 1;
    channel: MacChannel;
    package: MacPackageManifest;
    bundleSha256: string;
    sourcePath: string;
    sourceSha256: string;
    installedAt: string;
    previous?: {transaction: string; receiptSha256: string;};
}
export interface MacNativeAdapter {
    assertIdle(sourcePath?: string): void;
    verifySource(sourcePath: string, channel: MacChannel): void;
    copyBundle(source: string, target: string): void;
    signBundle(target: string): void;
    verifySignature(target: string): void;
    isProcessAlive(pid: number): boolean;
}
interface Journal {
    schemaVersion: 1;
    transaction: string;
    previous: MacReceipt | null;
    previousSha256: string | null;
    next: MacReceipt | null;
}
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function macHash(file: string): string {
    const entry = fs.lstatSync(file);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) throw Error("Expected an unlinked regular file.");
    const hash = crypto.createHash("sha256"); const handle = fs.openSync(file, "r");
    try {const buffer = Buffer.alloc(1024 * 1024); for (let count; (count = fs.readSync(handle, buffer)) > 0;) hash.update(buffer.subarray(0, count));}
    finally {fs.closeSync(handle);}
    return hash.digest("hex");
}
function contained(root: string, target: string): boolean {
    const relative = path.relative(root, target);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function rejectLinkedPath(target: string): void {
    for (let current = path.resolve(target); ; current = path.dirname(current)) {
        try {if (fs.lstatSync(current).isSymbolicLink()) throw Error("Installer paths must not contain symbolic links.");}
        catch (error) {if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;}
        if (path.dirname(current) === current) break;
    }
}
function regularJSON<T>(file: string): T {
    rejectLinkedPath(file);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1024 * 1024 || stat.size === 0) throw Error("Installer metadata is unsafe or too large.");
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}
function writeAtomic(file: string, value: unknown): void {
    rejectLinkedPath(file);
    if (fs.existsSync(file) && fs.lstatSync(file).nlink !== 1) throw Error("Refusing linked installer metadata.");
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    const handle = fs.openSync(temporary, "wx", 0o600);
    try {fs.writeFileSync(handle, JSON.stringify(value, null, 2) + "\n"); fs.fsyncSync(handle);}
    finally {fs.closeSync(handle);}
    fs.renameSync(temporary, file);
}

/** Hash bundle bytes, relative link targets and modes; framework links may stay inside the bundle only. */
export function macBundleHash(root: string): string {
    rejectLinkedPath(root);
    if (!fs.lstatSync(root).isDirectory()) throw Error("Expected an application bundle directory.");
    let files = 0, bytes = 0; const hash = crypto.createHash("sha256");
    const walk = (directory: string) => {
        for (const name of fs.readdirSync(directory).sort()) {
            if (++files > 50_000) throw Error("Application bundle exceeds its file limit.");
            const file = path.join(directory, name), relative = path.relative(root, file).replaceAll(path.sep, "/"), entry = fs.lstatSync(file);
            if (entry.isSymbolicLink()) {
                const link = fs.readlinkSync(file);
                if (path.isAbsolute(link) || !contained(root, fs.realpathSync(file))) throw Error("Application bundle contains an escaping link.");
                hash.update(JSON.stringify([relative, "link", link]));
            }
            else if (entry.isDirectory()) {hash.update(JSON.stringify([relative, "directory", entry.mode & 0o777])); walk(file);}
            else if (entry.isFile() && entry.nlink === 1) {
                bytes += entry.size;
                if (entry.size > 512 * 1024 * 1024 || bytes > 4 * 1024 * 1024 * 1024) throw Error("Application bundle exceeds its byte limit.");
                hash.update(JSON.stringify([relative, "file", entry.mode & 0o777, entry.size, macHash(file)]));
            }
            else {throw Error("Application bundle contains unsupported filesystem entries.");}
        }
    };
    walk(root); return hash.digest("hex");
}
export function readMacPackage(directory: string, expectedManifestSha256: string): {manifest: MacPackageManifest; artifact: string;} {
    if (!HASH.test(expectedManifestSha256)) throw Error("This installer has no pinned package identity.");
    const file = path.join(directory, "solcord-macos-manifest.json");
    if (macHash(file) !== expectedManifestSha256) throw Error("The macOS package manifest changed.");
    const manifest = regularJSON<MacPackageManifest>(file);
    if (manifest.schemaVersion !== 1 || manifest.kind !== "solcord-macos-preview" || !/^\d+\.\d+\.\d+$/.test(manifest.version)
        || !/^v[0-9a-z.-]+$/i.test(manifest.candidateLabel) || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit) || manifest.artifact?.file !== "solcord.asar"
        || !HASH.test(manifest.artifact.sha256) || !Number.isSafeInteger(manifest.artifact.bytes) || manifest.artifact.bytes <= 0 || manifest.artifact.bytes > 128 * 1024 * 1024 || !HASH.test(manifest.buildManifestSha256)) throw Error("The macOS package manifest is invalid.");
    const artifact = path.join(directory, "solcord.asar");
    if (fs.lstatSync(artifact).size !== manifest.artifact.bytes || macHash(artifact) !== manifest.artifact.sha256 || macHash(path.join(directory, "solcord-build-manifest.json")) !== manifest.buildManifestSha256) throw Error("The macOS package failed integrity verification.");
    return {manifest, artifact};
}

/** Owns only ~/Applications/Solcord. Discord bundles and all user profiles are read-only inputs. */
export class MacInstaller {
    readonly root: string;
    readonly channelRoot: string;
    readonly target: string;
    private readonly state: string;
    constructor(home: string, readonly channel: MacChannel, private readonly native: MacNativeAdapter, private readonly fault?: (phase: string) => void) {
        if (!path.isAbsolute(home) || !Object.hasOwn(MAC_CHANNELS, channel)) throw Error("Invalid macOS home or Discord channel.");
        rejectLinkedPath(home);
        this.root = path.join(home, "Applications", "Solcord"); this.channelRoot = path.join(this.root, channel);
        this.target = path.join(this.channelRoot, MAC_CHANNELS[channel]); this.state = path.join(this.channelRoot, "state");
        rejectLinkedPath(this.root);
    }
    private owned(file: string): string {
        if (!contained(this.channelRoot, file)) throw Error("Installer path escaped its owned channel.");
        rejectLinkedPath(file); return file;
    }
    private prepare(): void {
        rejectLinkedPath(this.root);
        const marker = path.join(this.root, ".solcord-macos.json");
        if (fs.existsSync(this.root) && !fs.existsSync(marker) && fs.readdirSync(this.root).length) throw Error("The Solcord application folder contains unrecognized files.");
        fs.mkdirSync(this.root, {recursive: true, mode: 0o700});
        if (fs.existsSync(marker)) {const value = regularJSON<{schemaVersion: number; kind: string;}>(marker); if (value.schemaVersion !== 1 || value.kind !== "solcord-macos-owned-root") throw Error("The Solcord application folder has an unknown owner.");}
        else {writeAtomic(marker, {schemaVersion: 1, kind: "solcord-macos-owned-root"});}
        if (fs.existsSync(this.channelRoot) && !fs.existsSync(this.state) && fs.readdirSync(this.channelRoot).length) throw Error("The selected channel folder is not owned by this installer.");
        fs.mkdirSync(this.owned(this.state), {recursive: true, mode: 0o700});
        for (const child of ["transactions", "payloads"]) fs.mkdirSync(this.owned(path.join(this.state, child)), {recursive: true, mode: 0o700});
    }
    private receipt(): MacReceipt | null {
        const file = this.owned(path.join(this.state, "current.json"));
        if (!fs.existsSync(file)) return null;
        const receipt = regularJSON<MacReceipt>(file);
        if (receipt.schemaVersion !== 1 || receipt.channel !== this.channel || !HASH.test(receipt.bundleSha256) || !HASH.test(receipt.sourceSha256)
            || receipt.package?.kind !== "solcord-macos-preview" || !HASH.test(receipt.package.artifact?.sha256 ?? "")
            || (receipt.previous && (!UUID.test(receipt.previous.transaction) || !HASH.test(receipt.previous.receiptSha256)))) throw Error("The installed receipt is invalid.");
        return receipt;
    }
    private withLock<T>(operation: () => T, recover = false): T {
        this.prepare(); const lock = this.owned(path.join(this.state, "operation.lock"));
        if (fs.existsSync(lock)) {
            const previous = regularJSON<{pid: number;}>(lock);
            if (!recover || !Number.isSafeInteger(previous.pid) || previous.pid < 1 || this.native.isProcessAlive(previous.pid)) throw Error("Another installer may be running. Close it, then use recover for an interrupted operation.");
            fs.renameSync(lock, this.owned(path.join(this.state, `abandoned-lock-${crypto.randomUUID()}.json`)));
        }
        const nonce = crypto.randomUUID(); fs.writeFileSync(lock, JSON.stringify({pid: process.pid, nonce}), {flag: "wx", mode: 0o600});
        try {
            if (!recover && fs.existsSync(this.owned(path.join(this.state, "pending.json")))) throw Error("An interrupted transaction needs recover before another operation.");
            return operation();
        }
        finally {if (fs.existsSync(lock) && regularJSON<{nonce: string;}>(lock).nonce === nonce) fs.unlinkSync(lock);}
    }
    private transactionPaths(id: string) {
        if (!UUID.test(id)) throw Error("The transaction identity is invalid.");
        const directory = this.owned(path.join(this.state, "transactions", id));
        return {directory, stage: path.join(directory, "next.app"), backup: path.join(directory, "previous.app"), priorReceipt: path.join(directory, "previous.json")};
    }
    inspect(): {target: string; installed: boolean; interrupted: boolean; receipt: MacReceipt | null;} {
        rejectLinkedPath(this.channelRoot);
        const receipt = fs.existsSync(this.state) ? this.receipt() : null;
        return {target: this.target, installed: Boolean(receipt), interrupted: fs.existsSync(path.join(this.state, "pending.json")), receipt};
    }
    verify(): MacReceipt {
        const receipt = this.receipt();
        if (!receipt) throw Error("This channel has no managed Solcord installation.");
        const payload = this.owned(path.join(this.state, "payloads", `${receipt.package.artifact.sha256}.asar`));
        if (macHash(payload) !== receipt.package.artifact.sha256 || macBundleHash(this.target) !== receipt.bundleSha256) throw Error("Installed files changed. Repair preserves this copy before replacing it.");
        this.native.verifySignature(this.target); return receipt;
    }
    install(source: string, manifest: MacPackageManifest, artifact: string): MacReceipt {
        return this.withLock(() => {
            const original = path.resolve(source);
            if (!path.isAbsolute(source) || contained(this.root, original)) throw Error("Choose the original Discord app outside the managed Solcord folder.");
            rejectLinkedPath(original); this.native.assertIdle(original); this.native.verifySource(original, this.channel);
            const sourceSha256 = macBundleHash(original);
            const payload = this.owned(path.join(this.state, "payloads", `${manifest.artifact.sha256}.asar`));
            if (macHash(artifact) !== manifest.artifact.sha256 || fs.statSync(artifact).size !== manifest.artifact.bytes) throw Error("The selected Solcord payload changed.");
            if (!fs.existsSync(payload)) fs.copyFileSync(artifact, payload, fs.constants.COPYFILE_EXCL);
            if (macHash(payload) !== manifest.artifact.sha256) throw Error("The immutable payload failed verification.");
            const previous = this.receipt();
            if (fs.existsSync(this.target) && !previous) throw Error("An unrecognized app occupies the managed target.");
            const transaction = crypto.randomUUID(), files = this.transactionPaths(transaction);
            fs.mkdirSync(files.directory, {mode: 0o700});
            this.native.copyBundle(original, files.stage);
            if (macBundleHash(files.stage) !== sourceSha256 || macBundleHash(original) !== sourceSha256) throw Error("The source or copied Discord bundle changed during staging.");
            injectDeveloperLoader(path.join(files.stage, "Contents", "Resources"), payload);
            this.native.signBundle(files.stage); this.native.verifySignature(files.stage);
            const next: MacReceipt = {"schemaVersion": 1, "channel": this.channel, "package": manifest, "bundleSha256": macBundleHash(files.stage), "sourcePath": original, sourceSha256, "installedAt": new Date().toISOString()};
            if (macBundleHash(original) !== sourceSha256) throw Error("The original Discord bundle changed during signing.");
            this.native.assertIdle(original);
            this.commit(transaction, previous, next); return next;
        });
    }
    private commit(transaction: string, previous: MacReceipt | null, next: MacReceipt | null): void {
        const files = this.transactionPaths(transaction);
        const previousSha256 = fs.existsSync(this.target) ? macBundleHash(this.target) : null;
        this.native.assertIdle(this.target);
        if (previous) {
            writeAtomic(files.priorReceipt, previous);
            if (next && previousSha256 === previous.bundleSha256) next.previous = {transaction, receiptSha256: macHash(files.priorReceipt)};
        }
        const journal: Journal = {schemaVersion: 1, transaction, previous, previousSha256, next};
        const pending = this.owned(path.join(this.state, "pending.json"));
        writeAtomic(pending, journal); this.fault?.("prepared");
        if (fs.existsSync(this.target)) fs.renameSync(this.target, files.backup);
        this.fault?.("old-moved");
        if (next) fs.renameSync(files.stage, this.target);
        this.fault?.("new-live");
        const receiptFile = this.owned(path.join(this.state, "current.json"));
        if (next) writeAtomic(receiptFile, next); else if (fs.existsSync(receiptFile)) fs.unlinkSync(receiptFile);
        this.fault?.("receipt-written");
        fs.renameSync(pending, path.join(files.directory, "committed.json"));
    }
    uninstall(): void {
        this.withLock(() => {
            this.native.assertIdle(); const previous = this.receipt();
            if (!previous) throw Error("No managed installation can be removed.");
            const transaction = crypto.randomUUID(), files = this.transactionPaths(transaction);
            fs.mkdirSync(files.directory, {mode: 0o700}); this.commit(transaction, previous, null);
        });
    }
    rollback(): MacReceipt {
        return this.withLock(() => {
            this.native.assertIdle(); const current = this.receipt(); const prior = current?.previous;
            if (!current || !prior) throw Error("There is no verified previous version to roll back to.");
            const saved = this.transactionPaths(prior.transaction);
            if (macHash(saved.priorReceipt) !== prior.receiptSha256) throw Error("The prior receipt changed.");
            const next = regularJSON<MacReceipt>(saved.priorReceipt);
            if (next.channel !== this.channel || macBundleHash(saved.backup) !== next.bundleSha256) throw Error("The prior app changed; it was preserved for manual recovery.");
            if (!HASH.test(next.package?.artifact?.sha256 ?? "") || macHash(this.owned(path.join(this.state, "payloads", `${next.package.artifact.sha256}.asar`))) !== next.package.artifact.sha256) throw Error("The prior Solcord payload is missing or changed.");
            const transaction = crypto.randomUUID(), files = this.transactionPaths(transaction); fs.mkdirSync(files.directory, {mode: 0o700});
            this.native.copyBundle(saved.backup, files.stage); this.native.verifySignature(files.stage);
            if (macBundleHash(files.stage) !== next.bundleSha256) throw Error("The rollback copy failed verification.");
            next.installedAt = new Date().toISOString(); delete next.previous;
            this.commit(transaction, current, next); return next;
        });
    }
    recover(): void {
        this.withLock(() => {
            this.native.assertIdle(); const pending = this.owned(path.join(this.state, "pending.json"));
            if (!fs.existsSync(pending)) return;
            const journal = regularJSON<Journal>(pending);
            if (journal.schemaVersion !== 1 || !UUID.test(journal.transaction) || (journal.previousSha256 !== null && !HASH.test(journal.previousSha256))) throw Error("The recovery journal is invalid.");
            const files = this.transactionPaths(journal.transaction);
            if (fs.existsSync(this.target)) {
                const currentHash = macBundleHash(this.target);
                if (currentHash === journal.next?.bundleSha256) fs.renameSync(this.target, this.owned(path.join(files.directory, "interrupted.app")));
                else if (currentHash !== journal.previousSha256 || fs.existsSync(files.backup)) throw Error("Recovery refused changed or ambiguous app files; all copies were preserved.");
            }
            if (fs.existsSync(files.backup)) {
                if (macBundleHash(files.backup) !== journal.previousSha256 || fs.existsSync(this.target)) throw Error("The recovery copy changed.");
                fs.renameSync(files.backup, this.target);
            }
            if (journal.previousSha256 && (!fs.existsSync(this.target) || macBundleHash(this.target) !== journal.previousSha256)) throw Error("The previous app could not be restored.");
            const receiptFile = this.owned(path.join(this.state, "current.json"));
            if (journal.previous) writeAtomic(receiptFile, journal.previous); else if (fs.existsSync(receiptFile)) fs.unlinkSync(receiptFile);
            fs.renameSync(pending, this.owned(path.join(files.directory, "recovered.json")));
        }, true);
    }
}
