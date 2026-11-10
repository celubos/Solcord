export type SolcordLocalTranslationAvailability = "available" | "downloadable" | "downloading" | "unavailable";
export type SolcordLocalTranslationPhase = "available" | "downloading" | "ready" | "unsupported" | "degraded" | "disposed";

export type SolcordLocalTranslationMonitor = EventTarget;

export interface SolcordLocalTranslatorInstance {
    translate(text: string, options?: {signal?: AbortSignal;}): Promise<string>;
    destroy(): void;
}

export interface SolcordLocalTranslatorFactory {
    availability(options: {sourceLanguage: string; targetLanguage: string;}): Promise<SolcordLocalTranslationAvailability>;
    create(options: {
        sourceLanguage: string;
        targetLanguage: string;
        signal?: AbortSignal;
        monitor?(monitor: SolcordLocalTranslationMonitor): void;
    }): Promise<SolcordLocalTranslatorInstance>;
}

export interface SolcordLocalLanguageDetectorInstance {
    detect(text: string, options?: {signal?: AbortSignal;}): Promise<Array<{detectedLanguage: string; confidence: number;}>>;
    destroy(): void;
}

export interface SolcordLocalLanguageDetectorFactory {
    availability(): Promise<SolcordLocalTranslationAvailability>;
    create(options: {signal?: AbortSignal; monitor?(monitor: SolcordLocalTranslationMonitor): void;}): Promise<SolcordLocalLanguageDetectorInstance>;
}

export interface SolcordLocalTranslationSnapshot {
    phase: SolcordLocalTranslationPhase;
    progress: number;
    queued: number;
    completed: number;
    failed: number;
    canceled: number;
    lastResult: "none" | "available" | "downloaded" | "translated" | "unavailable" | "failed" | "canceled";
    containsPlaintext: false;
}

interface TranslationJob {
    sourceLanguage: string;
    targetLanguage: string;
    text: string;
    controller: AbortController;
    deadline?: ReturnType<typeof setTimeout>;
    timeoutExpired: boolean;
    detachExternalAbort(): void;
    resolve(value: string): void;
    reject(error: Error): void;
}

export interface SolcordLocalTranslationTimingOptions {
    availabilityTimeoutMs?: number;
    jobTimeoutMs?: number;
}

const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const AVAILABILITY = new Set<SolcordLocalTranslationAvailability>(["available", "downloadable", "downloading", "unavailable"]);
const MAX_INPUT_CHARACTERS = 16_000;
const MAX_OUTPUT_CHARACTERS = 64_000;
const MAX_PENDING_JOBS = 4;
const DEFAULT_AVAILABILITY_TIMEOUT_MS = 5_000;
const DEFAULT_JOB_TIMEOUT_MS = 30_000;

function boundedTimeout(value: number | undefined, fallback: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(10, Math.min(120_000, Math.round(value!)));
}

function cancellationError(message = "Local translation was canceled."): Error {
    const error = new Error(message);
    error.name = "AbortError";
    return error;
}

function isCancellation(error: unknown, signal?: AbortSignal): boolean {
    return signal?.aborted === true || (error instanceof Error && error.name === "AbortError");
}

function languageTag(value: string, label: string): string {
    const normalized = value.trim();
    if (normalized.toLowerCase() === "auto") throw new Error("On-device translation needs a specific source language; automatic detection is not available through this local adapter.");
    if (!LANGUAGE_TAG.test(normalized)) throw new Error(`${label} must be a valid language tag.`);
    return normalized;
}

function normalizeSourceLanguage(value: string): string {
    return value.trim().toLowerCase() === "auto" ? "auto" : languageTag(value, "Source language");
}

function samePrimaryLanguage(sourceLanguage: string, targetLanguage: string): boolean {
    // Script and region subtags can require a real conversion (zh-Hans/zh-Hant).
    // Canonicalization also handles harmless case differences and legacy aliases.
    try {return Intl.getCanonicalLocales(sourceLanguage)[0] === Intl.getCanonicalLocales(targetLanguage)[0];}
    catch {return false;}
}

function boundedText(value: string): string {
    if (!value || value.length > MAX_INPUT_CHARACTERS) throw new Error(`Local translation text must contain 1 to ${MAX_INPUT_CHARACTERS.toLocaleString("en-US")} characters.`);
    return value;
}

