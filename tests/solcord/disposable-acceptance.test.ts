// SPDX-License-Identifier: Apache-2.0

import crypto from "crypto";
import {spawnSync} from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {runInNewContext} from "vm";
import asar from "@electron/asar";
import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {finishSolcordAsar} from "../../scripts/helpers/finish-asar";
import {solcordLocalAssets} from "../../scripts/helpers/local-assets";

import {
    createDisposableAcceptanceManifest,
    prepareSolcordDisposableAcceptance,
    renderDisposableAcceptanceShim
} from "../../scripts/prepare-solcord-disposable-acceptance";


interface Fixture {
    root: string;
    sourceApp: string;
    solcordAsar: string;
    solcordSource: string;
    destination: string;
    expectedHash: string;
    expectedSourceCommit: string;
}

const windowsDescribe = process.platform === "win32" ? describe : describe.skip;
const temporaryRoots: string[] = [];
let fixture: Fixture;

function hashBytes(bytes: string | Buffer): string {
    return crypto.createHash("sha256").update(bytes).digest("hex");
}

function refreshArtifactHash(): void {
    fixture.expectedHash = hashBytes(fs.readFileSync(fixture.solcordAsar));
}

function stagingRoots(root: string): string[] {
    return fs.readdirSync(root)
        .filter(entry => entry.startsWith(".solcord-acceptance-stage-"))
        .sort();
}

function executeShim(environment: Record<string, string>, dirname: string): {
    buildInfo: Record<string, unknown> | null;
    environment: Record<string, string>;
    error: Error | null;
    loaded: string[];
    moduleGlobalPaths: string[];
    noAsar: unknown;
    userData: string | null;
} {
    const loaded: string[] = [];
    const mutableEnvironment = {...environment};
    const moduleApi = Object.assign(function FakeModule() {}, {globalPaths: [] as string[]});
    let buildInfo: Record<string, unknown> | null = null;
    let userData: string | null = null;
    const app = {
        on(_event: string, _listener: (...args: unknown[]) => void) {},
        setPath(name: string, value: string) {
            if (name === "userData") userData = value;
        },
        setAsDefaultProtocolClient() {return true;}
    };
    const fakeRequire = (request: string): unknown => {
        if (request === "node:fs") return fs;
        if (request === "node:path") return path;
        if (request === "node:module") return moduleApi;
        if (request === "node:child_process") return {};
        if (request === "electron") return {app};
        if (path.basename(request) === "build_info.json") {
            buildInfo = JSON.parse(fs.readFileSync(request, "utf8")) as Record<string, unknown>;
            return buildInfo;
        }
        loaded.push(request);
        return {};
    };
    moduleApi.prototype.require = function(request: string): unknown {return fakeRequire(request);};
    const module = {exports: {}};
    const fakeProcess: {env: Record<string, string>; noAsar: unknown;} = {env: mutableEnvironment, noAsar: "preserved"};
    let error: Error | null = null;
    try {
        runInNewContext(renderDisposableAcceptanceShim(), {
            __dirname: dirname,
            module,
            exports: module.exports,
            process: fakeProcess,
            require: fakeRequire
        });
    }
    catch (caught) {error = caught instanceof Error ? caught : new Error(String(caught));}
    return {
        buildInfo,
        environment: mutableEnvironment,
        error,
        loaded,
        moduleGlobalPaths: [...moduleApi.globalPaths],
        noAsar: fakeProcess.noAsar,
        userData
    };
}

function snapshotTree(root: string): Record<string, string> {
    const result: Record<string, string> = {};
    const visit = (directory: string): void => {
        for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name))) {
            const absolute = path.join(directory, entry.name);
            const relative = path.relative(root, absolute).replaceAll("\\", "/");
            if (entry.isDirectory()) {
                result[`${relative}/`] = "directory";
                visit(absolute);
            }
            else if (entry.isSymbolicLink()) {
                result[relative] = `link:${fs.readlinkSync(absolute)}`;
            }
            else {
                result[relative] = hashBytes(fs.readFileSync(absolute));
            }
        }
    };
    visit(root);
    return result;
}

function validBuildProvenance(sourceCommit: string): Record<string, unknown> {
    const digest = "1".repeat(64);
    return {
        schemaVersion: 2,
        kind: "solcord-build-provenance",
        product: "Solcord",
        version: "1.0.0-test",
        candidateLabel: "v1.0.0-test-rc.0",
        mode: "production",
        buildLabel: "production-clean",
        buildTimestamp: "2026-08-23T00:00:00.000Z",
        modules: ["earlyRenderer", "editor", "editorHtml", "editorPreload", "main", "preload", "solcord"],
        source: {
            commit: sourceCommit,
            branch: "fork/scaffold-baseline",
            clean: true,
            digest,
            statusDigest: hashBytes("")
        },
        inputs: {
            lockfile: {file: "bun.lock", sha256: digest},
            toolchain: {
                bunVersion: "1.2.20",
                bunExecutableSha256: digest,
                packageJsonSha256: digest,
                buildScriptSha256: digest,
                packScriptSha256: digest
            }
        }
    };
}

function writeSolcordSource(source: string, provenance: Record<string, unknown>): void {
    fs.rmSync(source, {recursive: true, force: true});
    fs.mkdirSync(path.join(source, "editor"), {recursive: true});
    fs.writeFileSync(path.join(source, "package.json"), JSON.stringify({name: "solcord", main: "main.js"}));
    fs.writeFileSync(path.join(source, "build-provenance.json"), JSON.stringify(provenance));
    fs.writeFileSync(path.join(source, "main.js"), "module.exports = {};\n");
    fs.writeFileSync(path.join(source, "preload.js"), "module.exports = {};\n");
    fs.writeFileSync(path.join(source, "earlyRenderer.js"), "module.exports = {};\n");
    fs.writeFileSync(path.join(source, "solcord.js"), "module.exports = {};\n");
    fs.writeFileSync(path.join(source, "editor", "preload.js"), "module.exports = {};\n");
    fs.writeFileSync(path.join(source, "editor", "script.js"), "document.body.dataset.ready = 'true';\n");
    fs.writeFileSync(path.join(source, "editor", "index.html"), "<!doctype html><title>Solcord</title>\n");
}

async function packageSolcord(fixtureValue: Fixture): Promise<void> {
    asar.uncache(fixtureValue.solcordAsar);
    fs.rmSync(fixtureValue.solcordAsar, {force: true});
    await finishSolcordAsar(asar.createPackage(fixtureValue.solcordSource, fixtureValue.solcordAsar));
    fixtureValue.expectedHash = hashBytes(fs.readFileSync(fixtureValue.solcordAsar));
}

