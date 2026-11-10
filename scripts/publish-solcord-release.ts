// SPDX-License-Identifier: Apache-2.0

import {createHash} from "node:crypto";
import {lstatSync, readFileSync, readdirSync} from "node:fs";
import path from "node:path";
import {SOLCORD_PRODUCT_IDENTITY} from "../src/common/solcord/product-identity";

const repository = "celubos/Solcord";
type Asset = {name: string; size: number; digest: string | null;};
type Release = {id: number; draft: boolean; prerelease: boolean; tag_name: string; target_commitish: string; name: string; body: string | null; upload_url: string; html_url: string; assets: Asset[];};
type Manifest = {sourceCommit: string; candidateLabel: string; files: Array<{name: string; bytes: number; sha256: string;}>;};

export function validateUploadedAssets(expected: Manifest["files"], actual: Asset[]): void {
    if (actual.length !== expected.length) throw new Error("Release asset inventory differs from the reviewed package.");
    if (new Set(expected.map(file => file.name)).size !== expected.length || new Set(actual.map(asset => asset.name)).size !== actual.length) throw new Error("Release asset inventory contains duplicate filenames.");
    for (const file of expected) {
        const matches = actual.filter(asset => asset.name === file.name);
        if (matches.length !== 1 || matches[0].size !== file.bytes || matches[0].digest !== `sha256:${file.sha256}`) throw new Error(`Release asset verification failed: ${file.name}`);
    }
}

