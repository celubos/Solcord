// SPDX-License-Identifier: Apache-2.0

import {expect, test} from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {validateUploadedAssets} from "../../scripts/publish-solcord-release";
import {collectReleaseFiles, prepareRelease} from "../../scripts/prepare-solcord-release";
import {SOLCORD_PRODUCT_IDENTITY} from "../../src/common/solcord/product-identity";

test("publication requires the exact server-side asset names, sizes, and SHA-256 digests", () => {
    const expected = [{name: "SolcordInstaller.exe", bytes: 42, sha256: "a".repeat(64)}];
    const asset = {name: "SolcordInstaller.exe", size: 42, digest: `sha256:${"a".repeat(64)}`};
    expect(() => validateUploadedAssets(expected, [asset])).not.toThrow();
    expect(() => validateUploadedAssets(expected, [])).toThrow("inventory");
    expect(() => validateUploadedAssets(expected, [asset, asset])).toThrow("inventory");
    for (const changed of [{...asset, size: 41}, {...asset, name: "other.exe"}, {...asset, digest: null}, {...asset, digest: `sha256:${"b".repeat(64)}`}]) {
        expect(() => validateUploadedAssets(expected, [changed])).toThrow("verification failed");
    }
});

function packageFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "solcord-release-assets-"));
    const commit = "a".repeat(40), version = SOLCORD_PRODUCT_IDENTITY.numericVersion, candidateLabel = SOLCORD_PRODUCT_IDENTITY.candidateLabel;
    const windows = path.join(root, "windows"); fs.mkdirSync(windows);
    const write = (file: string, value: unknown) => fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
    const describe = (file: string) => ({name: path.basename(file), bytes: fs.statSync(file).size, sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex")});
    write(path.join(windows, "solcord.asar"), "synthetic core"); write(path.join(windows, "SolcordInstaller.exe"), "synthetic installer"); write(path.join(windows, "SHA256SUMS.txt"), "fixture checksums");
    const core = describe(path.join(windows, "solcord.asar"));
    write(path.join(windows, "solcord-build-manifest.json"), {kind: "solcord-post-build-manifest", build: {source: {commit, clean: true}, mode: "production", version, candidateLabel}, artifacts: {asar: core}});
    write(path.join(windows, "solcord-installer-manifest.json"), {sourceCommit: commit, version, candidateLabel, artifactSha256: core.sha256, buildManifestSha256: describe(path.join(windows, "solcord-build-manifest.json")).sha256});
    const files = fs.readdirSync(windows).map(name => describe(path.join(windows, name)));
    write(path.join(windows, "solcord-installer-build-receipt.json"), {kind: "solcord-installer-build-receipt", sourceCommit: commit, sourceClean: true, productVersion: version, candidateLabel, selfTest: {result: "PASS", isolatedWorkingDirectory: true}, files});
    for (const arch of ["arm64", "x64"]) {
        const directory = path.join(root, `macos-${arch}`); fs.mkdirSync(directory);
        const name = `Solcord-macOS-${arch}-${candidateLabel}.zip`, archive = path.join(directory, name); write(archive, "synthetic archive");
        write(path.join(directory, "macos-package-receipt.json"), {schemaVersion: 1, sourceCommit: commit, version, candidateLabel, arch, platform: "darwin", stageOnly: false, preview: true, notarized: false, zip: {file: name, ...describe(archive)}, nativeValidation: {matchingArchitecture: true, cliSignatureVerified: true, compiledSelfTest: "PASS"}, officialBundleValidation: {passed: true, sourceCommit: commit, arch, packageZipSha256: describe(archive).sha256, originalPreserved: true, launchedDiscord: false}});
    }
    return {root, commit, windows, write};
}

test("release assembly preserves Windows receipts and binds both native Mac archives", () => {
    const fixture = packageFixture();
    try {
        expect(collectReleaseFiles(fixture.root, fixture.commit)).toHaveLength(10);
        const output = path.join(fixture.root, "assembled");
        prepareRelease(fixture.root, output, fixture.commit);
        expect(fs.readdirSync(output)).toHaveLength(14);
        expect(fs.readFileSync(path.join(output, "SHA256SUMS.txt"), "utf8")).toBe("fixture checksums");
        expect(fs.readFileSync(path.join(output, "release-notes.md"), "utf8")).toContain(`/blob/${fixture.commit}/docs/MACOS.md`);
        expect(fs.readFileSync(path.join(output, "release-notes.md"), "utf8")).toContain(`/blob/${fixture.commit}/docs/releases/2.0.1-performance.json`);
        expect(() => prepareRelease(fixture.root, output, fixture.commit)).toThrow("new directory");
    }
    finally {fs.rmSync(fixture.root, {recursive: true, force: true});}
});

test("release assembly refuses cross-commit, tampered, incomplete and non-native artifacts", () => {
    for (const failure of ["source", "bytes", "missing", "stage-only", "self-test", "architecture", "official-bundle"]) {
        const fixture = packageFixture();
        try {
            if (failure === "source") {expect(() => collectReleaseFiles(fixture.root, "b".repeat(40))).toThrow("evidence is invalid");}
            else {
                if (failure === "bytes") fs.appendFileSync(path.join(fixture.windows, "SolcordInstaller.exe"), "changed");
                if (failure === "missing") fs.unlinkSync(path.join(fixture.windows, "solcord.asar"));
                if (["stage-only", "self-test", "architecture", "official-bundle"].includes(failure)) {
                    const file = path.join(fixture.root, "macos-arm64", "macos-package-receipt.json"), receipt = JSON.parse(fs.readFileSync(file, "utf8"));
                    if (failure === "stage-only") receipt.stageOnly = true;
                    if (failure === "self-test") receipt.nativeValidation.compiledSelfTest = "NOT_RUN";
                    if (failure === "architecture") receipt.arch = "x64";
                    if (failure === "official-bundle") delete receipt.officialBundleValidation;
                    fixture.write(file, receipt);
                }
                expect(() => collectReleaseFiles(fixture.root, fixture.commit)).toThrow();
            }
        }
        finally {fs.rmSync(fixture.root, {recursive: true, force: true});}
    }
});
