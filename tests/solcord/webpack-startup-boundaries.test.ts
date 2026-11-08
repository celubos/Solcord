import {describe, expect, test} from "bun:test";
import fs from "node:fs";
import vm from "node:vm";
import {transform} from "esbuild";

const sourceFiles: Record<string, string> = {
    cache: "webpack/cache.ts",
shared: "webpack/shared.ts",
searching: "webpack/searching.ts",
    utilities: "webpack/utilities.ts",
filter: "webpack/filter.ts",
object: "utils/object.ts"
};
const compiled = Object.fromEntries(await Promise.all(Object.entries(sourceFiles).map(async ([name, file]) => [name,
    (await transform(fs.readFileSync(new URL(`../../src/betterdiscord/${file}`, import.meta.url), "utf8"), {loader: "ts", format: "cjs", target: "es2022"})).code
])));

function fixture(cacheText = "{}", writeFails = false) {
    const timers = new Map<number,() => void>();
    const writes: string[] = [];
    const warnings: unknown[][] = [];
    const runtime = {c: {} as Record<string, any>, m: {}};
    const loaded: Record<string, any> = {};
    let timerId = 0;
    const deps: Record<string, unknown> = {
        "./require": {webpackRequire: runtime},
        "./lazy": {getLazy: async () => undefined},
        "@common/utils/cache": {proxy: () => ({})},
        "@common/logger": {warn: (...args: unknown[]) => warnings.push(args)},
        "@polyfill/fs": {
            readFileSync: () => cacheText,
            writeFileSync: (_path: string, data: string) => {if (writeFails) throw new Error("read-only fixture cache"); writes.push(data);}
        },
        "path": {resolve: (...parts: string[]) => parts.join("/")},
        "@stores/config": {get: () => "fixture-channel"}
    };
    function load(name: string): any {
        if (name in loaded) return loaded[name];
        const module = {exports: {} as any}; loaded[name] = module.exports;
        vm.runInNewContext(compiled[name], {
            module,
exports: module.exports,
Window: class Window {},
window: {},
document: {documentElement: {}},
            setTimeout: (callback: () => void) => {timers.set(++timerId, callback); return timerId;},
            clearTimeout: (id: number) => timers.delete(id),
            require: (specifier: string) => {
                if (specifier in deps) return deps[specifier];
                if (specifier === "@utils/object") return load("object");
                if (specifier.startsWith("./")) return load(specifier.slice(2));
                throw new Error(`Unexpected fixture dependency ${specifier}`);
            }
        });
        return loaded[name] = module.exports;
    }
    return {runtime,
cache: load("cache").default,
searching: load("searching"),
utilities: load("utilities"),
warnings,
writes,
        flushTimers: () => {for (const callback of [...timers.values()]) callback();}
    };
}

describe("webpack optional cache and startup search boundaries", () => {
    for (const cacheText of ["null", "[]", "42", "true", "\"invalid-cache\"", "{broken"]) {
        test(`a cache containing ${cacheText} cannot abort eager lookup or later cache updates`, () => {
            const {cache, flushTimers, writes} = fixture(cacheText);
            expect(cache.get("core-React")).toBeUndefined();
            cache.set("core-React", "123"); flushTimers();
            expect(cache.get("core-React")).toBe("123");
            expect(JSON.parse(writes[0])).toEqual({"core-React": "123"});
        });
    }

    test("invalid cache values are discarded and prototype-shaped keys remain plain own records", () => {
        const {cache} = fixture("{\"good\":\"123\",\"wrong\":{},\"array\":[],\"nil\":null,\"negative\":\"-1\",\"__proto__\":\"456\"}");
        expect(cache.get("good")).toBe("123");
        for (const key of ["wrong", "array", "nil", "negative", "toString"]) expect(cache.get(key)).toBeUndefined();
        expect(cache.get("__proto__")).toBe("456");
    });

    test("cache set works before any read and failed optional saves never throw from timers", () => {
        const {cache, flushTimers, warnings} = fixture("{}", true);
        cache.set("core-React", "123");
        expect(() => flushTimers()).not.toThrow();
        expect(cache.get("core-React")).toBe("123");
        expect(warnings.length).toBeGreaterThan(0);
    });

    test("a stale cache ID is revalidated and replaced by the current matching module", () => {
        const {runtime, cache, searching} = fixture("{\"core-React\":\"1\"}");
        runtime.c[1] = {id: "1", exports: {wrong: true}};
        runtime.c[2] = {id: "2", exports: {createElement() {}}};
        const result = searching.getModule((value: any) => typeof value.createElement === "function", {cacheId: "core-React"});
        expect(result).toBe(runtime.c[2].exports);
        expect(cache.get("core-React")).toBe("2");
    });

    test("empty cache slots and throwing export getters cannot stop single, all, or bulk scans", () => {
        const {runtime, searching, utilities} = fixture();
        runtime.c[1] = undefined;
        runtime.c[2] = {id: "2", exports: Object.defineProperty({}, "Z", {get() {throw new ReferenceError("export not initialized");}})};
        runtime.c[3] = {id: "3", exports: Object.defineProperty({}, "A", {enumerable: true, get() {throw new ReferenceError("export not initialized");}})};
        const expected = {ready: true}; runtime.c[4] = {id: "4", exports: {A: expected}};
        const filter = (value: any) => value.ready === true;
        expect(searching.getModule(filter, {searchExports: true})).toBe(expected);
        expect(searching.getAllModules(filter, {searchExports: true})).toEqual([expected]);
        expect(utilities.getBulk({filter, searchExports: true, firstId: 2})).toEqual([expected]);
    });

    test("all bulk queries with a first-ID hint still collect every match into an array", () => {
        const {runtime, utilities} = fixture();
        const first = {ready: true}; const second = {ready: true};
        runtime.c[1] = {id: "1", exports: first}; runtime.c[2] = {id: "2", exports: second};
        const result = utilities.getBulk({filter: (value: any) => value.ready === true, all: true, firstId: 1});
        expect(result).toEqual([[first, second]]);
    });

    test("explicit fatal lookups still reject a genuinely absent required module", () => {
        const {searching, utilities} = fixture();
        expect(() => searching.getModule(() => false, {fatal: true})).toThrow("Module search failed");
        expect(() => utilities.getBulk({filter: () => false, fatal: true})).toThrow("Module search failed");
    });
});
