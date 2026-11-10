import type {SolcordFakeDeafenStatus} from "./fake-deafen";

export interface SolcordFakeDeafenPresentationContext {
    userId: unknown;
    channelId: unknown;
    sessionId: unknown;
    status: Pick<SolcordFakeDeafenStatus, "phase" | "armed" | "connected" | "accountBound" | "pending" | "voice">;
}

const DISCORD_ID = /^[1-9]\d{16,19}$/;

/** Identify the native current-session presentation projector without invoking it. */
export function findSolcordFakeDeafenPresentationKey(module: unknown): string | undefined {
    if (!module || typeof module !== "object") return;
    let entries: Array<[string, unknown]>;
    try {
        const keys = Object.keys(module);
        // The reviewed layout module has two exports. Avoid traversing large,
        // unrelated stores while the webpack lookup visits loaded modules.
        if (keys.length < 2 || keys.length > 8) return;
        entries = keys.map(key => [key, (module as Record<string, unknown>)[key]]);
    }
    catch {return;}
    const source = (value: unknown) => {
        try {
            if (typeof value !== "function") return "";
            const text = Function.prototype.toString.call(value);
            return text.length <= 16_384 ? text.replace(/\s+/g, "") : "";
        }
        catch {return "";}
    };
    const arity = (value: unknown) => {
        try {return typeof value === "function" ? value.length : -1;}
        catch {return -1;}
    };
    // The paired native hook subscribes to AuthenticationStore and MediaEngineStore.
    // No new hook is inserted into Discord's already mounted component tree.
    if (!entries.some(([, value]) => arity(value) === 0 && /\.cf\)\(\[[^\]]+\],/.test(source(value)))) return;
    const projectors = entries.filter(([, value]) => {
        if (arity(value) !== 2) return false;
        const text = source(value);
        return /\.sessionId===[$\w]+/.test(text)
            && /\.merge\(\{selfMute(?::[$\w]+)?,selfDeaf(?::[$\w]+)?\}\)/.test(text);
    });
    return projectors.length === 1 ? projectors[0][0] : undefined;
}

export function isSolcordFakeDeafenPresentationModule(module: unknown): boolean {
    return findSolcordFakeDeafenPresentationKey(module) !== undefined;
}

/**
 * Preserve a received self-deafen on our own current-session row while the
 * controller is armed. The native projector normally overlays local audio state.
 * This changes a new presentation record only, never a store or MediaEngine value.
 */
export function preserveSolcordOwnVoiceDeafenPresentation<T>(record: unknown, localState: unknown, result: T, context: SolcordFakeDeafenPresentationContext): T {
    try {
        const {userId, channelId, sessionId, status} = context;
        if (typeof userId !== "string" || !DISCORD_ID.test(userId) || typeof channelId !== "string" || !DISCORD_ID.test(channelId)
            || typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 256) return result;
        if (status.phase !== "armed" || status.armed !== true || status.connected !== true || status.accountBound !== true || status.pending === true || status.voice?.serverSelfDeaf !== true) return result;
        if (!record || typeof record !== "object" || !localState || typeof localState !== "object" || !result || typeof result !== "object") return result;
        const received = record as Record<string, unknown>;
        const local = localState as Record<string, unknown>;
        const rendered = result as Record<string, unknown>;
        const isOwnRecord = (value: Record<string, unknown>) => value.userId === userId && value.channelId === channelId && value.sessionId === sessionId;
        if (!isOwnRecord(received) || !isOwnRecord(rendered) || local.sessionId !== sessionId || received.selfDeaf !== true || rendered.selfDeaf !== false
            || typeof rendered.selfMute !== "boolean" || typeof rendered.deaf !== "boolean" || typeof rendered.merge !== "function") return result;
        const projected: unknown = Reflect.apply(rendered.merge, rendered, [{selfDeaf: true}]);
        if (!projected || typeof projected !== "object") return result;
        const next = projected as Record<string, unknown>;
        return isOwnRecord(next) && next.selfDeaf === true && next.selfMute === rendered.selfMute && next.deaf === rendered.deaf ? projected as T : result;
    }
    catch {return result;}
}
