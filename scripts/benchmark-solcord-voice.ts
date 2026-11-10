import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, isAbsolute, join, resolve} from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";
import ts from "typescript";
import {SolcordFakeDeafenController, type SolcordGatewaySocket, type SolcordVoiceStatePayload} from "../src/betterdiscord/modules/solcord/fake-deafen";
import {patchSolcordFakeDeafenSend} from "../src/betterdiscord/modules/solcord/fake-deafen-send";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = process.argv[2];
if (!output || !isAbsolute(output)) throw new Error("Provide an absolute output directory on the task evidence volume.");
mkdirSync(output, {recursive: true});
const cycles = Number(process.argv[3] ?? 50_000);
if (!Number.isInteger(cycles) || cycles < 1 || cycles > 100_000) throw new Error("Voice benchmark cycles must be an integer from 1 through 100000.");
const patcherSource = readFileSync(join(project, "src/betterdiscord/modules/patcher.ts"), "utf8");
const parsed = ts.createSourceFile("patcher.ts", patcherSource, ts.ScriptTarget.Latest, true);
const patcherClass = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "Patcher");
if (!patcherClass) throw new Error("The shipping Patcher class was not found.");
const patcherCode = new Bun.Transpiler({loader: "ts", target: "browser"}).transformSync(`return ${patcherClass.getText(parsed).replace("export default ", "")}`);
const patcher = vm.compileFunction(patcherCode, ["Logger", "DiscordModules", "getByKeys"])({err() {throw new Error("A production patch callback failed during the voice benchmark.");}}, {}, () => undefined) as Parameters<typeof patchSolcordFakeDeafenSend>[3];
let localDeaf = false;
let rawSends = 0;
let lastSentSelfDeaf: boolean | undefined;
const readLastSentSelfDeaf = () => lastSentSelfDeaf;
const transport = {readyState: 1, send(payload: SolcordVoiceStatePayload) {rawSends++; lastSentSelfDeaf = payload.self_deaf;}};
const socket: SolcordGatewaySocket = {webSocket: transport,
send(opcode, payload) {
    if (opcode !== 4) throw new Error("Unexpected controlled voice opcode.");
    transport.send(payload as SolcordVoiceStatePayload);
}};
const controller = new SolcordFakeDeafenController({
    getAccountId: () => "111111111111111111",
    getSocket: () => socket,
    getConnectionIdentity: () => transport,
    getVoiceChannelId: () => "333333333333333333",
    isLocallyDeafened: () => localDeaf,
    toggleLocalDeafen: () => {
        localDeaf = !localDeaf;
        socket.send(4, {channel_id: "333333333333333333", guild_id: "555555555555555555", self_mute: false, self_deaf: localDeaf});
    },
    patchSend: (target, before, after) => patchSolcordFakeDeafenSend(target, before, after, patcher)
});
function oneCycle(): void {
    if (!controller.toggleDirect() || !controller.snapshot().armed || localDeaf || readLastSentSelfDeaf() !== true) throw new Error("Controlled Fake Deafen activation failed.");
    if (!controller.disarm() || controller.snapshot().armed || localDeaf || readLastSentSelfDeaf() !== false) throw new Error("Controlled Fake Deafen restoration failed.");
    if (patcher.patches.length !== 2 || patcher.patches.reduce((sum, patch) => sum + patch.children.length, 0) !== 4) throw new Error("The long-lived voice adapter stacked or lost an owned send hook.");
}
const memory: Array<{cycle: number; rssBytes: number; heapUsedBytes: number;}> = [];
const sampleMemory = (cycle: number) => {Bun.gc(true); const usage = process.memoryUsage(); memory.push({cycle, rssBytes: usage.rss, heapUsedBytes: usage.heapUsed});};
const durations: number[] = [];
const started = performance.now();
try {
    if (!controller.start()) throw new Error("Controlled voice adapter did not start.");
    for (let warmup = 0; warmup < 100; warmup++) oneCycle();
    sampleMemory(0);
    for (let cycle = 1; cycle <= cycles; cycle++) {
        const before = performance.now(); oneCycle(); durations.push(performance.now() - before);
        if (cycle % 1000 === 0) sampleMemory(cycle);
        // Drain canceled activation microtasks rather than retaining an artificial
        // single-task backlog for the entire benchmark.
        if (cycle % 100 === 0) await Promise.resolve();
    }
}
finally {controller.stop();}
await Promise.resolve();
sampleMemory(cycles);
if (patcher.patches.length || controller.snapshot().armed || controller.snapshot().pending || localDeaf) throw new Error("The long-lived voice benchmark retained hooks, pending state, or local deafen after teardown.");
durations.sort((left, right) => left - right);
const sourcePaths = ["src/betterdiscord/modules/solcord/fake-deafen.ts", "src/betterdiscord/modules/solcord/fake-deafen-send.ts", "src/betterdiscord/modules/patcher.ts", "scripts/benchmark-solcord-voice.ts"];
const report = {pass: true, generatedAt: new Date().toISOString(), sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {cwd: project, encoding: "utf8", windowsHide: true}).trim(), sourceFiles: sourcePaths.map(path => ({path, sha256: createHash("sha256").update(readFileSync(join(project, path))).digest("hex")})), runtime: Bun.version, platform: process.platform, elapsedMs: performance.now() - started, measuredCycles: cycles, warmupCycles: 100, rawSyntheticSends: rawSends, sampleMeaning: "One complete Fake Deafen on/off cycle using the real controller, real send receipt helper and shipping Patcher; correctness assertions included, periodic GC and microtask drains excluded.", medianMs: durations[Math.floor(durations.length / 2)], p95Ms: durations[Math.floor(durations.length * 0.95)], maximumMs: durations.at(-1), remainingPatches: patcher.patches.length, memory, nonclaims: ["All socket sends and local audio state are synthetic; no network or media device is opened.", "The controlled gateway omits Discord encoding, network I/O, Flux work, Runtime notifications and React rendering; these are controller/send-hook timings, not end-to-end call latency.", "Native synchronous transport return is local enqueue evidence and does not establish server acceptance."]};
writeFileSync(join(output, "voice-benchmark.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`PASS: ${cycles} long-lived Fake Deafen on/off cycles; ${join(output, "voice-benchmark.json")}`);
