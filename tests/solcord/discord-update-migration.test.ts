import {afterEach, describe, expect, test} from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";

import {migrateDiscordUpdate, SOLCORD_LOADER_PACKAGE, solcordLoaderIndex} from "../../src/electron/main/discord-update-migration";
import {DISCORD_UPDATE_STABLE_MS, DiscordUpdateWatch} from "../../src/electron/main/discord-update-watch";

const roots: string[] = [];
afterEach(() => {for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true});});

function discord(versions: string[] = ["1.0.9267", "1.0.9300"]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "solcord-discord-update-"));
    roots.push(root);
    for (const version of versions) {
        const resources = path.join(root, "Discord", `app-${version}`, "resources");
        fs.mkdirSync(resources, {recursive: true});
        fs.writeFileSync(path.join(root, "Discord", `app-${version}`, "Discord.exe"), "fixture");
        fs.writeFileSync(path.join(resources, "app.asar"), `original-${version}`);
    }
    const core = path.join(root, "Roaming", "BetterDiscord", "data", "betterdiscord.asar");
    return {
        root,
        core,
        execPath: path.join(root, "Discord", `app-${versions[0]}`, "Discord.exe"),
        resources: (version: string) => path.join(root, "Discord", `app-${version}`, "resources")
    };
}

// The Windows installer accepts exactly this loader (InstallerEngine.CanonicalLoader).
const INSTALLER_CANONICAL = /^require\(("(?:[^"\\\n]|\\.)*")\);\nmodule\.exports = require\("\.\.\/betterdiscord\.app\.asar"\);\n?$/;