async function raceAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw cancellationError();
    let detach = () => {};
    const canceled = new Promise<never>((_, reject) => {
        const abort = () => reject(cancellationError());
        signal.addEventListener("abort", abort, {once: true});
        detach = () => signal.removeEventListener("abort", abort);
    });
    try {return await Promise.race([operation, canceled]);}
    finally {detach();}
}

/** Resolve only the documented Chromium/Electron Translator static surface. */
export function resolveSolcordLocalTranslatorFactory(host: unknown = globalThis): SolcordLocalTranslatorFactory | undefined {
    if (!host || (typeof host !== "object" && typeof host !== "function")) return;
    let candidate: Partial<SolcordLocalTranslatorFactory> | undefined;
    try {candidate = Reflect.get(host, "Translator") as Partial<SolcordLocalTranslatorFactory> | undefined;}
    catch {return;}
    if (!candidate || (typeof candidate !== "object" && typeof candidate !== "function")) return;
    let availability: SolcordLocalTranslatorFactory["availability"] | undefined;
    let create: SolcordLocalTranslatorFactory["create"] | undefined;
    try {
        availability = candidate.availability;
        create = candidate.create;
    }
    catch {return;}
    if (typeof availability !== "function" || typeof create !== "function") return;
    return {
        availability: options => Reflect.apply(availability, candidate, [options]) as Promise<SolcordLocalTranslationAvailability>,
        create: options => Reflect.apply(create, candidate, [options]) as Promise<SolcordLocalTranslatorInstance>
    };
}

/** Resolve the companion local language detector used only for an `auto` source. */
export function resolveSolcordLocalLanguageDetectorFactory(host: unknown = globalThis): SolcordLocalLanguageDetectorFactory | undefined {
    if (!host || (typeof host !== "object" && typeof host !== "function")) return;
    let candidate: Partial<SolcordLocalLanguageDetectorFactory> | undefined;
    try {candidate = Reflect.get(host, "LanguageDetector") as Partial<SolcordLocalLanguageDetectorFactory> | undefined;}
    catch {return;}
    if (!candidate || (typeof candidate !== "object" && typeof candidate !== "function")) return;
    let availability: SolcordLocalLanguageDetectorFactory["availability"] | undefined;
    let create: SolcordLocalLanguageDetectorFactory["create"] | undefined;
    try {
        availability = candidate.availability;
        create = candidate.create;
    }
    catch {return;}
    if (typeof availability !== "function" || typeof create !== "function") return;
    return {
        availability: () => Reflect.apply(availability, candidate, []) as Promise<SolcordLocalTranslationAvailability>,
        create: options => Reflect.apply(create, candidate, [options]) as Promise<SolcordLocalLanguageDetectorInstance>
    };
}

/**
 * Local-first translation queue. It never persists or reports input/output text,
 * and it has no network-provider fallback path.
 */
export class SolcordLocalTranslationEngine {
    readonly #factory?: SolcordLocalTranslatorFactory;
    readonly #detectorFactory?: SolcordLocalLanguageDetectorFactory;
    readonly #availabilityTimeoutMs: number;
    readonly #jobTimeoutMs: number;
    readonly #listeners = new Set<(snapshot: Readonly<SolcordLocalTranslationSnapshot>) => void>();
    readonly #queue: TranslationJob[] = [];
    #phase: SolcordLocalTranslationPhase;
    #progress = 0;
    #completed = 0;
    #failed = 0;
    #canceled = 0;
    #lastResult: SolcordLocalTranslationSnapshot["lastResult"] = "none";
    #instance?: SolcordLocalTranslatorInstance;
    #instancePair = "";
    #active?: TranslationJob;
    #draining = false;
    #disposed = false;

    constructor(
        factory: SolcordLocalTranslatorFactory | undefined = resolveSolcordLocalTranslatorFactory(),
        detectorFactory: SolcordLocalLanguageDetectorFactory | undefined = resolveSolcordLocalLanguageDetectorFactory(),
        timing: SolcordLocalTranslationTimingOptions = {}
    ) {
        this.#factory = factory;
        this.#detectorFactory = detectorFactory;
        this.#availabilityTimeoutMs = boundedTimeout(timing.availabilityTimeoutMs, DEFAULT_AVAILABILITY_TIMEOUT_MS);
        this.#jobTimeoutMs = boundedTimeout(timing.jobTimeoutMs, DEFAULT_JOB_TIMEOUT_MS);
        this.#phase = factory ? "available" : "unsupported";
    }

