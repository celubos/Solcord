// SPDX-License-Identifier: Apache-2.0

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

import * as asar from "@electron/asar";

const SCRIPT_REPOSITORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE_MANIFEST = "release-manifest.json";
const RELEASE_CHECKSUMS = "SHA256SUMS.txt";
const INSTALLER_RECEIPT = "solcord-installer-build-receipt.json";
const INSTALLER_FILES = [
    "SolcordInstaller.exe",
    "solcord.asar",
    "solcord-build-manifest.json",
    "solcord-installer-manifest.json",
    "SHA256SUMS.txt"
];
const INSTALLER_BUNDLE_FILES = [...INSTALLER_FILES, INSTALLER_RECEIPT];
const INSTALLER_PAYLOADS = INSTALLER_FILES.filter(name => name !== "SHA256SUMS.txt");
const INSTALLER_MANIFEST_SCHEMA = 7;
const BUILD_MANIFEST_SCHEMA = 2;
const RELEASE_NONCLAIMS = Object.freeze([
    "This evidence assembly does not prove live Discord behavior or owner-profile installation.",
    "This unsigned release has no authenticated Windows publisher identity.",
    "Merge-SHA packaging and publication remain separate release gates."
]);
const CANDIDATE_PATTERN = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SAFE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_EVIDENCE_BYTES = 512 * 1024 * 1024;
const MAX_CHECKSUM_BYTES = 4 * 1024 * 1024;
const MAX_CHECKSUM_LINES = 65_536;
const MAX_RELEASE_ARTIFACTS = 4_096;
const MAX_RELEASE_ENTRIES = 8_192;
const MAX_RELEASE_DEPTH = 8;
const MAX_RELEASE_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024 * 1024;
const COPY_BUFFER_BYTES = 1024 * 1024;

const compareUtf8 = (left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

function hasExactKeys(value, expected) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const actual = Object.keys(value).sort(compareUtf8);
    const required = [...expected].sort(compareUtf8);
    return actual.length === required.length && actual.every((key, index) => key === required[index]);
}

function coherentDistributionState(value) {
    return (!value.published || value.merged && value.installed)
        && (!value.installed || value.merged);
}

function comparablePath(value) {
    const normalized = path.normalize(path.resolve(value)).replace(/[\\/]+$/, "") || path.parse(path.resolve(value)).root;
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function requireNoReparseComponents(value, message) {
    const absolute = path.resolve(value);
    if (!fs.existsSync(absolute)) throw new Error(message);
    const parsed = path.parse(absolute);
    let current = parsed.root;
    for (const component of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
        current = path.join(current, component);
        const entry = fs.lstatSync(current);
        if (entry.isSymbolicLink()) throw new Error(message);
        const canonical = fs.realpathSync.native(current);
        if (comparablePath(canonical) !== comparablePath(current)) throw new Error(message);
    }
    return fs.realpathSync.native(absolute);
}

const crcTable = Array.from({length: 256}, (_, value) => {
    let crc = value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    return crc >>> 0;
});

function hashFile(file) {
    const hash = crypto.createHash("sha256");
    const descriptor = fs.openSync(file, "r");
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    try {
        while (true) {
            const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
            if (read === 0) break;
            hash.update(buffer.subarray(0, read));
        }
    }
    finally {fs.closeSync(descriptor);}
    return hash.digest("hex");
}

function sameFileState(left, right) {
    return left.dev === right.dev
        && left.ino === right.ino
        && left.size === right.size
        && left.mtimeMs === right.mtimeMs
        && left.ctimeMs === right.ctimeMs;
}

function readBoundedBytes(file, maximumBytes, message, allowEmpty = false) {
    const canonical = requireNoReparseComponents(file, message);
    const descriptor = fs.openSync(canonical, "r");
    const chunks = [];
    let total = 0;
    try {
        const before = fs.fstatSync(descriptor);
        if (!before.isFile() || (!allowEmpty && before.size <= 0) || before.size > maximumBytes) throw new Error(message);
        const buffer = Buffer.allocUnsafe(Math.min(COPY_BUFFER_BYTES, maximumBytes + 1));
        while (true) {
            const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
            if (read === 0) break;
            total += read;
            if (total > maximumBytes) throw new Error(message);
            chunks.push(Buffer.from(buffer.subarray(0, read)));
        }
        const after = fs.fstatSync(descriptor);
        if (!sameFileState(before, after) || total !== before.size) throw new Error(`${message} The file changed while it was read.`);
        return Buffer.concat(chunks, total);
    }
    finally {fs.closeSync(descriptor);}
}

function inspectBoundedFile(file, maximumBytes, message) {
    const canonical = requireNoReparseComponents(file, message);
    const descriptor = fs.openSync(canonical, "r");
    const hash = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    let total = 0;
    try {
        const before = fs.fstatSync(descriptor);
        if (!before.isFile() || before.size <= 0 || before.size > maximumBytes) throw new Error(message);
        while (true) {
            const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
            if (read === 0) break;
            total += read;
            if (total > maximumBytes) throw new Error(message);
            hash.update(buffer.subarray(0, read));
        }
        const after = fs.fstatSync(descriptor);
        if (!sameFileState(before, after) || total !== before.size) throw new Error(`${message} The file changed while it was read.`);
        return {bytes: total, sha256: hash.digest("hex")};
    }
    finally {fs.closeSync(descriptor);}
}

function readPinnedJson(file, maximumBytes, expectedSha256, trustMessage, invalidMessage) {
    if (!SHA256_PATTERN.test(expectedSha256 ?? "")) throw new Error(trustMessage);
    const bytes = readBoundedBytes(file, maximumBytes, invalidMessage);
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== expectedSha256) throw new Error(trustMessage);
    try {return JSON.parse(bytes.toString("utf8"));}
    catch {throw new Error(invalidMessage);}
}

function snapshotFile(source, destination, maximumBytes, expected, message) {
    const canonical = requireNoReparseComponents(source, message);
    const input = fs.openSync(canonical, "r");
    let output;
    const hash = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    let copiedBytes = 0;
    try {
        const before = fs.fstatSync(input);
        if (!before.isFile() || before.size <= 0 || before.size > maximumBytes) throw new Error(message);
        output = fs.openSync(destination, "wx", 0o600);
        while (true) {
            const read = fs.readSync(input, buffer, 0, buffer.length, null);
            if (read === 0) break;
            copiedBytes += read;
            if (copiedBytes > maximumBytes) throw new Error(`${message} The source grew beyond its bound.`);
            const chunk = buffer.subarray(0, read);
            hash.update(chunk);
            writeAll(output, chunk);
        }
        fs.fsyncSync(output);
        const after = fs.fstatSync(input);
        const digest = hash.digest("hex");
        if (!sameFileState(before, after) || copiedBytes !== before.size) throw new Error(`${message} The source changed while it was snapshotted.`);
        if (expected?.bytes !== undefined && copiedBytes !== expected.bytes) throw new Error(`${message} The source size differs from its trust record.`);
        if (expected?.sha256 !== undefined && digest !== expected.sha256) throw new Error(`${message} The source hash differs from its trust record.`);
        return {source: canonical, state: before, bytes: copiedBytes, sha256: digest};
    }
    catch (error) {
        if (output !== undefined) {
            fs.closeSync(output);
            output = undefined;
        }
        if (fs.existsSync(destination)) fs.rmSync(destination);
        throw error;
    }
    finally {
        if (output !== undefined) fs.closeSync(output);
        fs.closeSync(input);
    }
}

