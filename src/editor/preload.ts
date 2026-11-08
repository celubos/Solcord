import {contextBridge, ipcRenderer} from "electron";
import * as IPCEvents from "@common/constants/ipcevents";

export interface Settings {
    liveUpdate: boolean;
    options: import("monaco-editor").editor.IStandaloneEditorConstructionOptions;
    discordTheme: "light" | "dark" | "darker" | "midnight";
    alwaysOnTop: boolean;
}

function call<T = void>(command: string, payload?: unknown): T {
    const response = ipcRenderer.sendSync(IPCEvents.EDITOR_SESSION, command, payload);
    if (!response || response.ok !== true) throw new Error("The editor session is unavailable.");
    return response.value as T;
}

function createEditor(metadata: {type: "custom-css" | "theme" | "plugin"; filename: string;}) {
    return {
        ...metadata,
        read: () => call<string>("read"),
        write: (contents: string) => call("write", contents),
        open: () => {call("open"); window.close();},
        shouldShowWarning: (value: boolean) => call("warning", value),
        readText: () => call<string>("clipboard"),
        settings: {
            get: () => call<Settings>("settings-get"),
            set: (settings: Partial<Settings>) => call("settings-set", settings),
            subscribe(listener: (settings: Settings) => void) {
                const callback = (_: unknown, settings: Settings) => listener(settings);
                ipcRenderer.on(IPCEvents.EDITOR_SETTINGS_UPDATE, callback);
                return () => ipcRenderer.off(IPCEvents.EDITOR_SETTINGS_UPDATE, callback);
            }
        }
    };
}

// No URL/query-supplied path is authoritative. Only the exact packaged document
// and main-process-bound file session can obtain this bridge.
try {
    if (location.protocol === "file:" && window.top === window) {
        const metadata = call<Parameters<typeof createEditor>[0]>("metadata");
        contextBridge.exposeInMainWorld("Editor", createEditor(metadata));
    }
}
catch {/* Untrusted documents receive no editor capability. */}

export type EditorNative = ReturnType<typeof createEditor>;
