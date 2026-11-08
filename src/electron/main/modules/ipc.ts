import {spawn} from "child_process";
import {ipcMain as ipc, BrowserWindow, app, dialog, shell, type IpcMainInvokeEvent, type IpcMainEvent, type BrowserWindowConstructorOptions} from "electron";

import * as IPCEvents from "@common/constants/ipcevents";
import Editor from "./editor";
import {writeAddonFile} from "./addon-files";
import {synchronizeNativePrivacy} from "./privacy-network";
import BetterDiscord from "./betterdiscord";
import ActivityCompatibility from "./activity-compatibility";
import SolcordTimeline from "./solcord-timeline";
import SolcordFriendWatch from "./solcord-friend-watch";
import SolcordAudienceGuard from "./solcord-audience-guard";
import SolcordPeopleState from "./solcord-people-state";
import SolcordSetup from "./solcord-setup";
import {SolcordFirstSetupIntentStore} from "./solcord-first-setup-intent";
import {resolveSolcordBetterDiscordRoot} from "./solcord-data-root";
import SolcordProviderArchive from "./solcord-provider-archive";
import SolcordTranslationCredentials from "./solcord-translation-credentials";
import SolcordLocalIdentityNotes from "./solcord-local-identity-notes";
import {isTrustedSolcordIpcUrl, SolcordTimelineIpcAuthority} from "./solcord-ipc-authority";
import type {DialogOptions} from "@common/types/ipc";

const getPath = (event: IpcMainEvent, pathReq: string) => {
    let returnPath;
    switch (pathReq) {
        case "appPath":
            returnPath = app.getAppPath();
            break;
        case "appData":
        case "userData":
        case "home":
        case "cache":
        case "temp":
        case "exe":
        case "module":
        case "desktop":
        case "documents":
        case "downloads":
        case "music":
        case "pictures":
        case "videos":
        case "recent":
        case "logs":
            returnPath = app.getPath(pathReq as Parameters<typeof app.getPath>[0]);
            break;
        default:
            returnPath = "";
    }

    event.returnValue = returnPath;
};

const openPath = (_: IpcMainEvent, path: string) => {
    if (process.platform === "win32") spawn("explorer.exe", [path]);
    else shell.openPath(path);
};

const relaunch = (_: IpcMainEvent, args: string[] = []) => {
    app.relaunch({args: process.argv.slice(1).concat(Array.isArray(args) ? args : [args])});
    app.quit();
};

const runScript = async (event: IpcMainInvokeEvent, script: string) => {
    try {
        // TODO: compile with vm to prevent escape with clever strings
        await event.sender.executeJavaScript(`(() => {try {${script}} catch {}})();`);
    }
    catch {
        // TODO: cut a log
    }
};

const openDevTools = (event: IpcMainEvent) => event.sender.openDevTools();
const closeDevTools = (event: IpcMainEvent) => event.sender.closeDevTools();
const toggleDevTools = (event: IpcMainEvent) => {
    if (!event.sender.isDevToolsOpened()) openDevTools(event);
    else closeDevTools(event);
};

/**
 * Never let a renderer-supplied windowOptions weaken the security posture of the
 * window we open. Discord's Electron fork already forces these safe values, but we
 * don't want our own guarantees to depend on that so we force them here too, and
 * never honor a caller-supplied preload.
 */
const SAFE_WEB_PREFERENCES: BrowserWindowConstructorOptions["webPreferences"] = {
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    contextIsolation: true,
    sandbox: true,
    webviewTag: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
};

const createBrowserWindow = (_: IpcMainInvokeEvent, url: string, {windowOptions, closeOnUrl}: {windowOptions?: BrowserWindowConstructorOptions, closeOnUrl?: string;} = {}) => {
    try {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
            return Promise.reject(new Error("Invalid protocol"));
        }
    }
    catch {
        return Promise.reject(new Error("Invalid URL"));
    }

    return new Promise<void>(resolve => {
        const safeOptions: BrowserWindowConstructorOptions = {
            ...windowOptions,
            webPreferences: {
                ...windowOptions?.webPreferences,
                ...SAFE_WEB_PREFERENCES,
                preload: undefined
            }
        };
        const windowInstance = new BrowserWindow(safeOptions);
        windowInstance.webContents.on("did-navigate", (__, navUrl) => {
            if (navUrl != closeOnUrl) return;
            windowInstance.close();
            resolve();
        });
        windowInstance.loadURL(url);
    });
};

