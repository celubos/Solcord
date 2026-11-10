import {afterEach, expect, mock, test} from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
mock.module("electron", () => ({ipcRenderer: {invoke: async () => {}}}));
const native = await import("../../src/electron/preload/api/filesystem");
mock.module("../../src/betterdiscord/polyfill/remote", () => ({"default": {filesystem: native}}));
const renderer = await import("../../src/betterdiscord/polyfill/fs");
const roots: string[] = [];
afterEach(() => {for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true});});
function fixture() {const root = fs.mkdtempSync(path.join(os.tmpdir(), "solcord-async-fs-")); roots.push(root); return root;}
test("callback file reads are asynchronous and exists uses Node's boolean signature", async () => {
    const root = fixture(), file = path.join(root, "file.txt"); fs.writeFileSync(file, "value");
    let calling = true;
    const read = new Promise<void>(resolve => renderer.readFile(file, (error, content) => {expect(calling).toBe(false); expect(error).toBeNull(); expect(content?.toString()).toBe("value"); resolve();}));
    calling = false; await read;
    await new Promise<void>(resolve => renderer.exists(file, (...args) => {expect(args).toEqual([true]); resolve();}));
    await new Promise<void>(resolve => renderer.exists(path.join(root, "missing"), (...args) => {expect(args).toEqual([false]); resolve();}));
});
test("consumer exceptions do not cause a second callback", async () => {
    const root = fixture(), file = path.join(root, "file.txt"); fs.writeFileSync(file, "value");
    let calls = 0, errors = 0;
    const schedule = globalThis.queueMicrotask;
    globalThis.queueMicrotask = callback => schedule(() => {
try {callback();}
 catch {errors++;}
});
    try {
        renderer.readFile(file, () => {calls++; throw new Error("consumer failure");});
        for (let count = 0; count < 30; count++) {if (calls) break; await Bun.sleep(5);}
        expect(calls).toBe(1); expect(errors).toBe(1);
    }
    finally {globalThis.queueMicrotask = schedule;}
});
test("lstat distinguishes a link from the linked file", () => {
    const root = fixture(), folder = path.join(root, "folder"), link = path.join(root, "linked"); fs.mkdirSync(folder);
    fs.symlinkSync(folder, link, process.platform === "win32" ? "junction" : "dir");
    expect(renderer.lstatSync(link).isSymbolicLink()).toBe(true); expect(renderer.statSync(link).isDirectory()).toBe(true);
});

test("no-options reads return exact binary Buffers and encoded reads return strings", async () => {
    const root = fixture(), file = path.join(root, "binary.dat"), bytes = Buffer.from([0, 255, 128, 1]); fs.writeFileSync(file, bytes);
    await new Promise<void>(resolve => renderer.readFile(file, (error, content) => {expect(error).toBeNull(); expect(Buffer.isBuffer(content)).toBe(true); expect(content).toEqual(bytes); resolve();}));
    fs.writeFileSync(file, "text");
    await new Promise<void>(resolve => renderer.readFile(file, "utf8", (error, content) => {expect(error).toBeNull(); expect(content).toBe("text"); resolve();}));
});
