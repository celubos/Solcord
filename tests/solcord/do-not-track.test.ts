// SPDX-License-Identifier: Apache-2.0

import {describe, expect, test} from "bun:test";

import {
    DoNotTrackAdapter,
    discordAnalyticsMethods,
    resolveDiscordAnalyticsTrack,
    type AnalyticsMethodTarget,
    type AnalyticsMethodSpec,
    type AnalyticsPatchCallback,
    type DoNotTrackPatchAdapter,
    type DoNotTrackSettings,
    validateDiscordAnalyticsTrack
} from "../../src/betterdiscord/modules/solcord/do-not-track";
import {SolcordDisposalScope} from "../../src/betterdiscord/modules/solcord/disposal";
import {SolcordPrivacyPolicyAdapter} from "../../src/betterdiscord/modules/solcord/privacy-policy";
import {applyPrivacyProfile, defaultStrictPrivacyPreferences} from "../../src/common/solcord/privacy";


type AnalyticsModule = Record<string, unknown> & {
    track(event: string, properties?: unknown): unknown;
    trackWithMetadata(event: string, properties?: unknown): unknown;
    sendMessage(channelId: string, content: string): unknown;
    reportCrash(error: Error): unknown;
};

function createHarness(initial: DoNotTrackSettings = {enabled: true}) {
    const calls = {
        track: [] as unknown[][],
        metadata: [] as unknown[][],
        messages: [] as unknown[][],
        crashes: [] as unknown[][],
        patches: [] as string[],
        unpatches: [] as string[],
        validations: [] as string[]
    };
    const originals = {
        track(this: unknown, ...args: unknown[]) {
            calls.track.push([this, ...args]);
            return `track:${String(args[0])}`;
        },
        trackWithMetadata(this: unknown, ...args: unknown[]) {
            calls.metadata.push([this, ...args]);
            return `metadata:${String(args[0])}`;
        },
        sendMessage(...args: unknown[]) {
            calls.messages.push(args);
            return `sent:${String(args[1])}`;
        },
        reportCrash(...args: unknown[]) {
            calls.crashes.push(args);
            return "reported";
        }
    };
    const module: AnalyticsModule = {...originals};
    const patcher: DoNotTrackPatchAdapter = {
        instead(_caller, target, key, callback: AnalyticsPatchCallback) {
            calls.patches.push(key);
            const original = target[key] as (...args: unknown[]) => unknown;
            const patched = function (this: unknown, ...args: unknown[]) {
                return callback(this, args, original);
            };
            target[key] = patched;
            return () => {
                if (target[key] !== patched) return;
                calls.unpatches.push(key);
                target[key] = original;
            };
        }
    };
    const methods: AnalyticsMethodSpec[] = ["track", "trackWithMetadata"].map(key => ({
        key,
        lookup: () => ({module, key}),
        validate: target => {
            calls.validations.push(key);
            return target.module === module && target.key === key;
        }
    }));
    const scope = new SolcordDisposalScope();
    let settings: unknown = initial;
    const adapter = new DoNotTrackAdapter({scope, patcher, methods, getSettings: () => settings});
    return {
        adapter,
        calls,
        methods,
        module,
        originals,
        patcher,
        scope,
        setSettings: (next: unknown) => {settings = next;}
    };
}

function currentAnalyticsContainer(analytics: Record<string, unknown>, metadata = typeof analytics.trackWithMetadata === "function" ? analytics.trackWithMetadata : () => "metadata") {
    Object.assign(analytics, {expandEventProperties() {}, setSystemAccessibilityFeatures() {}});
    const container = {
        "lG": {
            app_opened: {throttlePeriod: 300_000, throttleKeys: () => []},
            app_background: {throttlePeriod: 120_000, throttleKeys: () => []}
        },
        addExtraAnalyticsDecorator() {},
        "default": analytics
    };
    Object.defineProperty(container, "M$", {enumerable: true, get: () => metadata});
    return container;
}

