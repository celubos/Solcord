import {describe, expect, mock, spyOn, test} from "bun:test";

const listeners = new Set<(...args: any[]) => void>();
mock.module("../../src/betterdiscord/webpack/searching", () => ({getModule: () => undefined}));
mock.module("../../src/betterdiscord/webpack/utilities", () => ({getBulk: (...queries: unknown[]) => queries.map(() => undefined)}));
mock.module("../../src/betterdiscord/webpack/require", () => ({lazyListeners: listeners, webpackRequire: {}}));
mock.module("../../src/betterdiscord/webpack/shared", () => ({getDeclaration: (value: unknown) => value, getDefaultKey: () => undefined, makeException: () => new Error("aborted"), shouldSkipModule: () => false, wrapModuleFilter: (filter: unknown) => filter}));
const {getLazy} = await import("../../src/betterdiscord/webpack/lazy");

describe("webpack lazy lookup ownership", () => {
    test("successful lookups remove abort listeners on a shared long-lived signal", async () => {
        const controller = new AbortController();
        const add = spyOn(controller.signal, "addEventListener");
        const remove = spyOn(controller.signal, "removeEventListener");
        for (let cycle = 0; cycle < 50; cycle++) {
            const lookup = getLazy(value => value.fixture === cycle, {signal: controller.signal});
            await Promise.resolve(); await Promise.resolve();
            for (const listener of [...listeners]) listener(null, {id: cycle, exports: {fixture: cycle}});
            expect(await lookup).toEqual({fixture: cycle});
            expect(listeners.size).toBe(0); expect(add.mock.calls.length).toBe(remove.mock.calls.length);
        }
        add.mockRestore(); remove.mockRestore();
    });

    test("an abort between initial lookup and late registration cannot strand a listener", async () => {
        const controller = new AbortController();
        const lookup = getLazy(() => false, {signal: controller.signal});
        queueMicrotask(() => controller.abort());
        expect(await lookup).toBeUndefined();
        expect(listeners.size).toBe(0);
    });
});
