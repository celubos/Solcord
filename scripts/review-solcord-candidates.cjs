#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const catalogPath = path.join(root, "assets", "catalog", "solcord-catalog.json");
const quarantineRoot = path.resolve(root, "..", "quarantine-solcord-v2", "addon-review");
const outputPath = path.join(root, "assets", "catalog", "solcord-reviewed-addons.json");
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const LICENSE_NAMES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"];

function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function githubSource(url) {
    const match = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([0-9a-f]{40})\/(.+)$/i.exec(url);
    if (!match) return null;
    return {owner: match[1], repository: match[2], revision: match[3].toLowerCase(), file: match[4]};
}

function sanitize(value) {
    return String(value || "candidate").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 160);
}

async function fetchBounded(url, maximumBytes = MAX_SOURCE_BYTES, {fetchImpl = fetch, timeoutMs = 15_000} = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "raw.githubusercontent.com") throw new Error("Only immutable raw.githubusercontent.com HTTPS sources are accepted.");
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError("Invalid download bounds.");
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {controller.abort(); reject(new Error("Source download timed out."));}, timeoutMs);
    });
    let reader;
    let complete = false;
    try {
        const response = await Promise.race([fetchImpl(parsed, {redirect: "error", signal: controller.signal, headers: {"user-agent": "Solcord-Provenance-Review/1.0"}}), deadline]);
        reader = response.body?.getReader();
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const contentLength = Number(response.headers.get("content-length") || 0);
        if (contentLength > maximumBytes) throw new RangeError(`Payload exceeds ${maximumBytes} bytes.`);
        const chunks = [];
        let total = 0;
        while (reader) {
            const {done, value} = await Promise.race([reader.read(), deadline]);
            if (done) break;
            total += value.byteLength;
            if (total > maximumBytes) throw new RangeError(`Payload exceeds ${maximumBytes} bytes.`);
            chunks.push(Buffer.from(value));
        }
        complete = true;
        return Buffer.concat(chunks, total);
    }
    finally {
        clearTimeout(timer);
        if (!complete) {controller.abort(); void reader?.cancel().catch(() => {});}
        reader?.releaseLock();
    }
}

function classifyLicense(text) {
    const heading = text.slice(0, 2048);
    if (/apache license\s*,?\s*version 2\.0/i.test(text)) return "Apache-2.0";
    if (/permission is hereby granted, free of charge/i.test(text)) return "MIT";
    if (/gnu affero general public license[\s\S]{0,160}version\s+3/i.test(heading)) return "AGPL-3.0";
    if (/gnu general public license[\s\S]{0,160}version\s+3/i.test(heading)) return "GPL-3.0";
    if (/gnu general public license[\s\S]{0,160}version\s+2/i.test(heading)) return "GPL-2.0";
    if (/gnu affero general public license/i.test(text)) return "AGPL";
    if (/gnu general public license/i.test(text)) return "GPL";
    if (/redistribution and use in source and binary forms/i.test(text)) return "BSD-family";
    if (/mozilla public license/i.test(text)) return "MPL";
    return "OTHER";
}

async function resolveLicense(source, cache) {
    const key = `${source.owner}/${source.repository}@${source.revision}`;
    if (cache.has(key)) return cache.get(key);
    const promise = (async () => {
        for (const name of LICENSE_NAMES) {
            const url = `https://raw.githubusercontent.com/${source.owner}/${source.repository}/${source.revision}/${name}`;
            try {
                const bytes = await fetchBounded(url, 1024 * 1024);
                const destination = path.join(quarantineRoot, "licenses", sanitize(source.owner), sanitize(source.repository), source.revision, sanitize(name));
                fs.mkdirSync(path.dirname(destination), {recursive: true});
                fs.writeFileSync(destination, bytes);
                return {status: "FOUND", name: classifyLicense(bytes.toString("utf8")), url, sha256: sha256(bytes)};
            }
            catch {/* try the next canonical root filename */}
        }
        return {status: "UNRESOLVED", name: null, url: null, sha256: null};
    })();
    cache.set(key, promise);
    return promise;
}

