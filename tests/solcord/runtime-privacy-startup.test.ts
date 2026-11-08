import {describe, expect, test} from "bun:test";
import {defaultStrictPrivacyPreferences, applyPrivacyProfile, type SolcordPrivacyPreferences} from "../../src/common/solcord/privacy";
import {SolcordStartupPhaseController, boundedSolcordStartupOperation} from "../../src/betterdiscord/modules/solcord/startup-phases";
import {runtimeMethodFixture} from "../fixtures/solcord-method-fixture";

function startupFixture() {
    let preferences = defaultStrictPrivacyPreferences();
    let mode: "success" | "reject" | "pending" | "missing" | "stricter" = "success";
    let attempts = 0;
    let buttons = 0;
    const pending: Array<() => void> = [];
    const phases = new SolcordStartupPhaseController();
    const syncNative = runtimeMethodFixture("#synchronizeNativePrivacyPolicy", {
        IPC: {synchronizePrivacyPolicy: async (policy: SolcordPrivacyPreferences) => {
            attempts++;
            if (mode === "reject") throw Error("Native unavailable");
            if (mode === "pending") await new Promise<void>(resolve => pending.push(resolve));
            if (mode === "missing") return;
            if (mode === "stricter") return {telemetry: "block", crashReporting: "block-optional"};
            return {telemetry: policy.telemetry, crashReporting: policy.crashReporting};
        }},
        boundedSolcordStartupOperation,
Logger: {warn() {}}
    });
    const start = runtimeMethodFixture("start", {SolcordSettings: {snapshot: () => ({productPreferences: {privacy: preferences}})}});
    const owner: any = {
        started: false,
startPromise: undefined,
startupPhases: phases,
        privacyNativeGeneration: 0,
privacyNativeStatus: {state: "unverified"},
        initialize: async () => {},
emitChange() {},
        synchronizePrivacyPolicy() {return syncNative.call(this, preferences);},
        ensureFakeDeafenButton: () => buttons++
    };
    return {
        owner,
phases,
pending,
        start: () => start.call(owner) as Promise<boolean>,
        setMode: (value: typeof mode) => {mode = value;},
        setPreferences: (value: SolcordPrivacyPreferences) => {preferences = value;},
        get attempts() {return attempts;},
        get buttons() {return buttons;}
    };
}

async function untilPending(pending: Array<() => void>) {
    for (let i = 0; i < 12 && !pending.length; i++) await Promise.resolve();
    expect(pending).toHaveLength(1);
}

describe("shipping runtime start native privacy prerequisite", () => {
    test("late native acknowledgement holds the phase and coalesces competing start calls", async () => {
        const state = startupFixture(); state.setMode("pending");
        let released = false;
        const first = state.start().then(ready => {released = ready; return ready;});
        const second = state.start();
        await untilPending(state.pending);
        expect(state.attempts).toBe(1);
        expect(released).toBeFalse(); expect(state.owner.started).toBeFalse(); expect(state.buttons).toBe(0);
        expect(state.phases.snapshot().find(receipt => receipt.phase === "privacy-outbound")?.status).toBe("running");
        state.pending.shift()!();
        expect(await first).toBeTrue(); expect(await second).toBeTrue();
        expect(state.owner.privacyNativeStatus).toEqual({state: "applied", profile: "strict"});
        expect(state.phases.snapshot().find(receipt => receipt.phase === "privacy-outbound")?.status).toBe("complete");
        expect(state.buttons).toBe(1);
    });

    test("a failed native acknowledgement rejects without caching false completion and retries the actual phase", async () => {
        const state = startupFixture(); state.setMode("reject");
        await expect(state.start()).rejects.toThrow("NativePrivacyPolicyUnconfirmed");
        expect(state.owner.started).toBeFalse(); expect(state.owner.startPromise).toBeUndefined(); expect(state.buttons).toBe(0);
        const failed = state.phases.snapshot().find(receipt => receipt.phase === "privacy-outbound")!;
        expect(failed.status).toBe("failed");
        state.setMode("success");
        expect(await state.start()).toBeTrue();
        expect(state.attempts).toBe(2);
        const retried = state.phases.snapshot().find(receipt => receipt.phase === "privacy-outbound")!;
        expect(retried.status).toBe("complete"); expect(retried.sequence).toBeGreaterThan(failed.sequence);
        expect(state.buttons).toBe(1);
    });

    test("an acknowledgement for a profile replaced while starting cannot release activation", async () => {
        const state = startupFixture(); state.setMode("pending");
        const first = state.start();
        await untilPending(state.pending);
        state.setPreferences(applyPrivacyProfile(defaultStrictPrivacyPreferences(), "standard", 42));
        state.pending.shift()!();
        await expect(first).rejects.toThrow("NativePrivacyPolicyUnconfirmed");
        expect(state.owner.started).toBeFalse(); expect(state.buttons).toBe(0);
        expect(state.phases.snapshot().find(receipt => receipt.phase === "privacy-outbound")?.status).toBe("failed");
        state.setMode("success");
        expect(await state.start()).toBeTrue();
        expect(state.owner.privacyNativeStatus).toEqual({state: "applied", profile: "standard"});
        expect(state.attempts).toBe(2);
    });

    test("a missing or stricter acknowledgement holds startup until matching effective decisions arrive", async () => {
        for (const mode of ["missing", "stricter"] as const) {
            const state = startupFixture();
            state.setPreferences(applyPrivacyProfile(defaultStrictPrivacyPreferences(), "standard", 42));
            state.setMode(mode);
            await expect(state.start()).rejects.toThrow("NativePrivacyPolicyUnconfirmed");
            expect(state.owner.privacyNativeStatus).toEqual({state: "failed", profile: "standard"});
            expect(state.owner.started).toBeFalse(); expect(state.buttons).toBe(0);
            expect(state.phases.snapshot().find(receipt => receipt.phase === "privacy-outbound")?.status).toBe("failed");
            state.setMode("success");
            expect(await state.start()).toBeTrue();
            expect(state.attempts).toBe(2);
        }
    });
});
