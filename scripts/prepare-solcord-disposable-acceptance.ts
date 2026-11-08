// SPDX-License-Identifier: Apache-2.0

import crypto from "crypto";
import fs from "fs";
import path from "path";
import {solcordLocalAssets} from "./helpers/local-assets";


const MANIFEST_FILE = "acceptance-manifest.json";
const LAUNCHER_FILE = "launch-solcord-acceptance.cmd";
const ACCEPTANCE_SETTINGS_FILE = "profile/Roaming/discord/settings.json";
const RUNTIME_LEDGER_FILE = "acceptance-runtime-ledger.jsonl";
const DISCORD_DESKTOP_CORE_ENTRY = `"use strict";\n\nmodule.exports = require("./core.asar");\n`;
const DISCORD_FIRST_RUN_MARKER = ".first-run";
const DISCORD_VERSION_PATTERN = /^[0-9]+(?:\.[0-9]+){1,7}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const CANONICAL_HASH_PATTERN = /^[a-f0-9]{64}$/;
const FULL_COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const CANDIDATE_SUFFIX_PATTERN = /^[0-9a-z]+(?:[.-][0-9a-z]+)*$/i;
const EMPTY_SHA256 = crypto.createHash("sha256").digest("hex");
const MAX_JSON_METADATA_BYTES = 128 * 1024;
const MAX_SOLCORD_ASAR_BYTES = 512 * 1024 * 1024;
const MAX_SOLCORD_ASAR_HEADER_BYTES = 1024 * 1024;
const EXPECTED_SOLCORD_ASAR_FILES = [
    "build-provenance.json",
    "earlyRenderer.js",
    "editor/index.html",
    "editor/preload.js",
    "editor/script.js",
    "main.js",
    "package.json",
    "preload.js",
    "solcord.js"
] as const;
const EXPECTED_SOLCORD_ASAR_DIRECTORIES = ["editor"] as const;
const LOCAL_ASSETS = solcordLocalAssets(path.resolve(__dirname, ".."));
const LOCAL_ASSET_PATHS = LOCAL_ASSETS.map(asset => asset.target);
const EXPANDED_DIRECTORIES = new Set<string>(EXPECTED_SOLCORD_ASAR_DIRECTORIES);
for (const asset of LOCAL_ASSET_PATHS) {
    for (let directory = path.posix.dirname(asset); directory !== "."; directory = path.posix.dirname(directory)) EXPANDED_DIRECTORIES.add(directory);
}
const EXPECTED_PROVENANCE_MODULES = ["earlyRenderer", "editor", "editorHtml", "editorPreload", "main", "preload", "solcord"] as const;

export interface DisposableAcceptanceOptions {
    sourceDiscordAppDir: string;
    solcordAsar: string;
    destinationRoot: string;
    expectedSolcordSha256: string;
    expectedSolcordSourceCommit: string;
    dryRun?: boolean;
}

export interface DisposableAcceptanceManifest {
    schemaVersion: 10;
    kind: "solcord-disposable-acceptance";
    platform: "win32";
    discordVersion: string;
    discordReleaseChannel: string;
    solcordSha256: string;
    solcordSourceCommit: string;
    solcordVersion: string;
    solcordBuildMode: "production" | "release";
    betterdiscordAppSha256: string;
    sourceDiscordTree: TreeInventory;
    paths: {
        runtime: "runtime";
        discordExecutable: "runtime/Discord.exe";
        solcordAsar: "runtime/resources/solcord.asar";
        betterdiscordAppAsar: "runtime/resources/betterdiscord.app.asar";
        electronEntryPoint: "runtime/resources/app/index.js";
        userData: "profile/Roaming/discord";
        acceptanceSettings: "profile/Roaming/discord/settings.json";
        firstRunMarker: string;
        betterdiscordData: "profile/Roaming/BetterDiscord";
        localAppData: "profile/Local";
        launcher: "launch-solcord-acceptance.cmd";
        runtimeLedger: "acceptance-runtime-ledger.jsonl";
    };
    safety: {
        copiedRuntime: true;
        copiedUserProfile: false;
        hardlinksCreated: false;
        launchPerformed: false;
        filesystemProfileIsolated: true;
        windowsAccountIsolated: false;
        copiedNativeModules: true;
        legacyDesktopCoreInjectorNeutralized: true;
        updaterDisabledInAcceptance: true;
        runtimeLedgerSanitized: true;
    };
}

export interface DisposableAcceptanceResult {
    dryRun: boolean;
    manifest: DisposableAcceptanceManifest;
    writtenFiles: string[];
}

interface ValidatedInputs {
    sourceDiscordAppDir: string;
    solcordAsar: string;
    destinationRoot: string;
    destinationParent: string;
    solcordSha256: string;
    solcordSourceCommit: string;
    solcordVersion: string;
    solcordBuildMode: "production" | "release";
    betterdiscordAppSha256: string;
    sourceDiscordTree: TreeInventory;
    discordVersion: string;
    discordReleaseChannel: string;
    discordAppPackage: DiscordAppPackageIdentity;
    discordBuildInfo: DiscordBuildInfoIdentity;
    discordDesktopCoreEntry: string;
}

interface TreeInventory {
    sha256: string;
    files: number;
    directories: number;
    bytes: number;
}

interface SolcordAsarIdentity {
    sourceCommit: string;
    version: string;
    mode: "production" | "release";
}

interface DiscordAppPackageIdentity {
    name: "discord";
    main: "index.js" | "./index.js";
    type: "commonjs" | null;
}

interface DiscordBuildInfoIdentity {
    version: string;
    releaseChannel: string;
}

interface AsarPackedIntegrity {
    algorithm: "SHA256";
    hash: string;
    blockSize: number;
    blocks: string[];
}

interface AsarPackedEntry {
    offset: number;
    size: number;
    integrity: AsarPackedIntegrity | null;
}

interface AsarEnvelope {
    fileSize: number;
    headerSize: number;
    dataOffset: number;
    dev: number;
    ino: number;
    mtimeMs: number;
    header: Record<string, unknown>;
    entries: Map<string, AsarPackedEntry>;
}

interface OwnedStagingDirectory {
    path: string;
    realPath: string;
    dev: bigint;
    ino: bigint;
    birthtimeNs: bigint;
}


