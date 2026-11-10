// SPDX-License-Identifier: Apache-2.0

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function rejectLink(file: string) {
    try {if (fs.lstatSync(file).isSymbolicLink()) throw new Error("Developer injection refuses linked paths.");}
    catch (error) {if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;}
}

function atomicWrite(file: string, contents: string) {
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
        const handle = fs.openSync(temporary, "wx");
        try {fs.writeFileSync(handle, contents); fs.fsyncSync(handle);}
        finally {fs.closeSync(handle);}
        fs.renameSync(temporary, file);
    }
    finally {if (fs.existsSync(temporary)) fs.unlinkSync(temporary);}
}

/** Packed layouts keep app.asar as the live entry until both loader files commit.
 * Loose layouts are rejected before mutation rather than writing a dangling shim.
 */
export function validateDeveloperLayout(resources: string) {
    if (!path.isAbsolute(resources)) throw new Error("The developer injection paths are invalid.");
    const root = path.resolve(resources);
    for (let current = root; ; current = path.dirname(current)) {
        rejectLink(current);
        if (current === path.dirname(current)) break;
    }
    const vanilla = path.join(root, "app.asar");
    const original = path.join(root, "betterdiscord.app.asar");
    const app = path.join(root, "app");
    const index = path.join(app, "index.js");
    const manifest = path.join(app, "package.json");
    if (fs.existsSync(path.join(root, "betterdiscord.app"))) throw new Error("Loose Discord layouts are unsupported by developer injection; no files were changed.");
    for (const file of [vanilla, original, app, index, manifest]) rejectLink(file);
    if (fs.existsSync(vanilla) === fs.existsSync(original)) throw new Error("Expected exactly one packed Discord startup archive; no files were changed.");
    const archive = fs.existsSync(original) ? original : vanilla;
    if (!fs.statSync(archive).isFile() || fs.statSync(archive).size === 0) throw new Error("Discord's startup archive is missing or empty.");
    const archiveHash = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
    const existed = fs.existsSync(app);
    let priorIndex: string | null = null;
    let priorManifest: string | null = null;
    if (existed) {
        const entries = fs.readdirSync(app).sort();
        if (entries.join("|") !== "index.js|package.json") throw new Error("An existing app directory contains owner files; no files were changed.");
        priorIndex = fs.readFileSync(index, "utf8");
        priorManifest = fs.readFileSync(manifest, "utf8");
        const parsed = JSON.parse(priorManifest);
        if (!priorIndex.includes("module.exports = require(\"../betterdiscord.app.asar\")") || !priorIndex.includes("require(")
            || parsed.main !== "./index.js" || parsed.name !== "discord" || Object.keys(parsed).some(key => key !== "main" && key !== "name")) {throw new Error("The existing app directory is not a recognized developer loader; no files were changed.");}
    }
    return {vanilla, original, app, index, manifest, archive, archiveHash, existed, priorIndex, priorManifest};
}

export function injectDeveloperLoader(resources: string, requirePath: string, mutationHook?: (point: string) => void) {
    if (!requirePath) throw new Error("The developer core path is invalid.");
    const {vanilla, original, app, index, manifest, archive, archiveHash, existed, priorIndex, priorManifest} = validateDeveloperLayout(resources);
    const newIndex = `// __solcord_developer_inject__\nrequire(${JSON.stringify(requirePath)});\nmodule.exports = require("../betterdiscord.app.asar");\n`;
    const newManifest = JSON.stringify({main: "./index.js", name: "discord"});
    let renamed = false;
    try {
        fs.mkdirSync(app, {recursive: true});
        atomicWrite(manifest, newManifest);
        mutationHook?.("after-package");
        atomicWrite(index, newIndex);
        mutationHook?.("after-index");
        if (fs.readFileSync(index, "utf8") !== newIndex || fs.readFileSync(manifest, "utf8") !== newManifest) throw new Error("The developer loader changed during injection.");
        if (crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex") !== archiveHash) throw new Error("Discord's startup archive changed during injection.");
        if (archive === vanilla) {fs.renameSync(vanilla, original); renamed = true;}
        mutationHook?.("after-bootstrap");
    }
    catch (error) {
        for (const [file, expected, prior] of [[index, newIndex, priorIndex], [manifest, newManifest, priorManifest]]) {
            rejectLink(file!);
            if (fs.existsSync(file!) && ![expected, prior].includes(fs.readFileSync(file!, "utf8"))) {throw new AggregateError([error], "Developer injection stopped; a changed owner file was preserved for recovery.");}
        }
        if (renamed && crypto.createHash("sha256").update(fs.readFileSync(original)).digest("hex") !== archiveHash) {throw new AggregateError([error], "Developer injection stopped; the changed Discord archive was preserved.");}
        if (renamed) fs.renameSync(original, vanilla);
        if (existed) {atomicWrite(index, priorIndex!); atomicWrite(manifest, priorManifest!);}
        else {
            for (const file of [index, manifest]) if (fs.existsSync(file)) fs.unlinkSync(file);
            fs.rmdirSync(app);
        }
        throw error;
    }
    return {originalModule: "../betterdiscord.app.asar"};
}
