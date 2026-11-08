import {afterEach, beforeEach, describe, expect, mock, spyOn, test} from "bun:test";
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import nativeFs from "node:fs";
import path from "node:path";
import os from "node:os";
import fs from "../../src/betterdiscord/polyfill/fs";
import Config from "../../src/betterdiscord/stores/config";
import Settings, {normalizeSolcordDocument} from "../../src/betterdiscord/modules/solcord/store";
import {applyPrivacyProfile, defaultStrictPrivacyPreferences} from "../../src/common/solcord/privacy";
import {SolcordDisposalScope} from "../../src/betterdiscord/modules/solcord/disposal";
import {resolvePrivacyMethodTarget, SolcordPrivacyPolicyAdapter} from "../../src/betterdiscord/modules/solcord/privacy-policy";
import {discordAnalyticsMethods} from "../../src/betterdiscord/modules/solcord/do-not-track";
import {setSolcordAutomaticUpdatesAllowed, solcordAutomaticUpdatesAllowed} from "../../src/betterdiscord/modules/solcord/privacy-runtime-state";
import {boundedSolcordStartupOperation} from "../../src/betterdiscord/modules/solcord/startup-phases";
import {runtimeMethodFixture} from "../fixtures/solcord-method-fixture";

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean;}).IS_REACT_ACT_ENVIRONMENT = true;
const StoreConstructor = Settings.constructor as new () => typeof Settings;
const normalizeDocument = normalizeSolcordDocument;
let temporary = "";
let store: typeof Settings;
let runtime: any;
let nativeBehavior: "success" | "reject" | "pending" | "unreadable" = "success";
let releaseNative: (() => void) | undefined;
let failSave = false;
let failSaveAfter = 0;
let updateChecks = 0;
let nativeCalls = 0;
let confirms: string[] = [];
let agree = true;
const listeners = new Set<() => void>();
const spies: Array<{mockRestore(): void;}> = [];
const originalConfirm = window.confirm;
const originalChannel = process.env.DISCORD_RELEASE_CHANNEL;
const storeProxy = new Proxy({} as typeof Settings, {get: (_target, key) => {
    const value = Reflect.get(store, key);
    return typeof value === "function" ? value.bind(store) : value;
}});
const runtimeProxy = new Proxy({}, {get: (_target, key) => {
    if (key === "privacyCapabilities") return () => structuredClone(runtime.privacyCapabilities);
    const value = Reflect.get(runtime, key);
    return typeof value === "function" ? value.bind(runtime) : value;
}});
mock.module("@modules/solcord/store", () => ({"default": storeProxy}));
mock.module("@modules/solcord/runtime", () => ({"default": runtimeProxy}));
const update = async () => {updateChecks++;};
mock.module("@modules/updater", () => ({CoreUpdater: {checkForUpdate: update}, PluginUpdater: {checkAll: update}, ThemeUpdater: {checkAll: update}}));
const electron = {app: {getPath: () => {
    if (!temporary || nativeBehavior === "unreadable") throw Error("No readable user profile in this fixture");
    return path.join(temporary, "Discord");
}}};
mock.module("electron", () => ({"default": electron, ...electron}));
const {installNativePrivacyGuard, synchronizeNativePrivacy} = await import("../../src/electron/main/modules/privacy-network");
const {default: PrivacyProtectionPanel} = await import("../../src/betterdiscord/ui/solcord/privacy");
let root: Root | undefined;
let nativeRequest: (url: string) => boolean;
const settingsBoundary = {
    snapshot: () => store.snapshot(),
    capture: (...args: Parameters<typeof Settings.capture>) => store.capture(...args),
    setProductPreferences: (...args: Parameters<typeof Settings.setProductPreferences>) => store.setProductPreferences(...args),
    rollback: (...args: Parameters<typeof Settings.rollback>) => store.rollback(...args)
};
const manager = {addonList: [], isEnabled: () => false};
const logger = {warn() {}};
const nativeSync = runtimeMethodFixture("#synchronizeNativePrivacyPolicy", {
    IPC: {synchronizePrivacyPolicy: async (preferences: ReturnType<typeof defaultStrictPrivacyPreferences>) => {
        nativeCalls++;
        if (nativeBehavior === "reject") throw Error("Native policy unavailable");
        if (nativeBehavior === "pending") await new Promise<void>(resolve => {releaseNative = resolve;});
        return synchronizeNativePrivacy(preferences);
    }},
Logger: logger,
boundedSolcordStartupOperation
});
const synchronize = runtimeMethodFixture("#synchronizePrivacyPolicy", {
    SolcordSettings: settingsBoundary,
setSolcordAutomaticUpdatesAllowed,
Logger: logger,
    SolcordDisposalScope,
SolcordPrivacyPolicyAdapter,
resolvePrivacyMethodTarget,
    getByKeys: () => undefined,
    getModule: () => undefined,
getStore: () => undefined,
resolveDiscordAnalyticsTrack: () => undefined,
    discordAnalyticsMethods,
    DiscordModules: {},
Patcher: {},
PluginManager: manager,
ThemeManager: manager,
    strictCommunityAddonActivationDecision: () => undefined,
strictCommunityThemeActivationDecision: () => undefined,
    SOLCORD_CATALOG_INDEX: [],
createPrivacyDecisionReceipt: () => ({})
});
const setProfile = runtimeMethodFixture("setPrivacyProfile", {
    SolcordSettings: settingsBoundary, PluginManager: manager, ThemeManager: manager, applyPrivacyProfile
});
const rollback = runtimeMethodFixture("#restorePrivacyRollback", {SolcordSettings: settingsBoundary, PluginManager: manager, ThemeManager: manager});

