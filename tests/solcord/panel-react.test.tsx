import {afterAll, afterEach, describe, expect, mock, test} from "bun:test";
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import * as StoreExports from "../../src/betterdiscord/modules/solcord/store";

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean;}).IS_REACT_ACT_ENVIRONMENT = true;
let state = StoreExports.normalizeSolcordDocument(undefined);
state.onboarding.status = "complete";
const subscriptions = new Map<string, Set<() => void>>();
function observed(name: string) {
    const listeners = new Set<() => void>(); subscriptions.set(name, listeners);
    return {addChangeListener: (listener: () => void) => {listeners.add(listener);}, removeChangeListener: (listener: () => void) => {listeners.delete(listener);}};
}
function emit() {for (const listeners of subscriptions.values()) for (const listener of [...listeners]) listener();}
let reminders: Array<{id: string; label: string; dueAt: number; createdAt: number; route: string;}> = [];
const writes: string[] = [];
const toasts: string[] = [];
const store = {
    ...observed("settings"),
    snapshot: () => structuredClone(state),
readonlySnapshot: () => state,
    slice: (key: keyof typeof state) => state[key],
module: (key: keyof typeof state.modules) => state.modules[key],
    latestSetupTransaction: () => undefined,
    reopenOnboarding() {state = {...state, onboarding: StoreExports.reopenOnboardingState(state.onboarding)}; emit();},
    setSetupDraft(draft: unknown) {state = {...state, onboarding: {...state.onboarding, draft: structuredClone(draft) as never}}; emit();},
    setOnboardingStep(step: number) {state = {...state, onboarding: {...state.onboarding, lastStep: step}}; emit();},
    skipOnboarding() {state = {...state, onboarding: {...state.onboarding, status: "skipped"}}; emit();}
};
const manager = {...observed("plugins"), addonList: [], resolveAddon: () => undefined, getAddon: () => undefined, isEnabled: () => false};
const doctor = {...observed("doctor"), snapshot: () => []};
const empty: never[] = [];
const runtime = {
    ...observed("runtime"),
recoveryMode: false,
    health: () => empty,
    integrityStatus: () => ({records: empty, summary: {match: 0, missing: 0, attention: 0, unavailable: 0}}),
    curatedAdapterStatus: () => ({}),
    activityHealth: () => ({status: "idle", unrestrictedOverride: false, events: empty, counters: {discordPreloadsAccepted: 0, assignmentsRejected: 0}}),
    friendWatchEvents: () => empty,
friendWatchPersistent: () => false,
returnLaterItems: () => reminders,
    privateAccountGeneration: () => 1,
privateAccountIsCurrent: () => true,
    nativeSuiteView: () => empty,
nativeSuiteController: () => undefined,
    currentPeopleObjectId: () => undefined,
resolvePeopleObject: () => undefined,
    baselineSuiteStatus: () => ({active: false, resources: {}, enabled: empty, unavailable: empty}),
    fakeDeafenStatus: () => ({phase: "unavailable", detail: "Controlled host has no voice adapter."}),
fakeDeafenProvider: () => "off",
    audienceGuardStatus: () => ({phase: "unavailable", armed: false, detail: "Controlled host has no call."}),
    audienceGuardPrivatePolicy: () => ({loaded: false, policy: {entries: empty}, storage: {persistent: false}}),
    audienceGuardArmReadiness: () => ({ready: false, detail: "Controlled host has no call."}),
    privacyCapabilities: () => empty,
privacyDecisionReceipts: () => empty,
privacyReceiptStorage: () => "session-only",
    privacyNativePolicyStatus: () => ({state: "applied", profile: "strict"}),
    timelineStatus: () => ({records: 0, deleted: 0, edited: 0, ghostPings: 0, textBytes: 0, persistent: false}),
    timelineView: () => empty,
timelineCurrentChannel: () => ({eligible: false, included: false}),
    localIdentityNotesStatus: async () => ({persistent: false}),
readLocalIdentityNotes: async () => empty,
    previewSetup: () => ["Controlled setup preview"],
driftResults: () => empty,
    previewProfile: () => empty,
profileAddonExecutionPlan: () => ({canApply: true, changes: empty, blocked: empty}),
    acknowledgeFirstSetupIntent: async () => {},
    setProductPreferences(next: typeof state.productPreferences) {writes.push("preferences"); state = {...state, productPreferences: next}; emit(); return true;},
    setPrivacyProfile: async () => {writes.push("privacy"); throw new Error("Live privacy actions are outside this fixture flow");},
    setCuratedAddonEnabled: async () => false,
    exportDiagnostics: async () => {writes.push("diagnostics");}
};
mock.module("@assets/branding/solcord-mark.svg", () => ({"default": "controlled-solcord-mark.svg"}));
mock.module("@modules/solcord/store", () => ({...StoreExports, "default": store}));
mock.module("@modules/solcord/runtime", () => ({"default": runtime}));
mock.module("@modules/pluginmanager", () => ({"default": manager}));
mock.module("@modules/thememanager", () => ({"default": manager}));
mock.module("@modules/solcord/doctor", () => ({"default": doctor}));
mock.module("@modules/solcord/catalog-details", () => ({loadSolcordCatalogDetails: async () => []}));
mock.module("@stores/config", () => ({"default": {isCleanCandidateBuild: true, get: (key: string) => `controlled-${key}`}}));
mock.module("@stores/toasts", () => ({"default": {error: (text: string) => toasts.push(text), success: (text: string) => toasts.push(text), info: (text: string) => toasts.push(text), warning: (text: string) => toasts.push(text)}}));
mock.module("@modules/updater", () => ({CoreUpdater: {checkForUpdates: async () => {}}, PluginUpdater: {}, ThemeUpdater: {}}));
const {default: SolcordPanel} = await import("../../src/betterdiscord/ui/solcord/panel");