describe("Discord update migration", () => {
    test("writes the installer's exact loader into the newer version and renames the archive last", () => {
        const fixture = discord();
        expect(migrateDiscordUpdate({execPath: fixture.execPath, corePath: fixture.core})).toBe("migrated");
        const resources = fixture.resources("1.0.9300");
        expect(fs.existsSync(path.join(resources, "app.asar"))).toBeFalse();
        expect(fs.readFileSync(path.join(resources, "betterdiscord.app.asar"), "utf8")).toBe("original-1.0.9300");
        expect(fs.readFileSync(path.join(resources, "app", "package.json"), "utf8")).toBe(SOLCORD_LOADER_PACKAGE);
        const index = fs.readFileSync(path.join(resources, "app", "index.js"), "utf8");
        expect(index).toBe(solcordLoaderIndex(fixture.core));
        const match = INSTALLER_CANONICAL.exec(index);
        expect(match).not.toBeNull();
        expect(JSON.parse(match![1])).toBe(fixture.core);
        expect(fs.readdirSync(path.join(resources, "app")).sort()).toEqual(["index.js", "package.json"]);
        // The running version is never touched.
        expect(fs.readFileSync(path.join(fixture.resources("1.0.9267"), "app.asar"), "utf8")).toBe("original-1.0.9267");
        expect(migrateDiscordUpdate({execPath: fixture.execPath, corePath: fixture.core})).toBe("already-migrated");
    });

    test("leaves the newer version vanilla when any step fails", () => {
        const fixture = discord();
        const rename = fs.renameSync;
        const writable = fs as unknown as {renameSync: typeof fs.renameSync;};
        writable.renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
            if (String(to).endsWith("betterdiscord.app.asar")) throw new Error("EBUSY: archive locked");
            return rename(from, to);
        }) as typeof fs.renameSync;
        try {expect(migrateDiscordUpdate({execPath: fixture.execPath, corePath: fixture.core})).toBe("failed");}
        finally {writable.renameSync = rename;}
        const resources = fixture.resources("1.0.9300");
        expect(fs.readFileSync(path.join(resources, "app.asar"), "utf8")).toBe("original-1.0.9300");
        expect(fs.existsSync(path.join(resources, "app"))).toBeFalse();
        expect(fs.readdirSync(resources)).toEqual(["app.asar"]);
    });

    test("never overwrites unknown loader contents, and does nothing on the newest version", () => {
        const fixture = discord();
        const owner = path.join(fixture.resources("1.0.9300"), "app", "owner.js");
        fs.mkdirSync(path.dirname(owner));
        fs.writeFileSync(owner, "owner");
        expect(migrateDiscordUpdate({execPath: fixture.execPath, corePath: fixture.core})).toBe("occupied-loader");
        expect(fs.readdirSync(path.dirname(owner))).toEqual(["owner.js"]);
        expect(fs.existsSync(path.join(fixture.resources("1.0.9300"), "app.asar"))).toBeTrue();

        const latest = discord(["1.0.9300"]);
        expect(migrateDiscordUpdate({execPath: latest.execPath, corePath: latest.core})).toBe("same-version");
        expect(fs.readdirSync(latest.resources("1.0.9300"))).toEqual(["app.asar"]);
    });

    test("waits while Discord is still staging a background update, then attaches once it is stable", () => {
        const fixture = discord();
        const staged = path.join(fixture.root, "Discord", "app-1.0.9300");
        const archive = path.join(staged, "resources", "app.asar");
        const now = Date.now();
        fs.utimesSync(archive, new Date(now - 5_000), new Date(now - 5_000));
        expect(migrateDiscordUpdate({execPath: fixture.execPath, corePath: fixture.core, minimumStableMs: 60_000, now})).toBe("not-ready");
        fs.utimesSync(archive, new Date(now - 120_000), new Date(now - 120_000));
        fs.rmSync(path.join(staged, "Discord.exe"));
        expect(migrateDiscordUpdate({execPath: fixture.execPath, corePath: fixture.core, minimumStableMs: 60_000, now})).toBe("not-ready");
        fs.writeFileSync(path.join(staged, "Discord.exe"), "fixture");
        expect(fs.readdirSync(path.join(staged, "resources"))).toEqual(["app.asar"]);
        expect(migrateDiscordUpdate({execPath: fixture.execPath, corePath: fixture.core, minimumStableMs: 60_000, now})).toBe("migrated");
        expect(fs.readFileSync(path.join(staged, "resources", "app", "index.js"), "utf8")).toBe(solcordLoaderIndex(fixture.core));
    });

    test("the running-client watch attaches to a staged update without waiting for Discord to quit", () => {
        const fixture = discord();
        const archive = path.join(fixture.resources("1.0.9300"), "app.asar");
        const now = Date.now();
        fs.utimesSync(archive, new Date(now - 10_000), new Date(now - 10_000));
        const watch = new DiscordUpdateWatch({execPath: fixture.execPath, corePath: fixture.core});
        expect(watch.check(now)).toBe("not-ready");
        expect(watch.check(now + DISCORD_UPDATE_STABLE_MS)).toBe("migrated");
        expect(fs.existsSync(path.join(fixture.resources("1.0.9300"), "betterdiscord.app.asar"))).toBeTrue();
        // Settled: later ticks do no filesystem work.
        let calls = 0;
        const counting = new DiscordUpdateWatch({execPath: fixture.execPath, corePath: fixture.core}, options => {calls++; return migrateDiscordUpdate(options);});
        expect(counting.check(now + DISCORD_UPDATE_STABLE_MS)).toBe("already-migrated");
        expect(counting.check(now + 2 * DISCORD_UPDATE_STABLE_MS)).toBe("already-migrated");
        expect(calls).toBe(1);
    });

    test("the quit hook retries briefly when the archive is locked and never throws", () => {
        const fixture = discord();
        const results: Array<"failed" | "migrated"> = ["failed", "failed", "migrated"];
        const sleeps: number[] = [];
        const watch = new DiscordUpdateWatch({execPath: fixture.execPath, corePath: fixture.core}, () => results.shift()!, milliseconds => sleeps.push(milliseconds));
        expect(watch.onQuit()).toBe("migrated");
        expect(sleeps).toEqual([150, 150]);
        const throwing = new DiscordUpdateWatch({execPath: fixture.execPath, corePath: fixture.core}, () => {throw new Error("EPERM");}, () => {});
        expect(throwing.onQuit()).toBe("failed");
        expect(throwing.check()).toBe("failed");
    });

    test("reports a newer folder without an archive instead of creating a loader", () => {
        const fixture = discord();
        fs.rmSync(path.join(fixture.resources("1.0.9300"), "app.asar"));
        expect(migrateDiscordUpdate({execPath: fixture.execPath, corePath: fixture.core})).toBe("missing-archive");
        expect(fs.readdirSync(fixture.resources("1.0.9300"))).toEqual([]);
    });
});
