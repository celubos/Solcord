import {afterEach, describe, expect, mock, test} from "bun:test";
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {flushSync} from "react-dom";
import {EventEmitter} from "node:events";
import {modalMethodFixture} from "../fixtures/solcord-method-fixture";

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean;}).IS_REACT_ACT_ENVIRONMENT = true;
const events = new EventEmitter();
const modules: {ReactSpring?: any; AccessibilityContext?: React.Context<any>;} = {};
mock.module("@modules/emitter", () => ({"default": events}));
mock.module("@modules/discordmodules", () => ({"default": modules}));
mock.module("@webpack", () => ({getWithKey: () => [], getModule: () => undefined, getByKeys: () => undefined}));
const {default: ModalStack} = await import("../../src/betterdiscord/ui/modals/stack");
const {default: ModalRoot} = await import("../../src/betterdiscord/ui/modals/root");
let root: Root | undefined;
afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = undefined;
    document.body.replaceChildren();
    modules.ReactSpring = undefined;
    modules.AccessibilityContext = undefined;
    expect(events.listenerCount("open-modal")).toBe(0);
    expect(events.listenerCount("close-modal")).toBe(0);
});

async function mount(onReady?: () => void) {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<ModalStack onReady={onReady} />));
    return host;
}

function renderDialog({onClose}: any = {}) {
    return <ModalRoot><h2>Recover setup</h2><input aria-label="Draft" defaultValue="saved" /><button onClick={onClose}>Close</button></ModalRoot>;
}

