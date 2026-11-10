import {afterEach, describe, expect, spyOn, test} from "bun:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {SolcordFakeDeafenController, applySolcordFakeDeafenConsentTransition} from "../../src/betterdiscord/modules/solcord/fake-deafen";
import {discoverSolcordFakeDeafenCapabilities, isSolcordFakeDeafenGateway, isSolcordFakeDeafenMediaActions} from "../../src/betterdiscord/modules/solcord/fake-deafen-capabilities";
import {readSolcordOwnVoiceDeafenState} from "../../src/betterdiscord/modules/solcord/fake-deafen-voice-state";
import {isSolcordFakeDeafenPresentationModule, preserveSolcordOwnVoiceDeafenPresentation} from "../../src/betterdiscord/modules/solcord/fake-deafen-presentation";
import {patchSolcordFakeDeafenSend} from "../../src/betterdiscord/modules/solcord/fake-deafen-send";
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
const patcherSource = fs.readFileSync(new URL("../../src/betterdiscord/modules/patcher.ts", import.meta.url), "utf8");
const patcherParsed = ts.createSourceFile("patcher.ts", patcherSource, ts.ScriptTarget.Latest, true);
const patcherClass = patcherParsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "Patcher")!;
const patcherCode = new Bun.Transpiler({loader: "ts", target: "browser"}).transformSync(`return ${patcherClass.getText(patcherParsed).replace("export default ", "")}`);
const active: Array<{stop(): void;}> = [];
afterEach(() => {for (const runtime of active.splice(0)) runtime.stop();});

