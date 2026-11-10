// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs";
import path from "node:path";
import {app, type Session} from "electron";
import {defaultStrictPrivacyPreferences, normalizePrivacyPreferences, type SolcordPrivacyPreferences} from "@common/solcord/privacy";
import {resolveSolcordBetterDiscordRoot} from "./solcord-data-root";
import {assertRegularOwnedPath} from "./addon-files";
import {setSolcordRequestBlocker} from "./web-request-policy";

let preferences = defaultStrictPrivacyPreferences();
const installed = new WeakSet<Session>();
export function optionalDiscordRequestClass(value: string): "telemetry" | "crash-reporting" | undefined {
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.port || url.username || url.password) return;
        if (["discord.com", "ptb.discord.com", "canary.discord.com", "discordapp.com"].includes(url.hostname)
            && /^\/api\/(?:v[0-9]+\/)?(?:science|track)\/?$/.test(url.pathname)) return "telemetry";
        if ((url.hostname === "sentry.io" || url.hostname.endsWith(".ingest.sentry.io") || url.hostname === "sentry.discord.com" || url.hostname === "sentry.discordapp.com")
            && /^\/api\/[0-9]+\/(?:store|envelope)\/?$/.test(url.pathname)) return "crash-reporting";
    }
    catch {/* Unknown destinations are never classified by a loose substring. */}
}
export function optionalDiscordRequestBlocked(url: string, policy: SolcordPrivacyPreferences): boolean {
    const kind = optionalDiscordRequestClass(url);
    return kind === "telemetry" ? policy.telemetry === "block" : kind === "crash-reporting" && policy.crashReporting === "block-optional";
}
export function persistedNativePrivacy(document: unknown): SolcordPrivacyPreferences {
    const saved = document as {schemaVersion?: unknown; productPreferences?: {privacy?: Partial<SolcordPrivacyPreferences>;};} | null;
    const policy = saved?.productPreferences?.privacy;
    if (!saved || typeof saved.schemaVersion !== "number" || saved.schemaVersion < 7 || !policy
        || policy.migrationPending !== false || typeof policy.migratedAt !== "number" || !Number.isFinite(policy.migratedAt) || policy.migratedAt < 0) return defaultStrictPrivacyPreferences();
    return normalizePrivacyPreferences(policy);
}

/** Bound allocation and detect replacement/growth on the descriptor actually read. */
export function readBoundedNativePrivacyFile(file: string, maximumBytes = 8 * 1024 * 1024): unknown {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 8 * 1024 * 1024) throw new RangeError("Invalid native privacy file limit.");
    const descriptor = fs.openSync(file, "r");
    let buffer: Buffer | undefined;
    try {
        const before = fs.fstatSync(descriptor, {bigint: true});
        const named = fs.lstatSync(file, {bigint: true});
        if (!before.isFile() || !named.isFile() || named.isSymbolicLink() || before.dev !== named.dev || before.ino !== named.ino
            || before.size < 1n || before.size > BigInt(maximumBytes)) throw new TypeError("Invalid native privacy file.");
        buffer = Buffer.alloc(Number(before.size) + 1);
        let used = 0;
        while (used < buffer.length) {
            const count = fs.readSync(descriptor, buffer, used, buffer.length - used, used);
            if (count === 0) break;
            used += count;
        }
        const after = fs.fstatSync(descriptor, {bigint: true});
        if (BigInt(used) !== before.size || after.size !== before.size || after.mtimeNs !== before.mtimeNs) throw new Error("Native privacy file changed during read.");
        return JSON.parse(buffer.subarray(0, used).toString("utf8"));
    }
    finally {buffer?.fill(0); fs.closeSync(descriptor);}
}

function loadPersistedPrivacy(): SolcordPrivacyPreferences {
    try {
        const root = resolveSolcordBetterDiscordRoot(app.getPath("userData"));
        const channel = process.env.DISCORD_RELEASE_CHANNEL ?? "stable";
        if (!["stable", "ptb", "canary", "development"].includes(channel)) throw new Error("Invalid channel");
        const file = path.join(root, "data", channel, "solcord.json");
        assertRegularOwnedPath(root, file);
        const saved = readBoundedNativePrivacyFile(file);
        return persistedNativePrivacy(saved);
    }
    catch {return defaultStrictPrivacyPreferences();}
}

export function synchronizeNativePrivacy(value: unknown): Pick<SolcordPrivacyPreferences, "telemetry" | "crashReporting"> {
    const requested = normalizePrivacyPreferences(value);
    const durable = loadPersistedPrivacy();
    // An addon-accessible IPC call cannot grant new outbound permissions. Only
    // durable explicit consent may relax protection; strengthening is immediate.
    preferences = {...durable,
        telemetry: requested.telemetry === "block" ? "block" : durable.telemetry,
        crashReporting: requested.crashReporting === "block-optional" ? "block-optional" : durable.crashReporting};
    return {telemetry: preferences.telemetry, crashReporting: preferences.crashReporting};
}

export function installNativePrivacyGuard(session: Session | undefined): void {
    if (!session?.webRequest || installed.has(session)) return;
    preferences = loadPersistedPrivacy();
    setSolcordRequestBlocker(session, {urls: ["https://discord.com/*", "https://ptb.discord.com/*", "https://canary.discord.com/*", "https://discordapp.com/*", "https://sentry.io/*", "https://*.ingest.sentry.io/*", "https://sentry.discord.com/*", "https://sentry.discordapp.com/*"]}, details => optionalDiscordRequestBlocked(details.url, preferences));
    installed.add(session);
}
