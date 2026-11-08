import {describe, expect, spyOn, test} from "bun:test";

import {
    applySolcordFakeDeafenConsentTransition,
    DISCORD_VOICE_STATE_UPDATE_OPCODE,
    normalizeVoiceStatePayload,
    SolcordFakeDeafenButton,
    SolcordFakeDeafenController,
    type SolcordFakeDeafenDependencies,
    type SolcordGatewaySocket,
    type SolcordVoiceStatePayload
} from "../../src/betterdiscord/modules/solcord/fake-deafen";

const ACCOUNT_ID = "111111111111111111";
const REPLACEMENT_ACCOUNT_ID = "222222222222222222";
const CHANNEL_ID = "333333333333333333";
const MOVED_CHANNEL_ID = "444444444444444444";
const GUILD_ID = "555555555555555555";

function harness() {
    let accountId: string | undefined = ACCOUNT_ID;
    let channelId: string | undefined = CHANNEL_ID;
    let locallyDeafened = true;
    let unpatched = false;
    let failSend = false;
    const sent: Array<{opcode: number; payload: unknown;}> = [];
    const originalSend = (opcode: number, payload: unknown) => {
        if (failSend) throw new Error("synthetic send failure");
        sent.push({opcode, payload: structuredClone(payload)});
    };
    let socket: SolcordGatewaySocket = {send: originalSend};
    const dependencies: SolcordFakeDeafenDependencies = {
        getAccountId: () => accountId,
        getSocket: () => socket,
        getVoiceChannelId: () => channelId,
        isLocallyDeafened: () => locallyDeafened,
        toggleLocalDeafen: () => {
            locallyDeafened = !locallyDeafened;
            socket.send(DISCORD_VOICE_STATE_UPDATE_OPCODE, {guild_id: GUILD_ID, channel_id: channelId!, self_mute: false, self_deaf: locallyDeafened});
        },
        patchSend: (target, observe) => {
            const original = target.send;
            target.send = function (...args: [number, unknown, ...unknown[]]) {
                observe(args);
                return original.apply(this, args);
            };
            return () => {
                target.send = original;
                unpatched = true;
            };
        }
    };
    return {
        dependencies,
        sent,
        get accountId() {return accountId;},
        set accountId(value: string | undefined) {accountId = value;},
        get socket() {return socket;},
        set socket(value: SolcordGatewaySocket) {socket = value;},
        get channelId() {return channelId;},
        set channelId(value: string | undefined) {channelId = value;},
        get locallyDeafened() {return locallyDeafened;},
        set locallyDeafened(value: boolean) {locallyDeafened = value;},
        get unpatched() {return unpatched;},
        get failSend() {return failSend;},
        set failSend(value: boolean) {failSend = value;}
    };
}

const deafenedPayload = (): SolcordVoiceStatePayload => ({guild_id: GUILD_ID, channel_id: CHANNEL_ID, self_mute: false, self_deaf: true});

