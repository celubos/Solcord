// SPDX-License-Identifier: Apache-2.0

interface ConnectionDispatcher {
    subscribe(event: string, listener: () => void): void;
    unsubscribe(event: string, listener: () => void): void;
}

/** Bounded discovery owns its dispatcher callback and poller on every exit. */
export function waitForDiscordConnection(currentUser: () => unknown, dispatcher: () => ConnectionDispatcher | undefined, timeoutMs = 30_000, intervalMs = 250): Promise<void> {
    return new Promise((resolve, reject) => {
        let subscription: ConnectionDispatcher | undefined;
        let finished = false;
        const cleanup = () => {
            if (poll) clearInterval(poll);
            if (deadline) clearTimeout(deadline);
            subscription?.unsubscribe("CONNECTION_OPEN", onOpen);
            subscription = undefined;
        };
        const onOpen = () => {
            if (finished) return;
            finished = true;
            cleanup();
            resolve();
        };
        const check = () => {
            if (finished) return;
            try {
                if (currentUser()) {onOpen(); return;}
                const candidate = dispatcher();
                const next = typeof candidate?.subscribe === "function" && typeof candidate.unsubscribe === "function" ? candidate : undefined;
                if (next === subscription) return;
                subscription?.unsubscribe("CONNECTION_OPEN", onOpen);
                subscription = next;
                subscription?.subscribe("CONNECTION_OPEN", onOpen);
                if (currentUser()) onOpen();
            }
            catch (error) {finished = true; cleanup(); reject(error);}
        };
        const poll = setInterval(check, intervalMs);
        const deadline = setTimeout(() => {
            if (finished) return;
            finished = true;
            cleanup();
            reject(new Error("Discord connection was not ready within the startup deadline."));
        }, timeoutMs);
        try {check();}
        catch (error) {finished = true; cleanup(); reject(error);}
    });
}
