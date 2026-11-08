import {expect, mock, test} from "bun:test";
import path from "node:path";
import fs from "node:fs";
import {solcordLocalAssets} from "../../scripts/helpers/local-assets";
let receive: any;
const electron = {app: {whenReady: async () => {}}, protocol: {}, net: {}, session: {defaultSession: {webRequest: {onBeforeRequest() {}, onHeadersReceived: (_filter: unknown, callback: unknown) => {receive = callback;}}}}};
mock.module("electron", () => ({"default": electron, ...electron}));
const {default: CSP, localAssetCsp} = await import("../../src/electron/main/modules/csp");
const {resolveLocalAsset} = await import("../../src/electron/main/modules/local-assets");

test("the stylesheet font resolves to an exact packaged asset allowed by the scoped CSP", () => {
    const repo = path.resolve(import.meta.dir, "../..");
    const css = fs.readFileSync(path.join(repo, "src/betterdiscord/styles/solcord.css"), "utf8");
    const url = css.match(/src:\s*url\("([^"]+)"\)/)?.[1];
    expect(url).toBe("solcord://fonts/HankenGrotesk-variable.ttf");
    const dist = path.join(repo, "dist");
    const target = resolveLocalAsset(url!, dist);
    const packaged = solcordLocalAssets(repo).find(asset => path.join(dist, asset.target) === target);
    expect(packaged).toBeDefined();
    const font = fs.readFileSync(packaged!.source);
    expect(font.length).toBeGreaterThan(1000); expect(font.readUInt32BE(0)).toBe(0x00010000);
    const policy = localAssetCsp("default-src 'none'; font-src 'self'");
    expect(policy).toContain("font-src 'self' solcord:"); expect(policy).not.toContain("data:");
});
test("asset paths cannot access user files or escape packaged directories", () => {
    const root = path.resolve("packaged");
    expect(resolveLocalAsset("solcord://catalog/index.json", root)).toBe(path.join(root, "catalog", "index.json"));
    expect(resolveLocalAsset("solcord://fonts/HankenGrotesk-variable.ttf", root)).toBe(path.join(root, "fonts", "HankenGrotesk-variable.ttf"));
    expect(resolveLocalAsset("solcord://editor/monaco/vs/loader.js", root)).toBe(path.join(root, "editor", "monaco", "vs", "loader.js"));
    for (const url of ["solcord://catalog/other.json", "solcord://fonts/settings.json", "solcord://fonts/%2e%2e/settings.json", "solcord://fonts/HankenGrotesk-variable.ttf?filename=secret", "solcord://editor/monaco/vs/%2e%2e/%2e%2e/preload.js", "solcord://editor/monaco/vs/%2fsecret", "solcord://editor/monaco/vs/C:%5csecret", "solcord://editor/monaco/vs/loader.js?filename=secret"]) expect(resolveLocalAsset(url, root)).toBeNull();
});
test("CSP keeps unrelated and embedded policies byte-identical", async () => {
    await CSP.remove();
    const original = {"Content-Security-Policy": ["default-src 'none'; connect-src https://example.invalid"], "Content-Security-Policy-Report-Only": ["default-src 'self'"]};
    for (const [url, resourceType] of [["https://example.invalid/channels/1/2", "mainFrame"], ["https://discord.com/channels/1/2", "subFrame"], ["https://discord.com/assets/script.js", "script"]]) {
        let result: any; receive({url, resourceType, responseHeaders: original}, (value: unknown) => {result = value;}); expect(result.cancel).not.toBe(true); expect(result.responseHeaders).toBeUndefined(); expect(original["Content-Security-Policy"][0]).toBe("default-src 'none'; connect-src https://example.invalid");
    }
    const changed = localAssetCsp("default-src 'self'; script-src 'self'; report-uri /csp");
    expect(changed).toContain("script-src 'self' solcord:"); expect(changed).toContain("report-uri /csp"); expect(changed).not.toContain("unsafe-eval");
});