export async function publishRelease(directory: string, sourceCommit: string): Promise<string> {
    if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error("An exact source commit is required.");
    if (process.env.GITHUB_REPOSITORY !== repository || process.env.GITHUB_SHA !== sourceCommit || process.env.GITHUB_REF !== "refs/heads/main") throw new Error("Publication requires the exact main-branch GitHub Actions job.");
    const token = process.env.GH_TOKEN;
    if (!token) throw new Error("The GitHub Actions publishing credential is missing.");
    const root = path.resolve(directory);
    const notesFile = path.join(root, "release-notes.md"), notesStat = lstatSync(notesFile);
    if (!notesStat.isFile() || notesStat.isSymbolicLink() || notesStat.nlink !== 1 || notesStat.size <= 0 || notesStat.size > 1024 * 1024) throw new Error("Unsafe reviewed release notes.");
    const notes = readFileSync(notesFile, "utf8");
    const manifest = JSON.parse(readFileSync(path.join(root, "release-package.json"), "utf8")) as Manifest;
    const label = SOLCORD_PRODUCT_IDENTITY.candidateLabel;
    if (manifest.sourceCommit !== sourceCommit || manifest.candidateLabel !== label) throw new Error("Release package source or version mismatch.");
    const names = readdirSync(root).sort();
    const files = names.filter(name => name !== "release-notes.md").map(name => {
        if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error("Unsafe release asset filename.");
        const filename = path.join(root, name);
        const stat = lstatSync(filename);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 512 * 1024 * 1024) throw new Error(`Unsafe release asset: ${name}`);
        return {name, bytes: stat.size, sha256: createHash("sha256").update(readFileSync(filename)).digest("hex")};
    });
    const reviewed = files.filter(file => !["release-package.json", "RELEASE-SHA256SUMS.txt"].includes(file.name));
    validateUploadedAssets(manifest.files, reviewed.map(file => ({name: file.name, size: file.bytes, digest: `sha256:${file.sha256}`})));
    const checksums = files.filter(file => file.name !== "RELEASE-SHA256SUMS.txt").map(file => `${file.sha256}  ${file.name}`).join("\n") + "\n";
    if (readFileSync(path.join(root, "RELEASE-SHA256SUMS.txt"), "utf8") !== checksums) throw new Error("Release checksums do not match the reviewed package.");
    const headers = {"Authorization": `Bearer ${token}`, "Accept": "application/vnd.github+json", "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28"};
    const api = async (endpoint: string, method = "GET", body?: unknown, allowMissing = false) => {
        const response = await fetch(`https://api.github.com/repos/${repository}/${endpoint}`, {method, headers, redirect: "error", ...(body === undefined ? {} : {body: JSON.stringify(body)})});
        if (allowMissing && response.status === 404) return null;
        if (!response.ok) throw new Error(`GitHub ${method} ${endpoint} failed (${response.status}); release remains unpublished if still a draft.`);
        return response.json();
    };
    const assertMetadata = (release: Release) => {
        if (!Number.isSafeInteger(release.id) || release.id <= 0 || release.tag_name !== label || release.target_commitish !== sourceCommit
            || release.prerelease !== label.includes("-") || release.name !== `Solcord ${label.slice(1)}` || release.body !== notes || typeof release.draft !== "boolean") {
            throw new Error("Existing release source, notes or prerelease status differs from the reviewed package; it will not be overwritten.");
        }
    };
    // The tag endpoint returns published releases. Authenticated list pages also
    // include drafts, which must be found before retrying interrupted uploads.
    const matches: Release[] = [];
    for (let page = 1; ; page++) {
        if (page > 100) throw new Error("Release inventory exceeds its review bound.");
        const entries = await api(`releases?per_page=100&page=${page}`) as Release[];
        if (!Array.isArray(entries) || entries.length > 100) throw new Error("Invalid GitHub release inventory.");
        matches.push(...entries.filter(entry => entry.tag_name === label));
        if (matches.length > 1) throw new Error("Multiple releases or drafts use this version; inspect them before publishing.");
        if (entries.length < 100) break;
    }
    const resolveTag = async (): Promise<string | null> => {
        const reference = await api(`git/ref/tags/${encodeURIComponent(label)}`, "GET", undefined, true) as {object: {type: string; sha: string;};} | null;
        if (!reference) return null;
        let object = reference.object;
        for (let depth = 0; depth < 8; depth++) {
            if (!object || !/^[a-f0-9]{40}$/.test(object.sha)) throw new Error("Invalid version tag target.");
            if (object.type === "commit") return object.sha;
            if (object.type !== "tag") throw new Error("The version tag does not resolve to a commit.");
            object = (await api(`git/tags/${object.sha}`) as {object: {type: string; sha: string;};}).object;
        }
        throw new Error("Annotated version tag exceeds its resolution bound.");
    };
    const requireTag = async () => {if (await resolveTag() !== sourceCommit) throw new Error("The version tag does not match the verified source commit; publication stopped.");};
    let release = matches[0] ?? null;
    if (release) assertMetadata(release);
    const existingTag = await resolveTag();
    if (existingTag !== null && existingTag !== sourceCommit) throw new Error("An existing version tag points to another commit; it will not be overwritten.");
    if (!release) {
        release = await api("releases", "POST", {tag_name: label, target_commitish: sourceCommit, name: `Solcord ${label.slice(1)}`, body: notes, draft: true, prerelease: label.includes("-"), make_latest: "false"}) as Release;
        assertMetadata(release);
    }
    if (release.draft) {
        const upload = new URL(release.upload_url.split("{")[0]);
        if (upload.protocol !== "https:" || upload.hostname !== "uploads.github.com" || upload.port || upload.username || upload.password) throw new Error("Unexpected GitHub upload destination.");
        if (release.assets.some(asset => !files.some(file => file.name === asset.name))) throw new Error("The draft contains an unexpected asset.");
        for (const file of files) {
            const existing = release.assets.filter(asset => asset.name === file.name);
            if (existing.length) {validateUploadedAssets([file], existing); continue;}
            upload.searchParams.set("name", file.name);
            const response = await fetch(upload, {method: "POST", headers: {...headers, "Content-Type": "application/octet-stream"}, body: Bun.file(path.join(root, file.name)), redirect: "error"});
            if (!response.ok) throw new Error(`Uploading ${file.name} failed (${response.status}); the draft is retained for a verified retry.`);
            validateUploadedAssets([file], [await response.json() as Asset]);
        }
        release = await api(`releases/${release.id}`) as Release;
        assertMetadata(release);
        validateUploadedAssets(files, release.assets);
        // Create an absent lightweight tag only after every draft asset is
        // verified, then resolve it before any public/latest transition.
        const tagBeforePublication = await resolveTag();
        if (tagBeforePublication === null) await api("git/refs", "POST", {ref: `refs/tags/${label}`, sha: sourceCommit});
        await requireTag();
        release = await api(`releases/${release.id}`) as Release;
        assertMetadata(release);
        validateUploadedAssets(files, release.assets);
        if (release.draft) {
            await api(`releases/${release.id}`, "PATCH", {draft: false, make_latest: label.includes("-") ? "false" : "true"});
            release = await api(`releases/${release.id}`) as Release;
        }
    }
    assertMetadata(release);
    validateUploadedAssets(files, release.assets);
    await requireTag();
    if (release.draft) throw new Error("GitHub retained the release as a draft; publication did not complete.");
    return release.html_url;
}

if (import.meta.main) {
    const [directory, sourceCommit] = process.argv.slice(2);
    if (!directory || !sourceCommit) throw new Error("Usage: publish-solcord-release.ts <assembled-directory> <source-commit>");
    console.log(await publishRelease(directory, sourceCommit));
}
