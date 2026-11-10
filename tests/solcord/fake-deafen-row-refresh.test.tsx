import {afterEach, describe, expect, mock, test} from "bun:test";
import React, {act, useSyncExternalStore} from "react";
import {createRoot, type Root} from "react-dom/client";
import {refreshSolcordFakeDeafenCurrentChannelRow} from "../../src/betterdiscord/modules/solcord/fake-deafen-row-refresh";
import {preserveSolcordOwnVoiceDeafenPresentation, type SolcordFakeDeafenPresentationContext} from "../../src/betterdiscord/modules/solcord/fake-deafen-presentation";

mock.module("@modules/discordmodules", () => ({"default": {}}));
mock.module("@webpack", () => ({getByKeys: () => undefined}));
mock.module("@common/logger", () => ({"default": {err: () => {throw Error("Unexpected patch error");}}}));
const {getInternalInstance} = await import("../../src/betterdiscord/utils/react");
const {default: Patcher} = await import("../../src/betterdiscord/modules/patcher");
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean;}).IS_REACT_ACT_ENVIRONMENT = true;
const USER = "111111111111111111", CHANNEL = "222222222222222222", OTHER_CHANNEL = "333333333333333333", SESSION = "controlled-session";
let root: Root | undefined;
const cleanup: Array<() => void> = [];
const afterUnmount: Array<() => void> = [];
const errors: unknown[] = [];
afterEach(async () => {
    cleanup.splice(0).forEach(dispose => dispose());
    if (root) await act(async () => root!.unmount()); root = undefined;
    afterUnmount.splice(0).forEach(check => check());
    expect(Patcher.getPatchesByCaller("Row refresh fixture")).toHaveLength(0);
    expect(errors).toEqual([]); errors.length = 0;
    document.body.replaceChildren();
});

class VoiceRecord {
    userId = USER; channelId = CHANNEL; sessionId = SESSION; selfMute = false; deaf = false;
    constructor(readonly selfDeaf: boolean) {}
    merge(values: object) {return Object.assign(new VoiceRecord(this.selfDeaf), this, values);}
    isVoiceDeafened() {return this.selfDeaf || this.deaf;}
}
function store<T>(initial: T) {
    let current = initial; const listeners = new Set<() => void>();
    return {
        read: () => current,
        subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
        set(value: T) {current = value; for (const listener of [...listeners]) listener();},
        get listeners() {return listeners.size;}
    };
}
async function mountNativeRows() {
    const host = document.createElement("div"); document.body.append(host);
    const received = store(new VoiceRecord(true)); const local = store(false);
    const context: SolcordFakeDeafenPresentationContext = {
        userId: USER,
        channelId: CHANNEL,
        sessionId: SESSION,
        status: {phase: "armed", armed: true, connected: true, accountBound: true, voice: {serverSelfDeaf: true}}
    };
    const native = {project(record: VoiceRecord, own: {sessionId: string; selfDeaf: boolean;}) {return record.sessionId === own.sessionId ? record.merge({selfDeaf: own.selfDeaf}) : record;}};
    let targetRenders = 0, otherRenders = 0;
    function NativeVoiceList({channel, voiceStates}: {channel: {id: string;}; voiceStates: VoiceRecord[];}) {
        const record = useSyncExternalStore(received.subscribe, received.read);
        const selfDeaf = useSyncExternalStore(local.subscribe, local.read);
        const projected = native.project(record, {sessionId: SESSION, selfDeaf});
        return <div data-own-deaf={String(projected.isVoiceDeafened())} data-channel={channel.id} data-record-count={voiceStates.length}>Own voice row</div>;
    }
    class NativeChannel extends React.Component<{channel: {id: string;}; voiceStates: VoiceRecord[];}> {
        renderVoiceUsers() {
            const {channel, voiceStates} = this.props;
            return <NativeVoiceList channel={channel} voiceStates={voiceStates} />;
        }
        render() {
            if (this.props.channel.id === CHANNEL) targetRenders++; else otherRenders++;
            return <section><button type="button" data-list-item-id={`channels___${this.props.channel.id}`}>Native channel</button>{this.renderVoiceUsers()}</section>;
        }
    }
    root = createRoot(host, {onUncaughtError: error => errors.push(error), onCaughtError: error => errors.push(error)});
    await act(async () => root!.render(<><NativeChannel channel={{id: CHANNEL}} voiceStates={[received.read()]} /><NativeChannel channel={{id: OTHER_CHANNEL}} voiceStates={[]} /></>));
    afterUnmount.push(() => {expect(received.listeners).toBe(0); expect(local.listeners).toBe(0);});
    const install = () => {
        const unpatch = Patcher.after("Row refresh fixture", native, "project", (_self, args, result) => preserveSolcordOwnVoiceDeafenPresentation(args[0], args[1], result, context), {forcePatch: false})!;
        cleanup.push(unpatch); return unpatch;
    };
    const refresh = (isCurrent = () => true) => refreshSolcordFakeDeafenCurrentChannelRow({root: host, channelId: CHANNEL, getInternalInstance, isCurrent});
    return {
        host,
        context,
        received,
        local,
        install,
        refresh,
        shown: () => host.querySelector(`[data-own-deaf][data-channel="${CHANNEL}"]`)?.getAttribute("data-own-deaf") === "true",
        targetRenders: () => targetRenders,
        otherRenders: () => otherRenders};
}

