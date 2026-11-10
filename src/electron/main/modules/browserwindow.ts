import electron, {type BrowserWindowConstructorOptions, type HandlerDetails} from "electron";
import fs from "node:fs";
import path from "path";

import BetterDiscord from "./betterdiscord";
import Editor from "./editor";
import {installNativePrivacyGuard} from "./privacy-network";
import ActivityCompatibility from "./activity-compatibility";
import {OriginalPreloadRegistry} from "./original-preload-registry";
import {installPreloadAssignmentPolicy, preloadTrustRoot} from "./preload-policy";
import {ORIGINAL_PRELOAD_REQUEST} from "../../preload/original-preload";
import * as IPCEvents from "@common/constants/ipcevents";
import {isProxy} from "util/types";

// const EDITOR_URL_REGEX = /^betterdiscord:\/\/editor\/(?:custom-css|(theme|plugin)\/([^/]+))\/?/;

const originalPreloads = new OriginalPreloadRegistry();
let originalPreloadIpcRegistered = false;

function registerOriginalPreloadIpc(): void {
    if (originalPreloadIpcRegistered) return;
    originalPreloadIpcRegistered = true;
    electron.ipcMain.on(ORIGINAL_PRELOAD_REQUEST, event => {
        event.returnValue = originalPreloads.resolve(event.sender.id) ?? null;
    });
}

function maybeHasOtherClientMod() {
    if (isProxy(electron) || isProxy(electron.BrowserWindow)) return true;

    const str = electron.BrowserWindow.toString();

    const extendsIndex = str.indexOf("extends");

    if (extendsIndex === -1) return false;
    return extendsIndex < str.indexOf("{");
}

class BrowserWindow extends electron.BrowserWindow {
    public __solcordWindowToken?: number;

    constructor(options: BrowserWindowConstructorOptions) {
        // @ts-expect-error super's type returns undefined for some reason
        if (!options || !options.webPreferences || !options.webPreferences.preload || !options.title) return super(options);

        if (maybeHasOtherClientMod() && BetterDiscord.clientModCompatibility.shouldShow()) {
            // Not i18n but the i18n system doesn't exist here
            electron.dialog.showMessageBox({
                type: "warning",
                title: "Solcord Compatibility Warning",
                message: "Solcord detected another desktop client modification. Running both may change window or preload behavior. Review the other modification before continuing.",
                checkboxLabel: "Don't show this again",
                buttons: ["OK"],
                defaultId: 0
            }).then(result => {
                if (result.checkboxChecked) {
                    BetterDiscord.clientModCompatibility.stopShowing();
                }
            });
        }

        const originalPreload = options.webPreferences.preload;
        const injectedPreload = path.join(__dirname, "preload.js");
        const packageRoot = preloadTrustRoot(originalPreload);
        ActivityCompatibility.setUnrestrictedOverride(BetterDiscord.clientModCompatibility.allowPreloadOverride());
        const windowToken = ActivityCompatibility.beginWindow(options.title, originalPreload, packageRoot);
        let removeMinimumSize = false;
        try {
            installPreloadAssignmentPolicy(options.webPreferences, originalPreload, injectedPreload, {
                discordTrustRoot: BetterDiscord.getDiscordTrustRoot(),
                canonicalizeRoot(root) {
                    try {
                        return fs.realpathSync.native(root);
                    }
                    catch {
                        return undefined;
                    }
                }
            }, () => BetterDiscord.clientModCompatibility.allowPreloadOverride(),
            (result, unrestricted) => ActivityCompatibility.assignment(windowToken, result, unrestricted));

            // Don't allow just "truthy" values
            const shouldBeTransparent = BetterDiscord.getSetting("window", "transparency");
            if (typeof (shouldBeTransparent) === "boolean" && shouldBeTransparent) {
                options.transparent = true;
                options.backgroundColor = "#00000000";
            }

            const inAppTrafficLights = Boolean(BetterDiscord.getSetting("window", "inAppTrafficLights") ?? false);
            options.frame = Boolean(BetterDiscord.getSetting("window", "frame") ?? options.frame ?? true);

            process.env.BETTERDISCORD_NATIVE_FRAME = options.frame.toString();
            process.env.BETTERDISCORD_IN_APP_TRAFFIC_LIGHTS = inAppTrafficLights.toString();

            if (inAppTrafficLights) {
                delete options.titleBarStyle;
            }

            removeMinimumSize = Boolean(BetterDiscord.getSetting("window", "removeMinimumSize") ?? false);
            if (removeMinimumSize) {
                options.minWidth = 0;
                options.minHeight = 0;
            }

            super(options);
        }
        catch (error) {
            ActivityCompatibility.constructionFailed(windowToken, error);
            throw error;
        }
        if (removeMinimumSize) {
            this.setMinimumSize = () => {};
        }
        Object.defineProperty(this, "__solcordWindowToken", {
            configurable: false,
            enumerable: false,
            value: windowToken,
            writable: false
        });
        const webContentsId = this.webContents.id;
        originalPreloads.register(this.webContents, originalPreload);
        ActivityCompatibility.ready(windowToken, webContentsId);
        this.webContents.on("preload-error", (_, __, error) => ActivityCompatibility.preloadError(windowToken, error));
        this.once("closed", () => ActivityCompatibility.destroyed(windowToken, webContentsId));
        BetterDiscord.setup(this);
        installNativePrivacyGuard(this.webContents.session);
        Editor.initialize(this);

        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        this.webContents.setWindowOpenHandler = new Proxy(this.webContents.setWindowOpenHandler, {
            apply(target, thisArg, argArray) {
                const handler = argArray[0];

                argArray[0] = function (details: HandlerDetails) {
                    // Just like chat make it only be on this client
                    if (details.url.startsWith("betterdiscord://")) {
                        self.webContents.send(IPCEvents.HANDLE_PROTOCOL, details.url);
                        return {action: "deny"};
                    }

                    // eslint-disable-next-line prefer-rest-params
                    return handler.apply(this, arguments);
                };

                return Reflect.apply(target, thisArg, argArray);
            }
        });
    }
}

Object.assign(BrowserWindow, electron.BrowserWindow);

// Taken from https://github.com/Vendicated/Vencord/blob/main/src/main/patcher.ts
// esbuild may rename our BrowserWindow, which leads to it being excluded
// from getFocusedWindow(), so this is necessary
// https://github.com/discord/electron/blob/13-x-y/lib/browser/api/browser-window.ts#L60-L62
Object.defineProperty(BrowserWindow, "name", {value: "BrowserWindow", configurable: true});

export default class {
    static patchBrowserWindow() {
        const electronPath = require.resolve("electron");

        if (!require.cache[electronPath]) return;
        registerOriginalPreloadIpc();
        delete require.cache[electronPath].exports; // If it didn't work, try to delete existing
        require.cache[electronPath].exports = {...electron, BrowserWindow}; // Try to assign again after deleting
    }
}
