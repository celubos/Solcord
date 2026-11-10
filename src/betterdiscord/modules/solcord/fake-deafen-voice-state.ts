export interface SolcordOwnVoiceDeafenState {
    localSelfDeaf: boolean | undefined;
    serverSelfDeaf: boolean | undefined;
    serverDeaf: boolean | undefined;
}

export interface SolcordOwnVoiceDeafenSources {
    voiceStateStore: unknown;
    mediaEngineStore: unknown;
    userId: unknown;
    channelId: unknown;
}

const DISCORD_ID = /^[1-9]\d{16,19}$/;

function booleanField(record: Record<string, unknown>, key: "selfDeaf" | "deaf"): boolean | undefined {
    try {
        const value = record[key];
        return typeof value === "boolean" ? value : undefined;
    }
    catch {return undefined;}
}

/**
 * Read only the current user's exact current-channel record. Discord's public
 * VoiceStateStore (module 977997, web.72656029554c0370.js, reviewed 2026-11-07)
 * exposes getVoiceStateForChannel(channelId, userId), selfDeaf, and deaf. These
 * are the latest observed store values, not proof of a fresh gateway response.
 */
export function readSolcordOwnVoiceDeafenState({voiceStateStore, mediaEngineStore, userId, channelId}: SolcordOwnVoiceDeafenSources): SolcordOwnVoiceDeafenState {
    const state: SolcordOwnVoiceDeafenState = {localSelfDeaf: undefined, serverSelfDeaf: undefined, serverDeaf: undefined};
    if (typeof userId !== "string" || !DISCORD_ID.test(userId) || typeof channelId !== "string" || !DISCORD_ID.test(channelId)) return state;
    try {
        const media = mediaEngineStore as {isSelfDeaf?: unknown;} | undefined;
        const read = media?.isSelfDeaf;
        if (typeof read === "function") {
            const value: unknown = Reflect.apply(read, media, []);
            if (typeof value === "boolean") state.localSelfDeaf = value;
        }
    }
    catch {/* A missing local adapter must not hide a known voice-state record. */}
    try {
        const store = voiceStateStore as {getVoiceStateForChannel?: unknown;} | undefined;
        const read = store?.getVoiceStateForChannel;
        if (typeof read !== "function") return state;
        const record: unknown = Reflect.apply(read, store, [channelId, userId]);
        if (!record || typeof record !== "object") return state;
        const own = record as Record<string, unknown>;
        if (own.userId !== userId || own.channelId !== channelId) return state;
        state.serverSelfDeaf = booleanField(own, "selfDeaf");
        state.serverDeaf = booleanField(own, "deaf");
    }
    catch {/* Unavailable or changed host getters remain explicitly unverified. */}
    return state;
}