let root: Root | undefined;
const errors: unknown[] = [];
const frames = new Map<number, FrameRequestCallback>(); let nextFrame = 0;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
globalThis.requestAnimationFrame = callback => {frames.set(++nextFrame, callback); return nextFrame;};
globalThis.cancelAnimationFrame = id => {frames.delete(id);};
afterAll(() => {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
});
afterEach(async () => {
    if (root) await act(async () => root!.unmount()); root = undefined;
    expect([...subscriptions.values()].reduce((sum, listeners) => sum + listeners.size, 0)).toBe(0);
    expect(errors).toEqual([]);
    document.body.replaceChildren(); errors.length = 0; writes.length = 0; toasts.length = 0; reminders = [];
    frames.clear();
    state = StoreExports.normalizeSolcordDocument(undefined); state.onboarding.status = "complete";
});
async function mount() {
    const host = document.createElement("div"); document.body.append(host);
    root = createRoot(host, {onUncaughtError: error => errors.push(error), onCaughtError: error => errors.push(error)});
    await act(async () => root!.render(<SolcordPanel />));
    assertHealthy(host);
    return host;
}
function assertHealthy(host: HTMLElement) {
    expect(errors).toEqual([]);
    expect(host.querySelector("main[aria-label='Solcord Control Center']")).not.toBeNull();
    expect(host.querySelector(".react-error")).toBeNull();
    expect(host.textContent?.trim().length).toBeGreaterThan(100);
}
function button(host: HTMLElement, label: string) {
    const match = [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === label);
    if (!match) throw new Error(`Missing production control: ${label}`);
    return match;
}
async function navigate(host: HTMLElement, label: string) {
    const target = [...host.querySelectorAll<HTMLButtonElement>(".solcord-workspace-nav-list button")].find(item => item.textContent?.trim() === label);
    if (!target) throw new Error(`Missing production workspace ${label}`);
    await act(async () => target.click());
    assertHealthy(host);
}
async function flushFrames() {
    await act(async () => {const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(0);});
}

