import {describe, expect, test} from "bun:test";
import fs from "node:fs";
import vm from "node:vm";
import {transform} from "esbuild";

const files = {
    modules: "../../src/betterdiscord/modules/discordmodules.ts",
    reactdom: "../../src/betterdiscord/modules/reactdom.ts",
    memo: "../../src/common/utils/memoize.ts",
    readiness: "../../src/common/react-readiness.ts"
};
const compiled = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, file]) => [name,
    (await transform(fs.readFileSync(new URL(file, import.meta.url), "utf8"), {loader: "ts", format: "cjs", target: "es2022"})).code
])));

function fixture() {
    const available = new Map<string, any>(); const calls = new Map<string, number>();
    const loaded: Record<string, any> = {};
    const lookup = (key: string) => {calls.set(key, (calls.get(key) ?? 0) + 1); return available.get(key);};
    function load(name: string): any {
        if (name in loaded) return loaded[name];
        const module = {exports: {} as any}; loaded[name] = module.exports;
        vm.runInNewContext(compiled[name], {module,
exports: module.exports,
require: (specifier: string) => {
            if (specifier === "@common/utils") return {memoize: load("memo").default};
            if (specifier === "@common/react-readiness") return load("readiness");
            if (specifier === "@webpack") {
return {
                getBulkKeyed: () => ({}),
                getByKeys: (_keys: string[], options: {cacheId: string;}) => lookup(options.cacheId),
                getByStrings: (_strings: string[], options: {cacheId: string;}) => lookup(options.cacheId),
                getBySource: (_strings: string[], options: {cacheId: string;}) => lookup(options.cacheId),
                getModule: (_filter: unknown, options: {cacheId: string;}) => lookup(options.cacheId),
                Filters: {byKeys: () => () => true, byPrototypeKeys: () => () => true}
            };
}
            throw new Error(`Unexpected fixture dependency ${specifier}`);
        }});
        return loaded[name] = module.exports;
    }
    return {available, calls, modules: load("modules").default, reactdom: load("reactdom").default};
}

describe("late Discord module discovery", () => {
    test("missing memoized layout getters retry after login and retain a successful lookup", () => {
        const f = fixture();
        expect(f.modules.Layout).toBeUndefined();
        const layout = {section() {}}; f.available.set("core-Layout", layout);
        expect(f.modules.Layout).toBe(layout); expect(f.modules.Layout).toBe(layout);
        expect(f.calls.get("core-Layout")).toBe(2);
    });

    test("missing synchronous dispatcher and animation lookups can recover rather than freezing undefined", () => {
        const f = fixture(); expect(f.modules.Dispatcher).toBeUndefined(); expect(f.modules.ReactSpring).toBeUndefined();
        const dispatcher = {dispatch() {}, subscribe() {}, register() {}};
        const spring = {useTransition() {}, useSpring() {}, animated: {}};
        f.available.set("core-Dispatcher", dispatcher); f.available.set("core-ReactSpring", spring);
        expect(f.modules.Dispatcher).toBe(dispatcher); expect(f.modules.ReactSpring).toBe(spring);
    });

    test("the temporary tooltip fallback does not prevent a late native tooltip from being discovered", () => {
        const f = fixture(); expect(typeof f.modules.Tooltip).toBe("function");
        const tooltip = () => null; f.available.set("core-Tooltip", tooltip);
        expect(f.modules.Tooltip).toBe(tooltip);
    });

    test("ReactDOM resolves absent imports on use, caches valid modules, and preserves consumer patches", () => {
        const f = fixture(); expect(f.calls.size).toBe(0);
        expect(f.reactdom.createRoot).toBeUndefined();
        f.available.set("core-reactdom-client", {createRoot: false}); expect(f.reactdom.createRoot).toBeUndefined();
        const createRoot = () => "root"; const createPortal = () => "portal";
        f.available.set("core-reactdom-client", {createRoot}); f.available.set("core-reactdom-base", {createPortal});
        expect(f.reactdom.createRoot()).toBe("root"); expect(f.reactdom.createPortal()).toBe("portal");
        const snapshots = Object.assign({}, f.reactdom); expect(snapshots).toEqual({createPortal, createRoot});
        const patched = () => "patched"; f.reactdom.createRoot = patched;
        expect(f.reactdom.createRoot()).toBe("patched");
        expect(Object.keys(f.reactdom)).toContain("createRoot");
    });
});