function staticReview(text) {
    const dependencies = [];
    if (/(?:window|global)\.ZeresPluginLibrary|ZeresPluginLibrary\.buildPlugin/i.test(text)) dependencies.push("ZeresPluginLibrary");
    if (/BDFDB_Global|0BDFDB|BDFDB Library/i.test(text)) dependencies.push("BDFDB");
    if (/LibDiscordInternals/i.test(text)) dependencies.push("LibDiscordInternals");

    const networkSignals = [];
    if (/\bfetch\s*\(/.test(text)) networkSignals.push("fetch");
    if (/XMLHttpRequest|BdApi\.Net|https?\.request|request\s*\(/.test(text)) networkSignals.push("network-api");
    if (/translate\.google|deepl|libretranslate|lingva|translation/i.test(text)) networkSignals.push("translation-provider");

    const accountActionSignals = [];
    if (/sendMessage|sendBotMessage|\.send\s*\(/.test(text)) accountActionSignals.push("message-send-path");
    if (/uploadFiles|instantBatchUpload|promptToUpload|voice.*record/i.test(text)) accountActionSignals.push("upload-or-record-path");
    if (/ackMessage|ackChannel|mark.*read/i.test(text)) accountActionSignals.push("read-state-path");
    if (/startTyping|stopTyping/i.test(text)) accountActionSignals.push("typing-state-path");

    const prohibitedSignals = [];
    if (/getToken\s*\(|(?:localStorage|sessionStorage)[^\n]{0,80}(?:token|authorization)|authorization\s*:\s*["'`]?\s*(?:token|Bearer)/i.test(text)) prohibitedSignals.push("credential-access");
    if (/entitlement|premiumType|premium_type|skuId|quest.*complete/i.test(text)) prohibitedSignals.push("entitlement-or-quest");

    const resourceSignals = [];
    if (/Patcher\.|BdApi\.Patcher/.test(text)) resourceSignals.push("patcher");
    if (/addEventListener/.test(text)) resourceSignals.push("event-listener");
    if (/setInterval|setTimeout/.test(text)) resourceSignals.push("timer");
    if (/MutationObserver/.test(text)) resourceSignals.push("mutation-observer");
    const cleanupSignals = [];
    if (/\bstop\s*\([^)]*\)\s*\{/.test(text)) cleanupSignals.push("stop-method");
    if (/unpatchAll|cancelAll|removeEventListener|clearInterval|clearTimeout|disconnect\s*\(/.test(text)) cleanupSignals.push("explicit-cleanup");

    return {
        dependencies: [...new Set(dependencies)],
        networkSignals: [...new Set(networkSignals)],
        accountActionSignals: [...new Set(accountActionSignals)],
        prohibitedSignals: [...new Set(prohibitedSignals)],
        resourceSignals: [...new Set(resourceSignals)],
        cleanupSignals: [...new Set(cleanupSignals)],
        hasPluginHeader: /@name\s+\S+/.test(text) && /@version\s+\S+/.test(text),
        containsSourceMap: /sourceMappingURL=/.test(text)
    };
}

async function review(candidate, licenseCache) {
    const source = githubSource(candidate.sourceUrl);
    if (!source || source.revision !== candidate.immutableRevision) return {...candidate, reviewStatus: "HOLD", reviewError: "Source URL is not an immutable GitHub raw URL."};
    const bytes = await fetchBounded(candidate.sourceUrl);
    const text = bytes.toString("utf8");
    if (text.includes("\0")) throw new TypeError("Plugin payload contains NUL bytes.");
    const destination = path.join(quarantineRoot, "sources", `${candidate.catalogId}-${sanitize(candidate.fileName)}`);
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.writeFileSync(destination, bytes);
    const license = await resolveLicense(source, licenseCache);
    const scan = staticReview(text);
    const staticPass = scan.hasPluginHeader && scan.prohibitedSignals.length === 0;
    return {
        catalogId: candidate.catalogId,
        name: candidate.name,
        fileName: candidate.fileName,
        version: candidate.version,
        author: candidate.author,
        sourceUrl: candidate.sourceUrl,
        immutableRevision: candidate.immutableRevision,
        sourceSha256: sha256(bytes),
        sizeBytes: bytes.length,
        targetDisposition: candidate.targetDisposition,
        requestedByPreset: candidate.requestedByPreset,
        license,
        dependencies: scan.dependencies,
        capabilities: candidate.capabilities,
        conflicts: candidate.conflicts,
        networkBehavior: scan.networkSignals.length ? scan.networkSignals : ["no-static-network-signal"],
        accountActions: scan.accountActionSignals.length ? scan.accountActionSignals : ["no-static-account-action-signal"],
        prohibitedSignals: scan.prohibitedSignals,
        cleanupBehavior: {resources: scan.resourceSignals, cleanup: scan.cleanupSignals},
        verification: {
            metadata: "REVIEWED",
            provenance: license.status === "FOUND" ? "LICENSE_RECORDED" : "OFFICIAL_CATALOG_UNCHANGED_ONLY",
            code: staticPass ? "STATIC_REVIEWED" : "HOLD",
            security: staticPass ? "STATIC_REVIEWED" : "HOLD",
            runtime: "PENDING"
        },
        installable: false,
        reviewStatus: staticPass ? "STATIC_PASS_RUNTIME_REQUIRED" : "HOLD",
        reviewError: staticPass ? null : "Static review found a missing header or prohibited signal."
    };
}

async function reviewBdfdb(licenseCache) {
    const response = await fetch("https://api.github.com/repos/mwittrien/BetterDiscordAddons/commits/master", {
        redirect: "error",
        headers: {accept: "application/vnd.github+json", "user-agent": "Solcord-Provenance-Review/1.0"}
    });
    if (!response.ok) throw new Error(`BDFDB revision lookup returned HTTP ${response.status}.`);
    const metadata = await response.json();
    const revision = typeof metadata?.sha === "string" && /^[0-9a-f]{40}$/i.test(metadata.sha) ? metadata.sha.toLowerCase() : undefined;
    if (!revision) throw new TypeError("BDFDB revision lookup did not return an immutable commit.");
    const sourceUrl = `https://raw.githubusercontent.com/mwittrien/BetterDiscordAddons/${revision}/Library/0BDFDB.plugin.js`;
    const bytes = await fetchBounded(sourceUrl);
    const destination = path.join(quarantineRoot, "dependencies", "0BDFDB.plugin.js");
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.writeFileSync(destination, bytes);
    const source = githubSource(sourceUrl);
    const license = await resolveLicense(source, licenseCache);
    const scan = staticReview(bytes.toString("utf8"));
    return {
        name: "BDFDB",
        fileName: "0BDFDB.plugin.js",
        sourceUrl,
        immutableRevision: revision,
        sourceSha256: sha256(bytes),
        sizeBytes: bytes.length,
        license,
        prohibitedSignals: scan.prohibitedSignals,
        verification: {metadata: "REVIEWED", provenance: "LICENSE_RECORDED", code: scan.prohibitedSignals.length ? "HOLD" : "STATIC_REVIEWED", security: scan.prohibitedSignals.length ? "HOLD" : "STATIC_REVIEWED", runtime: "PENDING"},
        installable: false,
        reviewStatus: scan.prohibitedSignals.length ? "HOLD" : "STATIC_PASS_RUNTIME_REQUIRED"
    };
}

async function main() {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    const selected = catalog.candidates.filter((candidate) => candidate.type === "plugin" && (candidate.requestedByPreset || candidate.targetDisposition === "OPTIONAL"));
    const licenseCache = new Map();
    const results = [];
    for (const candidate of selected) {
        try {
            results.push(await review(candidate, licenseCache));
            process.stdout.write(`reviewed ${candidate.name}\n`);
        }
        catch (error) {
            results.push({catalogId: candidate.catalogId, name: candidate.name, fileName: candidate.fileName, requestedByPreset: candidate.requestedByPreset, targetDisposition: candidate.targetDisposition, installable: false, reviewStatus: "HOLD", reviewError: error instanceof Error ? error.message : String(error)});
            process.stdout.write(`held ${candidate.name}\n`);
        }
    }
    let dependencies = [];
    try {
        dependencies = [await reviewBdfdb(licenseCache)];
        process.stdout.write("reviewed BDFDB dependency\n");
    }
    catch (error) {
        dependencies = [{name: "BDFDB", fileName: "0BDFDB.plugin.js", installable: false, reviewStatus: "HOLD", reviewError: error instanceof Error ? error.message : String(error)}];
        process.stdout.write("held BDFDB dependency\n");
    }
    const evidence = {
        schemaVersion: 1,
        reviewedAt: "2026-08-22",
        catalogSnapshot: catalog.snapshot,
        sourcePayloadLocation: "Sibling quarantine only; third-party source is not committed.",
        dependencies,
        candidates: results
    };
    fs.mkdirSync(path.dirname(outputPath), {recursive: true});
    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
    const staticPass = results.filter((result) => result.reviewStatus === "STATIC_PASS_RUNTIME_REQUIRED").length;
    process.stdout.write(`${staticPass}/${results.length} candidates passed static review; all remain non-installable until runtime acceptance.\n`);
}

module.exports = {fetchBounded};

if (require.main === module) main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
});
