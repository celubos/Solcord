// SPDX-License-Identifier: Apache-2.0

import {createPrivacyDecisionReceipt, type OutboundDataClass, type PrivacyCapabilityRecord, type PrivacyDecisionReceipt, type SolcordPrivacyPreferences} from "@common/solcord/privacy";
import type {SolcordDisposalScope} from "./disposal";

const PATCH_CALLER = "Solcord~PrivacyPolicy";
const METHOD_KEY = /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/;

type OutboundMethod = (...args: unknown[]) => unknown;

export interface PrivacyMethodTarget {
    module: Record<string, unknown>;
    key: string;
}

export interface PrivacyMethodSpec {
    id: string;
    dataClass: Extract<OutboundDataClass, "telemetry" | "crash-reporting" | "activity-discovery">;
    key: string;
    lookup(): unknown;
    validate(target: PrivacyMethodTarget): boolean;
    blockedValue(thisObject: unknown, args: unknown[]): unknown;
    intercept?(thisObject: unknown, args: unknown[], original: OutboundMethod): unknown;
}

export interface PrivacyPolicyPatcher {
    instead(
        caller: string,
        module: Record<string, unknown>,
        key: string,
        callback: (thisObject: unknown, args: unknown[], original: OutboundMethod) => unknown,
        options: {forcePatch: false;}
    ): (() => void) | null | undefined;
}

export interface PrivacyPolicyAdapterOptions {
    scope: SolcordDisposalScope;
    patcher: PrivacyPolicyPatcher;
    specs: readonly PrivacyMethodSpec[];
    preferences(): SolcordPrivacyPreferences;
    receipt(receipt: PrivacyDecisionReceipt): void;
    now?(): number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return (typeof value === "object" && value !== null) || typeof value === "function";
}

function target(value: unknown, key: string): PrivacyMethodTarget | undefined {
    if (!isRecord(value) || !METHOD_KEY.test(key) || typeof value[key] !== "function") return;
    return {module: value, key};
}

export function privacyCategoryBlocked(preferences: SolcordPrivacyPreferences, dataClass: PrivacyMethodSpec["dataClass"]): boolean {
    if (dataClass === "telemetry") return preferences.telemetry === "block";
    if (dataClass === "crash-reporting") return preferences.crashReporting === "block-optional";
    return preferences.activityDiscovery === "block";
}

export function resolvePrivacyMethodTarget(value: unknown, key: string): PrivacyMethodTarget | undefined {
    return target(value, key);
}

/**
 * Patches only explicitly named, structurally validated optional outbound
 * methods. It never patches fetch, XMLHttpRequest, WebSocket, or core Discord
 * traffic and never inspects arguments or payloads.
 */
export class SolcordPrivacyPolicyAdapter {
    readonly #options: PrivacyPolicyAdapterOptions;
    #records: PrivacyCapabilityRecord[] = [];
    #sequence = 0;
    #started = false;
    #diagnosticsComplete = true;

    constructor(options: PrivacyPolicyAdapterOptions) {
        this.#options = options;
    }

    records(): PrivacyCapabilityRecord[] {
        return structuredClone(this.#records);
    }

    get diagnosticsComplete(): boolean {return this.#diagnosticsComplete;}

    start(): PrivacyCapabilityRecord[] {
        if (this.#options.scope.disposed) return [];
        if (this.#started) return this.records();
        this.#started = true;
        const grouped = new Map<PrivacyMethodSpec["dataClass"], PrivacyMethodSpec[]>();
        for (const spec of this.#options.specs) {
            if (!spec.id || !METHOD_KEY.test(spec.key)) continue;
            const list = grouped.get(spec.dataClass) ?? [];
            list.push(spec);
            grouped.set(spec.dataClass, list);
        }

        const records: PrivacyCapabilityRecord[] = [];
        for (const dataClass of ["telemetry", "crash-reporting", "activity-discovery"] as const) {
            const specs = grouped.get(dataClass) ?? [];
            if (!privacyCategoryBlocked(this.#options.preferences(), dataClass)) {
                records.push({dataClass, state: "NeedsReview", summary: "Allowed by the current privacy profile."});
                this.#record(dataClass, "allow", "not-applicable");
                continue;
            }
            if (!specs.length) {
                records.push({dataClass, state: "Unsupported", summary: "No validated adapter is available on this Discord build."});
                this.#record(dataClass, "hold", "adapter-drift");
                continue;
            }

            let protectedCount = 0;
            for (const spec of specs) {
                let candidate: unknown;
                try {candidate = spec.lookup();}
                catch {candidate = undefined;}
                const resolved = target(candidate, spec.key);
                let valid = false;
                try {valid = Boolean(resolved && spec.validate(resolved));}
                catch {valid = false;}
                if (!resolved || !valid) continue;

                let release: (() => void) | null | undefined;
                try {
                    release = this.#options.patcher.instead(PATCH_CALLER, resolved.module, resolved.key, (thisObject, args, original) => {
                        if (!privacyCategoryBlocked(this.#options.preferences(), dataClass)) return Reflect.apply(original, thisObject, args);
                        if (spec.intercept) return spec.intercept(thisObject, args, original);
                        return spec.blockedValue(thisObject, args);
                    }, {forcePatch: false});
                }
                catch {continue;}
                if (typeof release !== "function") continue;
                this.#options.scope.own(release, "patch");
                protectedCount++;
            }

            const state = protectedCount === specs.length ? "Protected" : protectedCount ? "Degraded" : "Unsupported";
            records.push({
                dataClass,
                state,
                summary: state === "Protected"
                    ? `Blocked in ${protectedCount === 1 ? "the one place" : `all ${protectedCount} places`} Solcord knows Discord sends this.`
                    : state === "Degraded"
                        ? `Blocked in ${protectedCount} of ${specs.length} known places. A Discord update changed the others, so they are not blocked yet.`
                        : "A Discord update changed how this works, so Solcord could not block it safely and left it alone."
            });
            this.#record(dataClass, state === "Protected" ? "block" : "hold", state === "Protected" ? "applied" : "adapter-drift");
        }
        this.#records = records;
        return this.records();
    }

    #record(dataClass: PrivacyMethodSpec["dataClass"], decision: "allow" | "block" | "hold", result: "applied" | "not-applicable" | "adapter-drift"): void {
        try {this.#options.receipt(createPrivacyDecisionReceipt(++this.#sequence, (this.#options.now ?? Date.now)(), dataClass, decision, result));}
        catch {this.#diagnosticsComplete = false;}
    }
}
