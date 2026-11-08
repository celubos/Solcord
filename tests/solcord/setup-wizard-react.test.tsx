import {afterEach, describe, expect, mock, test} from "bun:test";
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {normalizeSolcordDocument, SOLCORD_PRESET_ADDONS, SOLCORD_THEMES} from "../../src/betterdiscord/modules/solcord/store";

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean;}).IS_REACT_ACT_ENVIRONMENT = true;
let documentState = normalizeSolcordDocument(undefined);
const listeners = new Set<() => void>();
let saveFailure = false;
let applied = 0;
const store = {
    snapshot: () => structuredClone(documentState),
    addChangeListener: (listener: () => void) => {listeners.add(listener);},
    removeChangeListener: (listener: () => void) => {listeners.delete(listener);},
    setSetupDraft(draft: unknown) {if (saveFailure) throw Error("fixture-disk-full"); documentState.onboarding.draft = structuredClone(draft) as never;},
    setOnboardingStep(step: number) {if (saveFailure) throw Error("fixture-disk-full"); documentState.onboarding.lastStep = step;},
    skipOnboarding() {documentState.onboarding.status = "skipped";}
};
const manager = {addonList: [], getAddon: () => undefined, resolveAddon: () => undefined, isEnabled: () => false, addChangeListener: () => {}, removeChangeListener: () => {}};
mock.module("@modules/solcord/store", () => ({"default": store, SOLCORD_PRESET_ADDONS, SOLCORD_THEMES}));
mock.module("@modules/pluginmanager", () => ({"default": manager}));
mock.module("@modules/thememanager", () => ({"default": manager}));
mock.module("@modules/solcord/runtime", () => ({"default": {
    addChangeListener: () => {},
removeChangeListener: () => {},
    previewSetup: () => ["Local privacy defaults"],
activityHealth: () => ({status: "fixture"}),
driftResults: () => [],
    acknowledgeFirstSetupIntent: async () => {},
    finishSetup: async () => {applied++; return {transactionId: "fixture", enabled: [], quarantined: [], providerConflicts: []};}
}}));
const {default: SetupWizard} = await import("../../src/betterdiscord/ui/solcord/setup-wizard");
let root: Root | undefined;
afterEach(async () => {if (root) await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren(); listeners.clear(); saveFailure = false; applied = 0; documentState = normalizeSolcordDocument(undefined);});

async function mount() {
    const host = document.createElement("div"); document.body.append(host);
    root = createRoot(host); await act(async () => root!.render(<SetupWizard />));
    return host;
}

describe("production First Setup React tree", () => {
    test("preserves privacy defaults through navigation and never applies without confirmation", async () => {
        const host = await mount();
        expect(host.textContent).toContain("Welcome");
        const next = () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Continue")!;
        for (let step = 0; step < 4; step++) {
            const button = next(); button.focus(); expect(document.activeElement).toBe(button);
            await act(async () => button.click());
        }
        expect(host.textContent).toContain("Check your choices");
        expect(documentState.onboarding.draft?.productPreferences.privacy.profile).toBe("strict");
        const confirm = window.confirm;
        window.confirm = () => false;
        try {
            const apply = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Apply")!;
            await act(async () => apply.click());
            expect(applied).toBe(0);
        }
        finally {window.confirm = confirm;}
        await act(async () => root!.render(null));
        expect(listeners.size).toBe(0);
    });

    test("a failed durable step save keeps the current step and displays recovery feedback", async () => {
        const host = await mount();
        saveFailure = true;
        const next = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Continue")!;
        await act(async () => next.click());
        expect(documentState.onboarding.lastStep).toBe(0);
        expect(host.querySelector("[role=\"status\"]")?.textContent).toContain("could not save");
        expect(applied).toBe(0);
    });
});