const inspectElement = async (event: IpcMainEvent) => {
    if (!event.sender.isDevToolsOpened()) {
        event.sender.openDevTools();
        while (!event.sender.isDevToolsOpened()) await new Promise(r => setTimeout(r, 100));
    }
    event.sender.devToolsWebContents?.executeJavaScript("DevToolsAPI.enterInspectElementMode();");
};

const setMinimumSize = (event: IpcMainEvent, width: number, height: number) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.setMinimumSize(width, height);
};

const setWindowSize = (event: IpcMainEvent, width: number, height: number) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.setSize(width, height);
};

const stopDevtoolsWarning = (event: IpcMainEvent) => event.sender.removeAllListeners("devtools-opened");


const openDialog = (event: IpcMainInvokeEvent, options: Partial<DialogOptions> = {}) => {
    const {
        mode = "open",
        openDirectory = false,
        openFile = true,
        multiSelections = false,
        filters,
        promptToCreate = false,
        defaultPath,
        title,
        showOverwriteConfirmation,
        message,
        showHiddenFiles,
        modal = false
    } = options;
    const openFunction = {
        open: dialog.showOpenDialog,
        save: dialog.showSaveDialog
    }[mode];
    if (!openFunction) return Promise.resolve({error: "Unkown Mode: " + mode});

    // @ts-expect-error cba to write separate types for these dialogs that are never used
    return openFunction(...[
        modal && BrowserWindow.fromWebContents(event.sender),
        {
            defaultPath,
            filters,
            title,
            message,
            createDirectory: true,
            properties: [
                showHiddenFiles && "showHiddenFiles",
                openDirectory && "openDirectory",
                promptToCreate && "promptToCreate",
                openDirectory && "openDirectory",
                openFile && "openFile",
                multiSelections && "multiSelections",
                showOverwriteConfirmation && "showOverwriteConfirmation"
            ].filter(e => e),
        }
    ].filter(e => e));
};
const registerPreload = (_: IpcMainEvent, path: string) => {
    app.commandLine.appendSwitch("preload", path);
};
const openEditor = (event: IpcMainInvokeEvent, type: "plugin" | "theme", filename: string) => {
    requireTrustedSolcordSender(event);
    Editor.open(type, filename);
};

const updateSettings = (_: IpcMainInvokeEvent, settings: any) => {
    Editor.updateSettings(settings);
};
const getSettings = (event: IpcMainEvent) => {
    event.returnValue = Editor.getSettings();
};

const getAllowPreloadOverride = (_: IpcMainInvokeEvent) => {
    return BetterDiscord.clientModCompatibility.allowPreloadOverride();
};
const setAllowPreloadOverride = (_: IpcMainInvokeEvent, value: boolean) => {
    BetterDiscord.clientModCompatibility.setAllowPreloadOverride(value);
    ActivityCompatibility.setUnrestrictedOverride(value);
};

const getActivityCompatibility = () => ActivityCompatibility.snapshot();

const requireTrustedSolcordSender = (event: IpcMainInvokeEvent): void => {
    if (event.sender.isDestroyed()) throw new Error("Solcord private IPC rejected an untrusted renderer.");
    const senderFrame = event.senderFrame;
    if (!senderFrame) throw new Error("Solcord private IPC rejected an untrusted renderer.");
    const mainFrame = event.sender.mainFrame;
    const isMainFrame = senderFrame.processId === mainFrame.processId && senderFrame.routingId === mainFrame.routingId;
    if (!isMainFrame || !isTrustedSolcordIpcUrl(event.sender.getURL()) || !isTrustedSolcordIpcUrl(senderFrame.url)) {
        throw new Error("Solcord private IPC rejected an untrusted renderer.");
    }
};

const timelineAuthority = new SolcordTimelineIpcAuthority();
const SolcordFirstSetupIntent = new SolcordFirstSetupIntentStore({betterDiscordRoot: () => resolveSolcordBetterDiscordRoot(app.getPath("userData"))});
const timelineReleaseHooks = new WeakSet<Electron.WebContents>();

