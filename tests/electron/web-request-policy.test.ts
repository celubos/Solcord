import {describe, expect, mock, test} from "bun:test";
import type {Session} from "electron";
import {installSessionWebRequestPolicy, webRequestFilterMatches, webRequestUrlMatches} from "../../src/electron/main/modules/web-request-policy";

type Before = (details: Electron.OnBeforeRequestListenerDetails, callback: (response: Electron.CallbackResponse) => void) => void;
type Headers = (details: Electron.OnHeadersReceivedListenerDetails, callback: (response: Electron.HeadersReceivedResponse) => void) => void;

function sessionFixture() {
    let before: Before | undefined;
    let headers: Headers | undefined;
    let registrations = 0;
    const webRequest = {
        onBeforeRequest(_filter: Electron.WebRequestFilter | null, listener?: Before | null) {before = listener ?? undefined; registrations++;},
        onHeadersReceived(_filter: Electron.WebRequestFilter | null, listener?: Headers | null) {headers = listener ?? undefined;}
    };
    const session = {webRequest} as unknown as Session;
    return {
        session,
        get registrations() {return registrations;},
        before(url: string, resourceType = "script"): Promise<Electron.CallbackResponse> {
            return new Promise(resolve => before ? before({url, resourceType} as Electron.OnBeforeRequestListenerDetails, resolve) : resolve({}));
        },
        headers(url: string, resourceType = "mainFrame", responseHeaders: Record<string, string[]> = {}): Promise<Electron.HeadersReceivedResponse> {
            return new Promise(resolve => headers ? headers({url, resourceType, responseHeaders} as Electron.OnHeadersReceivedListenerDetails, resolve) : resolve({}));
        }
    };
}

const electron = {app: {whenReady: async () => {}, getPath: () => {throw new Error("No user profile in this fixture");}}, session: {defaultSession: undefined as Session | undefined}};
mock.module("electron", () => ({"default": electron, ...electron}));
const {installNativePrivacyGuard} = await import("../../src/electron/main/modules/privacy-network");
const {default: CSP} = await import("../../src/electron/main/modules/csp");

