// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";

export function solcordLocalAssets(root: string): Array<{source: string; target: string;}> {
    const assets = [{source: path.join(root, "assets/catalog/solcord-browsing.generated.json"), target: "catalog/index.json"},
        {source: path.join(root, "node_modules/monaco-editor/LICENSE"), target: "editor/monaco/LICENSE"}];
    const sourceRoot = path.join(root, "node_modules/monaco-editor/min/vs");
    const walk = (directory: string) => {
        for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
            const source = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) throw new Error("Local editor assets cannot contain links.");
            if (entry.isDirectory()) walk(source);
            else if (entry.isFile()) assets.push({source, target: `editor/monaco/vs/${path.relative(sourceRoot, source).replaceAll("\\", "/")}`});
        }
    };
    walk(sourceRoot);
    return assets;
}

export function stageSolcordLocalAssets(root: string): void {
    for (const {source, target} of solcordLocalAssets(root)) {
        const destination = path.join(root, "dist", target);
        fs.mkdirSync(path.dirname(destination), {recursive: true});
        fs.copyFileSync(source, destination);
    }
}
