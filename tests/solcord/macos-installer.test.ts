import {describe, expect, test} from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {MacInstaller, macBundleHash, macHash, readMacPackage, type MacNativeAdapter, type MacPackageManifest} from "../../installer/macos/engine";
import {createMacNativeAdapter, isMacDiscordCommandRunning} from "../../installer/macos/native";

function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "solcord-macos-test-")));
    const home = path.join(root, "home"), source = path.join(root, "Original Discord.app"), resources = path.join(source, "Contents", "Resources");
    fs.mkdirSync(resources, {recursive: true}); fs.mkdirSync(home);
    fs.writeFileSync(path.join(resources, "app.asar"), "controlled-discord-original");
    fs.writeFileSync(path.join(source, "Contents", "Info.plist"), "controlled-info");
    const profile = path.join(home, "Library", "Application Support", "discord", "private-profile"); fs.mkdirSync(path.dirname(profile), {recursive: true}); fs.writeFileSync(profile, "private-profile-sentinel");
    const plugins = path.join(home, "Library", "Application Support", "BetterDiscord", "plugins", "owner.plugin.js"); fs.mkdirSync(path.dirname(plugins), {recursive: true}); fs.writeFileSync(plugins, "owner-plugin-sentinel");
    let running = false, signingFails = false, copySourceChanges = false;
    const adapter: MacNativeAdapter = {
        assertIdle() {if (running) throw Error("running");},
        verifySource() {},
        copyBundle(from, to) {
            fs.cpSync(from, to, {recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false, preserveTimestamps: true});
            if (copySourceChanges) fs.writeFileSync(path.join(from, "source-drift"), "changed");
        },
        signBundle(target) {if (signingFails) throw Error("signing failed"); fs.writeFileSync(path.join(target, "Contents", "fixture-signature"), "local-signature");},
        verifySignature(target) {if (!fs.existsSync(path.join(target, "Contents", "fixture-signature"))) throw Error("signature missing");},
        isProcessAlive: () => running
    };
    const makePackage = (version = "2.0.1") => {
        const directory = path.join(root, `package-${crypto.randomUUID()}`); fs.mkdirSync(directory);
        const artifact = path.join(directory, "solcord.asar"); fs.writeFileSync(artifact, `controlled-solcord-${version}`);
        const build = path.join(directory, "solcord-build-manifest.json"); fs.writeFileSync(build, "controlled-source-build-manifest");
        const manifest: MacPackageManifest = {schemaVersion: 1, kind: "solcord-macos-preview", version, candidateLabel: `v${version}`, sourceCommit: "a".repeat(40), artifact: {file: "solcord.asar", bytes: fs.statSync(artifact).size, sha256: macHash(artifact)}, buildManifestSha256: macHash(build)};
        const file = path.join(directory, "solcord-macos-manifest.json"); fs.writeFileSync(file, JSON.stringify(manifest));
        return {directory, manifest, artifact, manifestHash: macHash(file)};
    };
    return {root,
home,
source,
profile,
plugins,
adapter,
makePackage,
        engine: (fault?: (phase: string) => void) => new MacInstaller(home, "stable", adapter, fault),
        get running() {return running;},
        set running(value: boolean) {running = value;},
        get signingFails() {return signingFails;},
        set signingFails(value: boolean) {signingFails = value;},
        get copySourceChanges() {return copySourceChanges;},
        set copySourceChanges(value: boolean) {copySourceChanges = value;}};
}

