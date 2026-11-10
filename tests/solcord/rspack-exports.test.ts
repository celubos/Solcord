import {describe, expect, mock, test} from "bun:test";
import vm from "node:vm";

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

    test("one-argument Rspack and three-argument legacy CSS factories retain searchable class aliases", () => {
        const factories = [
            "({123(m){m.exports={a:\"colorDefault_123\",b:\"focused_456\"}}})[123]",
            "({124(m,e,r){\"use strict\";m.exports={a:\"colorDefault_123\",b:\"focused_456\"}}})[124]",
            "({1e5(m,e,r){m.exports={a:\"colorDefault_123\",b:\"focused_456\"}}})[1e5]"
        ];
        for (const [index, source] of factories.entries()) {
            const id = `class-fixture-${index}`;
            runtime.m[id] = vm.runInNewContext(source);
            const exports = runtime(id);
            expect(exports.colorDefault).toBe("colorDefault_123");
            expect(exports.focused).toBe("focused_456");
            expect(exports[Symbol.for("BetterDiscord.Polyfilled.class") as any]).toBe(true);
            expect(Object.keys(exports)).toEqual(["colorDefault", "focused"]);
            expect(exports.a).toBe("colorDefault_123");
        }
    });

    test("a non-CSS factory is not given class aliases merely because it exports underscored strings", () => {
        runtime.m[125] = vm.runInNewContext("({125(m){let a=\"notAClass_123\";m.exports={a}}})[125]");
        const exports = runtime(125);
        expect(exports.a).toBe("notAClass_123");
        expect(exports.notAClass).toBeUndefined();
        expect(exports[Symbol.for("BetterDiscord.Polyfilled.class") as any]).toBeUndefined();
    });

    test("the early trigger waits for required React APIs and schedules exactly one renderer attempt", () => {
        const previousIdle = Object.getOwnPropertyDescriptor(globalThis, "requestIdleCallback");
        const previousRun = Object.getOwnPropertyDescriptor(window, "BetterDiscordRunRenderer");
        const callbacks: Array<() => void> = []; let attempts = 0;
        Object.defineProperty(globalThis, "requestIdleCallback", {configurable: true, value: (callback: () => void) => {callbacks.push(callback); return callbacks.length;}});
        Object.defineProperty(window, "BetterDiscordRunRenderer", {configurable: true, value: () => {attempts++;}});
        try {
            runtime.m[126] = vm.runInNewContext("({126(m){m.exports={createElement(){},cloneElement(){}}}})[126]");
            runtime(126); expect(callbacks).toHaveLength(0);
            const functions = ["Component", "createElement", "cloneElement", "createContext", "forwardRef", "memo", "useCallback", "useEffect", "useMemo", "useRef", "useState", "useSyncExternalStore"].map(key => `${key}:function(){}`).join(",");
            for (const id of [127, 128]) {
                runtime.m[id] = vm.runInNewContext(`({${id}(m){m.exports={Fragment:Symbol.for("react.fragment"),${functions}}}})[${id}]`);
                runtime(id);
            }
            expect(callbacks).toHaveLength(1); expect(attempts).toBe(0);
            callbacks[0](); expect(attempts).toBe(1);
        }
        finally {
            if (previousIdle) Object.defineProperty(globalThis, "requestIdleCallback", previousIdle);
            if (previousRun) Object.defineProperty(window, "BetterDiscordRunRenderer", previousRun);
            else delete (window as Partial<Window>).BetterDiscordRunRenderer;
        }
    });

    test("renderer module discovery uses the same Rspack queue instead of the stale webpack queue", async () => {
        const {webpackRequire} = await import("../../src/betterdiscord/webpack/require");
        expect(webpackRequire as unknown).toBe(runtime);
        expect(obsoleteWebpack).toHaveLength(0);
    });
});
