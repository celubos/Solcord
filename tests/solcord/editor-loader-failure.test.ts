import {beforeEach, describe, expect, mock, test} from "bun:test";

const noop = () => {};
let mode: "script-error" | "amd-error" | "stall" | "success" = "success";
const requested: string[] = [];
let lateSuccess: ((value: unknown) => void) | undefined;
const commonjs = () => undefined;
const monaco = {languages: {registerCompletionItemProvider: noop, typescript: {javascriptDefaults: {setDiagnosticsOptions: noop, setCompilerOptions: noop}, ScriptTarget: {ESNext: 99}}}};
const amd = Object.assign((ids: string[], success: (value: unknown) => void, failure?: (error: Error) => void) => {
    if (ids[0] !== "vs/editor/editor.main") {success({BrowserClipboardService: class {readText() {return "";}}}); return;}
    if (mode === "amd-error") {failure?.(new Error("fixture-AMD-failure")); return;}
    if (mode === "stall") {lateSuccess = success; return;}
    success(monaco);
}, {config: noop});
mock.module("@common/logger", () => ({"default": {log: noop, error: noop}}));
mock.module("@webpack", () => ({getAllModules: () => [], webpackRequire: {}}));
mock.module("@modules/patcher", () => ({"default": {instead: noop}}));
mock.module("@modules/dommanager", () => ({"default": {
    linkStyle: (_id: string, url: string) => {requested.push(url);},
removeScript: noop,
    injectScript: async (_id: string, url: string) => {
        requested.push(url);
        if (mode === "script-error") throw new Error("fixture-local-asset-unavailable");
        Object.defineProperty(window, "require", {value: amd, writable: true, configurable: true});
    }
}}));
const {default: Editor} = await import("../../src/betterdiscord/modules/editor");
const bounded = Editor as unknown as {withDeadline<T>(promise: Promise<T>, timeoutMs?: number): Promise<T>;};
const deadline = bounded.withDeadline.bind(Editor);
bounded.withDeadline = <T>(promise: Promise<T>) => deadline(promise, 5);

beforeEach(() => {
    requested.length = 0; lateSuccess = undefined;
    Editor.initPromise = null; Editor.failedToLoad = false;
    Reflect.deleteProperty(window, "monaco");
    Object.defineProperty(window, "require", {value: commonjs, writable: true, configurable: true});
});
describe("actual local editor loader failures", () => {
    test("failed local script and AMD callbacks leave fallback available and a later open can retry", async () => {
        for (const failure of ["script-error", "amd-error"] as const) {
            Editor.initPromise = null; mode = failure;
            await Editor.initialize();
            expect(Editor.failedToLoad).toBe(true); expect(Editor.initPromise).toBeNull();
            expect(window.require as unknown).toBe(commonjs);
        }
        mode = "success";
        await Editor.initialize();
        expect(Editor.failedToLoad).toBe(false); expect(window.monaco as unknown).toBe(monaco);
        expect(window.require as unknown).toBe(commonjs);
        expect(requested.every(url => url.startsWith("solcord://editor/monaco/"))).toBe(true);
    });

    test("a stalled AMD request is bounded and its late callback cannot take over a retry", async () => {
        mode = "stall";
        await Editor.initialize();
        expect(Editor.failedToLoad).toBe(true); expect(window.monaco).toBeUndefined();
        mode = "success";
        await Editor.initialize();
        const active = window.monaco;
        lateSuccess?.({fixture: "obsolete"});
        await Promise.resolve();
        expect(window.monaco).toBe(active); expect(Editor.failedToLoad).toBe(false);
    });
});