function harness({deferPresentation = false, rejectPresentationPatch = false, rejectSendCompletion = ""} = {}) {
    let accountId = "111111111111111111";
    let channelId: string | undefined;
    let localDeafened = false;
    let failSend = false;
    let failRawSend = false;
    const acceptedFrames: unknown[] = [];
    let socket = {webSocket: {readyState: 1,
send(frame: unknown) {
        if (failRawSend) throw new Error("raw transport failed");
        if (this.readyState !== 1) return;
        acceptedFrames.push(structuredClone(frame));
    }},
send(_opcode: number, payload: unknown) {
        if (failSend) throw new Error("gateway send failed");
        try {this.webSocket.send(payload);}
        catch {/* The reviewed native gateway swallows transport exceptions. */}
    }};
    let patches = 0;
    let missingAudio = false;
    let failGateway = false;
    let throwOnReady = false;
    let stopOnReady = false;
    let notifications = 0;
    let serverSelfDeaf = false;
    const removals: string[] = [];
    const rowRefreshes: Array<{channelId: unknown; armed: boolean; patched: boolean;}> = [];
    // Execute the real patcher: shared before/after args identity, original
    // exception propagation and hook removal order are part of this regression.
    const actualPatcher = vm.compileFunction(patcherCode, ["Logger", "DiscordModules", "getByKeys"])({err() {}}, {}, () => undefined);
    let presentationResolve: ((value: unknown) => void) | undefined;
    const sessionId = "current-voice-session";
    const rowModule = {Nd(record: {sessionId: string; merge(update: object): unknown;}, local: {sessionId: string; selfMute: boolean; selfDeaf: boolean;}) {
        return record.sessionId === local.sessionId ? record.merge({selfMute: local.selfMute, selfDeaf: local.selfDeaf}) : record;
    }};
    let beforeRegister: (() => void) | undefined;
    const listeners = new Set<() => void>();
    let listenerCount = 0;
    const observable = () => {
        const registered = new Set<() => void>();
        return {
            addChangeListener(listener: () => void) {beforeRegister?.(); registered.add(listener); listeners.add(listener); listenerCount++;},
            removeChangeListener(listener: () => void) {listeners.delete(listener); if (registered.delete(listener)) listenerCount--;}
        };
    };
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
        AuthenticationStore: {getSessionId: () => sessionId},
        SelectedChannelStore: {...observable(), getVoiceChannelId: () => channelId},
        // Server deafening must not be mistaken for the local control state.
        MediaEngineStore: {...observable(), isSelfDeaf: () => localDeafened, isDeaf: () => true},
        VoiceStateStore: {...observable(), getVoiceStateForChannel: (channel: string, user: string) => channel === channelId && user === accountId ? {userId: accountId, channelId, selfDeaf: serverSelfDeaf, deaf: false} : undefined}
    };
    const dependencies = {
        SolcordDisposalScope,
        patchSolcordFakeDeafenSend,
        getInternalInstance() {return null;},
        document: {getElementById: () => ({})},
        refreshSolcordFakeDeafenCurrentChannelRow: ({channelId: targetChannel, isCurrent}: {channelId: unknown; isCurrent(): boolean;}) => {
            if (isCurrent()) rowRefreshes.push({channelId: targetChannel, armed: runtime.fakeDeafenStatus().armed, patched: actualPatcher.getPatchesByCaller("Solcord~FakeDeafenIndicator").length > 0});
        },
        readSolcordOwnVoiceDeafenState,
        isSolcordFakeDeafenPresentationModule,
        // Discovery validation is independently exercised against real module
        // shapes; this host fixture controls only asynchronous module arrival.
        findSolcordFakeDeafenPresentationKey: (module: unknown) => module === rowModule ? "Nd" : undefined,
        preserveSolcordOwnVoiceDeafenPresentation,
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
            notifications++;
            if (!candidate.fakeDeafenStatus().accountBound) return;
            if (throwOnReady) throw new Error("observer failed");
            if (stopOnReady) {stopOnReady = false; candidate.stop();}
        },
        normalizeTimelineAccountId: (id: unknown) => typeof id === "string" && /^[1-9]\d{16,19}$/.test(id) ? id : undefined,
        getStore: (name: string) => stores[name],
        getLazy: async (filter: (value: unknown) => boolean, {signal}: {signal: AbortSignal;}) => {
            signals.push(signal);
            if (filter === isSolcordFakeDeafenPresentationModule) {
                if (!deferPresentation) return rowModule;
                return new Promise(resolve => {presentationResolve = resolve; signal.addEventListener("abort", () => resolve(undefined), {once: true});});
            }
            for (const candidate of [gateway, ...(missingAudio ? [] : [mediaActions])]) if (filter(candidate)) return candidate;
            return new Promise(resolve => signal.addEventListener("abort", () => resolve(undefined), {once: true}));
        },
        Patcher: {get patches() {return actualPatcher.patches;},
before(name: string, target: typeof socket, method: string, callback: (self: unknown, args: unknown[]) => void, options: object) {
            if (name === "Solcord~FakeDeafen") patches++;
            const remove = actualPatcher.before(name, target, method, callback, options);
            return () => {removals.push(name === "Solcord~FakeDeafen" ? "before" : "transport-before"); remove();};
        },
after(name: string, target: object, key: string, callback: (self: unknown, args: unknown[], result: unknown) => unknown, options: object) {
            if (target === rowModule && rejectPresentationPatch) throw new Error("read-only export");
            if (name === "Solcord~FakeDeafen" && rejectSendCompletion === "throw") throw new Error("completion export failed");
            if (name === "Solcord~FakeDeafen" && rejectSendCompletion === "null") return null;
            const remove = actualPatcher.after(name, target, key, callback, options);
            return () => {if (key === "send") removals.push(name === "Solcord~FakeDeafen" ? "after" : "transport-after"); remove();};
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
        rowModule,
        sessionId,
        acceptedFrames,
        removals,
        rowRefreshes,
        get failSend() {return failSend;},
        set failSend(value: boolean) {failSend = value;},
        get failRawSend() {return failRawSend;},
        set failRawSend(value: boolean) {failRawSend = value;},
        get rawReadyState() {return socket.webSocket.readyState;},
        set rawReadyState(value: number) {socket.webSocket.readyState = value;},
        get localDeafened() {return localDeafened;},
        get presentationPatches() {return actualPatcher.getPatchesByCaller("Solcord~FakeDeafenIndicator").length;},
        arrivePresentation() {presentationResolve?.(rowModule);},
        get notifications() {return notifications;},
        get listenerCount() {return listenerCount;},
        get serverSelfDeaf() {return serverSelfDeaf;},
        set serverSelfDeaf(value: boolean) {serverSelfDeaf = value;},
        emitVoiceChange() {for (const listener of listeners) listener();},
        stopBeforeListenerRegisters() {beforeRegister = () => {beforeRegister = undefined; runtime.stop();};},
        get patches() {return patches;},
        get livePatches() {return actualPatcher.getPatchesByCaller("Solcord~FakeDeafen").filter((patch: {type: string;}) => patch.type === "before").length;},
        get liveSendHooks() {return actualPatcher.getPatchesByCaller("Solcord~FakeDeafen").length + actualPatcher.getPatchesByCaller("Solcord~FakeDeafenTransport").length;},
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
        replaceSocket() {socket = {webSocket: {readyState: 1, send() {}}, send() {}};},
        replaceTransport() {socket.webSocket = {readyState: 1, send() {}};}
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

    test.each([[false, false], [true, false], [false, true], [true, true]])("failed native restoration never publishes armed success (first send also fails: %s, swallowed raw failure: %s)", async (failFirst, rawFailure) => {
        const originalTimeout = globalThis.setTimeout;
        let expire: (() => void) | undefined;
        const timer = spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay: number, ...args: unknown[]) => {
            if (delay === 5_000) expire = callback;
            return originalTimeout(callback, delay, ...args);
        }) as never);
        try {
            const h = harness(); h.channelId = "333333333333333333";
            const operation = h.runtime.toggleFakeDeafenDirect();
            for (let i = 0; i < 20 && !h.pendingNative.length; i++) await Promise.resolve();
            h.failSend = failFirst && !rawFailure;
            h.failRawSend = failFirst && rawFailure;
            const first = h.pendingNative.shift()!;
            if (failFirst && !rawFailure) expect(first).toThrow("gateway send failed");
            else first();
            await Promise.resolve();
            h.failSend = !rawFailure;
            h.failRawSend = rawFailure;
            const restore = h.pendingNative.shift()!;
            if (rawFailure) restore();
            else expect(restore).toThrow("gateway send failed");
            expect(h.localDeafened).toBeFalse();
            expect(h.runtime.fakeDeafenStatus()).toMatchObject({armed: false, pending: true});
            expect(h.toasts).toHaveLength(0);
            expect(expire).toBeFunction();
            expire!();
            expect(await operation).toBeFalse();
            expect(h.runtime.fakeDeafenStatus()).toMatchObject({armed: false, pending: false, phase: "attention"});
            expect(h.acceptedFrames).toHaveLength(failFirst ? 0 : 1);
            expect(h.toasts.some(toast => toast.kind === "success")).toBeFalse();
            expect(h.settings.privacy.profile).toBe("strict");
            h.runtime.stop();
            expect(h.liveSendHooks).toBe(0);
        }
        finally {timer.mockRestore();}
    });

    test.each(["throw", "null"])("a %s completion hook rolls back the before hook", async rejectSendCompletion => {
        const h = harness({rejectSendCompletion});
        expect(await h.runtime.setPowerExperiment("fake-deafen", true, true)).toBeFalse();
        expect(h.liveSendHooks).toBe(0);
        expect(h.removals).toEqual(["before", "transport-after", "transport-before"]);
        expect(h.runtime.fakeDeafenStatus().armed).toBeFalse();
    });

    test("teardown removes the completion hook before the rewrite hook", async () => {
        const h = harness();
        expect(await h.runtime.setPowerExperiment("fake-deafen", true, true)).toBeTrue();
        expect(h.liveSendHooks).toBe(4);
        h.runtime.stop();
        expect(h.liveSendHooks).toBe(0);
        expect(h.removals).toEqual(["after", "before", "transport-after", "transport-before"]);
    });

    test.each(["throw", "closed"])("direct off reports an unconfirmed restoration when raw transport is %s", async failure => {
        const h = harness(); h.channelId = "333333333333333333";
        const operation = h.runtime.toggleFakeDeafenDirect();
        for (let i = 0; i < 20 && !h.pendingNative.length; i++) await Promise.resolve();
        h.pendingNative.shift()!(); await Promise.resolve(); h.pendingNative.shift()!();
        expect(await operation).toBeTrue();
        const frames = h.acceptedFrames.length;
        if (failure === "throw") h.failRawSend = true;
        else h.rawReadyState = 3;
        expect(await h.runtime.toggleFakeDeafenDirect()).toBeFalse();
        expect(h.acceptedFrames).toHaveLength(frames);
        expect(h.runtime.fakeDeafenStatus()).toMatchObject({armed: false, phase: "attention"});
        expect(h.runtime.fakeDeafenStatus().detail).toContain("resynchron");
        expect(h.toasts.at(-1)?.kind).toBe("error");
        expect(h.localDeafened).toBeFalse();
        expect(h.settings.privacy.profile).toBe("strict");
        h.runtime.stop();
        expect(h.liveSendHooks).toBe(0);
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
        expect(h.runtime.fakeDeafenStatus()).toMatchObject({phase: "attention", armed: false});
        expect(h.runtime.fakeDeafenStatus().detail).toContain("resync");
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

    test("own voice observations update without retaining identity or changing Strict privacy", async () => {
        const h = harness(); h.channelId = "333333333333333333";
        expect(await h.runtime.setPowerExperiment("fake-deafen", true, true)).toBeTrue();
        expect(h.listenerCount).toBe(3);
        expect(h.runtime.fakeDeafenStatus().voice).toEqual({localSelfDeaf: false, serverSelfDeaf: false, serverDeaf: false});
        const before = h.notifications;
        h.emitVoiceChange(); await Promise.resolve();
        expect(h.notifications).toBe(before);
        h.serverSelfDeaf = true;
        h.emitVoiceChange(); h.emitVoiceChange(); await Promise.resolve();
        expect(h.notifications).toBe(before + 1);
        const voice = h.runtime.fakeDeafenStatus().voice;
        expect(voice).toEqual({localSelfDeaf: false, serverSelfDeaf: true, serverDeaf: false});
        expect(JSON.stringify(voice)).not.toContain(h.accountId);
        expect(JSON.stringify(voice)).not.toContain(h.channelId!);
        expect(h.settings.privacy.profile).toBe("strict");
        h.emitVoiceChange(); h.runtime.stop();
        const stopped = h.notifications;
        await Promise.resolve();
        expect(h.notifications).toBe(stopped);
        expect(h.listenerCount).toBe(0);
    });

    test("a queued voice update cannot retain an adapter after account drift", async () => {
        const h = harness(); h.channelId = "333333333333333333";
        expect(await h.runtime.setPowerExperiment("fake-deafen", true, true)).toBeTrue();
        h.accountId = "222222222222222222";
        h.emitVoiceChange(); await Promise.resolve();
        expect(h.livePatches).toBe(0);
        expect(h.runtime.fakeDeafenStatus()).toMatchObject({armed: false, phase: "attention"});
        h.runtime.stop();
        expect(h.listenerCount).toBe(0);
    });

    test("a host registration that reenters stop cannot leave a late listener or republish readiness", async () => {
        const h = harness(); h.stopBeforeListenerRegisters();
        expect(await h.runtime.setPowerExperiment("fake-deafen", true, true)).toBeFalse();
        expect(h.livePatches).toBe(0);
        expect(h.listenerCount).toBe(0);
        expect(h.runtime.fakeDeafenStatus()).toMatchObject({armed: false, phase: "off"});
        const before = h.notifications;
        h.emitVoiceChange(); await Promise.resolve();
        expect(h.notifications).toBe(before);
        expect(await h.runtime.setPowerExperiment("fake-deafen", true, true)).toBeTrue();
        expect(h.listenerCount).toBe(3);
        h.runtime.stop();
        expect(h.listenerCount).toBe(0);
    });

    test("the own-row indicator follows the received state without changing local audio and restores on direct off", async () => {
        const h = harness(); h.channelId = "333333333333333333";
        const operation = h.runtime.toggleFakeDeafenDirect();
        for (let i = 0; i < 20 && !h.pendingNative.length; i++) await Promise.resolve();
        h.pendingNative.shift()!(); await Promise.resolve(); h.pendingNative.shift()!();
        expect(await operation).toBeTrue();
        h.serverSelfDeaf = true;
        class VoiceRow {
            userId = h.accountId; channelId = h.channelId; sessionId = h.sessionId;
            selfDeaf = true; selfMute = true; deaf = false;
            merge(update: object): VoiceRow {return Object.assign(new VoiceRow(), this, update);}
        }
        const record = new VoiceRow();
        const local = {sessionId: h.sessionId, selfDeaf: false, selfMute: true};
        expect(h.runtime.fakeDeafenStatus()).toMatchObject({armed: true, ownRowIndicator: true, voice: {localSelfDeaf: false, serverSelfDeaf: true}});
        expect(h.presentationPatches).toBe(1);
        expect(h.rowModule.Nd(record, local)).toMatchObject({selfDeaf: true, selfMute: true});
        expect(record.selfDeaf).toBeTrue();
        h.channelId = "444444444444444444";
        const moved = new VoiceRow();
        const beforeRender = h.notifications;
        expect(h.rowModule.Nd(moved, local)).toMatchObject({selfDeaf: false, selfMute: true});
        expect(h.notifications).toBe(beforeRender); // Render guard has no dispatch or status side effects.
        h.channelId = record.channelId;
        expect(await h.runtime.toggleFakeDeafenDirect()).toBeTrue();
        expect(h.rowModule.Nd(record, local)).toMatchObject({selfDeaf: false, selfMute: true});
        expect(h.runtime.fakeDeafenStatus().voice?.localSelfDeaf).toBeFalse();
        h.runtime.stop();
        expect(h.presentationPatches).toBe(0);
        expect(h.settings.privacy.profile).toBe("strict");
    });

    test("lazy row discovery cannot install a patch after teardown", async () => {
        const h = harness({deferPresentation: true});
        expect(await h.runtime.setPowerExperiment("fake-deafen", true, true)).toBeTrue();
        expect(h.runtime.fakeDeafenStatus().ownRowIndicator).toBeFalse();
        h.runtime.stop(); h.arrivePresentation();
        await Promise.resolve(); await Promise.resolve();
        expect(h.presentationPatches).toBe(0);
        expect(h.signals.every(signal => signal.aborted)).toBeTrue();
        expect(h.runtime.fakeDeafenStatus().ownRowIndicator).toBeFalse();
    });

    test("late indicator installation, direct off and teardown refresh only the owned row", async () => {
        const h = harness({deferPresentation: true}); h.channelId = "333333333333333333";
        const operation = h.runtime.toggleFakeDeafenDirect();
        for (let i = 0; i < 20 && !h.pendingNative.length; i++) await Promise.resolve();
        h.pendingNative.shift()!(); await Promise.resolve(); h.pendingNative.shift()!();
        expect(await operation).toBeTrue();
        h.serverSelfDeaf = true;
        expect(h.rowRefreshes).toEqual([]);
        h.arrivePresentation();
        for (let i = 0; i < 5; i++) await Promise.resolve();
        expect(h.rowRefreshes).toEqual([{channelId: h.channelId, armed: true, patched: true}]);
        h.emitVoiceChange(); h.emitVoiceChange();
        for (let i = 0; i < 3; i++) await Promise.resolve();
        const refreshed = h.rowRefreshes.length;
        h.emitVoiceChange(); h.emitVoiceChange();
        for (let i = 0; i < 3; i++) await Promise.resolve();
        expect(h.rowRefreshes).toHaveLength(refreshed);
        expect(await h.runtime.toggleFakeDeafenDirect()).toBeTrue();
        expect(h.rowRefreshes.at(-1)).toEqual({channelId: h.channelId, armed: false, patched: true});
        h.runtime.stop(); await Promise.resolve();
        expect(h.rowRefreshes.at(-1)).toEqual({channelId: h.channelId, armed: false, patched: false});
        expect(h.localDeafened).toBeFalse();
        expect(h.settings.privacy.profile).toBe("strict");
    });

    test("a queued row refresh cannot follow the account into a replacement identity", async () => {
        const h = harness(); h.channelId = "333333333333333333";
        expect(await h.runtime.setPowerExperiment("fake-deafen", true, true)).toBeTrue();
        for (let i = 0; i < 3; i++) await Promise.resolve();
        h.rowRefreshes.length = 0;
        h.serverSelfDeaf = true; h.emitVoiceChange();
        await Promise.resolve(); // The owned store update queued a row refresh.
        h.accountId = "222222222222222222";
        await Promise.resolve();
        expect(h.rowRefreshes).toEqual([]);
        h.runtime.stop(); await Promise.resolve();
        expect(h.rowRefreshes).toEqual([]);
    });

    test("a replacement generation cancels the old cleanup refresh", async () => {
        const h = harness(); h.channelId = "333333333333333333";
        expect(await h.runtime.setPowerExperiment("fake-deafen", true, true)).toBeTrue();
        for (let i = 0; i < 3; i++) await Promise.resolve();
        h.rowRefreshes.length = 0;
        h.runtime.stop();
        const replacement = h.runtime.setPowerExperiment("fake-deafen", true, true);
        expect(await replacement).toBeTrue();
        for (let i = 0; i < 3; i++) await Promise.resolve();
        expect(h.rowRefreshes.length).toBeGreaterThan(0);
        expect(h.rowRefreshes.every(row => row.patched)).toBeTrue();
    });

    test("a read-only presentation export stays visibly unavailable without stopping voice ownership", async () => {
        const h = harness({rejectPresentationPatch: true});
        expect(await h.runtime.setPowerExperiment("fake-deafen", true, true)).toBeTrue();
        await Promise.resolve(); await Promise.resolve();
        expect(h.presentationPatches).toBe(0);
        expect(h.livePatches).toBe(1);
        expect(h.runtime.fakeDeafenStatus().ownRowIndicator).toBeFalse();
        h.runtime.stop();
        expect(h.livePatches).toBe(0);
    });
});
