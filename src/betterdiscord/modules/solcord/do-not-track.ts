// SPDX-License-Identifier: Apache-2.0

import type {SolcordDisposalScope} from "./disposal";


const PATCH_CALLER = "Solcord~DoNotTrack";
const METHOD_KEY_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/;
const MAX_METHOD_COUNT = 8;

type AnalyticsEmitter = (...args: unknown[]) => unknown;

export interface DoNotTrackSettings {
    enabled: boolean;
}

export interface AnalyticsMethodTarget {
    module: Record<string, unknown>;
    key: string;
}

/**
 * One explicitly named analytics emission method and its independent proof.
 * Solcord never enumerates a module looking for additional methods.
 */
export interface AnalyticsMethodSpec {
    readonly key: string;
    lookup(): unknown;
    validate(target: AnalyticsMethodTarget): boolean;
    blockedValue?(thisObject: unknown, args: unknown[]): unknown;
}

export type AnalyticsPatchCallback = (
    thisObject: unknown,
    args: unknown[],
    original: AnalyticsEmitter
) => unknown;

export interface DoNotTrackPatchAdapter {
    instead(
        caller: string,
        module: Record<string, unknown>,
        key: string,
        callback: AnalyticsPatchCallback,
        options: {forcePatch: false;}
    ): (() => void) | null | undefined;
}

export interface DoNotTrackAdapterOptions {
    scope: SolcordDisposalScope;
    patcher: DoNotTrackPatchAdapter;
    methods: readonly AnalyticsMethodSpec[];
    getSettings(): unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return (typeof value === "object" && value !== null) || typeof value === "function";
}

function currentAnalyticsAnchor(container: Record<string, unknown>, analytics: Record<string, unknown>): boolean {
    const configs = container.lG;
    if (!isRecord(configs) || typeof container.addExtraAnalyticsDecorator !== "function"
        || typeof analytics.expandEventProperties !== "function" || typeof analytics.setSystemAccessibilityFeatures !== "function") return false;
    const opened = configs.app_opened;
    const background = configs.app_background;
    return isRecord(opened) && opened.throttlePeriod === 300_000 && typeof opened.throttleKeys === "function"
        && isRecord(background) && background.throttlePeriod === 120_000 && typeof background.throttleKeys === "function";
}

/**
 * Resolves only Discord's observed analytics export shapes. An event-config
 * anchor and the exact default.track method must coexist in one container;
 * callers must not fall back to enumerating arbitrary modules or methods.
 */
export function resolveDiscordAnalyticsTrack(container: unknown): AnalyticsMethodTarget | undefined {
    try {
        if (!isRecord(container) || !isRecord(container.default)) return;
        const analytics = container.default;
        if (typeof analytics.track !== "function") return;
        if (isRecord(container.AnalyticEventConfigs)) return {module: analytics, key: "track"};
        // Discord build 667580 exports its event table as lG. The same table
        // feeds trackMaker inside this module; these independent coexports and
        // static throttle entries distinguish it from unrelated track methods.
        if (!currentAnalyticsAnchor(container, analytics)) return;
        return {module: analytics, key: "track"};
    }
    catch {return;}
}

export function validateDiscordAnalyticsTrack(container: unknown, target: AnalyticsMethodTarget): boolean {
    return resolveDiscordAnalyticsTrack(container)?.module === target.module
        && target.key === "track"
        && typeof target.module.track === "function";
}

/** The direct emitter and its shared queue cover both observed current-build paths. */
export function discordAnalyticsMethods(container: unknown): AnalyticsMethodSpec[] {
    const methods: AnalyticsMethodSpec[] = [{
        key: "track",
lookup: () => resolveDiscordAnalyticsTrack(container),
        validate: candidate => validateDiscordAnalyticsTrack(container, candidate)
    }];
    try {
        if (!isRecord(container) || !isRecord(container.default) || !currentAnalyticsAnchor(container, container.default)) return methods;
        // The observed default.track returns trackMaker's Promise. Blocking it
        // must preserve that contract for callers that chain .then().
        methods[0].blockedValue = () => Promise.resolve();
        const queueTarget = (): AnalyticsMethodTarget | undefined => {
            const analytics = container.default;
            if (!isRecord(analytics) || typeof analytics.trackMaker !== "function" || typeof analytics.analyticsTrackingStoreMaker !== "function") return;
            const handlers = analytics.AnalyticsActionHandlers;
            if (!isRecord(handlers) || typeof handlers.handleConnectionOpen !== "function" || typeof handlers.handleConnectionClosed !== "function"
                || typeof handlers.handleFingerprint !== "function" || typeof handlers.handleSetAnalyticsToken !== "function") return;
            const descriptor = Object.getOwnPropertyDescriptor(handlers, "handleTrack");
            if (!descriptor?.writable || typeof descriptor.value !== "function" || descriptor.value !== handlers.handleTrack) return;
            const source = Function.prototype.toString.call(descriptor.value);
            if (source.length > 8_192 || !["client_track_timestamp", "client_heartbeat_session_id", "event_sequence_number"].every(marker => source.includes(marker))) return;
            return {module: handlers, key: "handleTrack"};
        };
        methods.push({
            key: "handleTrack",
lookup: queueTarget,
            validate: candidate => candidate.key === "handleTrack" && queueTarget()?.module === candidate.module,
            blockedValue: (_thisObject, args) => {
                // TRACK's resolve is a completion callback, not event content.
                // Acknowledging it prevents the suppressed trackMaker Promise
                // from hanging. Never read event, properties or fingerprint.
                try {
                    const action = args[0];
                    const resolve = isRecord(action) ? action.resolve : undefined;
                    if (typeof resolve === "function") Reflect.apply(resolve, undefined, []);
                }
                catch {/* A broken completion callback must not emit analytics. */}
                return false;
            }
        });
    }
    catch {/* Unavailable current export remains covered by the default spec. */}
    return methods;
}