const ensureTimelineReleaseHook = (sender: Electron.WebContents): void => {
    if (!timelineReleaseHooks.has(sender)) {
        timelineReleaseHooks.add(sender);
        const id = sender.id;
        const release = () => timelineAuthority.release(id);
        sender.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
            if (isMainFrame && !isInPlace) release();
        });
        sender.on("render-process-gone", release);
        sender.once("destroyed", release);
    }
};
const withCurrentAccountBinding = async <T>(event: IpcMainInvokeEvent, request: unknown, operation: (accountScope: string, payload: Record<string, unknown>) => Promise<T>): Promise<T> => {
    const authorized = timelineAuthority.authorize(event.sender.id, request);
    const result = await operation(authorized.accountScope, authorized.request);
    timelineAuthority.assertCurrent(event.sender.id, authorized);
    return result;
};
const bootstrapTimeline = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    return timelineAuthority.activate(event.sender.id, request);
};
const bindTimeline = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    return timelineAuthority.bind(event.sender.id, request);
};
const releaseTimeline = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    return timelineAuthority.releaseAccount(event.sender.id, request);
};
const getTimelineStatus = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    timelineAuthority.authorize(event.sender.id, request, false);
    return SolcordTimeline.status();
};
const appendTimeline = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    return withCurrentAccountBinding(event, request, (accountScope, payload) => SolcordTimeline.append(accountScope, payload));
};
const readTimeline = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    return withCurrentAccountBinding(event, request, (accountScope, payload) => SolcordTimeline.read(accountScope, payload));
};
const clearTimeline = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    return withCurrentAccountBinding(event, request, (accountScope, payload) => SolcordTimeline.clear(accountScope, payload));
};
const getFriendWatchStatus = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    timelineAuthority.authorize(event.sender.id, request, false);
    return SolcordFriendWatch.status();
};
const appendFriendWatch = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    return withCurrentAccountBinding(event, request, (accountScope, payload) => SolcordFriendWatch.append(accountScope, payload));
};
const readFriendWatch = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    return withCurrentAccountBinding(event, request, (accountScope, payload) => SolcordFriendWatch.read(accountScope, payload));
};
const clearFriendWatch = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    return withCurrentAccountBinding(event, request, (accountScope, payload) => SolcordFriendWatch.clear(accountScope, payload));
};
const getAudienceGuardStatus = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    timelineAuthority.authorize(event.sender.id, request, false);
    return SolcordAudienceGuard.status();
};
const readAudienceGuard = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    return withCurrentAccountBinding(event, request, (accountScope, payload) => SolcordAudienceGuard.read(accountScope, payload));
};
const writeAudienceGuard = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    return withCurrentAccountBinding(event, request, (accountScope, payload) => SolcordAudienceGuard.write(accountScope, payload));
};
const clearAudienceGuard = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    return withCurrentAccountBinding(event, request, (accountScope, payload) => SolcordAudienceGuard.clear(accountScope, payload));
};
const getPeopleStateStatus = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    timelineAuthority.authorize(event.sender.id, request, false);
    return SolcordPeopleState.status();
};
const readPeopleState = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    return withCurrentAccountBinding(event, request, (accountScope, payload) => SolcordPeopleState.read(accountScope, payload));
};
const writePeopleState = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    return withCurrentAccountBinding(event, request, (accountScope, payload) => SolcordPeopleState.write(accountScope, payload));
};
const clearPeopleState = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    return withCurrentAccountBinding(event, request, (accountScope, payload) => SolcordPeopleState.clear(accountScope, payload));
};
const applySolcordSetup = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    const authorized = timelineAuthority.authorize(event.sender.id, request, false);
    return SolcordSetup.apply(authorized.request);
};
const acknowledgeSolcordSetup = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    const authorized = timelineAuthority.authorize(event.sender.id, request, false);
    return SolcordSetup.acknowledge(authorized.request.transactionId);
};
const reconcileSolcordSetup = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    const authorized = timelineAuthority.authorize(event.sender.id, request, false);
    return SolcordSetup.reconcile(authorized.request.transactionIds);
};
const rollbackSolcordSetup = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    const authorized = timelineAuthority.authorize(event.sender.id, request, false);
    return SolcordSetup.rollback(authorized.request.transactionId);
};
const auditSolcordSetup = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    timelineAuthority.authorize(event.sender.id, request, false);
    return SolcordSetup.auditIntegrity();
};
const claimSolcordFirstSetupIntent = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    timelineAuthority.authorize(event.sender.id, request, false);
    return SolcordFirstSetupIntent.claim();
};
const acknowledgeSolcordFirstSetupIntent = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    const authorized = timelineAuthority.authorize(event.sender.id, request, false);
    return SolcordFirstSetupIntent.acknowledge(authorized.request.intentId);
};
const previewSolcordProviderArchive = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    const authorized = timelineAuthority.authorize(event.sender.id, request, false);
    return SolcordProviderArchive.preview(authorized.request);
};
const applySolcordProviderArchive = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    const authorized = timelineAuthority.authorize(event.sender.id, request, false);
    return SolcordProviderArchive.apply(authorized.request.previewId);
};
const rollbackSolcordProviderArchive = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    const authorized = timelineAuthority.authorize(event.sender.id, request, false);
    return SolcordProviderArchive.rollback(authorized.request.transactionId);
};
const readSolcordTranslationCredential = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    return withCurrentAccountBinding(event, request, (accountScope, payload) => SolcordTranslationCredentials.read(accountScope, payload));
};
const writeSolcordTranslationCredential = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    return withCurrentAccountBinding(event, request, (accountScope, payload) => SolcordTranslationCredentials.write(accountScope, payload));
};
const clearSolcordTranslationCredential = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    return withCurrentAccountBinding(event, request, (accountScope, payload) => SolcordTranslationCredentials.clear(accountScope, payload));
};
const getSolcordLocalIdentityNotesStatus = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    timelineAuthority.authorize(event.sender.id, request, false);
    return SolcordLocalIdentityNotes.status();
};
const readSolcordLocalIdentityNotes = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    return withCurrentAccountBinding(event, request, (accountScope, payload) => SolcordLocalIdentityNotes.read(accountScope, payload));
};
const writeSolcordLocalIdentityNote = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    return withCurrentAccountBinding(event, request, (accountScope, payload) => SolcordLocalIdentityNotes.write(accountScope, payload));
};
const removeSolcordLocalIdentityNote = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    return withCurrentAccountBinding(event, request, (accountScope, payload) => SolcordLocalIdentityNotes.remove(accountScope, payload));
};
const clearSolcordLocalIdentityNotes = (event: IpcMainInvokeEvent, request: unknown) => {
    requireTrustedSolcordSender(event);
    return withCurrentAccountBinding(event, request, (accountScope, payload) => SolcordLocalIdentityNotes.clear(accountScope, payload));
};