describe("Solcord Fake Deafen", () => {
    test("finds the same native control when its label is Undeafen", () => {
        document.body.innerHTML = `<div id="app-mount"><button aria-label="Undeafen">D</button></div>`;
        const control = new SolcordFakeDeafenButton({document,
            getStatus: () => ({phase: "off", detail: "off", connected: true, accountBound: true, capturedVoiceState: false, armed: false}),
toggle: () => true});
        expect(control.start()).toBeTrue();
        expect(document.querySelector("button[aria-label='Undeafen']")?.nextElementSibling?.hasAttribute("data-solcord-fake-deafen")).toBeTrue();
        control.stop();
    });

    test("the adjacent control exposes pending work and clears busy feedback when it settles", () => {
        document.body.innerHTML = `<div id="app-mount"><button aria-label="Deafen">D</button></div>`;
        const status = {phase: "ready" as const, detail: "Waiting for a native Deafen update.", connected: true, accountBound: true, capturedVoiceState: false, armed: false, pending: true};
        const control = new SolcordFakeDeafenButton({document, getStatus: () => status, toggle: () => true});
        control.start();
        const button = document.querySelector<HTMLButtonElement>("button[data-solcord-fake-deafen]")!;
        expect(button.getAttribute("aria-busy")).toBe("true"); expect(button.disabled).toBeTrue(); expect(button.title).toBe(status.detail);
        control.update({...status, pending: false});
        expect(button.getAttribute("aria-busy")).toBe("false"); expect(button.disabled).toBeFalse();
        control.stop();
    });
    test("a synchronous toggle error reports failure, releases the button and permits a later click", async () => {
        document.body.innerHTML = `<div id="app-mount"><button aria-label="Deafen">D</button></div>`;
        let attempts = 0;
        const errors: string[] = [];
        const control = new SolcordFakeDeafenButton({document,
            getStatus: () => ({phase: "off", detail: "off", connected: true, accountBound: true, capturedVoiceState: false, armed: false}),
            toggle: () => {if (++attempts === 1) throw Error("Native toggle unavailable"); return true;},
            onError: detail => errors.push(detail)
        });
        control.start();
        const button = document.querySelector<HTMLButtonElement>("button[data-solcord-fake-deafen]")!;
        try {button.click();}
        catch {/* The regression previously escaped the DOM handler. */}
        await Promise.resolve(); await Promise.resolve();
        expect(errors).toHaveLength(1);
        expect(button.disabled).toBeFalse();
        button.click(); await Promise.resolve(); await Promise.resolve();
        expect(attempts).toBe(2);
        control.stop();
    });

    test("a queued native-control reconciliation cannot resurrect the button after stop", async () => {
        document.body.innerHTML = `<div id="app-mount"><button aria-label="Deafen">D</button></div>`;
        let notify!: () => void;
        class Observer {
            constructor(callback: MutationCallback) {notify = () => callback([], this as unknown as MutationObserver);}
            observe() {}
            disconnect() {}
        }
        const fixtureDocument = {body: document.body,
defaultView: {MutationObserver: Observer},
            querySelector: document.querySelector.bind(document),
querySelectorAll: document.querySelectorAll.bind(document)} as unknown as Document;
        const control = new SolcordFakeDeafenButton({document: fixtureDocument,
            getStatus: () => ({phase: "off", detail: "off", connected: false, accountBound: false, capturedVoiceState: false, armed: false}),
toggle: () => true});
        control.start();
        document.querySelector("button[data-solcord-fake-deafen]")!.remove();
        notify();
        control.stop();
        await Promise.resolve(); await Promise.resolve();
        expect(document.querySelector("button[data-solcord-fake-deafen]")).toBeNull();
    });

    test("a late toggle result cannot release a newer click's busy state after stop and restart", async () => {
        document.body.innerHTML = `<div id="app-mount"><button aria-label="Deafen">D</button></div>`;
        const releases: Array<(value: boolean) => void> = [];
        const control = new SolcordFakeDeafenButton({document,
            getStatus: () => ({phase: "off", detail: "off", connected: true, accountBound: true, capturedVoiceState: false, armed: false}),
            toggle: () => new Promise<boolean>(resolve => releases.push(resolve))});
        control.start(); document.querySelector<HTMLButtonElement>("button[data-solcord-fake-deafen]")!.click();
        control.stop(); control.start();
        const current = document.querySelector<HTMLButtonElement>("button[data-solcord-fake-deafen]")!;
        expect(current.disabled).toBeFalse();
        current.click(); expect(releases).toHaveLength(2);
        releases[0](true); await Promise.resolve(); await Promise.resolve();
        expect(current.disabled).toBeTrue();
        releases[1](true); await Promise.resolve(); await Promise.resolve();
        expect(current.disabled).toBeFalse();
        control.stop();
    });

    test("malformed voice-state drift cancels pending direct activation before a later update arrives", async () => {
        const state = harness(); state.locallyDeafened = false;
        state.dependencies.toggleLocalDeafen = () => {};
        const controller = new SolcordFakeDeafenController(state.dependencies); controller.start();
        expect(controller.toggleDirect()).toBeTrue();
        state.socket.send(DISCORD_VOICE_STATE_UPDATE_OPCODE, {channel_id: CHANNEL_ID, self_mute: false, self_deaf: "drift"});
        expect(controller.snapshot().phase).toBe("attention");
        state.locallyDeafened = true; state.socket.send(DISCORD_VOICE_STATE_UPDATE_OPCODE, deafenedPayload());
        await Promise.resolve(); await Promise.resolve();
        expect(controller.snapshot().armed).toBeFalse();
        controller.stop();
    });

    test("disarming an in-flight direct activation prevents its delayed deafened update from arming", async () => {
        const state = harness(); state.locallyDeafened = false;
        state.dependencies.toggleLocalDeafen = () => {};
        const controller = new SolcordFakeDeafenController(state.dependencies); controller.start();
        expect(controller.toggleDirect()).toBeTrue();
        expect(controller.disarm()).toBeTrue();
        state.locallyDeafened = true; state.socket.send(DISCORD_VOICE_STATE_UPDATE_OPCODE, deafenedPayload());
        await Promise.resolve(); await Promise.resolve();
        expect(controller.snapshot().armed).toBeFalse();
        controller.stop();
    });

    test("pending activation stays bound to its original channel and never arms after a late replacement-channel packet", async () => {
        const state = harness(); state.locallyDeafened = false;
        let nativeActions = 0; state.dependencies.toggleLocalDeafen = () => {nativeActions++;};
        const controller = new SolcordFakeDeafenController(state.dependencies); controller.start();
        controller.toggleDirect(); const result = controller.waitForActivation();
        expect(controller.snapshot()).toMatchObject({pending: true, armed: false});
        state.channelId = MOVED_CHANNEL_ID; state.locallyDeafened = true;
        state.socket.send(DISCORD_VOICE_STATE_UPDATE_OPCODE, {...deafenedPayload(), channel_id: MOVED_CHANNEL_ID});
        expect(await result).toBeFalse();
        expect(controller.snapshot()).toMatchObject({pending: false, armed: false, phase: "attention", capturedVoiceState: false});
        expect(controller.snapshot().detail).toContain("voice connection changed");
        expect(nativeActions).toBe(1); expect(state.sent).toHaveLength(1);
        state.channelId = CHANNEL_ID; state.socket.send(DISCORD_VOICE_STATE_UPDATE_OPCODE, deafenedPayload());
        await Promise.resolve(); await Promise.resolve();
        expect(controller.snapshot().armed).toBeFalse(); expect(nativeActions).toBe(1);
        controller.stop();
    });

    test("pending activation is observable and settles only after a matching native update arms it", async () => {
        const state = harness(); state.locallyDeafened = false;
        state.dependencies.toggleLocalDeafen = () => {state.locallyDeafened = !state.locallyDeafened;};
        const controller = new SolcordFakeDeafenController(state.dependencies); controller.start();
        expect(controller.toggleDirect()).toBeTrue();
        expect(controller.snapshot()).toMatchObject({pending: true, armed: false});
        const result = controller.waitForActivation();
        let settled = false; void result.then(() => {settled = true;});
        await Promise.resolve(); expect(settled).toBeFalse();
        state.socket.send(DISCORD_VOICE_STATE_UPDATE_OPCODE, deafenedPayload());
        expect(await result).toBeTrue();
        expect(controller.snapshot()).toMatchObject({pending: false, armed: true});
        expect(state.locallyDeafened).toBeFalse();
        controller.stop();
    });

    test("activation timeout fails closed and late native updates cannot rearm it", async () => {
        let expire!: () => void;
        const timer = spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay: number) => {
            expect(delay).toBe(5_000); expire = callback; return {};
        }) as never);
        const clear = spyOn(globalThis, "clearTimeout").mockImplementation(() => {});
        const state = harness(); state.locallyDeafened = false;
        state.dependencies.toggleLocalDeafen = () => {};
        const controller = new SolcordFakeDeafenController(state.dependencies);
        try {
            controller.start(); controller.toggleDirect();
            const result = controller.waitForActivation();
            expire();
            expect(await result).toBeFalse();
            expect(controller.snapshot()).toMatchObject({pending: false, armed: false, phase: "attention"});
            state.locallyDeafened = true; state.socket.send(DISCORD_VOICE_STATE_UPDATE_OPCODE, deafenedPayload());
            await Promise.resolve(); await Promise.resolve();
            expect(controller.snapshot().armed).toBeFalse();
            expect(clear).toHaveBeenCalled();
        }
        finally {controller.stop(); timer.mockRestore(); clear.mockRestore();}
    });

    test("a queued arm from a canceled activation cannot arm a newer pending request", async () => {
        const state = harness(); state.locallyDeafened = false;
        state.dependencies.toggleLocalDeafen = () => {};
        const controller = new SolcordFakeDeafenController(state.dependencies); controller.start();
        controller.toggleDirect(); const canceled = controller.waitForActivation();
        state.locallyDeafened = true; state.socket.send(DISCORD_VOICE_STATE_UPDATE_OPCODE, deafenedPayload());
        controller.disarm(); expect(await canceled).toBeFalse();
        state.locallyDeafened = false; controller.toggleDirect();
        const current = controller.waitForActivation(); state.locallyDeafened = true;
        await Promise.resolve(); await Promise.resolve();
        expect(controller.snapshot()).toMatchObject({pending: true, armed: false});
        controller.stop(); expect(await current).toBeFalse();
    });

    test("same-wrapper gateway transport replacement disarms before rewriting the next outgoing update", () => {
        const state = harness(); let connectionIdentity: unknown = {};
        state.dependencies.getConnectionIdentity = () => connectionIdentity;
        const controller = new SolcordFakeDeafenController(state.dependencies); controller.start();
        state.socket.send(DISCORD_VOICE_STATE_UPDATE_OPCODE, deafenedPayload()); controller.arm();
        connectionIdentity = {};
        state.socket.send(DISCORD_VOICE_STATE_UPDATE_OPCODE, {...deafenedPayload(), self_deaf: false});
        expect((state.sent.at(-1)?.payload as SolcordVoiceStatePayload).self_deaf).toBeFalse();
        expect(controller.snapshot()).toMatchObject({armed: false, pending: false, phase: "attention", accountBound: false});
        expect(controller.snapshot().detail).toContain("underlying gateway transport");
        expect(state.unpatched).toBeTrue();
    });

    test("an unavailable optional transport identity preserves legacy wrapper checks", () => {
        const state = harness(); state.dependencies.getConnectionIdentity = () => undefined;
        const controller = new SolcordFakeDeafenController(state.dependencies);
        expect(controller.start()).toBeTrue();
        state.socket = {send() {}};
        expect(controller.validateOwnership()).toBeFalse();
        expect(state.unpatched).toBeTrue();
    });

    test("places one owned control immediately after native Deafen and tears it down cleanly", async () => {
        document.body.innerHTML = `<div id="app-mount"><section aria-label="User area"><button id="mute" aria-label="Mute"><span>M</span></button><button id="deafen" aria-label="Deafen"><span id="native-icon">D</span></button><button id="settings" aria-label="User Settings">S</button></section></div>`;
        let active = false;
        let toggles = 0;
        const status = (): ReturnType<SolcordFakeDeafenController["snapshot"]> => ({
            phase: active ? "armed" : "off",
            detail: active ? "on" : "off",
            connected: true,
            accountBound: true,
            capturedVoiceState: active,
            armed: active
        });
        const control = new SolcordFakeDeafenButton({
            document,
            getStatus: status,
            toggle: () => {toggles++; active = !active; return true;}
        });

        expect(control.start()).toBeTrue();
        const native = document.getElementById("deafen")!;
        const button = document.querySelector<HTMLButtonElement>("button[data-solcord-fake-deafen]")!;
        expect(native.nextElementSibling).toBe(button);
        expect(button.getAttribute("id")).toBeNull();
        expect(button.querySelector("[id]")).toBeNull();
        expect(button.getAttribute("aria-label")).toBe("Fake Deafen. Click to toggle.");
        expect(button.getAttribute("aria-pressed")).toBe("false");

        button.click();
        await Promise.resolve();
        await Promise.resolve();
        expect(toggles).toBe(1);
        expect(button.getAttribute("aria-pressed")).toBe("true");
        expect(document.querySelectorAll("button[data-solcord-fake-deafen]")).toHaveLength(1);

        control.reconcile();
        expect(document.querySelectorAll("button[data-solcord-fake-deafen]")).toHaveLength(1);
        control.stop();
        expect(document.querySelector("button[data-solcord-fake-deafen]")).toBeNull();
        expect(document.getElementById("deafen")).not.toBeNull();
    });

    test("starts before Discord mounts the native voice controls and reconciles the button later", async () => {
        document.body.innerHTML = `<div id="app-mount"></div>`;
        const control = new SolcordFakeDeafenButton({
            document,
            getStatus: () => ({phase: "off", detail: "off", connected: false, accountBound: false, capturedVoiceState: false, armed: false}),
            toggle: () => true
        });

        expect(control.start()).toBeTrue();
        expect(document.querySelector("button[data-solcord-fake-deafen]")).toBeNull();
        document.getElementById("app-mount")!.innerHTML = `<section aria-label="User area"><button aria-label="Deafen"><span>D</span></button></section>`;
        await Promise.resolve();
        await Promise.resolve();

        const native = document.querySelector<HTMLButtonElement>("button[aria-label='Deafen']")!;
        expect(native.nextElementSibling?.getAttribute("data-solcord-fake-deafen")).toBe("true");
        control.stop();
    });

    test("tears down the live adapter when consent persistence fails", async () => {
        let failedClosed = 0;
        let synchronized = 0;

        const accepted = await applySolcordFakeDeafenConsentTransition({
            persist: () => {throw new Error("disk full");},
            synchronize: async () => {synchronized++;},
            failClosed: () => {failedClosed++;}
        });

        expect(accepted).toBeFalse();
        expect(failedClosed).toBe(1);
        expect(synchronized).toBe(0);
    });

    test("synchronizes only after consent persistence succeeds", async () => {
        const calls: string[] = [];

        const accepted = await applySolcordFakeDeafenConsentTransition({
            persist: () => {calls.push("persist");},
            synchronize: async () => {calls.push("synchronize");},
            failClosed: () => {calls.push("fail-closed");}
        });

        expect(accepted).toBeTrue();
        expect(calls).toEqual(["persist", "synchronize"]);
    });

    test("tears down a partially started adapter when synchronization rejects", async () => {
        const calls: string[] = [];
        expect(await applySolcordFakeDeafenConsentTransition({
            persist: () => {calls.push("persist");},
            synchronize: async () => {calls.push("synchronize"); throw new Error("adapter drift");},
            failClosed: () => {calls.push("fail-closed");}
        })).toBeFalse();
        expect(calls).toEqual(["persist", "synchronize", "fail-closed"]);
    });

    test("invalidates captured state after malformed updates instead of reusing stale consent to arm", () => {
        const state = harness();
        const controller = new SolcordFakeDeafenController(state.dependencies);
        controller.start();
        state.socket.send(DISCORD_VOICE_STATE_UPDATE_OPCODE, deafenedPayload());
        state.socket.send(DISCORD_VOICE_STATE_UPDATE_OPCODE, {channel_id: CHANNEL_ID, self_mute: false, self_deaf: "drift"});
        expect(controller.snapshot()).toMatchObject({phase: "attention", capturedVoiceState: false, armed: false});
        expect(controller.arm()).toBeFalse();
        expect(state.sent).toHaveLength(2);
        state.socket.send(DISCORD_VOICE_STATE_UPDATE_OPCODE, deafenedPayload());
        expect(controller.arm()).toBeTrue();
        controller.stop();
    });

    test("treats repeated arm as idempotent without changing local audio again", () => {
        const state = harness();
        const controller = new SolcordFakeDeafenController(state.dependencies);
        controller.start();
        state.socket.send(DISCORD_VOICE_STATE_UPDATE_OPCODE, deafenedPayload());
        expect(controller.arm()).toBeTrue();
        const sent = state.sent.length;
        expect(controller.arm()).toBeTrue();
        expect(state.sent).toHaveLength(sent);
        expect(controller.snapshot()).toMatchObject({phase: "armed", armed: true});
        expect(state.locallyDeafened).toBeFalse();
        controller.stop();
    });

    test("detects a channel change even before another outgoing voice update", () => {
        const state = harness();
        const controller = new SolcordFakeDeafenController(state.dependencies);
        controller.start();
        state.socket.send(DISCORD_VOICE_STATE_UPDATE_OPCODE, deafenedPayload());
        controller.arm();
        const sent = state.sent.length;
        state.channelId = MOVED_CHANNEL_ID;
        expect(controller.validateOwnership()).toBeFalse();
        expect(controller.snapshot()).toMatchObject({phase: "attention", armed: false, capturedVoiceState: false});
        expect(state.sent).toHaveLength(sent);
        controller.stop();
    });

    test("retains a failed unpatch for retry and never stacks a replacement patch", () => {
        const state = harness();
        const originalPatch = state.dependencies.patchSend;
        let patchCount = 0;
        let cleanupCount = 0;
        let failCleanup = true;
        state.dependencies.patchSend = (socket, observe) => {
            patchCount++;
            const unpatch = originalPatch(socket, observe)!;
            return () => {
                cleanupCount++;
                if (failCleanup) throw new Error("unpatch failed");
                unpatch();
            };
        };
        const controller = new SolcordFakeDeafenController(state.dependencies);
        controller.start();
        expect(() => controller.stop()).toThrow("unpatch failed");
        expect(controller.snapshot()).toMatchObject({phase: "attention", armed: false, accountBound: false});
        expect(() => controller.start()).toThrow("unpatch failed");
        expect(patchCount).toBe(1);
        failCleanup = false;
        expect(controller.stop()).toBeTrue();
        expect(cleanupCount).toBe(3);
        expect(state.unpatched).toBeTrue();
        expect(controller.start()).toBeTrue();
        expect(patchCount).toBe(2);
        controller.stop();
    });

    test("accepts only bounded Discord voice-state payloads", () => {
        expect(normalizeVoiceStatePayload(deafenedPayload())).toEqual(deafenedPayload());
        expect(normalizeVoiceStatePayload({channel_id: "../bad", self_mute: false, self_deaf: true})).toBeUndefined();
        expect(normalizeVoiceStatePayload({channel_id: CHANNEL_ID, self_mute: false, self_deaf: "true"})).toBeUndefined();
        expect(normalizeVoiceStatePayload({channel_id: CHANNEL_ID, self_mute: false, self_deaf: true, self_video: "yes"})).toBeUndefined();
    });

    test("arms only after a real deafened update, restores local audio, and resynchronizes on disarm", () => {
        const state = harness();
        const controller = new SolcordFakeDeafenController(state.dependencies);
        expect(controller.start()).toBeTrue();
        state.socket.send(DISCORD_VOICE_STATE_UPDATE_OPCODE, deafenedPayload());

        expect(controller.arm()).toBeTrue();
        expect(state.locallyDeafened).toBeFalse();
        expect((state.sent.at(-1)?.payload as SolcordVoiceStatePayload).self_deaf).toBeTrue();
        expect(controller.snapshot()).toEqual(expect.objectContaining({phase: "armed", armed: true, connected: true, accountBound: true, capturedVoiceState: true}));

        expect(controller.disarm()).toBeTrue();
        expect((state.sent.at(-1)?.payload as SolcordVoiceStatePayload).self_deaf).toBeFalse();
        expect(controller.snapshot()).toEqual(expect.objectContaining({phase: "ready", armed: false}));
        controller.stop();
        expect(state.unpatched).toBeTrue();
        expect(controller.snapshot().phase).toBe("off");
    });

    test("toggles from the adjacent control without a separate arm confirmation", () => {
        const state = harness();
        state.locallyDeafened = false;
        const controller = new SolcordFakeDeafenController(state.dependencies);
        expect(controller.start()).toBeTrue();

        expect(controller.toggleDirect()).toBeTrue();
        expect(controller.snapshot()).toEqual(expect.objectContaining({phase: "armed", armed: true, connected: true}));
        expect(state.locallyDeafened).toBeFalse();
        expect((state.sent.at(-1)?.payload as SolcordVoiceStatePayload).self_deaf).toBeTrue();

        expect(controller.toggleDirect()).toBeTrue();
        expect(controller.snapshot()).toEqual(expect.objectContaining({phase: "ready", armed: false}));
        expect((state.sent.at(-1)?.payload as SolcordVoiceStatePayload).self_deaf).toBeFalse();
        controller.stop();
    });

    test("self-primes when normal Deafen was already active before the direct control loaded", async () => {
        const state = harness();
        const controller = new SolcordFakeDeafenController(state.dependencies);
        expect(controller.start()).toBeTrue();
        expect(controller.toggleDirect()).toBeTrue();
        expect(controller.snapshot()).toMatchObject({pending: true, armed: false});
        expect(await controller.waitForActivation()).toBeTrue();
        expect(controller.snapshot()).toEqual(expect.objectContaining({phase: "armed", armed: true}));
        expect(state.locallyDeafened).toBeFalse();
        expect(state.sent.map(entry => (entry.payload as SolcordVoiceStatePayload).self_deaf)).toEqual([false, true, true]);
        controller.stop();
    });

    test("sequential priming survives native Flux dispatch that coalesces two same-dispatch toggles", async () => {
        const state = harness();
        let batching = true, queued = 0, lastNativeDeafened = true;
        const emit = () => {
            if (state.locallyDeafened === lastNativeDeafened) return;
            lastNativeDeafened = state.locallyDeafened;
            state.socket.send(DISCORD_VOICE_STATE_UPDATE_OPCODE, {...deafenedPayload(), self_deaf: state.locallyDeafened});
        };
        state.dependencies.toggleLocalDeafen = () => {
            if (batching) {queued++; return;}
            state.locallyDeafened = !state.locallyDeafened; emit();
        };
        const controller = new SolcordFakeDeafenController(state.dependencies); controller.start();
        expect(controller.toggleDirect()).toBeTrue();
        const result = controller.waitForActivation();
        expect(queued).toBe(1);
        expect(state.sent).toHaveLength(0);
        while (queued-- > 0) state.locallyDeafened = !state.locallyDeafened;
        batching = false; emit();
        expect(await result).toBeTrue();
        expect(state.locallyDeafened).toBeFalse();
        expect(state.sent.map(entry => (entry.payload as SolcordVoiceStatePayload).self_deaf)).toEqual([false, true, true]);
        expect(controller.snapshot()).toMatchObject({armed: true, pending: false});
        controller.stop();
    });

    test("sequential priming also waits for asynchronous native Deafen actions", async () => {
        const state = harness();
        state.dependencies.toggleLocalDeafen = () => {
queueMicrotask(() => {
            state.locallyDeafened = !state.locallyDeafened;
            state.socket.send(DISCORD_VOICE_STATE_UPDATE_OPCODE, {...deafenedPayload(), self_deaf: state.locallyDeafened});
        });
};
        const controller = new SolcordFakeDeafenController(state.dependencies); controller.start();
        expect(controller.toggleDirect()).toBeTrue();
        expect(controller.snapshot()).toMatchObject({pending: true, armed: false});
        expect(await controller.waitForActivation()).toBeTrue();
        expect(state.locallyDeafened).toBeFalse();
        expect((state.sent.at(-1)?.payload as SolcordVoiceStatePayload).self_deaf).toBeTrue();
        controller.stop();
        await Promise.resolve();
    });

    test("refuses to invent a payload or arm while locally audible", () => {
        const state = harness();
        const controller = new SolcordFakeDeafenController(state.dependencies);
        controller.start();
        expect(controller.arm()).toBeFalse();
        expect(controller.snapshot().detail).toContain("No matching deafened voice-state update");

        state.socket.send(DISCORD_VOICE_STATE_UPDATE_OPCODE, deafenedPayload());
        state.locallyDeafened = false;
        expect(controller.arm()).toBeFalse();
        expect(controller.snapshot().detail).toContain("Deafen normally before arming");
    });

    test("fails closed on channel moves and malformed voice-state drift", () => {
        const state = harness();
        const controller = new SolcordFakeDeafenController(state.dependencies);
        controller.start();
        state.socket.send(DISCORD_VOICE_STATE_UPDATE_OPCODE, deafenedPayload());
        expect(controller.arm()).toBeTrue();

        state.channelId = MOVED_CHANNEL_ID;
        state.socket.send(DISCORD_VOICE_STATE_UPDATE_OPCODE, {guild_id: GUILD_ID, channel_id: MOVED_CHANNEL_ID, self_mute: false, self_deaf: false});
        expect(controller.snapshot()).toEqual(expect.objectContaining({phase: "attention", armed: false}));
        expect((state.sent.at(-1)?.payload as SolcordVoiceStatePayload).self_deaf).toBeFalse();

        state.channelId = CHANNEL_ID;
        state.locallyDeafened = true;
        state.socket.send(DISCORD_VOICE_STATE_UPDATE_OPCODE, deafenedPayload());
        expect(controller.arm()).toBeTrue();
        state.socket.send(DISCORD_VOICE_STATE_UPDATE_OPCODE, {channel_id: CHANNEL_ID, self_mute: false, self_deaf: "drift"});
        expect(controller.snapshot()).toEqual(expect.objectContaining({phase: "attention", armed: false}));
    });

    test("removes its scoped patch when Discord replaces the gateway socket", () => {
        const state = harness();
        const controller = new SolcordFakeDeafenController(state.dependencies);
        controller.start();
        state.socket = {send() {}};
        expect(controller.validateOwnership()).toBeFalse();
        expect(state.unpatched).toBeTrue();
        expect(controller.snapshot()).toEqual(expect.objectContaining({phase: "attention", armed: false}));
    });

    test("binds the patch to one account and never restores state into a replacement account", () => {
        const state = harness();
        const controller = new SolcordFakeDeafenController(state.dependencies);
        expect(controller.start()).toBeTrue();
        state.socket.send(DISCORD_VOICE_STATE_UPDATE_OPCODE, deafenedPayload());
        expect(controller.arm()).toBeTrue();
        const sendsBeforeSwitch = state.sent.length;

        state.accountId = REPLACEMENT_ACCOUNT_ID;
        expect(controller.validateOwnership()).toBeFalse();

        expect(state.unpatched).toBeTrue();
        expect(state.sent).toHaveLength(sendsBeforeSwitch);
        expect(controller.snapshot()).toEqual(expect.objectContaining({phase: "attention", armed: false, accountBound: false}));
        expect(controller.snapshot().detail).toContain("account changed");
    });

    test("does not patch before a signed-in account identity is validated", () => {
        const state = harness();
        state.accountId = undefined;
        const controller = new SolcordFakeDeafenController(state.dependencies);

        expect(controller.start()).toBeFalse();
        expect(controller.snapshot()).toEqual(expect.objectContaining({phase: "attention", accountBound: false, armed: false}));
        expect(state.unpatched).toBeFalse();
    });

    test("preserves resynchronization attention when stop cannot restore server-visible state", () => {
        const state = harness();
        const controller = new SolcordFakeDeafenController(state.dependencies);
        controller.start();
        state.socket.send(DISCORD_VOICE_STATE_UPDATE_OPCODE, deafenedPayload());
        expect(controller.arm()).toBeTrue();
        state.failSend = true;

        expect(controller.stop()).toBeFalse();
        expect(state.unpatched).toBeTrue();
        expect(controller.snapshot()).toEqual(expect.objectContaining({phase: "attention", armed: false}));
        expect(controller.snapshot().detail).toContain("Toggle normal deafen once");
    });
});
