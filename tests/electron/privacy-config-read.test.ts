import {afterEach, describe, expect, mock, spyOn, test} from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const electron = {app: {getPath: () => {throw new Error("No user profile in this test");}}};
mock.module("electron", () => ({"default": electron, ...electron}));
const {readBoundedNativePrivacyFile} = await import("../../src/electron/main/modules/privacy-network");
const roots: string[] = [];
const spies: Array<{mockRestore(): void;}> = [];
function configFile(content: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "solcord-privacy-config-"));
    roots.push(root);
    const file = path.join(root, "solcord.json"); fs.writeFileSync(file, content); return file;
}
afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
    for (const root of roots.splice(0)) {
        const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(root));
        if (!relative.startsWith("solcord-privacy-config-") || relative.includes(path.sep)) throw new Error("Unexpected fixture cleanup target.");
        fs.rmSync(root, {recursive: true, force: true});
    }
});

describe("Bounded native privacy configuration reads", () => {
    test("reads valid JSON and closes the descriptor on invalid JSON or a size rejection", () => {
        const valid = configFile("{\"schemaVersion\":10}");
        expect(readBoundedNativePrivacyFile(valid, 64)).toEqual({schemaVersion: 10});
        const close = spyOn(fs, "closeSync"); spies.push(close);
        expect(() => readBoundedNativePrivacyFile(configFile("not-json"), 64)).toThrow();
        expect(() => readBoundedNativePrivacyFile(configFile(" ".repeat(65)), 64)).toThrow("Invalid native privacy file");
        expect(close).toHaveBeenCalledTimes(2);
    });

    test("growth after fstat cannot trigger an unbounded read or be accepted as durable consent", () => {
        const file = configFile("{\"schemaVersion\":10}");
        const original = fs.readSync;
        let largest = 0;
        let grew = false;
        spies.push(spyOn(fs, "readSync").mockImplementation(((descriptor: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number, position: number) => {
            if (!grew) {grew = true; fs.appendFileSync(file, " ".repeat(5000));}
            largest = Math.max(largest, length);
            return Reflect.apply(original, fs, [descriptor, buffer, offset, length, position]);
        }) as typeof fs.readSync));
        expect(() => readBoundedNativePrivacyFile(file, 64)).toThrow("changed during read");
        expect(largest).toBeLessThanOrEqual(65);
    });

    test("a file replacement between open and inspection cannot substitute another policy", () => {
        const file = configFile("{\"profile\":\"strict\"}");
        const original = fs.openSync;
        spies.push(spyOn(fs, "openSync").mockImplementation(((target: fs.PathLike, flags: string | number, mode?: number) => {
            const descriptor = original(target, flags, mode);
            if (String(target) === file) {fs.renameSync(file, `${file}.previous`); fs.writeFileSync(file, "{\"profile\":\"custom\",\"telemetry\":\"allow\"}");}
            return descriptor;
        }) as typeof fs.openSync));
        expect(() => readBoundedNativePrivacyFile(file, 64)).toThrow("Invalid native privacy file");
    });
});
