import {BrowserWindow, dialog, shell, app, clipboard, type BrowserWindowConstructorOptions, type WebContents} from "electron";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "path";
import {pathToFileURL} from "url";
import * as IPCEvents from "@common/constants/ipcevents";
import {safeAddonFileName} from "@common/solcord/addon-file-policy";
import {resolveSolcordBetterDiscordRoot} from "./solcord-data-root";
import {assertRegularOwnedPath} from "./addon-files";

interface Windows {
    "custom-css"?: BrowserWindow,
    theme: Record<string, BrowserWindow>,
    plugin: Record<string, BrowserWindow>,
}

export default class Editor {
    private static windows: Windows = {theme: {}, plugin: {}};

    // For eventually allow bd to have intellisense in the external window
    public static _options: BrowserWindowConstructorOptions | null;

    public static open(type: "theme" | "plugin", filename: string): WebContents;
    public static open(type: "custom-css"): WebContents;
    public static open(type: "custom-css" | "theme" | "plugin", filename?: string): WebContents {
        if (!["custom-css", "theme", "plugin"].includes(type)) throw new TypeError("Invalid editor kind.");
        if (type !== "custom-css") safeAddonFileName(filename!, type);
        const root = resolveSolcordBetterDiscordRoot(app.getPath("userData"));
        const channel = process.env.DISCORD_RELEASE_CHANNEL ?? "stable";
        if (!["stable", "ptb", "canary", "development"].includes(channel)) throw new TypeError("Invalid Discord channel.");
        const target = type === "custom-css" ? path.join(root, "data", channel, "custom.css") : path.join(root, `${type}s`, filename!);
        assertRegularOwnedPath(root, target, type === "custom-css");
        const openedViaWindow = !!this._options;

        let window = type === "custom-css" ? this.windows["custom-css"] : this.windows[type][filename!];
        if (openedViaWindow && window) {
            if (!window.webContents.isLoading()) {
                window.show();
            }

            // @ts-expect-error Not typed
            return this._options.webContents;
        }

        if (typeof window === "undefined" || window.isDestroyed()) {
            window = new BrowserWindow({
                ...this._options,
                frame: true,
                center: true,
                show: false,
                webPreferences: {
                    ...this._options?.webPreferences,
                    preload: path.join(__dirname, "editor/preload.js"),
                    nodeIntegration: false,
                    nodeIntegrationInSubFrames: false,
                    nodeIntegrationInWorker: false,
                    contextIsolation: true,
                    sandbox: true,
                    webviewTag: false,
                    allowRunningInsecureContent: false,
                    webSecurity: true
                }
            });

            this._options = null;

            window.setMenu(null);

            const url = pathToFileURL(path.join(__dirname, "editor/index.html"));
            url.searchParams.set("session", crypto.randomUUID());
            const editorWindow = window;
            editorWindow.webContents.ipc.on(IPCEvents.EDITOR_SESSION, (event, command: string, payload?: unknown) => {
                try {
                    if (event.senderFrame !== editorWindow.webContents.mainFrame || event.senderFrame.url !== url.href || editorWindow.webContents.getURL() !== url.href) throw new Error("Editor session is not authorized.");
                    assertRegularOwnedPath(root, target, type === "custom-css");
                    let value: unknown;
                    switch (command) {
                        case "metadata": value = {type, filename: filename || "custom.css"}; break;
                        case "read": value = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : ""; break;
                        case "write": {
                            if (typeof payload !== "string" || Buffer.byteLength(payload) > 8 * 1024 * 1024) throw new TypeError("Editor content exceeds its limit.");
                            const temporary = `${target}.${crypto.randomBytes(12).toString("hex")}.tmp`;
                            try {
                                fs.writeFileSync(temporary, payload, {encoding: "utf8", flag: "wx", mode: 0o600});
                                assertRegularOwnedPath(root, target, type === "custom-css");
                                fs.renameSync(temporary, target);
                            }
                            finally {
                                try {fs.unlinkSync(temporary);}
                                catch {/* The main-process-bound temporary file is eligible for cleanup. */}
                            }
                            break;
                        }
                        case "open": void shell.openPath(target); break;
                        case "clipboard": value = clipboard.readText(); break;
                        case "warning": shouldWarn = payload === true; break;
                        case "settings-get": value = this.getSettings(); break;
                        case "settings-set": {
                            if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new TypeError("Invalid editor settings.");
                            this.updateSettings({...this.#settings, ...payload});
                            this._window?.webContents.send(IPCEvents.EDITOR_SETTINGS_UPDATE, payload);
                            break;
                        }
                        default: throw new TypeError("Unknown editor operation.");
                    }
                    event.returnValue = {ok: true, value};
                }
                catch {event.returnValue = {ok: false};}
            });
            window.webContents.on("will-navigate", event => event.preventDefault());
            window.webContents.on("will-redirect", event => event.preventDefault());

            if (openedViaWindow) {
                window.webContents.once("will-navigate", (e) => {
                    e.preventDefault();
                    window!.loadURL(url.href);

                    window!.once("ready-to-show", () => {
                        window!.show();
                    });
                });
            }
            else {
                window.once("ready-to-show", () => {
                    window!.show();
                });
                window.loadURL(url.href);
            }

            let shouldWarn = false;

            window.on("close", (event) => {
                if (!shouldWarn) return;

                event.preventDefault();

                const result = dialog.showMessageBoxSync(window!, {
                    type: "question",
                    title: "Close Editor?",
                    message: "Changes you made are not saved",
                    buttons: ["Close", "Cancel"],
                    cancelId: 1,
                    defaultId: 1,
                    normalizeAccessKeys: true
                });

                if (!result) {
                    shouldWarn = false;
                    window!.close();
                }
            });


            window.webContents.setWindowOpenHandler(() => ({action: "deny"}));

            if (this._window) {
                const listener = () => {
                    shouldWarn = false;
                    window!.close();
                };

                this._window.once("closed", listener);
                window.once("closed", () => {
                    this._window.off("closed", listener);

                    if (type === "custom-css") {
                        delete this.windows["custom-css"];
                    }
                    else {
                        delete this.windows[type][filename!];
                    }
                });
            }

            if (this.#settings.alwaysOnTop) {
                window.setAlwaysOnTop(true);
            }

            if (type === "custom-css") {
                this.windows["custom-css"] = window;
            }
            else {
                this.windows[type][filename!] = window;
            }
        }

        if (!window.webContents.isLoading()) {
            window.show();
        }

        return window.webContents;
    }

    private static isValidWindow(item: any): item is BrowserWindow {
        return item instanceof BrowserWindow && !item.isDestroyed();
    }

    static #settings: import("../../../editor/preload").Settings = {
        options: {theme: "vs-dark"},
        liveUpdate: false,
        discordTheme: "dark",
        alwaysOnTop: false
    };

    public static updateSettings(settings: import("../../../editor/preload").Settings) {
        this.#settings = settings;

        if (this.isValidWindow(this.windows["custom-css"])) {
            this.windows["custom-css"].webContents.send(IPCEvents.EDITOR_SETTINGS_UPDATE, settings);
            this.windows["custom-css"].setAlwaysOnTop(settings.alwaysOnTop);
        }

        for (const type of ["theme", "plugin"] as const) {
            for (const key in this.windows[type]) {
                if (Object.prototype.hasOwnProperty.call(this.windows[type], key)) {
                    const window = this.windows[type][key];

                    if (this.isValidWindow(window)) {
                        window.webContents.send(IPCEvents.EDITOR_SETTINGS_UPDATE, settings);
                        window.setAlwaysOnTop(settings.alwaysOnTop);
                    }
                }
            }
        }
    }

    public static getSettings() {
        return this.#settings;
    }

    private static _window: BrowserWindow;
    public static initialize(window: BrowserWindow) {
        this._window = window;
    }
}
