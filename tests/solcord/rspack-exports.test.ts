import {describe, expect, mock, test} from "bun:test";

const noop = () => {};
mock.module("@common/logger", () => ({"default": {error: noop, warn: noop, debug: noop, stacktrace: noop}}));
mock.module("@modules/patcher", () => ({"default": {after: noop, before: noop, unpatchAll: noop}}));
mock.module("../../src/betterdiscord/webpack/searching", () => ({getModule: () => undefined}));

type Module = {id?: string; exports: Record<string, any>;};
type Runtime = ((id: PropertyKey) => Record<string, any>) & {
    b: boolean; c: Record<PropertyKey, Module>; m: Record<PropertyKey, (...args: any[]) => void>;
    d: (target: object, getters?: Record<string, () => any>, values?: Record<string, unknown>) => void;
    e: () => Promise<void>; l: () => void;
};
const runtime = ((id: PropertyKey) => {
    if (runtime.c[id]) return runtime.c[id].exports;
    const module: Module = {exports: {}};
    runtime.c[id] = module;
    runtime.m[id](module, module.exports, runtime);
    return module.exports;
}) as Runtime;
Object.assign(runtime, {b: true, c: {}, m: {}, d: noop, e: async () => {}, l: noop});
runtime.m[626584] = function (_module, exports, require) {
    require.d(exports, {}, {A: class Logger {constructor(readonly name: string) {}}});
};
const rspack: any[] = [];
rspack.push = chunk => {chunk[2]?.(runtime); return 1;};
const obsoleteWebpack: any[] = [];
Object.defineProperty(window, "rspackChunkdiscord_app", {configurable: true, writable: true, value: rspack});
Object.defineProperty(window, "webpackChunkdiscord_app", {configurable: true, writable: true, value: obsoleteWebpack});
Object.defineProperty(globalThis, "requestIdleCallback", {configurable: true, value: () => 1});
await import("../../src/electron/preload/early/index");

describe("Discord Rspack export compatibility", () => {
    test("the actual early hook preserves direct constructor exports and module identity", () => {
        const exports = runtime(626584);
        expect(typeof exports.A).toBe("function");
        expect(new exports.A("libdiscore").name).toBe("libdiscore");
        expect(runtime.c[626584].id).toBe("626584");
        expect(Object.getOwnPropertyDescriptor(exports, "A")).toEqual(expect.objectContaining({enumerable: true, writable: true, configurable: true}));
        expect(obsoleteWebpack).toHaveLength(0);
    });

    test("legacy getter exports remain live and patchable alongside direct values", () => {
        const exports: Record<string, unknown> = {};
        let live = 1;
        runtime.d(exports, {live: () => live}, {direct: 3, live: 99});
        live = 2;
        expect(exports.live).toBe(2); expect(exports.direct).toBe(3);
        exports.live = 7; exports.direct = 9;
        expect(exports.live).toBe(7); expect(exports.direct).toBe(9);
    });

    test("renderer module discovery uses the same Rspack queue instead of the stale webpack queue", async () => {
        const {webpackRequire} = await import("../../src/betterdiscord/webpack/require");
        expect(webpackRequire as unknown).toBe(runtime);
        expect(obsoleteWebpack).toHaveLength(0);
    });
});
