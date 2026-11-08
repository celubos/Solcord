import {describe, expect, test} from "bun:test";
import fs from "node:fs";
import vm from "node:vm";
import {transform} from "esbuild";

const source = fs.readFileSync(new URL("../../src/betterdiscord/ui/settings.tsx", import.meta.url), "utf8");
const compiled = (await transform(source, {loader: "tsx", jsxFactory: "React.createElement", format: "cjs", target: "es2022"})).code;

function fixture() {
    const state = {root: undefined as any, layout: undefined as any, userSettings: undefined as any, versionFails: false, patchFails: false};
    const timers = new Map<number,() => void>(); let timerId = 0;
    const patches: string[] = []; const warnings: unknown[][] = [];
    const settingsCalls: unknown[][] = []; const closes: string[] = [];
    const lateListeners = new Set<(...args: any[]) => unknown>();
    const documentEvents = new EventTarget();
    const logger = {warn: (...args: unknown[]) => warnings.push(args)};
    const noop = () => {};
    const react = {createContext: (value: unknown) => ({value}), createElement: (type: unknown, props: unknown) => ({type, props})};
    const deps: Record<string, unknown> = {
        "react": react,
        "@api/contextmenu": class ContextMenu {},
        "@common/logger": logger,
        "@modules/discordmodules": {get Layout() {return state.layout;}},
        "./modals": {ModalActions: {closeModal: (key: string) => closes.push(key)}},
        "@webpack": {
            lazyListeners: lateListeners,
            getMatched: (module: any, filter: (value: any) => boolean) => {
                if (filter(module.exports)) return module.exports;
                return Object.values(module.exports).find(filter);
            },
            getByKeys: () => state.userSettings,
            getLazy: (filter: (value: unknown) => boolean, options: {signal: AbortSignal;}) => {
                if (state.root && filter(state.root)) return Promise.resolve(state.root);
                return new Promise(resolve => {
                    if (options.signal.aborted) resolve(undefined);
                    else options.signal.addEventListener("abort", () => resolve(undefined), {once: true});
                });
            },
            getMangled: () => ({}),
            getMangledLazy: async () => {if (state.versionFails) throw new Error("optional decoration fixture failure"); return {};},
            Filters: {byStrings: noop}
        },
        "@modules/patcher": {
            after: (_caller: string, target: any, key: string, callback: (...args: any[]) => unknown) => {
                if (state.patchFails || typeof target[key] !== "function") return undefined;
                patches.push(key); const original = target[key];
                target[key] = (...args: unknown[]) => {const result = original(...args); return callback(target, args, result) ?? result;};
                return () => {target[key] = original;};
            },
            instead: noop
        }
    };
    const module = {exports: {} as any};
    vm.runInNewContext(compiled, {
        module,
exports: module.exports,
        AbortController,
        window: documentEvents,
        queueMicrotask,
        setTimeout: (callback: () => void) => {timers.set(++timerId, callback); return timerId;},
        clearTimeout: (id: number) => timers.delete(id),
        require: (name: string) => deps[name] ?? {},
        React: react
    });
    function available() {
        state.root = {key: "$Root", buildLayout: () => [{key: "games_and_apps_section"}]};
        state.layout = {};
        for (const [key, kind] of Object.entries({a: "CUSTOM", b: "CATEGORY", c: "PANEL", d: "SIDEBAR_ITEM", e: "SECTION"})) {
            const builder = (id: string, options: unknown) => ({key: id, ...options as object});
            builder.toString = () => `function(e,t){return n.X.${kind},e,t}`;
            state.layout[key] = builder;
        }
    }
    state.userSettings = undefined;
    return {renderer: module.exports.default,
state,
available,
patches,
warnings,
timers,
settingsCalls,
closes,
lateListeners,
        expire: () => {for (const callback of [...timers.values()]) callback();},
        publish: (exports: object) => {for (const callback of [...lateListeners]) callback(exports, {exports, id: "late-settings-fixture"});},
        unload: () => documentEvents.dispatchEvent(new Event("pagehide"))
    };
}

