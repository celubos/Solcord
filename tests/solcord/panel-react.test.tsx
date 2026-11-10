import {afterAll, afterEach, describe, expect, mock, test} from "bun:test";
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import * as StoreExports from "../../src/betterdiscord/modules/solcord/store";
import {SolcordFakeDeafenButton, SolcordFakeDeafenController, type SolcordFakeDeafenStatus, type SolcordGatewaySocket} from "../../src/betterdiscord/modules/solcord/fake-deafen";

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
const idleFakeStatus = (): SolcordFakeDeafenStatus => ({phase: "off", detail: "Controlled adapter is idle.", connected: false, accountBound: false, capturedVoiceState: false, armed: false});
let fakeStatus = idleFakeStatus();
let accountGeneration = 1;
let communityFakeProvider = false;
let powerOverride: ((enabled: boolean, acknowledged: boolean) => Promise<boolean>) | undefined;
const powerCalls: Array<[string, boolean, boolean]> = [];
function updateFakeConsent(enabled: boolean) {
    state = {...state, powerLab: {...state.powerLab, "fake-deafen": enabled ? {enabled: true, acknowledgementVersion: state.consentVersion, acknowledgedAt: 1} : {enabled: false, acknowledgementVersion: 0}}};
}
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
    privateAccountGeneration: () => accountGeneration,
privateAccountIsCurrent: (generation: number) => generation === accountGeneration,
    nativeSuiteView: () => empty,
nativeSuiteController: () => undefined,
    currentPeopleObjectId: () => undefined,
resolvePeopleObject: () => undefined,
    baselineSuiteStatus: () => ({active: false, resources: {}, enabled: empty, unavailable: empty}),
    fakeDeafenStatus: () => structuredClone(fakeStatus),
