// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {MacInstaller, macBundleHash, readMacPackage} from "./engine";
import {createMacNativeAdapter} from "./native";

/** Native fixtures only. Never opens Discord or touches the real home/profile. */
export function runMacInstallerSelfTest(packageRoot: string, manifestSha256: string) {
    if (process.platform !== "darwin") throw Error("Native self-test requires macOS.");
    const {manifest, artifact} = readMacPackage(packageRoot, manifestSha256);
    const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "solcord-macos-self-test-"));
    const home = path.join(directory, "home"), source = path.join(directory, "Renamed Discord Fixture.app");
    fs.mkdirSync(home); fs.mkdirSync(path.join(source, "Contents", "MacOS"), {recursive: true}); fs.mkdirSync(path.join(source, "Contents", "Resources"));
    fs.copyFileSync("/usr/bin/true", path.join(source, "Contents", "MacOS", "Discord")); fs.chmodSync(path.join(source, "Contents", "MacOS", "Discord"), 0o755);
    fs.writeFileSync(path.join(source, "Contents", "Info.plist"), `<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.hnc.Discord</string><key>CFBundleExecutable</key><string>Discord</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string></dict></plist>`);
    fs.writeFileSync(path.join(source, "Contents", "Resources", "app.asar"), "controlled-discord-startup-fixture");
    const exec = (command: string, args: string[]) => execFileSync(command, args, {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000});
    const entitlements = path.join(directory, "fixture-entitlements.plist"); fs.writeFileSync(entitlements, `<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.network.client</key><true/></dict></plist>`);
    exec("/usr/bin/codesign", ["--force", "--sign", "-", "--options", "runtime", "--entitlements", entitlements, source]);
    exec("/usr/bin/xattr", ["-w", "com.solcord.fixture", "preserved", source]);
    const originalHash = macBundleHash(source);
    const profile = path.join(home, "Library", "Application Support", "discord", "profile-sentinel"); fs.mkdirSync(path.dirname(profile), {recursive: true}); fs.writeFileSync(profile, "private-fixture");
    const native = createMacNativeAdapter(path.join(home, "Applications", "Solcord"));
    const engine = new MacInstaller(home, "stable", native);
    const first = engine.install(source, manifest, artifact); engine.verify();
    if (exec("/usr/bin/xattr", ["-p", "com.solcord.fixture", engine.target]).trim() !== "preserved") throw Error("Native copy did not preserve extended attributes.");
    const signed = exec("/usr/bin/codesign", ["--display", "--entitlements", "-", engine.target]);
    if (!signed.includes("com.apple.security.network.client") || signed.includes("disable-library-validation")) throw Error("The original entitlement set was not preserved.");
    engine.install(source, manifest, artifact); engine.rollback(); engine.verify();
    const interrupted = new MacInstaller(home, "stable", native, phase => {if (phase === "old-moved") throw Error("controlled-interruption");});
    let interruptionObserved = false;
    try {interrupted.install(source, manifest, artifact);}
    catch (error) {if (!(error instanceof Error) || error.message !== "controlled-interruption") throw error; interruptionObserved = true;}
    if (!interruptionObserved) throw Error("The recovery fixture did not interrupt.");
    engine.recover(); const restored = engine.verify();
    if (restored.bundleSha256 !== first.bundleSha256) throw Error("Recovery did not restore the verified prior copy.");
    engine.uninstall();
    if (fs.existsSync(engine.target) || macBundleHash(source) !== originalHash || fs.readFileSync(profile, "utf8") !== "private-fixture") throw Error("The fixture did not preserve its original app and profile.");
    return {kind: "solcord-macos-native-self-test", passed: true, arch: process.arch, sourceCommit: manifest.sourceCommit, version: manifest.version, candidateLabel: manifest.candidateLabel, artifactSha256: manifest.artifact.sha256, originalPreserved: true, profilesPreserved: true, attributesPreserved: true, entitlementsPreserved: true, recoveryVerified: true, launchedDiscord: false};
}
