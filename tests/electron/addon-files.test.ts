import {afterEach, describe, expect, spyOn, test} from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {writeAddonFile} from "../../src/electron/main/modules/addon-files";
import {safeAddonFileName} from "../../src/common/solcord/addon-file-policy";
const roots: string[] = [];
afterEach(() => {for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true});});
function fixture() {const root = fs.mkdtempSync(path.join(os.tmpdir(), "solcord-addon-write-")); roots.push(root); fs.mkdirSync(path.join(root, "plugins")); fs.mkdirSync(path.join(root, "themes")); return root;}
describe("owned addon writes", () => {
    test("rejects traversal, absolute paths, wrong suffixes and Windows devices", () => {
        for (const file of ["../marker.plugin.js", "..\\marker.plugin.js", "C:\\marker.plugin.js", "file.theme.css", "CON.plugin.js"]) expect(() => safeAddonFileName(file, "plugin")).toThrow();
    });
    test("commits installs exclusively and updates only the unchanged owned file", async () => {
        const root = fixture(), file = path.join(root, "plugins", "Example.plugin.js");
        await writeAddonFile(root, "plugin", "Example.plugin.js", "original");
        await expect(writeAddonFile(root, "plugin", "Example.plugin.js", "overwrite")).rejects.toThrow("exists");
        const digest = crypto.createHash("sha256").update("original").digest("hex");
        await writeAddonFile(root, "plugin", "Example.plugin.js", "updated", digest);
        await expect(writeAddonFile(root, "plugin", "Example.plugin.js", "stale", digest)).rejects.toThrow("changed");
        expect(fs.readFileSync(file, "utf8")).toBe("updated");
    });
    test("rejects a linked folder and preserves files beyond the selected root", async () => {
        const root = fixture(), outside = fixture(); fs.rmdirSync(path.join(root, "plugins"));
        fs.symlinkSync(path.join(outside, "plugins"), path.join(root, "plugins"), process.platform === "win32" ? "junction" : "dir");
        await expect(writeAddonFile(root, "plugin", "Example.plugin.js", "marker")).rejects.toThrow();
        expect(fs.readdirSync(path.join(outside, "plugins"))).toEqual([]);
    });
    test("concurrent updates cannot both claim the same previous bytes", async () => {
        const root = fixture(); await writeAddonFile(root, "plugin", "Race.plugin.js", "old");
        const digest = crypto.createHash("sha256").update("old").digest("hex");
        const results = await Promise.allSettled([writeAddonFile(root, "plugin", "Race.plugin.js", "one", digest), writeAddonFile(root, "plugin", "Race.plugin.js", "two", digest)]);
        expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
        expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
        expect(fs.readFileSync(path.join(root, "plugins", "Race.plugin.js"), "utf8")).toBe("one");
    });
    test("a parent swapped during asynchronous open receives no downloaded bytes", async () => {
        const root = fixture(), outside = fixture();
        const original = fs.promises.open.bind(fs.promises);
        let swapped = false;
        const open = spyOn(fs.promises, "open").mockImplementation(async (file, flags, mode) => {
            if (!swapped && String(file).includes("Swap.plugin.js")) {
                swapped = true;
                fs.renameSync(path.join(root, "plugins"), path.join(root, "original-plugins"));
                fs.symlinkSync(path.join(outside, "plugins"), path.join(root, "plugins"), process.platform === "win32" ? "junction" : "dir");
            }
            return original(file, flags, mode);
        });
        try {await expect(writeAddonFile(root, "plugin", "Swap.plugin.js", "private downloaded bytes")).rejects.toThrow("ownership");}
        finally {open.mockRestore();}
        expect(fs.readdirSync(path.join(outside, "plugins"))).toEqual([]);
    });
});
