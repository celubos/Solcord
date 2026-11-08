import type {SolcordGatewaySocket} from "./fake-deafen";

export interface SolcordFakeDeafenGateway {
    getName(): string;
    getSocket(): SolcordGatewaySocket | undefined;
}

export interface SolcordFakeDeafenMediaActions {
    toggleSelfDeaf(): void;
    toggleSelfMute(): void;
}

export function isSolcordFakeDeafenGateway(value: unknown): value is SolcordFakeDeafenGateway {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<SolcordFakeDeafenGateway>;
    try {
        return typeof candidate.getSocket === "function" && typeof candidate.getName === "function"
            && candidate.getName() === "GatewayConnectionStore";
    }
    catch {return false;}
}

export function isSolcordFakeDeafenMediaActions(value: unknown): value is SolcordFakeDeafenMediaActions {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<SolcordFakeDeafenMediaActions>;
    return typeof candidate.toggleSelfDeaf === "function" && typeof candidate.toggleSelfMute === "function";
}

/** Missing host modules must release the click and their lazy lookup listeners. */
export async function discoverSolcordFakeDeafenCapabilities(
    lookup: {
        gateway(signal: AbortSignal): Promise<unknown>;
        mediaActions(signal: AbortSignal): Promise<unknown>;
    },
    parentSignal: AbortSignal,
    timeoutMs = 4_000
): Promise<{gateway: SolcordFakeDeafenGateway; mediaActions: SolcordFakeDeafenMediaActions;} | undefined> {
    if (parentSignal.aborted) return;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    parentSignal.addEventListener("abort", cancel, {once: true});
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancelled = new Promise<undefined>(resolve => {
        controller.signal.addEventListener("abort", () => resolve(undefined), {once: true});
    });
    try {
        timer = setTimeout(cancel, Math.min(30_000, Math.max(1, Number.isFinite(timeoutMs) ? timeoutMs : 4_000)));
        if (parentSignal.aborted) cancel();
        if (controller.signal.aborted) return;
        const found = Promise.all([lookup.gateway(controller.signal), lookup.mediaActions(controller.signal)])
            .then(([gateway, mediaActions]) => isSolcordFakeDeafenGateway(gateway) && isSolcordFakeDeafenMediaActions(mediaActions)
                ? {gateway, mediaActions} : undefined);
        return await Promise.race([found, cancelled]);
    }
    finally {
        if (timer !== undefined) clearTimeout(timer);
        parentSignal.removeEventListener("abort", cancel);
        cancel();
    }
}