function assertSnapshotSourcesUnchanged(records) {
    for (const record of records) {
        const canonical = requireNoReparseComponents(record.source, "A snapshotted release input is no longer safe.");
        const current = fs.statSync(canonical);
        if (!sameFileState(record.state, current)) throw new Error("A release input changed after it was snapshotted.");
    }
}

function crc32File(file, start = 0, length = fs.statSync(file).size) {
    let crc = 0xffffffff;
    const descriptor = fs.openSync(file, "r");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
        let position = start;
        const end = start + length;
        while (position < end) {
            const read = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, end - position), position);
            if (read === 0) throw new Error("The deterministic ZIP input was truncated.");
            position += read;
            for (let index = 0; index < read; index++) crc = (crc >>> 8) ^ crcTable[(crc ^ buffer[index]) & 0xff];
        }
    }
    finally {fs.closeSync(descriptor);}
    return (crc ^ 0xffffffff) >>> 0;
}

function writeAll(descriptor, bytes) {
    let offset = 0;
    while (offset < bytes.length) offset += fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
}

function copyToDescriptor(source, destination, start = 0, length = fs.statSync(source).size) {
    const input = fs.openSync(source, "r");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
        let position = start;
        const end = start + length;
        while (position < end) {
            const read = fs.readSync(input, buffer, 0, Math.min(buffer.length, end - position), position);
            if (read === 0) throw new Error("The deterministic ZIP input was truncated.");
            position += read;
            writeAll(destination, buffer.subarray(0, read));
        }
    }
    finally {fs.closeSync(input);}
}

function requireSafeZipName(name) {
    if (typeof name !== "string" || Buffer.byteLength(name, "utf8") === 0 || Buffer.byteLength(name, "utf8") > 0xffff || name.startsWith("/") || name.includes("\\") || name.split("/").some(component => !component || component === "." || component === "..")) throw new Error("The deterministic ZIP received an unsafe file name.");
}

function createStoredZip(entries, destination) {
    const ordered = [...entries].sort((left, right) => compareUtf8(left.name, right.name));
    if (ordered.length === 0 || ordered.length > 0xffff) throw new Error("The deterministic ZIP requires between one and 65,535 files.");
    const names = new Set();
    const metadata = ordered.map(entry => {
        requireSafeZipName(entry.name);
        if (names.has(entry.name)) throw new Error("The deterministic ZIP received an unsafe or duplicate file name.");
        names.add(entry.name);
        const file = requireRegularFile(entry.file, 0xffffffff, "The deterministic ZIP input is missing or unsafe.", true);
        if (file.size > 0xffffffff) throw new Error("The deterministic ZIP does not support ZIP64 inputs.");
        const sourceOffset = entry.sourceOffset ?? 0;
        const size = entry.sourceBytes ?? file.size;
        if (!Number.isSafeInteger(sourceOffset) || !Number.isSafeInteger(size) || sourceOffset < 0 || size < 0 || sourceOffset + size > file.size) throw new Error("The deterministic ZIP input range is invalid.");
        const mode = entry.mode === 0o100755 ? 0o100755 : 0o100644;
        return {name: entry.name, file: entry.file, size, sourceOffset, crc32: crc32File(entry.file, sourceOffset, size), mode, offset: 0};
    });

    const output = fs.openSync(destination, "wx");
    let position = 0;
    try {
        for (const entry of metadata) {
            if (position > 0xffffffff) throw new Error("The deterministic ZIP does not support ZIP64 offsets.");
            entry.offset = position;
            const name = Buffer.from(entry.name, "utf8");
            const header = Buffer.alloc(30);
            header.writeUInt32LE(0x04034b50, 0);
            header.writeUInt16LE(20, 4);
            header.writeUInt16LE(0x0800, 6);
            header.writeUInt16LE(0, 8);
            header.writeUInt16LE(0, 10);
            header.writeUInt16LE(0x0021, 12);
            header.writeUInt32LE(entry.crc32, 14);
            header.writeUInt32LE(entry.size, 18);
            header.writeUInt32LE(entry.size, 22);
            header.writeUInt16LE(name.length, 26);
            header.writeUInt16LE(0, 28);
            writeAll(output, header);
            writeAll(output, name);
            copyToDescriptor(entry.file, output, entry.sourceOffset, entry.size);
            position += header.length + name.length + entry.size;
        }

        const centralOffset = position;
        for (const entry of metadata) {
            const name = Buffer.from(entry.name, "utf8");
            const header = Buffer.alloc(46);
            header.writeUInt32LE(0x02014b50, 0);
            header.writeUInt16LE(0x0314, 4);
            header.writeUInt16LE(20, 6);
            header.writeUInt16LE(0x0800, 8);
            header.writeUInt16LE(0, 10);
            header.writeUInt16LE(0, 12);
            header.writeUInt16LE(0x0021, 14);
            header.writeUInt32LE(entry.crc32, 16);
            header.writeUInt32LE(entry.size, 20);
            header.writeUInt32LE(entry.size, 24);
            header.writeUInt16LE(name.length, 28);
            header.writeUInt16LE(0, 30);
            header.writeUInt16LE(0, 32);
            header.writeUInt16LE(0, 34);
            header.writeUInt16LE(0, 36);
            header.writeUInt32LE((entry.mode << 16) >>> 0, 38);
            header.writeUInt32LE(entry.offset, 42);
            writeAll(output, header);
            writeAll(output, name);
            position += header.length + name.length;
        }
        const centralSize = position - centralOffset;
        if (centralOffset > 0xffffffff || centralSize > 0xffffffff) throw new Error("The deterministic ZIP does not support ZIP64 central directories.");
        const end = Buffer.alloc(22);
        end.writeUInt32LE(0x06054b50, 0);
        end.writeUInt16LE(0, 4);
        end.writeUInt16LE(0, 6);
        end.writeUInt16LE(metadata.length, 8);
        end.writeUInt16LE(metadata.length, 10);
        end.writeUInt32LE(centralSize, 12);
        end.writeUInt32LE(centralOffset, 16);
        end.writeUInt16LE(0, 20);
        writeAll(output, end);
        fs.fsyncSync(output);
    }
    finally {fs.closeSync(output);}
}