    snapshot(): Readonly<SolcordLocalTranslationSnapshot> {
        return Object.freeze({
            phase: this.#phase,
            progress: this.#progress,
            queued: this.#queue.length + (this.#active ? 1 : 0),
            completed: this.#completed,
            failed: this.#failed,
            canceled: this.#canceled,
            lastResult: this.#lastResult,
            containsPlaintext: false as const
        });
    }

    subscribe(listener: (snapshot: Readonly<SolcordLocalTranslationSnapshot>) => void): () => void {
        if (this.#disposed) {
            listener(this.snapshot());
            return () => {};
        }
        this.#listeners.add(listener);
        try {listener(this.snapshot());}
        catch {/* UI subscribers cannot interrupt the local queue */}
        return () => this.#listeners.delete(listener);
    }

    async availability(sourceLanguage: string, targetLanguage: string, signal?: AbortSignal): Promise<SolcordLocalTranslationAvailability> {
        this.#assertActive();
        const source = languageTag(sourceLanguage, "Source language");
        const target = languageTag(targetLanguage, "Target language");
        if (samePrimaryLanguage(source, target)) {
            this.#setState("ready", 1, "available");
            return "available";
        }
        if (!this.#factory) {
            this.#setState("unsupported", 0, "unavailable");
            return "unavailable";
        }
        const controller = new AbortController();
        let timeoutExpired = false;
        const abort = () => controller.abort();
        signal?.addEventListener("abort", abort, {once: true});
        if (signal?.aborted) controller.abort();
        const deadline = setTimeout(() => {
            timeoutExpired = true;
            controller.abort();
        }, this.#availabilityTimeoutMs);
        try {
            const raw = await raceAbort(Promise.resolve(this.#factory.availability({sourceLanguage: source, targetLanguage: target})), controller.signal);
            if (!AVAILABILITY.has(raw)) throw new Error("The local Translator availability result changed shape.");
            if (raw === "unavailable") this.#setState("unsupported", 0, "unavailable");
            else if (raw === "downloading") this.#setState("downloading", this.#progress, "available");
            else this.#setState(this.#instancePair === `${source}\n${target}` ? "ready" : "available", raw === "available" ? 1 : 0, "available");
            return raw;
        }
        catch (error) {
            if (timeoutExpired) {
                this.#setState("degraded", 0, "failed");
                throw new Error("The local Translator availability check timed out.");
            }
            if (isCancellation(error, controller.signal)) throw cancellationError();
            this.#setState("degraded", 0, "failed");
            throw new Error("The local Translator availability check failed.");
        }
        finally {
            clearTimeout(deadline);
            signal?.removeEventListener("abort", abort);
        }
    }

    translate(sourceLanguage: string, targetLanguage: string, text: string, signal?: AbortSignal): Promise<string> {
        this.#assertActive();
        const source = normalizeSourceLanguage(sourceLanguage);
        const target = languageTag(targetLanguage, "Target language");
        const content = boundedText(text);
        if (!this.#factory) {
            this.#setState("unsupported", 0, "unavailable");
            return Promise.reject(new Error("On-device translation is unsupported by this Discord/Electron build."));
        }
        if (this.#queue.length + (this.#active ? 1 : 0) >= MAX_PENDING_JOBS) return Promise.reject(new Error("Local translation is busy; wait for one of the four bounded jobs to finish."));
        if (signal?.aborted) return Promise.reject(cancellationError());

        return new Promise<string>((resolve, reject) => {
            const controller = new AbortController();
            const abort = () => controller.abort();
            signal?.addEventListener("abort", abort, {once: true});
            const job: TranslationJob = {
                sourceLanguage: source,
                targetLanguage: target,
                text: content,
                controller,
                timeoutExpired: false,
                detachExternalAbort: () => signal?.removeEventListener("abort", abort),
                resolve,
                reject
            };
            job.deadline = setTimeout(() => {
                job.timeoutExpired = true;
                controller.abort();
            }, this.#jobTimeoutMs);
            this.#queue.push(job);
            this.#emit();
            void this.#drain();
        });
    }

    cancelAll(): void {
        if (this.#active) {
            this.#active.timeoutExpired = false;
            clearTimeout(this.#active.deadline);
            this.#active.controller.abort();
        }
        // Destroy the cached model as well as aborting its signal. Chromium's
        // documented implementation observes AbortSignal, but disposal keeps
        // cancellation effective if an embedded build drifts and ignores it.
        try {this.#instance?.destroy();}
        catch {/* cancellation remains content-free and continues */}
        this.#instance = undefined;
        this.#instancePair = "";
        for (const job of this.#queue.splice(0)) {
            job.timeoutExpired = false;
            clearTimeout(job.deadline);
            job.controller.abort();
            job.detachExternalAbort();
            this.#canceled++;
            job.reject(cancellationError());
        }
        this.#lastResult = "canceled";
        this.#emit();
    }

    dispose(): void {
        if (this.#disposed) return;
        this.#disposed = true;
        this.cancelAll();
        try {this.#instance?.destroy();}
        catch {/* disposal continues without logging provider details */}
        this.#instance = undefined;
        this.#instancePair = "";
        this.#phase = "disposed";
        this.#progress = 0;
        this.#emit();
        this.#listeners.clear();
    }

    async #drain(): Promise<void> {
        if (this.#draining) return;
        this.#draining = true;
        try {
            while (!this.#disposed) {
                const job = this.#queue.shift();
                if (!job) break;
                this.#active = job;
                this.#emit();
                try {
                    if (job.controller.signal.aborted) throw cancellationError();
                    if (job.sourceLanguage === "auto") job.sourceLanguage = await this.#detectLanguage(job);
                    if (samePrimaryLanguage(job.sourceLanguage, job.targetLanguage)) {
                        this.#completed++;
                        this.#setState("ready", 1, "translated");
                        job.resolve(job.text);
                        continue;
                    }
                    const instance = await this.#instanceFor(job);
                    const result = await raceAbort(Promise.resolve(instance.translate(job.text, {signal: job.controller.signal})), job.controller.signal);
                    if (typeof result !== "string" || result.length > MAX_OUTPUT_CHARACTERS) throw new Error("The local Translator response changed shape.");
                    this.#completed++;
                    this.#setState("ready", 1, "translated");
                    job.resolve(result);
                }
                catch (error) {
                    if (job.timeoutExpired && !this.#disposed) {
                        this.#failed++;
                        try {this.#instance?.destroy();}
                        catch {/* a timed-out local model is discarded without provider detail */}
                        this.#instance = undefined;
                        this.#instancePair = "";
                        this.#setState("degraded", 0, "failed");
                        job.reject(new Error("On-device translation timed out and was canceled."));
                    }
                    else if (isCancellation(error, job.controller.signal) || this.#disposed) {
                        this.#canceled++;
                        this.#lastResult = "canceled";
                        job.reject(cancellationError());
                    }
                    else {
                        this.#failed++;
                        this.#setState(this.#phase === "unsupported" ? "unsupported" : "degraded", 0, this.#phase === "unsupported" ? "unavailable" : "failed");
                        job.reject(error instanceof Error ? error : new Error("Local translation failed."));
                    }
                }
                finally {
                    clearTimeout(job.deadline);
                    job.detachExternalAbort();
                    this.#active = undefined;
                    this.#emit();
                }
            }
        }
        finally {this.#draining = false;}
    }

    async #instanceFor(job: TranslationJob): Promise<SolcordLocalTranslatorInstance> {
        const pair = `${job.sourceLanguage}\n${job.targetLanguage}`;
        if (this.#instance && this.#instancePair === pair) return this.#instance;
        try {this.#instance?.destroy();}
        catch {/* stale local model cleanup is best-effort and content-free */}
        this.#instance = undefined;
        this.#instancePair = "";

        const availability = await raceAbort(Promise.resolve(this.#factory!.availability({sourceLanguage: job.sourceLanguage, targetLanguage: job.targetLanguage})), job.controller.signal);
        if (!AVAILABILITY.has(availability)) throw new Error("The local Translator availability result changed shape.");
        if (availability === "unavailable") {
            this.#setState("unsupported", 0, "unavailable");
            throw new Error("This on-device language pair is unavailable in the installed Discord/Electron build.");
        }
        const downloading = availability === "downloadable" || availability === "downloading";
        this.#setState(downloading ? "downloading" : "available", downloading ? 0 : 1, availability === "available" ? "available" : "none");
        const createOperation = Promise.resolve(this.#factory!.create({
            sourceLanguage: job.sourceLanguage,
            targetLanguage: job.targetLanguage,
            signal: job.controller.signal,
            monitor: monitor => {
                if (!monitor || typeof monitor.addEventListener !== "function") return;
                monitor.addEventListener("downloadprogress", event => {
                    const loaded = Number(Reflect.get(event, "loaded"));
                    if (!Number.isFinite(loaded)) return;
                    this.#setState("downloading", Math.max(0, Math.min(1, loaded)), "none");
                });
            }
        }));
        void createOperation.then(instance => {
            if (!job.controller.signal.aborted && !this.#disposed) return;
            try {instance?.destroy?.();}
            catch {/* late canceled creation remains locally contained */}
        }).catch(() => {});
        const instance = await raceAbort(createOperation, job.controller.signal);
        if (!instance || typeof instance.translate !== "function" || typeof instance.destroy !== "function") {
            try {instance?.destroy?.();}
            catch {/* malformed instances stay unused */}
            throw new Error("The local Translator instance changed shape.");
        }
        this.#instance = instance;
        this.#instancePair = pair;
        this.#setState("ready", 1, downloading ? "downloaded" : "available");
        return instance;
    }

    async #detectLanguage(job: TranslationJob): Promise<string> {
        if (!this.#detectorFactory) throw new Error("Automatic on-device language detection is unsupported; choose a source language or select an explicit external provider.");
        const availability = await raceAbort(Promise.resolve(this.#detectorFactory.availability()), job.controller.signal);
        if (!AVAILABILITY.has(availability) || availability === "unavailable") throw new Error("Automatic on-device language detection is unavailable for this Discord/Electron build.");
        const downloading = availability === "downloadable" || availability === "downloading";
        if (downloading) this.#setState("downloading", 0, "none");
        const createOperation = Promise.resolve(this.#detectorFactory.create({
            signal: job.controller.signal,
            monitor: monitor => {
                if (!monitor || typeof monitor.addEventListener !== "function") return;
                monitor.addEventListener("downloadprogress", event => {
                    const loaded = Number(Reflect.get(event, "loaded"));
                    if (Number.isFinite(loaded)) this.#setState("downloading", Math.max(0, Math.min(1, loaded)), "none");
                });
            }
        }));
        void createOperation.then(detector => {
            if (!job.controller.signal.aborted && !this.#disposed) return;
            try {detector?.destroy?.();}
            catch {/* late canceled detector creation stays locally contained */}
        }).catch(() => {});
        const detector = await raceAbort(createOperation, job.controller.signal);
        if (!detector || typeof detector.detect !== "function" || typeof detector.destroy !== "function") throw new Error("The local LanguageDetector instance changed shape.");
        try {
            const results = await raceAbort(Promise.resolve(detector.detect(job.text, {signal: job.controller.signal})), job.controller.signal);
            if (!Array.isArray(results)) throw new Error("The local LanguageDetector response changed shape.");
            const best = results
                .filter(result => result && typeof result.detectedLanguage === "string" && Number.isFinite(result.confidence))
                .sort((left, right) => right.confidence - left.confidence)[0];
            if (!best || best.confidence <= 0) throw new Error("The local LanguageDetector could not identify this text.");
            return languageTag(best.detectedLanguage, "Detected source language");
        }
        finally {
            try {detector.destroy();}
            catch {/* detector teardown never exposes or persists text */}
        }
    }

    #assertActive(): void {
        if (this.#disposed) throw new Error("Local Translation Desk is disposed.");
    }

    #setState(phase: SolcordLocalTranslationPhase, progress: number, lastResult: SolcordLocalTranslationSnapshot["lastResult"]): void {
        if (this.#disposed && phase !== "disposed") return;
        this.#phase = phase;
        this.#progress = Math.max(0, Math.min(1, progress));
        this.#lastResult = lastResult;
        this.#emit();
    }

    #emit(): void {
        const snapshot = this.snapshot();
        for (const listener of this.#listeners) {
            try {listener(snapshot);}
            catch {/* UI subscribers cannot interrupt the local queue */}
        }
    }
}
