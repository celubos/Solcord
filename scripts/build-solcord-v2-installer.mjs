// SPDX-License-Identifier: Apache-2.0

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import * as asar from "@electron/asar";
import {SOLCORD_PRODUCT_IDENTITY} from "../src/common/solcord/product-identity.ts";
import {publishGeneratedDirectory} from "./helpers/publish-directory.mjs";
import {hashFile} from "./helpers/streaming-hash.mjs";

const [artifactInput, outputInput, sourceCommit] = process.argv.slice(2);
if (!artifactInput || !outputInput || !/^[0-9a-f]{40}$/.test(sourceCommit ?? "")) {
    throw new Error("Usage: bun scripts/build-solcord-v2-installer.mjs <dist/solcord.asar> <new-output-directory> <40-char-source-commit>");
}

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifact = path.resolve(artifactInput);
const output = path.resolve(outputInput);
const outputParent = path.dirname(output);
const outputName = path.basename(output);
const relativeOutput = path.relative(repo, output);
if (artifact !== path.join(repo, "dist", "solcord.asar")) throw new Error("The installer accepts only the repository's authoritative dist/solcord.asar.");
if (fs.existsSync(output)) throw new Error("The installer output directory must not already exist.");
if (!outputName || outputParent === output || relativeOutput === "" || (!relativeOutput.startsWith(`..${path.sep}`) && relativeOutput !== ".." && !path.isAbsolute(relativeOutput))) throw new Error("Installer artifacts must be generated outside the source checkout.");

const gitText = args => {
    const result = spawnSync("git", args, {cwd: repo, encoding: "utf8", windowsHide: true});
    if (result.status !== 0) throw new Error("The installer builder could not verify Git provenance.");
    return result.stdout.trim();
};
const requireRegularFile = (file, maximumBytes, message) => {
    if (!fs.existsSync(file)) throw new Error(message);
    const entry = fs.lstatSync(file);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size <= 0 || entry.size > maximumBytes) throw new Error(message);
};
const removeGeneratedDirectory = (directory, parent, prefix) => {
    if (!fs.existsSync(directory)) return;
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(parent) || !path.basename(resolved).startsWith(prefix)) throw new Error("Refusing to clean an unexpected installer build directory.");
    const entry = fs.lstatSync(resolved);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Refusing to clean a linked installer build directory.");
    fs.rmSync(resolved, {recursive: true});
};

const head = gitText(["rev-parse", "HEAD"]).toLowerCase();
if (head !== sourceCommit || gitText(["status", "--porcelain=v1", "--untracked-files=all"])) throw new Error("The installer requires the exact clean source commit supplied on the command line.");
const dist = path.join(repo, "dist");
if (fs.existsSync(dist)) {
    const entry = fs.lstatSync(dist);
    if (!entry.isDirectory() || entry.isSymbolicLink() || path.dirname(dist) !== repo) throw new Error("The Solcord dist path is unsafe.");
    fs.rmSync(dist, {recursive: true});
}
const freshBuild = spawnSync(process.execPath, ["run", "dist"], {cwd: repo, stdio: "inherit", windowsHide: true});
if (freshBuild.status !== 0) throw new Error(`Fresh Solcord production build failed with status ${freshBuild.status}.`);

