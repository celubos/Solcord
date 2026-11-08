// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs";
import {runInNewContext} from "node:vm";
import {transform} from "esbuild";
import {expect, test} from "bun:test";

const source = fs.readFileSync(new URL("../../src/betterdiscord/modules/commandmanager.tsx", import.meta.url), "utf8");
const code = (await transform(source, {loader: "tsx", format: "cjs", target: "es2022"})).code;

function fixture() {
    const state = {available: false, user: null as unknown, missingQuery: false, userLookups: 0, patches: 0, cancellations: 0, warnings: [] as string[]};
    const registry: Record<string, string> = {};
    const receiveMessage = (..._args: unknown[]) => {};
    const baseMethod = () => {};
    const module = {exports: {} as {default: any}};
    const patch = () => {state.patches++; return () => {state.cancellations++;};};
    const webpack = {
        Filters: {byStrings: () => () => true},
modules: {},
        getByStrings: (keys: string[]) => {
            if (keys[0] === "hasHadPremium(){") {state.userLookups++; return state.available ? state.user : undefined;}
            if (keys[0] === "username:\"Clyde\"") return state.available ? () => ({}) : undefined;
            return state.available ? {A: baseMethod} : undefined;
        },
        getByKeys: (keys: string[]) => !state.available ? undefined : keys[0] === "receiveMessage" ? {receiveMessage} : {BOT_AVATARS: registry},
        getModule: () => undefined,
        getWithKey: () => [{method: baseMethod}, "method"],
        getStore: () => state.missingQuery ? undefined : {query: baseMethod}
    };
    const dependencies: Record<string, unknown> = {
        "@webpack": webpack,
        "@modules/patcher": {after: patch, instead: patch},
        "react": {},
        "@assets/branding/solcord-mark.svg": "fixture-mark",
        "./pluginmanager": {},
        "@common/logger": {warn: (...args: string[]) => state.warnings.push(args.join(" "))}
    };
    runInNewContext(code, {module,
exports: module.exports,
require: (name: string) => {
        if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
        return dependencies[name];
    }});
    return {state, manager: module.exports.default, registry};
}

test("a missing-at-import command constructor can be discovered after Discord finishes loading", () => {
    const {state, manager, registry} = fixture();
    expect(state.userLookups).toBe(0);
    expect(manager.initialize()).toBeFalse();
    expect(manager.isAvailable).toBeFalse();
    expect(state.patches).toBe(0);
    state.available = true;
    state.user = class User {constructor(public data: unknown) {}};
    expect(manager.initialize()).toBeTrue();
    expect(manager.isAvailable).toBeTrue();
    expect(state.userLookups).toBe(2);
    expect(state.patches).toBe(5);
    expect(registry.solcord).toBe("fixture-mark");
    expect(manager.initialize()).toBeTrue();
    expect(state.patches).toBe(5);
});

test.each([() => ({}), {}, null])("a non-constructible User export disables only optional command integration", user => {
    const {state, manager} = fixture();
    state.available = true;
    state.user = user;
    expect(manager.initialize()).toBeFalse();
    expect(manager.initialize()).toBeFalse();
    expect(state.patches).toBe(0);
    expect(state.warnings).toHaveLength(1);
});

test("failed later adapter discovery detaches partial patches and can be retried", () => {
    const {state, manager} = fixture();
    state.available = true;
    state.user = class User {};
    state.missingQuery = true;
    expect(manager.initialize()).toBeFalse();
    expect(state.patches).toBe(1);
    expect(state.cancellations).toBe(1);
    expect(manager.localBDBot).toBeUndefined();
    state.missingQuery = false;
    expect(manager.initialize()).toBeTrue();
    expect(state.patches - state.cancellations).toBe(5);
});
