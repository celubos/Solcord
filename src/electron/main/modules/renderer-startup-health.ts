// SPDX-License-Identifier: Apache-2.0

/** Owns one bounded health timer per main-process document, without storing URLs or user data. */
export class RendererStartupWatchdog<TOwner extends object> {
    #timers = new WeakMap<TOwner, ReturnType<typeof setTimeout>>();

    begin(owner: TOwner, onTimeout: () => void, delayMs = 45_000): void {
        this.cancel(owner);
        const timer = setTimeout(() => {
            if (this.#timers.get(owner) !== timer) return;
            this.#timers.delete(owner);
            onTimeout();
        }, delayMs);
        this.#timers.set(owner, timer);
    }

    cancel(owner: TOwner): void {
        const timer = this.#timers.get(owner);
        if (timer !== undefined) clearTimeout(timer);
        this.#timers.delete(owner);
    }
}

// Self-contained because the fixed function is evaluated in the trusted main
// document, including when renderer imports fail before Core can run.
function showRendererStartupFailure() {
    if (document.getElementById("solcord-startup-failure")) return;
    const notice = document.createElement("aside");
    notice.id = "solcord-startup-failure";
    notice.setAttribute("role", "alert");
    notice.textContent = "Solcord could not finish startup. Discord is still available. Restart Discord to retry, or open Solcord Setup to repair. ";
    Object.assign(notice.style, {position: "fixed", right: "16px", bottom: "16px", maxWidth: "420px", padding: "12px", zIndex: "2147483647", background: "var(--background-floating, #1e1f22)", color: "var(--text-normal, #fff)", border: "1px solid var(--background-modifier-accent, #555)", borderRadius: "4px"});
    const dismiss = document.createElement("button");
    dismiss.textContent = "Dismiss";
    dismiss.onclick = () => notice.remove();
    notice.append(dismiss);
    (document.body || document.documentElement).append(notice);
}

export function rendererStartupFailureScript(): string {
    return `(${showRendererStartupFailure.toString()})();`;
}
