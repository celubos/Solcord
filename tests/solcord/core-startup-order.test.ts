import {beforeEach, describe, expect, mock, test} from "bun:test";

const calls: string[] = [];
let storageFailures = 0;
let privacyReady = true;
let integrityReady = true;
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
mock.module("@modules/discordmodules", () => ({"default": {}}));
mock.module("@modules/updater", () => ({"default": {initialize: note("updater")}}));
mock.module("@modules/addonstore", () => ({"default": {initialize: note("store")}}));
mock.module("@ui/modals", () => ({"default": {showChangelogModal: noop}}));
mock.module("@ui/floatingwindows", () => ({"default": {initialize: noop}}));
mock.module("@ui/toasts", () => ({"default": {initialize: noop}}));
mock.module("@ui/settings", () => ({"default": {initialize: noop}}));
mock.module("@modules/commandmanager", () => ({"default": {initialize: noop}}));
mock.module("@ui/customcss/mdinstallcss", () => ({"default": {initialize: noop}}));
mock.module("@styles/index.css", () => ({"default": "fixture"}));
mock.module("@styles/fonts/HankenGrotesk-variable.ttf", () => ({"default": "fixture-font"}));
mock.module("@ui/solcord/panel", () => ({"default": noop}));
mock.module("lucide-react", () => ({ShieldCheckIcon: noop}));
mock.module("@modules/patcher", () => ({"default": {after: noop}}));
mock.module("@webpack", () => ({allModulesLoaded: Promise.resolve(), getStore: () => undefined, Stores: {UserStore: {getCurrentUser: () => ({})}}}));
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
beforeEach(() => {
    calls.length = 0; storageFailures = 0; privacyReady = true; integrityReady = true;
    Core.hasStarted = false; Core.startupState = "idle";
    (Core as unknown as {completedPhases: Set<string>;}).completedPhases.clear();
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
});
