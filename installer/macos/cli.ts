// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {MacInstaller, MAC_CHANNELS, readMacPackage, type MacChannel} from "./engine";
import {createMacNativeAdapter, launchMacBundle} from "./native";
import {runMacInstallerSelfTest} from "./self-test";

const output = (text: string) => {process.stdout.write(text + "\n");};

const HELP = `Solcord for macOS — preview

Usage: solcord-macos <command> [--channel stable|ptb|canary] [--source /Applications/Discord.app]

Commands: inspect, install, update, repair, verify, rollback, recover, uninstall, launch
CI: --self-test runs native fixtures in a private temporary folder, never Discord.

Install/update/repair stage a verified copy under ~/Applications/Solcord.
The original Discord app, profiles, plugins, themes and settings are preserved.
Quit BOTH Discord copies before changing or launching the managed copy.
No sudo, security-setting changes, quarantine removal or background downloads.

This preview is locally ad-hoc signed, not Developer ID signed or notarized.
It needs real macOS acceptance; this tool never bypasses a Gatekeeper rejection.
`;
export function runMacCLI(args: string[]): void {
    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {output(HELP); return;}
    const command = args[0] === "--self-test" ? "self-test" : args[0];
    if (!["inspect", "install", "update", "repair", "verify", "rollback", "recover", "uninstall", "launch", "self-test"].includes(command)) throw Error("Unknown command. Run solcord-macos --help.");
    let channel: MacChannel = "stable", source: string | undefined;
    for (let index = 1; index < args.length; index++) {
        const value = args[++index];
        if (args[index - 1] === "--channel" && value && Object.hasOwn(MAC_CHANNELS, value)) channel = value as MacChannel;
        else if (args[index - 1] === "--source" && value && path.isAbsolute(value)) source = value;
        else throw Error("Invalid option. Run solcord-macos --help.");
    }
    const adapter = createMacNativeAdapter();
    if (command === "self-test") {
        const expected = process.env.SOLCORD_MACOS_PACKAGE_SHA256;
        if (!expected) throw Error("The native self-test requires a compiled package with a pinned manifest.");
        output(JSON.stringify(runMacInstallerSelfTest(path.dirname(process.execPath), expected))); return;
    }
    const home = fs.realpathSync(os.homedir());
    const engine = new MacInstaller(home, channel, adapter);
    if (command === "inspect") {output(JSON.stringify(engine.inspect(), null, 2)); return;}
    if (command === "verify") {const receipt = engine.verify(); output(`Verified ${receipt.package.candidateLabel}: ${engine.target}`); return;}
    if (command === "recover") {engine.recover(); output("Recovery completed. All transaction copies and profiles were preserved."); return;}
    if (command === "uninstall") {engine.uninstall(); output("Solcord copy removed to recovery storage. The original Discord app and all profiles remain in place."); return;}
    if (command === "rollback") {const receipt = engine.rollback(); output(`Rolled back and verified ${receipt.package.candidateLabel}.`); return;}
    if (command === "launch") {engine.verify(); launchMacBundle(engine.target); output(`Opened the exact managed app: ${engine.target}`); return;}
    const expected = process.env.SOLCORD_MACOS_PACKAGE_SHA256;
    if (!expected) throw Error("Use the packaged macOS installer. This source command has no pinned release identity.");
    const {manifest, artifact} = readMacPackage(path.dirname(process.execPath), expected);
    const candidates = [path.join("/Applications", MAC_CHANNELS[channel]), path.join(home, "Applications", MAC_CHANNELS[channel])];
    source ??= candidates.find(candidate => fs.existsSync(candidate));
    if (!source) throw Error("Original Discord was not found. Supply --source with its full .app path.");
    output(`Preparing ${manifest.candidateLabel}. The original ${source} stays unchanged.`);
    const receipt = engine.install(source, manifest, artifact);
    output(`Installed and verified ${receipt.package.candidateLabel}: ${engine.target}\nLaunch with: solcord-macos launch --channel ${channel}`);
}
if (import.meta.main) {
    try {runMacCLI(process.argv.slice(2));}
    catch (error) {process.stderr.write(`Solcord macOS: ${error instanceof Error ? error.message : "Operation failed"}\n`); process.exitCode = 1;}
}