function sha256(file: string): string {
    return hashStableRegularFile(file, "Artifact").sha256;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
    return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function isCanonicalTimestamp(value: unknown): value is string {
    if (typeof value !== "string") return false;
    try {return new Date(value).toISOString() === value;}
    catch {return false;}
}

function parseEmbeddedJson(buffer: Buffer, label: string): Record<string, unknown> {
    if (buffer.length === 0 || buffer.length > MAX_JSON_METADATA_BYTES) {
        throw new Error(`${label} must be non-empty and no larger than 128 KiB.`);
    }
    try {
        const value: unknown = JSON.parse(buffer.toString("utf8"));
        if (!isRecord(value)) throw new Error("not an object");
        return value;
    }
    catch {
        throw new Error(`${label} must be valid JSON object metadata.`);
    }
}

function validateEmbeddedBuildProvenance(value: Record<string, unknown>, expectedSourceCommit: string): SolcordAsarIdentity {
    const source = value.source;
    const inputs = value.inputs;
    if (!isRecord(source) || !isRecord(inputs) || !isRecord(inputs.lockfile) || !isRecord(inputs.toolchain)) {
        throw new Error("Solcord ASAR build provenance is incomplete.");
    }

    const lockfile = inputs.lockfile;
    const toolchain = inputs.toolchain;
    const mode = value.mode;
    const modules = value.modules;
    const hashes = [
        source.digest,
        source.statusDigest,
        lockfile.sha256,
        toolchain.bunExecutableSha256,
        toolchain.packageJsonSha256,
        toolchain.buildScriptSha256,
        toolchain.packScriptSha256
    ];

    if (!exactKeys(value, ["schemaVersion", "kind", "product", "version", "candidateLabel", "mode", "buildLabel", "buildTimestamp", "modules", "source", "inputs"])
        || !exactKeys(source, ["commit", "branch", "clean", "digest", "statusDigest"])
        || !exactKeys(inputs, ["lockfile", "toolchain"])
        || !exactKeys(lockfile, ["file", "sha256"])
        || !exactKeys(toolchain, ["bunVersion", "bunExecutableSha256", "packageJsonSha256", "buildScriptSha256", "packScriptSha256"])
        || value.schemaVersion !== 2
        || value.kind !== "solcord-build-provenance") {
        throw new Error("Solcord ASAR build provenance does not match schema v2.");
    }
    if (value.product !== "Solcord") {
        throw new Error("Solcord ASAR build provenance product must be Solcord.");
    }
    if (mode !== "production" && mode !== "release") {
        throw new Error("Solcord ASAR requires production or release build provenance.");
    }
    if (source.clean !== true || source.statusDigest !== EMPTY_SHA256 || value.buildLabel !== `${mode}-clean`) {
        throw new Error("Solcord ASAR requires clean production or release build provenance.");
    }
    if (typeof source.commit !== "string" || !FULL_COMMIT_PATTERN.test(source.commit)) {
        throw new Error("Solcord ASAR build provenance requires a complete lowercase source commit.");
    }
    if (source.commit !== expectedSourceCommit) {
        throw new Error("Solcord ASAR source commit does not match the caller-provided expected source commit.");
    }
    const candidateVersion = typeof value.version === "string" ? value.version : "";
    const stableLabel = `v${candidateVersion}`;
    const candidatePrefix = `${stableLabel}-`;
    const validReleaseLabel = value.candidateLabel === stableLabel
        || typeof value.candidateLabel === "string" && value.candidateLabel.startsWith(candidatePrefix)
            && CANDIDATE_SUFFIX_PATTERN.test(value.candidateLabel.slice(candidatePrefix.length));
    if (typeof value.version !== "string" || !value.version || value.version.length > 128
        || [...value.version].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
        || typeof value.candidateLabel !== "string" || !validReleaseLabel || value.candidateLabel.length > 128
        || typeof source.branch !== "string" || !source.branch || source.branch.length > 256
        || [...source.branch].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
        || !isCanonicalTimestamp(value.buildTimestamp)
        || !Array.isArray(modules)
        || JSON.stringify(modules) !== JSON.stringify(EXPECTED_PROVENANCE_MODULES)
        || !hashes.every(hash => typeof hash === "string" && CANONICAL_HASH_PATTERN.test(hash))
        || lockfile.file !== "bun.lock"
        || typeof toolchain.bunVersion !== "string" || !toolchain.bunVersion) {
        throw new Error("Solcord ASAR build provenance contains invalid release metadata.");
    }

    return {sourceCommit: source.commit, version: value.version, mode};
}

function alignToFour(value: number): number {
    return value + ((4 - (value % 4)) % 4);
}

function readExactly(descriptor: number, buffer: Buffer, position: number, label: string): void {
    let completed = 0;
    while (completed < buffer.length) {
        const read = fs.readSync(descriptor, buffer, completed, buffer.length - completed, position + completed);
        if (read === 0) throw new Error(`${label} is truncated.`);
        completed += read;
    }
}

function sameFileIdentity(left: fs.Stats, right: fs.Stats): boolean {
    return left.isFile() && right.isFile()
        && left.size === right.size
        && left.mtimeMs === right.mtimeMs
        && left.dev === right.dev
        && left.ino === right.ino;
}

function validateAsarHeaderTree(header: Record<string, unknown>, dataOffset: number, fileSize: number): Map<string, AsarPackedEntry> {
    if (!exactKeys(header, ["files"]) || !isRecord(header.files)) {
        throw new Error("Solcord ASAR header root is invalid.");
    }

    const entries = new Map<string, AsarPackedEntry>();
    const directories = new Set<string>();
    const ranges: Array<{start: number; end: number; path: string;}> = [];
    const visit = (children: Record<string, unknown>, parent: string): void => {
        for (const [name, rawEntry] of Object.entries(children)) {
            if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\") || name.includes("\0") || !isRecord(rawEntry)) {
                throw new Error("Solcord ASAR header contains an unsafe entry.");
            }
            const entryPath = parent ? `${parent}/${name}` : name;
            if (entries.has(entryPath) || directories.has(entryPath)) throw new Error("Solcord ASAR header contains duplicate entries.");
            if ("link" in rawEntry) throw new Error("Solcord ASAR must not contain links.");
            if ("unpacked" in rawEntry) throw new Error("Solcord ASAR must not contain unpacked entries.");
            if ("files" in rawEntry) {
                if (!exactKeys(rawEntry, ["files"]) || !isRecord(rawEntry.files)) {
                    throw new Error("Solcord ASAR directory metadata is invalid.");
                }
                directories.add(entryPath);
                visit(rawEntry.files, entryPath);
                continue;
            }

            const allowedKeys = new Set(["size", "offset", "integrity", "executable"]);
            if (Object.keys(rawEntry).some(key => !allowedKeys.has(key))
                || !Number.isSafeInteger(rawEntry.size) || (rawEntry.size as number) <= 0
                || typeof rawEntry.offset !== "string" || !/^(?:0|[1-9]\d*)$/.test(rawEntry.offset)
                || ("executable" in rawEntry && typeof rawEntry.executable !== "boolean")) {
                throw new Error("Solcord ASAR packed entry metadata is invalid, empty, or oversized.");
            }

            const relativeOffset = BigInt(rawEntry.offset);
            const size = rawEntry.size as number;
            if (relativeOffset > BigInt(Number.MAX_SAFE_INTEGER) || size > MAX_SOLCORD_ASAR_BYTES) {
                throw new Error("Solcord ASAR packed entry is oversized.");
            }
            const start = dataOffset + Number(relativeOffset);
            const end = start + size;
            if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < dataOffset || end > fileSize) {
                throw new Error("Solcord ASAR packed entry offset or end is outside the archive.");
            }
            let integrity: AsarPackedIntegrity | null = null;
            if ("integrity" in rawEntry) {
                const candidate = rawEntry.integrity;
                if (!isRecord(candidate)
                    || !exactKeys(candidate, ["algorithm", "hash", "blockSize", "blocks"])
                    || candidate.algorithm !== "SHA256"
                    || typeof candidate.hash !== "string" || !CANONICAL_HASH_PATTERN.test(candidate.hash)
                    || candidate.blockSize !== 4 * 1024 * 1024
                    || !Array.isArray(candidate.blocks)
                    || candidate.blocks.length !== Math.floor(size / candidate.blockSize) + 1
                    || !candidate.blocks.every(block => typeof block === "string" && CANONICAL_HASH_PATTERN.test(block))) {
                    throw new Error("Solcord ASAR integrity metadata is unsupported or invalid.");
                }
                integrity = {
                    algorithm: "SHA256",
                    hash: candidate.hash,
                    blockSize: candidate.blockSize,
                    blocks: candidate.blocks as string[]
                };
            }
            entries.set(entryPath, {offset: start, size, integrity});
            ranges.push({start, end, path: entryPath});
        }
    };
    visit(header.files, "");

    const paths = JSON.stringify([...entries.keys()].sort());
    const folders = JSON.stringify([...directories].sort());
    const legacy = paths === JSON.stringify([...EXPECTED_SOLCORD_ASAR_FILES].sort()) && folders === JSON.stringify([...EXPECTED_SOLCORD_ASAR_DIRECTORIES].sort());
    const expanded = paths === JSON.stringify([...EXPECTED_SOLCORD_ASAR_FILES, ...LOCAL_ASSET_PATHS].sort()) && folders === JSON.stringify([...EXPANDED_DIRECTORIES].sort());
    if (!legacy && !expanded) {
        throw new Error("Solcord ASAR does not contain the exact expected runtime entrypoints.");
    }

    ranges.sort((left, right) => left.start - right.start || left.path.localeCompare(right.path));
    let cursor = dataOffset;
    for (const range of ranges) {
        if (range.start !== cursor) throw new Error("Solcord ASAR packed entry ranges overlap or contain gaps.");
        cursor = range.end;
    }
    if (cursor !== fileSize) throw new Error("Solcord ASAR contains truncated or trailing payload bytes.");
    return entries;
}

function validatePackedAsarIntegrity(file: string, envelope: AsarEnvelope): void {
    if (![...envelope.entries.values()].some(entry => entry.integrity)) return;

    const descriptor = fs.openSync(file, "r");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let before: fs.Stats;
    let after: fs.Stats;
    try {
        before = fs.fstatSync(descriptor);
        if (!before.isFile() || before.size !== envelope.fileSize || before.dev !== envelope.dev
            || before.ino !== envelope.ino || before.mtimeMs !== envelope.mtimeMs) {
            throw new Error("Solcord ASAR changed before integrity validation.");
        }

        for (const [entryPath, entry] of envelope.entries) {
            if (!entry.integrity) continue;
            const fileHash = crypto.createHash("sha256");
            let consumed = 0;
            for (let blockIndex = 0; blockIndex < entry.integrity.blocks.length; blockIndex++) {
                const blockHash = crypto.createHash("sha256");
                let blockRemaining = Math.min(entry.integrity.blockSize, entry.size - consumed);
                while (blockRemaining > 0) {
                    const chunkSize = Math.min(buffer.length, blockRemaining);
                    const chunk = buffer.subarray(0, chunkSize);
                    readExactly(descriptor, chunk, entry.offset + consumed, `Solcord ASAR integrity block for ${entryPath}`);
                    fileHash.update(chunk);
                    blockHash.update(chunk);
                    consumed += chunkSize;
                    blockRemaining -= chunkSize;
                }
                if (blockHash.digest("hex") !== entry.integrity.blocks[blockIndex]) {
                    throw new Error(`Solcord ASAR integrity block mismatch for ${entryPath}.`);
                }
            }
            if (consumed !== entry.size || fileHash.digest("hex") !== entry.integrity.hash) {
                throw new Error(`Solcord ASAR integrity mismatch for ${entryPath}.`);
            }
        }
        after = fs.fstatSync(descriptor);
    }
    finally {
        fs.closeSync(descriptor);
    }

    const current = fs.lstatSync(file);
    if (!sameFileIdentity(before, after) || !sameFileIdentity(before, current)) {
        throw new Error("Solcord ASAR changed during integrity validation.");
    }
}

