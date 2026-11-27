import {app} from "electron";
import path from "path";
import fs from "fs";
import {bdFolder} from "./modules/betterdiscord";
import {DISCORD_UPDATE_CHECK_INTERVAL_MS, DiscordUpdateWatch} from "./discord-update-watch";

const supported: NodeJS.Platform[] = [
    "win32",
    "linux"
];

const LOG_LIMIT_BYTES = 64 * 1024;

/**
 * Local, content-free outcome log (result codes and times only), so a missing
 * Solcord after a Discord update can be diagnosed. It is bounded and never
 * leaves the machine.
 */
function log(content: string): void {
    try {
        const file = path.join(bdFolder, "data", "updater.log");
        if (fs.existsSync(file) && fs.statSync(file).size > LOG_LIMIT_BYTES) fs.writeFileSync(file, "");
        fs.appendFileSync(file, `${new Date().toISOString()} ${content.replace(/[A-Z]:\\[^\s]*/gi, "<path>")}\n`);
    }
    catch {/* diagnostics must never affect startup or quit */}
}

if (supported.includes(process.platform)) {
    // main.js sits at the root of the packaged core, so __dirname is the core path
    // the installer records (BetterDiscord\data\betterdiscord.asar).
    const watch = new DiscordUpdateWatch({execPath: process.execPath, corePath: __dirname, log});
    let lastResult = "";
    const record = (trigger: string, result: string) => {
        if (result === lastResult && result !== "migrated") return;
        lastResult = result;
        log(`${trigger}: ${result}`);
    };
    const timer = setInterval(() => record("check", watch.check()), DISCORD_UPDATE_CHECK_INTERVAL_MS);
    timer.unref?.();
    app.on("before-quit", () => {
        clearInterval(timer);
        record("quit", watch.onQuit());
    });
}