function readMethodSpecs(value: unknown): AnalyticsMethodSpec[] | undefined {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_METHOD_COUNT) return;

    const keys = new Set<string>();
    const specs: AnalyticsMethodSpec[] = [];
    for (const candidate of value) {
        if (!isRecord(candidate)) return;
        const {key, lookup, validate, blockedValue} = candidate;
        if (typeof key !== "string" || !METHOD_KEY_PATTERN.test(key) || keys.has(key)) return;
        if (typeof lookup !== "function" || typeof validate !== "function") return;
        if (blockedValue !== undefined && typeof blockedValue !== "function") return;
        keys.add(key);
        specs.push({
            key,
            lookup: () => Reflect.apply(lookup, candidate, []),
            validate: target => Reflect.apply(validate, candidate, [target]) === true,
            ...(typeof blockedValue === "function" ? {blockedValue: (thisObject: unknown, args: unknown[]) => Reflect.apply(blockedValue, candidate, [thisObject, args])} : {})
        });
    }
    return specs;
}

export function validateAnalyticsMethodTarget(value: unknown, expectedKey: string): value is AnalyticsMethodTarget {
    if (!isRecord(value)) return false;
    const target = value as Partial<AnalyticsMethodTarget>;
    return target.key === expectedKey
        && isRecord(target.module)
        && typeof target.module[expectedKey] === "function";
}

function readSettings(value: unknown): DoNotTrackSettings | undefined {
    if (!isRecord(value) || typeof value.enabled !== "boolean") return;
    return {enabled: value.enabled};
}

function callOriginal(original: AnalyticsEmitter, thisObject: unknown, args: unknown[]): unknown {
    return Reflect.apply(original, thisObject, args);
}

function releaseAll(releases: Array<() => void>): void {
    for (const release of releases.splice(0).reverse()) {
        try {release();}
        catch {
            // Best effort: one drifting unpatch must not strand later patches.
        }
    }
}

/**
 * Suppresses only an explicit, independently validated list of Discord
 * analytics emission methods. It never inspects payloads or patches fetch,
 * XMLHttpRequest, IPC, Sentry, process monitoring, or game monitoring.
 */
export class DoNotTrackAdapter {
    readonly #options: DoNotTrackAdapterOptions;
    #releases: Array<() => void> = [];

    constructor(options: DoNotTrackAdapterOptions) {
        this.#options = options;
    }

    get active(): boolean {
        return this.#releases.length > 0 && !this.#options.scope.disposed;
    }

    start(): boolean {
        if (this.active) return true;
        if (this.#options.scope.disposed) return false;

        let specs: AnalyticsMethodSpec[] | undefined;
        try {specs = readMethodSpecs(this.#options.methods);}
        catch {return false;}
        if (!specs) return false;

        const targets: Array<{spec: AnalyticsMethodSpec; target: AnalyticsMethodTarget;}> = [];
        for (const spec of specs) {
            let candidate: unknown;
            try {candidate = spec.lookup();}
            catch {return false;}
            if (!validateAnalyticsMethodTarget(candidate, spec.key)) return false;

            let valid = false;
            try {valid = spec.validate(candidate) === true;}
            catch {return false;}
            if (!valid) return false;
            targets.push({spec, target: candidate});
        }

        const callback = (spec: AnalyticsMethodSpec, thisObject: unknown, args: unknown[], original: AnalyticsEmitter) => {
            let settings: DoNotTrackSettings | undefined;
            try {settings = readSettings(this.#options.getSettings());}
            catch {return callOriginal(original, thisObject, args);}
            if (!settings?.enabled) return callOriginal(original, thisObject, args);
            return spec.blockedValue?.(thisObject, args);
        };

        const releases: Array<() => void> = [];
        for (const {spec, target} of targets) {
            let unpatch: (() => void) | null | undefined;
            try {
                unpatch = this.#options.patcher.instead(
                    PATCH_CALLER,
                    target.module,
                    spec.key,
                    (thisObject, args, original) => callback(spec, thisObject, args, original),
                    {forcePatch: false}
                );
            }
            catch {
                releaseAll(releases);
                return false;
            }
            if (typeof unpatch !== "function") {
                releaseAll(releases);
                return false;
            }

            let unpatched = false;
            const dispose = () => {
                if (unpatched) return;
                unpatched = true;
                unpatch?.();
            };
            try {releases.push(this.#options.scope.own(dispose, "patch"));}
            catch {
                try {dispose();}
                catch {
                    // Continue rolling back any earlier successfully owned patch.
                }
                releaseAll(releases);
                return false;
            }
            if (this.#options.scope.disposed) {
                releaseAll(releases);
                return false;
            }
        }

        this.#releases = releases;
        return true;
    }

    stop(): void {
        const releases = this.#releases;
        this.#releases = [];
        releaseAll(releases);
    }
}
