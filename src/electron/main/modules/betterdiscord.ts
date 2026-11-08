import fs from "fs";
import path from "path";
import electron, {BrowserWindow, systemPreferences, type WebFrameMain} from "electron";
import {spawn} from "child_process";

import ReactDevTools from "./reactdevtools";
import * as IPCEvents from "@common/constants/ipcevents";
import {isSolcordAcceptanceMode} from "@common/solcord/acceptance-mode";
import ActivityCompatibility from "./activity-compatibility";
import {resolveSolcordBetterDiscordRoot} from "./solcord-data-root";
import {RendererDocumentInjectionGuard} from "./renderer-document-guard";

// Build info file only exists for non-linux (for current injection)
const appPath = electron.app.getAppPath();
const discordTrustRoot = path.dirname(process.resourcesPath);
const buildInfoFile = path.resolve(appPath, "..", "build_info.json");

// Locate data path to find transparency settings
export let bdFolder = "";
if (process.platform === "win32" || process.platform === "darwin") bdFolder = resolveSolcordBetterDiscordRoot(electron.app.getPath("userData"));
else bdFolder = process.env.XDG_CONFIG_HOME ? process.env.XDG_CONFIG_HOME : path.join(process.env.HOME!, ".config"); // This will help with snap packages eventually
if (process.platform !== "win32" && process.platform !== "darwin") bdFolder = path.join(bdFolder, "BetterDiscord");
bdFolder += "/";

const BD_ACCENT_COLOR = "#3E82E5";

let hasCrashed = false;
export default class BetterDiscord {
    static _settings: Record<string, Record<string, any>>;
    private static initializedWindows = new WeakSet<BrowserWindow>();
    private static rendererDocuments = new RendererDocumentInjectionGuard<Electron.WebContents>();
    private static protocolListenersRegistered = false;

    static getDiscordTrustRoot(): string {
        return discordTrustRoot;
    }

