import {afterEach, describe, expect, test} from "bun:test";
import {createHash} from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import {SOLCORD_PRODUCT_IDENTITY} from "../../src/common/solcord/product-identity";
import {validateUploadedAssets} from "../../scripts/publish-solcord-release";

// Execute the production functions with a private environment and a completely
// mocked HTTP boundary. No real credential or GitHub request is used or needed.
const source = fs.readFileSync(new URL("../../scripts/publish-solcord-release.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("publisher.ts", source, ts.ScriptTarget.Latest, true);
const declarations = parsed.statements.filter(node => ts.isFunctionDeclaration(node)
    || ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(parsed) === "repository"));
const code = new Bun.Transpiler({loader: "ts"}).transformSync(`${declarations.map(node => node.getText(parsed).replace(/^export\s+/, "")).join("\n")}\nreturn publishRelease;`);
type Asset = {name: string; size: number; digest: string;};
type Release = {id: number; draft: boolean; prerelease: boolean; tag_name: string; target_commitish: string; name: string; body: string; upload_url: string; html_url: string; assets: Asset[];};
type GitObject = {type: string; sha: string;};
type Call = {method: string; endpoint: string; body?: Record<string, unknown>;};
const SOURCE = "a".repeat(40), OTHER = "b".repeat(40), LABEL = SOLCORD_PRODUCT_IDENTITY.candidateLabel;
const roots: string[] = [];
afterEach(() => {
    for (const directory of roots.splice(0)) {
        if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith("solcord-publish-api-")) throw new Error("Unexpected fixture cleanup path");
        fs.rmSync(directory, {recursive: true, force: true});
    }
});