describe("Composed native webRequest ownership", () => {
    test("a later core HTTP-CDT registration and null-clear preserve strict native blocking", async () => {
        const fixture = sessionFixture();
        installSessionWebRequestPolicy(fixture.session);
        installNativePrivacyGuard(fixture.session);
        let hostCalls = 0;
        // The shipping Discord core installs this after mainWindow construction.
        fixture.session.webRequest.onBeforeRequest({urls: ["https://discord.com/assets/web.*.js*"]}, (details, callback) => {
            hostCalls++;
            queueMicrotask(() => callback({redirectURL: `${details.url}?cdt=1`}));
        });
        expect(await fixture.before("https://discord.com/api/v9/science", "xhr")).toEqual({cancel: true});
        expect(hostCalls).toBe(0);
        expect(await fixture.before("https://discord.com/assets/web.abcd.js")).toEqual({redirectURL: "https://discord.com/assets/web.abcd.js?cdt=1"});
        expect(hostCalls).toBe(1);
        expect(await fixture.before("https://other.invalid/assets/web.abcd.js")).toEqual({});
        expect(hostCalls).toBe(1);
        fixture.session.webRequest.onBeforeRequest(null);
        expect(await fixture.before("https://discord.com/api/v9/science", "xhr")).toEqual({cancel: true});
        expect(await fixture.before("https://discord.com/assets/web.abcd.js")).toEqual({});
    });

    test("preserves host cancellation, last-registration semantics, excludes and resource types", async () => {
        const fixture = sessionFixture();
        installSessionWebRequestPolicy(fixture.session);
        installNativePrivacyGuard(fixture.session);
        let calls = 0;
        fixture.session.webRequest.onBeforeRequest({urls: ["*://*.example.com/*"], excludeUrls: ["https://example.com/skip/*"], types: ["xhr"]}, (_details, callback) => {calls++; callback({cancel: true});});
        expect(await fixture.before("https://example.com:8443/data", "xhr")).toEqual({cancel: true});
        expect(await fixture.before("https://example.com/skip/data", "xhr")).toEqual({});
        expect(await fixture.before("https://example.com/data", "image")).toEqual({});
        expect(calls).toBe(1);
        fixture.session.webRequest.onBeforeRequest((_details, callback) => callback({redirectURL: "https://safe.invalid/"}));
        expect(await fixture.before("https://example.com/data", "xhr")).toEqual({redirectURL: "https://safe.invalid/"});
        expect(calls).toBe(1);
    });

    test("CSP amendment uses late host security headers and retains status, report-only and unrelated headers", async () => {
        const fixture = sessionFixture();
        installSessionWebRequestPolicy(fixture.session);
        electron.session.defaultSession = fixture.session;
        await CSP.remove();
        const security = {"Content-Security-Policy": ["default-src 'none'; script-src 'self'"], "Content-Security-Policy-Report-Only": ["default-src 'self'"], "X-Frame-Options": ["DENY"], "Permissions-Policy": ["camera=()"]};
        fixture.session.webRequest.onHeadersReceived({urls: ["https://*/*"]}, (_details, callback) => callback({cancel: false, responseHeaders: security, statusLine: "HTTP/1.1 200 OK"}));
        const result = await fixture.headers("https://discord.com/channels/1/2", "mainFrame", {"Content-Security-Policy": ["default-src *"]});
        expect(result.statusLine).toBe("HTTP/1.1 200 OK");
        expect(result.cancel).toBeFalse();
        expect(result.responseHeaders?.["Content-Security-Policy"]).toEqual([expect.stringContaining("script-src 'self' solcord:")]);
        for (const key of ["X-Frame-Options", "Permissions-Policy", "Content-Security-Policy-Report-Only"]) expect(result.responseHeaders?.[key]).toEqual(security[key as keyof typeof security]);
        expect(security["Content-Security-Policy"]).toEqual(["default-src 'none'; script-src 'self'"]);
        for (const [url, resourceType] of [["https://elsewhere.invalid/channels/1/2", "mainFrame"], ["https://discord.com/channels/1/2", "subFrame"]]) {
            expect((await fixture.headers(url, resourceType)).responseHeaders).toBe(security);
        }
        fixture.session.webRequest.onHeadersReceived((_details, callback) => callback({cancel: true, responseHeaders: security, statusLine: "HTTP/1.1 403 Forbidden"}));
        expect(await fixture.headers("https://discord.com/channels/1/2")).toEqual({cancel: true, responseHeaders: security, statusLine: "HTTP/1.1 403 Forbidden"});
        fixture.session.webRequest.onHeadersReceived(null);
        const original = {"Content-Security-Policy": ["default-src 'self'"]};
        expect((await fixture.headers("https://discord.com/channels/1/2", "mainFrame", original)).responseHeaders?.["Content-Security-Policy"]).toEqual([expect.stringContaining("solcord:")]);
        expect(original["Content-Security-Policy"]).toEqual(["default-src 'self'"]);
    });

    test("matches Chromium host, scheme, path and port semantics without broadening host scope", () => {
        for (const value of ["http://example.com/a", "https://example.com:8443/a", "https://sub.example.com/a"]) expect(webRequestUrlMatches("*://*.example.com/*", value)).toBeTrue();
        for (const value of ["wss://example.com/a", "https://evilexample.com/a", "https://example.com.evil.invalid/a"]) expect(webRequestUrlMatches("*://*.example.com/*", value)).toBeFalse();
        expect(webRequestUrlMatches("https://example.com:443/*", "https://example.com/a")).toBeTrue();
        expect(webRequestUrlMatches("https://example.com:8443/*", "https://example.com/a")).toBeFalse();
        expect(webRequestUrlMatches("https://example.com:*/assets/web.*.js*", "https://example.com:9443/assets/web.123.js?cdt=1")).toBeTrue();
        expect(webRequestUrlMatches("file:///local/*", "file:///local/file.txt")).toBeTrue();
        expect(webRequestFilterMatches({urls: ["<all_urls>"], excludeUrls: ["https://*.example.com/private/*"]}, {url: "https://example.com/private/a"})).toBeFalse();
    });
});
