import {describe, expect, test} from "bun:test";
import {findSolcordFakeDeafenPresentationKey, isSolcordFakeDeafenPresentationModule, preserveSolcordOwnVoiceDeafenPresentation, type SolcordFakeDeafenPresentationContext} from "../../src/betterdiscord/modules/solcord/fake-deafen-presentation";

const USER = "111111111111111111";
const CHANNEL = "222222222222222222";
const SESSION = "controlled-current-session";

class VoiceRecord {
    constructor(readonly userId = USER, readonly channelId = CHANNEL, readonly sessionId = SESSION, readonly selfDeaf = true, readonly selfMute = false, readonly deaf = false) {}
    merge(values: Partial<VoiceRecord>) {return Object.assign(new VoiceRecord(), this, values);}
    isVoiceDeafened() {return this.selfDeaf || this.deaf;}
}

const localVoice = () => ({sessionId: SESSION, selfMute: true, selfDeaf: false});
// Independently modeled native current-session overlay, with real immutable records.
function nativeProjector(record: VoiceRecord, state: ReturnType<typeof localVoice>) {
    const {sessionId, selfMute, selfDeaf} = state;
    return record.sessionId === sessionId ? record.merge({selfMute: selfMute, selfDeaf: selfDeaf}) : record;
}
const flux = {cf: (_stores: unknown[], read: () => unknown) => read()};
function nativeHook() {return (0, flux.cf)(["authentication", "media"], localVoice);}
const context = (): SolcordFakeDeafenPresentationContext => ({
    userId: USER,
    channelId: CHANNEL,
    sessionId: SESSION,
    status: {phase: "armed", armed: true, connected: true, accountBound: true, voice: {serverSelfDeaf: true}}
});

