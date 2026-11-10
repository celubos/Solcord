// SPDX-License-Identifier: Apache-2.0

import {afterEach, describe, expect, test} from "bun:test";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {SOLCORD_CATALOG_DETAIL_SHA256} from "../../src/common/solcord/addon-trust.generated";
import {assertSolcordCatalogAsset, solcordLocalAssets, stageSolcordLocalAssets} from "../../scripts/helpers/local-assets";

const project = path.resolve(import.meta.dir, "../..");
const catalogPath = "assets/catalog/solcord-browsing.generated.json";
const canonical = fs.readFileSync(path.join(project, catalogPath));
const roots: string[] = [];
function fixtureRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "solcord-catalog-eol-")); roots.push(root);
    return root;
}
afterEach(() => {
    for (const root of roots.splice(0)) {
        if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("solcord-catalog-eol-")) throw new Error("Unexpected catalog fixture cleanup path");
        fs.rmSync(root, {recursive: true, force: true});
    }
});
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("catalog exact-byte checkout and packaging", () => {
    test("Git autocrlf checkout preserves the pinned asset while converting an unpinned control", () => {
        expect(digest(canonical)).toBe(SOLCORD_CATALOG_DETAIL_SHA256);
        const root = fixtureRoot(), repository = path.join(root, "repository"), checkout = path.join(root, "checkout");
        fs.mkdirSync(path.join(repository, "assets/catalog"), {recursive: true});
        fs.writeFileSync(path.join(repository, ".gitattributes"), fs.readFileSync(path.join(project, ".gitattributes")));
        fs.writeFileSync(path.join(repository, catalogPath), canonical);
        fs.writeFileSync(path.join(repository, "assets/catalog/control.json"), canonical);
        const emptyConfig = path.join(root, "empty-gitconfig"); fs.writeFileSync(emptyConfig, "");
        const env = {...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: emptyConfig};
        const git = (...args: string[]) => execFileSync("git", ["-C", repository, ...args], {env, stdio: "pipe", windowsHide: true});
        git("init"); git("config", "core.autocrlf", "true"); git("config", "core.attributesfile", emptyConfig);
        git("add", "--", ".gitattributes", catalogPath, "assets/catalog/control.json");
        git("checkout-index", "--all", `--prefix=${checkout.replaceAll("\\", "/")}/`);
        const copied = fs.readFileSync(path.join(checkout, catalogPath));
        const control = fs.readFileSync(path.join(checkout, "assets/catalog/control.json"));
        expect(control.toString("utf8")).toContain("\r\n");
        expect(digest(control)).not.toBe(SOLCORD_CATALOG_DETAIL_SHA256);
        expect(copied.equals(canonical)).toBeTrue();
        expect(digest(copied)).toBe(SOLCORD_CATALOG_DETAIL_SHA256);
        expect(() => assertSolcordCatalogAsset(path.join(checkout, catalogPath))).not.toThrow();
    });

    test.each(["CRLF", "JSON whitespace"])("packaging rejects %s byte drift without normalizing or staging it", variation => {
        const root = fixtureRoot(), file = path.join(root, catalogPath);
        fs.mkdirSync(path.dirname(file), {recursive: true});
        const changed = variation === "CRLF" ? Buffer.from(canonical.toString("utf8").replaceAll("\n", "\r\n")) : Buffer.concat([canonical.subarray(0, -1), Buffer.from(" \n")]);
        expect(JSON.parse(changed.toString("utf8"))).toEqual(JSON.parse(canonical.toString("utf8")));
        expect(digest(changed)).not.toBe(SOLCORD_CATALOG_DETAIL_SHA256);
        fs.writeFileSync(file, changed);
        expect(() => assertSolcordCatalogAsset(file)).toThrow("catalog digest");
        expect(() => solcordLocalAssets(root)).toThrow("catalog digest");
        expect(() => stageSolcordLocalAssets(root)).toThrow("catalog digest");
        expect(fs.existsSync(path.join(root, "dist"))).toBeFalse();
    });

    test("stages the exact verified catalog bytes without changing the renderer digest", () => {
        const root = fixtureRoot();
        const files = [catalogPath, "src/betterdiscord/styles/fonts/HankenGrotesk-variable.ttf", "node_modules/monaco-editor/LICENSE", "node_modules/monaco-editor/min/vs/loader.js"];
        for (const file of files) {
            fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true});
            fs.writeFileSync(path.join(root, file), file === catalogPath ? canonical : "controlled local asset");
        }
        stageSolcordLocalAssets(root);
        const staged = fs.readFileSync(path.join(root, "dist/catalog/index.json"));
        expect(staged.equals(canonical)).toBeTrue();
        expect(digest(staged)).toBe(SOLCORD_CATALOG_DETAIL_SHA256);
        expect(() => assertSolcordCatalogAsset(path.join(root, "dist/catalog/index.json"))).not.toThrow();
    });
});
