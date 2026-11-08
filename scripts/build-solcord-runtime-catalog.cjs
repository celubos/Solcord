#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const reviewPath = path.join(root, "assets", "catalog", "solcord-reviewed-addons.json");
const catalogPath = path.join(root, "assets", "catalog", "solcord-catalog.json");
const acceptancePath = path.join(root, "assets", "catalog", "solcord-runtime-acceptance.json");
const securityPath = path.join(root, "assets", "catalog", "solcord-security-dispositions.json");
const themeRoot = path.join(root, "assets", "themes");
const outputPath = path.join(root, "src", "common", "solcord", "addon-catalog.generated.ts");

const themes = [
    ["solcord-default", "Solcord Default", "Solcord-Default.theme.css"],
    ["obsidian-thread", "Obsidian Thread", "Solcord-ObsidianThread.theme.css"],
    ["carbon-ember", "Carbon Ember", "Solcord-CarbonEmber.theme.css"],
    ["midnight-glass", "Midnight Glass", "Solcord-MidnightGlass.theme.css"],
    ["paper-signal", "Paper Signal", "Solcord-PaperSignal.theme.css"],
    ["threadline", "Threadline", "Solcord-Threadline.theme.css"],
    ["signal-block", "Signal Block", "Solcord-SignalBlock.theme.css"],
    ["relay-classic", "Relay Classic", "Solcord-RelayClassic.theme.css"],
    ["workshop", "Workshop", "Solcord-Workshop.theme.css"],
    ["quiet-read", "Quiet Read", "Solcord-QuietRead.theme.css"],
    ["night-transit", "Night Transit", "Solcord-NightTransit.theme.css"]
];

const REVIEW_SCHEMA_VERSION = 1;
const CATALOG_SCHEMA_VERSION = 1;
const ACCEPTANCE_SCHEMA_VERSION = 1;
const SECURITY_SCHEMA_VERSION = 2;

function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function staticStageable(candidate) {
    return typeof candidate.sourceUrl === "string"
        && /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[0-9a-f]{40}\//i.test(candidate.sourceUrl)
        && typeof candidate.sourceSha256 === "string"
        && /^[0-9a-f]{64}$/.test(candidate.sourceSha256)
        && candidate.verification?.code === "STATIC_REVIEWED"
        && candidate.verification?.security === "STATIC_REVIEWED";
}

function assertSchema(document, expected, label) {
    if (!document || typeof document !== "object" || Array.isArray(document) || document.schemaVersion !== expected) {
        throw new TypeError(`${label} schema must be exactly version ${expected}.`);
    }
}

function assertUniqueRecords(records, label) {
    if (!Array.isArray(records)) throw new TypeError(`${label} must be an array.`);
    const names = new Set();
    const files = new Set();
    const catalogIds = new Set();
    for (const record of records) {
        if (!record || typeof record !== "object" || typeof record.name !== "string" || typeof record.fileName !== "string") throw new TypeError(`${label} contains an invalid record.`);
        if (names.has(record.name)) throw new TypeError(`${label} contains duplicate name ${record.name}.`);
        if (files.has(record.fileName)) throw new TypeError(`${label} contains duplicate filename ${record.fileName}.`);
        names.add(record.name);
        files.add(record.fileName);
        if (record.catalogId !== undefined && record.catalogId !== null) {
            if (!Number.isSafeInteger(record.catalogId) || catalogIds.has(record.catalogId)) throw new TypeError(`${label} contains an invalid or duplicate catalog id.`);
            catalogIds.add(record.catalogId);
        }
    }
}

function securityReview(security, bucket, candidate) {
    const record = security?.[bucket]?.[candidate.name];
    return record && typeof record === "object" && !Array.isArray(record) ? record : undefined;
}

function securityBindingMatches(security, bucket, candidate) {
    const record = securityReview(security, bucket, candidate);
    return Boolean(record
        && Object.hasOwn(record, "catalogId")
        && record.catalogId === (candidate.catalogId ?? null)
        && record.immutableRevision === candidate.immutableRevision
        && record.sourceSha256 === candidate.sourceSha256);
}

function securityDisposition(security, bucket, candidate) {
    if (!securityBindingMatches(security, bucket, candidate)) return "HOLD";
    return securityReview(security, bucket, candidate)?.disposition || "HOLD";
}

