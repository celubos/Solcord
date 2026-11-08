// SPDX-License-Identifier: Apache-2.0

import path from "path";
import fs from "fs";
import crypto from "crypto";
import asar from "@electron/asar";

import doSanityChecks from "./helpers/validate";
import buildPackage from "./helpers/package";
import {assertEmittedFiles} from "./helpers/emitted-files";
import {finishSolcordAsar} from "./helpers/finish-asar";
import {assertSolcordBuildStillCurrent, assertSolcordPackagingAllowed, captureSolcordBuildProvenance, createSolcordPostBuildManifest, readSolcordBuildProvenance, writeSolcordPostBuildManifest} from "./helpers/build-provenance";
import pkg from "../package.json";
import {assertSolcordPackageVersion, SOLCORD_PRODUCT_IDENTITY} from "../src/common/solcord/product-identity";
import {solcordLocalAssets} from "./helpers/local-assets";


const dist = path.resolve(__dirname, "..", "dist");
const bundleFile = path.join(dist, "solcord.asar");
const checksumsFile = path.join(dist, "checksums.txt");
const buildProvenanceFile = path.join(dist, "build-provenance.json");
const postBuildManifestFile = path.join(dist, "solcord-build-manifest.json");
const diagnostic = process.argv.includes("--diagnostic");
assertSolcordPackageVersion(pkg.version);

const files = [
    "dist/main.js",
    "dist/package.json",
    "dist/preload.js",
    "dist/earlyRenderer.js",
    "dist/solcord.js",
    "dist/editor/preload.js",
    "dist/editor/script.js",
    "dist/editor/index.html",
    "dist/build-provenance.json",
    ...solcordLocalAssets(path.resolve(__dirname, "..")).map(asset => `dist/${asset.target}`)
];

const makeHash = () => {
    const arr = Array<string>(files.length);

    for (let index = 0; index < files.length; index++) {
        const fp = files[index];

        const buffer = fs.readFileSync(fp);

        const sha256 = crypto.createHash("sha256").update(buffer).digest().toString("hex");

        arr[index] = `${sha256}  ${fp.slice(5)}`;
    }

    fs.writeFileSync(checksumsFile, `${arr.join("\n")}\n`);
    console.log(`    ✅ Successfully created checksums ${checksumsFile}`);
};

const makeBundle = async function () {
    console.log("");
    console.log("Generating bundle");
    await finishSolcordAsar(asar.createPackageFromFiles(dist, bundleFile, files));
    const bundleStats = fs.statSync(bundleFile);
    if (!bundleStats.isFile() || bundleStats.size === 0) throw new Error("The generated Solcord asar is empty.");
    console.log(`    ✅ Successfully created bundle ${bundleFile}`);
    makeHash();
};

const builtProvenance = readSolcordBuildProvenance(buildProvenanceFile);
assertSolcordPackagingAllowed(builtProvenance, diagnostic);
const currentProvenance = captureSolcordBuildProvenance(path.resolve(__dirname, ".."), {
    version: SOLCORD_PRODUCT_IDENTITY.numericVersion,
    candidateLabel: SOLCORD_PRODUCT_IDENTITY.candidateLabel,
    mode: builtProvenance.mode,
    modules: builtProvenance.modules,
    buildTimestamp: builtProvenance.buildTimestamp
});
assertSolcordBuildStillCurrent(builtProvenance, currentProvenance);
assertEmittedFiles(dist, files.map(file => file.slice(5)));
doSanityChecks(dist);
buildPackage(dist);
// cleanOldAsar();
await makeBundle();
const postBuildManifest = createSolcordPostBuildManifest(builtProvenance, {
    asar: bundleFile,
    packageMetadata: path.join(dist, "package.json"),
    checksums: checksumsFile,
    embeddedBuildProvenance: buildProvenanceFile
});
writeSolcordPostBuildManifest(postBuildManifestFile, postBuildManifest);
console.log(`    ✅ Wrote authoritative build manifest ${postBuildManifestFile}`);
