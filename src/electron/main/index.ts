import {app, session} from "electron";

import ipc from "./modules/ipc";
import BrowserWindow from "./modules/browserwindow";
import CSP from "./modules/csp";
import {registerSolcordLocalAssets} from "./modules/local-assets";
import {installSessionWebRequestPolicy} from "./modules/web-request-policy";

import "./migrator";

import inspector from "node:inspector";
import path from "path";

// lazy fix for --inspect not working
if (process.argv.find(x => x.startsWith("--inspect"))) {
    inspector.open();

    let isBRK = false;
    if (process.argv.find(x => (isBRK = x.startsWith("--inspect-brk")) || x.startsWith("--inspect-wait"))) {
        inspector.waitForDebugger();
        // eslint-disable-next-line no-debugger
        if (isBRK) debugger;
    }
}

if (!process.argv.includes("--vanilla")) {
    const ownDefaultSessionHooks = () => installSessionWebRequestPolicy(session.defaultSession);
    if (app.isReady()) {ownDefaultSessionHooks();}
    else {
        // Register before Discord's ready listeners; the Promise also covers a
        // host whose initialization resumes directly from whenReady().
        app.once("ready", ownDefaultSessionHooks);
        void app.whenReady().then(ownDefaultSessionHooks);
    }
    registerSolcordLocalAssets();
    // eslint-disable-next-line no-console
    console.log(`Welcome to Solcord ${process.env.__CANDIDATE__} (core ${process.env.__VERSION__}, build ${process.env.__BUILD__}, source ${process.env.__COMMIT__?.slice(0, 7)})`);

    process.env.NODE_OPTIONS = "--no-force-async-hooks-checks";
    app.commandLine.appendSwitch("no-force-async-hooks-checks");

    // Patch and replace the built-in BrowserWindow
    BrowserWindow.patchBrowserWindow();

    // Register all IPC events
    ipc.registerEvents();

    CSP.remove();
}

// Needs to run this after Discord but before ready()
if (!process.argv.includes("--vanilla")) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BetterDiscord = require("./modules/betterdiscord").default;
    BetterDiscord.disableMediaKeys();
    BetterDiscord.ensureDirectories();
}

if (!app.isReady()) {
    const asar = path.join(app.getAppPath(), "..", "betterdiscord.app.asar");
    // @ts-expect-error This is real https://github.com/electron/electron/blob/22035ac61206010aec7593d929165268475ed9a4/shell/browser/api/electron_api_app.cc#L1996
    app.setAppPath(asar);

    if (require.main) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const pkg = require(path.join(asar, "package.json"));

            require.main.filename = path.resolve(asar, pkg.main);
        }
        catch {/* empty */}
    }
}
