import {afterEach, expect, mock, test} from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {EventEmitter} from "node:events";
let activeRoot = "";
const roots: string[] = [];
class Window extends EventEmitter {
    static created: Window[] = [];
    options: any;
    url = "";
    webContents = Object.assign(new EventEmitter(), {
        ipc: new EventEmitter(),
mainFrame: {url: ""},
        getURL: () => this.url,
isLoading: () => false,
        setWindowOpenHandler: (_handler: unknown) => {},
send: () => {}
    });
    constructor(options: unknown) {super(); this.options = options; Window.created.push(this);}
    setMenu() {} show() {} setAlwaysOnTop() {} isDestroyed() {return false;}
    close() {this.emit("closed");}
    loadURL(url: string) {this.url = url; this.webContents.mainFrame.url = url;}
    command(command: string, payload?: unknown, frame = this.webContents.mainFrame) {
        const event = {senderFrame: frame, returnValue: undefined as any};
        this.webContents.ipc.emit("sc-editor-session", event, command, payload);
        return event.returnValue;
    }
}
mock.module("electron", () => ({BrowserWindow: Window,
app: {getPath: () => path.join(activeRoot, "discord")},
    dialog: {showMessageBoxSync: () => 0},
shell: {openPath: async () => ""},
clipboard: {readText: () => "clipboard"}}));
const {default: Editor} = await import("../../src/electron/main/modules/editor");
afterEach(() => {for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true});});
function fixture(name: string) {
    activeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "solcord-editor-authority-")); roots.push(activeRoot);
    const folder = path.join(activeRoot, "BetterDiscord", "plugins"); fs.mkdirSync(folder, {recursive: true});
    const file = path.join(folder, name); fs.writeFileSync(file, "original");
    Editor.open("plugin", name); const window = Window.created.at(-1)!;
    return {file, window};
}
test("the packaged editor can edit only its main-process-bound file", () => {
    const {file, window} = fixture("Bound.plugin.js");
    const marker = path.join(activeRoot, "marker.txt"); fs.writeFileSync(marker, "keep");
    expect(window.options.webPreferences).toEqual(expect.objectContaining({sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true}));
    expect(window.command("metadata").value).toEqual({type: "plugin", filename: "Bound.plugin.js"});
    expect(window.command("write", {filename: marker, contents: "attack"}).ok).toBe(false);
    expect(window.command("write", "edited").ok).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe("edited"); expect(fs.readFileSync(marker, "utf8")).toBe("keep");
});
test("hostile documents and subframes cannot obtain or use the editor session", () => {
    const {file, window} = fixture("Navigate.plugin.js");
    expect(window.command("metadata", undefined, {url: window.url}).ok).toBe(false);
    window.loadURL("https://example.invalid/?type=plugin&filename=../marker.txt");
    expect(window.command("metadata").ok).toBe(false); expect(window.command("write", "attack").ok).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe("original");
});
test("opening a traversal target is rejected before a window is created", () => {
    const before = Window.created.length;
    expect(() => Editor.open("plugin", "../escape.plugin.js")).toThrow(); expect(Window.created.length).toBe(before);
});
