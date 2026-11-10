import {describe, expect, test} from "bun:test";
import {discoverSolcordFakeDeafenCapabilities, isSolcordFakeDeafenGateway, isSolcordFakeDeafenMediaActions} from "../../src/betterdiscord/modules/solcord/fake-deafen-capabilities";

const gateway = {getName: () => "GatewayConnectionStore", getSocket: () => ({send() {}})};
const mediaActions = {toggleSelfDeaf() {}, toggleSelfMute() {}};

describe("Fake Deafen host discovery", () => {
    test("requires the gateway store identity and callable native actions", () => {
        expect(isSolcordFakeDeafenGateway(gateway)).toBeTrue();
        expect(isSolcordFakeDeafenGateway({getSocket() {}})).toBeFalse();
        expect(isSolcordFakeDeafenGateway({...gateway, getName: () => "AnotherStore"})).toBeFalse();
        expect(isSolcordFakeDeafenGateway({...gateway, getName() {throw new Error("drift");}})).toBeFalse();
        expect(isSolcordFakeDeafenMediaActions(mediaActions)).toBeTrue();
        expect(isSolcordFakeDeafenMediaActions({...mediaActions, toggleSelfDeaf: true})).toBeFalse();
    });

    test("starts both lookups together and cancels owned listeners after success", async () => {
        const signals: AbortSignal[] = [];
        let resolveGateway!: (value: unknown) => void;
        let audioStarted = false;
        const operation = discoverSolcordFakeDeafenCapabilities({
            gateway: signal => {signals.push(signal); return new Promise(resolve => {resolveGateway = resolve;});},
            mediaActions: async signal => {signals.push(signal); audioStarted = true; return mediaActions;}
        }, new AbortController().signal);
        expect(audioStarted).toBeTrue();
        resolveGateway(gateway);
        expect(await operation).toEqual({gateway, mediaActions});
        expect(signals.every(signal => signal.aborted)).toBeTrue();
    });

    test("releases a permanently missing module and aborts both lookups", async () => {
        const signals: AbortSignal[] = [];
        const missing = (signal: AbortSignal) => {signals.push(signal); return new Promise<unknown>(() => {});};
        expect(await discoverSolcordFakeDeafenCapabilities({gateway: missing, mediaActions: missing}, new AbortController().signal, 5)).toBeUndefined();
        expect(signals).toHaveLength(2);
        expect(signals.every(signal => signal.aborted)).toBeTrue();
    });

    test("a stopped scope settles pending discovery and ignores late resolution", async () => {
        const scope = new AbortController();
        let resolveGateway!: (value: unknown) => void;
        const operation = discoverSolcordFakeDeafenCapabilities({
            gateway: () => new Promise(resolve => {resolveGateway = resolve;}),
            mediaActions: async () => mediaActions
        }, scope.signal);
        scope.abort();
        expect(await operation).toBeUndefined();
        resolveGateway(gateway);
        await Promise.resolve();
        expect(await operation).toBeUndefined();
    });

    test("does not search a disposed scope and cleans up on lookup failure", async () => {
        const scope = new AbortController();
        scope.abort();
        let calls = 0;
        const lookup = async () => {calls++; return gateway;};
        expect(await discoverSolcordFakeDeafenCapabilities({gateway: lookup, mediaActions: lookup}, scope.signal)).toBeUndefined();
        expect(calls).toBe(0);
        let signal!: AbortSignal;
        await expect(discoverSolcordFakeDeafenCapabilities({
            gateway: async value => {signal = value; throw new Error("lookup failed");},
            mediaActions: async () => mediaActions
        }, new AbortController().signal)).rejects.toThrow("lookup failed");
        expect(signal.aborted).toBeTrue();
    });
});
