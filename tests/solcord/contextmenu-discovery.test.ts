import {describe, expect, test} from "bun:test";
import fs from "node:fs";
import vm from "node:vm";
import {transform} from "esbuild";

// Evaluate the actual shipping import boundary with only Discord's external
// modules substituted. This catches eager import failures before Core can run.
const source = fs.readFileSync(new URL("../../src/betterdiscord/api/contextmenu.ts", import.meta.url), "utf8");
const compiled = (await transform(source, {loader: "ts", format: "cjs", target: "es2022"})).code;
const component = () => null;
const directMarkers = "A:function(e){return null},B:function(e){return null},C:function(e){return null},D:function(e){return null},E:function(e){return null}";
const legacyMarkers = "function a(e){return null}function b(e){return null}function c(e){return null}function d(e){return null}function f(e){return null}";
const parser = "999(e,t,n){let r=n(123);\"Menu API only allows Items and groups of Items as children\";if(e.type===r.A)return t.push({type:\"separator\",});if(e.type===r.B)return t.push({type:\"radio\",});if(e.type===r.C)return t.push({type:\"checkbox\",});if(e.type===r.D)return t.push({type:\"control\",});if(e.type===r.E)return t.push({type:\"item\",});if(e.type===r.F){t.push({type:\"groupstart\"})}}";

function loadContextMenu(options: {markers?: string; parser?: string; requireFails?: boolean; bundle?: boolean;} = {}) {
    const required: unknown[] = [];
    const warnings: unknown[][] = [];
    const interceptors: unknown[] = [];
    const components = Object.fromEntries(["A", "B", "C", "D", "E", "F"].map(key => [key, () => null]));
    const webpackRequire = Object.assign((id: unknown) => {
        required.push(id);
        // Models Rspack's observed undefined-factory .call failure.
        if (id !== "123" || options.requireFails) throw new TypeError("Cannot read properties of undefined (reading 'call')");
        return components;
    }, {m: {} as Record<string, {toString(): string;}>});
    if (options.markers) webpackRequire.m[123] = {toString: () => `123(e,t,n){n.d(t,{}, {${options.markers}})}`};
    if (options.parser) webpackRequire.m[999] = {toString: () => options.parser!};
    const mapped = {MenuSeparator: components.A, MenuRadioItem: components.B, MenuCheckboxItem: components.C, MenuControlItem: components.D, MenuItem: components.E, MenuGroup: components.F, Menu: component};
    const actions = {openContextMenu: () => "opened", closeContextMenu: () => "closed"};
    const noop = () => {};
    const dependencies: Record<string, unknown> = {
        "@webpack": {
            webpackRequire,
            getByKeys: () => options.bundle ? mapped : undefined,
            getModule: () => component,
            getMangled: () => actions,
            getLazyByKeys: async () => ({colorDefault: "default", colorDanger: "danger", focused: "focused", checkboxContainer: "checkbox"}),
            Filters: {byStrings: noop, bySource: noop}
        },
        "@common/logger": {warn: (...args: unknown[]) => warnings.push(args), error: noop, stacktrace: (...args: unknown[]) => warnings.push(args)},
        "react": {createElement: (type: unknown, props: unknown) => ({type, props}), isValidElement: () => false},
        "@modules/discordmodules": {Dispatcher: {addInterceptor: (callback: unknown) => interceptors.push(callback)}},
        "@modules/nodepatcher": class NodePatcher {patch() {}},
        "@modules/dommanager": {injectStyle: noop}
    };
    const module = {exports: {} as {default?: new () => {Separator: unknown; Item: unknown; open(...args: unknown[]): unknown;};}};
    vm.runInNewContext(compiled, {module,
exports: module.exports,
document: {},
require: (name: string) => {
        if (!(name in dependencies)) throw new Error(`Unexpected fixture dependency ${name}`);
        return dependencies[name];
    }});
    return {api: new module.exports.default!(), required, warnings, interceptors, components};
}

describe("context menu discovery cannot abort renderer imports", () => {
    test("a changed marker module never requires an undefined ID and leaves unrelated startup available", () => {
        const result = loadContextMenu({parser});
        expect(result.required).toEqual([]);
        expect(result.api).toBeDefined();
        expect(result.interceptors).toEqual([]);
        expect(result.warnings).toHaveLength(1);
    });

    test("a missing parser does not execute a loosely matched marker module", () => {
        const result = loadContextMenu({markers: directMarkers});
        expect(result.required).toEqual([]);
        expect(result.interceptors).toEqual([]);
    });

    for (const [name, markers] of [["Rspack direct-value exports", directMarkers], ["legacy webpack declarations", legacyMarkers]]) {
        test(`maps ${name} into functioning context menu components`, () => {
            const result = loadContextMenu({markers, parser});
            expect(result.required).toEqual(["123"]);
            expect(result.api.Separator).toBe(result.components.A);
            expect(result.api.Item).toBe(result.components.E);
            expect(result.api.open({}, component)).toBe("opened");
            expect(result.interceptors).toHaveLength(1);
            expect(result.warnings).toEqual([]);
        });
    }

    test("a failed identified module is isolated instead of blocking Core imports", () => {
        const result = loadContextMenu({markers: directMarkers, parser, requireFails: true});
        expect(result.required).toEqual(["123"]);
        expect(result.api).toBeDefined();
        expect(result.interceptors).toEqual([]);
        expect(result.warnings).toHaveLength(2);
    });

    test("an already available public component bundle avoids fallback module execution", () => {
        const result = loadContextMenu({bundle: true});
        expect(result.required).toEqual([]);
        expect(result.api.Separator).toBe(result.components.A);
        expect(result.interceptors).toHaveLength(1);
    });
});