describe("bounded settings registration and delayed module arrival", () => {
    test("missing root discovery expires, resolves false, and releases initialization ownership for retry", async () => {
        const f = fixture(); const first = f.renderer.initialize();
        expect(f.renderer.initialize()).toBe(first);
        f.expire(); expect(await first).toBe(false); expect(f.timers.size).toBe(0);
        f.available(); expect(await f.renderer.initialize()).toBe(true);
        expect(f.state.root.buildLayout()).toHaveLength(2);
        expect(f.patches).toEqual(["buildLayout"]);
    });

    test("an absent layout builder is not cached permanently and can register on a later retry", async () => {
        const f = fixture(); f.available(); f.state.layout = undefined;
        expect(await f.renderer.initialize()).toBe(false);
        expect(f.patches).toEqual([]);
        f.available(); expect(await f.renderer.initialize()).toBe(true);
        expect(f.state.root.buildLayout()[1].key).toBe("betterdiscord_betterdiscord_section");
        expect(await f.renderer.initialize()).toBe(true); expect(f.patches).toEqual(["buildLayout"]);
    });

    test("optional version decoration failure does not reject navigation readiness", async () => {
        const f = fixture(); f.available(); f.state.versionFails = true;
        expect(await f.renderer.initialize()).toBe(true);
        expect(f.warnings).toHaveLength(1);
        expect(f.timers.size).toBe(0);
    });

    test("an unsuccessful native patch registration reports false instead of claiming initialized", async () => {
        const f = fixture(); f.available(); f.state.patchFails = true;
        expect(await f.renderer.initialize()).toBe(false);
        f.state.patchFails = false; expect(await f.renderer.initialize()).toBe(true);
    });

    test("settings open and close resolve a module that was absent at import time", () => {
        const f = fixture();
        f.state.userSettings = {USER_SETTINGS_MODAL_KEY: "native-modal", openUserSettings: (...args: unknown[]) => f.settingsCalls.push(args)};
        f.renderer.openSettingsPage("solcord"); f.renderer.closeUserSettingsModal();
        expect(f.settingsCalls).toEqual([["betterdiscord_solcord_panel", {section: "solcord"}]]);
        expect(f.closes).toEqual(["native-modal"]);
    });

    test("a settings root loaded after both bounded attempts still registers once without keeping Core pending", async () => {
        const f = fixture();
        for (let attempt = 0; attempt < 2; attempt++) {
            const ready = f.renderer.initialize(); f.expire(); expect(await ready).toBe(false);
            expect(f.lateListeners.size).toBe(1); expect(f.timers.size).toBe(0);
        }
        f.available();
        for (let index = 0; index < 20; index++) f.publish({A: f.state.root});
        for (let turn = 0; turn < 10; turn++) await Promise.resolve();
        expect(f.patches).toEqual(["buildLayout"]);
        expect(f.state.root.buildLayout()).toHaveLength(2);
        expect(f.renderer.isAvailable).toBe(true);
        expect(f.lateListeners.size).toBe(0); expect(f.timers.size).toBe(0);
    });

    test("late builder-module arrival can recover an earlier known root with incomplete builders", async () => {
        const f = fixture(); f.available(); f.state.layout = undefined;
        expect(await f.renderer.initialize()).toBe(false); expect(f.lateListeners.size).toBe(1);
        f.available(); f.publish({newLayoutBuilders: true});
        for (let turn = 0; turn < 10; turn++) await Promise.resolve();
        expect(f.patches).toEqual(["buildLayout"]); expect(f.lateListeners.size).toBe(0);
    });

    test("document unload cancels the retained navigation subscription and prevents late retries", async () => {
        const f = fixture(); const ready = f.renderer.initialize(); f.expire(); await ready;
        expect(f.lateListeners.size).toBe(1); f.unload(); expect(f.lateListeners.size).toBe(0);
        f.available(); f.publish({A: f.state.root});
        for (let turn = 0; turn < 10; turn++) await Promise.resolve();
        expect(f.patches).toEqual([]); expect(await f.renderer.initialize()).toBe(false);
    });
});
