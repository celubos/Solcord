// SPDX-License-Identifier: Apache-2.0

import {describe, expect, test} from "bun:test";
import {DiscordConnectionTimeoutError, observeDiscordConnection, waitForDiscordConnection} from "../../src/betterdiscord/modules/connection";

const tick = () => new Promise(resolve => setTimeout(resolve, 8));
function host() {
    const listeners = new Set<() => void>();
    return {
        listeners,
        subscribe(_event: string, listener: () => void) {listeners.add(listener);},
        unsubscribe(_event: string, listener: () => void) {listeners.delete(listener);},
        emit() {for (const listener of [...listeners]) listener();}
    };
}

describe("shipping connection ownership and login races", () => {
    test("CONNECTION_OPEN before account hydration does not release startup", async () => {
        const dispatcher = host(); let user = false; let settled = false;
        const task = waitForDiscordConnection(() => user, () => dispatcher, 200, 2).then(() => {settled = true;});
        dispatcher.emit();
        await tick();
        expect(settled).toBe(false); expect(dispatcher.listeners.size).toBe(1);
        user = true; dispatcher.emit(); await task;
        expect(settled).toBe(true); expect(dispatcher.listeners.size).toBe(0);
    });

    test("throwing store discovery is retried and a replacement dispatcher retires the previous listener", async () => {
        const first = host(); const second = host(); let replacement = false; let unavailable = true; let user = false;
        const task = waitForDiscordConnection(() => {if (unavailable) throw Error("host-not-ready"); return user;}, () => replacement ? second : first, 200, 2);
        unavailable = false; await tick(); expect(first.listeners.size).toBe(1);
        replacement = true; await tick();
        expect(first.listeners.size).toBe(0); expect(second.listeners.size).toBe(1);
        user = true; second.emit(); await task; expect(second.listeners.size).toBe(0);
    });

    test("partial subscription failure and throwing unsubscription cannot strand readiness or timeout", async () => {
        const dispatcher = host(); let attempts = 0; let user = false;
        const subscribe = dispatcher.subscribe;
        dispatcher.subscribe = (event, listener) => {subscribe(event, listener); if (++attempts === 1) throw Error("host-race");};
        const unsubscribe = dispatcher.unsubscribe;
        dispatcher.unsubscribe = (event, listener) => {unsubscribe(event, listener); throw Error("host-disposed");};
        const task = waitForDiscordConnection(() => user, () => dispatcher, 200, 2);
        await tick(); expect(attempts).toBeGreaterThan(1); expect(dispatcher.listeners.size).toBe(1);
        user = true; dispatcher.emit(); await task; expect(dispatcher.listeners.size).toBe(0);
        await expect(waitForDiscordConnection(() => false, () => dispatcher, 5, 1)).rejects.toBeInstanceOf(DiscordConnectionTimeoutError);
        expect(dispatcher.listeners.size).toBe(0);
    });

    test("abort removes the owned poller, listener and bounded wait", async () => {
        const owner = new AbortController(); const dispatcher = host(); let reads = 0;
        const task = waitForDiscordConnection(() => {reads++; return false;}, () => dispatcher, 200, 1, owner.signal);
        expect(dispatcher.listeners.size).toBe(1);
        owner.abort(); await expect(task).rejects.toMatchObject({name: "AbortError"});
        const stoppedAt = reads; await tick();
        expect(reads).toBe(stoppedAt); expect(dispatcher.listeners.size).toBe(0);
    });

    test("late-login observer completes once and synchronous subscription callbacks remain owned", async () => {
        const dispatcher = host(); let user = false; let calls = 0;
        const subscribe = dispatcher.subscribe;
        dispatcher.subscribe = (event, listener) => {subscribe(event, listener); listener();};
        const stop = observeDiscordConnection(() => user, () => dispatcher, () => calls++, undefined, 1);
        expect(calls).toBe(0); expect(dispatcher.listeners.size).toBe(1);
        user = true; dispatcher.emit(); dispatcher.emit(); await tick(); stop(); stop();
        expect(calls).toBe(1); expect(dispatcher.listeners.size).toBe(0);
        const owner = new AbortController(); owner.abort();
        observeDiscordConnection(() => {throw Error("must-not-run");}, () => dispatcher, () => calls++, owner.signal, 1);
        expect(calls).toBe(1);
    });

    test("reentrant abort during store discovery, dispatcher discovery or subscribe cannot attach after cleanup", async () => {
        for (const boundary of ["user", "dispatcher", "subscribe"]) {
            const owner = new AbortController(); const dispatcher = host(); let ready = 0;
            const subscribe = dispatcher.subscribe;
            dispatcher.subscribe = (event, listener) => {
                if (boundary === "subscribe") owner.abort();
                subscribe(event, listener);
            };
            const stop = observeDiscordConnection(() => {
                if (boundary === "user") owner.abort();
                return false;
            }, () => {
                if (boundary === "dispatcher") owner.abort();
                return dispatcher;
            }, () => ready++, owner.signal, 1);
            await tick(); stop();
            expect(dispatcher.listeners.size).toBe(0); expect(ready).toBe(0);
        }
    });
});