function readBoundedAsarEnvelope(file: string): AsarEnvelope {
    const pathStat = fs.lstatSync(file);
    if (!pathStat.isFile() || pathStat.isSymbolicLink() || pathStat.size < 16 || pathStat.size > MAX_SOLCORD_ASAR_BYTES) {
        throw new Error("Solcord ASAR must be a regular archive between 16 bytes and 512 MiB.");
    }

    const descriptor = fs.openSync(file, "r");
    let before: fs.Stats;
    let after: fs.Stats;
    let headerSize = 0;
    let dataOffset = 0;
    let header: Record<string, unknown>;
    try {
        before = fs.fstatSync(descriptor);
        if (!sameFileIdentity(pathStat, before)) throw new Error("Solcord ASAR identity changed before header validation.");
        const fixedHeader = Buffer.alloc(16);
        readExactly(descriptor, fixedHeader, 0, "Solcord ASAR fixed header");
        const outerPayloadSize = fixedHeader.readUInt32LE(0);
        headerSize = fixedHeader.readUInt32LE(4);
        const innerPayloadSize = fixedHeader.readUInt32LE(8);
        const jsonLength = fixedHeader.readInt32LE(12);
        if (outerPayloadSize !== 4 || headerSize < 8 || headerSize > MAX_SOLCORD_ASAR_HEADER_BYTES || headerSize % 4 !== 0
            || innerPayloadSize !== headerSize - 4 || jsonLength <= 0
            || 4 + alignToFour(jsonLength) !== innerPayloadSize) {
            throw new Error("Solcord ASAR fixed header is malformed or oversized.");
        }
        dataOffset = 8 + headerSize;
        if (!Number.isSafeInteger(dataOffset) || dataOffset > before.size) throw new Error("Solcord ASAR header extends beyond the archive.");

        const headerBuffer = Buffer.alloc(headerSize);
        readExactly(descriptor, headerBuffer, 8, "Solcord ASAR header");
        const jsonStart = 8;
        const jsonEnd = jsonStart + jsonLength;
        if (jsonEnd > headerBuffer.length || headerBuffer.subarray(jsonEnd).some(byte => byte !== 0)) {
            throw new Error("Solcord ASAR header padding or JSON bounds are invalid.");
        }
        let parsed: unknown;
        try {
            const text = new TextDecoder("utf-8", {fatal: true}).decode(headerBuffer.subarray(jsonStart, jsonEnd));
            parsed = JSON.parse(text);
        }
        catch {
            throw new Error("Solcord ASAR header JSON is invalid.");
        }
        if (!isRecord(parsed)) throw new Error("Solcord ASAR header JSON must be an object.");
        header = parsed;
        after = fs.fstatSync(descriptor);
    }
    finally {
        fs.closeSync(descriptor);
    }

    const current = fs.lstatSync(file);
    if (!sameFileIdentity(before, after) || !sameFileIdentity(before, current)) {
        throw new Error("Solcord ASAR changed while its bounded header was being validated.");
    }
    const entries = validateAsarHeaderTree(header, dataOffset, before.size);
    const envelope = {fileSize: before.size, headerSize, dataOffset, dev: before.dev, ino: before.ino, mtimeMs: before.mtimeMs, header, entries};
    validatePackedAsarIntegrity(file, envelope);
    return envelope;
}

function assertBoundedGenericAsar(file: string, label: string): void {
    const pathStat = fs.lstatSync(file);
    if (!pathStat.isFile() || pathStat.isSymbolicLink() || pathStat.size < 16 || pathStat.size > MAX_SOLCORD_ASAR_BYTES) {
        throw new Error(`${label} must be a regular bounded ASAR archive.`);
    }
    const descriptor = fs.openSync(file, "r");
    let before: fs.Stats;
    let after: fs.Stats;
    try {
        before = fs.fstatSync(descriptor);
        const fixedHeader = Buffer.alloc(16);
        readExactly(descriptor, fixedHeader, 0, `${label} fixed header`);
        const outerPayloadSize = fixedHeader.readUInt32LE(0);
        const headerSize = fixedHeader.readUInt32LE(4);
        const innerPayloadSize = fixedHeader.readUInt32LE(8);
        const jsonLength = fixedHeader.readInt32LE(12);
        if (outerPayloadSize !== 4 || headerSize < 8 || headerSize > MAX_SOLCORD_ASAR_HEADER_BYTES || headerSize % 4 !== 0
            || innerPayloadSize !== headerSize - 4 || jsonLength <= 0
            || 4 + alignToFour(jsonLength) !== innerPayloadSize || 8 + headerSize > before.size) {
            throw new Error(`${label} fixed header is malformed or oversized.`);
        }
        const headerBuffer = Buffer.alloc(headerSize);
        readExactly(descriptor, headerBuffer, 8, `${label} header`);
        const jsonStart = 8;
        const jsonEnd = jsonStart + jsonLength;
        if (jsonEnd > headerBuffer.length || headerBuffer.subarray(jsonEnd).some(byte => byte !== 0)) {
            throw new Error(`${label} header bounds are invalid.`);
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(headerBuffer.subarray(jsonStart, jsonEnd)));
        }
        catch {throw new Error(`${label} header JSON is invalid.`);}
        if (!isRecord(parsed) || !isRecord(parsed.files)) throw new Error(`${label} header root is invalid.`);
        after = fs.fstatSync(descriptor);
    }
    finally {fs.closeSync(descriptor);}
    const current = fs.lstatSync(file);
    if (!sameFileIdentity(before, after) || !sameFileIdentity(before, current)) {
        throw new Error(`${label} changed during validation.`);
    }
}

function readPackedAsarEntry(file: string, envelope: AsarEnvelope, entryPath: string, label: string): Buffer {
    const entry = envelope.entries.get(entryPath);
    if (!entry || entry.size > MAX_JSON_METADATA_BYTES) {
        throw new Error(`${label} must be present and no larger than 128 KiB.`);
    }
    const descriptor = fs.openSync(file, "r");
    try {
        const current = fs.fstatSync(descriptor);
        if (!current.isFile() || current.size !== envelope.fileSize || current.dev !== envelope.dev
            || current.ino !== envelope.ino || current.mtimeMs !== envelope.mtimeMs) {
            throw new Error("Solcord ASAR changed before metadata extraction.");
        }
        const buffer = Buffer.alloc(entry.size);
        readExactly(descriptor, buffer, entry.offset, label);
        const after = fs.fstatSync(descriptor);
        if (!sameFileIdentity(current, after)) throw new Error("Solcord ASAR changed during metadata extraction.");
        return buffer;
    }
    finally {
        fs.closeSync(descriptor);
    }
}