function requireRegularFile(file, maximumBytes, message, allowEmpty = false) {
    const canonical = requireNoReparseComponents(file, message);
    const entry = fs.lstatSync(canonical);
    if (!entry.isFile() || entry.isSymbolicLink() || (!allowEmpty && entry.size <= 0) || entry.size > maximumBytes) throw new Error(message);
    return entry;
}

function gitText(repo, args) {
    const result = spawnSync("git", args, {cwd: repo, encoding: "utf8", windowsHide: true});
    if (result.status !== 0) throw new Error("Release evidence could not verify Git provenance.");
    return result.stdout.trim();
}

function verifyRepository(repo, sourceCommit) {
    const resolved = requireNoReparseComponents(repo, "The release source repository contains a reparse point or unsafe path.");
    if (!COMMIT_PATTERN.test(sourceCommit)) throw new Error("The release source commit must be a lowercase 40-character Git commit.");
    const head = gitText(resolved, ["rev-parse", "HEAD"]).toLowerCase();
    if (head !== sourceCommit || gitText(resolved, ["status", "--porcelain=v1", "--untracked-files=all"])) throw new Error("Release evidence requires the exact clean source commit supplied on the command line.");
    gitText(resolved, ["cat-file", "-e", `${sourceCommit}^{commit}`]);
    const timestamp = new Date(gitText(resolved, ["show", "-s", "--format=%cI", sourceCommit]));
    if (Number.isNaN(timestamp.valueOf())) throw new Error("The release source commit has an invalid timestamp.");
    return {repo: resolved, sourceCommitTimeUtc: timestamp.toISOString()};
}

function parseChecksums(file) {
    const bytes = readBoundedBytes(file, MAX_CHECKSUM_BYTES, "A checksum manifest is missing or too large.");
    const allLines = bytes.toString("utf8").split(/\r?\n/);
    if (allLines.length > MAX_CHECKSUM_LINES + 1) throw new Error("A checksum manifest contains too many records.");
    const lines = allLines.filter(Boolean);
    const values = new Map();
    for (const line of lines) {
        const match = /^([0-9a-f]{64}) {2}([A-Za-z0-9][A-Za-z0-9._/-]{0,255})$/.exec(line);
        if (!match || values.has(match[2]) || match[2].includes("..") || match[2].includes("\\")) throw new Error("A checksum manifest is malformed or ambiguous.");
        values.set(match[2], match[1]);
    }
    return values;
}

function inspectInstallerBundleDirectory(directory) {
    const root = requireNoReparseComponents(directory, "The installer bundle contains a reparse point or unsafe path.");
    const rootEntry = fs.lstatSync(root);
    if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) throw new Error("The installer bundle is not a regular directory.");
    const entries = fs.readdirSync(root, {withFileTypes: true});
    if (entries.some(entry => !entry.isFile() || entry.isSymbolicLink()) || JSON.stringify(entries.map(entry => entry.name).sort(compareUtf8)) !== JSON.stringify([...INSTALLER_BUNDLE_FILES].sort(compareUtf8))) throw new Error("The installer bundle must contain exactly the expected files and external build receipt.");
    for (const name of INSTALLER_BUNDLE_FILES) requireRegularFile(path.join(root, name), name.endsWith(".exe") ? 512 * 1024 * 1024 : 256 * 1024 * 1024, "An installer bundle file is missing or unsafe.");
    return root;
}

function readInstallerReceipt(root, sourceCommit, candidateLabel, expectedReceiptSha256) {
    const receiptFile = path.join(root, INSTALLER_RECEIPT);
    const receipt = readPinnedJson(
        receiptFile,
        256 * 1024,
        expectedReceiptSha256,
        "The installer build receipt does not match its external trust anchor.",
        "The installer build receipt is invalid."
    );
    if (receipt?.candidateLabel !== candidateLabel) throw new Error("The installer build receipt candidate label does not match the requested release candidate.");
    if (receipt?.schemaVersion !== 1
        || receipt?.kind !== "solcord-installer-build-receipt"
        || receipt?.product !== "Solcord"
        || receipt?.productVersion !== "2.0.0"
        || receipt?.sourceCommit !== sourceCommit
        || receipt?.sourceClean !== true
        || receipt?.selfTest?.result !== "PASS"
        || receipt?.selfTest?.isolatedWorkingDirectory !== true
        || !Array.isArray(receipt?.files)
        || receipt.files.length !== INSTALLER_FILES.length) throw new Error("The installer build receipt does not bind the self-tested build result.");
    const receiptFiles = new Map();
    for (const record of receipt.files) {
        if (!INSTALLER_FILES.includes(record?.name)
            || receiptFiles.has(record.name)
            || !SHA256_PATTERN.test(record?.sha256 ?? "")
            || !Number.isSafeInteger(record?.bytes)
            || record.bytes <= 0) throw new Error("The installer build receipt contains an unsafe file record.");
        receiptFiles.set(record.name, record);
    }
    if (JSON.stringify([...receiptFiles.keys()].sort(compareUtf8)) !== JSON.stringify([...INSTALLER_FILES].sort(compareUtf8))) throw new Error("The installer build receipt has an unexpected file set.");
    return {receipt, receiptFiles};
}