function assertSecurityBindings(security, bucket, candidates, required) {
    const records = security?.[bucket];
    if (!records || typeof records !== "object" || Array.isArray(records)) throw new TypeError(`Security ${bucket} must be an object.`);
    const byName = new Map(candidates.map(candidate => [candidate.name, candidate]));
    const boundCatalogIds = new Set();
    for (const name of Object.keys(records)) {
        const candidate = byName.get(name);
        if (!candidate || !securityBindingMatches(security, bucket, candidate)) throw new TypeError(`Security disposition for ${name} is not bound to the exact reviewed source.`);
        if (candidate.catalogId !== undefined && candidate.catalogId !== null) {
            if (boundCatalogIds.has(candidate.catalogId)) throw new TypeError(`Security ${bucket} contains a duplicate catalog binding.`);
            boundCatalogIds.add(candidate.catalogId);
        }
    }
    for (const candidate of candidates.filter(required)) {
        if (!securityReview(security, bucket, candidate)) throw new TypeError(`Security disposition is missing for required candidate ${candidate.name}.`);
    }
}

function securityStageable(security, bucket, candidate) {
    const disposition = securityDisposition(security, bucket, candidate);
    return staticStageable(candidate) && (disposition === "SAFE_TO_RUNTIME_TEST" || disposition === "ACTION_GATED_TEST");
}

function runtimeAccepted(candidate, records, suite, dependencyHashes = {}) {
    const record = records?.[candidate.name];
    if (!record || record.status !== "PASSED" || record.cleanup !== "PASSED") return false;
    if (record.sourceSha256 !== candidate.sourceSha256 || record.immutableRevision !== candidate.immutableRevision) return false;
    if (!suite || !/^[0-9a-f]{40}$/.test(suite.solcordCommit || "") || !/^[0-9a-f]{64}$/.test(suite.artifactSha256 || "")) return false;
    if (typeof suite.discordVersion !== "string" || !suite.discordVersion.trim()) return false;
    if (record.solcordCommit !== suite.solcordCommit || record.artifactSha256 !== suite.artifactSha256 || record.discordVersion !== suite.discordVersion) return false;
    if (record.humanAcceptance !== "ACCEPT" && record.humanAcceptance !== "NOT_APPLICABLE") return false;
    return Object.entries(dependencyHashes).every(([name, digest]) => record.dependencyHashes?.[name] === digest);
}

