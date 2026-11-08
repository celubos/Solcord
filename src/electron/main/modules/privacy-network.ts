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

function loadPersistedPrivacy(): SolcordPrivacyPreferences {
    try {
        const root = resolveSolcordBetterDiscordRoot(app.getPath("userData"));
        const channel = process.env.DISCORD_RELEASE_CHANNEL ?? "stable";
        if (!["stable", "ptb", "canary", "development"].includes(channel)) throw new Error("Invalid channel");
        const file = path.join(root, "data", channel, "solcord.json");
        assertRegularOwnedPath(root, file);
        const stat = fs.lstatSync(file);
        if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error("Invalid privacy settings");
        const saved = JSON.parse(fs.readFileSync(file, "utf8"));
        return persistedNativePrivacy(saved);
    }
    catch {return defaultStrictPrivacyPreferences();}
}

export function synchronizeNativePrivacy(value: unknown): void {
    const requested = normalizePrivacyPreferences(value);
    const durable = loadPersistedPrivacy();
    // An addon-accessible IPC call cannot grant new outbound permissions. Only
    // durable explicit consent may relax protection; strengthening is immediate.
    preferences = {...durable,
        telemetry: requested.telemetry === "block" ? "block" : durable.telemetry,
        crashReporting: requested.crashReporting === "block-optional" ? "block-optional" : durable.crashReporting};
}

export function installNativePrivacyGuard(session: Session | undefined): void {
    if (!session?.webRequest || installed.has(session)) return;
    preferences = loadPersistedPrivacy();
    setSolcordRequestBlocker(session, {urls: ["https://discord.com/*", "https://ptb.discord.com/*", "https://canary.discord.com/*", "https://discordapp.com/*", "https://sentry.io/*", "https://*.ingest.sentry.io/*", "https://sentry.discord.com/*", "https://sentry.discordapp.com/*"]}, details => optionalDiscordRequestBlocked(details.url, preferences));
    installed.add(session);
}
