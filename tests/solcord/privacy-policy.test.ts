// SPDX-License-Identifier: Apache-2.0

import {describe, expect, test} from "bun:test";
import fs from "node:fs";
import path from "node:path";

import {
    applyPrivacyProfile,
    boundPrivacyReceipts,
    createPrivacyDecisionReceipt,
    defaultStrictPrivacyPreferences,
    legacyPrivacyPreferences,
    normalizePrivacyPreferences,
    privacyCapabilityStateLabel,
    privacyReceiptTimeBucket
} from "../../src/common/solcord/privacy";
import {SolcordDisposalScope} from "../../src/betterdiscord/modules/solcord/disposal";
import {privacyCategoryBlocked, resolvePrivacyMethodTarget, SolcordPrivacyPolicyAdapter, type PrivacyPolicyPatcher} from "../../src/betterdiscord/modules/solcord/privacy-policy";
import {classifyCommunityAddonOutbound, planStrictCommunityAddonPolicy} from "../../src/betterdiscord/modules/solcord/addon-outbound-policy";
import {onSolcordUpdatePolicyChange, setSolcordAutomaticUpdatesAllowed, solcordAutomaticCatalogRequestsAllowed, solcordAutomaticUpdatesAllowed, solcordCatalogRetryAllowed} from "../../src/betterdiscord/modules/solcord/privacy-runtime-state";

const ROOT = path.resolve(import.meta.dir, "../..");

function harness(options: {failReceipt?: boolean; failPatch?: string;} = {}) {
    const calls: string[] = [];
    const releases: string[] = [];
    const module = {
        track(value: string) {calls.push(`track:${value}`); return "sent";},
        captureException(value: string) {calls.push(`crash:${value}`); return "reported";},
        getProcesses() {calls.push("processes"); return Promise.resolve(["private-process"]);}
    };
    const patcher: PrivacyPolicyPatcher = {
        instead(_caller, target, key, callback) {
            if (options.failPatch === key) throw new Error("Fixture patch failed");
            const original = target[key] as (...args: unknown[]) => unknown;
            const patched = function (this: unknown, ...args: unknown[]) {return callback(this, args, original);};
            target[key] = patched;
            return () => {
                if (target[key] !== patched) return;
                target[key] = original;
                releases.push(key);
            };
        }
    };
    const scope = new SolcordDisposalScope();
    let preferences = defaultStrictPrivacyPreferences();
    const receipts: Array<ReturnType<typeof createPrivacyDecisionReceipt>> = [];
    const adapter = new SolcordPrivacyPolicyAdapter({
        scope,
        patcher,
        preferences: () => preferences,
        receipt: receipt => {if (options.failReceipt) throw new Error("Fixture receipt storage failed"); receipts.push(receipt);},
        now: () => 7_234_567,
        specs: [
            {id: "analytics", dataClass: "telemetry", key: "track", lookup: () => module, validate: target => target.module === module, blockedValue: () => undefined},
            {id: "crash", dataClass: "crash-reporting", key: "captureException", lookup: () => module, validate: target => target.module === module, blockedValue: () => undefined},
            {id: "processes", dataClass: "activity-discovery", key: "getProcesses", lookup: () => module, validate: target => target.module === module, blockedValue: () => Promise.resolve([])}
        ]
    });
    return {adapter, calls, module, receipts, releases, scope, setPreferences(next: typeof preferences) {preferences = next;}};
}

