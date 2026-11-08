// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {afterEach, expect, test} from "bun:test";
import {injectDeveloperLoader, validateDeveloperLayout} from "../../scripts/helpers/developer-inject";

const roots: string[] = [];
afterEach(() => {for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true});});
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "solcord-dev-inject-"));
    roots.push(root);
    fs.writeFileSync(path.join(root, "app.asar"), "original-discord");
    return root;
}

test("packed developer injection loads the core and preserved Discord entry, including reinjection", () => {
    const root = fixture();
    for (let cycle = 0; cycle < 3; cycle++) {
        injectDeveloperLoader(root, "developer-core");
        const loaded: string[] = [];
        const module = {exports: null as unknown};
        vm.runInNewContext(fs.readFileSync(path.join(root, "app", "index.js"), "utf8"), {module, require: (target: string) => {loaded.push(target); return target;}});
        expect(loaded).toEqual(["developer-core", "../betterdiscord.app.asar"]);
        expect(module.exports).toBe("../betterdiscord.app.asar");
        expect(fs.readFileSync(path.join(root, "betterdiscord.app.asar"), "utf8")).toBe("original-discord");
    }
});

test("loose layouts fail before their original entry is renamed or changed", () => {
    const root = fixture();
    fs.unlinkSync(path.join(root, "app.asar"));
    fs.mkdirSync(path.join(root, "app"));
    fs.writeFileSync(path.join(root, "app", "index.js"), "original-loose-entry");
    expect(() => validateDeveloperLayout(root)).toThrow("packed Discord startup archive");
    expect(() => injectDeveloperLoader(root, "developer-core")).toThrow();
    expect(fs.readFileSync(path.join(root, "app", "index.js"), "utf8")).toBe("original-loose-entry");
    expect(fs.existsSync(path.join(root, "betterdiscord.app"))).toBeFalse();
});

test.each(["after-package", "after-index", "after-bootstrap"])("first injection restores the original startup after %s fails", point => {
    const root = fixture();
    expect(() => injectDeveloperLoader(root, "developer-core", stage => {if (stage === point) throw new Error("fixture interruption");})).toThrow("fixture interruption");
    expect(fs.readFileSync(path.join(root, "app.asar"), "utf8")).toBe("original-discord");
    expect(fs.existsSync(path.join(root, "betterdiscord.app.asar"))).toBeFalse();
    expect(fs.existsSync(path.join(root, "app"))).toBeFalse();
    expect(fs.readdirSync(root)).toEqual(["app.asar"]);
});

test("reinjection failure preserves the previous complete loader and rejects owner files", () => {
    const root = fixture();
    injectDeveloperLoader(root, "old-core");
    const original = fs.readFileSync(path.join(root, "app", "index.js"), "utf8");
    expect(() => injectDeveloperLoader(root, "new-core", point => {if (point === "after-index") throw new Error("fixture interruption");})).toThrow();
    expect(fs.readFileSync(path.join(root, "app", "index.js"), "utf8")).toBe(original);
    fs.writeFileSync(path.join(root, "app", "owner.txt"), "owner-data");
    expect(() => injectDeveloperLoader(root, "new-core")).toThrow("owner files");
    expect(fs.readFileSync(path.join(root, "app", "owner.txt"), "utf8")).toBe("owner-data");
});