requireRegularFile(artifact, 256 * 1024 * 1024, "The freshly built Solcord ASAR is missing or unsafe.");
const sourceBuildManifest = path.join(dist, "solcord-build-manifest.json");
requireRegularFile(sourceBuildManifest, 256 * 1024, "The authoritative Solcord build manifest is missing or unsafe.");
const postBuild = JSON.parse(fs.readFileSync(sourceBuildManifest, "utf8"));
const artifactHash = hashFile(artifact);
const artifactBytes = fs.statSync(artifact).size;
if (postBuild?.schemaVersion !== 2
    || postBuild?.kind !== "solcord-post-build-manifest"
    || postBuild?.build?.product !== "Solcord"
    || postBuild?.build?.version !== SOLCORD_PRODUCT_IDENTITY.numericVersion
    || postBuild?.build?.candidateLabel !== SOLCORD_PRODUCT_IDENTITY.candidateLabel
    || !["production", "release"].includes(postBuild?.build?.mode)
    || postBuild?.build?.source?.clean !== true
    || postBuild?.build?.source?.commit !== sourceCommit
    || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(postBuild?.build?.version ?? "")
    || postBuild?.artifacts?.asar?.file !== "solcord.asar"
    || postBuild?.artifacts?.asar?.sha256 !== artifactHash
    || postBuild?.artifacts?.asar?.bytes !== artifactBytes) throw new Error("The ASAR is not bound to the requested clean production source commit.");
const embeddedProvenance = JSON.parse(asar.extractFile(artifact, "build-provenance.json").toString("utf8"));
if (JSON.stringify(embeddedProvenance) !== JSON.stringify(postBuild.build)) throw new Error("The ASAR's embedded provenance does not match the authoritative build manifest.");
const sourceBuildManifestHash = hashFile(sourceBuildManifest);