function inspectSolcordAsar(file: string, expectedSourceCommit: string): SolcordAsarIdentity {
    try {
        const envelope = readBoundedAsarEnvelope(file);
        if (envelope.entries.has("catalog/index.json")) {
            for (const asset of LOCAL_ASSETS) {
                const entry = envelope.entries.get(asset.target);
                if (!entry?.integrity || entry.integrity.hash !== hashStableRegularFile(asset.source, "Pinned local Solcord asset").sha256) {
                    throw new Error(`Solcord local asset does not match its pinned source: ${asset.target}.`);
                }
            }
        }
        const packageMetadata = parseEmbeddedJson(readPackedAsarEntry(file, envelope, "package.json", "Solcord ASAR package.json"), "Solcord ASAR package.json");
        const packageKeysAreCanonical = exactKeys(packageMetadata, ["name", "main"])
            || exactKeys(packageMetadata, ["name", "main", "type"]);
        if (!packageKeysAreCanonical || packageMetadata.name !== "solcord" || packageMetadata.main !== "main.js"
            || (packageMetadata.type !== undefined && packageMetadata.type !== "commonjs")) {
            throw new Error("Solcord ASAR package.json must be a canonical CommonJS package naming solcord with main.js as its entrypoint.");
        }
        const buildProvenance = parseEmbeddedJson(
            readPackedAsarEntry(file, envelope, "build-provenance.json", "Solcord ASAR build-provenance.json"),
            "Solcord ASAR build-provenance.json"
        );
        return validateEmbeddedBuildProvenance(buildProvenance, expectedSourceCommit);
    }
    catch (error) {
        throw new Error(`Solcord ASAR validation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function hashStableRegularFile(file: string, label = "Discord runtime file"): {sha256: string; bytes: number;} {
    const descriptor = fs.openSync(file, "r");
    const hash = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytes = 0;
    let before: fs.Stats;
    let after: fs.Stats;
    try {
        before = fs.fstatSync(descriptor);
        if (!before.isFile() || !Number.isSafeInteger(before.size)) throw new Error(`${label} must be a regular file of safe size.`);
        while (true) {
            const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
            if (read === 0) break;
            bytes += read;
            hash.update(buffer.subarray(0, read));
        }
        after = fs.fstatSync(descriptor);
    }
    finally {
        fs.closeSync(descriptor);
    }

    const current = fs.lstatSync(file);
    if (!current.isFile() || current.isSymbolicLink()
        || bytes !== before.size || after.size !== before.size || current.size !== before.size
        || after.mtimeMs !== before.mtimeMs || current.mtimeMs !== before.mtimeMs
        || after.dev !== before.dev || current.dev !== before.dev
        || after.ino !== before.ino || current.ino !== before.ino) {
        throw new Error(`${label} changed while its deterministic digest was being captured.`);
    }
    return {sha256: hash.digest("hex"), bytes};
}

function createTreeInventory(root: string): TreeInventory {
    const hash = crypto.createHash("sha256");
    hash.update("solcord-discord-runtime-inventory-v1\0");
    let files = 0;
    let directories = 0;
    let bytes = 0;

    const visit = (directory: string): void => {
        const entries = fs.readdirSync(directory, {withFileTypes: true})
            .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
        for (const entry of entries) {
            const absolute = path.join(directory, entry.name);
            const relative = path.relative(root, absolute).replaceAll("\\", "/");
            const stat = fs.lstatSync(absolute);
            if (entry.isSymbolicLink() || stat.isSymbolicLink()) {
                throw new Error("The Discord runtime contains a symbolic link, junction, or reparse point.");
            }
            if (entry.isDirectory() && stat.isDirectory()) {
                directories++;
                hash.update(`directory\0${relative}\0`);
                visit(absolute);
                continue;
            }
            if (!entry.isFile() || !stat.isFile()) {
                throw new Error("The Discord runtime contains an unsupported filesystem entry.");
            }
            const file = hashStableRegularFile(absolute);
            files++;
            bytes += file.bytes;
            if (!Number.isSafeInteger(bytes)) throw new Error("The Discord runtime inventory exceeds the supported byte range.");
            hash.update(`file\0${relative}\0${file.bytes}\0${file.sha256}\0`);
        }
    };
    visit(root);
    return {sha256: hash.digest("hex"), files, directories, bytes};
}

function inventoriesMatch(left: TreeInventory, right: TreeInventory): boolean {
    return left.sha256 === right.sha256
        && left.files === right.files
        && left.directories === right.directories
        && left.bytes === right.bytes;
}

function lstatIfPresent(file: string): fs.Stats | null {
    try {
        return fs.lstatSync(file);
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
}

function assertAbsolutePath(value: string, label: string): string {
    if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
        throw new TypeError(`${label} must be a non-empty absolute path without NUL bytes.`);
    }

    const resolved = path.resolve(value);
    if (!path.isAbsolute(value) || path.parse(resolved).root === resolved) {
        throw new TypeError(`${label} must be an absolute non-root path.`);
    }

    return resolved;
}

function assertNoReparseAncestry(file: string, label: string): void {
    const resolved = path.resolve(file);
    const root = path.parse(resolved).root;
    const parts = resolved.slice(root.length).split(path.sep).filter(Boolean);
    let current = root;

    for (const part of parts) {
        current = path.join(current, part);
        const stat = lstatIfPresent(current);
        if (!stat) break;
        if (stat.isSymbolicLink()) {
            throw new Error(`${label} crosses a symbolic link, junction, or reparse point.`);
        }
    }
}

function assertFile(file: string, label: string): void {
    const stat = lstatIfPresent(file);
    if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size === 0) {
        throw new Error(`${label} must be a non-empty regular file.`);
    }
}

function assertDirectory(directory: string, label: string): void {
    const stat = lstatIfPresent(directory);
    if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(`${label} must be a directory, not a link or reparse point.`);
    }
}

function readBoundedJsonFile(file: string, label: string): Record<string, unknown> {
    assertFile(file, label);
    const before = fs.lstatSync(file);
    if (before.size > MAX_JSON_METADATA_BYTES) throw new Error(`${label} must be no larger than 128 KiB.`);
    const buffer = fs.readFileSync(file);
    const after = fs.lstatSync(file);
    if (!sameFileIdentity(before, after) || buffer.length !== before.size) {
        throw new Error(`${label} changed while it was being validated.`);
    }
    return parseEmbeddedJson(buffer, label);
}

function validateDiscordAppPackage(value: Record<string, unknown>, label: string): DiscordAppPackageIdentity {
    const main = value.main;
    const packageType = value.type;
    if (value.name !== "discord" || (main !== "index.js" && main !== "./index.js")
        || (packageType !== undefined && packageType !== "commonjs")) {
        throw new Error(`${label} must define the discord CommonJS application with canonical index.js main.`);
    }
    return {name: "discord", main, type: packageType === "commonjs" ? "commonjs" : null};
}

function validateDiscordBuildInfo(value: Record<string, unknown>, expectedVersion: string, label: string): DiscordBuildInfoIdentity {
    if (value.version !== expectedVersion || typeof value.releaseChannel !== "string"
        || !/^[a-z][a-z0-9-]{0,31}$/.test(value.releaseChannel)) {
        throw new Error(`${label} must match the app directory version and contain a valid release channel.`);
    }
    return {version: expectedVersion, releaseChannel: value.releaseChannel};
}

function windowsPathKey(value: string): string {
    const normalized = path.win32.normalize(value);
    const root = path.win32.parse(normalized).root;
    return (normalized.length > root.length ? normalized.replace(/[\\/]+$/, "") : normalized).toLocaleLowerCase("en-US");
}

function windowsPathsEqual(left: string, right: string): boolean {
    return windowsPathKey(left) === windowsPathKey(right);
}

function isPhysicallyInside(parent: string, child: string): boolean {
    const parentKey = windowsPathKey(parent);
    const childKey = windowsPathKey(child);
    const relative = path.win32.relative(parentKey, childKey);
    return relative === "" || (!relative.startsWith("..") && !path.win32.isAbsolute(relative));
}

function canonicalExistingDirectory(directory: string, label: string): string {
    assertDirectory(directory, label);
    const canonical = fs.realpathSync.native(directory);
    assertDirectory(canonical, label);
    return canonical;
}

function assertPlainTree(directory: string): void {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name))) {
        const source = path.join(directory, entry.name);
        const stat = fs.lstatSync(source);
        if (entry.isSymbolicLink() || stat.isSymbolicLink()) {
            throw new Error("The Discord runtime contains a symbolic link, junction, or reparse point.");
        }
        if (entry.isDirectory() && stat.isDirectory()) {
            assertPlainTree(source);
            continue;
        }
        if (!entry.isFile() || !stat.isFile()) {
            throw new Error("The Discord runtime contains an unsupported filesystem entry.");
        }
    }
}

function validateInputs(options: DisposableAcceptanceOptions): ValidatedInputs {
    if (process.platform !== "win32") {
        throw new Error("Disposable Solcord acceptance preparation is supported only on Windows.");
    }

    const sourceDiscordAppDir = assertAbsolutePath(options.sourceDiscordAppDir, "sourceDiscordAppDir");
    const solcordAsar = assertAbsolutePath(options.solcordAsar, "solcordAsar");
    const destinationRoot = assertAbsolutePath(options.destinationRoot, "destinationRoot");
    const expectedSolcordSha256 = options.expectedSolcordSha256?.trim().toLowerCase();
    const expectedSolcordSourceCommit = options.expectedSolcordSourceCommit?.trim().toLowerCase();

    if (!HASH_PATTERN.test(expectedSolcordSha256)) {
        throw new TypeError("expectedSolcordSha256 must be a complete SHA-256 digest.");
    }
    if (!FULL_COMMIT_PATTERN.test(expectedSolcordSourceCommit)) {
        throw new TypeError("expectedSolcordSourceCommit must be a complete 40-character Git commit.");
    }
    if (lstatIfPresent(destinationRoot)) {
        throw new Error("destinationRoot already exists; refusing to overwrite it.");
    }

    assertNoReparseAncestry(sourceDiscordAppDir, "sourceDiscordAppDir");
    assertNoReparseAncestry(solcordAsar, "solcordAsar");
    assertNoReparseAncestry(destinationRoot, "destinationRoot");
    const sourceDiscordAppRealPath = canonicalExistingDirectory(sourceDiscordAppDir, "sourceDiscordAppDir");
    const destinationParent = canonicalExistingDirectory(path.dirname(destinationRoot), "destinationRoot parent");
    const physicalDestinationRoot = path.join(destinationParent, path.basename(destinationRoot));
    if (lstatIfPresent(physicalDestinationRoot)) {
        throw new Error("destinationRoot already exists through its canonical parent; refusing to overwrite it.");
    }
    if (isPhysicallyInside(sourceDiscordAppRealPath, physicalDestinationRoot)) {
        throw new Error("destinationRoot cannot physically resolve inside the source Discord application directory.");
    }

    assertFile(path.join(sourceDiscordAppRealPath, "Discord.exe"), "source Discord.exe");
    assertDirectory(path.join(sourceDiscordAppRealPath, "modules"), "source Discord modules");
    assertDirectory(path.join(sourceDiscordAppRealPath, "resources", "app"), "source resources/app");
    assertFile(path.join(sourceDiscordAppRealPath, "resources", "app", "index.js"), "source resources/app/index.js");
    const appPackage = validateDiscordAppPackage(readBoundedJsonFile(
        path.join(sourceDiscordAppRealPath, "resources", "app", "package.json"),
        "source resources/app/package.json"
    ), "source resources/app/package.json");
    const rawBuildInfo = readBoundedJsonFile(
        path.join(sourceDiscordAppRealPath, "resources", "build_info.json"),
        "source resources/build_info.json"
    );
    const betterdiscordApp = path.join(sourceDiscordAppRealPath, "resources", "betterdiscord.app.asar");
    assertFile(betterdiscordApp, "source resources/betterdiscord.app.asar");
    if (lstatIfPresent(path.join(sourceDiscordAppRealPath, "resources", "solcord.asar"))) {
        throw new Error("source resources/solcord.asar already exists; refusing an ambiguous disposable source runtime.");
    }
    assertFile(solcordAsar, "solcordAsar");
    assertPlainTree(sourceDiscordAppRealPath);

    const versionMatch = /^app-(.+)$/i.exec(path.basename(sourceDiscordAppRealPath));
    if (!versionMatch?.[1] || !DISCORD_VERSION_PATTERN.test(versionMatch[1])) {
        throw new Error("sourceDiscordAppDir must be a versioned app-<version> Discord directory.");
    }
    const buildInfo = validateDiscordBuildInfo(rawBuildInfo, versionMatch[1], "source resources/build_info.json");

    readBoundedAsarEnvelope(solcordAsar);
    const solcordSha256 = sha256(solcordAsar);
    if (solcordSha256 !== expectedSolcordSha256) {
        throw new Error("Solcord ASAR SHA-256 does not match the caller-provided digest.");
    }
    const solcordIdentity = inspectSolcordAsar(solcordAsar, expectedSolcordSourceCommit);
    if (sha256(solcordAsar) !== solcordSha256) {
        throw new Error("Solcord ASAR changed while its embedded provenance was being inspected.");
    }
    const sourceDiscordTree = createTreeInventory(sourceDiscordAppRealPath);
    const discordDesktopCoreEntry = inspectDiscordDesktopCoreEntry(path.join(sourceDiscordAppRealPath, "modules"));

    return {
        sourceDiscordAppDir: sourceDiscordAppRealPath,
        solcordAsar,
        destinationRoot: physicalDestinationRoot,
        destinationParent,
        solcordSha256,
        solcordSourceCommit: solcordIdentity.sourceCommit,
        solcordVersion: solcordIdentity.version,
        solcordBuildMode: solcordIdentity.mode,
        betterdiscordAppSha256: sha256(betterdiscordApp),
        sourceDiscordTree,
        discordVersion: versionMatch[1],
        discordReleaseChannel: buildInfo.releaseChannel,
        discordAppPackage: appPackage,
        discordBuildInfo: buildInfo,
        discordDesktopCoreEntry
    };
}

/** Pure manifest construction kept separate from all filesystem operations. */
export function createDisposableAcceptanceManifest(
    discordVersion: string,
    discordReleaseChannel: string,
    solcordSha256: string,
    solcordSourceCommit: string,
    solcordVersion: string,
    solcordBuildMode: "production" | "release",
    betterdiscordAppSha256: string,
    sourceDiscordTree: TreeInventory
): DisposableAcceptanceManifest {
    if (!DISCORD_VERSION_PATTERN.test(discordVersion) || !/^[a-z][a-z0-9-]{0,31}$/.test(discordReleaseChannel)
        || !HASH_PATTERN.test(solcordSha256) || !HASH_PATTERN.test(betterdiscordAppSha256)
        || !FULL_COMMIT_PATTERN.test(solcordSourceCommit) || !solcordVersion
        || (solcordBuildMode !== "production" && solcordBuildMode !== "release")
        || !CANONICAL_HASH_PATTERN.test(sourceDiscordTree.sha256)
        || !Number.isSafeInteger(sourceDiscordTree.files) || sourceDiscordTree.files < 1
        || !Number.isSafeInteger(sourceDiscordTree.directories) || sourceDiscordTree.directories < 1
        || !Number.isSafeInteger(sourceDiscordTree.bytes) || sourceDiscordTree.bytes < 1) {
        throw new TypeError("A Discord version, release identity, complete artifact hashes, and source-tree inventory are required.");
    }

    return {
        schemaVersion: 10,
        kind: "solcord-disposable-acceptance",
        platform: "win32",
        discordVersion,
        discordReleaseChannel,
        solcordSha256: solcordSha256.toLowerCase(),
        solcordSourceCommit,
        solcordVersion,
        solcordBuildMode,
        betterdiscordAppSha256: betterdiscordAppSha256.toLowerCase(),
        sourceDiscordTree: {...sourceDiscordTree},
        paths: {
            runtime: "runtime",
            discordExecutable: "runtime/Discord.exe",
            solcordAsar: "runtime/resources/solcord.asar",
            betterdiscordAppAsar: "runtime/resources/betterdiscord.app.asar",
            electronEntryPoint: "runtime/resources/app/index.js",
            userData: "profile/Roaming/discord",
            acceptanceSettings: ACCEPTANCE_SETTINGS_FILE,
            firstRunMarker: `profile/Roaming/discord/${discordVersion}/${DISCORD_FIRST_RUN_MARKER}`,
            betterdiscordData: "profile/Roaming/BetterDiscord",
            localAppData: "profile/Local",
            launcher: "launch-solcord-acceptance.cmd",
            runtimeLedger: RUNTIME_LEDGER_FILE
        },
        safety: {
            copiedRuntime: true,
            copiedUserProfile: false,
            hardlinksCreated: false,
            launchPerformed: false,
            filesystemProfileIsolated: true,
            windowsAccountIsolated: false,
            copiedNativeModules: true,
            legacyDesktopCoreInjectorNeutralized: true,
            updaterDisabledInAcceptance: true,
            runtimeLedgerSanitized: true
        }
    };
}

function copyPlainTree(sourceDirectory: string, destinationDirectory: string): void {
    fs.mkdirSync(destinationDirectory);
    for (const entry of fs.readdirSync(sourceDirectory, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name))) {
        const source = path.join(sourceDirectory, entry.name);
        const destination = path.join(destinationDirectory, entry.name);
        const stat = fs.lstatSync(source);
        if (entry.isSymbolicLink() || stat.isSymbolicLink()) {
            throw new Error("The Discord runtime changed during copy and now contains a link or reparse point.");
        }
        if (entry.isDirectory() && stat.isDirectory()) {
            copyPlainTree(source, destination);
            continue;
        }
        if (!entry.isFile() || !stat.isFile()) {
            throw new Error("The Discord runtime changed during copy and now contains an unsupported entry.");
        }
        fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    }
}

function inspectDiscordDesktopCoreEntry(modulesRoot: string): string {
    const wrappers = fs.readdirSync(modulesRoot, {withFileTypes: true})
        .filter(entry => /^discord_desktop_core-[0-9]+$/.test(entry.name));
    if (wrappers.length !== 1 || !wrappers[0].isDirectory()) {
        throw new Error("Solcord acceptance requires exactly one plain Discord desktop-core wrapper.");
    }

    const packageRoot = path.join(modulesRoot, wrappers[0].name, "discord_desktop_core");
    const packageFile = path.join(packageRoot, "package.json");
    const coreAsar = path.join(packageRoot, "core.asar");
    const entryFile = path.join(packageRoot, "index.js");
    assertDirectory(packageRoot, "Discord desktop-core package");
    assertFile(packageFile, "Discord desktop-core package.json");
    assertFile(coreAsar, "Discord desktop-core core.asar");
    assertFile(entryFile, "Discord desktop-core index.js");
    assertBoundedGenericAsar(coreAsar, "Discord desktop-core core.asar");

    const packageJson = readBoundedJsonFile(packageFile, "Discord desktop-core package.json") as Record<string, unknown>;
    if (packageJson.name !== "discord_desktop_core" || packageJson.main !== "index.js") {
        throw new Error("Solcord acceptance found incompatible Discord desktop-core metadata.");
    }

    const entryStat = fs.lstatSync(entryFile);
    if (entryStat.size < 1 || entryStat.size > 16 * 1024) {
        throw new Error("Solcord acceptance found an invalid Discord desktop-core entry size.");
    }
    const entry = fs.readFileSync(entryFile, "utf8");
    if (entry.includes("\0")) throw new Error("Solcord acceptance found an invalid Discord desktop-core entry.");

    const normalized = entry.replace(/\r\n/g, "\n").trim();
    const directPattern = /^(?:["']use strict["'];\s*)?module\.exports\s*=\s*require\(["']\.\/core\.asar["']\);?$/;
    const injectedPattern = /^(?:["']use strict["'];\s*)?require\(["'][A-Za-z]:(?:\\\\)(?:[^"'\r\n]+(?:\\\\))*BetterDiscord(?:\\\\)data(?:\\\\)betterdiscord\.asar["']\);\s*module\.exports\s*=\s*require\(["']\.\/core\.asar["']\);?$/i;
    if (!directPattern.test(normalized) && !injectedPattern.test(normalized)) {
        throw new Error("Solcord acceptance refuses an unrecognized Discord desktop-core entry.");
    }
    return path.relative(path.dirname(modulesRoot), entryFile).replaceAll("\\", "/");
}

function neutralizeCopiedDesktopCoreInjector(runtime: string, expectedRelativeEntry: string): string {
    const modulesRoot = path.join(runtime, "modules");
    const copiedRelativeEntry = inspectDiscordDesktopCoreEntry(modulesRoot);
    if (copiedRelativeEntry !== expectedRelativeEntry) {
        throw new Error("Copied Discord desktop-core identity no longer matches the validated source runtime.");
    }
    const entryFile = path.join(runtime, copiedRelativeEntry);
    fs.writeFileSync(entryFile, DISCORD_DESKTOP_CORE_ENTRY, {encoding: "utf8"});
    if (fs.readFileSync(entryFile, "utf8") !== DISCORD_DESKTOP_CORE_ENTRY) {
        throw new Error("Copied Discord desktop-core injector neutralization failed verification.");
    }
    return copiedRelativeEntry;
}

function captureOwnedStagingDirectory(directory: string, expectedParent: string): OwnedStagingDirectory {
    const stat = fs.lstatSync(directory, {bigint: true});
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Solcord staging root is not an owned plain directory.");
    const realPath = fs.realpathSync.native(directory);
    if (!windowsPathsEqual(path.dirname(realPath), expectedParent)) {
        throw new Error("Solcord staging root escaped its canonical destination parent.");
    }
    return {path: directory, realPath, dev: stat.dev, ino: stat.ino, birthtimeNs: stat.birthtimeNs};
}

function isOwnedStagingDirectory(identity: OwnedStagingDirectory): boolean {
    try {
        const stat = fs.lstatSync(identity.path, {bigint: true});
        return stat.isDirectory() && !stat.isSymbolicLink()
            && stat.dev === identity.dev && stat.ino === identity.ino
            && stat.birthtimeNs === identity.birthtimeNs
            && windowsPathsEqual(fs.realpathSync.native(identity.path), identity.realPath);
    }
    catch {return false;}
}

function assertOwnedStagingDirectory(identity: OwnedStagingDirectory): void {
    if (!isOwnedStagingDirectory(identity)) {
        throw new Error("Solcord staging root ownership changed during preparation.");
    }
}

function cleanupOwnedStagingDirectory(identity: OwnedStagingDirectory): void {
    if (isOwnedStagingDirectory(identity)) fs.rmSync(identity.path, {recursive: true, force: true});
}

/** Block the copied host's known Windows shell integration routes. */
export function installDisposableShellGuards(
    electron: {app: Record<string, unknown>; shell?: Record<string, unknown>;},
    moduleApi: {prototype: {require: (this: unknown, request: string, ...args: unknown[]) => unknown;};},
    fileSystem: Pick<typeof fs, "lstatSync" | "mkdirSync" | "realpathSync">,
    paths: Pick<typeof path, "join" | "resolve" | "relative" | "isAbsolute">,
    acceptanceRoot: string,
    childProcess?: Record<string, unknown>
): void {
    const root = fileSystem.realpathSync(acceptanceRoot);
    const block = (owner: Record<string, unknown> | undefined, name: string, result?: unknown) => {
        if (!owner || typeof owner[name] !== "function") return;
        Object.defineProperty(owner, name, {configurable: false, writable: false, value: () => result});
    };
    block(electron.app, "setAsDefaultProtocolClient", false);
    block(electron.app, "setLoginItemSettings");
    block(electron.app, "setUserTasks", false);
    block(electron.app, "setJumpList", "ok");
    block(electron.app, "addRecentDocument");
    block(electron.app, "clearRecentDocuments");
    block(electron.shell, "writeShortcutLink", false);
    // The shipping host also registers protocols by spawning reg.exe directly;
    // Electron's setAsDefaultProtocolClient guard cannot intercept that route.
    for (const name of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync"]) {
        const original = childProcess?.[name];
        if (typeof original !== "function") continue;
        Object.defineProperty(childProcess, name, {configurable: false,
writable: false,
value: function(this: unknown, command: unknown, ...args: unknown[]) {
            const text = typeof command === "string" ? command : "";
            const token = /^\s*(?:"([^"]+)"|(\S+))/.exec(text);
            const executable = (token?.[1] ?? token?.[2] ?? "").split(/[\\/]/).pop()?.toLowerCase() ?? "";
            const shellMutation = /^(?:reg|update|squirrel)(?:\.exe)?$/.test(executable)
                || /^(?:cmd|powershell|pwsh|wscript|cscript)(?:\.exe)?$/.test(executable)
                && /\breg(?:\.exe)?\b|--(?:createShortcut|removeShortcut|squirrel-)|(?:New|Set|Remove)-ItemProperty|\.lnk\b/i.test([text, ...args.filter(value => Array.isArray(value)).flat()].join(" "));
            if (shellMutation) throw Object.assign(new Error("Windows shell integration is blocked in disposable acceptance."), {code: "EACCES"});
            return Reflect.apply(original, this, [command, ...args]);
        }});
    }

    const localFolder = (raw: unknown) => {
        if (typeof raw !== "string" || !/^[a-z0-9_-]{1,64}$/i.test(raw)) throw new Error("Unsupported disposable shell folder.");
        let cursor = root;
        for (const segment of ["profile", "Shell", raw.toLowerCase()]) {
            cursor = paths.join(cursor, segment);
            let stat;
            try {stat = fileSystem.lstatSync(cursor);}
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
                fileSystem.mkdirSync(cursor);
                stat = fileSystem.lstatSync(cursor);
            }
            const relative = paths.relative(root, fileSystem.realpathSync(cursor));
            if (!stat.isDirectory() || stat.isSymbolicLink() || relative.startsWith("..") || paths.isAbsolute(relative)) throw new Error("Disposable shell folder lost ownership.");
        }
        return cursor;
    };
    const updaterPath = paths.join(root, "runtime", "updater.node").toLowerCase();
    const guardedModules = new WeakMap<object, object>();
    const originalRequire = moduleApi.prototype.require;
    moduleApi.prototype.require = function(request, ...args) {
        const value = Reflect.apply(originalRequire, this, [request, ...args]);
        if (typeof request !== "string" || !paths.isAbsolute(request) || paths.resolve(request).toLowerCase() !== updaterPath) return value;
        if (!value || (typeof value !== "object" && typeof value !== "function")) throw new Error("Copied native updater exports are invalid.");
        const cached = guardedModules.get(value);
        if (cached) return cached;
        const NativeUpdater = (value as {Updater?: unknown;}).Updater;
        if (typeof NativeUpdater !== "function") throw new Error("Copied native updater constructor is unavailable.");
        const GuardedUpdater = new Proxy(NativeUpdater, {
            construct(target, argumentsList) {
                const native = Reflect.construct(target, argumentsList);
                for (const name of ["create_shortcut", "known_folder"]) {
                    const descriptor = Object.getOwnPropertyDescriptor(native, name);
                    if (descriptor && !descriptor.configurable && ("value" in descriptor ? !descriptor.writable : !descriptor.get)) throw new Error("Copied native updater shell operations cannot be guarded.");
                }
                return new Proxy(native, {
                    get(instance, key) {
                        if (key === "create_shortcut") return () => false;
                        if (key === "known_folder") return localFolder;
                        const member = Reflect.get(instance, key, instance);
                        return typeof member === "function" ? member.bind(instance) : member;
                    }
                });
            }
        });
        const descriptors = Object.getOwnPropertyDescriptors(value);
        descriptors.Updater = {value: GuardedUpdater, enumerable: true, configurable: false, writable: false};
        const guarded = Object.create(Object.getPrototypeOf(value), descriptors);
        guardedModules.set(value, guarded);
        return guarded;
    };
}

export function renderDisposableAcceptanceShim(): string {
    return `"use strict";

const fs = require("node:fs");
const path = require("node:path");
const electron = require("electron");
const {app} = electron;
const requestedAcceptanceMode = process.env.SOLCORD_ACCEPTANCE_MODE;
delete process.env.SOLCORD_ACCEPTANCE_MODE;

function pathKey(value) {
    const normalized = path.win32.normalize(value);
    const root = path.win32.parse(normalized).root;
    return (normalized.length > root.length ? normalized.replace(/[\\\\/]+$/, "") : normalized).toLocaleLowerCase("en-US");
}

function canonicalEnvironmentDirectory(name) {
    const value = process.env[name];
    if (typeof value !== "string" || !value.trim() || value.includes("\\0") || !path.isAbsolute(value)) {
        throw new Error("Solcord acceptance requires an absolute " + name + " launcher environment path.");
    }
    const resolved = path.resolve(value);
    const stat = fs.lstatSync(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error("Solcord acceptance " + name + " must be a plain existing directory.");
    }
    return fs.realpathSync.native(resolved);
}

function requireCanonicalEnvironmentPath(name, expected) {
    const actual = canonicalEnvironmentDirectory(name);
    const canonicalExpected = fs.realpathSync.native(expected);
    if (pathKey(actual) !== pathKey(canonicalExpected)) {
        throw new Error("Solcord acceptance " + name + " does not match the launcher-owned root.");
    }
    return actual;
}

function safeErrorName(value) {
    return value && typeof value.name === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value.name)
        ? value.name
        : "Error";
}

function lstatPhysical(file) {
    const previousNoAsar = process.noAsar;
    process.noAsar = true;
    try {return fs.lstatSync(file);}
    finally {process.noAsar = previousNoAsar;}
}

function configureCopiedNativeModules(acceptanceRoot, recordRuntimeStage) {
    const modulesRoot = fs.realpathSync.native(path.join(acceptanceRoot, "runtime", "modules"));
    const moduleApi = require("node:module");
    if (!Array.isArray(moduleApi.globalPaths)) {
        throw new Error("Solcord acceptance cannot validate Node's native-module search path.");
    }

    const wrappers = fs.readdirSync(modulesRoot, {withFileTypes: true})
        .sort((left, right) => left.name.localeCompare(right.name));
    const versionedWrapperNames = new Set(wrappers.flatMap(entry => {
        const match = /^([a-z][a-z0-9_]*)-([0-9]+)$/.exec(entry.name);
        return match ? [match[1]] : [];
    }));
    const discovered = new Set();
    const wrapperPaths = [];
    for (const entry of wrappers) {
        const match = /^([a-z][a-z0-9_]*)-([0-9]+)$/.exec(entry.name);
        const wrapperPath = path.join(modulesRoot, entry.name);
        const wrapperStat = fs.lstatSync(wrapperPath);
        const isRuntimeArtifact = entry.name === "crashlogs"
            || (["discord_utils", "discord_voice"].includes(entry.name) && versionedWrapperNames.has(entry.name));
        if (isRuntimeArtifact) {
            if (!entry.isDirectory() || !wrapperStat.isDirectory() || wrapperStat.isSymbolicLink()) {
                throw new Error("Solcord acceptance found an invalid Discord runtime module artifact.");
            }
            continue;
        }
        if (!match || !entry.isDirectory() || !wrapperStat.isDirectory() || wrapperStat.isSymbolicLink()) {
            throw new Error("Solcord acceptance found an invalid copied Discord module wrapper.");
        }

        const packageRoot = path.join(wrapperPath, match[1]);
        const packageStat = fs.lstatSync(packageRoot);
        const packageFile = path.join(packageRoot, "package.json");
        const packageFileStat = fs.lstatSync(packageFile);
        if (!packageStat.isDirectory() || packageStat.isSymbolicLink()
            || !packageFileStat.isFile() || packageFileStat.isSymbolicLink()
            || packageFileStat.size < 2 || packageFileStat.size > 64 * 1024) {
            throw new Error("Solcord acceptance found an invalid copied Discord native module.");
        }

        const packageJson = JSON.parse(fs.readFileSync(packageFile, "utf8"));
        if (!packageJson || typeof packageJson !== "object"
            || (packageJson.name !== undefined && packageJson.name !== match[1])
            || discovered.has(match[1])) {
            throw new Error("Solcord acceptance found ambiguous copied Discord native-module metadata.");
        }
        discovered.add(match[1]);
        if (match[1] === "discord_desktop_core") {
            const coreAsar = path.join(packageRoot, "core.asar");
            const coreEntry = path.join(packageRoot, "index.js");
            const coreAsarStat = lstatPhysical(coreAsar);
            const coreEntryStat = fs.lstatSync(coreEntry);
            if (!coreAsarStat.isFile() || coreAsarStat.isSymbolicLink()
                || !coreEntryStat.isFile() || coreEntryStat.isSymbolicLink()
                || fs.readFileSync(coreEntry, "utf8") !== ${JSON.stringify(DISCORD_DESKTOP_CORE_ENTRY)}) {
                throw new Error("Solcord acceptance found a non-isolated Discord desktop-core entry.");
            }
        }
        wrapperPaths.push(fs.realpathSync.native(wrapperPath));
    }
    if (!discovered.has("discord_desktop_core") || !discovered.has("discord_utils")) {
        throw new Error("Solcord acceptance is missing required copied Discord native modules.");
    }

    for (const wrapperPath of wrapperPaths) {
        if (!moduleApi.globalPaths.some(existing => pathKey(existing) === pathKey(wrapperPath))) {
            moduleApi.globalPaths.push(wrapperPath);
        }
    }

    const buildInfoPath = path.join(acceptanceRoot, "runtime", "resources", "build_info.json");
    const buildInfo = require(buildInfoPath);
    if (!buildInfo || typeof buildInfo !== "object"
        || Object.prototype.hasOwnProperty.call(buildInfo, "localModulesRoot")
        || Object.prototype.hasOwnProperty.call(buildInfo, "standaloneModules")
        || Object.prototype.hasOwnProperty.call(buildInfo, "disableUpdater")) {
        throw new Error("Solcord acceptance refuses ambiguous Discord module/update configuration.");
    }
    buildInfo.localModulesRoot = modulesRoot;
    buildInfo.disableUpdater = true;
    recordRuntimeStage("native-module-policy-installed", {moduleCount: discovered.size});

    const originalRequire = moduleApi.prototype && moduleApi.prototype.require;
    if (typeof originalRequire !== "function") {
        throw new Error("Solcord acceptance cannot observe the native-module loader.");
    }
    moduleApi.prototype.require = function(request) {
        if (request !== "discord_desktop_core") {
            return Reflect.apply(originalRequire, this, arguments);
        }
        recordRuntimeStage("desktop-core-require-begin");
        try {
            const core = Reflect.apply(originalRequire, this, arguments);
            recordRuntimeStage("desktop-core-require-complete");
            if (core && typeof core.startup === "function") {
                const originalStartup = core.startup;
                core.startup = function() {
                    recordRuntimeStage("desktop-core-startup-begin");
                    try {
                        const result = Reflect.apply(originalStartup, this, arguments);
                        recordRuntimeStage("desktop-core-startup-returned");
                        return result;
                    }
                    catch (error) {
                        recordRuntimeStage("desktop-core-startup-failed", {errorName: safeErrorName(error)});
                        throw error;
                    }
                };
            }
            if (core && typeof core.setMainWindowVisible === "function") {
                const originalSetMainWindowVisible = core.setMainWindowVisible;
                core.setMainWindowVisible = function() {
                    recordRuntimeStage("desktop-core-main-visibility-requested");
                    return Reflect.apply(originalSetMainWindowVisible, this, arguments);
                };
            }
            return core;
        }
        catch (error) {
            recordRuntimeStage("desktop-core-require-failed", {errorName: safeErrorName(error)});
            throw error;
        }
        finally {
            moduleApi.prototype.require = originalRequire;
        }
    };
}

const acceptanceRoot = canonicalEnvironmentDirectory("SOLCORD_ACCEPTANCE_ROOT");
const expectedRoot = fs.realpathSync.native(path.resolve(__dirname, "../../.."));
if (pathKey(acceptanceRoot) !== pathKey(expectedRoot)) {
    throw new Error("Solcord acceptance root does not match the copied runtime location.");
}

const runtimeLedger = path.join(acceptanceRoot, "acceptance-runtime-ledger.jsonl");
let runtimeLedgerSequence = 0;
function recordRuntimeStage(stage, fields) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(stage) || runtimeLedgerSequence >= 128) return;
    try {
        const existing = fs.existsSync(runtimeLedger) ? fs.lstatSync(runtimeLedger) : null;
        if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.size >= 64 * 1024)) return;
        runtimeLedgerSequence += 1;
        fs.appendFileSync(runtimeLedger, JSON.stringify({
            schemaVersion: 1,
            processId: process.pid,
            sequence: runtimeLedgerSequence,
            stage,
            ...(fields || {})
        }) + "\\n", "utf8");
    }
    catch {}
}
recordRuntimeStage("shim-begin");