describe("scoped native Fake Deafen row refresh", () => {
    test("late presentation installation updates the actual React row without store or audio changes", async () => {
        const fixture = await mountNativeRows(); expect(fixture.shown()).toBe(false);
        fixture.install(); expect(fixture.shown()).toBe(false);
        const targetRenders = fixture.targetRenders(); const otherRenders = fixture.otherRenders();
        await act(async () => {expect(fixture.refresh()).toBe(true);});
        expect(fixture.shown()).toBe(true); expect(fixture.targetRenders()).toBe(targetRenders + 1);
        expect(fixture.otherRenders()).toBe(otherRenders);
        expect(fixture.local.read()).toBe(false); expect(fixture.received.read().selfDeaf).toBe(true);
    });

    test("an armed-only change and patch removal both update an already mounted row", async () => {
        const fixture = await mountNativeRows(); fixture.context.status.armed = false; const unpatch = fixture.install();
        await act(async () => {fixture.refresh();}); expect(fixture.shown()).toBe(false);
        fixture.context.status.armed = true;
        await act(async () => {fixture.refresh();}); expect(fixture.shown()).toBe(true);
        unpatch();
        await act(async () => {fixture.refresh();}); expect(fixture.shown()).toBe(false);
        expect(fixture.local.read()).toBe(false); expect(fixture.received.read().selfDeaf).toBe(true);
    });

    test("unknown received state stays native even when a refresh is requested", async () => {
        const fixture = await mountNativeRows(); fixture.install(); fixture.context.status.voice = undefined;
        await act(async () => {fixture.refresh();}); expect(fixture.shown()).toBe(false);
        expect(fixture.local.read()).toBe(false);
    });

    test("invalid or stale scopes perform no DOM lookup, and the lookup targets only the exact current channel", async () => {
        const fixture = await mountNativeRows(); let queries = 0; const selectors: string[] = [];
        const query = fixture.host.querySelector.bind(fixture.host);
        fixture.host.querySelector = ((selector: string) => {queries++; selectors.push(selector); return query(selector);}) as typeof fixture.host.querySelector;
        expect(fixture.refresh(() => false)).toBe(false); expect(queries).toBe(0);
        for (const channelId of [undefined, "invalid", "123\"] *", 12]) expect(refreshSolcordFakeDeafenCurrentChannelRow({root: fixture.host, channelId, getInternalInstance, isCurrent: () => true})).toBe(false);
        expect(queries).toBe(0);
        await act(async () => {fixture.refresh();});
        expect(selectors).toEqual([`[data-list-item-id="channels___${CHANNEL}"]`]);
    });

    test("the lease and anchor are revalidated after reading a native owner", async () => {
        const fixture = await mountNativeRows(); let current = true; const renders = fixture.targetRenders();
        const options = {root: fixture.host, channelId: CHANNEL, getInternalInstance: (element: Element) => {const fiber = getInternalInstance(element); current = false; return fiber;}, isCurrent: () => current};
        expect(refreshSolcordFakeDeafenCurrentChannelRow(options)).toBe(false); expect(fixture.targetRenders()).toBe(renders);
        current = true;
        expect(refreshSolcordFakeDeafenCurrentChannelRow({...options, getInternalInstance: element => {const fiber = getInternalInstance(element); element.remove(); return fiber;}})).toBe(false);
        expect(fixture.targetRenders()).toBe(renders);
    });

    test("owner traversal is bounded, cyclic-safe, and rejects a different channel or non-native class shape", () => {
        const host = document.createElement("div"); host.innerHTML = `<button data-list-item-id="channels___${CHANNEL}"></button>`; document.body.append(host);
        let updates = 0;
        const owner = {isReactComponent: {}, props: {channel: {id: OTHER_CHANNEL}}, forceUpdate() {updates++;}, renderVoiceUsers() {return this.props;}};
        const options = {root: host, channelId: CHANNEL, isCurrent: () => true};
        expect(refreshSolcordFakeDeafenCurrentChannelRow({...options, getInternalInstance: () => ({stateNode: owner})})).toBe(false);
        owner.props.channel.id = CHANNEL;
        expect(refreshSolcordFakeDeafenCurrentChannelRow({...options, getInternalInstance: () => ({stateNode: owner})})).toBe(false);
        const cyclic: {return?: unknown;} = {}; cyclic.return = cyclic;
        expect(refreshSolcordFakeDeafenCurrentChannelRow({...options, getInternalInstance: () => cyclic})).toBe(false);
        let reads = 0;
        // Each owner has a unique identity, so the depth cap, not cycle detection, stops it.
        const fresh = (): unknown => ({get "return"() {reads++; return fresh();}});
        expect(refreshSolcordFakeDeafenCurrentChannelRow({...options, getInternalInstance: fresh})).toBe(false);
        expect(reads).toBe(32); expect(updates).toBe(0);
    });

    test("throwing adapters and reentrant refreshes fail closed without leaving the helper locked", async () => {
        const fixture = await mountNativeRows();
        expect(refreshSolcordFakeDeafenCurrentChannelRow({root: fixture.host, channelId: CHANNEL, getInternalInstance: () => {throw Error("host changed");}, isCurrent: () => true})).toBe(false);
        expect(fixture.refresh(() => {throw Error("scope changed");})).toBe(false);
        let nested: boolean | undefined;
        await act(async () => {
            expect(refreshSolcordFakeDeafenCurrentChannelRow({root: fixture.host, channelId: CHANNEL, getInternalInstance: element => {nested = fixture.refresh(); return getInternalInstance(element);}, isCurrent: () => true})).toBe(true);
        });
        expect(nested).toBe(false);
        await act(async () => {expect(fixture.refresh()).toBe(true);});
    });
});
