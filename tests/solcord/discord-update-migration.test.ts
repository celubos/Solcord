import {afterEach, describe, expect, test} from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";

import {migrateDiscordUpdate, SOLCORD_LOADER_PACKAGE, solcordLoaderIndex} from "../../src/electron/main/discord-update-migration";

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

    test("reports a newer folder without an archive instead of creating a loader", () => {
        const fixture = discord();
        fs.rmSync(path.join(fixture.resources("1.0.9300"), "app.asar"));
        expect(migrateDiscordUpdate({execPath: fixture.execPath, corePath: fixture.core})).toBe("missing-archive");
        expect(fs.readdirSync(fixture.resources("1.0.9300"))).toEqual([]);
    });
});