describe("macOS preview transactional installer", () => {
    test("install, update, rollback and uninstall preserve the original bundle and all profiles", () => {
        const f = fixture(), one = f.makePackage(), two = f.makePackage("2.0.2"), originalHash = macBundleHash(f.source), engine = f.engine();
        const initial = engine.install(f.source, one.manifest, one.artifact);
        expect(engine.verify().package.version).toBe("2.0.1");
        expect(fs.readFileSync(path.join(engine.target, "Contents", "Resources", "betterdiscord.app.asar"), "utf8")).toBe("controlled-discord-original");
        expect(fs.readFileSync(path.join(engine.target, "Contents", "Resources", "app", "index.js"), "utf8")).toContain(one.manifest.artifact.sha256);
        const updated = engine.install(f.source, two.manifest, two.artifact); expect(updated.previous).toBeDefined();
        expect(engine.verify().package.version).toBe("2.0.2");
        expect(engine.rollback().package.version).toBe("2.0.1"); expect(engine.verify().bundleSha256).toBe(initial.bundleSha256);
        engine.uninstall(); expect(fs.existsSync(engine.target)).toBe(false); expect(engine.inspect().installed).toBe(false);
        expect(macBundleHash(f.source)).toBe(originalHash);
        expect(fs.readFileSync(f.profile, "utf8")).toBe("private-profile-sentinel"); expect(fs.readFileSync(f.plugins, "utf8")).toBe("owner-plugin-sentinel");
        expect(fs.readdirSync(path.join(engine.channelRoot, "state", "transactions")).length).toBe(4);
    });

    for (const phase of ["prepared", "old-moved", "new-live", "receipt-written"]) {
        test(`recovers an interrupted update at ${phase} without deleting either app copy`, () => {
            const f = fixture(), one = f.makePackage(), two = f.makePackage("2.0.2"), engine = f.engine();
            const previous = engine.install(f.source, one.manifest, one.artifact);
            expect(() => f.engine(current => {if (current === phase) throw Error("interrupted");}).install(f.source, two.manifest, two.artifact)).toThrow("interrupted");
            expect(engine.inspect().interrupted).toBe(true);
            expect(() => engine.install(f.source, two.manifest, two.artifact)).toThrow("recover");
            engine.recover(); expect(engine.verify().bundleSha256).toBe(previous.bundleSha256); expect(engine.inspect().interrupted).toBe(false);
            expect(fs.readFileSync(f.profile, "utf8")).toBe("private-profile-sentinel");
        });
        test(`recovers a first install interrupted at ${phase} to the original uninstalled state`, () => {
            const f = fixture(), one = f.makePackage(), engine = f.engine();
            expect(() => f.engine(current => {if (current === phase) throw Error("interrupted");}).install(f.source, one.manifest, one.artifact)).toThrow();
            engine.recover(); expect(engine.inspect().installed).toBe(false); expect(fs.existsSync(engine.target)).toBe(false);
            expect(fs.readFileSync(path.join(f.source, "Contents", "Resources", "app.asar"), "utf8")).toBe("controlled-discord-original");
        });
    }

    test("interrupted uninstall restores the previous managed copy before final removal", () => {
        const f = fixture(), one = f.makePackage(), engine = f.engine(); engine.install(f.source, one.manifest, one.artifact);
        expect(() => f.engine(phase => {if (phase === "old-moved") throw Error("interrupted");}).uninstall()).toThrow();
        engine.recover(); expect(engine.verify().package.version).toBe("2.0.1");
    });
    test("a signing failure leaves the current installed version and original unchanged", () => {
        const f = fixture(), one = f.makePackage(), two = f.makePackage("2.0.2"), engine = f.engine(); const receipt = engine.install(f.source, one.manifest, one.artifact), sourceHash = macBundleHash(f.source);
        f.signingFails = true; expect(() => engine.install(f.source, two.manifest, two.artifact)).toThrow("signing failed");
        expect(engine.verify().bundleSha256).toBe(receipt.bundleSha256); expect(macBundleHash(f.source)).toBe(sourceHash); expect(engine.inspect().interrupted).toBe(false);
    });
    test("source drift during staging aborts before the current app switches", () => {
        const f = fixture(), one = f.makePackage(), engine = f.engine(); f.copySourceChanges = true;
        expect(() => engine.install(f.source, one.manifest, one.artifact)).toThrow("changed during staging"); expect(fs.existsSync(engine.target)).toBe(false);
    });
    test("repair preserves modified owned copies without treating them as verified rollback versions", () => {
        const f = fixture(), one = f.makePackage(), engine = f.engine(); engine.install(f.source, one.manifest, one.artifact);
        fs.writeFileSync(path.join(engine.target, "owner-extra"), "preserve-me");
        expect(() => engine.verify()).toThrow("changed");
        const repaired = engine.install(f.source, one.manifest, one.artifact); expect(repaired.previous).toBeUndefined(); expect(() => engine.rollback()).toThrow("no verified previous");
        const backups = fs.readdirSync(path.join(engine.channelRoot, "state", "transactions")).map(id => path.join(engine.channelRoot, "state", "transactions", id, "previous.app", "owner-extra"));
        expect(backups.some(file => fs.existsSync(file) && fs.readFileSync(file, "utf8") === "preserve-me")).toBe(true);
    });
    test("changed recovery files stop recovery rather than overwriting them", () => {
        const f = fixture(), one = f.makePackage(), two = f.makePackage("2.0.2"), engine = f.engine(); engine.install(f.source, one.manifest, one.artifact);
        expect(() => f.engine(phase => {if (phase === "new-live") throw Error("interrupted");}).install(f.source, two.manifest, two.artifact)).toThrow();
        fs.writeFileSync(path.join(engine.target, "owner-extra"), "preserve-me"); expect(() => engine.recover()).toThrow("ambiguous");
        expect(fs.readFileSync(path.join(engine.target, "owner-extra"), "utf8")).toBe("preserve-me"); expect(engine.inspect().interrupted).toBe(true);
    });
    test("active installers and running Discord copies block mutations; abandoned locks can be recovered", () => {
        const f = fixture(), one = f.makePackage(), engine = f.engine(); f.running = true;
        expect(() => engine.install(f.source, one.manifest, one.artifact)).toThrow("running"); f.running = false;
        engine.install(f.source, one.manifest, one.artifact);
        const lock = path.join(engine.channelRoot, "state", "operation.lock"); fs.writeFileSync(lock, JSON.stringify({pid: 12345, nonce: "other"})); f.running = true;
        expect(() => engine.recover()).toThrow("Another installer"); expect(fs.existsSync(lock)).toBe(true); f.running = false;
        engine.recover(); expect(fs.existsSync(lock)).toBe(false); expect(engine.verify().package.version).toBe("2.0.1");
    });
    test("unknown target data and a managed copy selected as the source are refused", () => {
        const f = fixture(), one = f.makePackage(), engine = f.engine(); fs.mkdirSync(engine.target, {recursive: true}); fs.writeFileSync(path.join(engine.target, "owner-file"), "preserve-me");
        expect(() => engine.install(f.source, one.manifest, one.artifact)).toThrow(); expect(fs.readFileSync(path.join(engine.target, "owner-file"), "utf8")).toBe("preserve-me");
        const g = fixture(), other = g.makePackage(), managed = g.engine(); managed.install(g.source, other.manifest, other.artifact);
        expect(() => managed.install(managed.target, other.manifest, other.artifact)).toThrow("outside the managed");
    });
    test("manifest pinning, payload tampering and missing rollback payloads fail closed", () => {
        const f = fixture(), one = f.makePackage(), two = f.makePackage("2.0.2"), engine = f.engine();
        expect(readMacPackage(one.directory, one.manifestHash).manifest.candidateLabel).toBe("v2.0.1");
        expect(() => readMacPackage(one.directory, "0".repeat(64))).toThrow("manifest changed");
        engine.install(f.source, one.manifest, one.artifact); engine.install(f.source, two.manifest, two.artifact);
        fs.unlinkSync(path.join(engine.channelRoot, "state", "payloads", `${one.manifest.artifact.sha256}.asar`));
        expect(() => engine.rollback()).toThrow(); expect(engine.verify().package.version).toBe("2.0.2");
        fs.writeFileSync(two.artifact, "changed"); expect(() => readMacPackage(two.directory, two.manifestHash)).toThrow("integrity");
    });
    test("hardlinked files are never overwritten or trusted as owned installer metadata", () => {
        const f = fixture(), one = f.makePackage(), linked = path.join(f.root, "linked-manifest");
        fs.linkSync(path.join(one.directory, "solcord-macos-manifest.json"), linked);
        expect(() => readMacPackage(one.directory, one.manifestHash)).toThrow("regular file");
    });
    test("process checks cover renamed original bundles, managed recovery copies and standard Discord helpers", () => {
        const managed = "/fixture-home/Applications/Solcord", source = "/Applications/Other.app";
        expect(isMacDiscordCommandRunning("/Applications/Other.app/Contents/MacOS/Discord", [source], managed)).toBe(true);
        expect(isMacDiscordCommandRunning(`${managed}/stable/state/transactions/id/previous.app/Contents/MacOS/Discord`, [], managed)).toBe(true);
        expect(isMacDiscordCommandRunning("/Applications/Discord Canary.app/Contents/Frameworks/Discord Helper.app/Contents/MacOS/Discord Helper", [], managed)).toBe(true);
        expect(isMacDiscordCommandRunning("/Applications/Other.app-foreign/Contents/MacOS/App", [source], managed)).toBe(false);
        expect(isMacDiscordCommandRunning("/fixture-home/Applications/Solcord-foreign/app", [], managed)).toBe(false);
    });
    test.skipIf(process.platform === "win32")("safe internal framework links survive copying while escaping links are rejected", () => {
        const f = fixture(), one = f.makePackage(), framework = path.join(f.source, "Contents", "Frameworks", "Fixture.framework");
        fs.mkdirSync(path.join(framework, "Versions", "A"), {recursive: true}); fs.writeFileSync(path.join(framework, "Versions", "A", "Fixture"), "framework");
        fs.symlinkSync("A", path.join(framework, "Versions", "Current"));
        f.engine().install(f.source, one.manifest, one.artifact);
        fs.symlinkSync(f.profile, path.join(framework, "escaping")); expect(() => macBundleHash(f.source)).toThrow("escaping");
    });
    test.skipIf(process.platform === "darwin")("native macOS operations cannot accidentally run on another operating system", () => {expect(() => createMacNativeAdapter()).toThrow("only on macOS");});
});
