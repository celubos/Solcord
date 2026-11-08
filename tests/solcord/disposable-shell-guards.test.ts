import {afterEach, describe, expect, test} from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {installDisposableShellGuards, renderDisposableAcceptanceShim} from "../../scripts/prepare-solcord-disposable-acceptance";

const ownedRoots: string[] = [];
afterEach(() => {for (const root of ownedRoots.splice(0)) fs.rmSync(root, {recursive: true, force: true});});

describe("disposable Windows shell boundary", () => {
    test("blocks Electron shell integration and the copied host's actual native updater shortcut route", () => {
        const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "solcord-shell-guard-")); ownedRoots.push(fixture);
        const lane = path.join(fixture, "lane"); const outside = path.join(fixture, "real-shell");
        fs.mkdirSync(path.join(lane, "runtime"), {recursive: true}); fs.mkdirSync(outside);
        const ownerLink = path.join(outside, "Discord.lnk"); fs.writeFileSync(ownerLink, "owner-shortcut-bytes");
        const shellCalls: string[] = [];
        const app = Object.fromEntries(["setAsDefaultProtocolClient", "setLoginItemSettings", "setUserTasks", "setJumpList", "addRecentDocument", "clearRecentDocuments"].map(name => [name, () => {shellCalls.push(name); return true;}])) as Record<string, (...args: unknown[]) => unknown>;
        const shell = {writeShortcutLink: (..._args: unknown[]) => {shellCalls.push("writeShortcutLink"); return true;}};
        let nativeWrites = 0;
        class NativeUpdater {
            #commands = 0;
            known_folder(_name: string) {return outside;}
            create_shortcut(options: {shortcut_path: string;}) {nativeWrites++; fs.writeFileSync(options.shortcut_path, "replaced-by-copied-host"); return true;}
            command(_command: string) {return ++this.#commands;}
        }
        const nativeModule = {Updater: NativeUpdater};
        const moduleApi = {prototype: {require(_request: string): unknown {return nativeModule;}}};
        const subprocessCalls: string[] = [];
        const childProcess = Object.fromEntries(["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync"].map(name => [name, (..._args: unknown[]) => {subprocessCalls.push(name); return "allowed-native-helper";}])) as Record<string, (...args: unknown[]) => unknown>;
        installDisposableShellGuards({app, shell}, moduleApi, fs, path, lane, childProcess);
        for (const name of Object.keys(app)) app[name]({target: ownerLink});
        expect(shell.writeShortcutLink(ownerLink, "update", {target: "copied-runtime"})).toBe(false);
        expect(shellCalls).toEqual([]);
        for (const name of Object.keys(childProcess)) expect(() => childProcess[name]("C:\\Windows\\System32\\reg.exe", ["add", "HKCU\\Software\\Classes\\discord"])).toThrow("blocked");
        expect(() => childProcess.spawn("Update.exe", ["--createShortcut", "Discord.exe"])).toThrow("blocked");
        expect(() => childProcess.spawn("cmd.exe", ["/c", "reg add fixture"])).toThrow("blocked");
        expect(subprocessCalls).toEqual([]);
        expect(childProcess.spawn("verified-native-helper.exe", ["--fixture"])).toBe("allowed-native-helper");

        const copiedNativePath = path.join(lane, "runtime", "updater.node");
        const guarded = moduleApi.prototype.require(copiedNativePath) as {Updater: typeof NativeUpdater;};
        expect(moduleApi.prototype.require(copiedNativePath)).toBe(guarded);
        const updater = new guarded.Updater();
        for (const folder of ["desktop", "programs", "startup"]) {
            const destination = updater.known_folder(folder);
            expect(destination).toBe(path.join(lane, "profile", "Shell", folder));
            expect(fs.lstatSync(destination).isDirectory()).toBe(true);
        }
        // This is the exact native method called by bundle.js updateShortcuts.
        expect(updater.create_shortcut({shortcut_path: ownerLink})).toBe(false);
        expect(nativeWrites).toBe(0);
        expect(fs.readFileSync(ownerLink, "utf8")).toBe("owner-shortcut-bytes");
        expect(updater.command("fixture-command")).toBe(1); // native/private this binding survives.
        const unrelated = moduleApi.prototype.require(path.join(fixture, "other", "updater.node")) as {Updater: typeof NativeUpdater;};
        expect(unrelated.Updater).toBe(NativeUpdater); // normal external modules are not patched.
        expect(new NativeUpdater().known_folder("programs")).toBe(outside);
        expect(() => updater.known_folder("../outside")).toThrow("Unsupported");
    });

    test("the generated CommonJS shim parses and installs the policy before either host runtime is required", () => {
        const source = renderDisposableAcceptanceShim();
        expect(() => new vm.Script(source)).not.toThrow();
        const guard = source.indexOf("os-shell-policy-installed");
        expect(guard).toBeGreaterThan(source.indexOf("environment-validated"));
        expect(guard).toBeLessThan(source.indexOf("require(\"../solcord.asar\")"));
        expect(guard).toBeLessThan(source.indexOf("require(\"../betterdiscord.app.asar\")"));
        expect(source).not.toContain("Debugger.getScriptSource");
        expect(source).not.toContain("renderer-static-code");
        expect(source).not.toContain("renderer-module-diagnostic");
        expect(source).not.toContain("executeJavaScript");
    });
});