const roaming = path.join(acceptanceRoot, "profile", "Roaming");
const local = path.join(acceptanceRoot, "profile", "Local");
requireCanonicalEnvironmentPath("APPDATA", roaming);
requireCanonicalEnvironmentPath("LOCALAPPDATA", local);
requireCanonicalEnvironmentPath("DISCORD_USER_DATA_DIR", roaming);
const userData = fs.realpathSync.native(path.join(roaming, "discord"));

if (requestedAcceptanceMode !== "1") {
    throw new Error("Solcord acceptance requires the launcher-owned acceptance mode marker.");
}
recordRuntimeStage("environment-validated");
process.env.SOLCORD_ACCEPTANCE_MODE = "1";
app.setPath("userData", userData);

(${installDisposableShellGuards.toString()})(electron, require("node:module"), fs, path, acceptanceRoot, require("node:child_process"));
recordRuntimeStage("os-shell-policy-installed");

// Disposable-only diagnostics contain no payloads, arguments, account IDs or URLs.
app.on("web-contents-created", (_event, contents) => {
    contents.on("console-message", (_consoleEvent, details) => {
        if (details.level !== "error") return;
        const source = typeof details.sourceId === "string" ? details.sourceId : "";
        let sourceKind = "unknown", sourceFile = "";
        try {
            const parsed = new URL(source);
            sourceKind = parsed.protocol === "https:" && /(^|\\.)discord\\.com$/.test(parsed.hostname) ? "discord" : parsed.protocol === "file:" ? "local" : "other";
            sourceFile = path.basename(parsed.pathname).replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 120);
        } catch {}
        recordRuntimeStage("renderer-error", {sourceKind, sourceFile, line: Number.isSafeInteger(details.lineNumber) ? details.lineNumber : 0});
    });
    try {
        contents.debugger.attach("1.3");
        contents.debugger.on("message", async (_debugEvent, method, params) => {
            if (method !== "Runtime.exceptionThrown") return;
            const info = params.exceptionDetails || {};
            const frames = (info.stackTrace && info.stackTrace.callFrames || []).slice(0, 8).map(frame => ({
                scriptId: String(frame.scriptId || "").replace(/[^0-9]/g, "").slice(0, 12),
                line: Number.isSafeInteger(frame.lineNumber) ? frame.lineNumber : 0,
                column: Number.isSafeInteger(frame.columnNumber) ? frame.columnNumber : 0,
                functionName: String(frame.functionName || "").replace(/[^a-zA-Z0-9_.$<> -]/g, "").slice(0, 100)
            }));
            recordRuntimeStage("renderer-exception", {errorName: /^[A-Za-z]+Error$/.test(info.exception && info.exception.className) ? info.exception.className : "Error", frames});
        });
        void contents.debugger.sendCommand("Runtime.enable").catch(() => {});
    } catch {}
});


