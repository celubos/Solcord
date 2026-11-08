import {beforeEach, describe, expect, mock, test} from "bun:test";
import {DiscordConnectionTimeoutError} from "../../src/betterdiscord/modules/connection";

const calls: string[] = [];
let storageFailures = 0;
let privacyReady = true;
let integrityReady = true;
let commandsReady = true;
let decorationFails = false;
let settingsAttempts = 0;
let settingsUnavailable = 0;
let userReady = true;
const connectionListeners = new Set<() => void>();
const note = (name: string) => () => {calls.push(name);};
const noop = () => {};
mock.module("@common/logger", () => ({"default": {log: noop, warn: noop, error: note("failure")}}));
mock.module("@stores/config", () => ({"default": {get: () => "fixture"}}));
mock.module("@data/changelog", () => ({"default": {}}));
mock.module("@builtins/builtins", () => ({FixtureBuiltin: {initialize: note("builtin")}}));
mock.module("../../src/betterdiscord/loadingicon", () => ({"default": {hide: note("hide")}}));
mock.module("@modules/localemanager", () => ({"default": {initialize: note("locale")}}));
mock.module("@modules/dommanager", () => ({"default": {injectStyle: noop}}));
mock.module("@stores/settings", () => ({"default": {initialize: note("settings"), registerPanel: noop}}));
mock.module("@stores/json", () => ({"default": {get: () => "fixture", set: noop}}));
mock.module("@stores/toasts", () => ({"default": {success: noop, error: noop}}));
mock.module("@modules/discordmodules", () => ({"default": {Dispatcher: {
    subscribe(_event: string, listener: () => void) {connectionListeners.add(listener);},
    unsubscribe(_event: string, listener: () => void) {connectionListeners.delete(listener);}
}}}));
mock.module("@modules/updater", () => ({"default": {initialize: note("updater")}}));
mock.module("@modules/addonstore", () => ({"default": {initialize: note("store")}}));
mock.module("@ui/modals", () => ({"default": {showChangelogModal: noop}}));
mock.module("@ui/floatingwindows", () => ({"default": {initialize: noop}}));
mock.module("@ui/toasts", () => ({"default": {initialize: noop}}));
mock.module("@ui/settings", () => ({"default": {initialize() {settingsAttempts++; return --settingsUnavailable < 0;}}}));
mock.module("@modules/commandmanager", () => ({"default": {initialize: () => commandsReady}}));
mock.module("@ui/customcss/mdinstallcss", () => ({"default": {initialize() {if (decorationFails) throw Error("optional-host-chunk");}}}));
mock.module("@styles/index.css", () => ({"default": "fixture"}));
mock.module("@ui/solcord/panel", () => ({"default": noop}));
mock.module("lucide-react", () => ({ShieldCheckIcon: noop}));
mock.module("@modules/patcher", () => ({"default": {after: noop}}));
mock.module("@webpack", () => ({allModulesLoaded: Promise.resolve(), getStore: () => undefined, Stores: {UserStore: {getCurrentUser: () => userReady}}}));
for (const kind of ["plugin", "theme"]) {
    mock.module(`@modules/${kind}manager`, () => ({"default": {
        holdAddonActivation: note(`${kind}-hold`),
setAddonActivationGuard: noop,
initialize: note(`${kind}-inventory`),
        releaseAddonActivation: note(`${kind}-release`),
startAddons: note(`${kind}-start`)
    }}));
}
mock.module("@modules/solcord/runtime", () => ({"default": {
    async initialize() {calls.push("storage"); if (storageFailures-- > 0) throw Error("fixture-storage-unavailable");},
    attachControlCenter: noop,
openPendingFirstSetup: async () => {},
    async start() {calls.push("privacy"); return privacyReady;},
    async enforceAddonIntegrityBeforeStart() {calls.push("integrity"); return integrityReady;},
    canActivateCommunityAddon: () => false,
canActivateCommunityTheme: () => false,
    scheduleDeferredStartup: note("deferred")
}}));
const {default: Core} = await import("../../src/betterdiscord/modules/core");
const originalWait = Core.waitForConnection;
beforeEach(() => {
    calls.length = 0; storageFailures = 0; privacyReady = true; integrityReady = true;
    commandsReady = true; decorationFails = false; settingsAttempts = 0; settingsUnavailable = 0; userReady = true;
    (Core as unknown as {connectionRetry?: AbortController;}).connectionRetry?.abort();
    connectionListeners.clear(); Core.waitForConnection = originalWait;
    Core.hasStarted = false; Core.startupState = "idle";
    (Core as unknown as {completedPhases: Set<string>;}).completedPhases.clear();
    (Core as unknown as {degradedPhases: Set<string>;}).degradedPhases.clear();
});