function verifyInstallerBundle(directory, sourceCommit, candidateLabel, expectedReceiptSha256) {
    const root = inspectInstallerBundleDirectory(directory);
    const {receiptFiles} = readInstallerReceipt(root, sourceCommit, candidateLabel, expectedReceiptSha256);
    for (const name of INSTALLER_FILES) {
        const file = path.join(root, name);
        const record = receiptFiles.get(name);
        if (fs.statSync(file).size !== record.bytes || hashFile(file) !== record.sha256) throw new Error("An installer file does not match the external build receipt.");
    }

    const checksums = parseChecksums(path.join(root, "SHA256SUMS.txt"));
    if (JSON.stringify([...checksums.keys()].sort()) !== JSON.stringify([...INSTALLER_PAYLOADS].sort())) throw new Error("The installer checksum manifest has an unexpected file set.");
    for (const name of INSTALLER_PAYLOADS) if (hashFile(path.join(root, name)) !== checksums.get(name)) throw new Error("An installer bundle hash does not match SHA256SUMS.txt.");

    const installerManifest = readPinnedJson(
        path.join(root, "solcord-installer-manifest.json"),
        64 * 1024,
        receiptFiles.get("solcord-installer-manifest.json").sha256,
        "The installer manifest differs from the external build receipt.",
        "The installer manifest is invalid."
    );
    const buildManifest = readPinnedJson(
        path.join(root, "solcord-build-manifest.json"),
        256 * 1024,
        receiptFiles.get("solcord-build-manifest.json").sha256,
        "The build manifest differs from the external build receipt.",
        "The build manifest is invalid."
    );
    const artifact = path.join(root, "solcord.asar");
    const artifactHash = hashFile(artifact);
    const buildManifestHash = hashFile(path.join(root, "solcord-build-manifest.json"));
    const artifactBytes = fs.statSync(artifact).size;
    if (installerManifest?.schemaVersion !== INSTALLER_MANIFEST_SCHEMA
        || installerManifest?.candidateLabel !== candidateLabel
        || installerManifest?.sourceCommit !== sourceCommit
        || installerManifest?.artifactFile !== "solcord.asar"
        || installerManifest?.artifactSha256 !== artifactHash
        || installerManifest?.buildManifestSha256 !== buildManifestHash
        || buildManifest?.schemaVersion !== BUILD_MANIFEST_SCHEMA
        || buildManifest?.kind !== "solcord-post-build-manifest"
        || buildManifest?.build?.schemaVersion !== BUILD_MANIFEST_SCHEMA
        || buildManifest?.build?.kind !== "solcord-build-provenance"
        || buildManifest?.build?.product !== "Solcord"
        || buildManifest?.build?.candidateLabel !== candidateLabel
        || buildManifest?.build?.source?.clean !== true
        || buildManifest?.build?.source?.commit !== sourceCommit
        || buildManifest?.build?.version !== installerManifest?.version
        || buildManifest?.artifacts?.asar?.file !== "solcord.asar"
        || buildManifest?.artifacts?.asar?.sha256 !== artifactHash
        || buildManifest?.artifacts?.asar?.bytes !== artifactBytes) throw new Error("The installer bundle is not bound to the exact clean source commit.");
    let embedded;
    try {embedded = JSON.parse(asar.extractFile(artifact, "build-provenance.json").toString("utf8"));}
    catch {throw new Error("The installer ASAR has invalid embedded provenance.");}
    if (JSON.stringify(embedded) !== JSON.stringify(buildManifest.build)) throw new Error("The installer ASAR provenance differs from the build manifest.");
    return {root, installerManifest, buildManifest, artifactHash, receiptSha256: expectedReceiptSha256};
}

function snapshotInstallerBundle(directory, destination, sourceCommit, candidateLabel, expectedReceiptSha256) {
    const root = inspectInstallerBundleDirectory(directory);
    const snapshots = [];
    const receiptSource = path.join(root, INSTALLER_RECEIPT);
    const receiptDestination = path.join(destination, INSTALLER_RECEIPT);
    snapshots.push(snapshotFile(receiptSource, receiptDestination, 256 * 1024, {sha256: expectedReceiptSha256}, "The installer build receipt does not match its external trust anchor."));
    const {receiptFiles} = readInstallerReceipt(destination, sourceCommit, candidateLabel, expectedReceiptSha256);
    for (const name of INSTALLER_FILES) {
        const record = receiptFiles.get(name);
        snapshots.push(snapshotFile(
            path.join(root, name),
            path.join(destination, name),
            name.endsWith(".exe") ? 512 * 1024 * 1024 : 256 * 1024 * 1024,
            {sha256: record.sha256, bytes: record.bytes},
            "An installer input could not be snapshotted safely."
        ));
    }
    return {installer: verifyInstallerBundle(destination, sourceCommit, candidateLabel, expectedReceiptSha256), snapshots};
}

function normalizeBoundReleaseContext({discord, backup, rollback, acceptanceGates}, evidenceByName, message) {
    if (!hasExactKeys(discord, ["version", "channel", "profileType"])
        || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(discord.version ?? "")
        || !["Stable", "PTB", "Canary"].includes(discord.channel)
        || !["disposable", "owner"].includes(discord.profileType)
        || !hasExactKeys(backup, ["identity", "status", "evidenceName", "evidenceSha256"])
        || !SAFE_NAME_PATTERN.test(backup.identity ?? "")
        || !hasExactKeys(rollback, ["backupIdentity", "status", "evidenceName", "evidenceSha256"])
        || rollback.backupIdentity !== backup.identity
        || !Array.isArray(acceptanceGates)
        || acceptanceGates.length === 0
        || acceptanceGates.length > 128) throw new Error(message);

    const references = [backup, rollback, ...acceptanceGates];
    const gateIds = new Set();
    for (const [index, reference] of references.entries()) {
        const expectedKeys = index < 2
            ? (index === 0 ? ["identity", "status", "evidenceName", "evidenceSha256"] : ["backupIdentity", "status", "evidenceName", "evidenceSha256"])
            : ["id", "status", "evidenceName", "evidenceSha256"];
        const evidence = evidenceByName(reference?.evidenceName);
        if (!hasExactKeys(reference, expectedKeys)
            || !evidence
            || evidence.sha256 !== reference.evidenceSha256
            || !["PASS", "BLOCKED", "NOT_RUN"].includes(reference.status)
            || (index >= 2 && (!/^[a-z][a-z0-9-]{0,63}$/.test(reference.id ?? "") || gateIds.has(reference.id)))) throw new Error(message);
        if (index >= 2) gateIds.add(reference.id);
    }

    return {
        discord: {version: discord.version, channel: discord.channel, profileType: discord.profileType},
        backup: {identity: backup.identity, status: backup.status, evidenceName: backup.evidenceName, evidenceSha256: backup.evidenceSha256},
        rollback: {backupIdentity: rollback.backupIdentity, status: rollback.status, evidenceName: rollback.evidenceName, evidenceSha256: rollback.evidenceSha256},
        acceptanceGates: acceptanceGates.map(gate => ({id: gate.id, status: gate.status, evidenceName: gate.evidenceName, evidenceSha256: gate.evidenceSha256}))
    };
}

