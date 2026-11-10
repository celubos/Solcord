// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import * as asar from "@electron/asar";
import {macHash, type MacPackageManifest} from "../installer/macos/engine";
import type {SolcordPostBuildManifest} from "./helpers/build-provenance";

const [artifactInput, outputInput, sourceCommit, ...options] = process.argv.slice(2);
const repo = path.resolve(import.meta.dir, "..");
const archOption = options.find(option => option.startsWith("--arch="))?.slice(7) ?? process.arch;
const stageOnly = options.includes("--stage-only");
if (!artifactInput || !outputInput || !/^[a-f0-9]{40}$/.test(sourceCommit ?? "") || !["arm64", "x64"].includes(archOption) || options.some(option => option !== "--stage-only" && !["--arch=arm64", "--arch=x64"].includes(option))) throw Error("Usage: bun scripts/build-solcord-macos-installer.ts <dist/solcord.asar> <new-output-directory> <40-char-source-commit> [--arch=arm64|x64] [--stage-only]");
if (process.platform !== "darwin" && !stageOnly) throw Error("Native macOS ZIP/signature packaging requires macOS. Use --stage-only for cross-compilation.");
if (!stageOnly && process.arch !== archOption) throw Error("Publishing requires a matching native macOS architecture and a compiled self-test.");
const artifact = path.resolve(artifactInput), output = path.resolve(outputInput);
if (artifact !== path.join(repo, "dist", "solcord.asar") || fs.existsSync(output) || !path.relative(repo, output).startsWith(`..${path.sep}`)) throw Error("Use authoritative dist/solcord.asar and a new output folder outside the repository.");
const git = (args: string[]) => execFileSync("git", args, {cwd: repo, encoding: "utf8", windowsHide: true}).trim();
if (git(["rev-parse", "HEAD"]) !== sourceCommit || git(["status", "--porcelain=v1", "--untracked-files=all"])) throw Error("macOS packaging requires the exact clean source commit.");
const buildFile = path.join(repo, "dist", "solcord-build-manifest.json");
const build = JSON.parse(fs.readFileSync(buildFile, "utf8")) as SolcordPostBuildManifest;
if (build.schemaVersion !== 2 || build.build?.source.commit !== sourceCommit || build.build.source.clean !== true || build.build.mode !== "production"
    || !/^\d+\.\d+\.\d+$/.test(build.build.version) || !/^v\d+\.\d+\.\d+(?:-[a-z0-9][a-z0-9.-]*)?$/i.test(build.build.candidateLabel)
    || build.artifacts.asar.sha256 !== macHash(artifact) || build.artifacts.asar.bytes !== fs.statSync(artifact).size
    || JSON.stringify(JSON.parse(asar.extractFile(artifact, "build-provenance.json").toString("utf8"))) !== JSON.stringify(build.build)) throw Error("The packaged ASAR is not bound to this clean production source.");
fs.mkdirSync(output, {recursive: true});
const name = `Solcord-macOS-${archOption}-${build.build.candidateLabel}`, folder = path.join(output, name); fs.mkdirSync(folder);
fs.copyFileSync(artifact, path.join(folder, "solcord.asar"), fs.constants.COPYFILE_EXCL);
fs.copyFileSync(buildFile, path.join(folder, "solcord-build-manifest.json"), fs.constants.COPYFILE_EXCL);
const manifest: MacPackageManifest = {schemaVersion: 1, kind: "solcord-macos-preview", version: build.build.version, candidateLabel: build.build.candidateLabel, sourceCommit, artifact: {file: "solcord.asar", sha256: macHash(artifact), bytes: fs.statSync(artifact).size}, buildManifestSha256: macHash(buildFile)};
const manifestFile = path.join(folder, "solcord-macos-manifest.json"); fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n", {flag: "wx"});
const executable = path.join(folder, "solcord-macos");
execFileSync(process.execPath, ["build", path.join(repo, "installer", "macos", "cli.ts"), "--compile", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig", "--no-compile-autoload-tsconfig", "--no-compile-autoload-package-json", `--target=bun-darwin-${archOption}`, `--outfile=${executable}`, "--define", `process.env.SOLCORD_MACOS_PACKAGE_SHA256=${JSON.stringify(macHash(manifestFile))}`], {cwd: repo, stdio: "inherit", windowsHide: true});
fs.copyFileSync(path.join(repo, "docs", "MACOS.md"), path.join(folder, "README.md"));
let selfTest: Record<string, unknown> | null = null;
if (process.platform === "darwin" && !stageOnly) {
    execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", "--preserve-metadata=entitlements,flags,runtime", executable], {stdio: "inherit"});
    execFileSync("/usr/bin/codesign", ["--verify", "--strict", executable], {stdio: "inherit"});
    execFileSync(executable, ["--help"], {stdio: "inherit"});
    selfTest = JSON.parse(execFileSync(executable, ["--self-test"], {encoding: "utf8", timeout: 300_000, maxBuffer: 4 * 1024 * 1024}));
    if (selfTest?.kind !== "solcord-macos-native-self-test" || selfTest.passed !== true || selfTest.arch !== archOption || selfTest.sourceCommit !== sourceCommit
        || selfTest.version !== manifest.version || selfTest.candidateLabel !== manifest.candidateLabel || selfTest.artifactSha256 !== manifest.artifact.sha256
        || ["originalPreserved", "profilesPreserved", "attributesPreserved", "entitlementsPreserved", "recoveryVerified"].some(field => selfTest?.[field] !== true) || selfTest.launchedDiscord !== false) throw Error("The compiled native macOS self-test failed.");
    execFileSync("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", folder, path.join(output, `${name}.zip`)], {stdio: "inherit"});
}
const files = fs.readdirSync(folder).sort().map(file => ({file, bytes: fs.statSync(path.join(folder, file)).size, sha256: macHash(path.join(folder, file))}));
const zipFile = path.join(output, `${name}.zip`);
const zip = selfTest ? {file: path.basename(zipFile), bytes: fs.statSync(zipFile).size, sha256: macHash(zipFile)} : null;
if (git(["rev-parse", "HEAD"]) !== sourceCommit || git(["status", "--porcelain=v1", "--untracked-files=all"])) throw Error("Source changed during packaging; this output must not be published.");
fs.writeFileSync(path.join(output, "macos-package-receipt.json"), JSON.stringify({schemaVersion: 1, preview: true, notarized: false, sourceCommit, version: manifest.version, candidateLabel: manifest.candidateLabel, arch: archOption, platform: process.platform, stageOnly, manifestSha256: macHash(manifestFile), files, zip, nativeValidation: {matchingArchitecture: selfTest !== null, cliSignatureVerified: selfTest !== null, compiledSelfTest: selfTest ? "PASS" : "NOT_RUN"}, selfTest}, null, 2) + "\n");
console.log(`macOS preview package ready: ${folder}`);