fakeDeafenProvider: () => communityFakeProvider ? "community" : state.powerLab["fake-deafen"].enabled ? "solcord" : "off",
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
    async setPowerExperiment(id: string, enabled: boolean, acknowledged: boolean) {
        powerCalls.push([id, enabled, acknowledged]);
        if (powerOverride) return powerOverride(enabled, acknowledged);
        updateFakeConsent(enabled);
        fakeStatus = enabled ? {...idleFakeStatus(), phase: "ready", accountBound: true, detail: "Ready. Join a voice channel, then use the adjacent Fake Deafen button."} : idleFakeStatus();
        emit(); return true;
    },
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
    fakeStatus = idleFakeStatus(); accountGeneration = 1; communityFakeProvider = false; powerOverride = undefined; powerCalls.length = 0;
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
function fakeControls(host: HTMLElement) {
    const section = [...host.querySelectorAll<HTMLElement>(".solcord-section")].find(item => item.querySelector("h3")?.textContent === "Fake Deafen");
    if (!section) throw new Error("Fake Deafen production controls did not render");
    const toggle = section.querySelector<HTMLInputElement>("input[aria-label='Keep Fake Deafen adapter ready']")!;
    return {section, toggle, feedback: () => section.querySelector(".solcord-import-status")?.textContent ?? ""};
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

    test("saving Fake Deafen consent while its adapter is idle never claims the direct control is ready", async () => {
        const host = await mount(); await navigate(host, "Voice & Activities"); const controls = fakeControls(host);
        powerOverride = async enabled => {
            updateFakeConsent(enabled); fakeStatus = {...idleFakeStatus(), detail: "Adapter is waiting for startup; no voice control is active."}; emit(); return true;
        };
        await act(async () => controls.toggle.click());
        expect(powerCalls).toEqual([["fake-deafen", true, true]]);
        expect(controls.toggle.checked).toBe(true);
        expect(controls.feedback()).toContain("waiting for startup");
        expect(controls.feedback()).not.toContain("Direct voice control is ready");
    });

    test("a failed Fake Deafen write clears earlier success feedback and keeps the saved selection", async () => {
        const host = await mount(); await navigate(host, "Voice & Activities"); const controls = fakeControls(host);
        await act(async () => controls.toggle.click());
        expect(controls.feedback().toLowerCase()).toContain("ready");
        powerOverride = async () => {throw new Error("controlled disk write failure");};
        await act(async () => controls.toggle.click());
        expect(controls.toggle.checked).toBe(true);
        expect(controls.feedback().toLowerCase()).not.toContain("ready");
        expect(controls.feedback()).toContain("did not finish");
    });

    test("Fake Deafen ready selection preserves explicit acknowledgement and disable clears it", async () => {
        const host = await mount(); await navigate(host, "Voice & Activities"); const controls = fakeControls(host);
        await act(async () => controls.toggle.click());
        expect(powerCalls).toEqual([["fake-deafen", true, true]]);
        expect(controls.toggle.checked).toBe(true); expect(controls.feedback()).toBe(fakeStatus.detail);
        expect(controls.feedback()).toContain("Join a voice channel");
        await act(async () => controls.toggle.click());
        expect(powerCalls).toEqual([["fake-deafen", true, true], ["fake-deafen", false, false]]);
        expect(controls.toggle.checked).toBe(false); expect(state.powerLab["fake-deafen"].acknowledgementVersion).toBe(0);
        expect(controls.feedback()).toBe(fakeStatus.detail);
    });

    test("Fake Deafen toggle is single-flight while saving and remains retryable after completion", async () => {
        const host = await mount(); await navigate(host, "Voice & Activities"); const controls = fakeControls(host);
        let finish!: () => void;
        powerOverride = async enabled => {
            await new Promise<void>(resolve => {finish = resolve;});
            updateFakeConsent(enabled); fakeStatus = {...idleFakeStatus(), phase: "ready", detail: "Ready. Controlled gateway validated."}; emit(); return true;
        };
        controls.toggle.focus(); await act(async () => controls.toggle.click());
        expect(controls.toggle.disabled).toBe(true); expect(controls.toggle.getAttribute("aria-busy")).toBe("true");
        await act(async () => controls.toggle.click()); expect(powerCalls).toHaveLength(1);
        await act(async () => finish());
        expect(controls.toggle.disabled).toBe(false); expect(controls.toggle.checked).toBe(true);
        expect(controls.feedback()).toBe("Ready. Controlled gateway validated.");
    });

    test("an unsupported gateway reports the runtime's attention detail and never claims ready", async () => {
        const host = await mount(); await navigate(host, "Voice & Activities"); const controls = fakeControls(host);
        powerOverride = async () => {fakeStatus = {...idleFakeStatus(), phase: "attention", detail: "Scoped gateway validation failed; nothing was patched."}; emit(); return false;};
        await act(async () => controls.toggle.click());
        expect(controls.toggle.checked).toBe(false); expect(controls.feedback()).toBe(fakeStatus.detail);
        expect(controls.feedback()).not.toContain("ready");
    });

    test("an existing community Fake Deafen provider disables the built-in toggle without writing consent", async () => {
        communityFakeProvider = true;
        const host = await mount(); await navigate(host, "Voice & Activities"); const controls = fakeControls(host);
        expect(controls.toggle.disabled).toBe(true); expect(controls.section.textContent).toContain("community plugin active");
        await act(async () => controls.toggle.click()); expect(powerCalls).toEqual([]);
    });

    test("late Fake Deafen completion cannot publish success into a replacement account's panel", async () => {
        const host = await mount(); await navigate(host, "Voice & Activities"); const controls = fakeControls(host);
        let finish!: (value: boolean) => void;
        powerOverride = () => new Promise<boolean>(resolve => {finish = resolve;});
        await act(async () => controls.toggle.click());
        await act(async () => {accountGeneration++; fakeStatus = {...idleFakeStatus(), detail: "Replacement account has no active adapter."}; emit();});
        await act(async () => finish(true));
        expect(controls.feedback()).toBe(""); expect(controls.section.textContent).toContain("Replacement account has no active adapter.");
    });

    test("a community provider arriving during a pending Fake Deafen change suppresses stale built-in feedback", async () => {
        const host = await mount(); await navigate(host, "Voice & Activities"); const controls = fakeControls(host);
        let finish!: (value: boolean) => void;
        powerOverride = () => new Promise<boolean>(resolve => {finish = resolve;});
        await act(async () => controls.toggle.click());
        await act(async () => {communityFakeProvider = true; emit();});
        await act(async () => finish(true));
        expect(controls.toggle.disabled).toBe(true); expect(controls.feedback()).toBe("");
        expect(controls.section.textContent).toContain("community plugin active");
    });

    test("leaving Voice while a Fake Deafen change is pending cannot retain feedback after reopening", async () => {
        const host = await mount(); await navigate(host, "Voice & Activities"); const controls = fakeControls(host);
        let finish!: (value: boolean) => void;
        powerOverride = () => new Promise<boolean>(resolve => {finish = resolve;});
        await act(async () => controls.toggle.click()); await navigate(host, "Overview");
        await act(async () => finish(true)); await navigate(host, "Voice & Activities");
        expect(fakeControls(host).feedback()).toBe(""); expect(errors).toEqual([]);
    });

    test("pending Fake Deafen activation shows waiting until the runtime validates account ownership", async () => {
        const host = await mount(); await navigate(host, "Voice & Activities"); const controls = fakeControls(host);
        powerOverride = async enabled => {
            updateFakeConsent(enabled);
            fakeStatus = {...idleFakeStatus(), phase: "ready", pending: true, detail: "Waiting for Discord voice controls…"}; emit(); return true;
        };
        await act(async () => controls.toggle.click());
        expect(controls.section.querySelector(".solcord-status")?.textContent).toBe("waiting");
        expect(controls.feedback()).toBe("Waiting for Discord voice controls…");
        await act(async () => {fakeStatus = {...idleFakeStatus(), phase: "ready", pending: false, accountBound: true, detail: "Ready. Scoped gateway and native voice controls validated."}; emit();});
        expect(controls.section.querySelector(".solcord-status")?.textContent).toBe("ready");
        expect(controls.feedback()).toBe("Ready. Scoped gateway and native voice controls validated.");
    });

    test("Fake Deafen voice observations remain unknown until the host supplies each boolean", async () => {
        fakeStatus = {...idleFakeStatus(), phase: "armed", armed: true};
        const host = await mount(); await navigate(host, "Voice & Activities");
        const facts = fakeControls(host).section.querySelector("dl[aria-label='Your voice state']")!;
        expect([...facts.querySelectorAll("dt")].map(item => item.textContent)).toEqual(["Your deafened icon", "Local deafen", "Discord self-deafen", "Server deafen"]);
        expect([...facts.querySelectorAll("dd")].map(item => item.textContent)).toEqual(["Not available yet", "Unknown", "Unknown", "Unknown"]);
        expect(fakeControls(host).section.textContent).toContain("latest observed state for your current call");
        expect(fakeControls(host).section.textContent).toContain("do not confirm a fresh Discord response or audio playback");
        expect(fakeControls(host).section.textContent).toContain("your voice-row icon follows the deafened state received from Discord");
        await act(async () => {fakeStatus = {...fakeStatus, ownRowIndicator: true}; emit();});
        expect([...facts.querySelectorAll("dd")].map(item => item.textContent)).toEqual(["Ready", "Unknown", "Unknown", "Unknown"]);
        expect(writes).toEqual([]); expect(powerCalls).toEqual([]);
    });

    test("Fake Deafen shows separate local and observed Discord values and updates without a control action", async () => {
        fakeStatus = {...idleFakeStatus(), phase: "armed", armed: true, voice: {localSelfDeaf: false, serverSelfDeaf: true, serverDeaf: false}};
        const host = await mount(); await navigate(host, "Voice & Activities");
        const facts = () => [...fakeControls(host).section.querySelectorAll("dl[aria-label='Your voice state'] dd")].map(item => item.textContent);
        const values = () => facts().slice(1);
        expect(facts()[0]).toBe("Not available yet");
        expect(values()).toEqual(["Off", "On", "Off"]);
        await act(async () => {fakeStatus = {...fakeStatus, ownRowIndicator: true, voice: {localSelfDeaf: true, serverSelfDeaf: false, serverDeaf: true}}; emit();});
        expect(facts()[0]).toBe("Ready");
        expect(values()).toEqual(["On", "Off", "On (server enforced)"]);
        await act(async () => {fakeStatus = {...fakeStatus, voice: {localSelfDeaf: false}}; emit();});
        expect(values()).toEqual(["Off", "Unknown", "Unknown"]);
        await act(async () => {accountGeneration++; fakeStatus = idleFakeStatus(); emit();});
        expect(facts()[0]).toBe("Not available yet");
        expect(values()).toEqual(["Unknown", "Unknown", "Unknown"]);
        expect(writes).toEqual([]); expect(powerCalls).toEqual([]);
    });

    test("the real ready toggle and adjacent controller button activate and restore a controlled voice state", async () => {
        const nativeHost = document.createElement("div"); nativeHost.id = "app-mount";
        nativeHost.innerHTML = "<section aria-label=\"User area\"><button type=\"button\" aria-label=\"Deafen\">Native deafen</button></section>";
        document.body.append(nativeHost);
        const native = nativeHost.querySelector<HTMLButtonElement>("button")!;
        let locallyDeafened = false;
        const sent: Array<{opcode: number; payload: {self_deaf: boolean;};}> = [];
        const socket: SolcordGatewaySocket = {send: (opcode, payload) => {sent.push({opcode, payload: structuredClone(payload) as {self_deaf: boolean;}});}};
        const controller = new SolcordFakeDeafenController({
            getAccountId: () => "111111111111111111",
getVoiceChannelId: () => "222222222222222222",
getSocket: () => socket,
            isLocallyDeafened: () => locallyDeafened,
toggleLocalDeafen: () => native.click(),
            patchSend: (target, before, after) => {
                const original = target.send;
                target.send = function (...args) {
                    before(args);
                    const result = Reflect.apply(original, this, args);
                    after(args);
                    return result;
                };
                return () => {target.send = original;};
            },
            onStatus: status => {fakeStatus = status; directControl?.update(status); emit();}
        });
        native.addEventListener("click", () => {
            locallyDeafened = !locallyDeafened; native.setAttribute("aria-label", locallyDeafened ? "Undeafen" : "Deafen");
            socket.send(4, {channel_id: "222222222222222222", guild_id: "333333333333333333", self_deaf: locallyDeafened, self_mute: false});
        });
        const directControl = new SolcordFakeDeafenButton({document,
getStatus: () => controller.snapshot(),
toggle: async () => {
            const accepted = controller.toggleDirect();
            return accepted && (controller.snapshot().pending ? await controller.waitForActivation() : true);
        }});
        directControl.start();
        try {
            const host = await mount(); await navigate(host, "Voice & Activities"); const controls = fakeControls(host);
            powerOverride = async enabled => {updateFakeConsent(enabled); const ready = enabled ? controller.start() : controller.stop(); emit(); return ready;};
            await act(async () => controls.toggle.click());
            expect(controller.snapshot().phase).toBe("ready"); expect(controller.snapshot().armed).toBe(false);
            expect(sent).toEqual([]); expect(controls.toggle.checked).toBe(true);
            const directButton = nativeHost.querySelector<HTMLButtonElement>("button[data-solcord-fake-deafen]")!;
            await act(async () => directButton.click());
            expect(controller.snapshot().phase).toBe("armed"); expect(directButton.getAttribute("aria-pressed")).toBe("true");
            expect(locallyDeafened).toBe(false); expect(sent.at(-1)?.payload.self_deaf).toBe(true);
            await act(async () => directButton.click());
            expect(controller.snapshot().armed).toBe(false); expect(directButton.getAttribute("aria-pressed")).toBe("false");
            expect(sent.at(-1)?.payload.self_deaf).toBe(false); expect(powerCalls).toEqual([["fake-deafen", true, true]]);
        }
        finally {await act(async () => {directControl?.stop(); controller.stop(); nativeHost.remove();});}
    });
});
