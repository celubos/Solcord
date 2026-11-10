// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {execFileSync} from "node:child_process";
import {MacInstaller, macBundleHash, macHash, readMacPackage} from "../installer/macos/engine";
import {createMacNativeAdapter} from "../installer/macos/native";

type MacArch = "arm64" | "x64";
const MAX_DMG_BYTES = 512 * 1024 * 1024;
export function isOfficialMacDownloadURL(value: string, arch: MacArch): boolean {
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash) return false;
        if (url.hostname === "discord.com") {
            if (url.pathname === "/api/download") return [...url.searchParams].length === 1 && url.searchParams.get("platform") === "osx";
            return url.pathname === "/api/downloads/distributions/app/installers/latest" && [...url.searchParams].length === 3
                && url.searchParams.get("platform") === "osx" && url.searchParams.get("channel") === "stable" && url.searchParams.get("arch") === arch;
        }
        return url.hostname === "stable.dl2.discordapp.net" && url.search === ""
            && /^\/distro\/app\/stable\/osx\/(?:universal|arm64|x64)\/\d+\.\d+\.\d+\/Discord\.dmg$/.test(url.pathname);
    }
    catch {return false;}
}
export async function downloadOfficialMacDMG(destination: string, arch: MacArch, options: {fetcher?: (url: string, options: RequestInit) => Promise<Response>; maximumBytes?: number;} = {}) {
    const maximumBytes = Math.min(MAX_DMG_BYTES, Math.max(1, options.maximumBytes ?? MAX_DMG_BYTES));
    const fetcher = options.fetcher ?? ((url: string, init: RequestInit) => fetch(url, init));
    let url = `https://discord.com/api/downloads/distributions/app/installers/latest?arch=${arch}&channel=stable&platform=osx`;
    const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 240_000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
        for (let redirects = 0; redirects <= 4; redirects++) {
            if (!isOfficialMacDownloadURL(url, arch)) throw Error("The official Discord download left its verified URL allowlist.");
            const response = await fetcher(url, {credentials: "omit", redirect: "manual", signal: abort.signal, headers: {"Accept-Encoding": "identity"}});
            if ([301, 302, 303, 307, 308].includes(response.status)) {
                const location = response.headers.get("location"); await response.body?.cancel();
                if (!location || redirects === 4) throw Error("The official Discord download exceeded its redirect limit.");
                url = new URL(location, url).href; continue;
            }
            if (response.status !== 200) {await response.body?.cancel(); throw Error(`The official Discord download returned HTTP ${response.status}.`);}
            if (!response.body) throw Error("The official Discord image is empty.");
            if (Number(response.headers.get("content-length") ?? 0) > maximumBytes) {await response.body.cancel(); throw Error("The official Discord image exceeds its byte limit.");}
            reader = response.body.getReader();
            const handle = fs.openSync(destination, "wx", 0o600), hash = crypto.createHash("sha256"); let bytes = 0;
            try {
                for (;;) {
                    const part = await reader.read(); if (part.done) break;
                    bytes += part.value.byteLength;
                    if (bytes > maximumBytes) throw Error("The official Discord image exceeds its streamed byte limit.");
                    const buffer = Buffer.from(part.value); hash.update(buffer);
                    for (let offset = 0; offset < buffer.length;) {const count = fs.writeSync(handle, buffer, offset, buffer.length - offset); if (!count) throw Error("The image write did not advance."); offset += count;}
                }
                fs.fsyncSync(handle);
            }
            finally {fs.closeSync(handle);}
            if (!bytes) throw Error("The official Discord image is empty.");
            return {url, bytes, sha256: hash.digest("hex")};
        }
        throw Error("The official Discord image could not be resolved.");
    }
    finally {clearTimeout(timeout); abort.abort(); await reader?.cancel().catch(() => {}); reader?.releaseLock();}
}

