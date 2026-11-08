// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {safeAddonFileName} from "@common/solcord/addon-file-policy";

export function assertRegularOwnedPath(root: string, target: string, allowMissing = false): void {
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) throw new TypeError("File is outside its owned root.");
    let cursor = path.resolve(root);
    for (const segment of ["", ...relative.split(path.sep)]) {
        if (segment) cursor = path.join(cursor, segment);
        let stat: fs.Stats;
        try {stat = fs.lstatSync(cursor);}
        catch (error) {if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT" && cursor === target) return; throw error;}
        if (stat.isSymbolicLink()) throw new TypeError("Linked addon paths are not allowed.");
        if (cursor === target ? !stat.isFile() || stat.nlink !== 1 : !stat.isDirectory()) throw new TypeError("Unexpected addon path type.");
    }
    const realRoot = fs.realpathSync(root);
    if (fs.realpathSync(target) !== path.join(realRoot, relative)) throw new TypeError("Addon path changed ownership.");
}

const pendingWrites = new Map<string, Promise<void>>();
export async function writeAddonFile(root: string, kind: "plugin" | "theme", filename: string, content: string, expectedSha256?: string): Promise<void> {
    const canonicalRoot = fs.realpathSync(root);
    const key = path.join(canonicalRoot, `${kind}s`, safeAddonFileName(filename, kind));
    const identity = process.platform === "win32" ? key.toLowerCase() : key;
    const previous = pendingWrites.get(identity) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(() => commitAddonFile(root, canonicalRoot, kind, filename, content, expectedSha256));
    pendingWrites.set(identity, operation);
    try {await operation;}
    finally {if (pendingWrites.get(identity) === operation) pendingWrites.delete(identity);}
}

async function commitAddonFile(root: string, canonicalRoot: string, kind: "plugin" | "theme", filename: string, content: string, expectedSha256?: string): Promise<void> {
    if (kind !== "plugin" && kind !== "theme") throw new TypeError("Unknown addon kind.");
    safeAddonFileName(filename, kind);
    if (typeof content !== "string" || Buffer.byteLength(content) > 8 * 1024 * 1024 || content.includes("\0")) throw new TypeError("Invalid addon content.");
    if (expectedSha256 !== undefined && !/^[0-9a-f]{64}$/.test(expectedSha256)) throw new TypeError("Invalid addon ownership digest.");
    const directory = path.join(root, `${kind}s`);
    const target = path.join(directory, filename);
    const expectedDirectory = path.join(canonicalRoot, `${kind}s`);
    const assertOwnership = () => {
        if (fs.realpathSync(root) !== canonicalRoot || fs.realpathSync(directory) !== expectedDirectory) throw new Error("Addon directory ownership changed.");
        assertRegularOwnedPath(root, target, true);
    };
    // Check every existing component, including the selected root, before staging.
    assertOwnership();
    const exists = fs.existsSync(target);
    if (expectedSha256 === undefined && exists) throw new Error("Addon destination already exists.");
    const digest = () => crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
    if (expectedSha256 !== undefined && (!exists || digest() !== expectedSha256)) throw new Error("Addon changed since update was requested.");
    const staged = path.join(directory, `.${filename}.${crypto.randomBytes(12).toString("hex")}.tmp`);
    const handle = await fs.promises.open(staged, "wx", 0o600);
    let stagedIdentity: fs.Stats | undefined;
    let stagedPhysical: string | undefined;
    let operationError: unknown;
    try {
        stagedIdentity = fs.fstatSync(handle.fd);
        stagedPhysical = fs.realpathSync(staged);
        // An asynchronous open can complete after its parent was swapped. Check
        // the opened file and pinned parent before writing any downloaded bytes.
        assertOwnership();
        if (stagedPhysical !== path.join(expectedDirectory, path.basename(staged)) || fs.statSync(stagedPhysical).ino !== stagedIdentity.ino) throw new Error("Addon staging ownership changed.");
        await handle.writeFile(content, "utf8");
        await handle.sync();
        await handle.close();
        assertOwnership();
        if (expectedSha256 === undefined) {
            // link is an atomic no-replace commit, including a concurrent destination creation.
            fs.linkSync(staged, target);
            fs.unlinkSync(staged);
        }
        else {
            if (!fs.existsSync(target) || digest() !== expectedSha256) throw new Error("Addon changed during download.");
            fs.renameSync(staged, target);
        }
    }
    catch (error) {operationError = error;}
    finally {
        await handle.close().catch(() => {});
        // Clean only the exact file this operation created, even after parent drift.
        try {
            const current = stagedPhysical && fs.lstatSync(stagedPhysical);
            if (current && stagedIdentity && !current.isSymbolicLink() && current.ino === stagedIdentity.ino && current.dev === stagedIdentity.dev) fs.unlinkSync(stagedPhysical!);
        }
        catch (error) {if ((error as NodeJS.ErrnoException).code !== "ENOENT") operationError ??= error;}
    }
    if (operationError) throw operationError;
}
