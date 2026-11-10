// Reproduce selected baseline observations with synthetic transport and temporary files.
// Run from the repository root with "bun docs/audit/2026-11-07/probes.cjs".
const {readFileSync, writeFileSync, mkdtempSync, rmSync} = require("node:fs");
const {tmpdir} = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const {EventEmitter} = require("node:events");
const ts = require("typescript");

function load(relativePath, mocks = {}) {
    const source = readFileSync(relativePath, "utf8");
    const code = ts.transpileModule(source, {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}
    }).outputText;
    const exports = {};
    vm.runInNewContext(code, {
        exports, require: id => mocks[id] ?? require(id),
        URL, Buffer, console: {log() {}}, ReadableStream, Response, Uint8Array
    });
    return exports;
}

async function main() {
    const requests = [];
    const https = {request(url, options, receive) {
        const first = requests.length === 0;
        requests.push({url, authorization: options.headers?.Authorization});
        const request = Object.assign(new EventEmitter(), {end() {}, write() {}});
        queueMicrotask(() => {
            const response = Object.assign(new EventEmitter(), {
                statusCode: first ? 302 : 200,
                headers: first ? {location: "https://second.example/asset"} : {}
            });
            receive(response);
            if (!first) response.emit("end");
        });
        return request;
    }};
    const transport = load("src/electron/preload/api/https.ts", {https, "./webhook": {isWebhookUrl: () => false}});
    await new Promise(resolve => transport.default.request("https://first.example/start?q=fixture", {
        headers: {Authorization: "fixture-only"}
    }, resolve));
    const {hydrateReadableStream} = load("src/common/native-fetch.ts");
    let reads = 0;
    const unread = hydrateReadableStream({
        read: async () => ++reads <= 128 ? {done: false, value: new Uint8Array(65536)} : {done: true},
        cancel: async () => {}
    });
    await new Promise(resolve => setTimeout(resolve, 25));
    const readsBeforeFirstConsumer = reads;
    await unread.cancel();
    let cancellations = 0;
    const pending = hydrateReadableStream({
        read: () => new Promise(() => {}),
        cancel: async () => {cancellations++;}
    });
    await pending.cancel();
    const dir = mkdtempSync(path.join(tmpdir(), "solcord-audit-metadata-"));
    try {
        const file = path.join(dir, "package.json");
        writeFileSync(file, JSON.stringify({name: "solcord", main: "main.js", type: "module"}));
        load("scripts/helpers/package.ts").default(dir);
        console.log(JSON.stringify({requests, readsBeforeFirstConsumer, cancellations,
            retainedType: JSON.parse(readFileSync(file, "utf8")).type ?? null}, null, 2));
    }
    finally {rmSync(dir, {recursive: true, force: true});}
}

main().catch(error => {console.error(error); process.exitCode = 1;});