function loadEvidenceInputs(file, candidateLabel, sourceCommit, expectedManifestSha256) {
    const manifestFile = requireNoReparseComponents(file, "The evidence-input manifest contains a reparse point or unsafe path.");
    const manifest = readPinnedJson(
        manifestFile,
        1024 * 1024,
        expectedManifestSha256,
        "The evidence-input manifest does not match its external trust anchor.",
        "The evidence-input manifest is invalid."
    );
    if (manifest?.schemaVersion !== 1 || manifest?.kind !== "solcord-release-evidence-inputs" || manifest?.candidateLabel !== candidateLabel || manifest?.sourceCommit !== sourceCommit || !Array.isArray(manifest?.files) || manifest.files.length === 0) throw new Error("The evidence-input manifest does not match this candidate.");
    const names = new Set();
    const files = manifest.files.map(item => {
        if (!SAFE_NAME_PATTERN.test(item?.name ?? "")
            || !SAFE_NAME_PATTERN.test(item?.source ?? "")
            || names.has(item.name)
            || !SHA256_PATTERN.test(item?.sha256 ?? "")
            || !/^[a-z][a-z0-9-]{0,31}$/.test(item?.category ?? "")) throw new Error("The evidence-input manifest contains an unsafe file record.");
        names.add(item.name);
        const source = path.join(path.dirname(manifestFile), item.source);
        const entry = requireRegularFile(source, MAX_EVIDENCE_BYTES, "An evidence input is missing or unsafe.");
        if (path.dirname(fs.realpathSync.native(source)) !== path.dirname(manifestFile)) throw new Error("An evidence input escapes its manifest directory.");
        return {source, name: item.name, category: item.category, sha256: item.sha256, bytes: entry.size};
    }).sort((left, right) => compareUtf8(left.name, right.name));
    const byName = new Map(files.map(item => [item.name, item]));
    const context = manifest.releaseContext;
    if (!hasExactKeys(context, ["discord", "backup", "rollback", "acceptanceGates", "distribution"])
        || !hasExactKeys(context.distribution, ["signed", "merged", "published", "installed"])
        || context.distribution.signed !== false
        || typeof context?.distribution?.merged !== "boolean"
        || typeof context?.distribution?.published !== "boolean"
        || typeof context?.distribution?.installed !== "boolean"
        || !coherentDistributionState(context.distribution)) throw new Error("The evidence-input manifest has an invalid release context.");
    const normalized = normalizeBoundReleaseContext(context, name => byName.get(name), "The release context references invalid or unbound evidence.");
    return {
        files,
        manifestSha256: expectedManifestSha256,
        releaseContext: {
            ...normalized,
            distribution: {
                signed: false,
                merged: context.distribution.merged,
                published: context.distribution.published,
                installed: context.distribution.installed
            }
        }
    };
}

function isInside(parent, child) {
    const relative = path.relative(parent, child);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function removeOwnedDirectory(directory, parent, prefix) {
    if (!fs.existsSync(directory)) return;
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(parent) || !path.basename(resolved).startsWith(prefix)) throw new Error("Refusing to remove an unexpected release-evidence directory.");
    requireNoReparseComponents(parent, "Refusing to remove through a reparse point.");
    const entry = fs.lstatSync(resolved);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Refusing to remove a linked release-evidence directory.");
    fs.rmSync(resolved, {recursive: true});
}

function listFiles(root, current = root) {
    const files = [];
    const pending = [{directory: current, depth: 0}];
    let visited = 0;
    while (pending.length) {
        const {directory, depth} = pending.pop();
        requireNoReparseComponents(directory, "The release directory contains a reparse point or unsafe path.");
        for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
            if (++visited > MAX_RELEASE_ENTRIES) throw new Error("The release directory contains too many entries.");
            const absolute = path.join(directory, entry.name);
            requireNoReparseComponents(absolute, "The release directory contains a reparse point or unsafe path.");
            if (entry.isSymbolicLink()) throw new Error("The release directory contains a linked entry.");
            if (entry.isDirectory()) {
                if (depth >= MAX_RELEASE_DEPTH) throw new Error("The release directory exceeds the maximum supported depth.");
                pending.push({directory: absolute, depth: depth + 1});
            }
            else if (entry.isFile()) files.push(path.relative(root, absolute).split(path.sep).join("/"));
            else throw new Error("The release directory contains an unsupported entry.");
        }
    }
    return files.sort(compareUtf8);
}

function listSourceBlobs(repo, sourceCommit) {
    const result = spawnSync("git", ["ls-tree", "-r", "-z", "-l", "--full-tree", sourceCommit], {cwd: repo, encoding: "buffer", windowsHide: true, maxBuffer: 16 * 1024 * 1024});
    if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) throw new Error("Git could not enumerate the exact source tree.");
    const records = result.stdout.toString("utf8").split("\0").filter(Boolean);
    if (records.length === 0 || records.length > MAX_RELEASE_ENTRIES) throw new Error("The source tree contains an unsupported number of files.");
    let aggregateBytes = 0;
    return records.map(record => {
        const match = /^(100644|100755) blob ([0-9a-f]{40}|[0-9a-f]{64})\s+(\d+)\t(.+)$/.exec(record);
        if (!match) throw new Error("The source tree contains a non-file, linked, or malformed entry.");
        const sourcePath = match[4];
        requireSafeZipName(sourcePath);
        const bytes = Number(match[3]);
        if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 0xffffffff) throw new Error("A source blob has an unsupported size.");
        aggregateBytes += bytes;
        if (!Number.isSafeInteger(aggregateBytes) || aggregateBytes > MAX_SOURCE_BYTES) throw new Error("The source tree exceeds the deterministic archive budget.");
        return {mode: match[1] === "100755" ? 0o100755 : 0o100644, oid: match[2], bytes, sourcePath};
    }).sort((left, right) => compareUtf8(left.sourcePath, right.sourcePath));
}

export function createDeterministicSourceArchive(repo, sourceCommit, prefix, destination) {
    requireSafeZipName(`${prefix}placeholder`);
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "solcord-source-input-"));
    fs.chmodSync(workspace, 0o700);
    try {
        const sources = listSourceBlobs(repo, sourceCommit);
        const file = path.join(workspace, "git-blobs.batch");
        let descriptor = fs.openSync(file, "wx", 0o600);
        let result;
        try {result = spawnSync("git", ["cat-file", "--batch"], {cwd: repo, input: `${sources.map(source => source.oid).join("\n")}\n`, stdio: ["pipe", descriptor, "pipe"], windowsHide: true});}
        finally {fs.closeSync(descriptor);}
        if (result.status !== 0) throw new Error("Git could not materialize the exact source blob batch.");
        descriptor = fs.openSync(file, "r");
        let position = 0;
        let entries;
        try {
            entries = sources.map(source => {
                const expected = Buffer.from(`${source.oid} blob ${source.bytes}\n`, "ascii");
                const header = Buffer.alloc(expected.length);
                if (fs.readSync(descriptor, header, 0, header.length, position) !== header.length || !header.equals(expected)) throw new Error("Git returned an unexpected source blob identity or size.");
                const sourceOffset = position + header.length;
                const trailer = Buffer.alloc(1);
                if (fs.readSync(descriptor, trailer, 0, 1, sourceOffset + source.bytes) !== 1 || trailer[0] !== 10) throw new Error("Git returned a truncated source blob.");
                position = sourceOffset + source.bytes + 1;
                return {name: `${prefix}${source.sourcePath}`, file, mode: source.mode, sourceOffset, sourceBytes: source.bytes};
            });
            if (position !== fs.fstatSync(descriptor).size) throw new Error("Git returned unexpected data after the exact source blob batch.");
        }
        finally {fs.closeSync(descriptor);}
        createStoredZip(entries, destination);
    }
    finally {removeOwnedDirectory(workspace, os.tmpdir(), "solcord-source-input-");}
    requireRegularFile(destination, 1024 * 1024 * 1024, "The deterministic source archive was not created.");
}