function fixture() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "solcord-publish-api-")); roots.push(directory);
    const notes = "Windows stable; macOS is an unnotarized preview.\n";
    fs.writeFileSync(path.join(directory, "SolcordInstaller.exe"), "controlled executable bytes");
    const artifact = fs.readFileSync(path.join(directory, "SolcordInstaller.exe"));
    fs.writeFileSync(path.join(directory, "release-package.json"), JSON.stringify({sourceCommit: SOURCE, candidateLabel: LABEL, files: [{name: "SolcordInstaller.exe", bytes: artifact.length, sha256: createHash("sha256").update(artifact).digest("hex")}]}));
    const checksum = fs.readdirSync(directory).sort().map(name => `${createHash("sha256").update(fs.readFileSync(path.join(directory, name))).digest("hex")}  ${name}`).join("\n") + "\n";
    fs.writeFileSync(path.join(directory, "RELEASE-SHA256SUMS.txt"), checksum); fs.writeFileSync(path.join(directory, "release-notes.md"), notes);
    const assets = fs.readdirSync(directory).sort().filter(name => name !== "release-notes.md").map(name => ({name, size: fs.statSync(path.join(directory, name)).size, digest: `sha256:${createHash("sha256").update(fs.readFileSync(path.join(directory, name))).digest("hex")}`}));
    const releases: Release[] = [], calls: Call[] = [];
    const state: {tag: GitObject | null; annotated: Map<string, GitObject>; pages?: Release[][]; uploadFailAt: number; uploadCalls: number; corruptUpload: boolean; onReadRelease?: (release: Release) => void; onPublish?: (release: Release) => void;} = {
        tag: null, annotated: new Map(), uploadFailAt: 0, uploadCalls: 0, corruptUpload: false
    };
    const makeRelease = (overrides: Partial<Release> = {}): Release => ({id: 17, draft: true, prerelease: LABEL.includes("-"), tag_name: LABEL, target_commitish: SOURCE, name: `Solcord ${LABEL.slice(1)}`, body: notes, upload_url: "https://uploads.github.com/repos/celubos/Solcord/releases/17/assets{?name,label}", html_url: `https://github.com/celubos/Solcord/releases/tag/${LABEL}`, assets: [], ...overrides});
    const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status, headers: {"Content-Type": "application/json"}});
    const fetch = async (input: string | URL, init: RequestInit = {}) => {
        const url = new URL(input), method = init.method ?? "GET";
        if (!["https://api.github.com", "https://uploads.github.com"].includes(url.origin)) throw new Error("No external network is allowed in this test");
        const endpoint = url.pathname.replace(/^\/repos\/celubos\/Solcord\//, "") + url.search;
        const body = typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
        calls.push({method, endpoint, ...(body ? {body} : {})});
        if (url.origin === "https://uploads.github.com") {
            state.uploadCalls++;
            if (state.uploadFailAt === state.uploadCalls) {state.uploadFailAt = 0; return respond({error: "controlled upload interruption"}, 503);}
            const expected = assets.find(asset => asset.name === url.searchParams.get("name")); if (!expected) throw new Error("Unexpected upload");
            const asset = {...expected, ...(state.corruptUpload ? {digest: `sha256:${"c".repeat(64)}`} : {})}; releases[0].assets.push(asset); return respond(asset, 201);
        }
        if (method === "GET" && endpoint.startsWith("releases?")) {
            const page = Number(url.searchParams.get("page")); return respond(state.pages ? state.pages[page - 1] ?? [] : releases.slice((page - 1) * 100, page * 100));
        }
        if (method === "GET" && endpoint.startsWith("git/ref/tags/")) return state.tag ? respond({object: state.tag}) : respond({}, 404);
        if (method === "GET" && endpoint.startsWith("git/tags/")) return respond({object: state.annotated.get(endpoint.slice("git/tags/".length))});
        if (method === "POST" && endpoint === "git/refs") {state.tag = {type: "commit", sha: String(body?.sha)}; return respond({object: state.tag}, 201);}
        if (method === "POST" && endpoint === "releases") {const release = makeRelease(body as Partial<Release>); releases.push(release); return respond(release, 201);}
        if (method === "GET" && /^releases\/\d+$/.test(endpoint)) {
            const release = releases.find(item => item.id === Number(endpoint.split("/")[1])); if (!release) throw new Error("Unknown release readback");
            state.onReadRelease?.(release); return respond(release);
        }
        if (method === "PATCH" && /^releases\/\d+$/.test(endpoint)) {
            const release = releases.find(item => item.id === Number(endpoint.split("/")[1]))!;
            if (body?.draft === false) release.draft = false;
            state.onPublish?.(release); return respond(release);
        }
        throw new Error(`Unexpected mocked API call: ${method} ${endpoint}`);
    };
    const publish = vm.compileFunction(code, ["createHash", "lstatSync", "readFileSync", "readdirSync", "path", "SOLCORD_PRODUCT_IDENTITY", "process", "fetch", "Bun"])(
        createHash, fs.lstatSync, fs.readFileSync, fs.readdirSync, path, SOLCORD_PRODUCT_IDENTITY,
        {env: {GITHUB_REPOSITORY: "celubos/Solcord", GITHUB_SHA: SOURCE, GITHUB_REF: "refs/heads/main", GH_TOKEN: "controlled-test-only-token"}}, fetch, {file: (file: string) => ({controlledUploadFile: path.basename(file)})}
    ) as (directory: string, sourceCommit: string) => Promise<string>;
    return {directory, notes, assets, releases, calls, state, makeRelease, publish: () => publish(directory, SOURCE), mutations: () => calls.filter(call => call.method !== "GET")};
}

