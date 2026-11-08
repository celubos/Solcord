import {afterEach, describe, expect, spyOn, test} from "bun:test";
import fs from "../../src/betterdiscord/polyfill/fs";
import SolcordSettings from "../../src/betterdiscord/modules/solcord/store";

const spies: Array<{mockRestore(): void;}> = [];
afterEach(() => {for (const spy of spies.splice(0)) spy.mockRestore();});
const createStore = () => new (SolcordSettings.constructor as new () => typeof SolcordSettings)();

describe("Coalesced asynchronous settings revisions", () => {
    test("a validation failure rejects the complete coalesced revision before any file mutation", async () => {
        const store = createStore();
        const before = store.snapshot();
        const write = spyOn(fs, "writeFile");
        const unlink = spyOn(fs, "unlink");
        try {
            const results = await Promise.allSettled([store.setValueAsync("performance-hud", "sampleSeconds", 6), store.setValueAsync("performance-hud", "unknownSetting", 7)]);
            expect(results.every(result => result.status === "rejected")).toBeTrue();
            expect(write).not.toHaveBeenCalled();
            expect(unlink).not.toHaveBeenCalled();
            expect(store.snapshot()).toEqual(before);
        }
        finally {write.mockRestore(); unlink.mockRestore();}
    });
    test("rapid edits share one atomic write, remain responsive during slow I/O, and acknowledge only the latest durable revision", async () => {
        let staged = "";
        let durable = "";
        let writes = 0;
        let finishRename: (() => void) | undefined;
        spies.push(
            spyOn(fs, "mkdir").mockImplementation(((...args: unknown[]) => {(args.at(-1) as (error: Error | null) => void)(null);}) as typeof fs.mkdir),
            spyOn(fs, "writeFile").mockImplementation((_path, data, options, callback) => {
                expect(options).toMatchObject({flag: "wx"}); staged = String(data); writes++; callback?.(null);
            }),
            spyOn(fs, "rename").mockImplementation((_from, _to, callback) => {finishRename = () => {durable = staged; callback(null);};}),
            spyOn(fs, "unlink").mockImplementation((_path, callback) => {callback(null);})
        );
        const store = createStore();
        const initialView = store.readonlySnapshot();
        const initialPreferences = store.slice("productPreferences");
        expect(store.readonlySnapshot()).toBe(initialView);
        expect(store.slice("productPreferences")).toBe(initialPreferences);
        expect(Object.isFrozen(initialPreferences)).toBeTrue();
        let notifications = 0;
        store.addChangeListener(() => notifications++);
        let acknowledged = false;
        const edits = [6, 7, 8].map(value => store.setValueAsync("performance-hud", "sampleSeconds", value));
        const completed = Promise.all(edits).then(() => {acknowledged = true;});
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(writes).toBe(1);
        expect(acknowledged).toBeFalse();
        expect(notifications).toBe(0);
        expect(() => store.setEnabled("stream-shield", true)).toThrow("revision is being saved");
        expect(store.module("stream-shield").enabled).toBeFalse();
        finishRename!(); await completed;
        expect(acknowledged).toBeTrue();
        expect(notifications).toBe(1);
        expect(JSON.parse(durable).modules["performance-hud"].values.sampleSeconds).toBe(8);
        expect(JSON.parse(durable)).toEqual(store.snapshot());
        expect(store.readonlySnapshot()).not.toBe(initialView);
    });

    test("a failed atomic replacement rejects every dependent edit and restores the previous in-memory revision", async () => {
        const store = createStore();
        const before = store.snapshot();
        let cleanup = 0;
        spies.push(
            spyOn(fs, "mkdir").mockImplementation(((...args: unknown[]) => {(args.at(-1) as (error: Error | null) => void)(null);}) as typeof fs.mkdir),
            spyOn(fs, "writeFile").mockImplementation((_path, _data, _options, callback) => {callback?.(null);}),
            spyOn(fs, "rename").mockImplementation((_from, _to, callback) => {callback(new Error("locked destination"));}),
            spyOn(fs, "unlink").mockImplementation((_path, callback) => {cleanup++; callback(null);})
        );
        const outcomes = await Promise.allSettled([store.setValueAsync("performance-hud", "sampleSeconds", 7), store.setValueAsync("performance-hud", "sampleSeconds", 9)]);
        expect(outcomes.every(result => result.status === "rejected")).toBeTrue();
        expect(store.snapshot()).toEqual(before);
        expect(cleanup).toBe(1);
    });
});
