// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const digest = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
export function writeEmittedFiles(dist: string, files: string[]): void {
    const entries = Object.fromEntries([...new Set(files)].sort().map(file => {
        if (path.isAbsolute(file) || file.includes("..") || file.includes("\\")) throw new Error("Invalid build output path.");
        return [file, digest(path.join(dist, file))];
    }));
    fs.writeFileSync(path.join(dist, "emitted-files.json"), `${JSON.stringify({version: 1, files: entries})}\n`);
}
export function assertEmittedFiles(dist: string, expected: string[]): void {
    const manifest = JSON.parse(fs.readFileSync(path.join(dist, "emitted-files.json"), "utf8"));
    if (manifest.version !== 1 || !manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)) throw new Error("Build output manifest is invalid.");
    if (JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify([...new Set(expected)].sort())) throw new Error("Build output inventory does not match the full package.");
    for (const file of expected) {
        const target = path.join(dist, file), stat = fs.lstatSync(target);
        if (!stat.isFile() || stat.isSymbolicLink() || manifest.files[file] !== digest(target)) throw new Error(`Build output changed after compilation: ${file}`);
    }
}
