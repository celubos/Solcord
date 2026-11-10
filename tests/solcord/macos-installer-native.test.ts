import {describe, expect, test} from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {MacInstaller, macBundleHash, macHash, type MacPackageManifest} from "../../installer/macos/engine";
import {createMacNativeAdapter} from "../../installer/macos/native";

describe.skipIf(process.platform !== "darwin")("native macOS copy/sign/verify/recovery fixtures", () => {
    test("ditto preserves attributes and local signing preserves original entitlements without modifying the source", () => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "solcord-macos-native-"))), home = path.join(root, "home"), source = path.join(root, "Discord.app");
        fs.mkdirSync(home); fs.mkdirSync(path.join(source, "Contents", "MacOS"), {recursive: true}); fs.mkdirSync(path.join(source, "Contents", "Resources"));
        fs.copyFileSync("/usr/bin/true", path.join(source, "Contents", "MacOS", "Discord")); fs.chmodSync(path.join(source, "Contents", "MacOS", "Discord"), 0o755);
        fs.writeFileSync(path.join(source, "Contents", "Info.plist"), `<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.hnc.Discord</string><key>CFBundleExecutable</key><string>Discord</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string></dict></plist>`);
        fs.writeFileSync(path.join(source, "Contents", "Resources", "app.asar"), "controlled-discord-fixture");
        const entitlements = path.join(root, "entitlements.plist"); fs.writeFileSync(entitlements, `<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.network.client</key><true/></dict></plist>`);
        execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", "--options", "runtime", "--entitlements", entitlements, source]);
        execFileSync("/usr/bin/xattr", ["-w", "com.solcord.fixture", "preserve-this-attribute", source]);
        const sourceHash = macBundleHash(source), artifact = path.join(root, "solcord.asar"); fs.writeFileSync(artifact, "controlled-solcord-fixture");
        const manifest: MacPackageManifest = {schemaVersion: 1, kind: "solcord-macos-preview", version: "2.0.1", candidateLabel: "v2.0.1", sourceCommit: "a".repeat(40), artifact: {file: "solcord.asar", sha256: macHash(artifact), bytes: fs.statSync(artifact).size}, buildManifestSha256: "b".repeat(64)};
        const adapter = createMacNativeAdapter(), engine = new MacInstaller(home, "stable", adapter); engine.install(source, manifest, artifact);
        expect(engine.verify().package.candidateLabel).toBe("v2.0.1"); expect(macBundleHash(source)).toBe(sourceHash);
        expect(execFileSync("/usr/bin/xattr", ["-p", "com.solcord.fixture", engine.target], {encoding: "utf8"}).trim()).toBe("preserve-this-attribute");
        const signedEntitlements = execFileSync("/usr/bin/codesign", ["--display", "--entitlements", "-", engine.target], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
        expect(signedEntitlements).toContain("com.apple.security.network.client"); expect(signedEntitlements).not.toContain("disable-library-validation");
        const failing = new MacInstaller(home, "stable", adapter, phase => {if (phase === "old-moved") throw Error("controlled interruption");});
        expect(() => failing.install(source, manifest, artifact)).toThrow("controlled interruption"); engine.recover(); engine.verify();
        engine.uninstall(); expect(fs.existsSync(engine.target)).toBe(false); expect(macBundleHash(source)).toBe(sourceHash);
    });
});