function artifactRecord(root, relative, category) {
    const file = path.join(root, ...relative.split("/"));
    return {name: relative, category, bytes: fs.statSync(file).size, sha256: hashFile(file)};
}

function trustedEvidenceArtifact(input) {
    return {name: `evidence/${input.name}`, category: input.category, bytes: input.bytes, sha256: input.sha256};
}

function assertTrustedEvidenceArtifacts(root, artifacts) {
    for (const record of artifacts) {
        const file = path.join(root, ...record.name.split("/"));
        const actual = inspectBoundedFile(file, MAX_EVIDENCE_BYTES, "A staged evidence artifact is missing, unsafe, or changed.");
        if (actual.bytes !== record.bytes || actual.sha256 !== record.sha256) throw new Error("A staged evidence artifact no longer matches its externally pinned input record.");
    }
}

function writeJson(file, value) {
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, {encoding: "utf8", flag: "wx"});
}

function assertCandidateLabel(candidateLabel, productVersion) {
    if (!CANDIDATE_PATTERN.test(candidateLabel)) throw new Error("The release label must be an exact v-prefixed semantic version or prerelease label.");
    if (candidateLabel.slice(1).split("-")[0] !== productVersion) throw new Error("The candidate label does not match the installer product version.");
}

export function assembleRelease({repo = SCRIPT_REPOSITORY, sourceCommit, candidateLabel, installerBundle, installerReceiptSha256, evidenceManifest, evidenceManifestSha256, output}) {
    const repository = verifyRepository(repo, sourceCommit);
    const requestedDestination = path.resolve(output);
    const parent = requireNoReparseComponents(path.dirname(requestedDestination), "The release-evidence parent directory contains a reparse point or unsafe path.");
    const destination = path.join(parent, path.basename(requestedDestination));
    if (fs.existsSync(destination) || isInside(repository.repo, destination)) throw new Error("Release evidence must use a new directory outside the source checkout.");
    const parentEntry = fs.lstatSync(parent);
    if (!parentEntry.isDirectory() || parentEntry.isSymbolicLink()) throw new Error("The release-evidence parent directory is unsafe.");
    const staging = path.join(parent, `.${path.basename(destination)}.staging-${crypto.randomBytes(12).toString("hex")}`);
    const sourceName = `Solcord-source-${sourceCommit.slice(0, 8)}.zip`;
    const deliveryName = `Solcord-delivery-${sourceCommit.slice(0, 8)}.zip`;
    const reserved = new Set([RELEASE_MANIFEST, RELEASE_CHECKSUMS, sourceName, deliveryName, ...INSTALLER_BUNDLE_FILES]);
    let published = false;
    const inputSnapshots = [];
    try {
        fs.mkdirSync(staging, {recursive: false, mode: 0o700});
        fs.chmodSync(staging, 0o700);
        const installerRoot = path.join(staging, "installer");
        const evidenceRoot = path.join(staging, "evidence");
        fs.mkdirSync(installerRoot);
        fs.mkdirSync(evidenceRoot);
        const installerSnapshot = snapshotInstallerBundle(installerBundle, installerRoot, sourceCommit, candidateLabel, installerReceiptSha256);
        const installer = installerSnapshot.installer;
        inputSnapshots.push(...installerSnapshot.snapshots);
        assertCandidateLabel(candidateLabel, installer.installerManifest.version);
        const evidence = loadEvidenceInputs(evidenceManifest, candidateLabel, sourceCommit, evidenceManifestSha256);
        const evidenceInputs = evidence.files;
        if (evidenceInputs.some(input => reserved.has(input.name))) throw new Error("An evidence input collides with a release artifact name.");
        for (const input of evidenceInputs) {
            const copied = path.join(evidenceRoot, input.name);
            inputSnapshots.push(snapshotFile(
                input.source,
                copied,
                MAX_EVIDENCE_BYTES,
                {sha256: input.sha256, bytes: input.bytes},
                "An evidence input could not be snapshotted safely."
            ));
        }
        assertSnapshotSourcesUnchanged(inputSnapshots);

        const archivePrefix = `Solcord-${candidateLabel}/`;
        createDeterministicSourceArchive(repository.repo, sourceCommit, archivePrefix, path.join(staging, sourceName));
        createStoredZip(INSTALLER_BUNDLE_FILES.map(name => ({name, file: path.join(installerRoot, name)})), path.join(staging, deliveryName));
        if (gitText(repository.repo, ["rev-parse", "HEAD"]).toLowerCase() !== sourceCommit || gitText(repository.repo, ["status", "--porcelain=v1", "--untracked-files=all"])) throw new Error("The source changed while release evidence was assembled.");
        assertSnapshotSourcesUnchanged(inputSnapshots);

        const evidenceArtifacts = evidenceInputs.map(trustedEvidenceArtifact);
        assertTrustedEvidenceArtifacts(staging, evidenceArtifacts);
        const artifacts = [
            artifactRecord(staging, sourceName, "source-archive"),
            artifactRecord(staging, deliveryName, "delivery-archive"),
            ...INSTALLER_BUNDLE_FILES.map(name => artifactRecord(staging, `installer/${name}`, "installer")),
            ...evidenceArtifacts
        ].sort((left, right) => compareUtf8(left.name, right.name));
        const releaseManifest = {
            schemaVersion: 1,
            kind: "solcord-rc-release-evidence",
            candidateLabel,
            productVersion: installer.installerManifest.version,
            release: {
                status: "candidate-evidence",
                signed: false,
                merged: evidence.releaseContext.distribution.merged,
                published: evidence.releaseContext.distribution.published,
                installed: evidence.releaseContext.distribution.installed
            },
            source: {commit: sourceCommit, clean: true, commitTimeUtc: repository.sourceCommitTimeUtc, archivePrefix},
            discord: evidence.releaseContext.discord,
            backup: evidence.releaseContext.backup,
            rollback: evidence.releaseContext.rollback,
            acceptanceGates: evidence.releaseContext.acceptanceGates,
            installer: {sourceCommit, candidateLabel, productVersion: installer.installerManifest.version, artifactSha256: installer.artifactHash, manifestSchemaVersion: installer.installerManifest.schemaVersion, receiptSha256: installer.receiptSha256},
            publication: {
                installer: {sourcePath: "installer/SolcordInstaller.exe", assetName: "SolcordInstaller.exe"},
                checksums: {sourcePath: RELEASE_CHECKSUMS, assetName: RELEASE_CHECKSUMS},
                manifest: {sourcePath: RELEASE_MANIFEST, assetName: RELEASE_MANIFEST},
                sourceArchive: {sourcePath: sourceName, assetName: sourceName},
                deliveryArchive: {sourcePath: deliveryName, assetName: deliveryName}
            },
            artifacts,
            controls: {manifest: RELEASE_MANIFEST, checksums: RELEASE_CHECKSUMS, evidenceInputManifestSha256: evidence.manifestSha256},
            nonclaims: RELEASE_NONCLAIMS
        };
        writeJson(path.join(staging, RELEASE_MANIFEST), releaseManifest);
        const releaseManifestSha256 = hashFile(path.join(staging, RELEASE_MANIFEST));
        const checksumRecords = [...artifacts, artifactRecord(staging, RELEASE_MANIFEST, "control")].sort((left, right) => compareUtf8(left.name, right.name));
        const checksumText = checksumRecords.map(record => `${record.sha256}  ${record.name}`).join("\n");
        fs.writeFileSync(path.join(staging, RELEASE_CHECKSUMS), `${checksumText}\n`, {encoding: "utf8", flag: "wx"});
        validateRelease({repo: repository.repo, sourceCommit, candidateLabel, releaseDirectory: staging, releaseManifestSha256});
        assertTrustedEvidenceArtifacts(staging, evidenceArtifacts);
        assertSnapshotSourcesUnchanged(inputSnapshots);
        fs.renameSync(staging, destination);
        try {
            validateRelease({repo: repository.repo, sourceCommit, candidateLabel, releaseDirectory: destination, releaseManifestSha256});
            assertTrustedEvidenceArtifacts(destination, evidenceArtifacts);
            assertSnapshotSourcesUnchanged(inputSnapshots);
        }
        catch (error) {
            if (fs.existsSync(destination) && !fs.existsSync(staging)) fs.renameSync(destination, staging);
            throw error;
        }
        published = true;
        return {output: destination, sourceCommit, candidateLabel, manifestSha256: releaseManifestSha256, artifacts};
    }
    finally {if (!published) removeOwnedDirectory(staging, parent, `.${path.basename(destination)}.staging-`);}
}