describe("verified own Fake Deafen row presentation", () => {
    test("discovers the paired native projector semantically even when export keys change", () => {
        expect(findSolcordFakeDeafenPresentationKey({Nd: nativeProjector, oN: nativeHook})).toBe("Nd");
        expect(findSolcordFakeDeafenPresentationKey({renamedProjector: nativeProjector, renamedHook: nativeHook})).toBe("renamedProjector");
        expect(isSolcordFakeDeafenPresentationModule({Nd: nativeProjector, oN: nativeHook})).toBe(true);
    });

    test("ambiguous or changed host modules are rejected without executing exports", () => {
        expect(findSolcordFakeDeafenPresentationKey({Nd: nativeProjector})).toBeUndefined();
        expect(findSolcordFakeDeafenPresentationKey({Nd: nativeProjector, duplicate: nativeProjector, oN: nativeHook})).toBeUndefined();
        expect(findSolcordFakeDeafenPresentationKey({Nd: () => {throw Error("Never execute discovery candidates");}, oN: nativeHook})).toBeUndefined();
        expect(findSolcordFakeDeafenPresentationKey({get Nd() {throw Error("uninitialized export");}})).toBeUndefined();
        expect(findSolcordFakeDeafenPresentationKey({Nd: new Proxy(nativeProjector, {get() {throw Error("changed export");}}), oN: nativeHook})).toBeUndefined();
        expect(findSolcordFakeDeafenPresentationKey(undefined)).toBeUndefined();
        let unrelatedReads = 0;
        const unrelated = Object.fromEntries(Array.from({length: 9}, (_, index) => [`field${index}`, index]));
        Object.defineProperty(unrelated, "field0", {enumerable: true, get() {unrelatedReads++; return nativeProjector;}});
        expect(findSolcordFakeDeafenPresentationKey(unrelated)).toBeUndefined();
        expect(unrelatedReads).toBe(0);
    });

    test("restores received true after the native local overlay while preserving mute and leaving both old records untouched", () => {
        const received = new VoiceRecord(); const local = localVoice();
        const native = nativeProjector(received, local);
        expect(received.selfDeaf).toBe(true); expect(native.selfDeaf).toBe(false);
        const rendered = preserveSolcordOwnVoiceDeafenPresentation(received, local, native, context());
        expect(rendered.isVoiceDeafened()).toBe(true); expect(rendered.selfMute).toBe(true);
        expect(rendered).not.toBe(native); expect(rendered).not.toBe(received);
        expect(received).toEqual(new VoiceRecord()); expect(native.selfDeaf).toBe(false);
        expect(local).toEqual(localVoice());
    });

    test("turning Fake Deafen off immediately returns the native local presentation", () => {
        const received = new VoiceRecord(); const local = localVoice(); const native = nativeProjector(received, local);
        const off = context(); off.status.armed = false;
        expect(preserveSolcordOwnVoiceDeafenPresentation(received, local, native, off)).toBe(native);
        expect(native.isVoiceDeafened()).toBe(false);
    });

    test("unknown or false received state, pending activation, and loss of ownership cannot create a deaf icon", () => {
        const received = new VoiceRecord(); const local = localVoice(); const native = nativeProjector(received, local);
        for (const status of [
            {...context().status, voice: undefined}, {...context().status, voice: {serverSelfDeaf: false}},
            {...context().status, pending: true}, {...context().status, accountBound: false},
            {...context().status, connected: false}, {...context().status, phase: "attention" as const}
        ]) expect(preserveSolcordOwnVoiceDeafenPresentation(received, local, native, {...context(), status})).toBe(native);
        expect(preserveSolcordOwnVoiceDeafenPresentation(received, local, native, {...context(), status: {...context().status, armed: 1 as unknown as boolean}})).toBe(native);
        expect(preserveSolcordOwnVoiceDeafenPresentation(received.merge({selfDeaf: false}), local, native, context())).toBe(native);
    });

    test("other users, channels, sessions, and stale local-session snapshots retain native presentation", () => {
        const local = localVoice();
        for (const received of [new VoiceRecord("333333333333333333"), new VoiceRecord(USER, "444444444444444444"), new VoiceRecord(USER, CHANNEL, "other-session")]) {
            const native = received.merge({selfDeaf: false});
            expect(preserveSolcordOwnVoiceDeafenPresentation(received, local, native, context())).toBe(native);
        }
        const received = new VoiceRecord(); const native = nativeProjector(received, local);
        expect(preserveSolcordOwnVoiceDeafenPresentation(received, {...local, sessionId: "previous-session"}, native, context())).toBe(native);
        expect(preserveSolcordOwnVoiceDeafenPresentation(received, local, native.merge({channelId: "444444444444444444"}), context()).selfDeaf).toBe(false);
        for (const invalid of [{userId: undefined}, {channelId: "invalid"}, {sessionId: ""}]) expect(preserveSolcordOwnVoiceDeafenPresentation(received, local, native, {...context(), ...invalid})).toBe(native);
    });

    test("administrative deafen and an already correct native row remain untouched", () => {
        const received = new VoiceRecord(USER, CHANNEL, SESSION, true, false, true); const local = localVoice();
        const rendered = preserveSolcordOwnVoiceDeafenPresentation(received, local, nativeProjector(received, local), context());
        expect(rendered.deaf).toBe(true); expect(rendered.isVoiceDeafened()).toBe(true);
        expect(preserveSolcordOwnVoiceDeafenPresentation(received, local, received, context())).toBe(received);
    });

    test("only the presentation selfDeaf field is requested, and incompatible merges fail closed", () => {
        const received = new VoiceRecord(); const local = localVoice(); const native = nativeProjector(received, local);
        const calls: unknown[] = [];
        const tracked = Object.assign(native.merge({}), {merge(values: Partial<VoiceRecord>) {calls.push(values); return native.merge(values);}});
        expect(preserveSolcordOwnVoiceDeafenPresentation(received, local, tracked, context()).selfDeaf).toBe(true);
        expect(calls).toEqual([{selfDeaf: true}]);
        const broken = Object.assign(native.merge({}), {merge() {throw Error("host drift");}});
        expect(preserveSolcordOwnVoiceDeafenPresentation(received, local, broken, context())).toBe(broken);
        const changedMute = Object.assign(native.merge({}), {merge: () => native.merge({selfDeaf: true, selfMute: false})});
        expect(preserveSolcordOwnVoiceDeafenPresentation(received, local, changedMute, context())).toBe(changedMute);
        expect(preserveSolcordOwnVoiceDeafenPresentation(received, local, undefined, context())).toBeUndefined();
    });
});