describe("production Solcord Control Center React tree with controlled host interfaces", () => {
    test("mounts a meaningful overview sentinel and reopens without orphan store subscriptions", async () => {
        const host = await mount();
        expect(host.querySelector("main[aria-label='Solcord Control Center']")).not.toBeNull();
        expect(host.querySelector("[data-workspace='overview']")?.textContent).toContain("Right now");
        expect(host.textContent).toContain("All clear");
        await act(async () => root!.render(null));
        expect([...subscriptions.values()].every(listeners => listeners.size === 0)).toBe(true);
        await act(async () => root!.render(<SolcordPanel />));
        expect(host.textContent).toContain("Right now");
        expect(writes).toEqual([]);
    });

    test("every workspace renders with unavailable optional native adapters and no privacy mutation", async () => {
        const host = await mount();
        for (const label of ["Appearance & Accessibility", "Performance", "Privacy & Safety", "Chat & Composer", "Voice & Activities", "Friends & Spaces", "Extensions", "Recovery", "Overview"]) {
            await navigate(host, label);
            expect(host.querySelector(".solcord-workspace-heading h2")?.textContent).toBe(label);
            expect(host.querySelector(".solcord-workspace")?.textContent?.trim().length).toBeGreaterThan(30);
        }
        expect(writes).toEqual([]);
    });

    test("search navigation keeps native button semantics, focuses the destination heading, and closes the compact menu", async () => {
        const host = await mount(); await flushFrames();
        const input = host.querySelector<HTMLInputElement>("input[type='search']")!;
        input.focus();
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "voice note");
            input.dispatchEvent(new Event("input", {bubbles: true}));
        });
        const results = [...host.querySelectorAll<HTMLButtonElement>(".solcord-workspace-nav-list button")];
        expect(results.map(item => item.textContent)).toEqual(["Voice & Activities"]);
        expect(results[0].type).toBe("button"); expect(results[0].tabIndex).toBe(0);
        await act(async () => results[0].click()); await flushFrames();
        expect(input.value).toBe("");
        expect(document.activeElement).toBe(host.querySelector(".solcord-workspace-heading h2"));
        expect(document.activeElement?.textContent).toBe("Voice & Activities");
        const menu = host.querySelector<HTMLDetailsElement>(".solcord-workspace-menu")!; menu.open = true;
        const recovery = [...menu.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === "Recovery")!;
        await act(async () => recovery.click()); await flushFrames();
        expect(menu.open).toBe(false); expect(document.activeElement?.textContent).toBe("Recovery");
        expect(writes).toEqual([]);
    });

    test("reopening setup from Recovery mounts its controls and leaves privacy choices untouched", async () => {
        const host = await mount(); await navigate(host, "Recovery");
        await act(async () => button(host, "Reopen setup").click()); await flushFrames();
        expect(host.querySelector("[data-workspace='overview'] .solcord-wizard")).not.toBeNull();
        expect(host.textContent).toContain("Welcome");
        expect(host.querySelector(".solcord-wizard")?.contains(document.activeElement)).toBe(true);
        expect(state.productPreferences.privacy.profile).toBe("strict");
        expect(writes).toEqual([]);
    });

    test("appearance changes use the production control and report a saved result without mutating privacy", async () => {
        const host = await mount(); await navigate(host, "Appearance & Accessibility");
        const mode = [...host.querySelectorAll<HTMLSelectElement>("select")].find(select => select.parentElement?.textContent?.startsWith("Mode"))!;
        await act(async () => {mode.value = "solcord-light"; mode.dispatchEvent(new Event("change", {bubbles: true}));});
        expect(state.productPreferences.appearance.mode).toBe("solcord-light");
        expect(host.querySelector(".solcord-save-status")?.textContent).toBe("Saved");
        expect(writes).toEqual(["preferences"]); expect(state.productPreferences.privacy.profile).toBe("strict");
    });

    test("the due reminder pulse opens the workspace containing the actionable reminder", async () => {
        reminders = [{id: "reminder-fixture", label: "Controlled reminder", dueAt: Date.now() - 1000, createdAt: 1, route: "/channels/@me/fixture"}];
        const host = await mount();
        const pulse = [...host.querySelectorAll<HTMLElement>(".solcord-pulse")].find(item => item.textContent?.includes("Return Later is due"))!;
        expect(pulse.querySelector("button")?.textContent).toBe("Review reminders");
        await act(async () => pulse.querySelector<HTMLButtonElement>("button")!.click());
        assertHealthy(host);
        expect(host.querySelector(".solcord-workspace")?.getAttribute("data-workspace")).toBe("chat");
        expect(host.querySelector("[aria-label='Return Later reminders']")?.textContent).toContain("Controlled reminder");
    });
});