function convergenceHarness() {
    const harness = createHarness();
    const emitted: unknown[] = [];
    const pending: Array<Promise<void>> = [];
    let sequence = 0;
    const handlers = {
        handleConnectionOpen() {},
handleConnectionClosed() {},
handleFingerprint() {},
handleSetAnalyticsToken() {},
        handleTrack(action: {event: string; properties: unknown; resolve(): void;}) {
            emitted.push({event: action.event, properties: action.properties, client_track_timestamp: Date.now(), client_heartbeat_session_id: "synthetic", event_sequence_number: ++sequence});
            action.resolve();
            return false;
        }
    };
    const dispatch = (event: string, properties: unknown) => {
        const promise = new Promise<void>(resolve => {handlers.handleTrack({event, properties, resolve});});
        pending.push(promise);
        return promise;
    };
    const analytics = {
        trackMaker() {return dispatch;},
analyticsTrackingStoreMaker() {},
AnalyticsActionHandlers: handlers,
        track(event: string, properties: unknown) {return dispatch(event, properties);}
    };
    const metadata = (event: string, properties: unknown) => {void dispatch(event, properties);};
    const container = currentAnalyticsContainer(analytics, metadata);
    return {harness, emitted, pending, handlers, analytics, container, metadata};
}

describe("Solcord Do Not Track adapter", () => {
    test("resolves only the anchored Discord analytics export and exact track method", () => {
        const analytics = {track() {return "sent";}};
        const container = {"AnalyticEventConfigs": {APP_OPENED: {}}, "default": analytics};
        const target = resolveDiscordAnalyticsTrack(container);
        expect(target).toEqual({module: analytics, key: "track"});
        expect(target && validateDiscordAnalyticsTrack(container, target)).toBeTrue();

        expect(resolveDiscordAnalyticsTrack({"default": analytics})).toBeUndefined();
        expect(resolveDiscordAnalyticsTrack({"AnalyticEventConfigs": {}, "default": {send() {}}})).toBeUndefined();
        expect(target && validateDiscordAnalyticsTrack({...container, "default": {track() {}}}, target)).toBeFalse();
    });

    test("resolves the current coexisting mangled config table and exact default track export", () => {
        const analytics = {track() {return "synthetic";}};
        const container = currentAnalyticsContainer(analytics);
        const resolved = resolveDiscordAnalyticsTrack(container);
        expect(resolved).toEqual({module: analytics, key: "track"});
        expect(resolved && validateDiscordAnalyticsTrack(container, resolved)).toBeTrue();
        expect(resolved && validateDiscordAnalyticsTrack({...container, "default": {...analytics}}, resolved)).toBeFalse();
    });

    test("rejects unrelated track methods, decorative anchors, malformed tables and drifting coexports", () => {
        const container = currentAnalyticsContainer({track() {}});
        for (const candidate of [
            {track() {}},
            {"default": container.default},
            {"default": container.default, addExtraAnalyticsDecorator() {}},
            {...container, lG: {unrelated: {throttlePeriod: 300_000, throttleKeys() {}}}},
            {...container, lG: {...container.lG, app_opened: {throttlePeriod: 1, throttleKeys() {}}}},
            {...container, lG: {...container.lG, app_background: {throttlePeriod: 120_000, throttleKeys: []}}},
            {...container, addExtraAnalyticsDecorator: undefined},
            {...container, "default": {...container.default, expandEventProperties: undefined}},
            {...container, "default": {...container.default, setSystemAccessibilityFeatures: undefined}},
            {...container, "default": {...container.default, track: "track"}},
            new Proxy({}, {get() {throw Error("Lazy export unavailable");}})
        ]) expect(resolveDiscordAnalyticsTrack(candidate)).toBeUndefined();
    });

    test("the production privacy adapter reports partial coverage when the initialized common queue is unavailable", async () => {
        const harness = createHarness();
        const container = currentAnalyticsContainer(harness.module);
        let preferences = defaultStrictPrivacyPreferences();
        const adapter = new SolcordPrivacyPolicyAdapter({
            scope: harness.scope,
            patcher: harness.patcher,
            preferences: () => preferences,
            receipt() {},
            specs: discordAnalyticsMethods(container).map(method => ({
                id: `discord-analytics-${method.key}`,
dataClass: "telemetry" as const,
key: method.key,
                lookup: () => (method.lookup() as AnalyticsMethodTarget | undefined)?.module,
                validate: method.validate,
                blockedValue: method.blockedValue ?? (() => undefined)
            }))
        });
        expect(adapter.start()).toContainEqual({dataClass: "telemetry", state: "Degraded", summary: "1 of 2 validated surfaces blocked; the remainder drifted."});
        expect(Object.getOwnPropertyDescriptor(container, "M$")).toEqual(expect.objectContaining({configurable: false, set: undefined}));
        const opaque = new Proxy({}, {get() {throw Error("Payload must remain opaque");}});
        await expect(harness.module.track("SYNTHETIC", opaque)).resolves.toBeUndefined();
        expect(harness.calls.track).toHaveLength(0);
        expect(harness.calls.patches).toEqual(["track"]);
        preferences = applyPrivacyProfile(preferences, "standard", 42);
        const receiver = {track: harness.module.track};
        expect(receiver.track("CONTROL", opaque)).toBe("track:CONTROL");
        expect(harness.calls.track[0]).toEqual([receiver, "CONTROL", opaque]);
        expect(harness.module.sendMessage).toBe(harness.originals.sendMessage);
        expect(harness.module.reportCrash).toBe(harness.originals.reportCrash);
        harness.scope.dispose();
        expect(harness.module.track).toBe(harness.originals.track);
        expect(harness.calls.unpatches).toEqual(["track"]);
        expect(harness.scope.counts()).toEqual({});
    });

    test("standalone Do Not Track never reports full readiness after only one current emitter is patchable", () => {
        const harness = createHarness();
        const container = currentAnalyticsContainer(harness.module);
        const adapter = new DoNotTrackAdapter({scope: harness.scope, patcher: harness.patcher, methods: discordAnalyticsMethods(container), getSettings: () => ({enabled: true})});
        expect(adapter.start()).toBeFalse();
        expect(harness.calls.patches).toEqual([]);
        expect(harness.module.track).toBe(harness.originals.track);
    });

    test("standalone Do Not Track acknowledges both emitter paths without changing the immutable metadata export", async () => {
        const {harness, analytics, container, handlers, pending, emitted, metadata} = convergenceHarness();
        const originalTrack = analytics.track;
        const originalHandle = handlers.handleTrack;
        let enabled = true;
        const adapter = new DoNotTrackAdapter({scope: harness.scope, patcher: harness.patcher, methods: discordAnalyticsMethods(container), getSettings: () => ({enabled})});
        expect(adapter.start()).toBeTrue();
        await expect(analytics.track("SYNTHETIC", {})).resolves.toBeUndefined();
        expect((container as unknown as {M$(event: string, properties: unknown): unknown;}).M$("SYNTHETIC", {})).toBeUndefined();
        await Promise.all(pending);
        expect(emitted).toHaveLength(0);
        expect(harness.calls.patches).toEqual(["track", "handleTrack"]);
        expect((container as Record<string, unknown>).M$).toBe(metadata);
        enabled = false;
        await analytics.track("CONTROL", {});
        metadata("CONTROL", {}); await Promise.all(pending);
        expect(emitted).toHaveLength(2);
        adapter.stop();
        expect(analytics.track).toBe(originalTrack); expect(handlers.handleTrack).toBe(originalHandle);
        expect(harness.scope.counts()).toEqual({});
    });

    test("the production privacy policy settles both paths in Strict, forwards Standard and restores on teardown", async () => {
        const {harness, analytics, container, handlers, pending, emitted, metadata} = convergenceHarness();
        const originalTrack = analytics.track, originalHandle = handlers.handleTrack;
        let preferences = defaultStrictPrivacyPreferences();
        const adapter = new SolcordPrivacyPolicyAdapter({scope: harness.scope,
patcher: harness.patcher,
preferences: () => preferences,
receipt() {},
specs: discordAnalyticsMethods(container).map(method => ({
            id: `discord-analytics-${method.key}`,
dataClass: "telemetry" as const,
key: method.key,
            lookup: () => (method.lookup() as AnalyticsMethodTarget | undefined)?.module,
            validate: method.validate,
blockedValue: method.blockedValue ?? (() => undefined)
        }))});
        expect(adapter.start()).toContainEqual({dataClass: "telemetry", state: "Protected", summary: "2 validated optional emission surfaces blocked."});
        const opaque = new Proxy({}, {get() {throw Error("Do not inspect synthetic event properties");}});
        await analytics.track("SYNTHETIC", opaque).then(value => {expect(value).toBeUndefined();});
        metadata("SYNTHETIC", opaque); await Promise.all(pending);
        expect(emitted).toHaveLength(0);
        let completed = 0;
        const action = new Proxy({}, {get(_target, key) {if (key === "resolve") return () => completed++; throw Error("Only completion may be read");}});
        expect(handlers.handleTrack(action as Parameters<typeof handlers.handleTrack>[0])).toBeFalse();
        expect(completed).toBe(1);
        expect(harness.calls.patches).toEqual(["track", "handleTrack"]);
        preferences = applyPrivacyProfile(preferences, "standard", 42);
        await analytics.track("CONTROL", opaque); metadata("CONTROL", opaque); await Promise.all(pending);
        expect(emitted).toHaveLength(2);
        harness.scope.dispose();
        expect(analytics.track).toBe(originalTrack); expect(handlers.handleTrack).toBe(originalHandle);
        await analytics.track("RESTORED", {}); expect(emitted).toHaveLength(3);
        expect(harness.scope.counts()).toEqual({});
    });

    test("the dedicated queue requires current library identity, initialization markers and a writable descriptor", () => {
        for (const change of [
            (state: ReturnType<typeof convergenceHarness>) => {state.analytics.trackMaker = undefined as never;},
            (state: ReturnType<typeof convergenceHarness>) => {state.analytics.analyticsTrackingStoreMaker = undefined as never;},
            (state: ReturnType<typeof convergenceHarness>) => {state.handlers.handleTrack = (() => false) as never;},
            (state: ReturnType<typeof convergenceHarness>) => {Object.defineProperty(state.handlers, "handleTrack", {writable: false});}
        ]) {
            const state = convergenceHarness(); change(state);
            const methods = discordAnalyticsMethods(state.container);
            expect(methods.map(method => method.key)).toEqual(["track", "handleTrack"]);
            expect(methods[1].lookup()).toBeUndefined();
        }
    });

    test("suppresses every independently validated outgoing analytics method", () => {
        const {adapter, calls, module, scope} = createHarness();
        expect(adapter.start()).toBeTrue();

        expect(module.track("APP_OPENED", {"private": "opaque"})).toBeUndefined();
        expect(module.trackWithMetadata("VOICE_CONNECTED", {"private": "opaque"})).toBeUndefined();
        expect(calls.track).toEqual([]);
        expect(calls.metadata).toEqual([]);
        expect(calls.validations).toEqual(["track", "trackWithMetadata"]);
        expect(scope.counts()).toEqual({patch: 2});
    });

    test("preserves this, arguments, and return values while disabled", () => {
        const {adapter, calls, module} = createHarness({enabled: false});
        expect(adapter.start()).toBeTrue();

        const receiver = {track: module.track};
        const properties = {answer: 42};
        expect(receiver.track("CONTROL", properties)).toBe("track:CONTROL");
        expect(calls.track).toEqual([[receiver, "CONTROL", properties]]);
    });

    test("never patches unrelated message, crash, or unknown functions", () => {
        const {adapter, calls, module, originals} = createHarness();
        expect(adapter.start()).toBeTrue();

        expect(module.sendMessage).toBe(originals.sendMessage);
        expect(module.reportCrash).toBe(originals.reportCrash);
        expect(module.sendMessage("123", "hello")).toBe("sent:hello");
        expect(module.reportCrash(new Error("synthetic"))).toBe("reported");
        expect(calls.messages).toHaveLength(1);
        expect(calls.crashes).toHaveLength(1);
        expect(calls.patches).toEqual(["track", "trackWithMetadata"]);
    });

    test("fails open before patching when a lookup is malformed or validation fails", () => {
        const {calls, module, originals, patcher, scope} = createHarness();
        const adapter = new DoNotTrackAdapter({
            scope,
            patcher,
            methods: [
                {key: "track", lookup: () => ({module, key: "sendMessage"}), validate: () => true},
                {key: "trackWithMetadata", lookup: () => ({module, key: "trackWithMetadata"}), validate: () => false}
            ],
            getSettings: () => ({enabled: true})
        });

        expect(adapter.start()).toBeFalse();
        expect(calls.patches).toEqual([]);
        expect(module.track).toBe(originals.track);
        expect(module.trackWithMetadata).toBe(originals.trackWithMetadata);
    });

    test("rolls back an earlier method when a later patch cannot be installed", () => {
        const {calls, methods, module, originals, scope} = createHarness();
        const patcher: DoNotTrackPatchAdapter = {
            instead(_caller, target, key, callback) {
                calls.patches.push(key);
                if (key === "trackWithMetadata") return null;
                const original = target[key] as (...args: unknown[]) => unknown;
                const patched = function (this: unknown, ...args: unknown[]) {
                    return callback(this, args, original);
                };
                target[key] = patched;
                return () => {
                    calls.unpatches.push(key);
                    target[key] = original;
                };
            }
        };
        const adapter = new DoNotTrackAdapter({scope, patcher, methods, getSettings: () => ({enabled: true})});

        expect(adapter.start()).toBeFalse();
        expect(calls.patches).toEqual(["track", "trackWithMetadata"]);
        expect(calls.unpatches).toEqual(["track"]);
        expect(module.track).toBe(originals.track);
        expect(module.trackWithMetadata).toBe(originals.trackWithMetadata);
        expect(scope.counts()).toEqual({});
    });

    test("fails open at call time when settings drift or throw", () => {
        const {adapter, calls, module, setSettings} = createHarness();
        expect(adapter.start()).toBeTrue();

        setSettings({enabled: "yes"});
        expect(module.track("MALFORMED")).toBe("track:MALFORMED");
        setSettings(new Proxy({}, {get() {throw new Error("settings drift");}}));
        expect(module.trackWithMetadata("THROWN")).toBe("metadata:THROWN");
        expect(calls.track).toHaveLength(1);
        expect(calls.metadata).toHaveLength(1);
    });

    test("rejects empty, duplicate, oversized, and malformed method lists", () => {
        const {calls, module, patcher, scope} = createHarness();
        const spec = {key: "track", lookup: () => ({module, key: "track"}), validate: () => true};
        const cases: unknown[] = [
            [],
            [spec, spec],
            Array.from({length: 9}, (_, index) => ({...spec, key: `track${index}`})),
            [{...spec, key: "not a method"}]
        ];

        for (const methods of cases) {
            const adapter = new DoNotTrackAdapter({
                scope,
                patcher,
                methods: methods as AnalyticsMethodSpec[],
                getSettings: () => ({enabled: true})
            });
            expect(adapter.start()).toBeFalse();
        }
        expect(calls.patches).toEqual([]);
    });

    test("owns reversible cleanup and duplicate start is idempotent", () => {
        const {adapter, calls, module, originals, scope} = createHarness();
        expect(adapter.start()).toBeTrue();
        expect(adapter.start()).toBeTrue();
        expect(calls.patches).toEqual(["track", "trackWithMetadata"]);

        adapter.stop();
        adapter.stop();
        expect(adapter.active).toBeFalse();
        expect(calls.unpatches).toEqual(["trackWithMetadata", "track"]);
        expect(module.track).toBe(originals.track);
        expect(module.trackWithMetadata).toBe(originals.trackWithMetadata);
        expect(scope.counts()).toEqual({});

        expect(adapter.start()).toBeTrue();
        scope.dispose();
        expect(adapter.active).toBeFalse();
        expect(module.track).toBe(originals.track);
        expect(module.trackWithMetadata).toBe(originals.trackWithMetadata);
    });
});
