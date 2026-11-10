import {afterAll, describe, expect, mock, spyOn, test} from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const noop = () => {};
mock.module("@common/logger", () => ({"default": {warn: noop, err: noop}}));
mock.module("@stores/settings", () => ({"default": {}}));
mock.module("@stores/json", () => ({"default": {get: noop, set: noop}}));
mock.module("@stores/toasts", () => ({"default": {show: noop}}));
mock.module("@common/i18n", () => ({t: (key: string) => key}));
mock.module("@ui/modals", () => ({"default": {showAddonError: noop}}));
mock.module("../../src/betterdiscord/modules/react", () => ({"default": {createRef: () => ({current: null})}}));
mock.module("../../src/betterdiscord/modules/ipc", () => ({"default": {}}));
mock.module("@ui/misc/addoneditor", () => ({"default": class {}}));
mock.module("@ui/floatingwindows", () => ({"default": {}}));
mock.module("@polyfill/remote", () => ({"default": {editor: {open: noop}}}));
const {default: AddonManager} = await import("../../src/betterdiscord/modules/addonmanager");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "solcord-addon-read-"));
afterAll(() => fs.rmSync(root, {recursive: true, force: true}));
class FixtureManager extends AddonManager {
    name = "Fixture"; extension = ".plugin.js"; duplicatePattern = /\(\d+\)\.plugin\.js$/; addonFolder = root; language = "javascript"; prefix = "plugin" as const; order = 0;
    read: string[] = [];
    startAddon() {return false;} stopAddon() {return false;} initAddon() {return false;}
    readAddon(filename: string) {if (filename.startsWith("unreadable")) throw Error("fixture-read-denied"); this.read.push(filename);}
    saveState() {}
}
describe("addon startup isolation", () => {
    test("ignores unrelated metadata, missing files, links and oversized candidates while loading valid neighbors", () => {
        for (const name of ["ignored.txt", "missing.plugin.js", "linked.plugin.js", "oversized.plugin.js", "unreadable.plugin.js", "good.plugin.js"]) fs.writeFileSync(path.join(root, name), "fixture");
        const lstat = fs.lstatSync;
        const inspected: string[] = [];
        const spy = spyOn(fs, "lstatSync").mockImplementation(((file: fs.PathLike) => {
            const name = path.basename(String(file)); inspected.push(name);
            if (name === "ignored.txt") throw Error("irrelevant file must not be inspected");
            if (name === "missing.plugin.js") throw Object.assign(Error("fixture-missing"), {code: "ENOENT"});
            const stat = lstat(file);
            if (name === "linked.plugin.js") return {...stat, isFile: () => true, isSymbolicLink: () => true};
            if (name === "oversized.plugin.js") return {...stat, size: 17 * 1024 * 1024, isFile: () => true, isSymbolicLink: () => false};
            return stat;
        }) as typeof fs.lstatSync);
        try {
            const manager = new FixtureManager(); manager.readAllAddons();
            expect(manager.read).toEqual(["good.plugin.js"]);
            expect(inspected).not.toContain("ignored.txt");
        }
        finally {spy.mockRestore();}
    });
});