describe("actual Core startup order and retries", () => {
    test("private storage and privacy precede complete addon inventory and integrity precedes every activation", async () => {
        const first = Core.startup(); expect(Core.startup()).toBe(first); await first;
        const position = (name: string) => {expect(calls).toContain(name); return calls.indexOf(name);};
        expect(position("storage")).toBeLessThan(position("privacy"));
        expect(position("privacy")).toBeLessThan(position("plugin-inventory"));
        expect(position("plugin-hold")).toBeLessThan(position("plugin-inventory"));
        expect(position("plugin-inventory")).toBeLessThan(position("integrity"));
        expect(position("theme-inventory")).toBeLessThan(position("integrity"));
        expect(position("integrity")).toBeLessThan(position("plugin-release"));
        expect(position("integrity")).toBeLessThan(position("plugin-start"));
        expect(position("integrity")).toBeLessThan(position("theme-start"));
        expect(Core.startupState).toBe("ready");
    });

    test("failed storage releases startup ownership and retries without repeating completed initialization", async () => {
        storageFailures = 1;
        await Core.startup();
        expect(Core.startupState).toBe("failed"); expect(Core.hasStarted).toBe(false); expect(calls).toContain("hide");
        expect(calls).not.toContain("plugin-start");
        await Core.startup();
        expect(Core.startupState).toBe("ready");
        expect(calls.filter(name => name === "settings")).toHaveLength(1);
        expect(calls.filter(name => name === "storage")).toHaveLength(2);
        expect(calls.filter(name => name === "plugin-inventory")).toHaveLength(1);
    });

    test("a privacy prerequisite failure keeps both addon managers held", async () => {
        privacyReady = false;
        await Core.startup();
        expect(calls).not.toContain("integrity"); expect(calls).not.toContain("plugin-release"); expect(calls).not.toContain("theme-start");
    });

    test("an integrity audit failure holds both addon managers after their inventory is complete", async () => {
        integrityReady = false;
        await Core.startup();
        expect(calls).toContain("plugin-inventory"); expect(calls).toContain("theme-inventory"); expect(calls).toContain("integrity");
        expect(calls).not.toContain("plugin-release"); expect(calls).not.toContain("theme-release");
        expect(calls).not.toContain("plugin-start"); expect(calls).not.toContain("theme-start");
    });

    test("missing optional command and CSS adapters cannot abort protected addon startup", async () => {
        commandsReady = false; decorationFails = true;
        await Core.startup();
        expect(Core.hasStarted).toBe(true); expect(Core.startupState).toBe("degraded");
        expect(calls).toContain("privacy"); expect(calls).toContain("integrity"); expect(calls).toContain("plugin-start");
        const phases = (Core as unknown as {completedPhases: Set<string>;}).completedPhases;
        expect(phases.has("commands")).toBe(false); expect(phases.has("css")).toBe(false);
    });

    test("an unavailable settings integration is retried after login chunks become available", async () => {
        settingsUnavailable = 1;
        await Core.startup();
        expect(settingsAttempts).toBe(2); expect(Core.startupState).toBe("ready");
    });

    test("late command recovery retries only the owned integration without reactivating addons", async () => {
        commandsReady = false;
        await Core.startup(); await new Promise(resolve => setTimeout(resolve, 0));
        expect(Core.startupState).toBe("degraded");
        const inventoryCount = calls.filter(name => name === "plugin-inventory").length;
        const activationCount = calls.filter(name => name === "plugin-start").length;
        commandsReady = true; const retry = Core.startup(); expect(Core.startup()).toBe(retry); await retry;
        expect(Core.startupState).toBe("ready");
        expect(calls.filter(name => name === "plugin-inventory")).toHaveLength(inventoryCount);
        expect(calls.filter(name => name === "plugin-start")).toHaveLength(activationCount);
        expect(calls.filter(name => name === "privacy")).toHaveLength(1);
    });

    test("signing in after the bounded wait resumes once without repeating completed initialization", async () => {
        userReady = false;
        Core.waitForConnection = async () => {throw new DiscordConnectionTimeoutError();};
        await Core.startup();
        expect(Core.startupState).toBe("waiting"); expect(Core.hasStarted).toBe(false);
        expect(calls).not.toContain("plugin-start"); expect(connectionListeners.size).toBe(1);
        Core.waitForConnection = originalWait; userReady = true;
        for (const listener of [...connectionListeners]) {listener(); listener();}
        await Core.startup();
        expect(Core.startupState).toBe("ready"); expect(connectionListeners.size).toBe(0);
        expect(calls.filter(name => name === "settings")).toHaveLength(1);
        expect(calls.filter(name => name === "storage")).toHaveLength(1);
        expect(calls.filter(name => name === "plugin-inventory")).toHaveLength(1);
    });

    test("leaving the document retires the waiting-sign-in observer", async () => {
        userReady = false;
        Core.waitForConnection = async () => {throw new DiscordConnectionTimeoutError();};
        await Core.startup(); expect(connectionListeners.size).toBe(1);
        window.dispatchEvent(new Event("beforeunload"));
        expect(connectionListeners.size).toBe(0);
        expect((Core as unknown as {connectionRetry?: AbortController;}).connectionRetry).toBeUndefined();
    });
});