describe("reviewed release publication API", () => {
    test("duplicate expected filenames cannot conceal an unexpected asset of the same inventory size", () => {
        const file = {name: "reviewed.zip", bytes: 42, sha256: "a".repeat(64)};
        const uploaded = {name: file.name, size: file.bytes, digest: `sha256:${file.sha256}`};
        expect(() => validateUploadedAssets([file, {...file}], [uploaded, {...uploaded, name: "unexpected.zip"}])).toThrow("inventory contains duplicate");
        expect(() => validateUploadedAssets([file, {...file, name: "other.zip"}], [uploaded, {...uploaded}])).toThrow("inventory contains duplicate");
        expect(() => validateUploadedAssets([file, {...file, name: "other.zip"}], [{...uploaded, name: "other.zip"}, uploaded])).not.toThrow();
    });

    test("a malformed local manifest with repeated names is rejected before any GitHub request", async () => {
        const h = fixture();
        const manifestPath = path.join(h.directory, "release-package.json");
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        manifest.files.push({...manifest.files[0]});
        fs.writeFileSync(manifestPath, JSON.stringify(manifest));
        fs.writeFileSync(path.join(h.directory, "unexpected.zip"), "unreviewed bytes");
        const checksum = fs.readdirSync(h.directory).sort().filter(name => !["RELEASE-SHA256SUMS.txt", "release-notes.md"].includes(name))
            .map(name => `${createHash("sha256").update(fs.readFileSync(path.join(h.directory, name))).digest("hex")}  ${name}`).join("\n") + "\n";
        fs.writeFileSync(path.join(h.directory, "RELEASE-SHA256SUMS.txt"), checksum);
        await expect(h.publish()).rejects.toThrow("inventory contains duplicate");
        expect(h.calls).toEqual([]);
        expect(h.releases).toEqual([]);
    });

    test("verifies every draft asset before creating the exact lightweight tag and publishing", async () => {
        const h = fixture(); expect(await h.publish()).toContain(`/releases/tag/${LABEL}`);
        const tagIndex = h.calls.findIndex(call => call.method === "POST" && call.endpoint === "git/refs");
        const publishIndex = h.calls.findIndex(call => call.method === "PATCH");
        const lastUpload = h.calls.findLastIndex(call => call.method === "POST" && call.endpoint.includes("/assets?"));
        expect(tagIndex).toBeGreaterThan(lastUpload); expect(publishIndex).toBeGreaterThan(tagIndex);
        expect(h.calls[tagIndex].body).toEqual({ref: `refs/tags/${LABEL}`, sha: SOURCE});
        expect(h.calls.slice(tagIndex + 1, publishIndex).some(call => call.endpoint.startsWith("git/ref/tags/"))).toBeTrue();
        expect(h.releases[0].draft).toBeFalse(); expect(h.releases[0].assets).toEqual(h.assets);
    });

    test("finds a draft on a later authenticated inventory page and resumes only missing assets", async () => {
        const h = fixture(); const draft = h.makeRelease({assets: [h.assets[0]]}); h.releases.push(draft);
        h.state.pages = [Array.from({length: 100}, (_, index) => h.makeRelease({id: index + 100, tag_name: `v0.0.${index}`, draft: false})), [draft]];
        await h.publish();
        expect(h.calls.some(call => call.endpoint === "releases?per_page=100&page=2")).toBeTrue();
        expect(h.calls.some(call => call.endpoint.startsWith("releases/tags/"))).toBeFalse();
        expect(h.calls.filter(call => call.method === "POST" && call.endpoint === "releases")).toHaveLength(0);
        expect(h.state.uploadCalls).toBe(h.assets.length - 1);
    });

    test("duplicate version drafts across pages are rejected without changing GitHub", async () => {
        const h = fixture(); const draft = h.makeRelease(); h.releases.push(draft);
        h.state.pages = [[draft, ...Array.from({length: 99}, (_, index) => h.makeRelease({id: index + 100, tag_name: `v0.0.${index}`}))], [h.makeRelease({id: 18})]];
        await expect(h.publish()).rejects.toThrow("Multiple releases"); expect(h.mutations()).toEqual([]);
    });

    test("a retained partial draft is discoverable after an interrupted upload and never recreated", async () => {
        const h = fixture(); h.state.uploadFailAt = 2;
        await expect(h.publish()).rejects.toThrow("draft is retained");
        expect(h.releases).toHaveLength(1); expect(h.releases[0].draft).toBeTrue(); expect(h.state.tag).toBeNull();
        expect(h.releases[0].assets).toHaveLength(1);
        await h.publish();
        expect(h.calls.filter(call => call.method === "POST" && call.endpoint === "releases")).toHaveLength(1);
        expect(h.releases[0].draft).toBeFalse(); expect(h.releases[0].assets).toHaveLength(h.assets.length);
    });

    test("a mismatched existing tag is refused before uploads or public transition", async () => {
        const h = fixture(); h.releases.push(h.makeRelease()); h.state.tag = {type: "commit", sha: OTHER};
        await expect(h.publish()).rejects.toThrow("another commit"); expect(h.mutations()).toEqual([]);
    });

    test("a tag moved after asset verification is detected before the draft becomes public", async () => {
        const h = fixture(); h.releases.push(h.makeRelease());
        h.state.onReadRelease = () => {h.state.tag = {type: "commit", sha: OTHER};};
        await expect(h.publish()).rejects.toThrow("publication stopped");
        expect(h.calls.some(call => call.method === "PATCH")).toBeFalse(); expect(h.releases[0].draft).toBeTrue();
        expect(h.calls.some(call => call.endpoint === "git/refs" && call.method === "POST")).toBeFalse();
    });

    test("draft source, notes, name and prerelease mismatches never get silently rewritten", async () => {
        for (const changed of [{target_commitish: OTHER}, {body: "Incorrect production claim for macOS"}, {name: "Wrong package"}, {prerelease: !LABEL.includes("-")}]) {
            const h = fixture(); h.releases.push(h.makeRelease(changed));
            await expect(h.publish()).rejects.toThrow("will not be overwritten"); expect(h.mutations()).toEqual([]);
        }
    });

    test("readback metadata drift leaves the draft unpublished even after uploads succeed", async () => {
        const h = fixture(); h.state.onReadRelease = release => {release.body = "Changed after upload";};
        await expect(h.publish()).rejects.toThrow("will not be overwritten");
        expect(h.releases[0].draft).toBeTrue(); expect(h.calls.some(call => call.method === "PATCH")).toBeFalse();
        expect(h.state.tag).toBeNull();
    });

    test("an existing exact public release is verified without a mutation", async () => {
        const h = fixture(); h.releases.push(h.makeRelease({draft: false, assets: h.assets})); h.state.tag = {type: "commit", sha: SOURCE};
        await h.publish(); expect(h.mutations()).toEqual([]);
    });

    test("annotated tags are resolved to their exact commit without replacing them", async () => {
        const h = fixture(); h.releases.push(h.makeRelease({draft: false, assets: h.assets})); h.state.tag = {type: "tag", sha: OTHER}; h.state.annotated.set(OTHER, {type: "commit", sha: SOURCE});
        await h.publish(); expect(h.mutations()).toEqual([]);
        expect(h.state.tag).toEqual({type: "tag", sha: OTHER}); expect(h.calls.some(call => call.endpoint === `git/tags/${OTHER}`)).toBeTrue();
    });

    test("an exact pre-existing tag can be used without rewriting its reference", async () => {
        const h = fixture(); h.state.tag = {type: "commit", sha: SOURCE}; await h.publish();
        expect(h.calls.some(call => call.method === "POST" && call.endpoint === "git/refs")).toBeFalse();
        expect(h.releases[0].draft).toBeFalse();
    });

    test("server-side asset digest mismatch retains the draft and creates no tag", async () => {
        const h = fixture(); h.state.corruptUpload = true;
        await expect(h.publish()).rejects.toThrow("verification failed");
        expect(h.releases[0].draft).toBeTrue(); expect(h.state.tag).toBeNull();
        expect(h.calls.some(call => call.method === "PATCH")).toBeFalse();
    });

    test("published asset drift fails validation without editing the public release", async () => {
        const h = fixture(); h.releases.push(h.makeRelease({draft: false, assets: h.assets.map(asset => ({...asset, digest: `sha256:${"c".repeat(64)}`}))})); h.state.tag = {type: "commit", sha: SOURCE};
        await expect(h.publish()).rejects.toThrow("verification failed"); expect(h.mutations()).toEqual([]);
    });

    test("release notes require a regular singly-owned file before any API call", async () => {
        const h = fixture(); fs.linkSync(path.join(h.directory, "release-notes.md"), path.join(h.directory, "extra-notes-link"));
        await expect(h.publish()).rejects.toThrow("Unsafe reviewed release notes"); expect(h.calls).toEqual([]);
    });
});
