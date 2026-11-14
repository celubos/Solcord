import {afterEach, beforeEach, describe, expect, spyOn, test} from "bun:test";

import fs from "../../src/betterdiscord/polyfill/fs";
import SolcordSettings, {normalizeSetupDraft} from "../../src/betterdiscord/modules/solcord/store";
import {SOLCORD_PRODUCT_IDENTITY} from "../../src/common/solcord/product-identity";

const createStore = () => new (SolcordSettings.constructor as new () => typeof SolcordSettings)();
const spies: Array<{mockRestore(): void;}> = [];
let staged: string;
let persisted: string;
let writes: number;
let failCommit: boolean;

beforeEach(() => {
    staged = "";
    persisted = "";
    writes = 0;
    failCommit = false;
    spies.push(
        spyOn(fs, "mkdirSync").mockImplementation(() => undefined),
        spyOn(fs, "writeFileSync").mockImplementation((_path, value) => {staged = String(value); writes++;}),
        spyOn(fs, "renameSync").mockImplementation(() => {
            if (failCommit) throw new Error("Simulated atomic replacement failure");
            persisted = staged;
        }),
        spyOn(fs, "readFileSync").mockImplementation(() => Buffer.from(persisted)),
        spyOn(fs, "existsSync").mockReturnValue(false)
    );
});

afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
});

describe("Solcord settings transactions", () => {
    test("persists a change and its rollback snapshot once, then notifies with only the final state", () => {
        const store = createStore();
        const before = store.snapshot();
        const observed: boolean[] = [];
        store.addChangeListener(() => observed.push(store.module("stream-shield").enabled));

        store.setEnabled("stream-shield", true);

        expect(writes).toBe(1);
        expect(observed).toEqual([true]);
        expect(JSON.parse(persisted)).toEqual(store.snapshot());
        expect(store.snapshot().snapshots).toHaveLength(1);
        expect(store.snapshot().snapshots[0].modules).toEqual(before.modules);
        expect(store.snapshot().updateLedger.at(-1)?.version).toBe(SOLCORD_PRODUCT_IDENTITY.numericVersion);
        const restarted = createStore();
        restarted.initialize();
        expect(restarted.module("stream-shield").enabled).toBeTrue();
        expect(restarted.snapshot().snapshots[0].modules).toEqual(before.modules);
        expect(restarted.snapshot().updateLedger.at(-1)?.version).toBe(SOLCORD_PRODUCT_IDENTITY.numericVersion);
    });

    test("setup rollback survives many later edits and a restart because its snapshot is pinned", () => {
        const store = createStore();
        const transactionId = "setup-0123456789abcdef";
        const record = store.completeSetup(normalizeSetupDraft(undefined), {}, {id: transactionId, priorAddonStates: {}, priorThemeStates: {}});
        for (let index = 0; index < 30; index++) store.setEnabled("stream-shield", index % 2 === 0);
        expect(store.snapshot().snapshots).toHaveLength(20);
        expect(store.snapshotById(record.snapshotId)).toBeDefined();

        const restarted = createStore();
        restarted.initialize();
        expect(restarted.snapshot().snapshots).toHaveLength(20);
        expect(restarted.snapshotById(record.snapshotId)).toBeDefined();
        expect(restarted.abortSetupCompletion(transactionId)).toBeTrue();
        expect(restarted.snapshot().onboarding.status).toBe("pending");
    });

    test("a normalized no-op creates no snapshot, disk write, or change event", () => {
        const store = createStore();
        const before = store.snapshot();
        let notifications = 0;
        store.addChangeListener(() => notifications++);

        store.setValue("performance-hud", "sampleSeconds", before.modules["performance-hud"].values.sampleSeconds);
        store.setEnabled("stream-shield", before.modules["stream-shield"].enabled);
        store.setProductPreferences(before.productPreferences);
        store.setTimelinePolicy(before.timelinePolicy);

        expect(store.snapshot()).toEqual(before);
        expect(writes).toBe(0);
        expect(notifications).toBe(0);
    });

    const changes: Array<[string, (store: ReturnType<typeof createStore>) => unknown]> = [
        ["module toggle", store => store.setEnabled("stream-shield", true)],
        ["module value", store => store.setValue("performance-hud", "sampleSeconds", 12)],
        ["preferences", store => store.setProductPreferences({...store.snapshot().productPreferences, performanceProfile: "visual"})],
        ["snapshot", store => store.capture("Manual backup")],
        ["profile", store => store.saveProfile("Reading")],
        ["setup deferral", store => store.skipOnboarding()],
        ["setup reopening", store => store.reopenOnboarding()],
        ["addon toggle", store => store.setCuratedAddonEnabled("PinDMs", !store.snapshot().curatedAddons.PinDMs.enabled)],
        ["timeline policy", store => store.setTimelinePolicy({...store.snapshot().timelinePolicy, enabled: true})],
        ["setup completion", store => store.completeSetup(normalizeSetupDraft({}), {}, {id: "fixture", priorAddonStates: {}, priorThemeStates: {}})]
    ];

    for (const [label, change] of changes) {
        test(`failed ${label} preserves the exact prior in-memory and persisted state`, () => {
            const store = createStore();
            const before = store.snapshot();
            let notifications = 0;
            store.addChangeListener(() => notifications++);
            failCommit = true;

            expect(() => change(store)).toThrow("Simulated atomic replacement failure");
            expect(store.snapshot()).toEqual(before);
            expect(persisted).toBe("");
            expect(notifications).toBe(0);
        });
    }

    test("setup progress cannot persist an unreachable step", () => {
        const store = createStore();
        store.setOnboardingStep(999);
        expect(store.snapshot().onboarding.lastStep).toBe(4);
        store.setOnboardingStep(-10);
        expect(store.snapshot().onboarding.lastStep).toBe(0);
    });

    test("the background choice and its built-in switch have one durable enabled state", () => {
        const store = createStore();
        const preferences = store.snapshot().productPreferences;
        store.setProductPreferences({...preferences, nativeSuite: {...preferences.nativeSuite, motion: {...preferences.nativeSuite.motion, effect: "rain"}}});
        expect(store.snapshot().curatedAddons.DiscordEffects.enabled).toBeTrue();
        store.setCuratedAddonEnabled("DiscordEffects", false);
        expect(store.snapshot().productPreferences.nativeSuite.motion.effect).toBe("off");
        store.setCuratedAddonEnabled("DiscordEffects", true);
        expect(store.snapshot().productPreferences.nativeSuite.motion.effect).toBe("field");
        expect(store.snapshot().productPreferences.appearance.motion).toBe("full");
        const restarted = createStore();
        restarted.initialize();
        expect(restarted.snapshot().curatedAddons.DiscordEffects.enabled).toBeTrue();
        expect(restarted.snapshot().productPreferences.nativeSuite.motion.effect).toBe("field");
    });

    test("a rejected live preference apply restores both settings and its prior provider selection", () => {
        const store = createStore();
        const before = store.snapshot();
        const rollback = store.setProductPreferences({...before.productPreferences, nativeSuite: {...before.productPreferences.nativeSuite, motion: {...before.productPreferences.nativeSuite.motion, effect: "rain"}}})!;
        expect(store.rollback(rollback.id)).toBeTrue();
        const restored = store.snapshot();
        expect(restored.productPreferences).toEqual(before.productPreferences);
        expect(restored.curatedAddons).toEqual(before.curatedAddons);
        expect(restored.modules).toEqual(before.modules);
        const restarted = createStore();
        restarted.initialize();
        expect(restarted.snapshot().curatedAddons).toEqual(before.curatedAddons);
    });
});
