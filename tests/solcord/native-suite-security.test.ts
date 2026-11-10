// SPDX-License-Identifier: Apache-2.0

import {afterEach, describe, expect, spyOn, test} from "bun:test";

import {
    analyzeSolcordVoiceNote,
    normalizeSolcordVoiceDownloadUrl,
    readBoundedTranslationJson,
    resolveSolcordRelationshipReader,
    resolveSolcordSpeakingReader,
    SOLCORD_TRANSLATION_RESPONSE_MAX_BYTES,
    SOLCORD_VOICE_NOTE_STOP_TIMEOUT_MS,
    SolcordNativeSuiteController,
    subscribeSolcordChangeStores
} from "../../src/betterdiscord/modules/solcord/native-suite";
import {SolcordDisposalScope} from "../../src/betterdiscord/modules/solcord/disposal";
import {SOLCORD_VOICE_NOTE_MAX_BYTES, SOLCORD_VOICE_NOTE_MAX_DURATION_MS} from "../../src/common/solcord/v2-feature-models";

class TestMediaRecorder extends EventTarget {
    static failConstruction = false;
    static failStart = false;
    static suppressStopEvent = false;
    static instances: TestMediaRecorder[] = [];

    static isTypeSupported(): boolean {return false;}

    readonly mimeType: string;
    state: RecordingState = "inactive";

    constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
        super();
        if (TestMediaRecorder.failConstruction) throw new Error("constructor failed");
        this.mimeType = options?.mimeType ?? "audio/webm;codecs=opus";
        TestMediaRecorder.instances.push(this);
    }

    start(): void {
        if (TestMediaRecorder.failStart) throw new Error("start failed");
        this.state = "recording";
    }

    stop(): void {
        if (this.state === "inactive") throw new Error("recorder is inactive");
        this.state = "inactive";
        if (!TestMediaRecorder.suppressStopEvent) this.dispatchEvent(new Event("stop"));
    }

    emitData(data: Blob): void {
        const event = new Event("dataavailable");
        Object.defineProperty(event, "data", {value: data});
        this.dispatchEvent(event);
    }
}

interface TestTrack extends MediaStreamTrack {stopCount: number;}

const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
const originalMediaRecorder = Object.getOwnPropertyDescriptor(globalThis, "MediaRecorder");
const originalFetch = globalThis.fetch;
const controllers: Array<{controller: SolcordNativeSuiteController; scope: SolcordDisposalScope;}> = [];
const VOICE_CHANNEL_ID = "123456789012345678";
const VOICE_USER_ID = "234567890123456789";
const OTHER_VOICE_USER_ID = "345678901234567890";

function testStream(): {stream: MediaStream; track: TestTrack;} {
    const track = {
        stopCount: 0,
        stop() {this.stopCount++;}
    } as TestTrack;
    return {track, stream: {getTracks: () => [track]} as unknown as MediaStream};
}

function installVoiceRuntime(getUserMedia: () => Promise<MediaStream>): void {
    Object.defineProperty(globalThis, "MediaRecorder", {configurable: true, value: TestMediaRecorder});
    Object.defineProperty(navigator, "mediaDevices", {configurable: true, value: {getUserMedia}});
}

function startController(): SolcordNativeSuiteController {
    const scope = new SolcordDisposalScope();
    const controller = new SolcordNativeSuiteController(scope, {VoiceMessages: true}, {prepareVoiceNoteUpload: () => {}});
    controller.start();
    controllers.push({controller, scope});
    return controller;
}

afterEach(() => {
    for (const {controller, scope} of controllers.splice(0)) {
        controller.dispose();
        scope.dispose();
    }
    TestMediaRecorder.failConstruction = false;
    TestMediaRecorder.failStart = false;
    TestMediaRecorder.suppressStopEvent = false;
    TestMediaRecorder.instances.splice(0);
    if (originalMediaRecorder) Object.defineProperty(globalThis, "MediaRecorder", originalMediaRecorder);
    else Reflect.deleteProperty(globalThis, "MediaRecorder");
    if (originalMediaDevices) Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
    else Reflect.deleteProperty(navigator, "mediaDevices");
    globalThis.fetch = originalFetch;
});