describe("Solcord privacy policy", () => {
    test("formats capability states for people without weakening unsupported states", () => {
        expect(privacyCapabilityStateLabel("NeedsReview")).toBe("Needs review");
        expect(privacyCapabilityStateLabel("Protected")).toBe("Protected");
        expect(privacyCapabilityStateLabel("Degraded")).toBe("Degraded");
        expect(privacyCapabilityStateLabel("Unsupported")).toBe("Unsupported");
    });

    test("normalizes fresh installs to strict while migrating existing profiles without silently changing them", () => {
        expect(defaultStrictPrivacyPreferences()).toEqual(expect.objectContaining({profile: "strict", telemetry: "block", crashReporting: "block-optional", activityDiscovery: "block", updates: "manual"}));
        expect(normalizePrivacyPreferences({profile: "forged", telemetry: "capture-all"})).toEqual(defaultStrictPrivacyPreferences());
        expect(legacyPrivacyPreferences()).toEqual(expect.objectContaining({profile: "standard", migrationPending: true, telemetry: "allow", updates: "automatic"}));
        expect(applyPrivacyProfile(legacyPrivacyPreferences(), "strict", 42)).toEqual(expect.objectContaining({profile: "strict", migrationPending: false, migratedAt: 42}));
    });

    test("creates bounded content-free receipts at coarse hourly resolution", () => {
        const receipt = createPrivacyDecisionReceipt(2, 7_234_567, "telemetry", "block", "applied");
        expect(receipt).toEqual({sequence: 2, timeBucket: privacyReceiptTimeBucket(7_234_567), dataClass: "telemetry", decision: "block", result: "applied"});
        expect(Object.keys(receipt).sort()).toEqual(["dataClass", "decision", "result", "sequence", "timeBucket"]);
        expect(boundPrivacyReceipts([receipt, {...receipt, sequence: 0}, {...receipt, dataClass: "url"}], 10)).toEqual([receipt]);
    });

    test("strict cannot silently retain optional-network permissions from stale settings", () => {
        expect(normalizePrivacyPreferences({...legacyPrivacyPreferences(), profile: "strict", migrationPending: false})).toEqual(defaultStrictPrivacyPreferences());
        expect(normalizePrivacyPreferences({...legacyPrivacyPreferences(), profile: "custom", migrationPending: false}).telemetry).toBe("allow");
    });

    test("blocks only explicitly named validated optional surfaces and restores them completely", async () => {
        const state = harness();
        expect(state.adapter.start()).toEqual([
            {dataClass: "telemetry", state: "Protected", summary: "1 validated optional emission surface blocked."},
            {dataClass: "crash-reporting", state: "Protected", summary: "1 validated optional emission surface blocked."},
            {dataClass: "activity-discovery", state: "Protected", summary: "1 validated optional emission surface blocked."}
        ]);
        expect(state.module.track("private")).toBeUndefined();
        expect(state.module.captureException("private")).toBeUndefined();
        expect(await state.module.getProcesses()).toEqual([]);
        expect(state.calls).toEqual([]);
        expect(state.scope.counts()).toEqual({patch: 3});
        expect(state.receipts.map(receipt => [receipt.dataClass, receipt.decision, receipt.result])).toEqual([
            ["telemetry", "block", "applied"],
            ["crash-reporting", "block", "applied"],
            ["activity-discovery", "block", "applied"]
        ]);

        state.setPreferences(legacyPrivacyPreferences());
        expect(state.module.track("allowed")).toBe("sent");
        expect(state.calls).toEqual(["track:allowed"]);
        state.scope.dispose();
        expect(state.releases.sort()).toEqual(["captureException", "getProcesses", "track"]);
        expect(state.module.track("restored")).toBe("sent");
    });

    test("a repeated start installs each patch once and leaves a complete teardown", () => {
        const state = harness();
        const first = state.adapter.start();
        expect(state.adapter.start()).toEqual(first);
        expect(state.scope.counts()).toEqual({patch: 3});
        expect(state.receipts).toHaveLength(3);
        state.scope.dispose();
        expect(state.releases).toHaveLength(3);
        expect(state.module.track("restored")).toBe("sent");
    });

    test("diagnostics storage failures do not prevent the remaining privacy protections", async () => {
        const state = harness({failReceipt: true});
        expect(state.adapter.start().every(record => record.state === "Protected")).toBeTrue();
        expect(state.adapter.diagnosticsComplete).toBeFalse();
        expect(state.module.track("private")).toBeUndefined();
        expect(state.module.captureException("private")).toBeUndefined();
        expect(await state.module.getProcesses()).toEqual([]);
        expect(state.calls).toEqual([]);
        state.scope.dispose();
        expect(state.scope.counts()).toEqual({});
    });

    test("a failed optional patch is reported independently without skipping other categories", async () => {
        const state = harness({failPatch: "captureException"});
        expect(state.adapter.start().map(record => [record.dataClass, record.state])).toEqual([
            ["telemetry", "Protected"], ["crash-reporting", "Unsupported"], ["activity-discovery", "Protected"]
        ]);
        expect(state.module.track("private")).toBeUndefined();
        expect(await state.module.getProcesses()).toEqual([]);
        expect(state.calls).toEqual([]);
        expect(state.scope.counts()).toEqual({patch: 2});
        state.scope.dispose();
    });

    test("sanitizes only the structurally validated running-game action and restores normal dispatch", () => {
        const dispatched: unknown[] = [];
        const dispatcher = {dispatch(action: unknown) {dispatched.push(action); return "dispatched";}, subscribe() {}, unsubscribe() {}};
        const releases: Array<() => void> = [];
        const scope = new SolcordDisposalScope();
        let preferences = defaultStrictPrivacyPreferences();
        const patcher: PrivacyPolicyPatcher = {
            instead(_caller, target, key, callback) {
                const original = target[key] as (...args: unknown[]) => unknown;
                const patched = function (this: unknown, ...args: unknown[]) {return callback(this, args, original);};
                target[key] = patched;
                const release = () => {if (target[key] === patched) target[key] = original;};
                releases.push(release);
                return release;
            }
        };
        const adapter = new SolcordPrivacyPolicyAdapter({
            scope,
            patcher,
            preferences: () => preferences,
            receipt: () => {},
            specs: [{
                id: "running-game-dispatch",
                dataClass: "activity-discovery",
                key: "dispatch",
                lookup: () => dispatcher,
                validate: target => target.module === dispatcher && typeof dispatcher.subscribe === "function" && typeof dispatcher.unsubscribe === "function",
                blockedValue: () => undefined,
                intercept: (thisObject, args, original) => {
                    const [action, ...rest] = args;
                    if (!action || typeof action !== "object" || (action as {type?: unknown;}).type !== "RUNNING_GAMES_CHANGE") return Reflect.apply(original, thisObject, args);
                    if (!Array.isArray((action as {games?: unknown;}).games)) return undefined;
                    return Reflect.apply(original, thisObject, [{...action, games: []}, ...rest]);
                }
            }]
        });

        expect(adapter.start()).toContainEqual({dataClass: "activity-discovery", state: "Protected", summary: "1 validated optional emission surface blocked."});
        expect(dispatcher.dispatch({type: "MESSAGE_CREATE", message: "untouched"})).toBe("dispatched");
        expect(dispatcher.dispatch({type: "RUNNING_GAMES_CHANGE", games: [{pid: 42}]})).toBe("dispatched");
        expect(dispatcher.dispatch({type: "RUNNING_GAMES_CHANGE"})).toBeUndefined();
        expect(dispatched).toEqual([
            {type: "MESSAGE_CREATE", message: "untouched"},
            {type: "RUNNING_GAMES_CHANGE", games: []}
        ]);

        preferences = legacyPrivacyPreferences();
        expect(dispatcher.dispatch({type: "RUNNING_GAMES_CHANGE", games: [{pid: 7}]})).toBe("dispatched");
        expect(dispatched.at(-1)).toEqual({type: "RUNNING_GAMES_CHANGE", games: [{pid: 7}]});
        scope.dispose();
        expect(releases).toHaveLength(1);
    });

    test("fails closed to an honest unsupported state instead of patching broad network APIs", () => {
        const scope = new SolcordDisposalScope();
        const adapter = new SolcordPrivacyPolicyAdapter({
            scope,
            patcher: {instead: () => {throw new Error("must not patch");}},
            preferences: defaultStrictPrivacyPreferences,
            receipt: () => {},
            specs: [{id: "drifted", dataClass: "telemetry", key: "track", lookup: () => ({fetch() {}}), validate: () => false, blockedValue: () => undefined}]
        });
        expect(adapter.start()).toEqual(expect.arrayContaining([{dataClass: "telemetry", state: "Unsupported", summary: expect.any(String)}]));
        expect(scope.counts()).toEqual({});
        expect(resolvePrivacyMethodTarget({fetch() {}}, "track")).toBeUndefined();
        expect(privacyCategoryBlocked(defaultStrictPrivacyPreferences(), "crash-reporting")).toBeTrue();
    });

    test("keeps only exact reviewed local-only addons under Strict Privacy", () => {
        const catalog = [
            {fileName: "Local.plugin.js", sourceSha256: "a".repeat(64), networkBehavior: ["no-static-network-signal"], verification: {security: "STATIC_REVIEWED"}},
            {fileName: "Remote.plugin.js", sourceSha256: "b".repeat(64), networkBehavior: ["fetch", "network-api"], verification: {security: "STATIC_REVIEWED"}},
            {fileName: "Unknown.plugin.js", sourceSha256: null, networkBehavior: ["CODE_REVIEW_REQUIRED"], verification: {security: "PENDING"}}
        ] as const;
        expect(classifyCommunityAddonOutbound({fileName: "Local.plugin.js", integrityMatched: true}, catalog)).toBe("local-only");
        expect(classifyCommunityAddonOutbound({fileName: "Remote.plugin.js", integrityMatched: true}, catalog)).toBe("outbound");
        expect(classifyCommunityAddonOutbound({fileName: "Local.plugin.js", integrityMatched: false}, catalog)).toBe("undeclared");
        expect(planStrictCommunityAddonPolicy([
            {fileName: "Local.plugin.js", integrityMatched: true},
            {fileName: "Remote.plugin.js", integrityMatched: true},
            {fileName: "Unknown.plugin.js", integrityMatched: true},
            {fileName: "..\\escape.plugin.js", integrityMatched: true}
        ], catalog).map(item => [item.fileName, item.action, item.disposition])).toEqual([
            ["Local.plugin.js", "keep", "local-only"],
            ["Remote.plugin.js", "disable", "outbound"],
            ["Unknown.plugin.js", "disable", "undeclared"]
        ]);
    });

    test("keeps automatic update policy off until explicitly enabled and disposes listeners", () => {
        setSolcordAutomaticUpdatesAllowed(false);
        let changes = 0;
        const release = onSolcordUpdatePolicyChange(() => changes++);
        expect(solcordAutomaticUpdatesAllowed()).toBeFalse();
        setSolcordAutomaticUpdatesAllowed(true);
        expect(solcordAutomaticUpdatesAllowed()).toBeTrue();
        expect(changes).toBe(1);
        setSolcordAutomaticUpdatesAllowed(true);
        expect(changes).toBe(1);
        release();
        setSolcordAutomaticUpdatesAllowed(false);
        expect(changes).toBe(1);
    });

    test("keeps addon catalog traffic manual while preserving explicit store browsing", () => {
        const store = fs.readFileSync(path.join(ROOT, "src/betterdiscord/modules/addonstore.ts"), "utf8");
        const page = fs.readFileSync(path.join(ROOT, "src/betterdiscord/ui/settings/addonstore.tsx"), "utf8");
        const initialize = store.slice(store.indexOf("    public initialize()"), store.indexOf("    private _cache"));
        const request = store.slice(store.indexOf("    async requestAddons"), store.indexOf("    async updaterRequestAddons"));
        setSolcordAutomaticUpdatesAllowed(false);
        expect(solcordAutomaticCatalogRequestsAllowed(true, true)).toBeFalse();
        expect(solcordCatalogRetryAllowed(true)).toBeFalse();
        setSolcordAutomaticUpdatesAllowed(true);
        expect(solcordAutomaticCatalogRequestsAllowed(false, false)).toBeFalse();
        expect(solcordAutomaticCatalogRequestsAllowed(true, false)).toBeTrue();
        expect(solcordAutomaticCatalogRequestsAllowed(false, true)).toBeTrue();
        expect(solcordCatalogRetryAllowed(false)).toBeFalse();
        expect(solcordCatalogRetryAllowed(true)).toBeTrue();
        setSolcordAutomaticUpdatesAllowed(false);
        expect(initialize).toContain("solcordAutomaticCatalogRequestsAllowed(");
        expect(initialize).toContain("this.requestAddons(!this.hasDoneFirstRequest, true)");
        expect(request).toContain("solcordCatalogRetryAllowed(automatic)");
        expect(request).toContain("this.requestAddons(false, true)");
        expect(request).toContain("if (automatic && !solcordAutomaticUpdatesAllowed())");
        expect(request).toContain("signal: controller.signal");
        expect(request).toContain("if (controller.signal.aborted)");
        expect(request).toContain("resolve();");
        expect(store).toContain("async openStore()");
        expect(store).toContain("this.requestAddons(true, false)");
        expect(store).toContain("this.#activeRequest?.automatic");
        expect(store).toContain("controller.abort(new Error(\"SolcordAutomaticCatalogRequestDisabled\"))");
        expect(store).toContain("if (this.addons.length || this.loading) return;");
        expect(store).toContain("if (this.#activeRequest === activeRequest) this.#activeRequest = undefined;");
        expect(page).toContain("void AddonStore.openStore()");
    });
});