    static getSetting(category: string, key: string) {
        if (this._settings) return this._settings[category]?.[key];

        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const buildInfo = require(buildInfoFile);
            const settingsFile = path.resolve(bdFolder, "data", buildInfo.releaseChannel, "settings.json");

            // eslint-disable-next-line @typescript-eslint/no-require-imports
            this._settings = require(settingsFile) ?? {};
            return this._settings[category]?.[key];
        }
        catch {
            this._settings = {};
            return this._settings[category]?.[key];
        }
    }

    static clientModCompatibility = class ClientModCompatibility {
        private static _settings: Record<string, any> | undefined = undefined;

        private static getJSON() {
            if (this._settings) return this._settings;

            try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const buildInfo = require(buildInfoFile);
                const settingsFile = path.resolve(bdFolder, "data", buildInfo.releaseChannel, "clientModCompatibility.json");

                return this._settings = JSON.parse(fs.readFileSync(settingsFile, "utf-8"));
            }
            catch {
                return this._settings = {};
            }
        }

        private static writeJSON() {
            try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const buildInfo = require(buildInfoFile);
                const settingsFile = path.resolve(bdFolder, "data", buildInfo.releaseChannel, "clientModCompatibility.json");

                fs.writeFileSync(settingsFile, JSON.stringify(this.getJSON()));
            }
            catch {/* empty */}
        }

        public static shouldShow(): boolean {
            return this.getJSON().shouldShow ?? true;
        }

        public static allowPreloadOverride(): boolean {
            return this.getJSON().allowPreloadOverride ?? false;
        }

        public static stopShowing() {
            this.getJSON().shouldShow = false;
            this.writeJSON();
        }

        public static setAllowPreloadOverride(allowPreloadOverride: boolean = false) {
            this.getJSON().allowPreloadOverride = allowPreloadOverride;
            this.writeJSON();
        }
    };

    static ensureDirectories() {
        const dataFolder = path.join(bdFolder, "data");
        if (!fs.existsSync(bdFolder)) fs.mkdirSync(bdFolder);
        if (!fs.existsSync(dataFolder)) fs.mkdirSync(dataFolder);
        if (!fs.existsSync(path.join(dataFolder, "stable"))) fs.mkdirSync(path.join(dataFolder, "stable"));
        if (!fs.existsSync(path.join(dataFolder, "canary"))) fs.mkdirSync(path.join(dataFolder, "canary"));
        if (!fs.existsSync(path.join(dataFolder, "ptb"))) fs.mkdirSync(path.join(dataFolder, "ptb"));
        if (!fs.existsSync(path.join(dataFolder, "development"))) fs.mkdirSync(path.join(dataFolder, "development"));
        if (!fs.existsSync(path.join(bdFolder, "plugins"))) fs.mkdirSync(path.join(bdFolder, "plugins"));
        if (!fs.existsSync(path.join(bdFolder, "themes"))) fs.mkdirSync(path.join(bdFolder, "themes"));
    }

    static async injectRenderer(browserWindow: BrowserWindow, frame: WebFrameMain) {
        if (hasCrashed) return;
        const webContents = browserWindow.webContents;
        const claim = this.rendererDocuments.claim(webContents);
        if (claim.status !== "claimed") {
            if (claim.status === "duplicate") return;
            throw new Error("Solcord renderer document boundary is unavailable.");
        }
        const documentToken = claim.token;

        try {
            const current = webContents.mainFrame;
            if (frame.isDestroyed() || frame.detached
                || frame.processId !== current.processId
                || frame.routingId !== current.routingId) {
                this.rendererDocuments.fail(webContents, documentToken);
                throw new Error("Solcord renderer frame changed before injection.");
            }
        }
        catch {
            this.rendererDocuments.fail(webContents, documentToken);
            throw new Error("Solcord renderer frame could not be validated.");
        }

        const location = path.join(__dirname, "solcord.js");
        if (!fs.existsSync(location)) {
            this.rendererDocuments.fail(webContents, documentToken);
            return; // TODO: cut a fatal log
        }
        const content = fs.readFileSync(location).toString();
        let success = false;
        try {
            success = await frame.executeJavaScript(`
                (() => {
                    try {
                        ${content}
                        return true;
                    } catch(error) {
                        console.error(error);
                        return false;
                    }
                })();
                //# sourceURL=solcord/solcord.js
            `) === true;
        }
        catch {
            this.rendererDocuments.fail(webContents, documentToken);
            throw new Error("Solcord renderer injection failed.");
        }

        if (!success) {
            this.rendererDocuments.fail(webContents, documentToken);
            return; // TODO: cut a fatal log
        }
        if (!this.rendererDocuments.complete(webContents, documentToken)) return;
        // @ts-expect-error Solcord adds an internal non-enumerable window token.
        ActivityCompatibility.injection(browserWindow.__solcordWindowToken);
    }

    private static getAccentColor() {
        if (process.env.BD_ACCENT_COLOR) return process.env.BD_ACCENT_COLOR;

        try {
            const hex = systemPreferences.getAccentColor();
            if (!hex) return BD_ACCENT_COLOR;

            // Docs state this doesnt return with # but it does (for me?)
            if (hex[0] === "#") return hex;
            return `#${hex}`;
        }
        catch {
            return BD_ACCENT_COLOR;
        }
    }

    static setup(browserWindow: BrowserWindow) {
        if (this.initializedWindows.has(browserWindow)) return;
        this.initializedWindows.add(browserWindow);
        const rendererOwner = browserWindow.webContents;
        const beginRendererDocument = () => this.rendererDocuments.beginDocument(rendererOwner);
        rendererOwner.on("did-navigate", beginRendererDocument);
        browserWindow.once("closed", () => {
            rendererOwner.off("did-navigate", beginRendererDocument);
            this.rendererDocuments.release(rendererOwner);
        });

        // Setup some useful vars to avoid blocking IPC calls
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            process.env.DISCORD_RELEASE_CHANNEL = require(buildInfoFile).releaseChannel;
        }
        catch {
            process.env.DISCORD_RELEASE_CHANNEL = "stable";
        }

        process.env.DISCORD_APP_PATH = appPath;
        process.env.DISCORD_USER_DATA = electron.app.getPath("userData");
        process.env.BETTERDISCORD_DATA_PATH = bdFolder;

        let promise: Promise<string>;
        let isAwaiting = false;

        const onChange = async () => {
            if (isAwaiting) return;

            isAwaiting = true;

            await browserWindow.webContents.removeInsertedCSS(await promise);

            isAwaiting = false;

            promise = browserWindow.webContents.insertCSS(`:root { --os-accent-color: ${this.getAccentColor()}; }`);
        };

        systemPreferences.on("accent-color-changed", onChange);
        browserWindow.once("closed", () => systemPreferences.off("accent-color-changed", onChange));

        // When DOM is available, pass the renderer over the wall
        browserWindow.webContents.on("dom-ready", () => {
            if (!hasCrashed) {
                promise = browserWindow.webContents.insertCSS(`:root { --os-accent-color: ${this.getAccentColor()}; }`);
                return;
            }

            // If a previous crash was detected, show a message explaining why BD isn't there
            electron.dialog.showMessageBox({
                title: "Solcord startup recovery",
                type: "warning",
                message: "Solcord detected an interrupted Discord renderer",
                detail: "Solcord stopped renderer injection after an interrupted startup. Restart Discord or use the recovery action below.\n\nA third-party plugin may be responsible. Plugin Doctor can quarantine repeated failures without deleting your plugin files.",
                buttons: ["Try Again", "Open Plugins Folder", "Cancel"],
            }).then((result) => {
                if (result.response === 0) {
                    electron.app.relaunch();
                    electron.app.exit();
                }
                if (result.response === 1) {
                    if (process.platform === "win32") spawn("explorer.exe", [path.join(bdFolder, "plugins")]);
                    else electron.shell.openPath(path.join(bdFolder, "plugins"));
                }
            });
            hasCrashed = false;
        });

        // This is used to alert renderer code to onSwitch events
        browserWindow.webContents.on("did-navigate-in-page", () => {
            browserWindow.webContents.send(IPCEvents.NAVIGATE);
        });

        browserWindow.webContents.on("render-process-gone", () => {
            hasCrashed = true;
        });

        // Seems to be windows exclusive. MacOS requires a build plist change
        if (!isSolcordAcceptanceMode() && !this.protocolListenersRegistered && electron.app.setAsDefaultProtocolClient("betterdiscord")) {
            this.protocolListenersRegistered = true;
            // If application was opened via protocol, set process.env.BETTERDISCORD_PROTOCOL
            const protocol = process.argv.find((arg) => arg.startsWith("betterdiscord://"));
            if (protocol) {
                process.env.BETTERDISCORD_PROTOCOL = protocol;
            }

            // I think this is how it works on MacOS
            // But cant work still because of a build plist needs changed (I think?)
            electron.app.on("open-url", (_, url) => {
                if (url.startsWith("betterdiscord://")) {
                    browserWindow.webContents.send(IPCEvents.HANDLE_PROTOCOL, url);
                }
            });

            electron.app.on("second-instance", (_, argv) => {
                // Ignore multi instance
                if (argv.includes("--multi-instance")) return;

                const url = argv.find((arg) => arg.startsWith("betterdiscord://"));

                if (url) {
                    browserWindow.webContents.send(IPCEvents.HANDLE_PROTOCOL, url);
                }
            });
        }
    }

    static disableMediaKeys() {
        if (!BetterDiscord.getSetting("general", "mediaKeys")) return;
        const originalDisable = electron.app.commandLine.getSwitchValue("disable-features") || "";
        const features = new Set(originalDisable.split(",").map(feature => feature.trim()).filter(Boolean));
        features.add("HardwareMediaKeyHandling");
        features.add("MediaSessionService");
        electron.app.commandLine.appendSwitch("disable-features", [...features].join(","));
    }
}

if (BetterDiscord.getSetting("developer", "reactDevTools")) {
    electron.app.whenReady().then(async () => {
        await ReactDevTools.install(bdFolder);
    });
}

// eslint-disable-next-line accessor-pairs
Object.defineProperty(global, "appSettings", {
    set(setting) {
        setting.set("DANGEROUS_ENABLE_DEVTOOLS_ONLY_ENABLE_IF_YOU_KNOW_WHAT_YOURE_DOING", true);
        if (BetterDiscord.getSetting("window", "removeMinimumSize")) {
            setting.set("MIN_WIDTH", 0);
            setting.set("MIN_HEIGHT", 0);
        }
        else {
            setting.set("MIN_WIDTH", 940);
            setting.set("MIN_HEIGHT", 500);
        }

        delete (global as any).appSettings;
        (global as any).appSettings = setting;
    },
    configurable: true,
    enumerable: false
});
