// SPDX-License-Identifier: Apache-2.0

import {createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {SOLCORD_PRODUCT_IDENTITY} from "../src/common/solcord/product-identity";

const windowsNames = ["SHA256SUMS.txt", "SolcordInstaller.exe", "solcord-build-manifest.json", "solcord-installer-build-receipt.json", "solcord-installer-manifest.json", "solcord.asar"].sort();
interface FileReceipt {name: string; bytes: number; sha256: string;}
function describe(file: string, name = path.basename(file)): FileReceipt {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size <= 0 || stat.size > 512 * 1024 * 1024) throw new Error(`Unsafe package file: ${name}`);
    return {name, bytes: stat.size, sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex")};
}
function json(file: string) {describe(file); if (fs.statSync(file).size > 1024 * 1024) throw new Error("Package metadata exceeds its size limit."); return JSON.parse(fs.readFileSync(file, "utf8"));}
function sameFile(actual: FileReceipt, expected: {bytes: number; sha256: string;} | undefined) {
    if (!expected || actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) throw new Error(`Package hash or size mismatch: ${actual.name}`);
}

export function collectReleaseFiles(input: string, sourceCommit: string): Array<{source: string; receipt: FileReceipt;}> {
    if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error("An exact source commit is required.");
    const {numericVersion: version, candidateLabel} = SOLCORD_PRODUCT_IDENTITY;
    const windows = path.join(input, "windows");
    if (fs.readdirSync(windows).sort().join("|") !== windowsNames.join("|")) throw new Error("Windows package inventory is incomplete or contains extra files.");
    const receipt = json(path.join(windows, "solcord-installer-build-receipt.json"));
    const build = json(path.join(windows, "solcord-build-manifest.json"));
    const installer = json(path.join(windows, "solcord-installer-manifest.json"));
    if (receipt.kind !== "solcord-installer-build-receipt" || receipt.sourceCommit !== sourceCommit || receipt.sourceClean !== true || receipt.productVersion !== version || receipt.candidateLabel !== candidateLabel
        || receipt.selfTest?.result !== "PASS" || receipt.selfTest.isolatedWorkingDirectory !== true
        || build.kind !== "solcord-post-build-manifest" || build.build?.source?.commit !== sourceCommit || build.build.source.clean !== true || build.build.mode !== "production" || build.build.version !== version || build.build.candidateLabel !== candidateLabel
        || installer.sourceCommit !== sourceCommit || installer.version !== version || installer.candidateLabel !== candidateLabel) throw new Error("Windows package source, version or self-test evidence is invalid.");
    const files = windowsNames.map(name => ({source: path.join(windows, name), receipt: describe(path.join(windows, name))}));
    const recorded = files.filter(file => file.receipt.name !== "solcord-installer-build-receipt.json");
    if (!Array.isArray(receipt.files) || receipt.files.length !== recorded.length) throw new Error("Windows build receipt inventory is invalid.");
    for (const file of recorded) {
        const matches = receipt.files.filter((entry: FileReceipt) => entry.name === file.receipt.name);
        if (matches.length !== 1) throw new Error("Windows receipt has missing or duplicate files.");
        sameFile(file.receipt, matches[0]);
    }
    const core = files.find(file => file.receipt.name === "solcord.asar")!.receipt;
    sameFile(core, build.artifacts?.asar);
    if (installer.artifactSha256 !== core.sha256 || installer.buildManifestSha256 !== files.find(file => file.receipt.name === "solcord-build-manifest.json")!.receipt.sha256) throw new Error("Windows installer manifest is not bound to the core.");
    for (const arch of ["arm64", "x64"]) {
        const directory = path.join(input, `macos-${arch}`), receiptFile = path.join(directory, "macos-package-receipt.json");
        const mac = json(receiptFile), zipName = `Solcord-macOS-${arch}-${candidateLabel}.zip`;
        if (mac.schemaVersion !== 1 || mac.sourceCommit !== sourceCommit || mac.version !== version || mac.candidateLabel !== candidateLabel || mac.arch !== arch || mac.platform !== "darwin" || mac.stageOnly !== false
            || mac.preview !== true || mac.notarized !== false || mac.zip?.file !== zipName || mac.nativeValidation?.matchingArchitecture !== true || mac.nativeValidation.cliSignatureVerified !== true || mac.nativeValidation.compiledSelfTest !== "PASS") throw new Error(`macOS ${arch} native package evidence is invalid.`);
        if (mac.officialBundleValidation?.passed !== true || mac.officialBundleValidation.sourceCommit !== sourceCommit || mac.officialBundleValidation.arch !== arch || mac.officialBundleValidation.packageZipSha256 !== mac.zip.sha256 || mac.officialBundleValidation.originalPreserved !== true || mac.officialBundleValidation.launchedDiscord !== false) throw new Error(`macOS ${arch} official Discord bundle validation is missing.`);
        const source = path.join(directory, zipName), zip = describe(source);
        sameFile(zip, mac.zip);
        files.push({source, receipt: zip}, {source: receiptFile, receipt: describe(receiptFile, `solcord-macos-${arch}-build-receipt.json`)});
    }
    return files.sort((a, b) => a.receipt.name.localeCompare(b.receipt.name, "en"));
}

export function prepareRelease(input: string, output: string, sourceCommit: string): void {
    if (fs.existsSync(output)) throw new Error("Release output must be a new directory.");
    const files = collectReleaseFiles(path.resolve(input), sourceCommit);
    const repo = path.resolve(import.meta.dir, ".."), evidence = path.join(repo, `docs/releases/${SOLCORD_PRODUCT_IDENTITY.numericVersion}-performance.json`);
    const performance = json(evidence);
    if (performance.schemaVersion !== 1 || performance.status !== "complete" || performance.soak?.pass !== true || performance.soak.elapsedMs < 1_800_000 || performance.soak.failures !== 0
        || performance.controlledUi?.pass !== true || performance.controlledUi.failures !== 0 || !Array.isArray(performance.sourceHashes) || performance.sourceHashes.length < 1) throw new Error("Completed soak and UI qualification are required.");
    for (const entry of performance.sourceHashes) {
        if (typeof entry.path !== "string" || !/^(?:src|scripts|tests|assets)\/[A-Za-z0-9_./-]+$/.test(entry.path) || entry.path.split("/").includes("..") || !/^[a-f0-9]{64}$/.test(entry.canonicalSha256)) throw new Error("Invalid qualification source identity.");
        const source = path.join(repo, entry.path); describe(source);
        const hash = createHash("sha256").update(fs.readFileSync(source, "utf8").replaceAll("\r\n", "\n")).digest("hex");
        if (hash !== entry.canonicalSha256) throw new Error(`Measured source changed and must be requalified: ${entry.path}`);
    }
    files.push({source: evidence, receipt: describe(evidence, "solcord-performance.json")});
    files.sort((a, b) => a.receipt.name.localeCompare(b.receipt.name, "en"));
    fs.mkdirSync(output, {recursive: true});
    for (const file of files) {
        const target = path.join(output, file.receipt.name);
        fs.copyFileSync(file.source, target, fs.constants.COPYFILE_EXCL);
        sameFile(describe(target), file.receipt);
    }
    const manifest = {schemaVersion: 1, kind: "solcord-release-package", sourceCommit, candidateLabel: SOLCORD_PRODUCT_IDENTITY.candidateLabel, windows: SOLCORD_PRODUCT_IDENTITY.candidateLabel.includes("-") ? "unsigned-prerelease" : "unsigned-stable", macos: "preview-not-notarized", files: files.map(file => file.receipt)};
    fs.writeFileSync(path.join(output, "release-package.json"), JSON.stringify(manifest, null, 2) + "\n", {flag: "wx"});
    const entries = fs.readdirSync(output).sort().map(name => describe(path.join(output, name)));
    fs.writeFileSync(path.join(output, "RELEASE-SHA256SUMS.txt"), entries.map(file => `${file.sha256}  ${file.name}`).join("\n") + "\n", {flag: "wx"});
    const notes = fs.readFileSync(path.join(import.meta.dir, `../docs/releases/${SOLCORD_PRODUCT_IDENTITY.numericVersion}.md`), "utf8").replace(/\]\((?![a-z][a-z0-9+.-]*:|\/|#)([^)\s]+)\)/gi, (_, target: string) => `](https://github.com/celubos/Solcord/blob/${sourceCommit}/${path.posix.normalize(path.posix.join("docs/releases", target))})`);
    fs.writeFileSync(path.join(output, "release-notes.md"), `${notes}\nSource: [${sourceCommit}](https://github.com/celubos/Solcord/commit/${sourceCommit}).\n`, {flag: "wx"});
}

if (import.meta.main) {
    const [input, output, sourceCommit] = process.argv.slice(2);
    if (!input || !output || !sourceCommit) throw new Error("Usage: prepare-solcord-release.ts <downloaded-packages> <new-output-directory> <source-commit>");
    prepareRelease(input, output, sourceCommit);
    console.log("Release package provenance and native validation passed.");
}
