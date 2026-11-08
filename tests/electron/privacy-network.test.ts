import {expect, mock, test} from "bun:test";
const electron = {app: {getPath: () => {throw new Error("No user profile in this test");}}};
mock.module("electron", () => ({"default": electron, ...electron}));
const {installNativePrivacyGuard, optionalDiscordRequestBlocked, synchronizeNativePrivacy, persistedNativePrivacy} = await import("../../src/electron/main/modules/privacy-network");
const {defaultStrictPrivacyPreferences, applyPrivacyProfile} = await import("../../src/common/solcord/privacy");
test("strict blocks exact optional endpoints and preserves core Discord traffic", () => {
    const policy = defaultStrictPrivacyPreferences();
    for (const url of ["https://discord.com/api/v9/science", "https://canary.discord.com/api/v10/track", "https://123.ingest.sentry.io/api/321/envelope/"]) expect(optionalDiscordRequestBlocked(url, policy)).toBe(true);
    for (const url of ["https://discord.com/api/v9/channels/123/messages", "https://discord.com/api/v9/auth/login", "wss://gateway.discord.gg/", "https://cdn.discordapp.com/attachments/123/media.webm", "https://discord.com/api/v9/users/@me", "https://discord.com/assets/app.js", "https://discord.com.evil.invalid/api/v9/science", "https://example.invalid/science", "https://discord.com/api/v9/channels/science/messages"]) expect(optionalDiscordRequestBlocked(url, policy)).toBe(false);
});
test("the native guard starts strict before any renderer and updates without collecting request content", () => {
    let handler: any, calls = 0;
    const session = {webRequest: {onBeforeRequest: (_filter: unknown, callback: unknown) => {handler = callback; calls++;}, onHeadersReceived() {}}};
    installNativePrivacyGuard(session as any); installNativePrivacyGuard(session as any); expect(calls).toBe(1);
    let canceled = false;
    handler({url: "https://discord.com/api/v9/science"}, (result: {cancel: boolean;}) => {canceled = result.cancel;}); expect(canceled).toBe(true);
    synchronizeNativePrivacy(applyPrivacyProfile(defaultStrictPrivacyPreferences(), "standard", 42));
    handler({url: "https://discord.com/api/v9/science"}, (result: {cancel: boolean;}) => {canceled = result.cancel;}); expect(canceled).toBe(true);
    synchronizeNativePrivacy(defaultStrictPrivacyPreferences());
});
test("permissive startup requires a durable explicit privacy choice", () => {
    const standard = applyPrivacyProfile(defaultStrictPrivacyPreferences(), "standard", 42);
    for (const document of [{schemaVersion: 6, productPreferences: {privacy: standard}}, {schemaVersion: 10, productPreferences: {privacy: {...standard, migratedAt: undefined}}}, {schemaVersion: 10, productPreferences: {privacy: {...standard, migrationPending: true}}}]) expect(persistedNativePrivacy(document)).toEqual(defaultStrictPrivacyPreferences());
    expect(persistedNativePrivacy({schemaVersion: 10, productPreferences: {privacy: standard}}).telemetry).toBe("allow");
});
