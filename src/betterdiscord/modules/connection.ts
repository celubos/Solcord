// SPDX-License-Identifier: Apache-2.0

interface ConnectionDispatcher {
    subscribe(event: string, listener: () => void): void;
    unsubscribe(event: string, listener: () => void): void;
}

export class DiscordConnectionTimeoutError extends Error {
    constructor() {
        super("Discord connection was not ready within the startup deadline.");
        this.name = "DiscordConnectionTimeoutError";
    }
}

/** One renderer-owned observer; discovery failures are retried without retaining errors or account data. */
export function observeDiscordConnection(currentUser: () => unknown, dispatcher: () => ConnectionDispatcher | undefined, onReady: () => void, signal?: AbortSignal, intervalMs = 1_000): () => void {
    let subscription: ConnectionDispatcher | undefined;
    let finished = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    const retire = (entry: ConnectionDispatcher | undefined) => {
        try {entry?.unsubscribe("CONNECTION_OPEN", check);}
        catch {/* A stale host dispatcher must not prevent retiring the observer. */}
    };
    const unsubscribe = () => {
        const previous = subscription;
        subscription = undefined;
        retire(previous);
    };
    const cleanup = () => {
        if (finished) return;
        finished = true;
        if (poll !== undefined) clearInterval(poll);
        poll = undefined;
        signal?.removeEventListener("abort", cleanup);
        unsubscribe();
    };
    const check = () => {
        if (finished) return;
        let ready = false;
        try {
            ready = Boolean(currentUser());
            if (finished || signal?.aborted) {cleanup(); return;}
            if (!ready) {
                const candidate = dispatcher();
                if (finished || signal?.aborted) {cleanup(); return;}
                const next = typeof candidate?.subscribe === "function" && typeof candidate.unsubscribe === "function" ? candidate : undefined;
                if (finished || signal?.aborted) {cleanup(); return;}
                if (next !== subscription) {
                    unsubscribe();
                    if (finished || signal?.aborted) {cleanup(); return;}
                    subscription = next;
                    try {subscription?.subscribe("CONNECTION_OPEN", check);}
                    catch {unsubscribe();}
                    // subscribe may abort reentrantly, then attach its listener
                    // after cleanup ran. Retire that exact candidate again.
                    if (finished || signal?.aborted) {retire(next); cleanup(); return;}
                }
                ready = Boolean(currentUser());
            }
        }
        catch {/* Host stores and modules can be unavailable during login or replacement. */}
        if (!ready || finished) return;
        cleanup();
        onReady();
    };
    if (signal?.aborted) {cleanup(); return cleanup;}
    signal?.addEventListener("abort", cleanup, {once: true});
    poll = setInterval(check, Math.max(1, intervalMs));
    check();
    return cleanup;
}

/** Bounded discovery owns its dispatcher callback, poller, deadline and abort listener on every exit. */
export function waitForDiscordConnection(currentUser: () => unknown, dispatcher: () => ConnectionDispatcher | undefined, timeoutMs = 30_000, intervalMs = 250, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        let finished = false;
        let stop = () => {};
        let deadline: ReturnType<typeof setTimeout> | undefined;
        const finish = (error?: Error) => {
            if (finished) return;
            finished = true;
            stop();
            stop = () => {};
            if (deadline !== undefined) clearTimeout(deadline);
            deadline = undefined;
            signal?.removeEventListener("abort", onAbort);
            if (error) reject(error);
            else resolve();
        };
        const onAbort = () => {const error = new Error("Discord connection wait was cancelled."); error.name = "AbortError"; finish(error);};
        if (signal?.aborted) {onAbort(); return;}
        signal?.addEventListener("abort", onAbort, {once: true});
        deadline = setTimeout(() => finish(new DiscordConnectionTimeoutError()), Math.max(1, timeoutMs));
        stop = observeDiscordConnection(currentUser, dispatcher, () => finish(), signal, intervalMs);
        // A ready store or synchronous subscribe callback can resolve before stop is assigned.
        if (finished) stop();
    });
}
