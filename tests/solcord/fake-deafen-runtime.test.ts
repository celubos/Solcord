import {afterEach, describe, expect, test} from "bun:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {SolcordFakeDeafenController, applySolcordFakeDeafenConsentTransition} from "../../src/betterdiscord/modules/solcord/fake-deafen";
import {discoverSolcordFakeDeafenCapabilities, isSolcordFakeDeafenGateway, isSolcordFakeDeafenMediaActions} from "../../src/betterdiscord/modules/solcord/fake-deafen-capabilities";
import {SolcordDisposalScope} from "../../src/betterdiscord/modules/solcord/disposal";

// Execute the shipping Runtime methods with controlled host dependencies. No
// Discord account, gateway, profile, or microphone is used by these tests.
const source = fs.readFileSync(new URL("../../src/betterdiscord/modules/solcord/runtime.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("runtime.ts", source, ts.ScriptTarget.Latest, true);
const runtimeClass = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "SolcordRuntimeStore") as ts.ClassDeclaration;
const methodNames = new Set(["fakeDeafenStatus", "setPowerExperiment", "toggleFakeDeafenDirect", "#synchronizePowerLab", "#stopFakeDeafen"]);
const fields = runtimeClass.members.filter(node => ts.isPropertyDeclaration(node) && (node.name.getText(parsed).startsWith("#fakeDeafen") || ["#started", "#recoveryMode"].includes(node.name.getText(parsed))));
const methods = runtimeClass.members.filter(node => ts.isMethodDeclaration(node) && methodNames.has(node.name.getText(parsed)));
const harnessCode = new Bun.Transpiler({loader: "ts", target: "browser"}).transformSync(`
return class {
${[...fields, ...methods].map(node => node.getText(parsed)).join("\n")}
emitChange() {notify(this);}
start() {this.#started = true;}
stop() {this.#stopFakeDeafen();}
};`);
const active: Array<{stop(): void;}> = [];
afterEach(() => {for (const runtime of active.splice(0)) runtime.stop();});

function harness() {
    let accountId = "111111111111111111";
    let channelId: string | undefined;
    let localDeafened = false;
    let socket = {webSocket: {}, send(_opcode: number, _payload: unknown) {}};
    let patches = 0;
    let livePatches = 0;
    let missingAudio = false;
    let failGateway = false;
    let throwOnReady = false;
    let stopOnReady = false;
    const pendingNative: Array<() => void> = [];
    const toasts: Array<{kind: string; detail: string;}> = [];
    const signals: AbortSignal[] = [];
    const privacy = Object.freeze({profile: "strict", telemetry: "block", crashReporting: "block", activityDiscovery: "block"});
    const settings = {powerLab: {"fake-deafen": {enabled: false, acknowledgementVersion: 0}}, consentVersion: 2, privacy};
    const gateway = {getName: () => "GatewayConnectionStore", getSocket: () => {if (failGateway) throw new Error("host drift"); return socket;}};
    const mediaActions = {toggleSelfMute() {},
toggleSelfDeaf() {
        pendingNative.push(() => {
            localDeafened = !localDeafened;
            socket.send(4, {channel_id: channelId, self_mute: false, self_deaf: localDeafened});
        });
    }};
    const stores: Record<string, unknown> = {
        UserStore: {getCurrentUser: () => ({id: accountId})},
        SelectedChannelStore: {getVoiceChannelId: () => channelId},
        // Server deafening must not be mistaken for the local control state.
        MediaEngineStore: {isSelfDeaf: () => localDeafened, isDeaf: () => true}
    };
    const dependencies = {
        SolcordDisposalScope,
SolcordFakeDeafenController,
applySolcordFakeDeafenConsentTransition,
        isSolcordFakeDeafenGateway,
isSolcordFakeDeafenMediaActions,
        discoverSolcordFakeDeafenCapabilities: (lookup: Parameters<typeof discoverSolcordFakeDeafenCapabilities>[0], signal: AbortSignal) => discoverSolcordFakeDeafenCapabilities(lookup, signal, 10),
        SolcordSettings: {
            snapshot: () => settings,
            setPowerExperiment(_id: string, enabled: boolean, acknowledged: boolean) {
                if (enabled && !acknowledged) throw new Error("missing consent");
                settings.powerLab["fake-deafen"] = {enabled, acknowledgementVersion: enabled ? 2 : 0};
            }
        },
        PluginManager: {resolveAddon() {return undefined;}, isEnabled() {return false;}},
        Toasts: Object.fromEntries(["error", "info", "success"].map(kind => [kind, (detail: string) => toasts.push({kind, detail})])),
        Logger: {warn() {}},
        errorName: () => "Error",
        notify: (candidate: {fakeDeafenStatus(): {accountBound: boolean;}; stop(): void;}) => {
            if (!candidate.fakeDeafenStatus().accountBound) return;
            if (throwOnReady) throw new Error("observer failed");
            if (stopOnReady) {stopOnReady = false; candidate.stop();}
        },
        normalizeTimelineAccountId: (id: unknown) => typeof id === "string" && /^[1-9]\d{16,19}$/.test(id) ? id : undefined,
        getStore: (name: string) => stores[name],
        getLazy: async (filter: (value: unknown) => boolean, {signal}: {signal: AbortSignal;}) => {
            signals.push(signal);
            for (const candidate of [gateway, ...(missingAudio ? [] : [mediaActions])]) if (filter(candidate)) return candidate;
            return new Promise(resolve => signal.addEventListener("abort", () => resolve(undefined), {once: true}));
        },
        Patcher: {before(_name: string, target: typeof socket, _method: string, callback: (self: unknown, args: unknown[]) => void) {
            patches++; livePatches++;
            const original = target.send;
            target.send = function (...args: [number, unknown]) {callback(this, args); return original.apply(this, args);};
            return () => {target.send = original; livePatches--;};
        }}
    };
    const Runtime = vm.compileFunction(harnessCode, Object.keys(dependencies))(...Object.values(dependencies));
    const runtime = new Runtime() as {start(): void; stop(): void; fakeDeafenStatus(): ReturnType<SolcordFakeDeafenController["snapshot"]>; toggleFakeDeafenDirect(): Promise<boolean>; setPowerExperiment(id: string, enabled: boolean, acknowledged: boolean): Promise<boolean>;};
    runtime.start(); active.push(runtime);
    return {
        runtime,
        settings,
        toasts,
        signals,
        pendingNative,
        get patches() {return patches;},
        get livePatches() {return livePatches;},
        get channelId() {return channelId;},
        set channelId(value: string | undefined) {channelId = value;},
        get missingAudio() {return missingAudio;},
        set missingAudio(value: boolean) {missingAudio = value;},
        get failGateway() {return failGateway;},
        set failGateway(value: boolean) {failGateway = value;},
        get accountId() {return accountId;},
        set accountId(value: string) {accountId = value;},
        get throwOnReady() {return throwOnReady;},
        set throwOnReady(value: boolean) {throwOnReady = value;},
        get stopOnReady() {return stopOnReady;},
        set stopOnReady(value: boolean) {stopOnReady = value;},
        replaceSocket() {socket = {webSocket: {}, send() {}};},
        replaceTransport() {socket.webSocket = {};}
    };
}

describe("Fake Deafen runtime handoff", () => {
    test("a missing module finishes with a retryable error and releases both lookups", async () => {
        const h = harness(); h.missingAudio = true;
        expect(await h.runtime.toggleFakeDeafenDirect()).toBeFalse();
        expect(h.runtime.fakeDeafenStatus().phase).toBe("attention");
        expect(h.signals.every(signal => signal.aborted)).toBeTrue();
        expect(h.patches).toBe(0);
        expect(h.toasts.map(toast => toast.kind)).toEqual(["error"]);
        expect(h.settings.privacy.profile).toBe("strict");
        h.missingAudio = false;
        expect(await h.runtime.setPowerExperiment("fake-deafen", true, true)).toBeTrue();
        expect(h.livePatches).toBe(1);
        expect(h.runtime.fakeDeafenStatus().accountBound).toBeTrue();
    });

    test.each(["replaceSocket", "replaceTransport"] as const)("manual retry after %s replaces the stopped controller without stacking patches", async replace => {
        const h = harness();
        expect(await h.runtime.toggleFakeDeafenDirect()).toBeFalse(); // No voice channel.
        expect(h.patches).toBe(1);
        h[replace]();
        expect(await h.runtime.toggleFakeDeafenDirect()).toBeFalse();
        expect(h.patches).toBe(2);
        expect(h.livePatches).toBe(1);
        expect(h.runtime.fakeDeafenStatus().detail).toContain("Join a voice channel");
    });

    test("an account change during discovery patches neither account", async () => {
        const h = harness();
        const pending = h.runtime.toggleFakeDeafenDirect();
        h.accountId = "222222222222222222";
        expect(await pending).toBeFalse();
        expect(h.patches).toBe(0);
        expect(h.runtime.fakeDeafenStatus().phase).toBe("attention");
    });

    test("activation waits for the native update and prefers local over server deafen state", async () => {
        const h = harness(); h.channelId = "333333333333333333";
        const operation = h.runtime.toggleFakeDeafenDirect();
        for (let i = 0; i < 20 && !h.pendingNative.length; i++) await Promise.resolve();
        expect(h.pendingNative).toHaveLength(1);
        expect(h.toasts).toHaveLength(0);
        h.pendingNative.shift()!();
        await Promise.resolve();
        if (h.pendingNative.length) h.pendingNative.shift()!();
        expect(await operation).toBeTrue();
        expect(h.runtime.fakeDeafenStatus().armed).toBeTrue();
        expect(h.toasts.map(toast => toast.kind)).toEqual(["success"]);
        expect(h.settings.privacy).toEqual({profile: "strict", telemetry: "block", crashReporting: "block", activityDiscovery: "block"});
    });

    test("host exceptions become visible errors and a subsequent click can retry", async () => {
        const h = harness(); h.failGateway = true;
        expect(await h.runtime.toggleFakeDeafenDirect()).toBeFalse();
        expect(h.toasts.at(-1)?.kind).toBe("error");
        h.failGateway = false;
        expect(await h.runtime.setPowerExperiment("fake-deafen", true, true)).toBeTrue();
        expect(h.livePatches).toBe(1);
    });

    test("stopping a pending activation cancels the result and ignores the late native action", async () => {
        const h = harness(); h.channelId = "333333333333333333";
        const operation = h.runtime.toggleFakeDeafenDirect();
        for (let i = 0; i < 20 && !h.pendingNative.length; i++) await Promise.resolve();
        expect(h.pendingNative).toHaveLength(1);
        h.runtime.stop();
        expect(await operation).toBeFalse();
        h.pendingNative.shift()!();
        await Promise.resolve();
        expect(h.livePatches).toBe(0);
        expect(h.runtime.fakeDeafenStatus()).toMatchObject({phase: "off", armed: false});
        expect(h.toasts).toHaveLength(0);
    });

    test("a throwing readiness observer cannot orphan the patch or stack one on retry", async () => {
        const h = harness(); h.throwOnReady = true;
        expect(await h.runtime.toggleFakeDeafenDirect()).toBeFalse();
        expect(h.livePatches).toBe(0);
        h.throwOnReady = false;
        expect(await h.runtime.setPowerExperiment("fake-deafen", true, true)).toBeTrue();
        expect(h.livePatches).toBe(1);
    });

    test("a reentrant stop during readiness cannot publish a new adapter afterward", async () => {
        const h = harness(); h.stopOnReady = true;
        expect(await h.runtime.setPowerExperiment("fake-deafen", true, true)).toBeFalse();
        expect(h.livePatches).toBe(0);
        expect(h.runtime.fakeDeafenStatus()).toMatchObject({phase: "off", armed: false});
    });

    test("a late native update from a different channel cannot activate a pending request", async () => {
        const h = harness(); h.channelId = "333333333333333333";
        const operation = h.runtime.toggleFakeDeafenDirect();
        for (let i = 0; i < 20 && !h.pendingNative.length; i++) await Promise.resolve();
        h.channelId = "444444444444444444";
        h.pendingNative.shift()!();
        expect(await operation).toBeFalse();
        expect(h.runtime.fakeDeafenStatus()).toMatchObject({armed: false, pending: false, phase: "attention"});
        expect(h.toasts.map(toast => toast.kind)).toEqual(["error"]);
    });

    test("intentional disable during discovery cancels the click without a stale error toast", async () => {
        const h = harness(); h.missingAudio = true;
        const operation = h.runtime.toggleFakeDeafenDirect();
        await Promise.resolve();
        expect(await h.runtime.setPowerExperiment("fake-deafen", false, false)).toBeTrue();
        expect(await operation).toBeFalse();
        expect(h.livePatches).toBe(0);
        expect(h.toasts).toHaveLength(0);
        expect(h.runtime.fakeDeafenStatus().phase).toBe("off");
    });
});
