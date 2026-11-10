import {afterEach, describe, expect, test} from "bun:test";
import {EventEmitter} from "node:events";
import {nativeIpcHandlerFixture} from "../fixtures/solcord-method-fixture";

class FixtureWindow extends EventEmitter {
    static instances: FixtureWindow[] = [];
    static load: () => Promise<void> = async () => {};
    webContents = new EventEmitter();
    destroyed = false;
    constructor(readonly options: Electron.BrowserWindowConstructorOptions) {super(); FixtureWindow.instances.push(this);}
    loadURL() {return FixtureWindow.load();}
    isDestroyed() {return this.destroyed;}
    close() {this.destroy();}
    destroy() {this.destroyed = true; this.emit("closed");}
}

const openWindow = nativeIpcHandlerFixture("createBrowserWindow", {BrowserWindow: FixtureWindow});
afterEach(() => {FixtureWindow.instances.splice(0); FixtureWindow.load = async () => {};});

describe("Native browser-window IPC lifetime", () => {
    test("ordinary user close settles the invocation and removes navigation listeners", async () => {
        const pending = openWindow({}, "https://example.invalid/") as Promise<void>;
        const window = FixtureWindow.instances[0];
        expect(window.webContents.listenerCount("did-navigate")).toBe(1);
        window.close(); await pending;
        expect(window.webContents.listenerCount("did-navigate")).toBe(0);
        expect(window.listenerCount("closed")).toBe(0);
    });

    test("the confirmed callback URL closes once while preserving safe window preferences", async () => {
        const pending = openWindow({}, "https://example.invalid/", {closeOnUrl: "https://example.invalid/done", windowOptions: {webPreferences: {nodeIntegration: true, preload: "untrusted.js", webSecurity: false}}}) as Promise<void>;
        const window = FixtureWindow.instances[0];
        window.webContents.emit("did-navigate", {}, "https://elsewhere.invalid/done");
        expect(window.isDestroyed()).toBeFalse();
        window.webContents.emit("did-navigate", {}, "https://example.invalid/done");
        await pending;
        expect(window.isDestroyed()).toBeTrue();
        expect(window.options.webPreferences).toMatchObject({nodeIntegration: false, preload: undefined, webSecurity: true, sandbox: true, contextIsolation: true});
        expect(window.webContents.listenerCount("did-navigate")).toBe(0);
    });

    test("asynchronous and synchronous load failures reject without leaking an orphan window", async () => {
        for (const synchronous of [false, true]) {
            FixtureWindow.load = synchronous ? () => {throw new Error("load failed");} : async () => {throw new Error("load failed");};
            const pending = openWindow({}, "https://example.invalid/") as Promise<void>;
            await expect(pending).rejects.toThrow("load failed");
            const window = FixtureWindow.instances.at(-1)!;
            expect(window.isDestroyed()).toBeTrue();
            expect(window.webContents.listenerCount("did-navigate")).toBe(0);
            expect(window.listenerCount("closed")).toBe(0);
        }
    });

    test("a late aborted navigation after manual close is handled without a second settlement", async () => {
        let failLoad!: (error: Error) => void;
        FixtureWindow.load = () => new Promise((_resolve, reject) => {failLoad = reject;});
        const pending = openWindow({}, "https://example.invalid/") as Promise<void>;
        FixtureWindow.instances[0].close(); await pending;
        failLoad(new Error("closed navigation aborted"));
        await Promise.resolve(); await Promise.resolve();
        expect(FixtureWindow.instances[0].isDestroyed()).toBeTrue();
    });

    test("an undefined load rejection still rejects and destroys the failed window", async () => {
        FixtureWindow.load = () => Promise.reject(undefined);
        let rejected = false;
        await (openWindow({}, "https://example.invalid/") as Promise<void>).catch(error => {rejected = true; expect(error).toBeUndefined();});
        expect(rejected).toBeTrue();
        expect(FixtureWindow.instances[0].isDestroyed()).toBeTrue();
    });
});