configureCopiedNativeModules(acceptanceRoot, recordRuntimeStage);

recordRuntimeStage("solcord-require-begin");
require("../solcord.asar");
recordRuntimeStage("solcord-require-complete");
recordRuntimeStage("discord-app-require-begin");
module.exports = require("../betterdiscord.app.asar");
recordRuntimeStage("discord-app-require-returned");
`;
}

function renderLauncher(): string {
    return `@echo off\r
setlocal\r
set "SOLCORD_ACCEPTANCE_ROOT=%~dp0"\r
set "SOLCORD_ACCEPTANCE_LEDGER=%SOLCORD_ACCEPTANCE_ROOT%${RUNTIME_LEDGER_FILE}"\r
set "SOLCORD_ACCEPTANCE_LAUNCH_GUARD=%SOLCORD_ACCEPTANCE_ROOT%.launch-attempt"\r
set "SOLCORD_ACCEPTANCE_PROCESS_SNAPSHOT=%SOLCORD_ACCEPTANCE_LAUNCH_GUARD%\\discord-processes.txt"\r
if not exist "%SOLCORD_ACCEPTANCE_ROOT%runtime\\Discord.exe" goto :missing_runtime\r
if exist "%SOLCORD_ACCEPTANCE_LEDGER%" goto :already_attempted\r
if exist "%SOLCORD_ACCEPTANCE_LAUNCH_GUARD%" goto :already_attempted\r
2>nul mkdir "%SOLCORD_ACCEPTANCE_LAUNCH_GUARD%"\r
if errorlevel 1 goto :already_attempted\r
if exist "%SOLCORD_ACCEPTANCE_LEDGER%" goto :ledger_race\r
if not exist "%SystemRoot%\\System32\\tasklist.exe" goto :process_check_failed\r
if not exist "%SystemRoot%\\System32\\findstr.exe" goto :process_check_failed\r
for %%P in (Discord.exe DiscordPTB.exe DiscordCanary.exe) do (\r
    "%SystemRoot%\\System32\\tasklist.exe" /FI "IMAGENAME eq %%P" /NH > "%SOLCORD_ACCEPTANCE_PROCESS_SNAPSHOT%"\r
    if errorlevel 1 goto :process_check_failed\r
    "%SystemRoot%\\System32\\findstr.exe" /I /B /C:"%%P " "%SOLCORD_ACCEPTANCE_PROCESS_SNAPSHOT%" >nul\r
    if not errorlevel 1 goto :discord_running\r
)\r
del /q "%SOLCORD_ACCEPTANCE_PROCESS_SNAPSHOT%" >nul 2>nul\r
set "APPDATA=%SOLCORD_ACCEPTANCE_ROOT%profile\\Roaming"\r
set "LOCALAPPDATA=%SOLCORD_ACCEPTANCE_ROOT%profile\\Local"\r
set "DISCORD_USER_DATA_DIR=%SOLCORD_ACCEPTANCE_ROOT%profile\\Roaming"\r
set "SOLCORD_ACCEPTANCE_MODE=1"\r
start "" "%SOLCORD_ACCEPTANCE_ROOT%runtime\\Discord.exe" --multi-instance\r
if errorlevel 1 goto :launch_failed\r
endlocal & exit /b 0\r
\r
:missing_runtime\r
echo Solcord acceptance runtime is incomplete. Prepare a new disposable lane.\r
endlocal & exit /b 20\r
\r
:already_attempted\r
echo This disposable lane is single-use and already has launch evidence. Prepare a new lane.\r
endlocal & exit /b 21\r
\r
:ledger_race\r
call :release_launch_guard\r
echo Runtime evidence appeared while the launcher was acquiring ownership. Nothing was started.\r
endlocal & exit /b 22\r
\r
:discord_running\r
call :release_launch_guard\r
echo Another Discord desktop channel is running. Close it before isolated acceptance.\r
endlocal & exit /b 23\r
\r
:process_check_failed\r
call :release_launch_guard\r
echo Discord process inspection failed closed. Nothing was started.\r
endlocal & exit /b 24\r
\r
:launch_failed\r
call :release_launch_guard\r
echo The disposable Discord process could not be started.\r
endlocal & exit /b 25\r
\r
:release_launch_guard\r
if exist "%SOLCORD_ACCEPTANCE_PROCESS_SNAPSHOT%" del /q "%SOLCORD_ACCEPTANCE_PROCESS_SNAPSHOT%" >nul 2>nul\r
2>nul rmdir "%SOLCORD_ACCEPTANCE_LAUNCH_GUARD%"\r
exit /b 0\r
`;
}

export function prepareSolcordDisposableAcceptance(options: DisposableAcceptanceOptions): DisposableAcceptanceResult {
    const validated = validateInputs(options);
    const manifest = createDisposableAcceptanceManifest(
        validated.discordVersion,
        validated.discordReleaseChannel,
        validated.solcordSha256,
        validated.solcordSourceCommit,
        validated.solcordVersion,
        validated.solcordBuildMode,
        validated.betterdiscordAppSha256,
        validated.sourceDiscordTree
    );

    if (options.dryRun) {
        return {dryRun: true, manifest, writtenFiles: []};
    }

    let staging: OwnedStagingDirectory | null = null;
    let committed = false;
    try {
        const stagingNonce = crypto.randomBytes(16).toString("hex");
        const stagingPath = fs.mkdtempSync(path.join(validated.destinationParent, `.solcord-acceptance-stage-${stagingNonce}-`));
        staging = captureOwnedStagingDirectory(stagingPath, validated.destinationParent);
        const runtime = path.join(staging.path, "runtime");
        copyPlainTree(validated.sourceDiscordAppDir, runtime);
        assertOwnedStagingDirectory(staging);

        const copiedBetterDiscordApp = path.join(runtime, "resources", "betterdiscord.app.asar");
        if (sha256(copiedBetterDiscordApp) !== validated.betterdiscordAppSha256) {
            throw new Error("Copied BetterDiscord application ASAR failed post-copy SHA-256 verification.");
        }
        const sourceAfterCopy = createTreeInventory(validated.sourceDiscordAppDir);
        const copiedTree = createTreeInventory(runtime);
        if (!inventoriesMatch(sourceAfterCopy, validated.sourceDiscordTree)) {
            throw new Error("The source Discord runtime changed during copy; refusing the inconsistent snapshot.");
        }
        if (!inventoriesMatch(copiedTree, validated.sourceDiscordTree)) {
            throw new Error("Copied Discord runtime failed deterministic whole-tree verification.");
        }
        const copiedAppPackage = validateDiscordAppPackage(readBoundedJsonFile(
            path.join(runtime, "resources", "app", "package.json"),
            "copied resources/app/package.json"
        ), "copied resources/app/package.json");
        const copiedBuildInfo = validateDiscordBuildInfo(readBoundedJsonFile(
            path.join(runtime, "resources", "build_info.json"),
            "copied resources/build_info.json"
        ), validated.discordVersion, "copied resources/build_info.json");
        if (JSON.stringify(copiedAppPackage) !== JSON.stringify(validated.discordAppPackage)
            || JSON.stringify(copiedBuildInfo) !== JSON.stringify(validated.discordBuildInfo)) {
            throw new Error("Copied Discord runtime metadata no longer matches the initially accepted package and build identity.");
        }
        assertOwnedStagingDirectory(staging);
        neutralizeCopiedDesktopCoreInjector(runtime, validated.discordDesktopCoreEntry);

        const isolatedDiscordVersionRoot = path.join(
            staging.path,
            "profile",
            "Roaming",
            "discord",
            validated.discordVersion
        );
        fs.mkdirSync(isolatedDiscordVersionRoot, {recursive: true});
        fs.mkdirSync(path.join(staging.path, "profile", "Roaming", "BetterDiscord"), {recursive: true});
        fs.mkdirSync(path.join(staging.path, "profile", "Local", "Discord"), {recursive: true});
        fs.writeFileSync(
            path.join(isolatedDiscordVersionRoot, DISCORD_FIRST_RUN_MARKER),
            "true",
            {encoding: "utf8", flag: "wx"}
        );
        fs.writeFileSync(
            path.join(staging.path, ACCEPTANCE_SETTINGS_FILE),
            `${JSON.stringify({SKIP_HOST_UPDATE: true, SKIP_MODULE_UPDATE: true}, null, 2)}\n`,
            {encoding: "utf8", flag: "wx"}
        );

        const copiedSolcord = path.join(runtime, "resources", "solcord.asar");
        if (lstatIfPresent(copiedSolcord)) {
            throw new Error("The copied runtime already contains resources/solcord.asar; refusing to overwrite it.");
        }
        fs.copyFileSync(validated.solcordAsar, copiedSolcord, fs.constants.COPYFILE_EXCL);
        if (sha256(copiedSolcord) !== validated.solcordSha256) {
            throw new Error("Copied Solcord ASAR failed post-copy SHA-256 verification.");
        }

        fs.writeFileSync(path.join(runtime, "resources", "app", "index.js"), renderDisposableAcceptanceShim(), {encoding: "utf8"});
        fs.writeFileSync(path.join(staging.path, LAUNCHER_FILE), renderLauncher(), {encoding: "utf8", flag: "wx"});
        fs.writeFileSync(
            path.join(staging.path, MANIFEST_FILE),
            `${JSON.stringify(manifest, null, 2)}\n`,
            {encoding: "utf8", flag: "wx"}
        );
        assertOwnedStagingDirectory(staging);
        if (lstatIfPresent(validated.destinationRoot)) {
            throw new Error("destinationRoot appeared before atomic commit; refusing to replace it.");
        }
        fs.renameSync(staging.path, validated.destinationRoot);
        committed = true;
    }
    catch (error) {
        if (staging && !committed) cleanupOwnedStagingDirectory(staging);
        throw error;
    }

    return {
        dryRun: false,
        manifest,
        writtenFiles: [
            manifest.paths.electronEntryPoint,
            validated.discordDesktopCoreEntry,
            manifest.paths.solcordAsar,
            manifest.paths.acceptanceSettings,
            manifest.paths.firstRunMarker,
            manifest.paths.launcher,
            MANIFEST_FILE
        ]
    };
}

function parseCli(argv: string[]): DisposableAcceptanceOptions {
    const values = new Map<string, string>();
    let dryRun = false;
    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        if (argument === "--dry-run") {
            dryRun = true;
            continue;
        }
        if (!["--source-app", "--solcord-asar", "--destination", "--expected-sha256", "--expected-source-commit"].includes(argument)) {
            throw new Error(`Unknown argument: ${argument}`);
        }
        const value = argv[++index];
        if (!value || value.startsWith("--") || values.has(argument)) {
            throw new Error(`Missing or duplicate value for ${argument}.`);
        }
        values.set(argument, value);
    }

    const sourceDiscordAppDir = values.get("--source-app");
    const solcordAsar = values.get("--solcord-asar");
    const destinationRoot = values.get("--destination");
    const expectedSolcordSha256 = values.get("--expected-sha256");
    const expectedSolcordSourceCommit = values.get("--expected-source-commit");
    if (!sourceDiscordAppDir || !solcordAsar || !destinationRoot || !expectedSolcordSha256 || !expectedSolcordSourceCommit) {
        throw new Error("Usage: bun scripts/prepare-solcord-disposable-acceptance.ts --source-app <absolute app-version dir> --solcord-asar <absolute file> --destination <new absolute dir> --expected-sha256 <sha256> --expected-source-commit <40-character git commit> [--dry-run]");
    }

    return {sourceDiscordAppDir, solcordAsar, destinationRoot, expectedSolcordSha256, expectedSolcordSourceCommit, dryRun};
}

if (import.meta.main) {
    try {
        const result = prepareSolcordDisposableAcceptance(parseCli(process.argv.slice(2)));
        console.log(JSON.stringify(result, null, 2));
    }
    catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
