// SPDX-License-Identifier: Apache-2.0

import {afterEach, describe, expect, mock, test} from "bun:test";
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {flushSync} from "react-dom";
import {EventEmitter} from "node:events";
import {modalMethodFixture, settingsMethodFixture} from "../fixtures/solcord-method-fixture";

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean;}).IS_REACT_ACT_ENVIRONMENT = true;
const events = new EventEmitter();
mock.module("@modules/emitter", () => ({"default": events}));
mock.module("@modules/discordmodules", () => ({"default": {}}));
mock.module("@modules/ipc", () => ({"default": {}}));
mock.module("@common/logger", () => ({"default": {warn() {}, stacktrace() {}}}));
mock.module("@webpack", () => ({getWithKey: () => [], getModule: () => undefined, getByKeys: () => undefined}));
const {default: ModalRoot} = await import("../../src/betterdiscord/ui/modals/root");
const {default: ModalStack, generateKey} = await import("../../src/betterdiscord/ui/modals/stack");
const {default: ErrorBoundary} = await import("../../src/betterdiscord/ui/errorboundary");
let root: Root | undefined;
afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = undefined; document.body.replaceChildren();
    expect(events.listenerCount("open-modal")).toBe(0); expect(events.listenerCount("close-modal")).toBe(0);
});

function fixture() {
    let rendererUnavailable = false;
    const modalOwner: any = {ModalActions: undefined, hasInitialized: false, stackReady: false, pendingModals: []};
    const makeStack = modalMethodFixture("makeStack", {
        React,
ReactDOM: {flushSync, createRoot: (host: HTMLElement) => {if (rendererUnavailable) throw Error("renderer-not-ready"); return (root = createRoot(host));}},
Events: events,
ModalStack,
ErrorBoundary,
queueMicrotask,
        DOMManager: {bdBody: document.body, parseHTML() {const host = document.createElement("div"); host.id = "bd-modal-container"; return host;}}
    });
    modalOwner.makeStack = () => makeStack.call(modalOwner);
    const open = modalMethodFixture("openModal", {generateKey, Events: events});
    const panels: any[] = [{id: "solcord", element: () => <main aria-label="Solcord Control Center"><h1>Solcord</h1><input aria-label="Filter Solcord settings" /><button>Privacy</button></main>}];
    let opens = 0; let closes = 0; const failures: string[] = [];
    const owner: any = {controlCenterModal: undefined, closeUserSettingsModal() {closes++;}};
    const show = settingsMethodFixture("openControlCenter", {
        React,
ModalRoot,
ErrorBoundary,
Settings: {panels},
        Modals: {openModal(render: unknown, options: unknown) {opens++; return open.call(modalOwner, render, options);}},
        toasts: {error: (message: string) => failures.push(message)}
    });
    owner.openControlCenter = () => show.call(owner);
    const navigate = settingsMethodFixture("openSettingsPage", {getUserSettings: () => {throw Error("must-not-depend-on-native-navigation");}});
    return {owner, panels, modalOwner, failures, setUnavailable(value: boolean) {rendererUnavailable = value;}, opens: () => opens, closes: () => closes, navigate: () => navigate.call(owner, "solcord")};
}

describe("owned settings entry with unavailable native layout and optional modal modules", () => {
    test("opens real modal content once, traps focus, closes, and reopens after the native layout is unavailable", async () => {
        const before = document.createElement("button"); before.textContent = "Open Solcord Suite"; document.body.append(before); before.focus();
        const f = fixture();
        await act(async () => {expect(f.navigate()).toBe(true);});
        expect(document.querySelector("[role=\"dialog\"]")).not.toBeNull();
        expect(document.querySelector("[aria-label=\"Solcord Control Center\"]")?.textContent).toContain("Solcord");
        expect(document.activeElement?.getAttribute("aria-label")).toBe("Close Solcord settings");
        await act(async () => {expect(f.navigate()).toBe(true);});
        expect(f.opens()).toBe(1); expect(f.closes()).toBe(0);
        await act(async () => {document.querySelector<HTMLButtonElement>("[aria-label=\"Close Solcord settings\"]")!.click();});
        expect(document.querySelector("[aria-label=\"Solcord Control Center\"]")).toBeNull();
        expect(f.owner.controlCenterModal).toBeUndefined(); expect(document.activeElement).toBe(before);
        await act(async () => {expect(f.navigate()).toBe(true);});
        expect(f.opens()).toBe(2); expect(f.failures).toEqual([]);
        await act(async () => {document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));});
        expect(document.querySelector("[aria-label=\"Solcord Control Center\"]")).toBeNull(); expect(f.owner.controlCenterModal).toBeUndefined();
    });

    test("missing registration reports unavailable without inventing a rendered settings page", () => {
        const f = fixture(); f.panels.splice(0);
        expect(f.navigate()).toBe(false); expect(f.opens()).toBe(0); expect(document.querySelector("[role=\"dialog\"]")).toBeNull();
    });

    test("a modal mount failure clears the entry owner and permits a later successful retry", async () => {
        const f = fixture(); f.setUnavailable(true);
        expect(f.navigate()).toBe(false); expect(f.owner.controlCenterModal).toBeUndefined(); expect(f.failures).toHaveLength(1);
        expect(document.querySelector("[aria-label=\"Solcord Control Center\"]")).toBeNull();
        expect(f.modalOwner.pendingModals).toHaveLength(0);
        f.setUnavailable(false);
        await act(async () => {expect(f.navigate()).toBe(true);});
        expect(document.querySelector("[aria-label=\"Solcord Control Center\"]")).not.toBeNull(); expect(f.opens()).toBe(2);
    });
});
