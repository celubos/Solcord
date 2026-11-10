// SPDX-License-Identifier: Apache-2.0
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {MacChannel, MacNativeAdapter} from "./engine";

const BUNDLE_IDS: Record<MacChannel, string> = {stable: "com.hnc.Discord", ptb: "com.hnc.DiscordPTB", canary: "com.hnc.DiscordCanary"};
function run(executable: string, args: string[]): string {
    return execFileSync(executable, args, {encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"]}).trim();
}
export function isMacDiscordCommandRunning(command: string, sources: readonly string[], managedRoot: string): boolean {
    const executable = command.trim();
    return executable.startsWith(`${managedRoot}/`)
        || sources.some(source => executable.startsWith(`${source}/Contents/`))
        || /\/Discord(?: PTB| Canary)?\.app\/Contents\//.test(executable);
}
export function createMacNativeAdapter(managedRoot = path.join(fs.realpathSync(os.homedir()), "Applications", "Solcord")): MacNativeAdapter {
    if (process.platform !== "darwin") throw Error("The native macOS installer can run only on macOS. No application was changed.");
    const sources = new Set<string>();
    return {
        assertIdle(source) {
            if (source) sources.add(fs.existsSync(source) ? fs.realpathSync(source) : path.resolve(source));
            // Executable paths only: no arguments, environment, credentials, or account data.
            const commands = run("/bin/ps", ["-axww", "-o", "comm="]);
            if (commands.split("\n").some(command => isMacDiscordCommandRunning(command, [...sources], managedRoot))) throw Error("Quit both the original Discord and every Solcord Discord copy, including their helpers, then retry.");
        },
        verifySource(source, channel) {
            const identifier = run("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", path.join(source, "Contents", "Info.plist")]);
            if (identifier !== BUNDLE_IDS[channel]) throw Error("The selected app does not match the requested Discord channel.");
            run("/usr/bin/codesign", ["--verify", "--deep", "--strict", source]);
        },
        copyBundle(source, target) {
            // ditto preserves framework links, ACLs and extended attributes, including quarantine.
            run("/usr/bin/ditto", ["--rsrc", "--extattr", "--acl", source, target]);
        },
        signBundle(target) {
            // Keep existing permissions and hardened-runtime flags. Do not add
            // entitlements, strip quarantine, disable Gatekeeper, or change the source.
            // Designated requirements are regenerated for this local ad-hoc identity.
            run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", "--preserve-metadata=entitlements,flags,runtime", target]);
        },
        verifySignature(target) {run("/usr/bin/codesign", ["--verify", "--deep", "--strict", target]);},
        isProcessAlive(pid) {
            try {process.kill(pid, 0); return true;}
            catch (error) {return (error as NodeJS.ErrnoException).code !== "ESRCH";}
        }
    };
}
export function launchMacBundle(target: string): void {
    createMacNativeAdapter().assertIdle();
    run("/usr/bin/open", ["-n", target]);
}
