import {afterEach, expect, test} from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {writeEmittedFiles, assertEmittedFiles} from "../../scripts/helpers/emitted-files";
import buildPackage from "../../scripts/helpers/package";
const roots: string[] = [];
afterEach(() => {for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true});});
test("packaging rejects modified output and incomplete compilation inventory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "solcord-emitted-")); roots.push(root);
    fs.writeFileSync(path.join(root, "preload.js"), "compiled"); writeEmittedFiles(root, ["preload.js"]);
    expect(() => assertEmittedFiles(root, ["preload.js"])).not.toThrow();
    fs.writeFileSync(path.join(root, "preload.js"), "modified");
    expect(() => assertEmittedFiles(root, ["preload.js"])).toThrow("changed");
    expect(() => assertEmittedFiles(root, ["preload.js", "main.js"])).toThrow("inventory");
});
test("canonical package metadata removes stale executable semantics", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "solcord-package-")); roots.push(root);
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({name: "solcord", main: "main.js", type: "module", scripts: {preinstall: "unexpected"}}));
    buildPackage(root); expect(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))).toEqual({name: "solcord", main: "main.js"});
});
