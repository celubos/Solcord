import type Patcher from "../patcher";
import {DISCORD_VOICE_STATE_UPDATE_OPCODE, type SolcordGatewaySocket} from "./fake-deafen";

interface VoiceTransport {
    readyState: number;
    send(...args: unknown[]): unknown;
}

interface SendFrame {
    args: unknown[];
    attempts: number;
    rawArgs?: unknown[];
    completed: boolean;
}

/**
 * Discord's gateway wrapper can swallow WebSocket errors or skip a missing
 * transport. Confirm only one successful native send while that exact transport
 * is OPEN. This is local enqueue evidence, not a server acknowledgement.
 */
export function patchSolcordFakeDeafenSend(socket: SolcordGatewaySocket, before: (args: unknown[]) => void, after: (args: unknown[]) => void, patcher: Pick<typeof Patcher, "before" | "after" | "patches">): (() => void) | null {
    const transport = socket.webSocket as VoiceTransport | undefined;
    if (!transport || typeof transport.send !== "function" || transport.readyState !== 1) return null;
    let active: SendFrame | undefined;
    const removers: Array<() => void> = [];
    const current = () => socket.webSocket === transport && transport.readyState === 1
        && !patcher.patches.some(patch => (patch.module === socket || patch.module === transport) && patch.functionName === "send" && patch.children.some(child => child.type === "instead"));
    if (!current()) return null;
    const own = (remove: (() => void) | null) => {
        if (typeof remove !== "function") throw new Error("Voice send confirmation hook is unavailable");
        removers.push(remove);
    };
    const dispose = () => {
        active = undefined;
        const errors: unknown[] = [];
        for (let index = removers.length - 1; index >= 0; index--) {
            try {removers[index](); removers.splice(index, 1);}
            catch (error) {errors.push(error);}
        }
        if (errors.length) throw new AggregateError(errors, "Voice send confirmation cleanup failed");
    };
    try {
        own(patcher.before("Solcord~FakeDeafenTransport", transport, "send", (_self, args) => {
            if (!active) return;
            active.attempts++;
            if (active.attempts === 1 && current()) active.rawArgs = args;
        }, {forcePatch: false}));
        own(patcher.after("Solcord~FakeDeafenTransport", transport, "send", (_self, args) => {
            if (active?.rawArgs === args && active.attempts === 1 && current()) active.completed = true;
        }, {forcePatch: false}));
        own(patcher.before("Solcord~FakeDeafen", socket, "send", (_self, args) => {
            // One bounded frame: nested gateway calls invalidate the outer
            // receipt. A throw cannot leave an accumulating stack, and the next
            // call replaces it. Never retain non-voice gateway payloads.
            active = args[0] === DISCORD_VOICE_STATE_UPDATE_OPCODE && current() ? {args, attempts: 0, completed: false} : undefined;
            try {before(args);}
            catch (error) {active = undefined; throw error;}
        }, {forcePatch: false}));
        own(patcher.after("Solcord~FakeDeafen", socket, "send", (_self, args) => {
            const frame = active;
            active = undefined;
            if (frame?.args === args && frame.attempts === 1 && frame.completed && current()) after(args);
        }, {forcePatch: false}));
        return dispose;
    }
    catch (error) {dispose(); throw error;}
}