export function validateRelease({repo = SCRIPT_REPOSITORY, sourceCommit, candidateLabel, releaseDirectory, releaseManifestSha256}) {
    const repository = verifyRepository(repo, sourceCommit);
    const root = requireNoReparseComponents(releaseDirectory, "The release-evidence directory contains a reparse point or unsafe path.");
    const rootEntry = fs.lstatSync(root);
    if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) throw new Error("The release-evidence directory is unsafe.");
    const manifestFile = path.join(root, RELEASE_MANIFEST);
    const manifest = readPinnedJson(
        manifestFile,
        4 * 1024 * 1024,
        releaseManifestSha256,
        "The release manifest does not match its external trust anchor.",
        "The release manifest is invalid."
    );
    if (!hasExactKeys(manifest, ["schemaVersion", "kind", "candidateLabel", "productVersion", "release", "source", "discord", "backup", "rollback", "acceptanceGates", "installer", "publication", "artifacts", "controls", "nonclaims"])
        || manifest?.schemaVersion !== 1
        || manifest?.kind !== "solcord-rc-release-evidence"
        || manifest?.candidateLabel !== candidateLabel
        || !hasExactKeys(manifest?.source, ["commit", "clean", "commitTimeUtc", "archivePrefix"])
        || manifest?.source?.commit !== sourceCommit
        || manifest?.source?.clean !== true
        || manifest?.source?.commitTimeUtc !== repository.sourceCommitTimeUtc
        || !hasExactKeys(manifest?.release, ["status", "signed", "merged", "published", "installed"])
        || manifest.release.status !== "candidate-evidence"
        || manifest?.release?.signed !== false
        || typeof manifest?.release?.merged !== "boolean"
        || typeof manifest?.release?.published !== "boolean"
        || typeof manifest?.release?.installed !== "boolean"
        || !coherentDistributionState(manifest.release)
        || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest?.discord?.version ?? "")
        || !["Stable", "PTB", "Canary"].includes(manifest?.discord?.channel)
        || !["disposable", "owner"].includes(manifest?.discord?.profileType)
        || !hasExactKeys(manifest?.installer, ["sourceCommit", "candidateLabel", "productVersion", "artifactSha256", "manifestSchemaVersion", "receiptSha256"])
        || !hasExactKeys(manifest?.publication, ["installer", "checksums", "manifest", "sourceArchive", "deliveryArchive"])
        || !Object.values(manifest.publication).every(value => hasExactKeys(value, ["sourcePath", "assetName"]))
        || !hasExactKeys(manifest?.controls, ["manifest", "checksums", "evidenceInputManifestSha256"])
        || manifest?.controls?.manifest !== RELEASE_MANIFEST
        || manifest?.controls?.checksums !== RELEASE_CHECKSUMS
        || !SHA256_PATTERN.test(manifest?.controls?.evidenceInputManifestSha256 ?? "")
        || JSON.stringify(manifest?.nonclaims) !== JSON.stringify(RELEASE_NONCLAIMS)
        || !Array.isArray(manifest?.artifacts)
        || manifest.artifacts.length === 0
        || manifest.artifacts.length > MAX_RELEASE_ARTIFACTS
        || !Array.isArray(manifest?.acceptanceGates)
        || manifest.acceptanceGates.length === 0
        || manifest.acceptanceGates.length > 128) throw new Error("The release manifest does not match this candidate.");
    assertCandidateLabel(candidateLabel, manifest.productVersion);
    if (manifest.source.archivePrefix !== `Solcord-${candidateLabel}/`) throw new Error("The source archive prefix does not match the candidate label.");
    const artifactNames = new Set();
    const artifactRecords = new Map();
    let aggregateBytes = 0;
    for (const record of manifest.artifacts) {
        if (!hasExactKeys(record, ["name", "category", "bytes", "sha256"])
            || typeof record?.name !== "string"
            || record.name.startsWith("/")
            || record.name.includes("\\")
            || record.name.split("/").some(component => !SAFE_NAME_PATTERN.test(component))
            || artifactNames.has(record.name)
            || !/^[a-z][a-z0-9-]{0,31}$/.test(record?.category ?? "")
            || !SHA256_PATTERN.test(record?.sha256 ?? "")
            || !Number.isSafeInteger(record?.bytes)
            || record.bytes <= 0) throw new Error("The release manifest contains an unsafe artifact record.");
        artifactNames.add(record.name);
        artifactRecords.set(record.name, record);
        aggregateBytes += record.bytes;
        if (!Number.isSafeInteger(aggregateBytes) || aggregateBytes > MAX_RELEASE_BYTES) throw new Error("The release artifacts exceed the verification budget.");
        const file = path.join(root, ...record.name.split("/"));
        const entry = requireRegularFile(file, 1024 * 1024 * 1024, "A release artifact is missing or unsafe.");
        if (entry.size !== record.bytes || hashFile(file) !== record.sha256) throw new Error("A release artifact does not match the release manifest.");
    }
    normalizeBoundReleaseContext(
        {discord: manifest.discord, backup: manifest.backup, rollback: manifest.rollback, acceptanceGates: manifest.acceptanceGates},
        name => artifactRecords.get(`evidence/${name}`),
        "The release acceptance context is not bound to its evidence."
    );
    const expectedFiles = [...artifactNames, RELEASE_MANIFEST, RELEASE_CHECKSUMS].sort();
    if (JSON.stringify(listFiles(root)) !== JSON.stringify(expectedFiles)) throw new Error("The release directory contains an unexpected file set.");

    const checksums = parseChecksums(path.join(root, RELEASE_CHECKSUMS));
    const checksumNames = [...artifactNames, RELEASE_MANIFEST].sort();
    if (JSON.stringify([...checksums.keys()].sort()) !== JSON.stringify(checksumNames)) throw new Error("The release checksum manifest has an unexpected file set.");
    for (const name of checksumNames) if (hashFile(path.join(root, ...name.split("/"))) !== checksums.get(name)) throw new Error("A release checksum does not match its artifact.");

    const installer = verifyInstallerBundle(path.join(root, "installer"), sourceCommit, candidateLabel, manifest?.installer?.receiptSha256);
    if (installer.installerManifest.version !== manifest.productVersion
        || manifest.installer.productVersion !== manifest.productVersion
        || manifest.installer.candidateLabel !== candidateLabel
        || installer.artifactHash !== manifest.installer.artifactSha256
        || manifest.installer.sourceCommit !== sourceCommit
        || manifest.installer.manifestSchemaVersion !== installer.installerManifest.schemaVersion) throw new Error("The release installer identity differs from the release manifest.");
    const sourceName = `Solcord-source-${sourceCommit.slice(0, 8)}.zip`;
    const deliveryName = `Solcord-delivery-${sourceCommit.slice(0, 8)}.zip`;
    if (manifest?.publication?.installer?.sourcePath !== "installer/SolcordInstaller.exe"
        || manifest?.publication?.installer?.assetName !== "SolcordInstaller.exe"
        || manifest?.publication?.checksums?.sourcePath !== RELEASE_CHECKSUMS
        || manifest?.publication?.checksums?.assetName !== RELEASE_CHECKSUMS
        || manifest?.publication?.manifest?.sourcePath !== RELEASE_MANIFEST
        || manifest?.publication?.manifest?.assetName !== RELEASE_MANIFEST
        || manifest?.publication?.sourceArchive?.sourcePath !== sourceName
        || manifest?.publication?.sourceArchive?.assetName !== sourceName
        || manifest?.publication?.deliveryArchive?.sourcePath !== deliveryName
        || manifest?.publication?.deliveryArchive?.assetName !== deliveryName) throw new Error("The release publication mapping is invalid.");
    if (!artifactNames.has(sourceName) || !artifactNames.has(deliveryName)) throw new Error("The release archives are missing.");
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "solcord-release-validation-"));
    fs.chmodSync(temporary, 0o700);
    try {
        const sourceArchive = path.join(temporary, sourceName);
        const deliveryArchive = path.join(temporary, deliveryName);
        createDeterministicSourceArchive(repository.repo, sourceCommit, manifest.source.archivePrefix, sourceArchive);
        createStoredZip(INSTALLER_BUNDLE_FILES.map(name => ({name, file: path.join(root, "installer", name)})), deliveryArchive);
        if (hashFile(sourceArchive) !== hashFile(path.join(root, sourceName))) throw new Error("The source archive is not the deterministic archive for this commit.");
        if (hashFile(deliveryArchive) !== hashFile(path.join(root, deliveryName))) throw new Error("The delivery archive is not the deterministic installer bundle.");
    }
    finally {removeOwnedDirectory(temporary, os.tmpdir(), "solcord-release-validation-");}
    return {releaseDirectory: root, sourceCommit, candidateLabel, manifestSha256: releaseManifestSha256, artifactCount: manifest.artifacts.length};
}

