// SPDX-License-Identifier: Apache-2.0

import Bun from "bun";
import path from "node:path";
import pkg from "../package.json";
import styleLoader from "bun-style-loader";
import * as esbuild from "esbuild";
import buildPackage from "./helpers/package";
import {writeEmittedFiles} from "./helpers/emitted-files";

import {assertSolcordBuildAllowed, captureSolcordBuildProvenance, type SolcordBuildMode, writeSolcordBuildProvenance} from "./helpers/build-provenance";
import {assertSolcordPackageVersion, SOLCORD_PRODUCT_IDENTITY} from "../src/common/solcord/product-identity";
import {solcordLocalAssets, stageSolcordLocalAssets} from "./helpers/local-assets";


const fileURL = Bun.fileURLToPath(import.meta.url);
const rootDir = path.join(path.dirname(fileURL), "..");
assertSolcordPackageVersion(pkg.version);
const isProduction = process.argv.includes("--minify") || process.argv.includes("--production") || process.argv.includes("--release");
const buildMode: SolcordBuildMode = process.argv.includes("--release")
    ? "release"
    : process.argv.includes("--production")
        ? "production"
        : process.argv.includes("--diagnostic")
            ? "diagnostic"
            : process.argv.includes("--watch")
                ? "watch"
                : "development";

interface EntryPoint {
    in: string;
    out: string;
}

const moduleConfigs: Record<string, EntryPoint> = {
    solcord: {"in": "src/betterdiscord/index.ts", "out": "solcord"},
    main: {"in": "src/electron/main/index.ts", "out": "main"},
    preload: {"in": "src/electron/preload/index.ts", "out": "preload"},
    earlyRenderer: {"in": "src/electron/preload/early/index.ts", "out": "earlyRenderer"},
    editorPreload: {"in": "src/editor/preload.ts", "out": "editor/preload"},
    editor: {"in": "src/editor/script.ts", "out": "editor/script"},
    editorHtml: {"in": "src/editor/index.html", "out": "editor/index"}
};

let modulesRequested = process.argv.filter(a => a.startsWith("--module=")).map(a => a.replace("--module=", ""));
if (!modulesRequested.length) modulesRequested = Object.keys(moduleConfigs);

const entryPoints = modulesRequested.map(m => moduleConfigs[m]);
const provenance = captureSolcordBuildProvenance(rootDir, {
    version: SOLCORD_PRODUCT_IDENTITY.numericVersion,
    candidateLabel: SOLCORD_PRODUCT_IDENTITY.candidateLabel,
    mode: buildMode,
    modules: modulesRequested
});
assertSolcordBuildAllowed(provenance);
const BRANCH_NAME = provenance.source.branch;
const COMMIT_HASH = provenance.source.commit;
const DEVELOPMENT = provenance.buildLabel;

function buildOptions() {
    return {
        entryPoints: entryPoints,
        bundle: true,
        outdir: path.join(rootDir, "dist"),
        format: "cjs",
        jsx: "transform",
        alias: {
            react: "@modules/react",
        },
        external: ["fs", "node:fs", "node:inspector", "original-fs", "path", "node:path", "vm", "electron", "@electron/remote", "module", "request", "events", "child_process", "net", "http", "https", "crypto", "node:crypto", "os", "url", "util/types"],
        target: ["chrome128", "node20"],
        loader: {
            ".js": "jsx",
            ".css": "css",
            ".html": "copy",
            ".png": "dataurl",
            ".svg": "dataurl",
            ".ttf": "dataurl"
        },
        plugins: [styleLoader() as unknown as esbuild.Plugin],
        logLevel: "info",
        treeShaking: true,
        charset: "utf8",
        minify: isProduction,
        legalComments: "none",
        define: {
            "process.env.__VERSION__": JSON.stringify(SOLCORD_PRODUCT_IDENTITY.numericVersion),
            "process.env.__CANDIDATE__": JSON.stringify(SOLCORD_PRODUCT_IDENTITY.candidateLabel),
            "process.env.__MONACO_VERSION__": JSON.stringify(pkg.dependencies["monaco-editor"]),
            "process.env.__BRANCH__": JSON.stringify(BRANCH_NAME),
            "process.env.__COMMIT__": JSON.stringify(COMMIT_HASH),
            "process.env.__BUILD__": JSON.stringify(DEVELOPMENT)
        }
    } satisfies esbuild.BuildOptions;
}

async function runBuild() {
    const before = performance.now();
    const names = modulesRequested.join(", ");
    stageSolcordLocalAssets(rootDir);
    const emittedManifest = path.join(rootDir, "dist", "emitted-files.json");
    if (Bun.file(emittedManifest).size) await Bun.file(emittedManifest).delete();

    console.log("");
    console.log(`Building ${names}...`);

    if (process.argv.includes("--watch")) {
        const ctx = await esbuild.context(buildOptions());
        await ctx.watch();
    }
    else {
        await esbuild.build(buildOptions());
        writeSolcordBuildProvenance(path.join(rootDir, "dist", "build-provenance.json"), provenance);
        buildPackage(path.join(rootDir, "dist"));
        writeEmittedFiles(path.join(rootDir, "dist"), [
            ...entryPoints.map(entry => `${entry.out}.${entry.in.endsWith(".html") ? "html" : "js"}`),
            "package.json", "build-provenance.json", ...solcordLocalAssets(rootDir).map(asset => asset.target)
        ]);
    }

    const after = performance.now();
    console.log(`Finished building ${names} in ${(after - before).toFixed(2)}ms`);
    console.log("");
    console.log(`Type:    ${DEVELOPMENT}`);
    console.log(`Core:    ${SOLCORD_PRODUCT_IDENTITY.numericVersion}`);
    console.log(`Build:   ${SOLCORD_PRODUCT_IDENTITY.candidateLabel}`);
    console.log(`Branch:  ${BRANCH_NAME}`);
    console.log(`Commit:  ${COMMIT_HASH}`);
    console.log("");
}

await runBuild();