fs.mkdirSync(outputParent, {recursive: true});
const staging = path.join(outputParent, `.${outputName}.staging-${crypto.randomBytes(12).toString("hex")}`);
const inputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "solcord-installer-input-"));
const validationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "solcord-installer-validation-"));
let published = false;
try {
    fs.mkdirSync(staging, {recursive: false});
    const stagedArtifact = path.join(inputRoot, "solcord.asar");
    const stagedBuildManifest = path.join(inputRoot, "solcord-build-manifest.json");
    fs.copyFileSync(artifact, stagedArtifact, fs.constants.COPYFILE_EXCL);
    fs.copyFileSync(sourceBuildManifest, stagedBuildManifest, fs.constants.COPYFILE_EXCL);
    if (hashFile(stagedArtifact) !== artifactHash || hashFile(stagedBuildManifest) !== sourceBuildManifestHash) throw new Error("The private installer inputs differ from the fresh build.");
    const manifest = {
        version: postBuild.build.version,
        candidateLabel: postBuild.build.candidateLabel,
        sourceCommit,
        artifactSha256: artifactHash,
        artifactFile: "solcord.asar",
        buildManifestSha256: sourceBuildManifestHash,
        schemaVersion: 7,
        supportedDiscord: "Stable/PTB/Canary; one managed channel at a time; exact target shown at runtime",
        releaseNotes: `Solcord ${postBuild.build.candidateLabel}, an unsigned ${postBuild.build.candidateLabel === `v${postBuild.build.version}` ? "stable release" : "prerelease validation candidate"}. Install, Update, Repair, Roll Back, Uninstall, Verify, and Launch are separate explicit actions.`
    };
    const stagedInstallerManifest = path.join(inputRoot, "solcord-installer-manifest.json");
    fs.writeFileSync(stagedInstallerManifest, `${JSON.stringify(manifest, null, 2)}\n`, {encoding: "utf8", flag: "wx"});

    const project = path.join(repo, "installer", "Solcord.Installer", "Solcord.Installer.csproj");
    const restoreGraph = path.join(path.dirname(project), "obj", "project.assets.json");
    const restoreGraphHash = fs.existsSync(restoreGraph) ? hashFile(restoreGraph) : undefined;
    const publish = spawnSync("dotnet", [
        "publish", project,
        "-c", "Release",
        "-r", "win-x64",
        "--self-contained", "true",
        "-p:PublishSingleFile=true",
        "-p:IncludeNativeLibrariesForSelfExtract=true",
        "-p:PublishTrimmed=false",
        "-p:SolcordRequireEmbeddedBundle=true",
        `-p:SolcordEmbeddedArtifact=${stagedArtifact}`,
        `-p:SolcordEmbeddedBuildManifest=${stagedBuildManifest}`,
        `-p:SolcordEmbeddedInstallerManifest=${stagedInstallerManifest}`,
        "-o", staging
    ], {stdio: "inherit", windowsHide: true});
    let publishStatus = publish.status;
    if (publishStatus !== 0) {
        // Some repaired .NET 9 Windows installations fail inside the CLI's workload
        // inventory before `dotnet publish` reaches MSBuild. The SDK's direct MSBuild
        // entry point does not need that unrelated inventory, so retry the same
        // publish target through the exact SDK selected by `dotnet --version`.
        const selectedSdk = spawnSync("dotnet", ["--version"], {encoding: "utf8", windowsHide: true});
        const locatedHost = spawnSync("where.exe", ["dotnet"], {encoding: "utf8", windowsHide: true});
        const sdkVersion = selectedSdk.status === 0 ? selectedSdk.stdout.trim() : "";
        const dotnetHost = locatedHost.status === 0 ? locatedHost.stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean) : undefined;
        if (!/^\d+\.\d+\.\d+$/.test(sdkVersion) || !dotnetHost || !path.isAbsolute(dotnetHost) || path.basename(dotnetHost).toLowerCase() !== "dotnet.exe") {
            throw new Error(`dotnet publish failed with status ${publishStatus}, and the selected SDK could not be verified for a direct retry.`);
        }
        requireRegularFile(dotnetHost, 1024 * 1024, "The selected dotnet host is missing or unsafe.");
        const msbuild = path.join(path.dirname(dotnetHost), "sdk", sdkVersion, "MSBuild.dll");
        requireRegularFile(msbuild, 32 * 1024 * 1024, "The selected SDK MSBuild entry point is missing or unsafe.");
        if (!restoreGraphHash) throw new Error("The direct SDK retry requires an existing verified installer restore graph.");
        requireRegularFile(restoreGraph, 1024 * 1024, "The existing installer restore graph is missing or unsafe.");
        if (hashFile(restoreGraph) !== restoreGraphHash) throw new Error("The existing installer restore graph changed during the failed CLI publish.");
        const restored = JSON.parse(fs.readFileSync(restoreGraph, "utf8"));
        const restoredProject = restored?.project?.restore?.projectPath;
        const restoredTargets = Object.keys(restored?.targets ?? {});
        if (restored?.version !== 3
            || typeof restoredProject !== "string"
            || path.resolve(restoredProject).toLowerCase() !== project.toLowerCase()
            || !restoredTargets.some(target => target.endsWith("/win-x64"))) {
            throw new Error("The existing installer restore graph is not bound to this project and runtime.");
        }
        const directPublish = spawnSync(dotnetHost, [
            msbuild,
            project,
            "-target:Publish",
            "-property:Configuration=Release",
            "-property:RuntimeIdentifier=win-x64",
            "-property:SelfContained=true",
            "-property:PublishSingleFile=true",
            "-property:IncludeNativeLibrariesForSelfExtract=true",
            "-property:PublishTrimmed=false",
            "-property:MSBuildEnableWorkloadResolver=false",
            "-property:SolcordRequireEmbeddedBundle=true",
            `-property:SolcordEmbeddedArtifact=${stagedArtifact}`,
            `-property:SolcordEmbeddedBuildManifest=${stagedBuildManifest}`,
            `-property:SolcordEmbeddedInstallerManifest=${stagedInstallerManifest}`,
            `-property:PublishDir=${staging}${path.sep}`
        ], {stdio: "inherit", windowsHide: true});
        publishStatus = directPublish.status;
    }
    if (publishStatus !== 0) throw new Error(`dotnet publish failed with status ${publishStatus}.`);
    if (gitText(["rev-parse", "HEAD"]).toLowerCase() !== sourceCommit || gitText(["status", "--porcelain=v1", "--untracked-files=all"])) throw new Error("The source changed while the installer was being built.");
    if (hashFile(artifact) !== artifactHash || hashFile(sourceBuildManifest) !== sourceBuildManifestHash || hashFile(stagedArtifact) !== artifactHash || hashFile(stagedBuildManifest) !== sourceBuildManifestHash) throw new Error("Fresh build output changed while the installer was being built, or its private staging copy no longer matches.");

    const entries = fs.readdirSync(staging, {withFileTypes: true});
    if (entries.length !== 1 || !entries[0].isFile() || entries[0].name !== "SolcordInstaller.exe") throw new Error("The published installer is not a single executable.");
    const executable = path.join(staging, "SolcordInstaller.exe");
    const selfTest = spawnSync(executable, ["--self-test"], {stdio: "inherit", cwd: validationRoot, windowsHide: true});
    if (selfTest.status !== 0) throw new Error(`Embedded-resource installer self-test failed with status ${selfTest.status}.`);
    if (fs.readdirSync(validationRoot).length !== 0) throw new Error("The installer self-test unexpectedly relied on or left files in its empty working directory.");

    const publishedFiles = [
        [stagedArtifact, "solcord.asar"],
        [stagedBuildManifest, "solcord-build-manifest.json"],
        [stagedInstallerManifest, "solcord-installer-manifest.json"]
    ];
    for (const [source, name] of publishedFiles) fs.copyFileSync(source, path.join(staging, name), fs.constants.COPYFILE_EXCL);
    const checksumNames = ["SolcordInstaller.exe", ...publishedFiles.map(([, name]) => name)];
    const checkedHashes = new Map(checksumNames.map(name => [name, hashFile(path.join(staging, name))]));
    const checksumText = checksumNames.map(name => `${checkedHashes.get(name)}  ${name}`).join("\n");
    fs.writeFileSync(path.join(staging, "SHA256SUMS.txt"), `${checksumText}\n`, {encoding: "utf8", flag: "wx"});
    const receiptName = "solcord-installer-build-receipt.json";
    const receiptFiles = [...checksumNames, "SHA256SUMS.txt"].sort().map(name => ({
        name,
        bytes: fs.statSync(path.join(staging, name)).size,
        sha256: checkedHashes.get(name) ?? hashFile(path.join(staging, name))
    }));
    const receipt = {
        schemaVersion: 1,
        kind: "solcord-installer-build-receipt",
        product: "Solcord",
        productVersion: postBuild.build.version,
        candidateLabel: postBuild.build.candidateLabel,
        sourceCommit,
        sourceClean: true,
        selfTest: {result: "PASS", isolatedWorkingDirectory: true},
        files: receiptFiles
    };
    fs.writeFileSync(path.join(staging, receiptName), `${JSON.stringify(receipt, null, 2)}\n`, {encoding: "utf8", flag: "wx"});
    const installerReceiptSha256 = hashFile(path.join(staging, receiptName));
    const finalEntries = fs.readdirSync(staging).sort();
    const expectedEntries = [...checksumNames, "SHA256SUMS.txt", receiptName].sort();
    if (JSON.stringify(finalEntries) !== JSON.stringify(expectedEntries)) throw new Error("The release-candidate directory contains an unexpected file set.");

    const publication = await publishGeneratedDirectory(staging, output);
    published = true;
    console.log(JSON.stringify({output, version: postBuild.build.version, candidateLabel: postBuild.build.candidateLabel, sourceCommit, artifactSha256: artifactHash, installerSha256: hashFile(path.join(output, "SolcordInstaller.exe")), installerReceiptFile: receiptName, installerReceiptSha256, embeddedResources: "PASS", selfTest: "PASS", publicationAttempts: publication.attempts, releaseFiles: finalEntries}, null, 2));
} finally {
    removeGeneratedDirectory(inputRoot, os.tmpdir(), "solcord-installer-input-");
    removeGeneratedDirectory(validationRoot, os.tmpdir(), "solcord-installer-validation-");
    if (!published) removeGeneratedDirectory(staging, outputParent, `.${outputName}.staging-`);
}
