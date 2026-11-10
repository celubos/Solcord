// SPDX-License-Identifier: Apache-2.0

import {describe, expect, test} from "bun:test";
import {Script} from "node:vm";
import {EventEmitter} from "node:events";
import {RendererStartupWatchdog, rendererStartupFailureScript} from "../../src/electron/main/modules/renderer-startup-health";
import {isTrustedSolcordIpcUrl} from "../../src/electron/main/modules/solcord-ipc-authority";
import {RendererDocumentInjectionGuard} from "../../src/electron/main/modules/renderer-document-guard";
import {mainStartupMethodFixture} from "../fixtures/solcord-method-fixture";

const tick = () => new Promise(resolve => setTimeout(resolve, 15));

describe("main-owned renderer startup health", () => {
    test("navigation replaces a pending timer and successful injection or close cancels it", async () => {
        const watchdog = new RendererStartupWatchdog<object>(); const owner = {}; const calls: string[] = [];
        watchdog.begin(owner, () => calls.push("old"), 5);
        watchdog.begin(owner, () => calls.push("new"), 5);
        await tick(); expect(calls).toEqual(["new"]);
        watchdog.begin(owner, () => calls.push("complete"), 5); watchdog.cancel(owner); watchdog.cancel(owner);
        await tick(); expect(calls).toEqual(["new"]);
        const other = {}; watchdog.begin(owner, () => calls.push("closed"), 5);
        watchdog.begin(other, () => calls.push("other"), 5); watchdog.cancel(owner);
        await tick(); expect(calls).toEqual(["new", "other"]);
    });

    test("the actual fixed notice script works before imports, deduplicates and remains dismissible", () => {
        const script = new Script(rendererStartupFailureScript());
        script.runInNewContext({document}); script.runInNewContext({document});
        expect(document.querySelectorAll("#solcord-startup-failure")).toHaveLength(1);
        const notice = document.getElementById("solcord-startup-failure")!;
        expect(notice.getAttribute("role")).toBe("alert"); expect(notice.textContent).toContain("Solcord Setup");
        notice.querySelector("button")!.click(); expect(document.getElementById("solcord-startup-failure")).toBeNull();
    });

    test("shipping window setup starts health checks only for trusted documents and closes every owner", async () => {
        const browserWindow = new EventEmitter(); let url = ""; const scripts: string[] = [];
        const webContents = Object.assign(new EventEmitter(), {isDestroyed: () => false, getURL: () => url, mainFrame: {async executeJavaScript(script: string) {scripts.push(script);}}});
        Object.assign(browserWindow, {webContents});
        const callbacks: Array<() => void> = []; let cancellations = 0;
        const owner = {
            initializedWindows: new WeakSet(),
rendererDocuments: new RendererDocumentInjectionGuard<object>(),
            rendererHealth: {begin(_window: object, callback: () => void) {callbacks.push(callback);}, cancel() {cancellations++;}},
            protocolListenersRegistered: true
        };
        const setup = mainStartupMethodFixture("setup", {
            process: {env: {}, platform: "win32"},
require: () => ({releaseChannel: "stable"}),
buildInfoFile: "fixture-build-info",
bdFolder: "D:/fixture/BetterDiscord/",
appPath: "D:/fixture/runtime",
            electron: {app: {getPath: () => "D:/fixture/profile/discord"}},
systemPreferences: new EventEmitter(),
            isSolcordAcceptanceMode: () => true,
isTrustedSolcordIpcUrl,
rendererStartupFailureScript,
IPCEvents: {},
hasCrashed: false
        });
        setup.call(owner, browserWindow); setup.call(owner, browserWindow);
        expect(webContents.listenerCount("did-navigate")).toBe(1);
        webContents.emit("did-navigate", {}, "https://untrusted.invalid/"); expect(callbacks).toHaveLength(0);
        url = "https://discord.com/login"; webContents.emit("did-navigate", {}, url); expect(callbacks).toHaveLength(1);
        callbacks[0](); await Promise.resolve(); expect(scripts).toHaveLength(1);
        url = "https://untrusted.invalid/"; callbacks[0](); await Promise.resolve(); expect(scripts).toHaveLength(1);
        url = "https://discord.com/login";
        const originalGetUrl = webContents.getURL;
        webContents.getURL = () => {throw Error("native-window-destroyed");};
        expect(() => callbacks[0]()).not.toThrow();
        webContents.getURL = originalGetUrl;
        const frame = webContents.mainFrame;
        Object.defineProperty(webContents, "mainFrame", {configurable: true, get() {throw Error("native-frame-destroyed");}});
        expect(() => callbacks[0]()).not.toThrow();
        Object.defineProperty(webContents, "mainFrame", {configurable: true, value: {executeJavaScript() {throw Error("native-execution-failed");}}});
        expect(() => callbacks[0]()).not.toThrow();
        Object.defineProperty(webContents, "mainFrame", {configurable: true, value: frame});
        browserWindow.emit("closed"); expect(cancellations).toBe(3);
        expect(webContents.listenerCount("did-navigate")).toBe(0);
        expect(owner.rendererDocuments.claim(webContents)).toEqual({status: "unbound"});
    });
});