async function createFixture(): Promise<Fixture> {
    // Bun's non-native realpath preserves Windows 8.3 TEMP aliases. Production
    // uses the native physical path, so fault injections must use it as well.
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "solcord-disposable-test-")));
    temporaryRoots.push(root);
    const sourceApp = path.join(root, "source", "app-1.0.9999");
    const solcordAsar = path.join(root, "artifacts", "solcord.asar");
    const solcordSource = path.join(root, "solcord-source");
    const destination = path.join(root, "acceptance");
    const expectedSourceCommit = "a".repeat(40);

    fs.mkdirSync(path.join(sourceApp, "resources", "app"), {recursive: true});
    fs.mkdirSync(path.dirname(solcordAsar), {recursive: true});
    fs.writeFileSync(path.join(sourceApp, "Discord.exe"), "fake-discord-executable");
    fs.writeFileSync(path.join(sourceApp, "resources", "app", "index.js"), "module.exports = require('../betterdiscord.app.asar');\n");
    fs.writeFileSync(path.join(sourceApp, "resources", "app", "package.json"), "{\"name\":\"discord\",\"main\":\"index.js\"}\n");
    fs.writeFileSync(path.join(sourceApp, "resources", "build_info.json"), JSON.stringify({releaseChannel: "stable", version: "1.0.9999"}));
    for (const name of ["discord_desktop_core", "discord_utils"]) {
        const packageRoot = path.join(sourceApp, "modules", `${name}-1`, name);
        fs.mkdirSync(packageRoot, {recursive: true});
        const packageJson = name === "discord_desktop_core"
            ? {name, version: "0.0.0", main: "index.js"}
            : {"private": "true"};
        fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify(packageJson));
        fs.writeFileSync(path.join(packageRoot, "index.js"), "module.exports = {};\n");
        if (name === "discord_desktop_core") {
            const coreSource = path.join(root, "discord-core-source");
            fs.mkdirSync(coreSource);
            fs.writeFileSync(path.join(coreSource, "index.js"), "module.exports = {};\n");
            await finishSolcordAsar(asar.createPackage(coreSource, path.join(packageRoot, "core.asar")));
            fs.writeFileSync(
                path.join(packageRoot, "index.js"),
                `require("C:\\\\Users\\\\owner\\\\AppData\\\\Roaming\\\\BetterDiscord\\\\data\\\\betterdiscord.asar");\nmodule.exports = require("./core.asar");\n`
            );
        }
    }
    const betterDiscordSource = path.join(root, "betterdiscord-source");
    fs.mkdirSync(betterDiscordSource);
    fs.writeFileSync(path.join(betterDiscordSource, "index.js"), "module.exports = {};\n");
    await finishSolcordAsar(asar.createPackage(betterDiscordSource, path.join(sourceApp, "resources", "betterdiscord.app.asar")));
    fs.writeFileSync(path.join(sourceApp, "runtime-payload.bin"), Buffer.from([0, 1, 2, 3, 254, 255]));
    writeSolcordSource(solcordSource, validBuildProvenance(expectedSourceCommit));

    const result = {root, sourceApp, solcordAsar, solcordSource, destination, expectedHash: "", expectedSourceCommit};
    await packageSolcord(result);
    return result;
}

beforeEach(async () => {
    fixture = await createFixture();
});

afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
        const resolved = path.resolve(root);
        const temporary = `${fs.realpathSync.native(os.tmpdir())}${path.sep}`.toLowerCase();
        if (!resolved.toLowerCase().startsWith(temporary) || !path.basename(resolved).startsWith("solcord-disposable-test-")) {
            throw new Error(`Refusing unsafe test cleanup target: ${resolved}`);
        }
        fs.rmSync(resolved, {recursive: true, force: true});
    }
});

