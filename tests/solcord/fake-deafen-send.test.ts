import {afterEach, describe, expect, test} from "bun:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import type ShippingPatcher from "../../src/betterdiscord/modules/patcher";
import {patchSolcordFakeDeafenSend} from "../../src/betterdiscord/modules/solcord/fake-deafen-send";
import type {SolcordGatewaySocket} from "../../src/betterdiscord/modules/solcord/fake-deafen";

// Execute the shipping patcher, including its exception handling and shared
// before/after argument arrays. No Discord process or actual WebSocket is used.
const patcherSource = fs.readFileSync(new URL("../../src/betterdiscord/modules/patcher.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("patcher.ts", patcherSource, ts.ScriptTarget.Latest, true);
const patcherClass = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "Patcher")!;
const patcherCode = new Bun.Transpiler({loader: "ts", target: "browser"}).transformSync(`return ${patcherClass.getText(parsed).replace("export default ", "")}`);

// Minimal observed send field from public web.72656029554c0370.js module868,
// reviewed 2026-11-07. Keep its swallowed exceptions and null-transport behavior;
// the independent synthetic transport below models the standard's ready states.
const observedGatewaySend = `(e,t,n)=>{C.default.isLoggingGatewayEvents&&ts.verboseDangerously("~>",e,eQ[e],t);let i=tl.pack({op:e,d:t});if(!n||this.isSessionEstablished())try{null!=this.webSocket&&this.webSocket.send(i)}catch(e){}else ts.warn(\`Attempted to send while not being in a connected state opcode: \${e}\`)}`;

interface Transport {
    readyState: number;
    send(data: unknown): unknown;
}
interface Gateway extends SolcordGatewaySocket {
    webSocket?: Transport;
    isSessionEstablished(): boolean;
}
const cleanups: Array<() => void> = [];
afterEach(() => {for (const dispose of cleanups.splice(0).reverse()) dispose();});

function host() {
    const patcher = vm.compileFunction(patcherCode, ["Logger", "DiscordModules", "getByKeys"])(
        {err() {}}, {}, () => undefined
    ) as typeof ShippingPatcher;
    cleanups.push(() => {for (const patch of [...patcher.patches]) for (const child of [...patch.children]) child.unpatch();});
    const frames: unknown[] = [];
    const transport: Transport = {
        readyState: 1,
        send(data) {
            if (this.readyState === 0) throw new Error("controlled CONNECTING transport");
            if (this.readyState !== 1) return;
            frames.push(data);
        }
    };
    const socket: Gateway = {webSocket: transport, isSessionEstablished: () => true, send() {}};
    // An opaque frame makes accidental payload/property inspection fail loudly.
    const opaqueFrame = new Proxy({}, {get() {throw new Error("Raw payload must stay opaque");}, ownKeys() {throw new Error("Raw payload must stay opaque");}});
    socket.send = vm.compileFunction(`return ${observedGatewaySend}`, ["C", "ts", "eQ", "tl"]).call(
        socket, {"default": {isLoggingGatewayEvents: false}}, {warn() {}, verboseDangerously() {}}, {}, {pack: () => opaqueFrame}
    ) as Gateway["send"];
    const gatewayOriginal = socket.send;
    const transportOriginal = transport.send;
    const beforeCalls: unknown[][] = [];
    const afterCalls: unknown[][] = [];
    const install = (before: (args: unknown[]) => void = () => {}, adapter: Parameters<typeof patchSolcordFakeDeafenSend>[3] = patcher) => {
        const dispose = patchSolcordFakeDeafenSend(socket, args => {beforeCalls.push(args); before(args);}, args => {afterCalls.push(args);}, adapter);
        if (dispose) cleanups.push(dispose);
        return dispose;
    };
    return {patcher, socket, transport, frames, opaqueFrame, gatewayOriginal, transportOriginal, beforeCalls, afterCalls, install};
}
const voicePayload = () => ({channel_id: "333333333333333333", self_deaf: true, self_mute: false});

describe("Fake Deafen exact-host send confirmation", () => {
    test("one OPEN native send confirms the same gateway invocation without reading raw bytes", () => {
        const h = host(); const dispose = h.install(); const payload = voicePayload();
        expect(dispose).toBeFunction();
        expect(h.socket.send(4, payload)).toBeUndefined();
        expect(h.frames).toHaveLength(1); expect(h.frames[0]).toBe(h.opaqueFrame);
        expect(h.afterCalls).toHaveLength(1); expect(h.afterCalls[0]).toBe(h.beforeCalls[0]);
        expect(h.afterCalls[0][1]).toBe(payload);
        dispose!(); dispose!();
        expect(h.socket.send).toBe(h.gatewayOriginal); expect(h.transport.send).toBe(h.transportOriginal);
        expect(h.patcher.patches).toHaveLength(0);
    });

    test("an OPEN raw transport throw swallowed by the observed wrapper cannot confirm", () => {
        const h = host(); h.transport.send = () => {throw new Error("controlled raw send rejection");};
        h.install(); expect(() => h.socket.send(4, voicePayload())).not.toThrow();
        expect(h.beforeCalls).toHaveLength(1); expect(h.afterCalls).toHaveLength(0); expect(h.frames).toHaveLength(0);
    });

    test("missing or non-OPEN transports are refused before any patch is installed", () => {
        for (const state of [undefined, 0, 2, 3]) {
            const h = host();
            if (state === undefined) h.socket.webSocket = undefined;
            else h.transport.readyState = state;
            expect(h.install()).toBeNull(); expect(h.patcher.patches).toHaveLength(0);
        }
    });

    test("CONNECTING throws and silent CLOSING/CLOSED discards after installation cannot confirm", () => {
        for (const state of [0, 2, 3]) {
            const h = host(); h.install(); h.transport.readyState = state;
            expect(() => h.socket.send(4, voicePayload())).not.toThrow();
            expect(h.frames).toHaveLength(0); expect(h.afterCalls).toHaveLength(0);
        }
    });

    test("closing during the raw call fails the second OPEN boundary", () => {
        const h = host(); h.transport.send = () => {h.transport.readyState = 2;}; h.install();
        h.socket.send(4, voicePayload()); expect(h.afterCalls).toHaveLength(0);
    });

    test("a missing or replaced raw transport after installation cannot reuse the receipt", () => {
        for (const replacement of [undefined, {readyState: 1, send() {}}]) {
            const h = host(); h.install(); h.socket.webSocket = replacement;
            h.socket.send(4, voicePayload()); expect(h.afterCalls).toHaveLength(0);
        }
    });

    test("a transport replaced inside its raw send cannot confirm the old invocation", () => {
        const h = host(); h.transport.send = () => {h.socket.webSocket = {readyState: 1, send() {}};}; h.install();
        h.socket.send(4, voicePayload()); expect(h.afterCalls).toHaveLength(0);
    });

    test("non-voice gateway calls and direct raw calls forward normally without confirmation", () => {
        const h = host(); h.install();
        h.socket.send(1, "synthetic heartbeat"); h.transport.send(h.opaqueFrame);
        expect(h.frames).toHaveLength(2); expect(h.beforeCalls).toHaveLength(1); expect(h.afterCalls).toHaveLength(0);
    });

    test("nested non-voice sends invalidate the outer voice receipt without changing traffic", () => {
        const h = host(); h.install(args => {if (args[0] === 4) h.socket.send(1, "nested heartbeat");});
        h.socket.send(4, voicePayload());
        expect(h.frames).toHaveLength(2); expect(h.beforeCalls).toHaveLength(2); expect(h.afterCalls).toHaveLength(0);
    });

    test("a nested voice invocation can confirm only its own exact argument array", () => {
        const h = host(); const nested = voicePayload(); let reentered = false;
        h.install(args => {if (args[0] === 4 && !reentered) {reentered = true; h.socket.send(4, nested);}});
        h.socket.send(4, voicePayload());
        expect(h.frames).toHaveLength(2); expect(h.afterCalls).toHaveLength(1);
        expect(h.afterCalls[0]).toBe(h.beforeCalls[1]); expect(h.afterCalls[0][1]).toBe(nested);
    });

    test("multiple raw attempts inside one gateway call cannot produce a confirmation", () => {
        const h = host(); h.install(args => {if (args[0] === 4) h.transport.send(h.opaqueFrame);});
        h.socket.send(4, voicePayload()); expect(h.frames).toHaveLength(2); expect(h.afterCalls).toHaveLength(0);
    });

    test("instead interposers present before installation are refused and preserved", () => {
        for (const which of ["gateway", "raw"]) {
            const h = host(); const target = which === "gateway" ? h.socket : h.transport;
            const remove = h.patcher.instead("foreign", target, "send", () => undefined, {forcePatch: false})!;
            expect(h.install()).toBeNull(); expect(h.patcher.getPatchesByCaller("foreign")).toHaveLength(1);
            remove(); expect(h.patcher.patches).toHaveLength(0);
        }
    });

    test("a later instead interposer cannot turn its fake return into raw-send evidence", () => {
        for (const which of ["gateway", "raw"]) {
            const h = host(); h.install(); const target = which === "gateway" ? h.socket : h.transport;
            const remove = h.patcher.instead("foreign", target, "send", () => undefined, {forcePatch: false})!;
            h.socket.send(4, voicePayload()); expect(h.afterCalls).toHaveLength(0);
            remove(); h.socket.send(4, voicePayload()); expect(h.afterCalls).toHaveLength(1);
        }
    });

    test("partial installation failure removes all already-owned hooks", () => {
        const h = host(); let afterRegistrations = 0;
        const adapter: Parameters<typeof patchSolcordFakeDeafenSend>[3] = {
            get patches() {return h.patcher.patches;},
            before: h.patcher.before.bind(h.patcher),
            after(...args) {return ++afterRegistrations === 2 ? null : h.patcher.after(...args);}
        };
        expect(() => h.install(() => {}, adapter)).toThrow("confirmation hook");
        expect(h.patcher.patches).toHaveLength(0);
        expect(h.socket.send).toBe(h.gatewayOriginal); expect(h.transport.send).toBe(h.transportOriginal);
    });

    test("teardown during the before callback forwards the frame without late confirmation", () => {
        const h = host(); let dispose: (() => void) | null = null;
        dispose = h.install(() => dispose?.()); h.socket.send(4, voicePayload());
        expect(h.frames).toHaveLength(1); expect(h.afterCalls).toHaveLength(0); expect(h.patcher.patches).toHaveLength(0);
    });

    test("a rejected before observer cannot be reported as a completed operation", () => {
        const h = host(); h.install(() => {throw new Error("controlled before observer failure");});
        h.socket.send(4, voicePayload()); expect(h.frames).toHaveLength(1);
        expect(h.afterCalls).toHaveLength(0);
    });
});
