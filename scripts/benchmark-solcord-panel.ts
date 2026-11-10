import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, isAbsolute, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = process.argv[2];
if (!output || !isAbsolute(output)) throw new Error("Provide an absolute output directory on the task evidence volume.");
const cycles = Number(process.argv[3] ?? 60);
if (!Number.isInteger(cycles) || cycles < 1 || cycles > 600) throw new Error("Panel cycles must be an integer from 1 through 600.");
mkdirSync(output, {recursive: true});
const fixturePath = join(project, "tests/solcord/panel-react.test.tsx");
const fixture = readFileSync(fixturePath, "utf8");
const marker = "describe(\"production Solcord Control Center React tree with controlled host interfaces\"";
const boundary = fixture.indexOf(marker);
if (boundary < 0) throw new Error("The qualified production-panel fixture boundary changed; review before adapting.");
const prefix = fixture.slice(0, boundary)
    .replace(/"(\.\.\/\.\.\/[^"]+)"/g, (_match, path) => JSON.stringify(resolve(dirname(fixturePath), path)))
    .replaceAll("\"react\"", JSON.stringify(join(project, "node_modules/react/index.js")))
    .replaceAll("\"react-dom/client\"", JSON.stringify(join(project, "node_modules/react-dom/client.js")));
const reportPath = join(output, "panel-benchmark.json");
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {cwd: project, encoding: "utf8", windowsHide: true}).trim();
const sourcePaths = ["src/betterdiscord/ui/solcord/panel.tsx", "src/betterdiscord/ui/solcord/privacy.tsx", "tests/solcord/panel-react.test.tsx"];
const sourceFiles = sourcePaths.map(path => ({path, sha256: createHash("sha256").update(readFileSync(join(project, path))).digest("hex")}));
const generated = `import {PropertySymbol} from ${JSON.stringify(join(project, "node_modules/happy-dom/lib/index.js"))};
${prefix}
test("repeated production panel navigation performance and teardown", async () => {
    const durations = new Map<string, number[]>();
    const memory: Array<{cycle: number; rssBytes: number; heapUsedBytes: number;}> = [];
    let maximumSubscriptions = 0;
    let fixtureQueryCacheResets = 0;
    let maximumFixtureQueryDependencies = 0;
    const record = (name: string, elapsed: number) => {const values = durations.get(name) ?? []; values.push(elapsed); durations.set(name, values);};
    const sampleMemory = (cycle: number) => {Bun.gc(true); const usage = process.memoryUsage(); memory.push({cycle, rssBytes: usage.rss, heapUsedBytes: usage.heapUsed});};
    sampleMemory(0);
    const labels = ["Appearance & Accessibility", "Performance", "Privacy & Safety", "Chat & Composer", "Voice & Activities", "Friends & Spaces", "Extensions", "Recovery", "Overview"];
    for (let cycle = 1; cycle <= ${cycles}; cycle++) {
        let started = performance.now();
        const host = await mount(); await flushFrames();
        record("mount", performance.now() - started);
        for (const label of labels) {
            started = performance.now(); await navigate(host, label); await flushFrames();
            record(label, performance.now() - started);
            expect(host.querySelector(".solcord-workspace-heading h2")?.textContent).toBe(label);
            maximumSubscriptions = Math.max(maximumSubscriptions, [...subscriptions.values()].reduce((sum, listeners) => sum + listeners.size, 0));
        }
        started = performance.now(); await act(async () => root!.unmount()); root = undefined; host.remove();
        record("unmount", performance.now() - started);
        expect([...subscriptions.values()].every(listeners => listeners.size === 0)).toBeTrue();
        expect(errors).toEqual([]); expect(writes).toEqual([]);
        expect(document.body.childElementCount).toBe(0);
        const fixtureDocument = document as unknown as Record<symbol, unknown>;
        const dependencies = fixtureDocument[PropertySymbol.affectsCache] as unknown[];
        maximumFixtureQueryDependencies = Math.max(maximumFixtureQueryDependencies, dependencies.length);
        const clear = fixtureDocument[PropertySymbol.clearCache];
        if (typeof clear !== "function") throw Error("Qualified Happy DOM selector-cache hook is unavailable");
        clear.call(document); fixtureQueryCacheResets++;
        if (cycle % 10 === 0) sampleMemory(cycle);
    }
    const records = [...durations].map(([name, values]) => {values.sort((left, right) => left - right); return {name, samples: values.length, medianMs: values[Math.floor(values.length * 0.5)], p95Ms: values[Math.floor(values.length * 0.95)], maximumMs: values.at(-1)};});
    const report = {pass: true, sourceCommit: ${JSON.stringify(sourceCommit)}, sourceFiles: ${JSON.stringify(sourceFiles)}, runtime: Bun.version, platform: process.platform, cycles: ${cycles}, workspaceTransitions: ${cycles * 9}, records, maximumSubscriptions, remainingSubscriptions: [...subscriptions.values()].reduce((sum, listeners) => sum + listeners.size, 0), finalPendingAnimationFrames: frames.size, mutationRequests: writes, fixtureQueryCacheResets, maximumFixtureQueryDependencies, memory, nonclaims: ["Actual production React tree with the qualified controlled host interfaces in Happy DOM; not Chromium layout or signed-in Discord latency.", "Per-transition times include React act and controlled focus-frame flush, without native/network work.", "Memory samples are forced-GC process endpoints during ${cycles} cycles, not the independent 30-minute backend soak.", "Happy DOM selector caches are cleared only after real teardown, empty DOM and zero-subscription assertions; this is fixture maintenance, not product cleanup."]};
    expect(report.finalPendingAnimationFrames).toBe(0);
    await Bun.write(${JSON.stringify(reportPath)}, JSON.stringify(report, null, 2) + "\\n");
}, 60000);
`;
const generatedTest = join(output, "panel-performance.test.tsx");
writeFileSync(generatedTest, generated);
try {
    const result = execFileSync(process.execPath, ["test", "--preload", join(project, "tests/setup.ts"), generatedTest], {cwd: project, encoding: "utf8", timeout: 90_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: {...process.env, NODE_PATH: join(project, "node_modules")}});
    writeFileSync(join(output, "stdout.log"), result);
}
catch (error) {
    const failure = error as Error & {stdout?: string; stderr?: string;};
    writeFileSync(join(output, "failure.log"), `${failure.stdout ?? ""}\n${failure.stderr ?? ""}\n${failure.message}`);
    throw error;
}
console.log(`PASS: ${cycles} production-panel lifecycles / ${cycles * 9} workspace transitions; ${reportPath}`);