describe("Solcord native-suite security boundaries", () => {
    test("DOM invalidations ignore unrelated churn and scope timestamp discovery to the added subtree", () => {
        installVoiceRuntime(async () => testStream().stream);
        const originalObserver = globalThis.MutationObserver;
        const originalFrame = globalThis.requestAnimationFrame;
        const originalCancelFrame = globalThis.cancelAnimationFrame;
        const observers: Array<{observer: MutationObserver; callback: MutationCallback;}> = [];
        const frames = new Map<number, FrameRequestCallback>();
        let frameId = 0;
        globalThis.MutationObserver = class extends originalObserver {
            constructor(callback: MutationCallback) {
                super(callback);
                observers.push({observer: this, callback});
            }
        };
        globalThis.requestAnimationFrame = callback => {frames.set(++frameId, callback); return frameId;};
        globalThis.cancelAnimationFrame = id => {frames.delete(id);};
        const drainMutations = () => {
            let count = 0;
            for (const {observer, callback} of observers) {
                const records = observer.takeRecords();
                count += records.length;
                if (records.length) callback(records, observer);
            }
            return count;
        };
        const scope = new SolcordDisposalScope();
        const controller = new SolcordNativeSuiteController(scope, {CompleteTimestamps: true, CharCounter: true, VoiceMessages: true}, {prepareVoiceNoteUpload: () => {}});
        const unrelated = document.createElement("section");
        const timestamp = document.createElement("time");
        timestamp.setAttribute("datetime", "2026-11-07T12:00:00.000Z");
        try {
            controller.start();
            const searches = spyOn(document, "querySelectorAll");
            try {
                document.body.append(unrelated);
                expect(drainMutations()).toBeGreaterThan(0);
                expect(frames.size).toBe(0);
                expect(searches).not.toHaveBeenCalled();
                unrelated.append(timestamp);
                expect(drainMutations()).toBeGreaterThan(0);
                expect(frames.size).toBe(1);
                // Hold the queued frame deliberately: wall-clock sleeps cannot
                // establish that an observer's later animation frame has run.
                expect(timestamp.dataset.solcordCompleteTime).toBeUndefined();
                const [pendingId, render] = [...frames][0];
                frames.delete(pendingId);
                render(0);
                expect(timestamp.dataset.solcordCompleteTime).toBe("true");
                expect(searches).not.toHaveBeenCalled();
                const view = controller.statusView();
                expect(controller.statusView()).toBe(view);
                expect(Object.isFrozen(view)).toBeTrue();
            }
            finally {searches.mockRestore();}
        }
        finally {
            try {controller.dispose(); scope.dispose(); unrelated.remove();}
            finally {
                globalThis.MutationObserver = originalObserver;
                globalThis.requestAnimationFrame = originalFrame;
                globalThis.cancelAnimationFrame = originalCancelFrame;
            }
        }
    });

    test("fifty native-suite start/dispose cycles release every owned DOM listener and observer", () => {
        installVoiceRuntime(async () => testStream().stream);
        for (let index = 0; index < 50; index++) {
            const scope = new SolcordDisposalScope();
            const controller = new SolcordNativeSuiteController(scope, {CharCounter: true, VoiceMessages: true}, {prepareVoiceNoteUpload: () => {}});
            controller.start();
            controller.dispose(); scope.dispose();
            expect(Object.values(scope.counts()).every(count => count === 0)).toBeTrue();
        }
    });
    test("recycled voice rows revalidate their current attachment on the download action", () => {
        installVoiceRuntime(async () => testStream().stream);
        const host = document.createElement("div");
        host.className = "voiceMessage_fixture";
        host.innerHTML = "<audio src=\"https://cdn.discordapp.com/attachments/1/2/first.ogg?ex=one\"></audio>";
        document.body.append(host);
        const controller = startController();
        const audio = host.querySelector("audio")!;
        const link = host.querySelector<HTMLAnchorElement>("[data-solcord-voice-download]")!;
        audio.src = "https://cdn.discordapp.com/attachments/1/3/second.webm?ex=two";
        link.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true}));
        expect(link.href).toBe(audio.src);
        expect(link.download).toBe("voice-message.webm");
        audio.src = "https://example.com/unsupported.webm";
        const invalidClick = new MouseEvent("click", {bubbles: true, cancelable: true});
        link.dispatchEvent(invalidClick);
        expect(invalidClick.defaultPrevented).toBeTrue();
        expect(host.querySelector("[data-solcord-voice-download]")).toBeNull();
        controller.dispose(); host.remove();
    });
    test("notification confirmation uses the message boundary captured during review", () => {
        const scope = new SolcordDisposalScope();
        let latest = "100";
        let targets: Readonly<Record<string, string>> | undefined;
        const controller = new SolcordNativeSuiteController(scope, {ReadAllNotificationsButton: true}, {
            notificationIds: () => ["200"],
            notificationMessageId: () => latest,
            markNotificationsRead: (_kind, _ids, reviewed) => {targets = reviewed;}
        });
        controller.start();
        const preview = controller.previewNotifications("all");
        latest = "101";
        controller.applyReviewedNotifications(preview.id);
        expect(targets).toEqual({200: "100"});
        controller.dispose(); scope.dispose();
    });

    test("canceling recording A during decode cannot mutate recording B", async () => {
        const original = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
        const decode: Array<(value: {duration: number; numberOfChannels: number; getChannelData(): Float32Array;}) => void> = [];
        Object.defineProperty(globalThis, "AudioContext", {configurable: true,
value: class {
            decodeAudioData() {return new Promise(resolve => decode.push(resolve));}
            close() {return Promise.resolve();}
        }});
        const first = testStream();
        const second = testStream();
        let calls = 0;
        installVoiceRuntime(async () => (++calls === 1 ? first : second).stream);
        const controller = startController();
        try {
            await controller.beginVoiceNoteFromUserGesture();
            TestMediaRecorder.instances.at(-1)!.emitData(new Blob(["A"]));
            const previewA = controller.stopVoiceNoteForPreview();
            const rejectedA = previewA.then(() => undefined, error => error as Error);
            expect(first.track.stopCount).toBe(1);
            while (!decode.length) await Promise.resolve();
            controller.cancelVoiceNote();
            const recordingB = await controller.beginVoiceNoteFromUserGesture();
            decode[0]({duration: 1, numberOfChannels: 1, getChannelData: () => new Float32Array([0, 1])});
            expect((await rejectedA)?.message).toContain("canceled");
            expect(controller.voiceNotePhase()).toBe("recording");
            expect(second.track.stopCount).toBe(0);
            TestMediaRecorder.instances.at(-1)!.emitData(new Blob(["B"]));
            const previewB = controller.stopVoiceNoteForPreview();
            while (decode.length < 2) await Promise.resolve();
            decode[1]({duration: 1, numberOfChannels: 1, getChannelData: () => new Float32Array([1, 0])});
            expect((await previewB).recordingId).toBe(recordingB.recordingId);
            expect(controller.voiceNotePhase()).toBe("preview-ready");
            expect(second.track.stopCount).toBe(1);
        }
        finally {
            if (original) Object.defineProperty(globalThis, "AudioContext", original);
            else Reflect.deleteProperty(globalThis, "AudioContext");
        }
    });

    test("waveform sample work is bounded for a ten-minute stereo fixture", async () => {
        let reads = 0;
        const channel = new Proxy({length: 28_800_000}, {get(target, key) {
            if (key === "length") return target.length;
            reads++; return 0.5;
        }}) as unknown as Float32Array;
        const analyzed = await analyzeSolcordVoiceNote(new Blob(["local"]), () => ({
            decodeAudioData: async () => ({duration: 600, numberOfChannels: 2, getChannelData: () => channel}),
            close: async () => {}
        }));
        expect(analyzed.waveform).toHaveLength(256);
        expect(reads).toBeLessThanOrEqual(256 * 128 * 2);
        expect(analyzed.durationMs).toBe(600_000);
        let decodes = 0;
        const productionPreview = await analyzeSolcordVoiceNote(new Blob(["local"]), () => {
            decodes++; throw new Error("Long recordings must not allocate full decoded PCM.");
        }, 600_000);
        expect(decodes).toBe(0);
        expect(productionPreview).toEqual({durationMs: 600_000, waveform: []});
    });
    test("reads current and legacy relationship-store snapshots without mutating them", () => {
        const immutable = {101: 1};
        const immutableReader = resolveSolcordRelationshipReader({getRelationships: () => immutable});
        expect(immutableReader?.()).toBe(immutable);

        const legacy = new Map([["202", 2]]);
        const legacyStore = {getMutableRelationships: () => legacy};
        const legacyReader = resolveSolcordRelationshipReader(legacyStore);
        expect(legacyReader?.()).toBe(legacy);
        expect(legacyStore.getMutableRelationships()).toBe(legacy);

        expect(resolveSolcordRelationshipReader({getRelationships: () => []})?.()).toBeUndefined();
        expect(resolveSolcordRelationshipReader({getMutableRelationships: () => {throw new Error("drift");}})?.()).toBeUndefined();
        expect(resolveSolcordRelationshipReader({})).toBeUndefined();
    });

    test("derives bounded voice-note duration and waveform locally and always closes audio resources", async () => {
        let closed = 0;
        const result = await analyzeSolcordVoiceNote(new Blob([new Uint8Array([1, 2, 3])]), () => ({
            decodeAudioData: async () => ({duration: 1.25, numberOfChannels: 1, getChannelData: () => new Float32Array([0, 0.5, 1, 0])}),
            close: async () => {closed++;}
        }));
        expect(result).toEqual({durationMs: 1_250, waveform: [0, 128, 255, 0]});
        expect(closed).toBe(1);

        const failed = await analyzeSolcordVoiceNote(new Blob([new Uint8Array([1])]), () => ({
            decodeAudioData: async () => {throw new Error("decode failed");},
            close: async () => {closed++;}
        }));
        expect(failed).toEqual({waveform: []});
        expect(closed).toBe(2);
    });

    test("supports both reviewed SpeakingStore method generations and rejects unknown shapes", () => {
        const legacy = {calls: 0, getSpeakingUsers() {this.calls++; return ["legacy"];}};
        const current = {calls: 0, getSpeakers() {this.calls++; return ["current"];}};

        expect(resolveSolcordSpeakingReader(legacy)?.()).toEqual(["legacy"]);
        expect(legacy.calls).toBe(1);
        expect(resolveSolcordSpeakingReader(current)?.()).toEqual(["current"]);
        expect(current.calls).toBe(1);
        expect(resolveSolcordSpeakingReader({})).toBeUndefined();
        expect(resolveSolcordSpeakingReader(undefined)).toBeUndefined();
    });

    test("distinguishes disabled, ready, degraded, and unsupported adapters", async () => {
        let idleReads = 0;
        let idleSubscriptions = 0;
        const idleScope = new SolcordDisposalScope();
        const idle = new SolcordNativeSuiteController(idleScope, {}, {
            currentCall: () => {idleReads++; return undefined;},
            subscribeCall: () => {idleSubscriptions++; return () => {};}
        });
        idle.start();
        controllers.push({controller: idle, scope: idleScope});
        const idleStatuses = idle.statuses();
        const idleStatus = Object.fromEntries(idleStatuses.map(item => [item.id, item.maturity]));
        expect(idleStatus["audio-console"]).toBe("off");
        expect(idleStatus["voice-health"]).toBe("off");
        expect(idleStatus["permission-lens"]).toBe("ready");
        expect(idleStatus["local-identity-notes"]).toBe("unsupported");
        expect(idleStatuses.find(item => item.id === "local-identity-notes")?.detail).toContain("no additional user setup");
        expect(idle.providerReady("BetterVolume")).toBeFalse();
        expect(idleReads).toBe(0);
        expect(idleSubscriptions).toBe(0);
        expect(idleScope.counts().observer).toBeUndefined();

        const activeScope = new SolcordDisposalScope();
        const appliedVolumes: Array<[string, number]> = [];
        const active = new SolcordNativeSuiteController(activeScope, {BetterVolume: true, Translator: true}, {
            currentChannelId: () => VOICE_CHANNEL_ID,
            currentCall: () => ({channelId: VOICE_CHANNEL_ID, connectedAt: Date.now(), participantCount: 1, speakerCount: 0, viewerCount: 0, participantIds: [VOICE_USER_ID]}),
            setLocalVolume: (userId, percent) => {appliedVolumes.push([userId, percent]);},
            translationPreferences: {provider: "local", sourceLanguage: "en", targetLanguage: "es"},
            localTranslationFactory: {
                availability: async () => "available",
                create: async () => ({translate: async text => `local:${text}`, destroy: () => {}})
            }
        });
        active.start();
        controllers.push({controller: active, scope: activeScope});
        const activeStatus = Object.fromEntries(active.statuses().map(item => [item.id, item.maturity]));
        expect(activeStatus["audio-console"]).toBe("ready");
        expect(activeStatus["translation-desk"]).toBe("degraded");
        await expect(active.translateLocally("en", "es", "hello")).resolves.toBe("local:hello");
        expect(active.providerReady("BetterVolume")).toBeFalse();
        expect(active.providerAvailable("BetterVolume")).toBeTrue();
        expect(active.providerReady("Translator")).toBeTrue();
        expect(active.currentChannelId()).toBe(VOICE_CHANNEL_ID);
        expect(active.localVolumeReviewState("123")).toEqual(expect.objectContaining({ready: false}));
        expect(active.localVolumeReviewState(OTHER_VOICE_USER_ID).detail).toContain("not in the current call");
        active.previewLocalVolume(VOICE_USER_ID, 100, 135);
        active.applyReviewedLocalVolume();
        expect(appliedVolumes).toEqual([[VOICE_USER_ID, 135]]);
        expect(active.providerReady("BetterVolume")).toBeTrue();
        expect(active.statuses().find(item => item.id === "audio-console")?.maturity).toBe("ready");

        let activeReads = 0;
        let activeSubscriptions = 0;
        let activeUnsubscribes = 0;
        const callHost = document.createElement("div");
        callHost.className = "panels_test";
        document.body.append(callHost);
        const callScope = new SolcordDisposalScope();
        const call = new SolcordNativeSuiteController(callScope, {CallTimeCounter: true}, {
            currentCall: () => {activeReads++; return {channelId: "123456", connectedAt: Date.now(), participantCount: 2, speakerCount: 1, viewerCount: 0};},
            subscribeCall: () => {activeSubscriptions++; return () => {activeUnsubscribes++;};},
            saveFocusChannelIds: () => {}
        });
        call.start();
        controllers.push({controller: call, scope: callScope});
        expect(activeReads).toBe(1);
        expect(activeSubscriptions).toBe(1);
        expect(call.providerAvailable("CallTimeCounter")).toBeTrue();
        expect(callHost.querySelector("[data-solcord-call-badge]")).not.toBeNull();
        call.setFocusChannels([]);
        expect(callHost.querySelector("[data-solcord-call-badge]")).not.toBeNull();
        call.dispose();
        callScope.dispose();
        expect(activeUnsubscribes).toBe(1);
        expect(callHost.querySelector("[data-solcord-call-badge]")).toBeNull();
        callHost.remove();

        const optionalScope = new SolcordDisposalScope();
        const optional = new SolcordNativeSuiteController(optionalScope, {}, {
            voiceHealthEnabled: true,
            voiceHealthInitialSample: {timestamp: Date.now(), rttMs: 25, jitterMs: 2, packetLossPercent: 0},
            voiceHealthSample: () => ({timestamp: Date.now(), rttMs: 25, jitterMs: 2, packetLossPercent: 0}),
            focusChannelIds: ["12345"],
            saveFocusChannelIds: () => {}
        });
        optional.start();
        controllers.push({controller: optional, scope: optionalScope});
        expect(Object.fromEntries(optional.statuses().map(item => [item.id, item.maturity]))["voice-health"]).toBe("ready");
        expect(optionalScope.counts()).toEqual(expect.objectContaining({interval: 1, observer: 1}));
        optional.setFocusChannels([]);
        expect(optionalScope.counts().observer).toBeUndefined();
    });

    test("degrades stale Voice Health evidence and recovers only after a fresh validated sample", () => {
        const originalSetInterval = globalThis.setInterval;
        const originalClearInterval = globalThis.clearInterval;
        let tick: (() => void) | undefined;
        let sample: {timestamp: number; rttMs: number; jitterMs: number; packetLossPercent: number;} | undefined = {
            timestamp: Date.now(),
            rttMs: 24,
            jitterMs: 2,
            packetLossPercent: 0
        };
        Object.defineProperty(globalThis, "setInterval", {
            configurable: true,
            writable: true,
            value: ((callback: TimerHandler) => {
                tick = callback as () => void;
                return 71;
            }) as typeof globalThis.setInterval
        });
        Object.defineProperty(globalThis, "clearInterval", {configurable: true, writable: true, value: (() => {}) as typeof globalThis.clearInterval});
        const scope = new SolcordDisposalScope();
        const controller = new SolcordNativeSuiteController(scope, {}, {
            voiceHealthEnabled: true,
            voiceHealthCapability: "ready",
            voiceHealthInitialSample: sample,
            voiceHealthSample: () => sample
        });
        try {
            controller.start();
            expect(controller.statuses().find(item => item.id === "voice-health")?.maturity).toBe("ready");
            sample = undefined;
            tick?.();
            tick?.();
            expect(controller.statuses().find(item => item.id === "voice-health")?.maturity).toBe("ready");
            tick?.();
            expect(controller.statuses().find(item => item.id === "voice-health")).toEqual(expect.objectContaining({
                maturity: "degraded",
                detail: expect.stringContaining("temporarily unavailable")
            }));
            sample = {timestamp: Date.now(), rttMs: 30, jitterMs: 3, packetLossPercent: 0.1};
            tick?.();
            expect(controller.statuses().find(item => item.id === "voice-health")?.maturity).toBe("ready");
        }
        finally {
            controller.dispose();
            scope.dispose();
            Object.defineProperty(globalThis, "setInterval", {configurable: true, writable: true, value: originalSetInterval});
            Object.defineProperty(globalThis, "clearInterval", {configurable: true, writable: true, value: originalClearInterval});
        }
    });

    test("isolates a Call Context subscription failure from unrelated native tools", () => {
        let registrations = 0;
        let rollbacks = 0;
        const scope = new SolcordDisposalScope();
        const controller = new SolcordNativeSuiteController(scope, {CallTimeCounter: true, BetterVolume: true}, {
            currentCall: () => ({channelId: "123456", connectedAt: Date.now(), participantCount: 2, speakerCount: 1, viewerCount: 0, participantIds: [VOICE_USER_ID]}),
            subscribeCall: () => {
                registrations++;
                rollbacks++;
                throw new Error("second store rejected subscription");
            },
            setLocalVolume: () => {}
        });
        controller.start();
        controllers.push({controller, scope});
        const statuses = Object.fromEntries(controller.statuses().map(item => [item.id, item.maturity]));
        expect(registrations).toBe(1);
        expect(rollbacks).toBe(1);
        expect(statuses["call-context"]).toBe("unsupported");
        expect(statuses["audio-console"]).toBe("degraded");
    });

    test("keeps Audio Console non-actionable while disconnected, updates live state, and revalidates before apply", async () => {
        let call: {channelId: string; connectedAt: number; participantCount: number; speakerCount: number; viewerCount: number; participantIds: string[];} | undefined;
        const applied: Array<[string, number]> = [];
        let listener: (() => void) | undefined;
        let removals = 0;
        let statusChanges = 0;
        const scope = new SolcordDisposalScope();
        const controller = new SolcordNativeSuiteController(scope, {BetterVolume: true}, {
            onStatusChange: () => {statusChanges++;},
            currentCall: () => call,
            subscribeCall: callback => {
                listener = callback;
                return () => {removals++; listener = undefined;};
            },
            setLocalVolume: (userId, percent) => {applied.push([userId, percent]);}
        });
        controller.start();
        controllers.push({controller, scope});
        await Promise.resolve();

        expect(controller.localVolumeReviewState(VOICE_USER_ID)).toEqual({ready: false, detail: "Waiting for a connected call."});
        expect(() => controller.previewLocalVolume(VOICE_USER_ID, 100, 125)).toThrow("Waiting for a connected call");
        expect(() => controller.previewLocalVolume("123", 100, 125)).toThrow("complete Discord user ID");
        expect(controller.statuses().find(status => status.id === "audio-console")?.maturity).toBe("ready");
        expect(statusChanges).toBe(1);

        call = {channelId: VOICE_CHANNEL_ID, connectedAt: Date.now(), participantCount: 1, speakerCount: 0, viewerCount: 0, participantIds: [VOICE_USER_ID]};
        listener?.();
        await Promise.resolve();
        expect(controller.statuses().find(status => status.id === "audio-console")?.detail).toContain("Ready");
        controller.previewLocalVolume(VOICE_USER_ID, 100, 125);
        call = undefined;
        listener?.();
        expect(() => controller.applyReviewedLocalVolume()).toThrow("Waiting for a connected call");
        expect(applied).toEqual([]);
        expect(controller.providerReady("BetterVolume")).toBeFalse();

        call = {channelId: VOICE_CHANNEL_ID, connectedAt: Date.now(), participantCount: 1, speakerCount: 0, viewerCount: 0, participantIds: [VOICE_USER_ID]};
        listener?.();
        controller.previewLocalVolume(VOICE_USER_ID, 100, 125);
        controller.applyReviewedLocalVolume();
        expect(applied).toEqual([[VOICE_USER_ID, 125]]);
        expect(controller.statuses().find(status => status.id === "audio-console")?.maturity).toBe("ready");

        call = undefined;
        listener?.();
        expect(controller.statuses().find(status => status.id === "audio-console")?.detail).toContain("connect to a call");
        expect(controller.statuses().find(status => status.id === "audio-console")?.maturity).toBe("ready");
        expect(controller.providerReady("BetterVolume")).toBeFalse();
        expect(controller.providerAvailable("BetterVolume")).toBeTrue();
        scope.dispose();
        expect(removals).toBe(1);
        expect(listener).toBeUndefined();
    });

    test("retries a listener removal that failed during partial Call Context subscription rollback", () => {
        const scope = new SolcordDisposalScope();
        let removalAttempts = 0;
        const listener = () => {};
        const first = {
            addChangeListener() {},
            removeChangeListener() {
                removalAttempts++;
                if (removalAttempts === 1) throw new Error("temporary remover failure");
            }
        };
        const second = {
            addChangeListener() {throw new Error("second store rejected subscription");},
            removeChangeListener() {}
        };

        expect(() => subscribeSolcordChangeStores(scope, [first, second], listener)).toThrow("cleanup remains owned for retry");
        expect(scope.counts()).toEqual({listener: 1});
        expect(() => scope.dispose()).not.toThrow();
        expect(removalAttempts).toBe(2);
        expect(scope.counts()).toEqual({});
    });

    test("releases Call Context immediately when the initial store snapshot fails", () => {
        const scope = new SolcordDisposalScope();
        let reads = 0;
        let removals = 0;
        let listener: (() => void) | undefined;
        const controller = new SolcordNativeSuiteController(scope, {CallTimeCounter: true, BetterVolume: true}, {
            currentCall: () => {reads++; throw new Error("invalid snapshot");},
            subscribeCall: callback => {
                listener = callback;
                return () => {removals++; listener = undefined;};
            },
            setLocalVolume: () => {}
        });

        controller.start();
        controllers.push({controller, scope});
        const statuses = Object.fromEntries(controller.statuses().map(item => [item.id, item.maturity]));
        expect(statuses["call-context"]).toBe("unsupported");
        expect(statuses["audio-console"]).toBe("unsupported");
        expect(removals).toBe(1);
        expect(scope.counts().listener).toBeUndefined();
        expect(listener).toBeUndefined();
        expect(reads).toBe(1);
    });

    test("keeps Voice Note Studio usable through a local-file fallback when Discord's composer handoff drifts", () => {
        installVoiceRuntime(async () => testStream().stream);

        const missingDeliveryScope = new SolcordDisposalScope();
        const missingDelivery = new SolcordNativeSuiteController(missingDeliveryScope, {VoiceMessages: true}, {});
        missingDelivery.start();
        controllers.push({controller: missingDelivery, scope: missingDeliveryScope});
        expect(missingDelivery.statuses().find(item => item.id === "voice-note-studio")?.maturity).toBe("unsupported");
        expect(missingDelivery.providerReady("VoiceMessages")).toBeFalse();
        expect(missingDelivery.providerAvailable("VoiceMessages")).toBeFalse();
        expect(missingDelivery.voiceNoteDeliveryMode()).toBe("unavailable");

        const fallbackScope = new SolcordDisposalScope();
        const fallback = new SolcordNativeSuiteController(fallbackScope, {VoiceMessages: true}, {saveVoiceNoteFile: () => {}});
        fallback.start();
        controllers.push({controller: fallback, scope: fallbackScope});
        expect(fallback.statuses().find(item => item.id === "voice-note-studio")?.maturity).toBe("ready");
        expect(fallback.providerReady("VoiceMessages")).toBeTrue();
        expect(fallback.providerAvailable("VoiceMessages")).toBeTrue();
        expect(fallback.voiceNoteDeliveryMode()).toBe("local-file");

        const readyScope = new SolcordDisposalScope();
        const ready = new SolcordNativeSuiteController(readyScope, {VoiceMessages: true}, {prepareVoiceNoteUpload: () => {}});
        ready.start();
        controllers.push({controller: ready, scope: readyScope});
        expect(ready.statuses().find(item => item.id === "voice-note-studio")?.maturity).toBe("ready");
        expect(ready.providerReady("VoiceMessages")).toBeTrue();
        expect(ready.providerAvailable("VoiceMessages")).toBeTrue();
        expect(ready.voiceNoteDeliveryMode()).toBe("discord-composer");
    });

    test("applies the configured character warning and timestamp preset reversibly", () => {
        const host = document.createElement("div");
        host.innerHTML = `<div class="channelTextArea_test"><div role="textbox" contenteditable="true">${"x".repeat(1_500)}</div></div><time datetime="2026-08-29T12:34:56.000Z" title="Discord title">now</time>`;
        document.body.append(host);
        const scope = new SolcordDisposalScope();
        const controller = new SolcordNativeSuiteController(scope, {CharCounter: true, CompleteTimestamps: true}, {composerPreferences: {counterWarningPercent: 75, timestampFormat: "iso"}});
        controller.start();
        controllers.push({controller, scope});

        const counter = host.querySelector<HTMLElement>("[data-solcord-composer-count]");
        const time = host.querySelector<HTMLTimeElement>("time")!;
        expect(counter?.dataset.warning).toBe("true");
        expect(counter?.dataset.overLimit).toBe("false");
        expect(time.title).toBe("2026-08-29T12:34:56.000Z");
        expect(time.textContent).toContain("2026-08-29 12:34:56");

        controller.dispose();
        scope.dispose();
        expect(host.querySelector("[data-solcord-composer-count]")).toBeNull();
        expect(time.title).toBe("Discord title");
        expect(time.textContent).toBe("now");
        host.remove();
    });

    test("does not rewrite an unchanged composer counter during repeated input synchronization", () => {
        const host = document.createElement("div");
        host.innerHTML = `<div class="channelTextArea_test"><div role="textbox" contenteditable="true">hello</div></div>`;
        document.body.append(host);
        const scope = new SolcordDisposalScope();
        const controller = new SolcordNativeSuiteController(scope, {CharCounter: true}, {});
        controller.start();
        controllers.push({controller, scope});

        const counter = host.querySelector<HTMLElement>("[data-solcord-composer-count]")!;
        const stableText = counter.textContent;
        let writes = 0;
        Object.defineProperty(counter, "textContent", {
            configurable: true,
            get: () => stableText,
            set: () => {writes++;}
        });
        document.dispatchEvent(new Event("input", {bubbles: true}));
        document.dispatchEvent(new Event("input", {bubbles: true}));
        expect(writes).toBe(0);
        host.remove();
    });

    test("does not count Discord rich-text placeholders as a draft", () => {
        const host = document.createElement("div");
        host.innerHTML = `<div class="channelTextArea_test"><div role="textbox" contenteditable="true"><div><br></div>\u200B</div></div>`;
        document.body.append(host);
        const scope = new SolcordDisposalScope();
        const controller = new SolcordNativeSuiteController(scope, {CharCounter: true}, {});
        controller.start();
        controllers.push({controller, scope});

        const counter = host.querySelector<HTMLElement>("[data-solcord-composer-count]")!;
        expect(counter.textContent).toBe("0 / 2,000");
        expect(counter.dataset.warning).toBe("false");
        host.remove();
    });

    test("normalizes every loaded empty-editor representation to zero characters", () => {
        const representations = [
            "<br>",
            "\n",
            "&nbsp;",
            "\u200B\u200C\u200D\u2060\uFEFF",
            "<div><br></div><div>&nbsp;<span>\u200B</span></div>"
        ];
        const hosts = representations.map(content => {
            const host = document.createElement("div");
            host.innerHTML = `<div class="channelTextArea_test"><div role="textbox" contenteditable="true">${content}</div></div>`;
            document.body.append(host);
            return host;
        });
        const scope = new SolcordDisposalScope();
        const controller = new SolcordNativeSuiteController(scope, {CharCounter: true}, {});
        controller.start();
        controllers.push({controller, scope});

        expect(hosts.map(host => host.querySelector<HTMLElement>("[data-solcord-composer-count]")?.textContent)).toEqual(representations.map(() => "0 / 2,000"));
        for (const host of hosts) host.remove();
    });

    test("preserves meaningful spaces and line breaks in a real draft count", () => {
        const host = document.createElement("div");
        host.innerHTML = `<div class="channelTextArea_test"><div role="textbox" contenteditable="true">hello world</div></div>`;
        const editor = host.querySelector<HTMLElement>("[role='textbox']")!;
        Object.defineProperty(editor, "innerText", {configurable: true, value: "hello\nworld"});
        document.body.append(host);
        const scope = new SolcordDisposalScope();
        const controller = new SolcordNativeSuiteController(scope, {CharCounter: true}, {});
        controller.start();
        controllers.push({controller, scope});

        expect(host.querySelector<HTMLElement>("[data-solcord-composer-count]")?.textContent).toBe("11 / 2,000");
        host.remove();
    });

    test("adds bounded counters to loaded note textareas and removes them on teardown", () => {
        const field = document.createElement("textarea");
        field.maxLength = 12;
        field.value = "hello world";
        document.body.append(field);
        const scope = new SolcordDisposalScope();
        const controller = new SolcordNativeSuiteController(scope, {CharCounter: true}, {composerPreferences: {counterWarningPercent: 80, timestampFormat: "full"}});
        controller.start();
        controllers.push({controller, scope});

        const counter = field.nextElementSibling as HTMLElement;
        expect(counter.dataset.solcordInputCount).toBe("true");
        expect(counter.textContent).toBe("11 / 12");
        expect(counter.dataset.warning).toBe("true");
        controller.dispose();
        scope.dispose();
        expect(field.nextElementSibling).toBeNull();
        field.remove();
    });

    test("keeps provider-specific composer work isolated and honors timestamp surface switches", () => {
        const host = document.createElement("div");
        host.innerHTML = `<div class="message_test"><time datetime="2026-08-29T12:34:56.000Z" title="Discord title">now</time></div>`;
        document.body.append(host);
        const time = host.querySelector<HTMLTimeElement>("time")!;
        const charScope = new SolcordDisposalScope();
        const charOnly = new SolcordNativeSuiteController(charScope, {CharCounter: true}, {});
        charOnly.start();
        expect(time.title).toBe("Discord title");
        expect(time.textContent).toBe("now");
        charOnly.dispose();
        charScope.dispose();

        const timestampScope = new SolcordDisposalScope();
        const timestampsOff = new SolcordNativeSuiteController(timestampScope, {CompleteTimestamps: true}, {
            timestampPreferences: {chat: false, embeds: true, markup: true, auditLogs: true, chatTooltips: false, editedTooltips: true, markupTooltips: true},
            composerPreferences: {counterWarningPercent: 80, timestampFormat: "compact"}
        });
        timestampsOff.start();
        expect(time.title).toBe("Discord title");
        expect(time.textContent).toBe("now");
        timestampsOff.dispose();
        timestampScope.dispose();
        host.remove();
    });

    test("adds a reversible user-click download for loaded Discord CDN voice messages only", () => {
        expect(normalizeSolcordVoiceDownloadUrl("https://cdn.discordapp.com/attachments/1/2/voice-message.ogg?ex=abc&is=def")).toContain("cdn.discordapp.com/attachments/");
        expect(normalizeSolcordVoiceDownloadUrl("https://example.com/attachments/1/2/voice.ogg")).toBeUndefined();
        expect(normalizeSolcordVoiceDownloadUrl("http://cdn.discordapp.com/attachments/1/2/voice.ogg")).toBeUndefined();

        installVoiceRuntime(async () => testStream().stream);
        const host = document.createElement("div");
        host.innerHTML = `<div class="voiceMessage_test"><audio src="https://cdn.discordapp.com/attachments/1/2/voice-message.ogg?ex=abc"></audio></div><div class="voiceMessage_bad"><audio src="https://example.com/voice.ogg"></audio></div>`;
        document.body.append(host);
        const scope = new SolcordDisposalScope();
        const controller = new SolcordNativeSuiteController(scope, {VoiceMessages: true}, {prepareVoiceNoteUpload: () => {}});
        controller.start();
        controllers.push({controller, scope});
        const link = host.querySelector<HTMLAnchorElement>("[data-solcord-voice-download]");
        expect(link?.download).toBe("voice-message.ogg");
        expect(link?.href).toContain("cdn.discordapp.com/attachments/");
        expect(host.querySelectorAll("[data-solcord-voice-download]")).toHaveLength(1);

        controller.dispose();
        scope.dispose();
        expect(host.querySelector("[data-solcord-voice-download]")).toBeNull();
        host.remove();
    });

    test("omits voice-message download controls when that secondary option is off", () => {
        installVoiceRuntime(async () => testStream().stream);
        const host = document.createElement("div");
        host.innerHTML = `<div class="voiceMessage_test"><audio src="https://cdn.discordapp.com/attachments/1/2/voice-message.ogg"></audio></div>`;
        document.body.append(host);
        const scope = new SolcordDisposalScope();
        const controller = new SolcordNativeSuiteController(scope, {VoiceMessages: true}, {prepareVoiceNoteUpload: () => {}, voiceNotePreferences: {downloadButton: false, stripMetadata: true}});
        controller.start();
        controllers.push({controller, scope});
        expect(host.querySelector("[data-solcord-voice-download]")).toBeNull();
        host.remove();
    });

    test("reports provider readiness individually and applies reversible loaded-DOM People and Spaces behavior", () => {
        const host = document.createElement("div");
        host.innerHTML = `
            <nav data-list-id="private-channels"><div class="channel_test" style="order:7"><a href="/channels/@me/111">Pinned DM</a></div></nav>
            <nav data-list-id="guildsnav"><li style="display:grid"><a href="/channels/222">Guild</a></li></nav>
        `;
        document.body.append(host);
        const scope = new SolcordDisposalScope();
        const saved: unknown[] = [];
        const controller = new SolcordNativeSuiteController(scope, {
            PinDMs: true,
            ServerHider: true,
            EditServers: true,
            ServerDetails: true,
            BetterFriendList: true
        }, {
            peopleState: {pinnedDmIds: ["111"], hiddenGuildIds: ["222"], guildAliases: {222: "Workshop"}, favoriteFriendIds: ["901"], hiddenFriendIds: []},
            savePeopleState: state => saved.push(structuredClone(state)),
            guildDetails: () => ({name: "Original", ownerLabel: "Ada", memberCount: 42, createdAt: 1_700_000_000_000, joinedAt: 1_710_000_000_000, channelCount: 12, roleCount: 7, boostCount: 3, locale: "en-US"}),
            loadedFriends: () => [
                {id: "901", label: "Zed", status: "offline", relationship: "friend", relationshipSince: 1_700_000_000_000, mutualGuildCount: 2},
                {id: "902", label: "Ada", status: "online", relationship: "friend"},
                {id: "903", label: "Blocked", status: "offline", relationship: "blocked"}
            ]
        });
        controller.start();
        controllers.push({controller, scope});

        const dm = host.querySelector<HTMLElement>(".channel_test")!;
        const guildContainer = host.querySelector<HTMLElement>("li")!;
        const guildLink = host.querySelector<HTMLAnchorElement>("a[href='/channels/222']")!;
        expect(dm.dataset.solcordPinnedDm).toBe("true");
        expect(dm.style.order).toBe("-1000");
        expect(guildContainer.style.display).toBe("none");
        expect(controller.providerReady("PinDMs")).toBeTrue();
        expect(controller.providerReady("ServerHider")).toBeTrue();
        expect(controller.providerReady("EditServers")).toBeTrue();
        expect(controller.providerReady("ServerDetails")).toBeTrue();
        expect(controller.providerReady("BetterFriendList")).toBeTrue();
        expect(controller.statuses().find(item => item.id === "people-and-spaces")?.maturity).toBe("ready");
        expect(controller.loadedFriendList("", "status").map(friend => friend.label)).toEqual(["Zed", "Ada"]);
        expect(controller.loadedFriendList("ze", "name")).toHaveLength(1);
        expect(controller.loadedFriendList("", "name", "favorites").map(friend => friend.id)).toEqual(["901"]);
        expect(controller.loadedFriendList("", "name", "favorites")[0]).toMatchObject({relationshipSince: 1_700_000_000_000, mutualGuildCount: 2});
        controller.hideFriend("902");
        expect(controller.loadedFriendList("", "name", "visible").map(friend => friend.id)).toEqual(["901"]);
        expect(controller.loadedFriendList("", "name", "hidden").map(friend => friend.id)).toEqual(["902"]);
        expect(controller.loadedFriendList("", "name", "blocked").map(friend => friend.id)).toEqual(["903"]);
        controller.showFriend("902");
        controller.unfavoriteFriend("901");

        controller.showGuild("222");
        expect(guildContainer.style.display).toBe("grid");
        expect(guildLink.getAttribute("aria-label")).toContain("Workshop");
        expect(guildLink.getAttribute("aria-label")).toContain("42 members");
        expect(guildLink.getAttribute("aria-label")).toContain("12 channels");
        expect(guildLink.getAttribute("aria-label")).toContain("7 roles");
        expect(guildLink.getAttribute("aria-label")).toContain("3 boosts");
        expect(guildLink.getAttribute("aria-label")).toContain("language en-US");
        expect(guildLink.getAttribute("aria-label")).toContain("joined");
        controller.unpinDm("111");
        controller.clearGuildAlias("222");
        expect(dm.style.order).toBe("7");
        expect(guildLink.getAttribute("aria-label")).toContain("Original");
        expect(saved).toHaveLength(6);

        controller.dispose();
        scope.dispose();
        expect(dm.style.order).toBe("7");
        expect(guildContainer.style.display).toBe("grid");
        expect(guildLink.hasAttribute("aria-label")).toBeFalse();
        host.remove();
    });

    test("applies recent-first pins, unread badges, and Streamer-Mode-only server hiding", async () => {
        const host = document.createElement("div");
        host.innerHTML = `<nav data-list-id="private-channels"><div class="channel_dm-one"><a href="/channels/@me/111">One</a></div><div class="channel_dm-two"><a href="/channels/@me/112">Two</a></div></nav><nav data-list-id="guildsnav"><li class="guild"><a href="/channels/222">Guild</a></li></nav>`;
        document.body.append(host);
        let streamerMode = false;
        let streamerListener: (() => void) | undefined;
        let released = false;
        const scope = new SolcordDisposalScope();
        const controller = new SolcordNativeSuiteController(scope, {PinDMs: true, ServerHider: true}, {
            peopleState: {pinnedDmIds: ["111", "112"], hiddenGuildIds: ["222"], guildAliases: {}, favoriteFriendIds: [], hiddenFriendIds: []},
            peoplePreferences: {showRelationshipDates: true, showMutualGuildCounts: true, pinIcon: false, pinUnreadAmount: true, pinChannelAmount: true, sortPinnedByRecent: true, serverHiderStreamOnly: true, pinCategories: {friends: true, groups: true, bots: true, blocked: true, others: true}},
            dmUnreadCount: id => id === "112" ? 4 : 0,
            dmLastMessageTimestamp: id => id === "112" ? 2 : 1,
            dmCategory: () => "friends",
            streamerModeActive: () => streamerMode,
            subscribeStreamerMode: listener => {streamerListener = listener; return () => {released = true;};}
        });
        controller.start();
        controllers.push({controller, scope});
        const one = host.querySelector<HTMLElement>(".channel_dm-one")!;
        const two = host.querySelector<HTMLElement>(".channel_dm-two")!;
        const guild = host.querySelector<HTMLElement>(".guild")!;
        expect(two.style.order).toBe("-1000");
        expect(one.style.order).toBe("-999");
        expect(two.dataset.solcordPinnedUnread).toBe("4");
        expect(two.dataset.solcordPinIcon).toBe("false");
        expect(two.dataset.solcordPinnedCategoryLabel).toBe("Friends");
        expect(two.dataset.solcordPinnedCategoryFirst).toBe("true");
        expect(guild.style.display).not.toBe("none");
        streamerMode = true;
        streamerListener?.();
        await Promise.resolve();
        expect(guild.style.display).toBe("none");
        controller.dispose();
        scope.dispose();
        expect(released).toBeTrue();
        host.remove();
    });

    test("shows loaded Channel Glance content on hover without fetching or marking read", () => {
        const channel = document.createElement("a");
        channel.href = "/channels/@me/333";
        channel.textContent = "Loaded DM";
        document.body.append(channel);
        const scope = new SolcordDisposalScope();
        let reads = 0;
        const controller = new SolcordNativeSuiteController(scope, {MessagePeek: true}, {
            loadedChannelMessages: id => {
                reads++;
                expect(id).toBe("333");
                return [{id: "444", authorLabel: "Ada", text: "already loaded", timestamp: 1_700_000_000_000}];
            }
        });
        controller.start();
        controllers.push({controller, scope});

        channel.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
        expect(document.querySelector("[data-solcord-channel-glance]")?.textContent).toContain("already loaded");
        expect(reads).toBe(1);
        expect(controller.providerReady("MessagePeek")).toBeTrue();
        channel.dispatchEvent(new MouseEvent("mouseout", {bubbles: true}));
        expect(document.querySelector("[data-solcord-channel-glance]")).toBeNull();

        controller.dispose();
        scope.dispose();
        channel.remove();
    });

    test("renders call duration, speaking presence, and loaded viewer labels only for validated providers", () => {
        const panels = document.createElement("div");
        panels.className = "panels_test";
        const member = document.createElement("div");
        member.dataset.userId = "555";
        document.body.append(panels, member);
        const scope = new SolcordDisposalScope();
        const controller = new SolcordNativeSuiteController(scope, {CallTimeCounter: true, VoiceActivity: true, ShowSpectators: true}, {
            currentCall: () => ({
                channelId: "777",
                connectedAt: Date.now() - 5_000,
                participantCount: 2,
                speakerCount: 1,
                viewerCount: 1,
                participantIds: ["555", "666"],
                speakerIds: ["555"],
                viewerLabels: ["Viewer One"]
            }),
            subscribeCall: () => () => {},
            voiceActivityAvailable: true,
            spectatorsAvailable: true,
            spectatorsReady: () => true
        });
        controller.start();
        controllers.push({controller, scope});

        expect(panels.querySelector("[data-solcord-call-badge]")?.textContent).toContain("Viewer One");
        expect(panels.querySelector("[data-solcord-call-badge]")?.textContent).toMatch(/00:00:0[45]/);
        expect(member.querySelector("[data-solcord-voice-presence='speaking']")?.textContent).toBe("Speaking");
        expect(controller.providerReady("CallTimeCounter")).toBeTrue();
        expect(controller.providerReady("VoiceActivity")).toBeTrue();
        expect(controller.providerReady("ShowSpectators")).toBeTrue();
        expect(controller.statuses().find(item => item.id === "call-context")?.maturity).toBe("ready");

        controller.dispose();
        scope.dispose();
        expect(member.querySelector("[data-solcord-voice-presence]")).toBeNull();
        panels.remove();
        member.remove();
    });

    test("treats validated idle Call Context as ready and reserves degraded for adapter drift", () => {
        const readyScope = new SolcordDisposalScope();
        const ready = new SolcordNativeSuiteController(readyScope, {CallTimeCounter: true, VoiceActivity: true, ShowSpectators: true}, {
            currentCall: () => undefined,
            subscribeCall: () => () => {},
            voiceActivityAvailable: true,
            spectatorsAvailable: true,
            spectatorsReady: () => false
        });
        ready.start();
        controllers.push({controller: ready, scope: readyScope});
        expect(ready.statuses().find(item => item.id === "call-context")).toEqual(expect.objectContaining({
            maturity: "ready",
            detail: expect.stringContaining("connect to a call")
        }));

        const driftedScope = new SolcordDisposalScope();
        const drifted = new SolcordNativeSuiteController(driftedScope, {VoiceActivity: true}, {
            currentCall: () => undefined,
            subscribeCall: () => () => {},
            voiceActivityAvailable: false
        });
        drifted.start();
        controllers.push({controller: drifted, scope: driftedScope});
        expect(drifted.statuses().find(item => item.id === "call-context")).toEqual(expect.objectContaining({
            maturity: "degraded",
            detail: expect.stringContaining("could not validate")
        }));
    });

    test("honors Voice Activity surface and current-user choices", () => {
        const member = document.createElement("div");
        member.dataset.userId = "555";
        member.className = "membersWrap_test";
        document.body.append(member);
        const scope = new SolcordDisposalScope();
        const controller = new SolcordNativeSuiteController(scope, {VoiceActivity: true}, {
            currentCall: () => ({channelId: "777", connectedAt: Date.now(), participantCount: 1, speakerCount: 1, viewerCount: 0, participantIds: ["555"], speakerIds: ["555"]}),
            subscribeCall: () => () => {},
            voiceActivityAvailable: true,
            voiceActivityCurrentUserId: "555",
            voiceActivityPreferences: {memberList: true, dmList: true, peopleList: true, highlightCurrentChannel: true, statusIcons: true, currentUser: false}
        });
        controller.start();
        controllers.push({controller, scope});
        expect(scope.counts().observer).toBe(1);
        expect(member.querySelector("[data-solcord-voice-presence]")).toBeNull();
        member.remove();
    });

    test("keeps voice-presence nodes stable when the call store repeats the same state", () => {
        const member = document.createElement("div");
        member.dataset.userId = "555";
        member.className = "membersWrap_test";
        document.body.append(member);
        let notify: (() => void) | undefined;
        const scope = new SolcordDisposalScope();
        const controller = new SolcordNativeSuiteController(scope, {VoiceActivity: true}, {
            currentCall: () => ({channelId: "777", connectedAt: Date.now(), participantCount: 1, speakerCount: 1, viewerCount: 0, participantIds: ["555"], speakerIds: ["555"]}),
            subscribeCall: listener => {notify = listener; return () => {};},
            voiceActivityAvailable: true
        });
        controller.start();
        controllers.push({controller, scope});

        const badge = member.querySelector("[data-solcord-voice-presence]");
        expect(badge).not.toBeNull();
        notify?.();
        notify?.();
        expect(member.querySelector("[data-solcord-voice-presence]")).toBe(badge);
        member.remove();
    });

    test("keeps account-local voice ignore rules encrypted with People state and removes indicators immediately", () => {
        const member = document.createElement("div");
        member.dataset.userId = "555";
        member.className = "membersWrap_test";
        document.body.append(member);
        const saved: unknown[] = [];
        const scope = new SolcordDisposalScope();
        const controller = new SolcordNativeSuiteController(scope, {VoiceActivity: true, PinDMs: true}, {
            currentCall: () => ({channelId: "777", connectedAt: Date.now(), participantCount: 1, speakerCount: 1, viewerCount: 0, participantIds: ["555"], speakerIds: ["555"]}),
            currentVoiceContext: () => ({channelId: "777", guildId: "888"}),
            subscribeCall: () => () => {},
            voiceActivityAvailable: true,
            peopleState: {pinnedDmIds: [], hiddenGuildIds: [], guildAliases: {}, favoriteFriendIds: [], hiddenFriendIds: [], ignoredVoiceChannelIds: ["777"], ignoredVoiceGuildIds: []},
            savePeopleState: state => saved.push(structuredClone(state))
        });
        controller.start();
        controllers.push({controller, scope});
        expect(scope.counts().observer).toBe(1);
        expect(member.querySelector("[data-solcord-voice-presence]")).toBeNull();
        controller.includeVoiceChannel("777");
        expect(member.querySelector("[data-solcord-voice-presence='speaking']")).not.toBeNull();
        controller.ignoreVoiceGuild("888");
        expect(member.querySelector("[data-solcord-voice-presence]")).toBeNull();
        expect(saved.at(-1)).toMatchObject({ignoredVoiceChannelIds: [], ignoredVoiceGuildIds: ["888"]});
        member.remove();
    });

    test("saves a reviewed voice note locally and clears retained media only after the handoff succeeds", async () => {
        const capture = testStream();
        installVoiceRuntime(async () => capture.stream);
        const saved: File[] = [];
        const scope = new SolcordDisposalScope();
        const controller = new SolcordNativeSuiteController(scope, {VoiceMessages: true}, {saveVoiceNoteFile: file => saved.push(file)});
        controller.start();
        controllers.push({controller, scope});

        const recording = await controller.beginVoiceNoteFromUserGesture();
        TestMediaRecorder.instances.at(-1)!.emitData(new Blob(["voice"]));
        await controller.stopVoiceNoteForPreview();
        controller.saveReviewedVoiceNoteFile();

        expect(saved).toHaveLength(1);
        expect(saved[0].name).toMatch(/^Solcord-voice-note-[a-z0-9]+\.webm$/);
        expect(saved[0].type).toBe("audio/webm");
        expect(controller.voiceNoteBlob(recording.recordingId)).toBeUndefined();
        expect(capture.track.stopCount).toBe(1);
    });

    test("uses a generic local voice-note filename when minimal metadata is selected", async () => {
        const capture = testStream();
        installVoiceRuntime(async () => capture.stream);
        const saved: File[] = [];
        const scope = new SolcordDisposalScope();
        const controller = new SolcordNativeSuiteController(scope, {VoiceMessages: true}, {saveVoiceNoteFile: file => saved.push(file), voiceNotePreferences: {downloadButton: false, stripMetadata: true}});
        controller.start();
        controllers.push({controller, scope});
        await controller.beginVoiceNoteFromUserGesture();
        TestMediaRecorder.instances.at(-1)!.emitData(new Blob(["voice"]));
        await controller.stopVoiceNoteForPreview();
        controller.saveReviewedVoiceNoteFile();
        expect(saved[0].name).toBe("voice-note.webm");
    });

    test("bounds ambient Discord Effects and removes every owned particle", () => {
        const scope = new SolcordDisposalScope();
        const controller = new SolcordNativeSuiteController(scope, {DiscordEffects: true}, {motionPreferences: {effect: "rain", particleCount: 99, color: "#abcdef", opacityPercent: 65, speedPercent: 200, starAngleDegrees: 12, surfaces: {messages: true, channels: true, servers: true, members: true, modals: true, popouts: true, settings: true, tooltips: true, threads: true}}});
        controller.start();
        controllers.push({controller, scope});
        const effect = document.querySelector<HTMLElement>("[data-solcord-ambient-effect]");
        expect(effect?.dataset.effect).toBe("rain");
        expect(effect?.style.zIndex).toBe("0");
        expect(effect?.querySelectorAll("span")).toHaveLength(24);
        expect(effect?.style.getPropertyValue("--solcord-effect-color")).toBe("#abcdef");
        expect(effect?.style.getPropertyValue("--solcord-effect-opacity")).toBe("0.65");
        expect(effect?.querySelector<HTMLElement>("span")?.style.animationDuration).toBe("0.60s");
        controller.dispose();
        scope.dispose();
        expect(document.querySelector("[data-solcord-ambient-effect]")).toBeNull();
    });

    test("mounts the owner-approved SOL flow canvas and cancels paced work on teardown", () => {
        const originalContext = HTMLCanvasElement.prototype.getContext;
        const originalFrame = globalThis.requestAnimationFrame;
        const originalCancel = globalThis.cancelAnimationFrame;
        const originalTimeout = globalThis.setTimeout;
        const originalClearTimeout = globalThis.clearTimeout;
        let nextFrame: FrameRequestCallback | undefined;
        let nextTimer: (() => void) | undefined;
        let strokes = 0;
        let cancelled = 0;
        let cleared = 0;
        const context = {
            globalAlpha: 1,
            globalCompositeOperation: "source-over",
            fillStyle: "",
            strokeStyle: "",
            lineWidth: 1,
            setTransform() {},
            save() {},
            restore() {},
            fillRect() {},
            beginPath() {},
            moveTo() {},
            quadraticCurveTo() {},
            stroke() {strokes++;}
        } as unknown as CanvasRenderingContext2D;
        HTMLCanvasElement.prototype.getContext = (() => context) as unknown as typeof HTMLCanvasElement.prototype.getContext;
        globalThis.requestAnimationFrame = callback => {nextFrame = callback; return 17;};
        globalThis.cancelAnimationFrame = handle => {if (handle === 17) cancelled++;};
        globalThis.setTimeout = ((callback: TimerHandler) => {nextTimer = callback as () => void; return 23;}) as typeof globalThis.setTimeout;
        globalThis.clearTimeout = ((handle: number) => {if (handle === 23) cleared++;}) as typeof globalThis.clearTimeout;
        try {
            const scope = new SolcordDisposalScope();
            const controller = new SolcordNativeSuiteController(scope, {DiscordEffects: true}, {motionPreferences: {effect: "field", particleCount: 10, color: "#abcdef", opacityPercent: 38, speedPercent: 100, starAngleDegrees: 0, surfaces: {messages: true, channels: true, servers: true, members: true, modals: true, popouts: true, settings: true, tooltips: true, threads: true}}});
            controller.start();
            controllers.push({controller, scope});
            const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-solcord-ambient-effect][data-effect='field']");
            expect(canvas).not.toBeNull();
            expect(canvas?.style.zIndex).toBe("0");
            nextTimer?.();
            nextFrame?.(48);
            expect(strokes).toBeGreaterThan(0);
            controller.dispose();
            scope.dispose();
            expect(canvas?.isConnected).toBeFalse();
            expect(cancelled + cleared).toBeGreaterThan(0);
        }
        finally {
            HTMLCanvasElement.prototype.getContext = originalContext;
            globalThis.requestAnimationFrame = originalFrame;
            globalThis.cancelAnimationFrame = originalCancel;
            globalThis.setTimeout = originalTimeout;
            globalThis.clearTimeout = originalClearTimeout;
        }
    });

    test("mounts the owner-site Work Field with paced work and complete teardown", () => {
        const originalContext = HTMLCanvasElement.prototype.getContext;
        const originalFrame = globalThis.requestAnimationFrame;
        const originalCancel = globalThis.cancelAnimationFrame;
        const originalTimeout = globalThis.setTimeout;
        const originalClearTimeout = globalThis.clearTimeout;
        let nextFrame: FrameRequestCallback | undefined;
        let nextTimer: (() => void) | undefined;
        let glyphs = 0;
        let cancelled = 0;
        let cleared = 0;
        const context = {
            font: "",
            textAlign: "start",
            textBaseline: "alphabetic",
            fillStyle: "",
            clearRect() {},
            fillText() {glyphs++;}
        } as unknown as CanvasRenderingContext2D;
        HTMLCanvasElement.prototype.getContext = (() => context) as unknown as typeof HTMLCanvasElement.prototype.getContext;
        globalThis.requestAnimationFrame = callback => {nextFrame = callback; return 19;};
        globalThis.cancelAnimationFrame = handle => {if (handle === 19) cancelled++;};
        globalThis.setTimeout = ((callback: TimerHandler) => {nextTimer = callback as () => void; return 29;}) as typeof globalThis.setTimeout;
        globalThis.clearTimeout = ((handle: number) => {if (handle === 29) cleared++;}) as typeof globalThis.clearTimeout;
        try {
            const scope = new SolcordDisposalScope();
            const controller = new SolcordNativeSuiteController(scope, {DiscordEffects: true}, {motionPreferences: {effect: "work-field", particleCount: 10, color: "#abcdef", opacityPercent: 38, speedPercent: 100, starAngleDegrees: 0, surfaces: {messages: true, channels: true, servers: true, members: true, modals: true, popouts: true, settings: true, tooltips: true, threads: true}}});
            controller.start();
            controllers.push({controller, scope});
            const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-solcord-ambient-effect][data-effect='work-field']");
            expect(canvas).not.toBeNull();
            expect(canvas?.style.zIndex).toBe("0");
            expect(glyphs).toBeGreaterThan(0);
            nextTimer?.();
            nextFrame?.(96);
            controller.dispose();
            scope.dispose();
            expect(canvas?.isConnected).toBeFalse();
            expect(cancelled + cleared).toBeGreaterThan(0);
        }
        finally {
            HTMLCanvasElement.prototype.getContext = originalContext;
            globalThis.requestAnimationFrame = originalFrame;
            globalThis.cancelAnimationFrame = originalCancel;
            globalThis.setTimeout = originalTimeout;
            globalThis.clearTimeout = originalClearTimeout;
        }
    });

    test("bounds Ember Drift particles and removes the background on teardown", () => {
        const scope = new SolcordDisposalScope();
        const controller = new SolcordNativeSuiteController(scope, {DiscordEffects: true}, {motionPreferences: {effect: "embers", particleCount: 99, color: "#ff755f", opacityPercent: 48, speedPercent: 125, starAngleDegrees: 0, surfaces: {messages: true, channels: true, servers: true, members: true, modals: true, popouts: true, settings: true, tooltips: true, threads: true}}});
        controller.start();
        controllers.push({controller, scope});
        const effect = document.querySelector<HTMLElement>("[data-solcord-ambient-effect][data-effect='embers']");
        expect(effect?.querySelectorAll("span")).toHaveLength(24);
        expect(effect?.querySelector<HTMLElement>("span")?.style.getPropertyValue("--solcord-ember-drift")).toEndWith("px");
        controller.dispose();
        scope.dispose();
        expect(effect?.isConnected).toBeFalse();
    });

    test("applies Better Animations only to explicitly selected surfaces", () => {
        const scope = new SolcordDisposalScope();
        const controller = new SolcordNativeSuiteController(scope, {BetterAnimations: true}, {motionPreferences: {effect: "off", particleCount: 1, color: "#abcdef", opacityPercent: 40, speedPercent: 100, starAngleDegrees: 0, surfaces: {messages: false, channels: true, servers: false, members: false, modals: true, popouts: false, settings: false, tooltips: true, threads: false}}});
        controller.start();
        controllers.push({controller, scope});
        const css = document.getElementById("solcord-native-motion")?.textContent ?? "";
        expect(css).toContain("channels___");
        expect(css).toContain("role='dialog'");
        expect(css).toContain("role='tooltip'");
        expect(css).not.toContain("chat-messages-");
        expect(css).not.toContain("guildsnav___");
        expect(css).not.toContain("threadSidebar_");
    });

    test("consumes translation JSON through a hard streamed-byte limit", async () => {
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(encoder.encode("{\"translated"));
                controller.enqueue(encoder.encode("Text\":\"hola\"}"));
                controller.close();
            }
        });
        await expect(readBoundedTranslationJson(new Response(body))).resolves.toEqual({translatedText: "hola"});

        const oversized = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array(SOLCORD_TRANSLATION_RESPONSE_MAX_BYTES + 1));
                controller.close();
            }
        });
        await expect(readBoundedTranslationJson(new Response(oversized, {headers: {"content-length": "1"}}))).rejects.toThrow("one MiB limit");
        await expect(readBoundedTranslationJson(new Response("{}", {headers: {"content-length": String(SOLCORD_TRANSLATION_RESPONSE_MAX_BYTES + 1)}}))).rejects.toThrow("one MiB limit");
    });

    test("blocks external translation traffic under Strict Privacy and permits only the reviewed approved path", async () => {
        let fetchCalls = 0;
        globalThis.fetch = (async () => {
            fetchCalls++;
            return new Response(JSON.stringify({translatedText: "hola"}), {status: 200, headers: {"content-type": "application/json"}});
        }) as unknown as typeof fetch;

        const blockedScope = new SolcordDisposalScope();
        const blocked = new SolcordNativeSuiteController(blockedScope, {Translator: true}, {externalProvidersAllowed: () => false});
        blocked.start();
        controllers.push({controller: blocked, scope: blockedScope});
        const blockedPreview = blocked.previewTranslation("libretranslate", "https://translate.example/v1", "en", "es", "hello");
        await expect(blocked.executeReviewedTranslation(blockedPreview.id)).rejects.toThrow("Strict Privacy blocks external translation providers");
        expect(fetchCalls).toBe(0);

        const allowedScope = new SolcordDisposalScope();
        const allowed = new SolcordNativeSuiteController(allowedScope, {Translator: true}, {externalProvidersAllowed: () => true});
        allowed.start();
        controllers.push({controller: allowed, scope: allowedScope});
        const allowedPreview = allowed.previewTranslation("libretranslate", "https://translate.example/v1", "en", "es", "hello");
        await expect(allowed.executeReviewedTranslation(allowedPreview.id)).resolves.toBe("hola");
        expect(fetchCalls).toBe(1);
    });

    test("cleans failed permission, recorder construction, and recorder start attempts before retry", async () => {
        const denied = testStream();
        const constructed = testStream();
        const failedStart = testStream();
        const retry = testStream();
        let attempt = 0;
        installVoiceRuntime(async () => {
            attempt++;
            if (attempt === 1) throw new Error("permission denied");
            if (attempt === 2) return constructed.stream;
            if (attempt === 3) return failedStart.stream;
            return retry.stream;
        });
        const controller = startController();

        await expect(controller.beginVoiceNoteFromUserGesture()).rejects.toThrow("permission denied");
        expect(denied.track.stopCount).toBe(0);

        TestMediaRecorder.failConstruction = true;
        await expect(controller.beginVoiceNoteFromUserGesture()).rejects.toThrow("constructor failed");
        expect(constructed.track.stopCount).toBe(1);

        TestMediaRecorder.failConstruction = false;
        TestMediaRecorder.failStart = true;
        await expect(controller.beginVoiceNoteFromUserGesture()).rejects.toThrow("start failed");
        expect(failedStart.track.stopCount).toBe(1);

        TestMediaRecorder.failStart = false;
        await expect(controller.beginVoiceNoteFromUserGesture()).resolves.toHaveProperty("recordingId");
        controller.cancelVoiceNote();
        expect(retry.track.stopCount).toBe(1);
    });

    test("cancels a pending permission prompt without letting its late result clear a retry", async () => {
        const late = testStream();
        const retry = testStream();
        let resolvePrompt!: (stream: MediaStream) => void;
        let attempt = 0;
        installVoiceRuntime(() => {
            attempt++;
            return attempt === 1 ? new Promise(resolve => {resolvePrompt = resolve;}) : Promise.resolve(retry.stream);
        });
        const controller = startController();

        const pending = controller.beginVoiceNoteFromUserGesture();
        controller.cancelVoiceNote();
        const current = await controller.beginVoiceNoteFromUserGesture();
        resolvePrompt(late.stream);
        await expect(pending).rejects.toThrow("permission request was canceled");
        expect(late.track.stopCount).toBe(1);

        controller.cancelVoiceNote();
        expect(retry.track.stopCount).toBe(1);
        expect(controller.voiceNoteBlob(current.recordingId)).toBeUndefined();
    });

    test("publishes truthful voice-note phases through preview and cancel", async () => {
        const capture = testStream();
        let resolvePrompt!: (stream: MediaStream) => void;
        installVoiceRuntime(() => new Promise(resolve => {resolvePrompt = resolve;}));
        const controller = startController();
        const phases = [controller.voiceNotePhase()];
        const unsubscribe = controller.subscribeVoiceNotePhase(phase => phases.push(phase));

        const pending = controller.beginVoiceNoteFromUserGesture();
        expect(controller.voiceNotePhase()).toBe("requesting-permission");
        resolvePrompt(capture.stream);
        await pending;
        expect(controller.voiceNotePhase()).toBe("recording");

        TestMediaRecorder.instances.at(-1)!.emitData(new Blob(["voice"]));
        const preview = controller.stopVoiceNoteForPreview();
        expect(controller.voiceNotePhase()).toBe("processing");
        await preview;
        expect(controller.voiceNotePhase()).toBe("preview-ready");
        expect(controller.statuses().find(item => item.id === "voice-note-studio")?.maturity).toBe("ready");
        expect(controller.providerReady("VoiceMessages")).toBeTrue();

        controller.cancelVoiceNote();
        expect(controller.voiceNotePhase()).toBe("idle");
        expect(capture.track.stopCount).toBe(1);
        expect(phases).toEqual(expect.arrayContaining(["idle", "requesting-permission", "recording", "processing", "preview-ready"]));
        unsubscribe();
    });

    test("retains a reviewed voice note when Discord's upload handoff fails and permits an explicit retry", async () => {
        const capture = testStream();
        installVoiceRuntime(async () => capture.stream);
        let attempts = 0;
        const scope = new SolcordDisposalScope();
        const controller = new SolcordNativeSuiteController(scope, {VoiceMessages: true}, {
            prepareVoiceNoteUpload: () => {
                attempts++;
                if (attempts === 1) throw new Error("upload composer unavailable");
            }
        });
        controller.start();
        controllers.push({controller, scope});

        const recording = await controller.beginVoiceNoteFromUserGesture();
        TestMediaRecorder.instances.at(-1)!.emitData(new Blob(["voice"]));
        await controller.stopVoiceNoteForPreview();
        expect(() => controller.prepareReviewedVoiceNoteUpload("123456")).toThrow("upload composer unavailable");
        expect(controller.voiceNoteBlob(recording.recordingId)).toBeInstanceOf(Blob);
        expect(() => controller.prepareReviewedVoiceNoteUpload("123456")).not.toThrow();
        expect(attempts).toBe(2);
        expect(controller.voiceNoteBlob(recording.recordingId)).toBeUndefined();
        expect(capture.track.stopCount).toBe(1);
    });

    test("bounds a recorder that becomes inactive without emitting a stop event", async () => {
        const capture = testStream();
        installVoiceRuntime(async () => capture.stream);
        const controller = startController();
        await controller.beginVoiceNoteFromUserGesture();
        TestMediaRecorder.suppressStopEvent = true;
        const originalSetTimeout = globalThis.setTimeout;
        let watchdog: (() => void) | undefined;
        Object.defineProperty(globalThis, "setTimeout", {
            configurable: true,
            value: ((callback: TimerHandler, delay?: number) => {
                if (delay === SOLCORD_VOICE_NOTE_STOP_TIMEOUT_MS) {
                    watchdog = callback as () => void;
                    return 2;
                }
                return originalSetTimeout(callback, delay);
            }) as typeof globalThis.setTimeout
        });
        try {
            const pending = controller.stopVoiceNoteForPreview();
            expect(watchdog).toBeFunction();
            watchdog!();
            await expect(pending).rejects.toThrow("did not finish stopping");
            expect(capture.track.stopCount).toBe(1);
        }
        finally {Object.defineProperty(globalThis, "setTimeout", {configurable: true, writable: true, value: originalSetTimeout});}
    });

    test("aborts and releases capture at the byte and duration boundaries", async () => {
        const oversized = testStream();
        const timedOut = testStream();
        const streams = [oversized.stream, timedOut.stream];
        installVoiceRuntime(async () => streams.shift()!);
        const controller = startController();

        await controller.beginVoiceNoteFromUserGesture();
        TestMediaRecorder.instances.at(-1)!.emitData({size: SOLCORD_VOICE_NOTE_MAX_BYTES + 1} as Blob);
        expect(oversized.track.stopCount).toBe(1);
        await expect(controller.stopVoiceNoteForPreview()).rejects.toThrow("No voice-note recording");

        const originalSetTimeout = globalThis.setTimeout;
        let limitCallback: (() => void) | undefined;
        Object.defineProperty(globalThis, "setTimeout", {
            configurable: true,
            value: ((callback: TimerHandler, delay?: number) => {
                if (delay === SOLCORD_VOICE_NOTE_MAX_DURATION_MS) {
                    limitCallback = callback as () => void;
                    return 1;
                }
                return originalSetTimeout(callback, delay);
            }) as typeof globalThis.setTimeout
        });
        try {
            await controller.beginVoiceNoteFromUserGesture();
            expect(limitCallback).toBeFunction();
            limitCallback!();
            expect(timedOut.track.stopCount).toBe(1);
            await expect(controller.stopVoiceNoteForPreview()).rejects.toThrow("No voice-note recording");
        }
        finally {Object.defineProperty(globalThis, "setTimeout", {configurable: true, writable: true, value: originalSetTimeout});}
    });
});
