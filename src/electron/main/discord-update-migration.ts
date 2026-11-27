import path from "path";
import fs from "fs";
import {randomUUID} from "crypto";
import {comparator} from "@common/semver";

/** The exact loader the Windows installer writes and verifies. */
export const SOLCORD_LOADER_PACKAGE = "{\"main\":\"./index.js\",\"name\":\"discord\"}";
export function solcordLoaderIndex(corePath: string): string {
    return `require(${JSON.stringify(corePath)});\nmodule.exports = require("../betterdiscord.app.asar");\n`;
}

export type DiscordUpdateMigrationResult = "same-version" | "already-migrated" | "missing-archive" | "not-ready" | "occupied-loader" | "migrated" | "failed";

export interface DiscordUpdateMigrationOptions {
    execPath: string;
    corePath: string;
    /** Only migrate a staged version whose files have been unchanged this long (proactive checks). */
    minimumStableMs?: number;
    now?: number;
    log?(message: string): void;
}

/**
 * When Discord stages a newer app-* folder, carry the Solcord loader into it.
 * The archive rename is the last step, and any failure removes the files this
 * call wrote, so the newer folder is either fully migrated or left vanilla.
 * The loader is byte-for-byte the installer's, so Update, Repair, and
 * Uninstall recognize the migrated folder as their own.
 */
export function migrateDiscordUpdate(options: DiscordUpdateMigrationOptions): DiscordUpdateMigrationResult {
    const log = options.log ?? (() => {});
    const base = path.dirname(options.execPath);
    const currentVersion = path.basename(base).slice(4);
    const discordPath = path.dirname(base);

    const versions = fs.readdirSync(discordPath)
        .filter(item => item.startsWith("app-") && fs.statSync(path.join(discordPath, item)).isDirectory())
        .map(item => item.slice(4));
    if (!versions.length) return "same-version";
    const latestVersion = versions.reduce((pre, cur) => comparator(pre, cur) === 1 ? cur : pre);
    // Checked every minute while Discord runs, so the common case stays silent.
    if (latestVersion === currentVersion) return "same-version";
    log(`Current version is ${currentVersion} and latest is ${latestVersion}`);

    const resources = path.join(discordPath, `app-${latestVersion}`, "resources");
    const original = path.join(resources, "app.asar");
    const moved = path.join(resources, "betterdiscord.app.asar");
    const loader = path.join(resources, "app");
    if (fs.existsSync(moved)) return "already-migrated";
    if (!fs.existsSync(original) || !fs.lstatSync(original).isFile()) return "missing-archive";
    if (options.minimumStableMs !== undefined) {
        // A background-staged update is still being written until Discord's own
        // executable exists and the archive has stopped changing.
        const executable = path.join(discordPath, `app-${latestVersion}`, path.basename(options.execPath));
        const archiveAge = (options.now ?? Date.now()) - fs.statSync(original).mtimeMs;
        if (!fs.existsSync(executable) || archiveAge < options.minimumStableMs) return "not-ready";
    }
    const createdDirectory = !fs.existsSync(loader);
    if (!createdDirectory && (!fs.lstatSync(loader).isDirectory() || fs.readdirSync(loader).length > 0)) {
        log("The newer Discord folder already has app/ contents; leaving it unchanged.");
        return "occupied-loader";
    }

    const written: string[] = [];
    const writeAtomic = (target: string, content: string) => {
        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
            fs.writeFileSync(temporary, content, {flag: "wx"});
            fs.renameSync(temporary, target);
            written.push(target);
        }
        finally {
            if (fs.existsSync(temporary)) fs.rmSync(temporary, {force: true});
        }
    };
    try {
        if (createdDirectory) fs.mkdirSync(loader);
        writeAtomic(path.join(loader, "package.json"), SOLCORD_LOADER_PACKAGE);
        writeAtomic(path.join(loader, "index.js"), solcordLoaderIndex(options.corePath));
        fs.renameSync(original, moved);
        log("Migrated the Solcord loader into the newer Discord version.");
        return "migrated";
    }
    catch (error) {
        for (const file of written.reverse()) {
            try {fs.rmSync(file, {force: true});}
            catch {/* best effort; app.asar still takes precedence */}
        }
        if (createdDirectory) {
            try {fs.rmdirSync(loader);}
            catch {/* best effort */}
        }
        log(`Migration failed and was rolled back: ${String(error)}`);
        return "failed";
    }
}
