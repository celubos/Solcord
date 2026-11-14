import {app} from "electron";
import {migrateDiscordUpdate} from "./discord-update-migration";
import path from "path";
import fs from "fs";
import {bdFolder} from "./modules/betterdiscord";
import {randomUUID} from "crypto";

const supported: NodeJS.Platform[] = [
    "win32",
    "linux"
];

function migrate() {
    if (!supported.includes(process.platform)) return;

    const logPath = path.join(bdFolder, "data", "updater.log");
    const uuid = randomUUID();

    const log = (content: string) => {
        if (process.env.__BUILD__ === "production") return;
        fs.appendFileSync(logPath, `[id=${uuid},time=${Date.now()}]: ${content}\n`);
    };

    try {
        // main.js sits at the root of the packaged core, so __dirname is the core path
        // the installer records (BetterDiscord\data\betterdiscord.asar).
        migrateDiscordUpdate({execPath: process.execPath, corePath: __dirname, log});
    }
    catch (e) {
        log(`Migration Failed!\n${String(e)}`);
    }
}

app.on("before-quit", migrate);
