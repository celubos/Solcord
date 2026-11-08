// SPDX-License-Identifier: Apache-2.0

import {describe, expect, test} from "bun:test";
import fs from "node:fs";
import path from "node:path";

import packageMetadata from "../../package.json";
import {assertSolcordPackageVersion, SOLCORD_PRODUCT_IDENTITY} from "../../src/common/solcord/product-identity";
import {normalizeSolcordProductPreferences} from "../../src/common/solcord/product";

const root = path.resolve(import.meta.dir, "../..");
const legacyMode = (encoded: string) => Buffer.from(encoded, "base64").toString("utf8");

describe("Solcord product identity migration", () => {
    test("normalizes the two pre-rename appearance values without retaining them as active identifiers", () => {
        const dark = normalizeSolcordProductPreferences({appearance: {mode: legacyMode("c291bC1kYXJr")}});
        const light = normalizeSolcordProductPreferences({appearance: {mode: legacyMode("c291bC1saWdodA==")}});

        expect(dark.appearance.mode).toBe("solcord-dark");
        expect(light.appearance.mode).toBe("solcord-light");
    });
});

describe("Solcord release identity", () => {
    test("keeps the compatibility version and v-prefixed release label exact and distinct", () => {
        expect(packageMetadata.version).toBe("2.0.1");
        expect(SOLCORD_PRODUCT_IDENTITY).toEqual({
            product: "Solcord",
            numericVersion: "2.0.1",
            candidateLabel: "v2.0.1-rc.5"
        });
        expect(SOLCORD_PRODUCT_IDENTITY.candidateLabel).not.toBe(SOLCORD_PRODUCT_IDENTITY.numericVersion);
        expect(() => assertSolcordPackageVersion(packageMetadata.version)).not.toThrow();
        expect(() => assertSolcordPackageVersion("2.0.2")).toThrow("typed product identity");
    });

    test("plumbs the release and source identity into build and installed UI surfaces", () => {
        const build = fs.readFileSync(path.join(root, "scripts/build.ts"), "utf8");
        const config = fs.readFileSync(path.join(root, "src/betterdiscord/stores/config.ts"), "utf8");
        const panel = fs.readFileSync(path.join(root, "src/betterdiscord/ui/solcord/panel.tsx"), "utf8");
        const updater = fs.readFileSync(path.join(root, "src/betterdiscord/ui/updater.tsx"), "utf8");
        const main = fs.readFileSync(path.join(root, "src/electron/main/index.ts"), "utf8");
        const debug = fs.readFileSync(path.join(root, "src/betterdiscord/utils/debug.ts"), "utf8");
        const installer = fs.readFileSync(path.join(root, "scripts/build-solcord-v2-installer.mjs"), "utf8");

        expect(build).toContain("process.env.__CANDIDATE__");
        expect(config).toContain("candidate: process.env.__CANDIDATE__!");
        expect(config).toContain("get candidateIdentity()");
        expect(config).toContain("get isCleanCandidateBuild()");
        expect(config).not.toContain("isReviewedCandidateBuild");
        expect(config).toContain("production-clean");
        expect(config).toContain("release-clean");
        expect(panel).toContain(`Config.isCleanCandidateBuild ? "Clean release candidate" : "Diagnostic build"`);
        expect(panel).not.toContain("reviewed release bytes");
        expect(panel).toContain(`<div className="solcord-header-copy"><h1>Solcord</h1><p>Control Center</p>`);
        expect(panel).toContain(`!Config.isCleanCandidateBuild && <span className="solcord-build-warning"`);
        expect(panel).not.toContain("Control Center · {Config");
        expect(panel).not.toContain(`<p>Control Center ·`);
        expect(panel).toContain(`<dt>Candidate</dt><dd>{Config.get("candidate")}</dd>`);
        expect(panel).toContain("Config.get(\"commit\")");
        expect(updater).toContain("Config.candidateIdentity");
        expect(updater).not.toContain("Config.get(\"candidate\")");
        expect(main).toContain("process.env.__BUILD__");
        expect(main).toContain("process.env.__CANDIDATE__");
        expect(debug).toContain("config.candidateIdentity");
        expect(installer).toContain("candidateLabel: postBuild.build.candidateLabel");
    });
});