describe("production modal optional readiness", () => {
    test("retries native actions after an empty lookup and caches only complete actions", () => {
        let found: unknown = {};
        let lookups = 0;
        const getter = modalMethodFixture("ModalActions", {getMangled: () => {lookups++; return found;}, Filters: {byStrings: () => () => true}});
        const owner = {_ModalActions: undefined};
        expect(getter.call(owner)).toBeUndefined();
        found = {openModal: () => 1};
        expect(getter.call(owner)).toBeUndefined();
        const complete = {openModal: () => 1, closeModal() {}, closeAllModals() {}};
        found = complete;
        expect(getter.call(owner)).toBe(complete);
        found = {};
        expect(getter.call(owner)).toBe(complete);
        expect(lookups).toBe(3);
    });

    test("native-only confirmation reports unavailable until native actions exist", () => {
        const native = modalMethodFixture("showNativeConfirmationModal", {t: () => "", Root: {Sizes: {SMALL: "small"}}});
        let rawFallback = false;
        expect(native.call({"ModalActions": undefined, "default": () => {rawFallback = true;}}, "Confirm", "External link")).toBeUndefined();
        expect(rawFallback).toBeFalse();
    });

    test("queues initial local opens until the real stack subscription is ready", async () => {
        const owner: any = {ModalActions: undefined, hasInitialized: false, stackReady: false, pendingModals: [], makeStack() {this.hasInitialized = true;}};
        let key = 0;
        const open = modalMethodFixture("openModal", {generateKey: () => ++key, Events: events});
        open.call(owner, renderDialog, {});
        open.call(owner, () => <ModalRoot>Second setup</ModalRoot>, {});
        expect(owner.pendingModals).toHaveLength(2);
        const host = await mount(() => {
            owner.stackReady = true;
            for (const pending of owner.pendingModals.splice(0)) events.emit("open-modal", pending.render, pending.options);
        });
        expect(host.textContent).toContain("Second setup");
        await act(async () => {events.emit("close-modal", 2);});
        expect(host.textContent).toContain("Recover setup");
        expect(owner.pendingModals).toHaveLength(0);
    });

    test("mounts and subscribes the initial production stack synchronously", async () => {
        const owner: any = {hasInitialized: false, stackReady: false, pendingModals: [{render: renderDialog, options: {modalKey: "initial"}}]};
        const make = modalMethodFixture("makeStack", {
            React,
ReactDOM: {flushSync, createRoot: (div: HTMLElement) => (root = createRoot(div))},
Events: events,
ModalStack,
            DOMManager: {parseHTML: () => {const div = document.createElement("div"); div.id = "bd-modal-container"; return div;}, bdBody: document.body},
            ErrorBoundary: ({children}: React.PropsWithChildren) => children,
            queueMicrotask
        });
        await act(async () => {make.call(owner);});
        expect(owner.hasInitialized).toBeTrue();
        expect(owner.stackReady).toBeTrue();
        expect(owner.pendingModals).toHaveLength(0);
        expect(document.body.textContent).toContain("Recover setup");
    });

    test("a missing or throwing local renderer clears pending work and allows a later retry", () => {
        for (const ReactDOM of [{}, {flushSync, createRoot: () => {throw Error("root failed");}}]) {
            const owner = {hasInitialized: false, stackReady: false, pendingModals: [{render: renderDialog, options: {modalKey: "initial"}}]};
            const make = modalMethodFixture("makeStack", {
                React,
ReactDOM,
Events: events,
ModalStack,
                DOMManager: {parseHTML: () => {const div = document.createElement("div"); div.id = "bd-modal-container"; return div;}, bdBody: document.body},
                ErrorBoundary: ({children}: React.PropsWithChildren) => children,
                queueMicrotask
            });
            expect(() => make.call(owner)).toThrow();
            expect(owner.hasInitialized).toBeFalse();
            expect(owner.stackReady).toBeFalse();
            expect(owner.pendingModals).toHaveLength(0);
            expect(document.querySelector("#bd-modal-container")).toBeNull();
        }
    });

    test("renders recovery with no native transitions, springs, easing or accessibility context", async () => {
        const prior = document.createElement("button");
        prior.textContent = "Discord";
        document.body.append(prior);
        prior.focus();
        const host = await mount();
        let closes = 0;
        await act(async () => {events.emit("open-modal", renderDialog, {modalKey: "recovery", onClose: () => closes++});});
        expect(host.textContent).toContain("Recover setup");
        expect(host.querySelector<HTMLElement>(".bd-modal-root")?.style.opacity).toBe("1");
        const input = host.querySelector("input")!;
        const button = host.querySelector("button")!;
        expect(document.activeElement).toBe(input);
        button.focus();
        const tab = new KeyboardEvent("keydown", {key: "Tab", bubbles: true, cancelable: true});
        button.dispatchEvent(tab);
        expect(tab.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(input);
        prior.focus();
        expect(document.activeElement).toBe(input);
        await act(async () => {document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));});
        expect(host.textContent).not.toContain("Recover setup");
        expect(document.activeElement).toBe(prior);
        expect(closes).toBe(1);
        await act(async () => {events.emit("close-modal", "recovery");});
        expect(closes).toBe(1);
    });

    test("late spring availability preserves the mounted form and closes via backdrop", async () => {
        const host = await mount();
        await act(async () => {events.emit("open-modal", renderDialog, {modalKey: "first"});});
        const input = host.querySelector("input")!;
        input.value = "unsaved draft";
        let springCalls = 0;
        modules.ReactSpring = {animated: {div: "div"}, useSpring: () => {springCalls++; return {};}, useTransition: (visible: boolean) => (render: (styles: unknown, visible: boolean) => unknown) => render({}, visible)};
        await act(async () => {root!.render(<ModalStack />);});
        expect(host.querySelector("input")).toBe(input);
        expect(input.value).toBe("unsaved draft");
        expect(springCalls).toBe(0);
        await act(async () => {events.emit("open-modal", renderDialog, {modalKey: "second"});});
        expect(springCalls).toBeGreaterThan(0);
        await act(async () => {events.emit("close-modal", "second");});
        // The stack deliberately remounts a covered dialog; each visible instance
        // fixes its optional renderer so late modules cannot interrupt typing.
        const current = host.querySelector("input")!;
        current.value = "current draft";
        await act(async () => {root!.render(<ModalStack />);});
        expect(host.querySelector("input")).toBe(current);
        expect(current.value).toBe("current draft");
        await act(async () => {host.querySelector<HTMLElement>(".bd-modal-backdrop")!.click();});
        expect(host.querySelector(".bd-modal-root")).toBeNull();
    });

    test("repeated fallback lifecycle closes each callback once without accumulating listeners", async () => {
        const host = await mount();
        let closed = 0;
        for (let i = 0; i < 30; i++) {
            await act(async () => {events.emit("open-modal", renderDialog, {modalKey: String(i), onClose: () => closed++});});
            await act(async () => {host.querySelector<HTMLButtonElement>("button")!.click();});
        }
        expect(closed).toBe(30);
        expect(events.listenerCount("open-modal")).toBe(1);
        expect(events.listenerCount("close-modal")).toBe(1);
    });
});
