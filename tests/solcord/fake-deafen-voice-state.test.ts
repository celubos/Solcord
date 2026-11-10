import {describe, expect, test} from "bun:test";
import {readSolcordOwnVoiceDeafenState} from "../../src/betterdiscord/modules/solcord/fake-deafen-voice-state";

const USER_ID = "111111111111111111";
const CHANNEL_ID = "222222222222222222";
const ownRecord = () => ({userId: USER_ID, channelId: CHANNEL_ID, selfDeaf: true, deaf: false});
const unknown = {localSelfDeaf: undefined, serverSelfDeaf: undefined, serverDeaf: undefined};

describe("current-user current-channel deafen observation", () => {
    test("reads the exact own channel getter and preserves local versus reported deafen separately", () => {
        const calls: unknown[][] = [];
        const voiceStateStore = {
            getVoiceStateForChannel(...args: unknown[]) {calls.push(args); return ownRecord();},
            getVoiceStateForUser() {throw new Error("A cross-session getter must not be used");},
            getVoiceStatesForChannel() {throw new Error("Other participants must not be enumerated");},
            getAllVoiceStates() {throw new Error("Other participants must not be enumerated");}
        };
        const result = readSolcordOwnVoiceDeafenState({voiceStateStore, mediaEngineStore: {isSelfDeaf: () => false}, userId: USER_ID, channelId: CHANNEL_ID});
        expect(calls).toEqual([[CHANNEL_ID, USER_ID]]);
        expect(result).toEqual({localSelfDeaf: false, serverSelfDeaf: true, serverDeaf: false});
        expect(Object.keys(result)).toEqual(["localSelfDeaf", "serverSelfDeaf", "serverDeaf"]);
        expect(JSON.stringify(result)).not.toContain(USER_ID); expect(JSON.stringify(result)).not.toContain(CHANNEL_ID);
    });

    test("real false values remain false, while administrative server deafening remains independent", () => {
        const result = readSolcordOwnVoiceDeafenState({voiceStateStore: {getVoiceStateForChannel: () => ({...ownRecord(), selfDeaf: false, deaf: true})}, mediaEngineStore: {isSelfDeaf: () => false}, userId: USER_ID, channelId: CHANNEL_ID});
        expect(result).toEqual({localSelfDeaf: false, serverSelfDeaf: false, serverDeaf: true});
    });

    test("invalid or missing scope reads no host interface", () => {
        let reads = 0;
        const host = new Proxy({}, {get() {reads++; throw new Error("No scope");}});
        for (const [userId, channelId] of [[undefined, CHANNEL_ID], [USER_ID, undefined], ["wrong", CHANNEL_ID], [USER_ID, "0"], [123, CHANNEL_ID]]) {
            expect(readSolcordOwnVoiceDeafenState({voiceStateStore: host, mediaEngineStore: host, userId, channelId})).toEqual(unknown);
        }
        expect(reads).toBe(0);
    });

    test("mismatched user or channel records cannot report another participant or a previous call", () => {
        for (const record of [{...ownRecord(), userId: "333333333333333333"}, {...ownRecord(), channelId: "444444444444444444"}, {...ownRecord(), userId: undefined}, {...ownRecord(), channelId: null}]) {
            expect(readSolcordOwnVoiceDeafenState({voiceStateStore: {getVoiceStateForChannel: () => record}, mediaEngineStore: undefined, userId: USER_ID, channelId: CHANNEL_ID})).toEqual(unknown);
        }
    });

    test("method this binding is preserved and no unrelated store properties are read", () => {
        class Store {
            #record = ownRecord();
            getVoiceStateForChannel() {return this.#record;}
        }
        class Media {
            #deaf = false;
            isSelfDeaf() {return this.#deaf;}
        }
        const store = new Store(); const media = new Media();
        expect(readSolcordOwnVoiceDeafenState({voiceStateStore: store, mediaEngineStore: media, userId: USER_ID, channelId: CHANNEL_ID})).toEqual({localSelfDeaf: false, serverSelfDeaf: true, serverDeaf: false});
    });

    test("throwing and malformed getters remain unknown without coercion", () => {
        const local = {isSelfDeaf: () => false};
        const input = {userId: USER_ID, channelId: CHANNEL_ID};
        expect(readSolcordOwnVoiceDeafenState({...input, mediaEngineStore: local, voiceStateStore: {getVoiceStateForChannel() {throw new Error("host changed");}}})).toEqual({...unknown, localSelfDeaf: false});
        expect(readSolcordOwnVoiceDeafenState({...input, mediaEngineStore: {isSelfDeaf() {throw new Error("local changed");}}, voiceStateStore: {getVoiceStateForChannel: ownRecord}})).toEqual({...unknown, serverSelfDeaf: true, serverDeaf: false});
        expect(readSolcordOwnVoiceDeafenState({...input, mediaEngineStore: {isSelfDeaf: () => "false"}, voiceStateStore: {getVoiceStateForChannel: () => ({...ownRecord(), selfDeaf: 1, deaf: "false"})}})).toEqual(unknown);
        expect(readSolcordOwnVoiceDeafenState({...input, mediaEngineStore: undefined, voiceStateStore: undefined})).toEqual(unknown);
    });

    test("one unavailable boolean field does not hide the other observed field", () => {
        const record = {...ownRecord(), get selfDeaf(): boolean {throw new Error("field changed");}, deaf: true};
        expect(readSolcordOwnVoiceDeafenState({userId: USER_ID, channelId: CHANNEL_ID, mediaEngineStore: undefined, voiceStateStore: {getVoiceStateForChannel: () => record}})).toEqual({...unknown, serverDeaf: true});
    });
});