function main() {
    const review = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
    const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    const acceptance = fs.existsSync(acceptancePath) ? JSON.parse(fs.readFileSync(acceptancePath, "utf8")) : {candidates: {}, dependencies: {}};
    const security = JSON.parse(fs.readFileSync(securityPath, "utf8"));
    assertSchema(review, REVIEW_SCHEMA_VERSION, "Reviewed addon manifest");
    assertSchema(catalog, CATALOG_SCHEMA_VERSION, "Catalog manifest");
    assertSchema(acceptance, ACCEPTANCE_SCHEMA_VERSION, "Runtime acceptance manifest");
    assertSchema(security, SECURITY_SCHEMA_VERSION, "Security disposition manifest");
    assertUniqueRecords(review.candidates, "Reviewed candidates");
    assertUniqueRecords(review.dependencies || [], "Reviewed dependencies");
    assertSecurityBindings(security, "candidates", review.candidates, candidate => candidate.requestedByPreset === true);
    assertSecurityBindings(security, "dependencies", review.dependencies || [], () => true);
    const reviewedDependencies = new Map((review.dependencies || []).map(candidate => [candidate.name, candidate]));
    const addons = review.candidates
        .filter(candidate => candidate.requestedByPreset)
        .map(candidate => {
            const requiredDependencies = (candidate.dependencies || []).map(name => reviewedDependencies.get(name)).filter(Boolean);
            const dependencyHashes = Object.fromEntries(requiredDependencies.map(dependency => [dependency.name, dependency.sourceSha256]));
            const dependenciesAccepted = requiredDependencies.length === (candidate.dependencies || []).length
                && requiredDependencies.every(dependency => securityStageable(security, "dependencies", dependency) && runtimeAccepted(dependency, acceptance.dependencies, acceptance.suite));
            const stageable = securityStageable(security, "candidates", candidate);
            const installable = stageable && dependenciesAccepted && runtimeAccepted(candidate, acceptance.candidates, acceptance.suite, dependencyHashes);
            const securityRecord = securityReview(security, "candidates", candidate);
            const disposition = securityDisposition(security, "candidates", candidate);
            return {
            name: candidate.name,
            fileName: candidate.fileName,
            version: candidate.version,
            sourceUrl: candidate.sourceUrl,
            sourceSha256: candidate.sourceSha256,
            sizeBytes: candidate.sizeBytes,
            dependencies: candidate.dependencies || [],
            conflicts: candidate.conflicts || [],
            stageable,
            installable,
            reviewStatus: installable ? "ACCEPTED" : disposition,
            securityDisposition: disposition,
            securityReasonCodes: securityRecord?.reasonCodes || ["UNREVIEWED"],
            provenance: candidate.license?.status === "FOUND" ? candidate.license.name : "official-catalog-unchanged-only"
        };
        });
    const dependencies = (review.dependencies || []).map(candidate => {
        const stageable = securityStageable(security, "dependencies", candidate);
        const installable = stageable && runtimeAccepted(candidate, acceptance.dependencies, acceptance.suite);
        const securityRecord = securityReview(security, "dependencies", candidate);
        const disposition = securityDisposition(security, "dependencies", candidate);
        return {
        name: candidate.name,
        fileName: candidate.fileName,
        sourceUrl: candidate.sourceUrl,
        sourceSha256: candidate.sourceSha256,
        sizeBytes: candidate.sizeBytes,
        stageable,
        installable,
        reviewStatus: installable ? "ACCEPTED" : disposition,
        securityDisposition: disposition,
        securityReasonCodes: securityRecord?.reasonCodes || ["UNREVIEWED"],
        provenance: candidate.license?.status === "FOUND" ? candidate.license.name : "unresolved"
    };
    });
    const optionalAddons = review.candidates
        .filter(candidate => !candidate.requestedByPreset)
        .map(candidate => {
            const requiredDependencies = (candidate.dependencies || []).map(name => reviewedDependencies.get(name)).filter(Boolean);
            const dependencyHashes = Object.fromEntries(requiredDependencies.map(dependency => [dependency.name, dependency.sourceSha256]));
            const dependenciesAccepted = requiredDependencies.length === (candidate.dependencies || []).length
                && requiredDependencies.every(dependency => securityStageable(security, "dependencies", dependency) && runtimeAccepted(dependency, acceptance.dependencies, acceptance.suite));
            const installable = securityStageable(security, "candidates", candidate) && dependenciesAccepted && runtimeAccepted(candidate, acceptance.candidates, acceptance.suite, dependencyHashes);
            return {
            name: candidate.name,
            fileName: candidate.fileName,
            version: candidate.version,
            sourceSha256: candidate.sourceSha256,
            reviewStatus: installable ? "ACCEPTED" : securityDisposition(security, "candidates", candidate),
            licenseStatus: candidate.license?.status || "UNRESOLVED",
            runtimeStatus: installable ? "PASSED" : candidate.verification?.runtime || "PENDING",
            installable
        };
        });
    const themeRecords = themes.map(([id, name, fileName]) => {
        const content = fs.readFileSync(path.join(themeRoot, fileName), "utf8");
        return {id, name, fileName, sourceSha256: sha256(content), content};
    });
    const reviewedByCatalogId = new Map(review.candidates.map(candidate => [candidate.catalogId, candidate]));
    const catalogIndex = catalog.candidates.map(candidate => {
        const reviewed = reviewedByCatalogId.get(candidate.catalogId);
        const resolvedSecurityDisposition = reviewed
            ? securityDisposition(security, "candidates", reviewed)
            : "HOLD";
        const networkBehavior = reviewed?.networkBehavior || [candidate.networkBehavior || "CODE_REVIEW_REQUIRED"];
        const accountActions = reviewed?.accountActions || [candidate.accountActions || "CODE_REVIEW_REQUIRED"];
        const sourceSha256 = reviewed?.sourceSha256 || candidate.sourceSha256 || null;
        const installable = candidate.type === "plugin"
            && addons.some(addon => addon.name === candidate.name && addon.installable === true);
        const supportedModes = candidate.name === "SplitLargeMessages"
            ? ["community-native", "solcord-guarded"]
            : ["community-file"];
        const risk = candidate.targetDisposition === "POWER_LAB"
            ? "account-risk"
            : networkBehavior.some(signal => signal !== "no-static-network-signal" && signal !== "CODE_REVIEW_REQUIRED")
                ? "external-service"
                : resolvedSecurityDisposition === "ACTION_GATED_TEST"
                    ? "experimental"
                    : "standard";
        return {
            catalogId: candidate.catalogId,
            type: candidate.type,
            name: candidate.name,
            fileName: candidate.fileName,
            version: candidate.version,
            description: candidate.description,
            author: candidate.author,
            tags: candidate.tags || [],
            disposition: candidate.disposition,
            targetDisposition: candidate.targetDisposition,
            securityDisposition: resolvedSecurityDisposition,
            requestedByPreset: candidate.requestedByPreset === true,
            sourceUrl: candidate.sourceUrl,
            immutableRevision: candidate.immutableRevision,
            sourceSha256,
            licenseStatus: reviewed?.license?.status || candidate.license?.status || "UNRESOLVED",
            dependencies: reviewed?.dependencies || candidate.dependencies || [],
            networkBehavior,
            accountActions,
            cleanupBehavior: reviewed?.cleanupBehavior || candidate.cleanupBehavior || "RUNTIME_REVIEW_REQUIRED",
            conflicts: reviewed?.conflicts || candidate.conflicts || [],
            supportedModes,
            risk,
            verification: {
                metadata: candidate.verification?.metadata || "HOLD",
                provenance: reviewed?.verification?.provenance || candidate.verification?.provenance || "PENDING",
                code: reviewed?.verification?.code || candidate.verification?.code || "PENDING",
                security: reviewed?.verification?.security || candidate.verification?.security || "PENDING",
                runtime: reviewed?.verification?.runtime || candidate.verification?.runtime || "PENDING"
            },
            codeStatus: reviewed?.verification?.code || candidate.verification?.code || "PENDING",
            runtimeStatus: reviewed?.verification?.runtime || candidate.verification?.runtime || "PENDING",
            installable
        };
    });
    const source = `/* eslint-disable */\n// SPDX-License-Identifier: Apache-2.0\n// Generated by scripts/build-solcord-runtime-catalog.cjs. Do not edit by hand.\n`
        + `export const SOLCORD_RUNTIME_ADDONS = ${JSON.stringify(addons, null, 4)} as const;\n\n`
        + `export const SOLCORD_RUNTIME_DEPENDENCIES = ${JSON.stringify(dependencies, null, 4)} as const;\n\n`
        + `export const SOLCORD_REVIEWED_OPTIONALS = ${JSON.stringify(optionalAddons, null, 4)} as const;\n\n`
        + `export const SOLCORD_RUNTIME_THEMES = ${JSON.stringify(themeRecords, null, 4)} as const;\n\n`
        + `export const SOLCORD_CATALOG_SNAPSHOT = ${JSON.stringify(catalog.snapshot, null, 4)} as const;\n\n`
        + `export const SOLCORD_CATALOG_INDEX = ${JSON.stringify(catalogIndex, null, 4)} as const;\n\n`
        + "export type AddonCandidate = typeof SOLCORD_CATALOG_INDEX[number];\n";
    fs.mkdirSync(path.dirname(outputPath), {recursive: true});
    fs.writeFileSync(outputPath, source);
    // Only trust decisions belong in the early renderer graph. Browsing
    // descriptions and bundled theme bodies remain local package assets.
    const details = JSON.stringify(catalogIndex);
    const trust = catalogIndex.map(candidate => ({
        name: candidate.name,
        fileName: candidate.fileName,
        sourceSha256: candidate.sourceSha256,
        networkBehavior: candidate.networkBehavior,
        dependencies: candidate.dependencies,
        verification: {security: candidate.verification.security}
    }));
    const themeIndex = themeRecords.map(({content, ...theme}) => ({...theme,
        declaredName: /^\s*\*\s*@name\s+(.+?)\s*$/m.exec(content)?.[1]?.trim() || theme.name,
        sizeBytes: Buffer.byteLength(content)
    }));
    const compactSource = `/* eslint-disable */\n// SPDX-License-Identifier: Apache-2.0\n// Generated by scripts/build-solcord-runtime-catalog.cjs. Do not edit by hand.\n`
        + `export const SOLCORD_RUNTIME_ADDONS = ${JSON.stringify(addons)} as const;\n`
        + `export const SOLCORD_RUNTIME_DEPENDENCIES = ${JSON.stringify(dependencies)} as const;\n`
        + `export const SOLCORD_RUNTIME_THEMES = ${JSON.stringify(themeIndex)} as const;\n`
        + `export const SOLCORD_CATALOG_SNAPSHOT = ${JSON.stringify(catalog.snapshot)} as const;\n`
        + `export const SOLCORD_CATALOG_INDEX = ${JSON.stringify(trust)} as const;\n`
        + `export const SOLCORD_CATALOG_DETAIL_SHA256 = ${JSON.stringify(sha256(details + "\n"))};\n`;
    fs.writeFileSync(path.join(path.dirname(outputPath), "addon-trust.generated.ts"), compactSource);
    fs.writeFileSync(path.join(root, "assets", "catalog", "solcord-browsing.generated.json"), details + "\n");
    process.stdout.write(`Generated ${addons.length} addon records, ${dependencies.length} dependencies, ${optionalAddons.length} optional reviews, ${themeRecords.length} embedded themes, and ${catalogIndex.length} catalog index records.\n`);
}

main();
