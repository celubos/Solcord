// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, expect, test} from "bun:test";
import stylelint from "stylelint";
import {updateTranslations, downloadTranslationJson} from "../../scripts/translations";
import {isSolcordOwned} from "../../scripts/helpers/repository-ownership.mjs";
import {circularEdges, compareCircularEdges} from "../../scripts/check-circulars.mjs";
import {cssDiagnostics, addedCssDiagnostics} from "../../scripts/check-css-baseline.mjs";

const roots: string[] = [];
afterEach(() => {for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true});});
function directory() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "solcord-translations-"));
    roots.push(root);
    fs.writeFileSync(path.join(root, "fr.json"), "{\"old\":\"French\"}\n");
    fs.writeFileSync(path.join(root, "de.json"), "{\"old\":\"German\"}\n");
    return root;
}
const json = (value: unknown) => new Response(JSON.stringify(value), {headers: {"content-type": "application/json"}});

test("translation export preserves the signed URL and only sends API credentials to POEditor", async () => {
    const root = directory();
    const calls: Array<{url: string; body: BodyInit | null | undefined}> = [];
    const responses = [json({result: {languages: [{code: "fr"}]}}), json({result: {url: "https://exports.example/fr.json?signature=fixture"}}), json({Panels: {plugins: "Extensions"}})];
    const fetchImpl = (async (input: URL | RequestInfo, options?: RequestInit) => {calls.push({url: String(input), body: options?.body}); return responses.shift()!;}) as typeof fetch;
    expect(await updateTranslations({directory: root, fetchImpl, apiToken: "fixture-token", projectId: "fixture-project"})).toEqual(["fr.json"]);
    expect(calls[2]).toEqual({url: "https://exports.example/fr.json?signature=fixture", body: undefined});
    expect(String(calls[0].body)).toContain("api_token=fixture-token");
    expect(JSON.parse(fs.readFileSync(path.join(root, "fr.json"), "utf8"))).toEqual({Panels: {plugins: "Extensions"}});
});

test.each([new Response("<html>forbidden</html>", {status: 403}), new Response("<html>not json</html>"), json(["invalid-locale"])])("failed locale payload preserves the complete previous locale set", async failure => {
    const root = directory();
    const responses = [json({result: {languages: [{code: "fr"}, {code: "de"}]}}), json({result: {url: "https://exports.example/fr.json"}}), json({message: "new-french"}), json({result: {url: "https://exports.example/de.json"}}), failure];
    const fetchImpl = (async () => responses.shift()!) as typeof fetch;
    await expect(updateTranslations({directory: root, fetchImpl, apiToken: "fixture", projectId: "fixture"})).rejects.toThrow();
    expect(fs.readFileSync(path.join(root, "fr.json"), "utf8")).toBe("{\"old\":\"French\"}\n");
    expect(fs.readFileSync(path.join(root, "de.json"), "utf8")).toBe("{\"old\":\"German\"}\n");
    expect(fs.readdirSync(root).sort()).toEqual(["de.json", "fr.json"]);
});

test("unmapped languages are rejected before any locale export or write", async () => {
    const root = directory();
    let calls = 0;
    const fetchImpl = (async () => {calls++; return json({result: {languages: [{code: "../../owner"}]}});}) as typeof fetch;
    await expect(updateTranslations({directory: root, fetchImpl, apiToken: "fixture", projectId: "fixture"})).rejects.toThrow("unmapped language");
    expect(calls).toBe(1);
    expect(fs.readFileSync(path.join(root, "fr.json"), "utf8")).toBe("{\"old\":\"French\"}\n");
});

test("translation transfers enforce byte and stalled-response bounds", async () => {
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({pull(controller) {controller.enqueue(new Uint8Array(4));}, cancel() {cancelled++;}});
    await expect(downloadTranslationJson(new URL("https://exports.example/fr"), {}, {maximumBytes: 6, fetchImpl: (async () => new Response(body)) as typeof fetch})).rejects.toThrow("byte limit");
    expect(cancelled).toBe(1);
    const stalled = new ReadableStream<Uint8Array>({cancel() {cancelled++;}});
    await expect(downloadTranslationJson(new URL("https://exports.example/fr"), {}, {timeoutMs: 10, fetchImpl: (async () => new Response(stalled)) as typeof fetch})).rejects.toThrow("timed out");
    expect(cancelled).toBe(2);
});

test("actual runtime and installer paths contribute to custom ownership", () => {
    expect(isSolcordOwned("src/betterdiscord/modules/solcord/runtime.ts")).toBeTrue();
    expect(isSolcordOwned("installer/Solcord.Installer/InstallerEngine.cs")).toBeTrue();
    expect(isSolcordOwned("src/betterdiscord/modules/addonmanager.ts")).toBeFalse();
});

test("dependency gate detects new Solcord cycle edges independent of group order and rotation", () => {
    const baseline = circularEdges([["a.ts", "b.ts", "c.ts"]]);
    expect(compareCircularEdges(circularEdges([["b.ts", "c.ts", "a.ts"]]), baseline).added).toEqual([]);
    const introduced = circularEdges([["a.ts", "b.ts", "c.ts"], ["src/common/solcord/new.ts", "a.ts"]]);
    expect(compareCircularEdges(introduced, baseline).added).toHaveLength(2);
});

test("a new invalid nested stylesheet cannot inherit existing CSS diagnostic allowances", async () => {
    const source = path.join(process.cwd(), "src/betterdiscord/styles/new/nested.css");
    const result = await stylelint.lint({code: ".fixture { color: #GGGGGG; }", codeFilename: source, configFile: path.resolve(".stylelintrc")});
    const diagnostics = cssDiagnostics(result.results);
    expect(Object.values(diagnostics).reduce((sum, value) => sum + value, 0)).toBeGreaterThan(0);
    expect(addedCssDiagnostics(diagnostics, {})).not.toHaveLength(0);
    expect(addedCssDiagnostics(diagnostics, diagnostics)).toEqual([]);
});