beforeEach(() => {
    temporary = nativeFs.mkdtempSync(path.join(os.tmpdir(), "solcord-privacy-panel-"));
    const channelPath = path.join(temporary, "BetterDiscord", "data", "stable");
    nativeFs.mkdirSync(channelPath, {recursive: true});
    process.env.DISCORD_RELEASE_CHANNEL = "stable";
    nativeBehavior = "success"; failSave = false; failSaveAfter = 0; updateChecks = 0; nativeCalls = 0; agrees(true);
    spies.push(
        spyOn(Config, "get").mockImplementation(() => channelPath),
        spyOn(fs, "mkdirSync").mockImplementation((...args) => nativeFs.mkdirSync(...args)),
        spyOn(fs, "writeFileSync").mockImplementation((...args) => nativeFs.writeFileSync(...args)),
        spyOn(fs, "renameSync").mockImplementation((...args) => {if (failSave || (failSaveAfter > 0 && --failSaveAfter === 0)) throw Error("Simulated privacy save failure"); nativeFs.renameSync(...args);}),
        spyOn(fs, "readFileSync").mockImplementation((file) => nativeFs.readFileSync(file)),
        spyOn(fs, "existsSync").mockImplementation(file => nativeFs.existsSync(file)),
        spyOn(fs, "unlinkSync").mockImplementation(file => nativeFs.unlinkSync(file))
    );
    store = new StoreConstructor();
    store.initialize();
    runtime = {
        privacyNativeGeneration: 0,
privacyNativeStatus: {state: "unverified"},
privacyScope: new SolcordDisposalScope(),
privacyCapabilitiesList: [],
        addChangeListener: (listener: () => void) => {listeners.add(listener);},
removeChangeListener: (listener: () => void) => {listeners.delete(listener);},
        emitChange() {for (const listener of listeners) listener();},
        synchronizeNativePrivacyPolicy(preferences: unknown) {return nativeSync.call(this, preferences);},
        synchronizePrivacyPolicy() {return synchronize.call(this);},
        setPrivacyProfile(profile: string) {return setProfile.call(this, profile);},
        restorePrivacyRollback(changed: unknown, id: string) {return rollback.call(this, changed, id);},
        enabledAddonFiles: () => [],
        recordPrivacyDecision() {},
        privacyNativePolicyStatus() {return {...this.privacyNativeStatus};},
        privacyDecisionReceipts: () => [],
privacyReceiptStorage: () => "session-only"
    };
    // A property backs the private capability field in the extracted shipping methods.
    runtime.privacyCapabilities = [];
    let before: ((details: {url: string;}, callback: (response: {cancel?: boolean;}) => void) => void) | undefined;
    installNativePrivacyGuard({webRequest: {onBeforeRequest: (_filter: unknown, callback: typeof before) => {before = callback;}, onHeadersReceived() {}}} as any);
    nativeRequest = url => {let canceled = false; before!({url}, response => {canceled = response.cancel === true;}); return canceled;};
});