function parseCli(argv) {
    const [mode, ...rest] = argv;
    if (!['assemble', 'validate'].includes(mode)) throw new Error("Usage: bun scripts/assemble-solcord-release-evidence.mjs <assemble|validate> --source-commit <40-char> --candidate-label <vX.Y.Z-rc.N> ...");
    const values = new Map();
    for (let index = 0; index < rest.length; index += 2) {
        const flag = rest[index];
        const value = rest[index + 1];
        if (!flag?.startsWith("--") || value === undefined || value.startsWith("--") || values.has(flag)) throw new Error("Release-evidence command-line arguments are incomplete or duplicated.");
        values.set(flag, value);
    }
    const required = mode === "assemble"
        ? ["--source-commit", "--candidate-label", "--installer-bundle", "--installer-receipt-sha256", "--evidence-manifest", "--evidence-manifest-sha256", "--output"]
        : ["--source-commit", "--candidate-label", "--release-directory", "--release-manifest-sha256"];
    if (values.size !== required.length || required.some(flag => !values.has(flag))) throw new Error("Release-evidence command-line arguments do not match the selected mode.");
    return {mode, values};
}

if (import.meta.main) {
    const {mode, values} = parseCli(process.argv.slice(2));
    const common = {sourceCommit: values.get("--source-commit"), candidateLabel: values.get("--candidate-label")};
    const result = mode === "assemble"
        ? assembleRelease({...common, installerBundle: values.get("--installer-bundle"), installerReceiptSha256: values.get("--installer-receipt-sha256"), evidenceManifest: values.get("--evidence-manifest"), evidenceManifestSha256: values.get("--evidence-manifest-sha256"), output: values.get("--output")})
        : validateRelease({...common, releaseDirectory: values.get("--release-directory"), releaseManifestSha256: values.get("--release-manifest-sha256")});
    console.log(JSON.stringify(result, null, 2));
}
