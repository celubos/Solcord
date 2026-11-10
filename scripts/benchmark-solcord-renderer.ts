import {execFileSync, spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {cpus, platform, totalmem} from "node:os";
import {dirname, isAbsolute, join, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import type {SolcordRendererBenchmarkReport} from "./fixtures/solcord-renderer-benchmark";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = process.argv[2];
if (!output || !isAbsolute(output)) throw new Error("Provide an absolute output directory on the task evidence volume.");
mkdirSync(output, {recursive: true});
const baselineCommit = "9b3004ff8c25c9879803a6c07fa8b28d04731438";
const baselineDirectory = join(output, "v2.0.0-source");
mkdirSync(baselineDirectory, {recursive: true});
for (const file of ["baseline-suite.ts", "disposal.ts"]) {
    writeFileSync(join(baselineDirectory, file), execFileSync("git", ["show", `${baselineCommit}:src/betterdiscord/modules/solcord/${file}`], {cwd: root, windowsHide: true}));
}
const entry = join(output, "benchmark-entry.ts");
writeFileSync(entry, `import {resolveSolcordEmbedTargets} from ${JSON.stringify(join(baselineDirectory, "baseline-suite.ts"))};\nimport {runSolcordRendererBenchmark} from ${JSON.stringify(join(root, "scripts/fixtures/solcord-renderer-benchmark.ts"))};\nvoid runSolcordRendererBenchmark(resolveSolcordEmbedTargets);\n`);
const build = await Bun.build({entrypoints: [entry], outdir: output, naming: "benchmark.js", target: "browser", format: "iife", minify: false});
if (!build.success) throw new AggregateError(build.logs, "Benchmark bundle failed");
const html = join(output, "benchmark.html");
writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><title>Solcord local renderer benchmark</title></head><body><script src="./benchmark.js"></script></body></html>`);
const browser = process.env.SOLCORD_UI_BROWSER || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync);
if (!browser) throw new Error("No supported Chromium executable; set SOLCORD_UI_BROWSER.");
const profile = join(output, "browser-profile");
mkdirSync(profile, {recursive: true});
const child = spawn(browser, ["--headless=new", "--disable-gpu", "--disable-background-networking", "--disable-component-update", "--disable-default-apps", "--disable-extensions", "--disable-sync", "--metrics-recording-only", "--no-default-browser-check", "--no-first-run", "--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=<-loopback>", `--user-data-dir=${profile}`, "--remote-debugging-port=0", pathToFileURL(html).href], {cwd: root, windowsHide: true, stdio: "ignore"});
const delay = (milliseconds: number) => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
let dom = "";
let socket: WebSocket | undefined;
try {
    let port: number | undefined;
    for (let attempt = 0; attempt < 200 && child.exitCode === null; attempt++) {
        try {port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]);}
        catch {/* The owned headless profile has not published its port yet. */}
        if (port) break;
        await delay(50);
    }
    if (!port) throw new Error("The owned headless browser did not publish its local debugger port.");
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as Array<{url: string; webSocketDebuggerUrl?: string;}>;
    const target = targets.find(candidate => candidate.url === pathToFileURL(html).href);
    if (!target?.webSocketDebuggerUrl?.startsWith(`ws://127.0.0.1:${port}/`)) throw new Error("The exact isolated benchmark page was not found.");
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolveOpen, reject) => {socket!.addEventListener("open", () => resolveOpen(), {once: true}); socket!.addEventListener("error", () => reject(new Error("Local benchmark debugger connection failed")), {once: true});});
    let requestId = 0;
    const pending = new Map<number, {resolve(value: any): void; reject(error: Error): void;}>();
    socket.addEventListener("message", event => {
        const response = JSON.parse(String(event.data));
        const task = pending.get(response.id);
        if (!task) return;
        pending.delete(response.id);
        if (response.error) task.reject(new Error(response.error.message));
        else task.resolve(response.result);
    });
    const request = (method: string, params: object = {}) => new Promise<any>((resolveRequest, reject) => {
        const id = ++requestId;
        const timer = setTimeout(() => {pending.delete(id); reject(new Error(`Local benchmark ${method} timed out`));}, 70_000);
        pending.set(id, {resolve: value => {clearTimeout(timer); resolveRequest(value);}, reject: error => {clearTimeout(timer); reject(error);}});
        socket!.send(JSON.stringify({id, method, params}));
    });
    for (let attempt = 0; attempt < 200; attempt++) {
        const ready = await request("Runtime.evaluate", {expression: `Boolean(document.documentElement && document.title === 'Solcord local renderer benchmark')`, returnByValue: true});
        if (ready.result?.value) break;
        if (attempt === 199) throw new Error("The exact local benchmark document did not initialize.");
        await delay(50);
    }
    const result = await request("Runtime.evaluate", {expression: `new Promise((resolve, reject) => {const deadline = Date.now() + 60000; const inspect = () => {if (document.documentElement.hasAttribute('data-solcord-perf-result') || document.documentElement.hasAttribute('data-solcord-perf-error')) return resolve(document.documentElement.outerHTML); if (Date.now() > deadline) return reject(Error('Fixture result deadline exceeded')); setTimeout(inspect, 25);}; inspect();})`, awaitPromise: true, returnByValue: true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    dom = result.result.value;
}
finally {
    socket?.close();
    // Only the fresh child above belongs to this benchmark. Preserve its D:
    // profile and evidence; never terminate existing user browser processes.
    if (child.exitCode === null) child.kill();
}
writeFileSync(join(output, "result.html"), dom);
const encoded = dom.match(/data-solcord-perf-result="([A-Za-z0-9+/=]+)"/)?.[1];
if (!encoded) {
    const error = dom.match(/data-solcord-perf-error="([A-Za-z0-9+/=]+)"/)?.[1];
    throw new Error(error ? Buffer.from(error, "base64").toString("utf8") : "Browser benchmark did not publish a result; inspect preserved fixture and profile.");
}
const result = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as SolcordRendererBenchmarkReport;
const sourceFiles = ["src/betterdiscord/modules/solcord/baseline-suite.ts", "src/betterdiscord/modules/solcord/disposal.ts", "scripts/fixtures/solcord-renderer-benchmark.ts"];
const report = {generatedAt: new Date().toISOString(), sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {cwd: root, encoding: "utf8", windowsHide: true}).trim(), baselineCommit, sourceFiles: sourceFiles.map(path => ({path, sha256: createHash("sha256").update(readFileSync(join(root, path))).digest("hex")})), context: {runtime: Bun.version, platform: platform(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, systemMemoryBytes: totalmem(), browser, concurrentWork: "30-minute synthetic backend soak also running; absolute timings reflect this workstation context."}, ...result};
writeFileSync(join(output, "renderer-benchmark.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`${report.pass ? "PASS" : "FAIL"}: ${report.records.length} renderer benchmark cases; ${join(output, "renderer-benchmark.json")}`);
if (!report.pass) process.exitCode = 1;
