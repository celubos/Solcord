import {afterAll, afterEach, describe, expect, mock, spyOn, test} from "bun:test";
import React, {act, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean;}).IS_REACT_ACT_ENVIRONMENT = true;
const subscriptions = new Set<() => void>();
const observed = {addChangeListener: (listener: () => void) => {subscriptions.add(listener);}, removeChangeListener: (listener: () => void) => {subscriptions.delete(listener);}};
const opened: string[] = []; const copies: string[] = []; const settingsWrites: unknown[][] = [];
const consoleErrors: unknown[][] = [];
// Keep production diagnostics visible while treating them as fixture failures.
// eslint-disable-next-line no-console
const originalConsoleError = console.error;
const consoleErrorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {consoleErrors.push(args); originalConsoleError(...args);});
let debugBuilds = 0;
const settings = {...observed, get: () => false, set: (...args: unknown[]) => settingsWrites.push(args), openPanel: (id: string) => {opened.push(id); return true;}};
const manager = {...observed, addonList: []};
mock.module("@modules/pluginmanager", () => ({"default": manager}));
mock.module("@modules/thememanager", () => ({"default": manager}));
mock.module("@stores/settings", () => ({"default": settings}));
mock.module("@common/i18n", () => ({t: (key: string) => key}));
mock.module("@webpack", () => ({Stores: {UserStore: {getCurrentUser: () => ({id: "controlled-user"})}}}));
mock.module("@modules/discordmodules", () => ({"default": {
    Tooltip: ({children}: {children(props: object): ReactNode;}) => <div data-controlled-tooltip="true">{children({})}</div>
}}));
mock.module("@utils/debug", () => ({
    "default": () => {debugBuilds++; return "controlled diagnostics";},
    "getAddonCounts": () => ({total: 0, enabled: 0}),
"getCoreInfo": () => "controlled-version",
"getDiscordInfo": () => ["Discord controlled-host"]
}));
const originalNative = Object.getOwnPropertyDescriptor(globalThis, "DiscordNative");
Object.defineProperty(globalThis, "DiscordNative", {configurable: true, value: {clipboard: {copy: (text: string) => copies.push(text)}}});
afterAll(() => {
    consoleErrorSpy.mockRestore();
    if (originalNative) Object.defineProperty(globalThis, "DiscordNative", originalNative);
    else Reflect.deleteProperty(globalThis, "DiscordNative");
});
const {default: VersionInfo} = await import("../../src/betterdiscord/ui/misc/versioninfo");
let root: Root | undefined;
const errors: unknown[] = [];
afterEach(async () => {
    if (root) await act(async () => root!.unmount()); root = undefined;
    expect(subscriptions.size).toBe(0); expect(errors).toEqual([]);
    const reported = consoleErrors.splice(0); expect(reported).toEqual([]);
    document.body.replaceChildren(); opened.length = 0; copies.length = 0; settingsWrites.length = 0; debugBuilds = 0;
});
async function mount() {
    const host = document.createElement("div"); document.body.append(host);
    root = createRoot(host, {onCaughtError: error => errors.push(error), onUncaughtError: error => errors.push(error)});
    await act(async () => root!.render(<VersionInfo />));
    return host;
}

describe("production VersionInfo independent Solcord entry", () => {
    test("opens the registered suite without bubbling into diagnostic copying or developer settings", async () => {
        const host = await mount();
        const entry = host.querySelector<HTMLButtonElement>("button.solcord-settings-entry")!;
        expect(entry.textContent).toBe("Open Solcord Suite"); expect(entry.type).toBe("button"); expect(entry.tabIndex).toBe(0);
        expect(entry.closest(".bd-version-info")).toBeNull();
        entry.focus(); await act(async () => entry.click());
        expect(document.activeElement).toBe(entry); expect(opened).toEqual(["solcord"]);
        expect(copies).toEqual([]); expect(debugBuilds).toBe(0); expect(settingsWrites).toEqual([]);
    });

    test("keeps the separate existing footer copy action functional as a clipboard-spy control", async () => {
        const host = await mount();
        await act(async () => host.querySelector<HTMLElement>(".bd-version-info")!.click());
        expect(copies).toEqual(["```md\ncontrolled diagnostics\n```"]); expect(debugBuilds).toBe(1);
        expect(opened).toEqual([]); expect(settingsWrites).toEqual([]);
        await act(async () => host.querySelector<HTMLButtonElement>("button.solcord-settings-entry")!.click());
        expect(opened).toEqual(["solcord"]); expect(copies).toHaveLength(1);
    });

    test("mounts again after removal without retaining old subscriptions", async () => {
        const host = await mount(); await act(async () => root!.render(null)); expect(subscriptions.size).toBe(0);
        await act(async () => root!.render(<VersionInfo />));
        await act(async () => host.querySelector<HTMLButtonElement>("button.solcord-settings-entry")!.click());
        expect(opened).toEqual(["solcord"]); expect(copies).toEqual([]);
    });
});