const runRenderer = (event: IpcMainInvokeEvent) => {
    requireTrustedSolcordSender(event);
    const senderFrame = event.senderFrame;
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderFrame || !browserWindow) throw new Error("Solcord renderer frame is unavailable.");
    ensureTimelineReleaseHook(event.sender);
    const bootstrap = timelineAuthority.bootstrap(event.sender.id);
    void BetterDiscord.injectRenderer(browserWindow, senderFrame).catch(() => {
        timelineAuthority.release(event.sender.id);
    });
    return bootstrap;
};


export default class IPCMain {
    static registerEvents() {
        try {
            ipc.on(IPCEvents.GET_PATH, getPath);
            ipc.on(IPCEvents.OPEN_PATH, openPath);
            ipc.on(IPCEvents.RELAUNCH, relaunch);
            ipc.on(IPCEvents.OPEN_DEVTOOLS, openDevTools);
            ipc.on(IPCEvents.CLOSE_DEVTOOLS, closeDevTools);
            ipc.on(IPCEvents.TOGGLE_DEVTOOLS, toggleDevTools);
            ipc.on(IPCEvents.INSPECT_ELEMENT, inspectElement);
            ipc.on(IPCEvents.MINIMUM_SIZE, setMinimumSize);
            ipc.on(IPCEvents.WINDOW_SIZE, setWindowSize);
            ipc.on(IPCEvents.DEVTOOLS_WARNING, stopDevtoolsWarning);
            ipc.on(IPCEvents.REGISTER_PRELOAD, registerPreload);
            ipc.on(IPCEvents.EDITOR_SETTINGS_GET, getSettings);
            ipc.handle(IPCEvents.RUN_SCRIPT, runScript);
            ipc.handle(IPCEvents.OPEN_DIALOG, openDialog);
            ipc.handle(IPCEvents.OPEN_WINDOW, createBrowserWindow);
            ipc.handle(IPCEvents.EDITOR_OPEN, openEditor);
            ipc.handle(IPCEvents.ADDON_FILE_WRITE, (event, kind, filename, content, expectedSha256) => {
                requireTrustedSolcordSender(event);
                return writeAddonFile(resolveSolcordBetterDiscordRoot(app.getPath("userData")), kind, filename, content, expectedSha256);
            });
            ipc.handle(IPCEvents.PRIVACY_POLICY_UPDATE, (event, policy) => {
                requireTrustedSolcordSender(event);
                synchronizeNativePrivacy(policy);
            });
            ipc.handle(IPCEvents.EDITOR_SETTINGS_UPDATE, updateSettings);
            ipc.handle(IPCEvents.GET_ALLOW_PRELOAD_OVERRIDE, getAllowPreloadOverride);
            ipc.handle(IPCEvents.SET_ALLOW_PRELOAD_OVERRIDE, setAllowPreloadOverride);
            ipc.handle(IPCEvents.RUN_RENDERER, runRenderer);
            ipc.handle(IPCEvents.GET_ACTIVITY_COMPATIBILITY, getActivityCompatibility);
            ipc.handle(IPCEvents.TIMELINE_BOOTSTRAP, bootstrapTimeline);
            ipc.handle(IPCEvents.TIMELINE_BIND, bindTimeline);
            ipc.handle(IPCEvents.TIMELINE_RELEASE, releaseTimeline);
            ipc.handle(IPCEvents.TIMELINE_STATUS, getTimelineStatus);
            ipc.handle(IPCEvents.TIMELINE_APPEND, appendTimeline);
            ipc.handle(IPCEvents.TIMELINE_READ, readTimeline);
            ipc.handle(IPCEvents.TIMELINE_CLEAR, clearTimeline);
            ipc.handle(IPCEvents.FRIEND_WATCH_STATUS, getFriendWatchStatus);
            ipc.handle(IPCEvents.FRIEND_WATCH_APPEND, appendFriendWatch);
            ipc.handle(IPCEvents.FRIEND_WATCH_READ, readFriendWatch);
            ipc.handle(IPCEvents.FRIEND_WATCH_CLEAR, clearFriendWatch);
            ipc.handle(IPCEvents.AUDIENCE_GUARD_STATUS, getAudienceGuardStatus);
            ipc.handle(IPCEvents.AUDIENCE_GUARD_READ, readAudienceGuard);
            ipc.handle(IPCEvents.AUDIENCE_GUARD_WRITE, writeAudienceGuard);
            ipc.handle(IPCEvents.AUDIENCE_GUARD_CLEAR, clearAudienceGuard);
            ipc.handle(IPCEvents.PEOPLE_STATE_STATUS, getPeopleStateStatus);
            ipc.handle(IPCEvents.PEOPLE_STATE_READ, readPeopleState);
            ipc.handle(IPCEvents.PEOPLE_STATE_WRITE, writePeopleState);
            ipc.handle(IPCEvents.PEOPLE_STATE_CLEAR, clearPeopleState);
            ipc.handle(IPCEvents.SETUP_APPLY, applySolcordSetup);
            ipc.handle(IPCEvents.SETUP_ACKNOWLEDGE, acknowledgeSolcordSetup);
            ipc.handle(IPCEvents.SETUP_RECONCILE, reconcileSolcordSetup);
            ipc.handle(IPCEvents.SETUP_ROLLBACK, rollbackSolcordSetup);
            ipc.handle(IPCEvents.SETUP_AUDIT, auditSolcordSetup);
            ipc.handle(IPCEvents.FIRST_SETUP_INTENT_CLAIM, claimSolcordFirstSetupIntent);
            ipc.handle(IPCEvents.FIRST_SETUP_INTENT_ACKNOWLEDGE, acknowledgeSolcordFirstSetupIntent);
            ipc.handle(IPCEvents.PROVIDER_ARCHIVE_PREVIEW, previewSolcordProviderArchive);
            ipc.handle(IPCEvents.PROVIDER_ARCHIVE_APPLY, applySolcordProviderArchive);
            ipc.handle(IPCEvents.PROVIDER_ARCHIVE_ROLLBACK, rollbackSolcordProviderArchive);
            ipc.handle(IPCEvents.TRANSLATION_CREDENTIAL_READ, readSolcordTranslationCredential);
            ipc.handle(IPCEvents.TRANSLATION_CREDENTIAL_WRITE, writeSolcordTranslationCredential);
            ipc.handle(IPCEvents.TRANSLATION_CREDENTIAL_CLEAR, clearSolcordTranslationCredential);
            ipc.handle(IPCEvents.LOCAL_IDENTITY_NOTES_STATUS, getSolcordLocalIdentityNotesStatus);
            ipc.handle(IPCEvents.LOCAL_IDENTITY_NOTES_READ, readSolcordLocalIdentityNotes);
            ipc.handle(IPCEvents.LOCAL_IDENTITY_NOTES_WRITE, writeSolcordLocalIdentityNote);
            ipc.handle(IPCEvents.LOCAL_IDENTITY_NOTES_REMOVE, removeSolcordLocalIdentityNote);
            ipc.handle(IPCEvents.LOCAL_IDENTITY_NOTES_CLEAR, clearSolcordLocalIdentityNotes);
        }
        catch (err) {
            // eslint-disable-next-line no-console
            console.error(err);
        }
    }
}
