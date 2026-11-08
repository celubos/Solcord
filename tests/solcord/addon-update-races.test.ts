import {afterEach, beforeEach, describe, expect, mock, test} from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import React from "react";

const noop = () => {};
const root = fs.mkdtempSync(path.join(os.tmpdir(), "solcord-addon-update-"));
const manager = {addonFolder: root, addonList: [] as Array<{filename: string; name: string; version: string;}>};
const catalog = new Map<string, {id: number; name: string; filename: string; version: string; type: string;}>();
let request: () => Promise<Response> = async () => new Response("");
let writes = 0;
const hash = (bytes: Uint8Array) => crypto.createHash("sha256").update(bytes).digest("hex");
mock.module("@common/logger", () => ({"default": {error: noop, warn: noop, stacktrace: noop}}));
mock.module("@common/i18n", () => ({t: (key: string) => key}));
mock.module("@stores/settings", () => ({"default": {get: () => false, registerPanel: noop}}));
mock.module("@ui/settings", () => ({"default": {openSettingsPage: noop}}));
mock.module("@stores/toasts", () => ({"default": {error: noop, success: noop}}));
mock.module("@ui/notifications", () => ({"default": {show: noop}}));
mock.module("@ui/modals", () => ({"default": {showConfirmationModal: noop}}));
mock.module("@ui/updater", () => ({"default": () => null}));
mock.module("@ui/logo", () => ({Logo: () => null}));
mock.module("../../src/betterdiscord/modules/react", () => ({"default": React}));
mock.module("@modules/pluginmanager", () => ({"default": manager}));
mock.module("@modules/thememanager", () => ({"default": manager}));
mock.module("@modules/addonstore", () => ({"default": {getAddon: (filename: string) => catalog.get(filename)}}));
mock.module("@data/web", () => ({"default": {redirects: {github: (id: string) => `https://fixture.test/${id}`}}}));
mock.module("@modules/net", () => ({fetch: () => request()}));
mock.module("@polyfill/remote", () => ({"default": {filesystem: {
    writeAddonFile: async (_kind: string, filename: string, content: string, expected: string) => {
        const file = path.join(root, filename);
        if (hash(fs.readFileSync(file)) !== expected) throw new Error("fixture-source-drift");
        const temporary = file + ".staged";
        fs.writeFileSync(temporary, content, {flag: "wx"});
        fs.renameSync(temporary, file);
        writes++;
    }
}}}));
const {AddonUpdater} = await import("../../src/betterdiscord/modules/updater");

function source(name: string, version: string) {return `/**\n * @name ${name}\n * @version ${version}\n */\nmodule.exports = {};\n`;}
function install(name = "Fixture") {
    const filename = `${name}.plugin.js`;
    const addon = {filename, name, version: "1.0.0"};
    manager.addonList.push(addon);
    catalog.set(filename, {id: catalog.size + 1, name, filename, version: "2.0.0", type: "plugin"});
    fs.writeFileSync(path.join(root, filename), source(name, "1.0.0"));
    return filename;
}
beforeEach(() => {writes = 0; manager.addonList.length = 0; catalog.clear();});
afterEach(() => {for (const file of fs.readdirSync(root)) fs.unlinkSync(path.join(root, file));});

describe("actual addon updater races", () => {
    test("duplicate updates share one download and a rescan cannot splice an unrelated pending entry", async () => {
        const filename = install();
        const updater = new AddonUpdater("plugin"); updater.pending = [filename, "Other.plugin.js"];
        let resolve!: (response: Response) => void;
        let requests = 0;
        request = () => {requests++; return new Promise(done => {resolve = done;});};
        const first = updater.updateAddon(filename);
        expect(updater.updateAddon(filename)).toBe(first);
        updater.pending.shift();
        resolve(new Response(source("Fixture", "2.0.0")));
        await first;
        expect(requests).toBe(1); expect(writes).toBe(1);
        expect(updater.pending).toEqual(["Other.plugin.js"]);
        expect(fs.readFileSync(path.join(root, filename), "utf8")).toContain("@version 2.0.0");
    });

    test("a user edit during the download preserves the edited bytes", async () => {
        const filename = install();
        let resolve!: (response: Response) => void;
        request = () => new Promise(done => {resolve = done;});
        const updater = new AddonUpdater("plugin"); updater.pending = [filename];
        const operation = updater.updateAddon(filename);
        fs.appendFileSync(path.join(root, filename), "// owner edit\n");
        resolve(new Response(source("Fixture", "2.0.0")));
        await operation;
        expect(writes).toBe(0); expect(updater.pending).toEqual([filename]);
        expect(fs.readFileSync(path.join(root, filename), "utf8")).toContain("// owner edit");
    });

    test("invalid metadata and over-limit transfers cannot replace the live file", async () => {
        const filename = install();
        const updater = new AddonUpdater("plugin");
        request = async () => new Response(source("Wrong addon", "2.0.0"));
        await updater.updateAddon(filename);
        expect(writes).toBe(0);
        let canceled = false;
        request = async () => new Response(new ReadableStream({pull(controller) {controller.enqueue(new Uint8Array(9 * 1024 * 1024));}, cancel() {canceled = true;}}));
        await updater.updateAddon(filename);
        expect(writes).toBe(0); expect(canceled).toBe(true);
        expect(fs.readFileSync(path.join(root, filename), "utf8")).toBe(source("Fixture", "1.0.0"));
    });

    test("Update All awaits a maximum of three downloads at once", async () => {
        const files = Array.from({length: 7}, (_, index) => install(`Fixture${index}`));
        let active = 0; let maximum = 0; let started = 0;
        request = async () => {
            const name = `Fixture${started++}`;
            maximum = Math.max(maximum, ++active);
            await new Promise(resolve => setTimeout(resolve, 3)); active--;
            return new Response(source(name, "2.0.0"));
        };
        const updater = new AddonUpdater("plugin"); updater.pending = files;
        await updater.updateAll();
        expect(maximum).toBe(3); expect(writes).toBe(7); expect(updater.pending).toEqual([]);
    });
});