windowsDescribe("Solcord disposable Windows acceptance preparation", () => {
    test("accepts the exact pinned offline editor/catalog assets and rejects rehashed asset drift", async () => {
        for (const asset of solcordLocalAssets(path.resolve(import.meta.dir, "../.."))) {
            const destination = path.join(fixture.solcordSource, asset.target);
            fs.mkdirSync(path.dirname(destination), {recursive: true});
            fs.copyFileSync(asset.source, destination);
        }
        await packageSolcord(fixture);
        expect(prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
solcordAsar: fixture.solcordAsar,
destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
expectedSolcordSourceCommit: fixture.expectedSourceCommit,
dryRun: true
        }).dryRun).toBe(true);
        fs.appendFileSync(path.join(fixture.solcordSource, "editor/monaco/vs/loader.js"), "\n// fixture drift\n");
        await packageSolcord(fixture);
        expect(() => prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
solcordAsar: fixture.solcordAsar,
destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
expectedSolcordSourceCommit: fixture.expectedSourceCommit,
dryRun: true
        })).toThrow("pinned source");
    }, 30_000);
    test("dry-run validates everything while performing zero writes", () => {
        const before = snapshotTree(fixture.sourceApp);
        const result = prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
            solcordAsar: fixture.solcordAsar,
            destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
            expectedSolcordSourceCommit: fixture.expectedSourceCommit,
            dryRun: true
        });

        expect(result.dryRun).toBeTrue();
        expect(result.writtenFiles).toEqual([]);
        expect(fs.existsSync(fixture.destination)).toBeFalse();
        expect(snapshotTree(fixture.sourceApp)).toEqual(before);
        const manifestText = JSON.stringify(result.manifest);
        expect(manifestText).not.toContain(fixture.root);
        expect(manifestText).not.toContain(fixture.sourceApp);
        expect(manifestText).not.toContain(fixture.destination);
        expect(manifestText).not.toContain(fixture.solcordAsar);
        expect(result.manifest.schemaVersion).toBe(10);
        expect(result.manifest.discordReleaseChannel).toBe("stable");
        expect(result.manifest.solcordSourceCommit).toBe(fixture.expectedSourceCommit);
        expect(result.manifest.solcordBuildMode).toBe("production");
        expect(result.manifest.sourceDiscordTree.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(result.manifest.sourceDiscordTree.files).toBeGreaterThan(0);
    });

    test("CLI binds both artifact hash and source commit in a no-write dry-run", () => {
        const result = spawnSync(process.execPath, [
            path.resolve("scripts/prepare-solcord-disposable-acceptance.ts"),
            "--source-app", fixture.sourceApp,
            "--solcord-asar", fixture.solcordAsar,
            "--destination", fixture.destination,
            "--expected-sha256", fixture.expectedHash,
            "--expected-source-commit", fixture.expectedSourceCommit,
            "--dry-run"
        ], {cwd: path.resolve("."), encoding: "utf8", windowsHide: true});

        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
        const parsed = JSON.parse(result.stdout) as {dryRun: boolean; writtenFiles: string[]; manifest: {solcordSourceCommit: string;};};
        expect(parsed.dryRun).toBeTrue();
        expect(parsed.writtenFiles).toEqual([]);
        expect(parsed.manifest.solcordSourceCommit).toBe(fixture.expectedSourceCommit);
        expect(fs.existsSync(fixture.destination)).toBeFalse();
    });

    test("direct Discord execution fails before acceptance mode or Solcord modules are used", () => {
        const result = executeShim({}, path.join(fixture.destination, "runtime", "resources", "app"));
        expect(result.error?.message).toContain("SOLCORD_ACCEPTANCE_ROOT");
        expect(result.environment.SOLCORD_ACCEPTANCE_MODE).toBeUndefined();
        expect(result.userData).toBeNull();
        expect(result.loaded).toEqual([]);
    });

    test("copies bytes, isolates paths, writes an ordered shim, and never launches", () => {
        const before = snapshotTree(fixture.sourceApp);
        const result = prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
            solcordAsar: fixture.solcordAsar,
            destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
            expectedSolcordSourceCommit: fixture.expectedSourceCommit
        });

        const runtime = path.join(fixture.destination, "runtime");
        const copiedSolcord = path.join(runtime, "resources", "solcord.asar");
        expect(result.dryRun).toBeFalse();
        expect(fs.readFileSync(path.join(runtime, "Discord.exe"), "utf8")).toBe("fake-discord-executable");
        expect(fs.readFileSync(path.join(runtime, "runtime-payload.bin"))).toEqual(Buffer.from([0, 1, 2, 3, 254, 255]));
        expect(hashBytes(fs.readFileSync(copiedSolcord))).toBe(fixture.expectedHash);
        expect(fs.readFileSync(copiedSolcord)).toEqual(fs.readFileSync(fixture.solcordAsar));
        expect(snapshotTree(fixture.sourceApp)).toEqual(before);
        const desktopCoreEntry = "modules/discord_desktop_core-1/discord_desktop_core/index.js";
        expect(fs.readFileSync(path.join(runtime, desktopCoreEntry), "utf8"))
            .toBe(`"use strict";\n\nmodule.exports = require("./core.asar");\n`);
        expect(result.writtenFiles).toContain(desktopCoreEntry);

        const shim = fs.readFileSync(path.join(runtime, "resources", "app", "index.js"), "utf8");
        const setPathIndex = shim.indexOf("app.setPath(\"userData\"");
        const protocolStubIndex = shim.indexOf("setAsDefaultProtocolClient");
        const solcordIndex = shim.indexOf("require(\"../solcord.asar\")");
        const originalIndex = shim.indexOf("require(\"../betterdiscord.app.asar\")");
        expect(setPathIndex).toBeGreaterThan(-1);
        expect(protocolStubIndex).toBeGreaterThan(setPathIndex);
        expect(solcordIndex).toBeGreaterThan(protocolStubIndex);
        expect(originalIndex).toBeGreaterThan(solcordIndex);
        expect(shim.indexOf("SOLCORD_ACCEPTANCE_MODE")).toBeLessThan(setPathIndex);

        const execution = executeShim({
            SOLCORD_ACCEPTANCE_ROOT: fixture.destination,
            APPDATA: path.join(fixture.destination, "profile", "Roaming"),
            LOCALAPPDATA: path.join(fixture.destination, "profile", "Local"),
            DISCORD_USER_DATA_DIR: path.join(fixture.destination, "profile", "Roaming"),
            SOLCORD_ACCEPTANCE_MODE: "1"
        }, path.join(runtime, "resources", "app"));
        expect(execution.error).toBeNull();
        expect(execution.userData).toBe(path.join(fixture.destination, "profile", "Roaming", "discord"));
        expect(execution.environment.SOLCORD_ACCEPTANCE_MODE).toBe("1");
        expect(execution.noAsar).toBe("preserved");
        expect(execution.moduleGlobalPaths).toEqual([
            path.join(runtime, "modules", "discord_desktop_core-1"),
            path.join(runtime, "modules", "discord_utils-1")
        ]);
        expect(execution.buildInfo?.localModulesRoot).toBe(path.join(runtime, "modules"));
        expect(execution.buildInfo?.disableUpdater).toBeTrue();
        expect(execution.loaded).toEqual(["../solcord.asar", "../betterdiscord.app.asar"]);
        const runtimeLedger = fs.readFileSync(
            path.join(fixture.destination, result.manifest.paths.runtimeLedger),
            "utf8"
        ).trim().split("\n").map(line => JSON.parse(line) as {stage: string;});
        expect(runtimeLedger.map(entry => entry.stage)).toEqual([
            "shim-begin",
            "environment-validated",
            "os-shell-policy-installed",
            "native-module-policy-installed",
            "solcord-require-begin",
            "solcord-require-complete",
            "discord-app-require-begin",
            "discord-app-require-returned"
        ]);
        const mismatchedEnvironment = executeShim({
            SOLCORD_ACCEPTANCE_ROOT: fixture.destination,
            APPDATA: path.join(fixture.destination, "profile", "Local"),
            LOCALAPPDATA: path.join(fixture.destination, "profile", "Local"),
            DISCORD_USER_DATA_DIR: path.join(fixture.destination, "profile", "Roaming"),
            SOLCORD_ACCEPTANCE_MODE: "1"
        }, path.join(runtime, "resources", "app"));
        expect(mismatchedEnvironment.error?.message).toContain("APPDATA does not match");
        expect(mismatchedEnvironment.environment.SOLCORD_ACCEPTANCE_MODE).toBeUndefined();
        expect(mismatchedEnvironment.loaded).toEqual([]);

        const launcher = fs.readFileSync(path.join(fixture.destination, "launch-solcord-acceptance.cmd"), "utf8");
        expect(launcher).toContain("APPDATA=%SOLCORD_ACCEPTANCE_ROOT%profile\\Roaming");
        expect(launcher).toContain("LOCALAPPDATA=%SOLCORD_ACCEPTANCE_ROOT%profile\\Local");
        expect(launcher).toContain("DISCORD_USER_DATA_DIR=%SOLCORD_ACCEPTANCE_ROOT%profile\\Roaming");
        expect(launcher).toContain("SOLCORD_ACCEPTANCE_LEDGER=%SOLCORD_ACCEPTANCE_ROOT%acceptance-runtime-ledger.jsonl");
        expect(launcher).toContain("SOLCORD_ACCEPTANCE_LAUNCH_GUARD=%SOLCORD_ACCEPTANCE_ROOT%.launch-attempt");
        expect(launcher).toContain("if exist \"%SOLCORD_ACCEPTANCE_LEDGER%\" goto :already_attempted");
        expect(launcher).toContain("mkdir \"%SOLCORD_ACCEPTANCE_LAUNCH_GUARD%\"");
        expect(launcher).toContain("for %%P in (Discord.exe DiscordPTB.exe DiscordCanary.exe)");
        expect(launcher).toContain("goto :process_check_failed");
        expect(launcher).toContain("goto :discord_running");
        expect(launcher).toContain("This disposable lane is single-use");
        expect(launcher.match(/start ""/g)).toHaveLength(1);
        expect(launcher).not.toContain("taskkill");
        expect(launcher).toContain("--multi-instance");
        expect(launcher).not.toContain("--user-data-dir");

        const launcherEnvironmentRoot = path.join(fixture.destination, "profile", "Roaming");
        const discordComputedUserData = path.join(launcherEnvironmentRoot, "discord");
        const shimComputedUserData = path.resolve(path.dirname(path.join(runtime, "resources", "app", "index.js")), "../../../profile/Roaming/discord");
        expect(shimComputedUserData).toBe(discordComputedUserData);
        expect(result.manifest.paths.userData).toBe("profile/Roaming/discord");
        expect(result.manifest.paths.acceptanceSettings).toBe("profile/Roaming/discord/settings.json");
        expect(JSON.parse(fs.readFileSync(
            path.join(fixture.destination, result.manifest.paths.acceptanceSettings),
            "utf8"
        ))).toEqual({SKIP_HOST_UPDATE: true, SKIP_MODULE_UPDATE: true});
        expect(result.manifest.paths.firstRunMarker).toBe("profile/Roaming/discord/1.0.9999/.first-run");
        expect(fs.readFileSync(
            path.join(fixture.destination, result.manifest.paths.firstRunMarker),
            "utf8"
        )).toBe("true");
        expect(snapshotTree(path.join(fixture.destination, "profile", "Roaming", "discord"))).toEqual({
            "1.0.9999/": "directory",
            "1.0.9999/.first-run": hashBytes("true"),
            "settings.json": hashBytes(`${JSON.stringify({SKIP_HOST_UPDATE: true, SKIP_MODULE_UPDATE: true}, null, 2)}\n`)
        });
        expect(result.writtenFiles).toContain(result.manifest.paths.acceptanceSettings);
        expect(result.writtenFiles).toContain(result.manifest.paths.firstRunMarker);
        expect(result.writtenFiles).not.toContain(result.manifest.paths.runtimeLedger);
        expect(path.join(path.dirname(shimComputedUserData), "BetterDiscord"))
            .toBe(path.join(fixture.destination, "profile", "Roaming", "BetterDiscord"));
        expect(fs.statSync(shimComputedUserData).isDirectory()).toBeTrue();
        expect(fs.statSync(path.join(path.dirname(shimComputedUserData), "BetterDiscord")).isDirectory()).toBeTrue();

        const manifestText = fs.readFileSync(path.join(fixture.destination, "acceptance-manifest.json"), "utf8");
        expect(manifestText).not.toContain(fixture.root);
        expect(manifestText).not.toContain(fixture.sourceApp);
        expect(manifestText).not.toContain(fixture.destination);
        expect(manifestText).not.toContain(fixture.solcordAsar);
        expect(JSON.parse(manifestText)).toEqual(result.manifest);
        expect(result.manifest.discordVersion).toBe("1.0.9999");
        expect(result.manifest.discordReleaseChannel).toBe("stable");
        expect(result.manifest.safety.launchPerformed).toBeFalse();
        expect(result.manifest.safety.copiedUserProfile).toBeFalse();
        expect(result.manifest.safety.filesystemProfileIsolated).toBeTrue();
        expect(result.manifest.safety.windowsAccountIsolated).toBeFalse();
        expect(result.manifest.safety.copiedNativeModules).toBeTrue();
        expect(result.manifest.safety.legacyDesktopCoreInjectorNeutralized).toBeTrue();
        expect(result.manifest.safety.updaterDisabledInAcceptance).toBeTrue();
        expect(result.manifest.safety.runtimeLedgerSanitized).toBeTrue();
        for (const relative of Object.values(result.manifest.paths)) {
            expect(path.isAbsolute(relative)).toBeFalse();
            expect(relative).not.toContain("\\");
        }
    });

    test("refuses a pre-existing destination root", () => {
        fs.mkdirSync(fixture.destination);
        expect(() => prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
            solcordAsar: fixture.solcordAsar,
            destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
            expectedSolcordSourceCommit: fixture.expectedSourceCommit
        })).toThrow("already exists");
    });

    test("accepts an already-direct desktop-core entry without changing the source", () => {
        const sourceEntry = path.join(
            fixture.sourceApp,
            "modules",
            "discord_desktop_core-1",
            "discord_desktop_core",
            "index.js"
        );
        const direct = `module.exports = require("./core.asar");\n`;
        fs.writeFileSync(sourceEntry, direct);
        const result = prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
            solcordAsar: fixture.solcordAsar,
            destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
            expectedSolcordSourceCommit: fixture.expectedSourceCommit,
            dryRun: true
        });
        expect(result.dryRun).toBeTrue();
        expect(fs.readFileSync(sourceEntry, "utf8")).toBe(direct);
        expect(fs.existsSync(fixture.destination)).toBeFalse();
    });

    test("rejects an unrecognized desktop-core injector before copying", () => {
        const sourceEntry = path.join(
            fixture.sourceApp,
            "modules",
            "discord_desktop_core-1",
            "discord_desktop_core",
            "index.js"
        );
        fs.writeFileSync(sourceEntry, `require("C:\\\\unreviewed\\\\client-mod.asar");\nmodule.exports = require("./core.asar");\n`);
        expect(() => prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
            solcordAsar: fixture.solcordAsar,
            destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
            expectedSolcordSourceCommit: fixture.expectedSourceCommit,
            dryRun: true
        })).toThrow("unrecognized Discord desktop-core entry");
        expect(fs.existsSync(fixture.destination)).toBeFalse();
    });

    test("fails closed before Solcord loads when a copied native module disappears", () => {
        prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
            solcordAsar: fixture.solcordAsar,
            destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
            expectedSolcordSourceCommit: fixture.expectedSourceCommit
        });
        fs.rmSync(path.join(fixture.destination, "runtime", "modules", "discord_utils-1"), {recursive: true});

        const execution = executeShim({
            SOLCORD_ACCEPTANCE_ROOT: fixture.destination,
            APPDATA: path.join(fixture.destination, "profile", "Roaming"),
            LOCALAPPDATA: path.join(fixture.destination, "profile", "Local"),
            DISCORD_USER_DATA_DIR: path.join(fixture.destination, "profile", "Roaming"),
            SOLCORD_ACCEPTANCE_MODE: "1"
        }, path.join(fixture.destination, "runtime", "resources", "app"));

        expect(execution.error?.message).toContain("missing required copied Discord native modules");
        expect(execution.loaded).toEqual([]);
    });

    test("accepts bounded Discord runtime artifacts on a repeat isolated launch", () => {
        prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
            solcordAsar: fixture.solcordAsar,
            destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
            expectedSolcordSourceCommit: fixture.expectedSourceCommit
        });
        const modulesRoot = path.join(fixture.destination, "runtime", "modules");
        fs.mkdirSync(path.join(modulesRoot, "crashlogs"));
        fs.writeFileSync(path.join(modulesRoot, "crashlogs", "runtime.log"), "sanitized runtime fixture\n");
        fs.mkdirSync(path.join(modulesRoot, "discord_utils"));

        const execution = executeShim({
            SOLCORD_ACCEPTANCE_ROOT: fixture.destination,
            APPDATA: path.join(fixture.destination, "profile", "Roaming"),
            LOCALAPPDATA: path.join(fixture.destination, "profile", "Local"),
            DISCORD_USER_DATA_DIR: path.join(fixture.destination, "profile", "Roaming"),
            SOLCORD_ACCEPTANCE_MODE: "1"
        }, path.join(fixture.destination, "runtime", "resources", "app"));

        expect(execution.error).toBeNull();
        expect(execution.loaded).toEqual(["../solcord.asar", "../betterdiscord.app.asar"]);
        expect(execution.moduleGlobalPaths).toEqual([
            path.join(modulesRoot, "discord_desktop_core-1"),
            path.join(modulesRoot, "discord_utils-1")
        ]);
    });

    test("rejects an unrecognized unversioned module directory on repeat launch", () => {
        prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
            solcordAsar: fixture.solcordAsar,
            destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
            expectedSolcordSourceCommit: fixture.expectedSourceCommit
        });
        fs.mkdirSync(path.join(fixture.destination, "runtime", "modules", "discord_unknown"));

        const execution = executeShim({
            SOLCORD_ACCEPTANCE_ROOT: fixture.destination,
            APPDATA: path.join(fixture.destination, "profile", "Roaming"),
            LOCALAPPDATA: path.join(fixture.destination, "profile", "Local"),
            DISCORD_USER_DATA_DIR: path.join(fixture.destination, "profile", "Roaming"),
            SOLCORD_ACCEPTANCE_MODE: "1"
        }, path.join(fixture.destination, "runtime", "resources", "app"));

        expect(execution.error?.message).toContain("invalid copied Discord module wrapper");
        expect(execution.loaded).toEqual([]);
    });

    test("rejects conflicting copied native-module metadata before Solcord loads", () => {
        prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
            solcordAsar: fixture.solcordAsar,
            destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
            expectedSolcordSourceCommit: fixture.expectedSourceCommit
        });
        fs.writeFileSync(
            path.join(fixture.destination, "runtime", "modules", "discord_utils-1", "discord_utils", "package.json"),
            JSON.stringify({name: "discord_voice"})
        );

        const execution = executeShim({
            SOLCORD_ACCEPTANCE_ROOT: fixture.destination,
            APPDATA: path.join(fixture.destination, "profile", "Roaming"),
            LOCALAPPDATA: path.join(fixture.destination, "profile", "Local"),
            DISCORD_USER_DATA_DIR: path.join(fixture.destination, "profile", "Roaming"),
            SOLCORD_ACCEPTANCE_MODE: "1"
        }, path.join(fixture.destination, "runtime", "resources", "app"));

        expect(execution.error?.message).toContain("ambiguous copied Discord native-module metadata");
        expect(execution.loaded).toEqual([]);
    });

    test("rejects a Discord version that could escape the isolated version directory", () => {
        expect(() => createDisposableAcceptanceManifest(
            "..",
            "stable",
            "a".repeat(64),
            "b".repeat(40),
            "1.0.0-test",
            "production",
            "c".repeat(64),
            {sha256: "d".repeat(64), files: 1, directories: 1, bytes: 1}
        )).toThrow("complete artifact hashes");
    });

    test("rejects a non-CommonJS or noncanonical Discord app package in dry-run", () => {
        fs.writeFileSync(
            path.join(fixture.sourceApp, "resources", "app", "package.json"),
            JSON.stringify({name: "discord", main: "../index.js", type: "module"})
        );
        expect(() => prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
            solcordAsar: fixture.solcordAsar,
            destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
            expectedSolcordSourceCommit: fixture.expectedSourceCommit,
            dryRun: true
        })).toThrow("discord CommonJS application with canonical index.js main");
        expect(fs.existsSync(fixture.destination)).toBeFalse();
    });

    test("rejects oversized Discord app metadata before parsing it", () => {
        fs.writeFileSync(path.join(fixture.sourceApp, "resources", "app", "package.json"), Buffer.alloc(128 * 1024 + 1, 0x20));
        expect(() => prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
            solcordAsar: fixture.solcordAsar,
            destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
            expectedSolcordSourceCommit: fixture.expectedSourceCommit,
            dryRun: true
        })).toThrow("no larger than 128 KiB");
        expect(fs.existsSync(fixture.destination)).toBeFalse();
    });

    test("rejects build-info version drift before creating the destination", () => {
        fs.writeFileSync(
            path.join(fixture.sourceApp, "resources", "build_info.json"),
            JSON.stringify({releaseChannel: "stable", version: "1.0.0000"})
        );
        expect(() => prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
            solcordAsar: fixture.solcordAsar,
            destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
            expectedSolcordSourceCommit: fixture.expectedSourceCommit,
            dryRun: true
        })).toThrow("must match the app directory version");
        expect(fs.existsSync(fixture.destination)).toBeFalse();
    });

    test("rejects a source runtime that already contains solcord.asar during dry-run", () => {
        fs.copyFileSync(fixture.solcordAsar, path.join(fixture.sourceApp, "resources", "solcord.asar"));
        expect(() => prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
            solcordAsar: fixture.solcordAsar,
            destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
            expectedSolcordSourceCommit: fixture.expectedSourceCommit,
            dryRun: true
        })).toThrow("source resources/solcord.asar already exists");
        expect(fs.existsSync(fixture.destination)).toBeFalse();
    });

    test("rejects a physical destination-parent alias into the source tree", () => {
        const originalNativeRealpath = fs.realpathSync.native;
        let injected = 0;
        fs.realpathSync.native = ((target, options) => {
            if (path.resolve(String(target)).toLocaleLowerCase("en-US") === path.resolve(fixture.root).toLocaleLowerCase("en-US")) {
                injected++;
                return fixture.sourceApp;
            }
            return originalNativeRealpath(target, options as never);
        }) as typeof fs.realpathSync.native;

        try {
            expect(() => prepareSolcordDisposableAcceptance({
                sourceDiscordAppDir: fixture.sourceApp,
                solcordAsar: fixture.solcordAsar,
                destinationRoot: fixture.destination,
                expectedSolcordSha256: fixture.expectedHash,
                expectedSolcordSourceCommit: fixture.expectedSourceCommit,
                dryRun: true
            })).toThrow("physically resolve inside");
        }
        finally {
            fs.realpathSync.native = originalNativeRealpath;
        }
        expect(injected).toBeGreaterThan(0);
        expect(fs.existsSync(fixture.destination)).toBeFalse();
    });

    test("rejects a hash mismatch before creating the destination", () => {
        expect(() => prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
            solcordAsar: fixture.solcordAsar,
            destinationRoot: fixture.destination,
            expectedSolcordSha256: "0".repeat(64),
            expectedSolcordSourceCommit: fixture.expectedSourceCommit
        })).toThrow("does not match");
        expect(fs.existsSync(fixture.destination)).toBeFalse();
    });

    test("rejects a truncated ASAR whose packed entry ends exceed the archive", () => {
        fs.truncateSync(fixture.solcordAsar, fs.statSync(fixture.solcordAsar).size - 1);
        refreshArtifactHash();
        expect(() => prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
            solcordAsar: fixture.solcordAsar,
            destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
            expectedSolcordSourceCommit: fixture.expectedSourceCommit
        })).toThrow(/outside the archive|truncated/i);
        expect(fs.existsSync(fixture.destination)).toBeFalse();
    });

    test("rejects an oversized ASAR before hashing or parser allocation", () => {
        const originalLstatSync = fs.lstatSync;
        const mutableFs = fs as unknown as {lstatSync: typeof fs.lstatSync;};
        mutableFs.lstatSync = ((target, options) => {
            const stat = originalLstatSync(target, options as never);
            if (path.resolve(String(target)) !== path.resolve(fixture.solcordAsar)) return stat;
            return new Proxy(stat, {get: (value, property) => property === "size" ? 512 * 1024 * 1024 + 1 : Reflect.get(value, property)});
        }) as typeof fs.lstatSync;
        try {
            expect(() => prepareSolcordDisposableAcceptance({
                sourceDiscordAppDir: fixture.sourceApp,
                solcordAsar: fixture.solcordAsar,
                destinationRoot: fixture.destination,
                expectedSolcordSha256: fixture.expectedHash,
                expectedSolcordSourceCommit: fixture.expectedSourceCommit
            })).toThrow("between 16 bytes and 512 MiB");
        }
        finally {
            mutableFs.lstatSync = originalLstatSync;
        }
        expect(fs.existsSync(fixture.destination)).toBeFalse();
    });

    test("rejects an oversized declared ASAR header before parser allocation", () => {
        const descriptor = fs.openSync(fixture.solcordAsar, "r+");
        try {
            const declaredSize = Buffer.alloc(4);
            declaredSize.writeUInt32LE(1024 * 1024 + 4);
            fs.writeSync(descriptor, declaredSize, 0, declaredSize.length, 4);
        }
        finally {fs.closeSync(descriptor);}
        expect(() => prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
            solcordAsar: fixture.solcordAsar,
            destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
            expectedSolcordSourceCommit: fixture.expectedSourceCommit
        })).toThrow("fixed header is malformed or oversized");
        expect(fs.existsSync(fixture.destination)).toBeFalse();
    });

    test("rejects an in-bounds header with a forged packed offset", () => {
        const archive = fs.readFileSync(fixture.solcordAsar);
        const marker = Buffer.from("\"offset\":\"0\"");
        const markerIndex = archive.indexOf(marker);
        expect(markerIndex).toBeGreaterThan(-1);
        archive[markerIndex + Buffer.byteLength("\"offset\":\"")] = "9".charCodeAt(0);
        fs.writeFileSync(fixture.solcordAsar, archive);
        refreshArtifactHash();
        expect(() => prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
            solcordAsar: fixture.solcordAsar,
            destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
            expectedSolcordSourceCommit: fixture.expectedSourceCommit
        })).toThrow(/overlap|gaps|outside the archive/i);
        expect(fs.existsSync(fixture.destination)).toBeFalse();
    });

    test("rejects malformed ASAR integrity metadata", () => {
        const archive = fs.readFileSync(fixture.solcordAsar);
        const marker = Buffer.from("\"algorithm\":\"SHA256\"");
        const markerIndex = archive.indexOf(marker);
        expect(markerIndex).toBeGreaterThan(-1);
        Buffer.from("MD5256").copy(archive, markerIndex + Buffer.byteLength("\"algorithm\":\""));
        fs.writeFileSync(fixture.solcordAsar, archive);
        refreshArtifactHash();

        expect(() => prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
            solcordAsar: fixture.solcordAsar,
            destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
            expectedSolcordSourceCommit: fixture.expectedSourceCommit
        })).toThrow("integrity metadata is unsupported or invalid");
        expect(fs.existsSync(fixture.destination)).toBeFalse();
    });

    test("rejects zero-sized or unexpected ASAR runtime entries", async () => {
        fs.writeFileSync(path.join(fixture.solcordSource, "main.js"), "");
        fs.writeFileSync(path.join(fixture.solcordSource, "unexpected.js"), "module.exports = {};\n");
        await packageSolcord(fixture);
        expect(() => prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
            solcordAsar: fixture.solcordAsar,
            destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
            expectedSolcordSourceCommit: fixture.expectedSourceCommit
        })).toThrow(/invalid, empty, or oversized|exact expected runtime entrypoints/i);
        expect(fs.existsSync(fixture.destination)).toBeFalse();
    });

    test("rejects an embedded Solcord package that selects ESM loading", async () => {
        fs.writeFileSync(
            path.join(fixture.solcordSource, "package.json"),
            JSON.stringify({name: "solcord", main: "main.js", type: "module"})
        );
        await packageSolcord(fixture);

        expect(() => prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
            solcordAsar: fixture.solcordAsar,
            destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
            expectedSolcordSourceCommit: fixture.expectedSourceCommit
        })).toThrow("canonical CommonJS package");
        expect(fs.existsSync(fixture.destination)).toBeFalse();
    });

    test("rejects unknown embedded package keys that can alter module loading", async () => {
        fs.writeFileSync(
            path.join(fixture.solcordSource, "package.json"),
            JSON.stringify({name: "solcord", main: "main.js", exports: "./preload.js"})
        );
        await packageSolcord(fixture);

        expect(() => prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
            solcordAsar: fixture.solcordAsar,
            destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
            expectedSolcordSourceCommit: fixture.expectedSourceCommit
        })).toThrow("canonical CommonJS package");
        expect(fs.existsSync(fixture.destination)).toBeFalse();
    });

    test("rejects an ASAR missing embedded build provenance before creating the destination", async () => {
        fs.unlinkSync(path.join(fixture.solcordSource, "build-provenance.json"));
        await packageSolcord(fixture);

        expect(() => prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
            solcordAsar: fixture.solcordAsar,
            destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
            expectedSolcordSourceCommit: fixture.expectedSourceCommit
        })).toThrow(/expected runtime entrypoints|build-provenance/i);
        expect(fs.existsSync(fixture.destination)).toBeFalse();
    });

    test("rejects stale diagnostic provenance before creating the destination", async () => {
        const provenance = validBuildProvenance(fixture.expectedSourceCommit);
        provenance.mode = "diagnostic";
        provenance.buildLabel = "diagnostic-clean";
        writeSolcordSource(fixture.solcordSource, provenance);
        await packageSolcord(fixture);

        expect(() => prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
            solcordAsar: fixture.solcordAsar,
            destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
            expectedSolcordSourceCommit: fixture.expectedSourceCommit
        })).toThrow("production or release build provenance");
        expect(fs.existsSync(fixture.destination)).toBeFalse();
    });

    test("rejects dirty production provenance before creating the destination", async () => {
        const provenance = validBuildProvenance(fixture.expectedSourceCommit);
        const source = provenance.source as Record<string, unknown>;
        source.clean = false;
        source.statusDigest = "2".repeat(64);
        provenance.buildLabel = `production-dirty.${String(source.digest).slice(0, 16)}`;
        writeSolcordSource(fixture.solcordSource, provenance);
        await packageSolcord(fixture);

        expect(() => prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
            solcordAsar: fixture.solcordAsar,
            destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
            expectedSolcordSourceCommit: fixture.expectedSourceCommit
        })).toThrow("clean production or release build provenance");
        expect(fs.existsSync(fixture.destination)).toBeFalse();
    });

    test("rejects a caller-bound source commit mismatch before creating the destination", () => {
        expect(() => prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
            solcordAsar: fixture.solcordAsar,
            destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
            expectedSolcordSourceCommit: "b".repeat(40)
        })).toThrow("does not match the caller-provided expected source commit");
        expect(fs.existsSync(fixture.destination)).toBeFalse();
    });

    test("rejects and removes a runtime when the copied BetterDiscord ASAR changes during copy", () => {
        const originalCopyFileSync = fs.copyFileSync;
        let corruptions = 0;
        fs.copyFileSync = ((source, destination, mode) => {
            originalCopyFileSync(source, destination, mode);
            if (path.basename(String(destination)) === "betterdiscord.app.asar") {
                corruptions++;
                fs.appendFileSync(destination, "changed-after-source-hash");
            }
        }) as typeof fs.copyFileSync;

        try {
            expect(() => prepareSolcordDisposableAcceptance({
                sourceDiscordAppDir: fixture.sourceApp,
                solcordAsar: fixture.solcordAsar,
                destinationRoot: fixture.destination,
                expectedSolcordSha256: fixture.expectedHash,
                expectedSolcordSourceCommit: fixture.expectedSourceCommit
            })).toThrow("BetterDiscord application ASAR failed post-copy SHA-256 verification");
        }
        finally {
            fs.copyFileSync = originalCopyFileSync;
        }

        expect(corruptions).toBe(1);
        expect(fs.existsSync(fixture.destination)).toBeFalse();
    });

    test("detects a source-tree mutation during copy and removes only its destination", () => {
        const originalCopyFileSync = fs.copyFileSync;
        const mutableSource = path.join(fixture.sourceApp, "runtime-payload.bin");
        let mutated = false;
        fs.copyFileSync = ((source, destination, mode) => {
            originalCopyFileSync(source, destination, mode);
            if (!mutated && path.resolve(String(source)) === path.resolve(mutableSource)) {
                mutated = true;
                fs.appendFileSync(mutableSource, "changed-during-copy");
            }
        }) as typeof fs.copyFileSync;

        try {
            expect(() => prepareSolcordDisposableAcceptance({
                sourceDiscordAppDir: fixture.sourceApp,
                solcordAsar: fixture.solcordAsar,
                destinationRoot: fixture.destination,
                expectedSolcordSha256: fixture.expectedHash,
                expectedSolcordSourceCommit: fixture.expectedSourceCommit
            })).toThrow("source Discord runtime changed during copy");
        }
        finally {
            fs.copyFileSync = originalCopyFileSync;
        }

        expect(mutated).toBeTrue();
        expect(fs.existsSync(fixture.destination)).toBeFalse();
        expect(fs.existsSync(fixture.sourceApp)).toBeTrue();
    });

    test("revalidates copied package semantics accepted before the first inventory", () => {
        const originalReadDirectory = fs.readdirSync;
        const sourcePackage = path.join(fixture.sourceApp, "resources", "app", "package.json");
        let sourceRootReads = 0;
        let mutated = false;
        fs.readdirSync = ((directory, options) => {
            if (path.resolve(String(directory)) === path.resolve(fixture.sourceApp) && ++sourceRootReads === 2) {
                fs.writeFileSync(sourcePackage, "{\"name\":\"discord\",\"main\":\"./index.js\"}\n");
                mutated = true;
            }
            return originalReadDirectory(directory, options as never);
        }) as typeof fs.readdirSync;

        try {
            expect(() => prepareSolcordDisposableAcceptance({
                sourceDiscordAppDir: fixture.sourceApp,
                solcordAsar: fixture.solcordAsar,
                destinationRoot: fixture.destination,
                expectedSolcordSha256: fixture.expectedHash,
                expectedSolcordSourceCommit: fixture.expectedSourceCommit
            })).toThrow("no longer matches the initially accepted package and build identity");
        }
        finally {
            fs.readdirSync = originalReadDirectory;
        }

        expect(mutated).toBeTrue();
        expect(fs.existsSync(fixture.destination)).toBeFalse();
    });

    test("revalidates copied build identity accepted before the first inventory", () => {
        const originalReadDirectory = fs.readdirSync;
        const buildInfo = path.join(fixture.sourceApp, "resources", "build_info.json");
        let sourceRootReads = 0;
        let mutated = false;
        fs.readdirSync = ((directory, options) => {
            if (path.resolve(String(directory)) === path.resolve(fixture.sourceApp) && ++sourceRootReads === 2) {
                fs.writeFileSync(buildInfo, JSON.stringify({releaseChannel: "canary", version: "1.0.9999"}));
                mutated = true;
            }
            return originalReadDirectory(directory, options as never);
        }) as typeof fs.readdirSync;

        try {
            expect(() => prepareSolcordDisposableAcceptance({
                sourceDiscordAppDir: fixture.sourceApp,
                solcordAsar: fixture.solcordAsar,
                destinationRoot: fixture.destination,
                expectedSolcordSha256: fixture.expectedHash,
                expectedSolcordSourceCommit: fixture.expectedSourceCommit
            })).toThrow("no longer matches the initially accepted package and build identity");
        }
        finally {
            fs.readdirSync = originalReadDirectory;
        }

        expect(mutated).toBeTrue();
        expect(fs.existsSync(fixture.destination)).toBeFalse();
    });

    test("rejects corruption in a copied non-ASAR runtime file through whole-tree verification", () => {
        const originalCopyFileSync = fs.copyFileSync;
        const mutableSource = path.join(fixture.sourceApp, "runtime-payload.bin");
        let corruptions = 0;
        fs.copyFileSync = ((source, destination, mode) => {
            originalCopyFileSync(source, destination, mode);
            if (path.resolve(String(source)) === path.resolve(mutableSource)) {
                corruptions++;
                fs.appendFileSync(destination, "corrupt-copy-only");
            }
        }) as typeof fs.copyFileSync;

        try {
            expect(() => prepareSolcordDisposableAcceptance({
                sourceDiscordAppDir: fixture.sourceApp,
                solcordAsar: fixture.solcordAsar,
                destinationRoot: fixture.destination,
                expectedSolcordSha256: fixture.expectedHash,
                expectedSolcordSourceCommit: fixture.expectedSourceCommit
            })).toThrow("whole-tree verification");
        }
        finally {
            fs.copyFileSync = originalCopyFileSync;
        }

        expect(corruptions).toBe(1);
        expect(fs.existsSync(fixture.destination)).toBeFalse();
        expect(fs.readFileSync(mutableSource)).toEqual(Buffer.from([0, 1, 2, 3, 254, 255]));
    });

    test("does not clean an attacker replacement of the owned staging root", () => {
        const originalCopyFileSync = fs.copyFileSync;
        const originalRenameSync = fs.renameSync;
        let replacementRoot = "";
        let displacedOwnedRoot = "";
        let replacements = 0;
        fs.copyFileSync = ((source, destination, mode) => {
            const destinationPath = path.resolve(String(destination));
            const firstSegment = path.relative(fixture.root, destinationPath).split(path.sep)[0];
            if (!replacementRoot && firstSegment.startsWith(".solcord-acceptance-stage-")) {
                replacements++;
                replacementRoot = path.join(fixture.root, firstSegment);
                displacedOwnedRoot = `${replacementRoot}.displaced`;
                originalRenameSync(replacementRoot, displacedOwnedRoot);
                fs.mkdirSync(path.dirname(destinationPath), {recursive: true});
                fs.writeFileSync(path.join(replacementRoot, "attacker-marker.txt"), "preserve-replacement");
            }
            originalCopyFileSync(source, destination, mode);
        }) as typeof fs.copyFileSync;

        try {
            expect(() => prepareSolcordDisposableAcceptance({
                sourceDiscordAppDir: fixture.sourceApp,
                solcordAsar: fixture.solcordAsar,
                destinationRoot: fixture.destination,
                expectedSolcordSha256: fixture.expectedHash,
                expectedSolcordSourceCommit: fixture.expectedSourceCommit
            })).toThrow("staging root ownership changed");
        }
        finally {
            fs.copyFileSync = originalCopyFileSync;
        }

        expect(replacements).toBe(1);
        expect(fs.existsSync(fixture.destination)).toBeFalse();
        expect(fs.readFileSync(path.join(replacementRoot, "attacker-marker.txt"), "utf8")).toBe("preserve-replacement");
        expect(fs.existsSync(displacedOwnedRoot)).toBeTrue();
    });

    test("cleans only owned staging after a late manifest-write failure", () => {
        const originalWriteFileSync = fs.writeFileSync;
        let injected = 0;
        fs.writeFileSync = ((file, data, options) => {
            if (path.basename(String(file)) === "acceptance-manifest.json") {
                injected++;
                throw new Error("synthetic late manifest failure");
            }
            return originalWriteFileSync(file, data, options as never);
        }) as typeof fs.writeFileSync;

        try {
            expect(() => prepareSolcordDisposableAcceptance({
                sourceDiscordAppDir: fixture.sourceApp,
                solcordAsar: fixture.solcordAsar,
                destinationRoot: fixture.destination,
                expectedSolcordSha256: fixture.expectedHash,
                expectedSolcordSourceCommit: fixture.expectedSourceCommit
            })).toThrow("synthetic late manifest failure");
        }
        finally {
            fs.writeFileSync = originalWriteFileSync;
        }

        expect(injected).toBe(1);
        expect(fs.existsSync(fixture.destination)).toBeFalse();
        expect(stagingRoots(fixture.root)).toEqual([]);
    });

    test("preserves a destination created by another process before atomic rename wins the race", () => {
        const originalRenameSync = fs.renameSync;
        const competingMarker = path.join(fixture.destination, "created-by-competing-process.txt");
        let injected = false;
        fs.renameSync = ((source, destination) => {
            if (!injected && path.resolve(String(destination)) === path.resolve(fixture.destination)) {
                injected = true;
                fs.mkdirSync(fixture.destination);
                fs.writeFileSync(competingMarker, "preserve-me");
                throw Object.assign(new Error("EEXIST: destination won by competing process"), {code: "EEXIST"});
            }
            return originalRenameSync(source, destination);
        }) as typeof fs.renameSync;

        try {
            expect(() => prepareSolcordDisposableAcceptance({
                sourceDiscordAppDir: fixture.sourceApp,
                solcordAsar: fixture.solcordAsar,
                destinationRoot: fixture.destination,
                expectedSolcordSha256: fixture.expectedHash,
                expectedSolcordSourceCommit: fixture.expectedSourceCommit
            })).toThrow("destination won by competing process");
        }
        finally {
            fs.renameSync = originalRenameSync;
        }

        expect(injected).toBeTrue();
        expect(fs.readFileSync(competingMarker, "utf8")).toBe("preserve-me");
        expect(stagingRoots(fixture.root)).toEqual([]);
    });

    test("rejects source-tree junctions rather than following them", () => {
        const external = path.join(fixture.root, "external");
        fs.mkdirSync(external);
        fs.writeFileSync(path.join(external, "private.txt"), "must-not-be-read");
        fs.symlinkSync(external, path.join(fixture.sourceApp, "linked-profile"), "junction");

        expect(() => prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: fixture.sourceApp,
            solcordAsar: fixture.solcordAsar,
            destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
            expectedSolcordSourceCommit: fixture.expectedSourceCommit,
            dryRun: true
        })).toThrow(/symbolic link|junction|reparse/i);
        expect(fs.existsSync(fixture.destination)).toBeFalse();
    });

    test("rejects relative input paths", () => {
        expect(() => prepareSolcordDisposableAcceptance({
            sourceDiscordAppDir: "app-1.0.9999",
            solcordAsar: fixture.solcordAsar,
            destinationRoot: fixture.destination,
            expectedSolcordSha256: fixture.expectedHash,
            expectedSolcordSourceCommit: fixture.expectedSourceCommit,
            dryRun: true
        })).toThrow("absolute");
    });
});
