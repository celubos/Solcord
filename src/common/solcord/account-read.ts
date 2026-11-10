// SPDX-License-Identifier: Apache-2.0

/** One in-flight read per current identity. Old completions cannot clear a new read. */
export class SolcordAccountReadCoalescer<T> {
    #pending?: {accountId: string; promise: Promise<T>;};
    get pendingAccountId(): string | undefined {return this.#pending?.accountId;}

    load(accountId: string, read: () => Promise<T>): Promise<T> {
        if (this.#pending?.accountId === accountId) return this.#pending.promise;
        // Invoke now so an owner's generation is captured before disposal or an
        // account switch, rather than by a late microtask after invalidation.
        const operation = (async () => read())();
        const pending = {accountId,
promise: operation.finally(() => {
            if (this.#pending === pending) this.#pending = undefined;
        })};
        this.#pending = pending;
        return pending.promise;
    }

    invalidate(): void {this.#pending = undefined;}
}
