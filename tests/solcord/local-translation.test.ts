import {describe, expect, test} from "bun:test";

import {
    resolveSolcordLocalLanguageDetectorFactory,
    resolveSolcordLocalTranslatorFactory,
    SolcordLocalTranslationEngine,
    type SolcordLocalTranslationMonitor,
    type SolcordLocalTranslatorFactory
} from "../../src/betterdiscord/modules/solcord/local-translation";

function localFactory(overrides: Partial<SolcordLocalTranslatorFactory> = {}): SolcordLocalTranslatorFactory {
    return {
        availability: async () => "available",
        create: async () => ({translate: async text => `local:${text}`, destroy: () => {}}),
        ...overrides
    };
}

describe("Solcord local Translation Desk", () => {
    test("different scripts require the provider while canonical identical tags remain local", async () => {
        const translated: string[] = [];
        const engine = new SolcordLocalTranslationEngine(localFactory({
            create: async options => ({translate: async text => {translated.push(`${options.sourceLanguage}:${options.targetLanguage}`); return `${text}-converted`;}, destroy: () => {}})
        }));
        await expect(engine.translate("zh-Hans", "zh-Hant", "sample")).resolves.toBe("sample-converted");
        expect(translated).toEqual(["zh-Hans:zh-Hant"]);
        await expect(engine.translate("en-US", "EN-us", "same")).resolves.toBe("same");
        expect(translated).toHaveLength(1);
        engine.dispose();
    });
    test("structurally resolves the documented local factories and translates without a network fallback", async () => {
        const calls: string[] = [];
        const host = {
            Translator: {
                availability: async () => "available",
                create: async () => ({translate: async (text: string) => {calls.push(text); return "hola";}, destroy: () => {calls.push("destroy");}})
            },
            LanguageDetector: {
                availability: async () => "available",
                create: async () => ({detect: async () => [{detectedLanguage: "en", confidence: 0.99}], destroy: () => {calls.push("detector-destroy");}})
            }
        };
        const translator = resolveSolcordLocalTranslatorFactory(host);
        const detector = resolveSolcordLocalLanguageDetectorFactory(host);
        expect(translator).toBeDefined();
        expect(detector).toBeDefined();

        const engine = new SolcordLocalTranslationEngine(translator, detector);
        await expect(engine.translate("auto", "es", "private phrase")).resolves.toBe("hola");
        expect(calls).toContain("private phrase");
        expect(calls).toContain("detector-destroy");
        expect(engine.snapshot()).toMatchObject({phase: "ready", completed: 1, failed: 0, containsPlaintext: false});
        engine.dispose();
        expect(calls).toContain("destroy");
    });

    test("reports an unavailable language pair without creating a translator or choosing cloud", async () => {
        let creates = 0;
        const engine = new SolcordLocalTranslationEngine(localFactory({
            availability: async () => "unavailable",
            create: async () => {creates++; throw new Error("must not create");}
        }));
        await expect(engine.translate("en", "zz", "local only")).rejects.toThrow("language pair is unavailable");
        expect(creates).toBe(0);
        expect(engine.snapshot()).toMatchObject({phase: "unsupported", failed: 1, lastResult: "unavailable", containsPlaintext: false});
        engine.dispose();
    });

    test("returns same-language text locally without requesting a redundant model", async () => {
        let creates = 0;
        const engine = new SolcordLocalTranslationEngine(localFactory({
            availability: async () => "unavailable",
            create: async () => {creates++; throw new Error("must not create");}
        }), {
            availability: async () => "available",
            create: async () => ({detect: async () => [{detectedLanguage: "en", confidence: 0.99}], destroy: () => {}})
        });
        await expect(engine.availability("en", "EN")).resolves.toBe("available");
        await expect(engine.translate("auto", "EN", "already English")).resolves.toBe("already English");
        expect(creates).toBe(0);
        expect(engine.snapshot()).toMatchObject({phase: "ready", completed: 1, failed: 0, lastResult: "translated", containsPlaintext: false});
        engine.dispose();
    });

    test("surfaces bounded download progress and fails closed when model creation fails", async () => {
        const observed: Array<{phase: string; progress: number;}> = [];
        const engine = new SolcordLocalTranslationEngine(localFactory({
            availability: async () => "downloadable",
            create: async options => {
                const monitor = new EventTarget() as SolcordLocalTranslationMonitor;
                options.monitor?.(monitor);
                const progress = new Event("downloadprogress");
                Object.defineProperty(progress, "loaded", {value: 0.5});
                monitor.dispatchEvent(progress);
                throw new Error("model download failed");
            }
        }));
        engine.subscribe(snapshot => observed.push({phase: snapshot.phase, progress: snapshot.progress}));
        await expect(engine.translate("en", "es", "never logged")).rejects.toThrow("model download failed");
        expect(observed).toContainEqual({phase: "downloading", progress: 0.5});
        expect(engine.snapshot()).toMatchObject({phase: "degraded", failed: 1, lastResult: "failed", containsPlaintext: false});
        engine.dispose();
    });

    test("cancels active and queued work on disposal and destroys the local instance", async () => {
        let destroys = 0;
        let markCreated!: () => void;
        const created = new Promise<void>(resolve => {markCreated = resolve;});
        const factory = localFactory({
            create: async () => {
                markCreated();
                return ({
                translate: (_text, options) => new Promise((_resolve, reject) => {
                    options?.signal?.addEventListener("abort", () => {
                        const error = new Error("aborted");
                        error.name = "AbortError";
                        reject(error);
                    }, {once: true});
                }),
                destroy: () => {destroys++;}
                });
            }
        });
        const engine = new SolcordLocalTranslationEngine(factory);
        const active = engine.translate("en", "es", "active secret");
        const queued = engine.translate("en", "fr", "queued secret");
        const activeResult = active.catch(error => error as Error);
        const queuedResult = queued.catch(error => error as Error);
        await created;
        for (let index = 0; index < 10 && engine.snapshot().phase !== "ready"; index++) await Promise.resolve();
        expect(engine.snapshot().phase).toBe("ready");
        engine.dispose();
        const activeError = await activeResult;
        const queuedError = await queuedResult;
        expect(activeError).toBeInstanceOf(Error);
        expect(queuedError).toBeInstanceOf(Error);
        expect((activeError as Error).name).toBe("AbortError");
        expect((queuedError as Error).name).toBe("AbortError");
        expect(engine.snapshot()).toMatchObject({phase: "disposed", canceled: 2, queued: 0, containsPlaintext: false});
        expect(destroys).toBe(1);
    });

    test("keeps diagnostics content-free across successful and failed requests", async () => {
        const engine = new SolcordLocalTranslationEngine(localFactory());
        await engine.translate("en", "es", "do not retain this sentence");
        const serialized = JSON.stringify(engine.snapshot());
        expect(serialized).not.toContain("do not retain");
        expect(serialized).not.toContain("local:");
        expect(serialized).toContain("\"containsPlaintext\":false");
        expect(Object.keys(engine.snapshot()).sort()).toEqual(["canceled", "completed", "containsPlaintext", "failed", "lastResult", "phase", "progress", "queued"]);
        engine.dispose();
    });

    test("bounds a platform availability probe that never settles", async () => {
        const engine = new SolcordLocalTranslationEngine(localFactory({
            availability: () => new Promise(() => {})
        }), undefined, {availabilityTimeoutMs: 10});

        await expect(engine.availability("en", "es")).rejects.toThrow("availability check timed out");
        expect(engine.snapshot()).toMatchObject({phase: "degraded", failed: 0, lastResult: "failed", containsPlaintext: false});
        engine.dispose();
    });

    test("bounds a translation job when the embedded model ignores cancellation", async () => {
        let destroyed = 0;
        const engine = new SolcordLocalTranslationEngine(localFactory({
            create: async () => ({
                translate: () => new Promise(() => {}),
                destroy: () => {destroyed++;}
            })
        }), undefined, {jobTimeoutMs: 10});

        await expect(engine.translate("en", "es", "private phrase")).rejects.toThrow("timed out and was canceled");
        expect(engine.snapshot()).toMatchObject({phase: "degraded", queued: 0, failed: 1, canceled: 0, lastResult: "failed", containsPlaintext: false});
        expect(destroyed).toBe(1);
        engine.dispose();
    });

    test("rejects drifted platform shapes instead of guessing", () => {
        expect(resolveSolcordLocalTranslatorFactory({Translator: {availability: async () => "available"}})).toBeUndefined();
        expect(resolveSolcordLocalLanguageDetectorFactory({LanguageDetector: {create: async () => ({})}})).toBeUndefined();
        const throwing = Object.defineProperty({}, "Translator", {get: () => {throw new Error("drifted getter");}});
        expect(resolveSolcordLocalTranslatorFactory(throwing)).toBeUndefined();
    });
});
