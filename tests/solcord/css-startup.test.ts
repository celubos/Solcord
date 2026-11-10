// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs";
import {runInNewContext} from "node:vm";
import {transform} from "esbuild";
import {expect, test} from "bun:test";

const source = fs.readFileSync(new URL("../../src/betterdiscord/ui/customcss/mdinstallcss.tsx", import.meta.url), "utf8");
const code = (await transform(source, {loader: "tsx", format: "cjs", target: "es2022"})).code;

function fixture() {
    const state = {wrapper: false, stalled: false, styleFails: false, lookups: 0, activeLookups: 0, patches: 0, cancels: 0, signals: [] as AbortSignal[], lateResolve: undefined as ((value: unknown) => void) | undefined};
    const deadlines = new Map<number, {callback:() => void; delay: number}>();
    const unload = new Set<() => void>();
    const styles = new Set<string>();
    const module = {exports: {} as {default: any}};
    const classes = {markup: "markup", codeContainer: "container", codeActions: "actions"};
    const markdown = {defaultRules: {codeBlock: {react() {}}}};
    const dependencies: Record<string, unknown> = {
        "@modules/patcher": {after() {state.patches++; return () => {state.cancels++;};}},
        "@builtins/customcss": {},
"react": {},
"@stores/settings": {},
"@stores/toasts": {},
        "@modules/discordmodules": {get SimpleMarkdownWrapper() {return state.wrapper ? markdown : undefined;}},
        "@common/i18n": {t: (key: string) => key},
"lucide-react": {PackageOpenIcon() {}},
        "@webpack": {Filters: {byKeys: () => () => true},
getLazy(_filter: unknown, options: {signal: AbortSignal}) {
            state.lookups++; state.signals.push(options.signal);
            if (!state.stalled) return Promise.resolve(classes);
            state.activeLookups++;
            options.signal.addEventListener("abort", () => state.activeLookups--, {once: true});
            // Deliberately ignore cancellation resolution: the caller's own
            // bound must still settle rather than depend on a host Promise.
            return new Promise(resolve => {state.lateResolve = resolve;});
        }},
        "@common/logger": {warn() {}},
"@ui/notifications": {},
"@ui/modals": {},
"@common/utils": {findInTree() {}},
        "@modules/dommanager": {injectStyle(id: string) {styles.add(id); if (state.styleFails) throw Error("fixture partial style write");}, removeStyle(id: string) {styles.delete(id);}}
    };
    runInNewContext(code, {module,
exports: module.exports,
AbortController,
        setTimeout(callback: () => void, delay: number) {const id = deadlines.size + 1; deadlines.set(id, {callback, delay}); return id;},
        clearTimeout(id: number) {deadlines.delete(id);},
        window: {addEventListener(_event: string, listener: () => void) {unload.add(listener);}, removeEventListener(_event: string, listener: () => void) {unload.delete(listener);}},
        require(name: string) {if (!(name in dependencies)) throw Error(`Unexpected dependency ${name}`); return dependencies[name];}
    });
    return {state, ui: module.exports.default, deadlines, unload, styles};
}

test("missing Markdown returns false and later available integration initializes once", async () => {
    const f = fixture();
    expect(await f.ui.initialize()).toBeFalse(); expect(f.state.lookups).toBe(0);
    expect(f.deadlines.size).toBe(0); expect(f.unload.size).toBe(0);
    f.state.wrapper = true;
    const first = f.ui.initialize(); expect(f.ui.initialize()).toBe(first);
    expect(await first).toBeTrue(); expect(await f.ui.initialize()).toBeTrue();
    expect(f.state.lookups).toBe(1); expect(f.state.patches).toBe(1); expect(f.styles.size).toBe(1);
    expect(f.deadlines.size).toBe(0); expect(f.unload.size).toBe(0);
});

test("an unavailable lazy chunk reaches its deadline, cancels lookup and cannot patch on late success", async () => {
    const f = fixture(); f.state.wrapper = true; f.state.stalled = true;
    const task = f.ui.initialize(); await Promise.resolve();
    const deadline = [...f.deadlines.values()][0]; expect(deadline.delay).toBe(10_000);
    deadline.callback(); expect(await task).toBeFalse();
    expect(f.state.activeLookups).toBe(0); expect(f.state.signals[0].aborted).toBeTrue();
    expect(f.deadlines.size).toBe(0); expect(f.unload.size).toBe(0);
    f.state.lateResolve?.({markup: "markup", codeContainer: "container", codeActions: "actions"}); await Promise.resolve();
    expect(f.state.patches).toBe(0); expect(f.styles.size).toBe(0);
});

test("document exit cancels initialization and removes its exact timer and listener", async () => {
    const f = fixture(); f.state.wrapper = true; f.state.stalled = true;
    const task = f.ui.initialize(); await Promise.resolve();
    for (const cancel of [...f.unload]) cancel();
    expect(await task).toBeFalse(); expect(f.state.activeLookups).toBe(0);
    expect(f.deadlines.size).toBe(0); expect(f.unload.size).toBe(0); expect(f.state.patches).toBe(0);
});

test("a partial stylesheet failure removes the installed patch and owned style before retry", async () => {
    const f = fixture(); f.state.wrapper = true; f.state.styleFails = true;
    expect(await f.ui.initialize()).toBeFalse(); expect(f.state.patches - f.state.cancels).toBe(0); expect(f.styles.size).toBe(0);
    f.state.styleFails = false;
    expect(await f.ui.initialize()).toBeTrue(); expect(f.state.patches - f.state.cancels).toBe(1); expect(f.styles.size).toBe(1);
});