function agrees(value: boolean) {agree = value; confirms = []; window.confirm = message => {confirms.push(message ?? ""); return agree;};}
afterEach(async () => {
    releaseNative?.(); releaseNative = undefined;
    if (root) await act(async () => root!.unmount());
    root = undefined; document.body.replaceChildren(); listeners.clear();
    for (const spy of spies.splice(0)) spy.mockRestore();
    window.confirm = originalConfirm;
    if (originalChannel === undefined) delete process.env.DISCORD_RELEASE_CHANNEL;
    else process.env.DISCORD_RELEASE_CHANNEL = originalChannel;
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(temporary));
    if (!relative.startsWith("solcord-privacy-panel-") || relative.includes(path.sep)) throw Error("Unexpected privacy fixture cleanup target");
    nativeFs.rmSync(temporary, {recursive: true, force: true}); temporary = "";
});

async function mount() {
    const host = document.createElement("div"); document.body.append(host);
    root = createRoot(host); await act(async () => root!.render(<PrivacyProtectionPanel />));
    return host;
}
function button(host: HTMLElement, text: string) {return [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === text)!;}
function disk() {return JSON.parse(nativeFs.readFileSync(path.join(temporary, "BetterDiscord", "data", "stable", "solcord.json"), "utf8"));}

describe("production Privacy panel with durable settings and native request guard", () => {
    test("defaults strict without sending checks and distinguishes unverified enforcement", async () => {
        const host = await mount();
        expect(store.snapshot().productPreferences.privacy).toEqual(defaultStrictPrivacyPreferences());
        expect(nativeRequest("https://discord.com/api/v9/science")).toBeTrue();
        expect(nativeRequest("https://discord.com/api/v9/channels/1/messages")).toBeFalse();
        expect(host.textContent).toContain("not confirmed for the saved profile");
        expect(host.textContent).not.toContain("Strict Privacy applied");
        expect(updateChecks).toBe(0); expect(nativeCalls).toBe(0);
    });

    test("Standard requires disclosed confirmation and durable consent before the native guard allows", async () => {
        const host = await mount();
        agrees(false);
        await act(async () => button(host, "Use Standard").click());
        expect(confirms[0]).toContain("optional Discord telemetry");
        expect(confirms[0]).toContain("automatic addon and theme update checks");
        expect(store.snapshot().productPreferences.privacy.profile).toBe("strict");
        expect(nativeRequest("https://discord.com/api/v9/science")).toBeTrue();
        agrees(true);
        await act(async () => button(host, "Use Standard").click());
        expect(disk().productPreferences.privacy).toEqual(expect.objectContaining({profile: "standard", migrationPending: false, migratedAt: expect.any(Number)}));
        expect(nativeRequest("https://discord.com/api/v9/science")).toBeFalse();
        expect(button(host, "Standard on").disabled).toBeTrue();
        expect(host.textContent).toContain("Native optional-request policy acknowledged");
        expect(solcordAutomaticUpdatesAllowed()).toBeTrue();
        expect(updateChecks).toBe(0);
    });

    test("a failed durable save keeps the prior profile, guard and rollback state", async () => {
        const before = disk();
        const host = await mount();
        failSave = true;
        await act(async () => button(host, "Use Standard").click());
        expect(store.snapshot()).toEqual(before);
        expect(disk()).toEqual(before);
        expect(host.textContent).toContain("Simulated privacy save failure");
        expect(host.textContent).not.toContain("Standard privacy saved");
        expect(nativeRequest("https://discord.com/api/v9/science")).toBeTrue();
        expect(nativeCalls).toBe(0);
    });

    test("a preference commit failure after snapshot capture verifies rollback without granting allows", async () => {
        const before = disk();
        const host = await mount();
        failSaveAfter = 2;
        await act(async () => button(host, "Use Standard").click());
        expect(store.snapshot().productPreferences).toEqual(before.productPreferences);
        expect(disk().productPreferences).toEqual(before.productPreferences);
        expect(disk().snapshots.some((snapshot: {reason: string;}) => snapshot.reason === "Before applying standard privacy")).toBeTrue();
        expect(host.textContent).toContain("Simulated privacy save failure");
        expect(host.textContent).not.toContain("Standard privacy saved");
        expect(nativeRequest("https://discord.com/api/v9/science")).toBeTrue();
        expect(solcordAutomaticUpdatesAllowed()).toBeFalse();
    });

    test("a native rejection leaves strict saved and exposes retry without claiming enforcement", async () => {
        const standard = store.snapshot().productPreferences;
        store.setProductPreferences({...standard, privacy: applyPrivacyProfile(standard.privacy, "standard", 42)});
        synchronizeNativePrivacy(store.snapshot().productPreferences.privacy);
        expect(nativeRequest("https://discord.com/api/v9/science")).toBeFalse();
        const host = await mount(); nativeBehavior = "reject";
        await act(async () => button(host, "Use Strict Privacy").click());
        expect(disk().productPreferences.privacy.profile).toBe("strict");
        expect(host.textContent).toContain("native request protection could not be confirmed");
        expect(host.textContent).toContain("Unsupported");
        expect(host.textContent).not.toContain("Strict Privacy applied");
        expect(button(host, "Use Strict Privacy").disabled).toBeFalse();
        // Rejected synchronization cannot truthfully claim the previous native
        // Standard policy changed. A retry must actually reach the guard.
        expect(nativeRequest("https://discord.com/api/v9/science")).toBeFalse();
        nativeBehavior = "success";
        await act(async () => button(host, "Use Strict Privacy").click());
        expect(nativeRequest("https://discord.com/api/v9/science")).toBeTrue();
        expect(button(host, "Strict Privacy on").disabled).toBeTrue();
    });

    test("pending native acknowledgement locks every privacy action and prevents competing changes", async () => {
        const host = await mount(); nativeBehavior = "pending";
        await act(async () => {button(host, "Use Standard").click(); button(host, "Use Strict Privacy").click(); button(host, "Check for updates").click();});
        expect([...host.querySelectorAll("button")].every(item => item.disabled)).toBeTrue();
        expect(host.textContent).toContain("not yet confirmed");
        expect(host.textContent).not.toContain("Standard privacy saved");
        expect(confirms).toHaveLength(1); expect(nativeCalls).toBe(1); expect(updateChecks).toBe(0);
        await act(async () => {releaseNative!(); await Promise.resolve();});
        expect(button(host, "Standard on").disabled).toBeTrue();
        expect(button(host, "Use Strict Privacy").disabled).toBeFalse();
    });

    test("legacy migration stays strict until an explicit review is durably saved", async () => {
        const migrated = normalizeDocument({schemaVersion: 6, productPreferences: {privacy: {profile: "standard", telemetry: "allow", updates: "automatic"}}});
        store.setProductPreferences(migrated.productPreferences);
        const host = await mount();
        expect(host.textContent).toContain("Needs review");
        expect(store.snapshot().productPreferences.privacy).toEqual({...defaultStrictPrivacyPreferences(), migrationPending: true});
        await act(async () => button(host, "Use Strict Privacy").click());
        expect(disk().productPreferences.privacy).toEqual(expect.objectContaining({profile: "strict", migrationPending: false, migratedAt: expect.any(Number)}));
        expect(host.textContent).not.toContain("Needs review");
        expect(nativeRequest("https://discord.com/api/v9/science")).toBeTrue();
    });

    test("an older IPC completion cannot overwrite the latest profile status or relax a later durable Strict choice", async () => {
        for (const [olderProfile, newerProfile] of [["standard", "strict"], ["strict", "standard"]] as const) {
            nativeBehavior = "pending";
            const initial = store.snapshot().productPreferences;
            store.setProductPreferences({...initial, privacy: applyPrivacyProfile(initial.privacy, olderProfile)});
            const older = runtime.synchronizeNativePrivacyPolicy(store.snapshot().productPreferences.privacy);
            await Promise.resolve();
            const finishOlder = releaseNative!;
            const latest = store.snapshot().productPreferences;
            store.setProductPreferences({...latest, privacy: applyPrivacyProfile(latest.privacy, newerProfile)});
            const newer = runtime.synchronizeNativePrivacyPolicy(store.snapshot().productPreferences.privacy);
            await Promise.resolve();
            const finishNewer = releaseNative!;
            finishNewer(); await newer;
            expect(runtime.privacyNativePolicyStatus()).toEqual({state: "applied", profile: newerProfile});
            finishOlder(); await older;
            expect(runtime.privacyNativePolicyStatus()).toEqual({state: "applied", profile: newerProfile});
            if (newerProfile === "strict") expect(nativeRequest("https://discord.com/api/v9/science")).toBeTrue();
        }
    });

    test("an IPC timeout finishes in an unconfirmed state rather than latching the controls", async () => {
        const timed = runtimeMethodFixture("#synchronizeNativePrivacyPolicy", {
            IPC: {synchronizePrivacyPolicy: () => new Promise<void>(() => {})},
Logger: logger,
            boundedSolcordStartupOperation: (operation: Promise<void>) => boundedSolcordStartupOperation(operation, 5)
        });
        const operation = timed.call(runtime, defaultStrictPrivacyPreferences());
        expect(runtime.privacyNativePolicyStatus()).toEqual({state: "pending", profile: "strict"});
        await operation;
        expect(runtime.privacyNativePolicyStatus()).toEqual({state: "failed", profile: "strict"});
    });

    test("a failing status observer cannot prevent native privacy enforcement", async () => {
        runtime.emitChange = () => {throw Error("Observer failed");};
        await runtime.synchronizeNativePrivacyPolicy(defaultStrictPrivacyPreferences());
        expect(nativeCalls).toBe(1);
        expect(runtime.privacyNativePolicyStatus()).toEqual({state: "applied", profile: "strict"});
        expect(nativeRequest("https://discord.com/api/v9/science")).toBeTrue();
    });

    test("a stricter native clamp never claims Standard acknowledgement when durable consent cannot be read", async () => {
        const host = await mount(); nativeBehavior = "unreadable";
        await act(async () => button(host, "Use Standard").click());
        expect(disk().productPreferences.privacy.profile).toBe("standard");
        expect(runtime.privacyNativePolicyStatus()).toEqual({state: "failed", profile: "standard"});
        expect(nativeRequest("https://discord.com/api/v9/science")).toBeTrue();
        expect(host.textContent).toContain("native request protection could not be confirmed");
        expect(host.textContent).not.toContain("Native optional-request policy acknowledged");
        expect(button(host, "Use Standard").disabled).toBeFalse();
        nativeBehavior = "success";
        await act(async () => button(host, "Use Standard").click());
        expect(button(host, "Standard on").disabled).toBeTrue();
        expect(nativeRequest("https://discord.com/api/v9/science")).toBeFalse();
    });
});