interface PackageReceipt {
    schemaVersion: number; preview: boolean; notarized: boolean; sourceCommit: string; version: string; candidateLabel: string;
    arch: MacArch; platform: string; stageOnly: boolean; manifestSha256: string;
    zip: {file: string; bytes: number; sha256: string;};
    nativeValidation: {matchingArchitecture: boolean; cliSignatureVerified: boolean; compiledSelfTest: string;};
    officialBundleValidation?: unknown;
}
export async function verifyOfficialMacPackage(outputInput: string, reportInput: string): Promise<void> {
    if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch)) throw Error("Official bundle validation requires a native macOS runner.");
    const repo = path.resolve(import.meta.dir, ".."), output = fs.realpathSync(outputInput), reportDirectory = path.resolve(reportInput);
    const git = (args: string[]) => execFileSync("git", args, {cwd: repo, encoding: "utf8"}).trim();
    if (fs.existsSync(reportDirectory) || !path.relative(repo, reportDirectory).startsWith(`..${path.sep}`)) throw Error("Use a new evidence directory outside the source checkout.");
    const receiptFile = path.join(output, "macos-package-receipt.json"), receiptHash = macHash(receiptFile);
    if (fs.statSync(receiptFile).size > 1024 * 1024) throw Error("The package receipt is too large.");
    const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8")) as PackageReceipt;
    if (receipt.schemaVersion !== 1 || !receipt.preview || receipt.notarized || receipt.stageOnly || receipt.platform !== "darwin" || receipt.arch !== process.arch
        || !/^[a-f0-9]{40}$/.test(receipt.sourceCommit) || !/^\d+\.\d+\.\d+$/.test(receipt.version) || !/^v\d+\.\d+\.\d+(?:-[a-z0-9][a-z0-9.-]*)?$/i.test(receipt.candidateLabel)
        || !receipt.nativeValidation?.matchingArchitecture || !receipt.nativeValidation.cliSignatureVerified || receipt.nativeValidation.compiledSelfTest !== "PASS" || receipt.officialBundleValidation !== undefined) throw Error("A fresh matching native package and compiled self-test are required.");
    if (git(["rev-parse", "HEAD"]) !== receipt.sourceCommit || git(["status", "--porcelain=v1", "--untracked-files=all"])) throw Error("The official check requires the package's exact clean source commit.");
    const name = `Solcord-macOS-${receipt.arch}-${receipt.candidateLabel}`, zip = path.join(output, `${name}.zip`);
    if (receipt.zip?.file !== `${name}.zip` || fs.statSync(zip).size !== receipt.zip.bytes || macHash(zip) !== receipt.zip.sha256) throw Error("The package ZIP changed before official-bundle verification.");
    const {manifest, artifact} = readMacPackage(path.join(output, name), receipt.manifestSha256);
    if (manifest.sourceCommit !== receipt.sourceCommit || manifest.version !== receipt.version || manifest.candidateLabel !== receipt.candidateLabel) throw Error("Package identities do not match.");
    fs.mkdirSync(reportDirectory, {recursive: true});
    const temporary = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "solcord-official-macos-"));
    const image = path.join(temporary, "Discord.dmg"), mount = path.join(temporary, "readonly-mount"), home = path.join(temporary, "disposable-home");
    fs.mkdirSync(mount); fs.mkdirSync(home); let mounted = false, mountAttempted = false, detached = false, failure: unknown;
    let downloaded: Awaited<ReturnType<typeof downloadOfficialMacDMG>> | undefined;
    let originalPreserved = false, lifecycleVerified = false;
    const command = (file: string, args: string[], input?: string) => execFileSync(file, args, {encoding: "utf8", input, timeout: 240_000, maxBuffer: 4 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"]});
    const plistJSON = (text: string) => JSON.parse(command("/usr/bin/plutil", ["-convert", "json", "-o", "-", "-"], text)) as {"system-entities"?: Array<{"mount-point"?: string;}>;};
    try {
        downloaded = await downloadOfficialMacDMG(image, receipt.arch);
        mountAttempted = true;
        const attached = command("/usr/bin/hdiutil", ["attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mount, "-plist", image]);
        if (!plistJSON(attached)["system-entities"]?.some(entity => entity["mount-point"] === mount)) throw Error("The image did not mount at the exact owned mount point.");
        mounted = true;
        const source = path.join(mount, "Discord.app"), native = createMacNativeAdapter(path.join(home, "Applications", "Solcord"));
        native.verifySource(source, "stable"); const original = macBundleHash(source);
        const profile = path.join(home, "Library", "Application Support", "discord", "profile-sentinel"), addons = path.join(home, "Library", "Application Support", "BetterDiscord", "plugins", "owner-sentinel");
        for (const file of [profile, addons]) {fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, "unchanged-private-fixture");}
        const installer = new MacInstaller(home, "stable", native);
        installer.install(source, manifest, artifact); installer.verify();
        installer.install(source, manifest, artifact); installer.verify();
        installer.rollback(); installer.verify();
        installer.uninstall();
        native.verifySource(source, "stable");
        originalPreserved = original === macBundleHash(source);
        if (!originalPreserved || fs.existsSync(installer.target) || [profile, addons].some(file => fs.readFileSync(file, "utf8") !== "unchanged-private-fixture")) throw Error("Official-bundle validation changed its source or disposable profile sentinels.");
        lifecycleVerified = true;
    }
    catch (error) {failure = error;}
    finally {
        if (mountAttempted) {
            try {command("/usr/bin/hdiutil", ["detach", mount]); detached = true;}
            catch (error) {failure = failure ? new AggregateError([failure, error], "Validation and exact mount cleanup failed.") : error;}
        }
    }
    const report = {kind: "solcord-macos-official-bundle-validation",
passed: !failure && lifecycleVerified,
sourceCommit: receipt.sourceCommit,
version: receipt.version,
arch: receipt.arch,
packageZipSha256: receipt.zip.sha256,
        originalPreserved,
profilesPreserved: lifecycleVerified,
lifecycle: ["install", "verify", "repair", "rollback", "uninstall"],
launchedDiscord: false,
readOnlyMount: mounted,
exactMountDetached: detached,
        download: downloaded,
failure: failure instanceof Error ? failure.message : failure ? "Unknown validation failure" : null};
    const reportFile = path.join(reportDirectory, "official-bundle-validation.json"); fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n", {flag: "wx"});
    if (failure) throw failure;
    if (macHash(receiptFile) !== receiptHash || macHash(zip) !== receipt.zip.sha256 || git(["rev-parse", "HEAD"]) !== receipt.sourceCommit || git(["status", "--porcelain=v1", "--untracked-files=all"])) throw Error("Source or package changed during official-bundle verification; no successful receipt was written.");
    receipt.officialBundleValidation = {...report, reportSha256: macHash(reportFile)};
    const staging = path.join(output, `.official-validation-${crypto.randomUUID()}.tmp`);
    const handle = fs.openSync(staging, "wx", 0o600);
    try {fs.writeFileSync(handle, JSON.stringify(receipt, null, 2) + "\n"); fs.fsyncSync(handle);}
    finally {fs.closeSync(handle);}
    fs.renameSync(staging, receiptFile);
    console.log(`Official Discord macOS ${receipt.arch}: copy/sign/verify/repair/rollback/uninstall PASS; no launch.`);
}
if (import.meta.main) {
    const [output, report] = process.argv.slice(2);
    if (!output || !report || process.argv.length !== 4) throw Error("Usage: bun scripts/verify-solcord-macos-official.ts <package-output-directory> <new-evidence-directory>");
    await verifyOfficialMacPackage(output, report);
}
