import {afterEach, describe, expect, mock, test} from "bun:test";
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {waitForDiscordConnection} from "../../src/betterdiscord/modules/connection";
import {useStateFromStores} from "../../src/betterdiscord/ui/hooks";
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean;}).IS_REACT_ACT_ENVIRONMENT = true;

mock.module("@modules/dommanager", () => ({"default": {
    parseHTML(html: string) {const host = document.createElement("div"); host.innerHTML = html; return host.firstElementChild;},
    screenWidth: 1000,
screenHeight: 1000
}}));
const {default: Tooltip} = await import("../../src/betterdiscord/ui/tooltip");

const roots: Root[] = [];
afterEach(async () => {for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren();});

describe("renderer lifetime regressions", () => {
    test("connection discovery resolves late and removes the exact subscription", async () => {
        let available = false;
        let connected = false;
        const listeners = new Set<() => void>();
        const dispatcher = {subscribe(_event: string, listener: () => void) {listeners.add(listener);}, unsubscribe(_event: string, listener: () => void) {listeners.delete(listener);}};
        const ready = waitForDiscordConnection(() => connected, () => available ? dispatcher : undefined, 100, 2);
        available = true;
        await new Promise(resolve => setTimeout(resolve, 8));
        expect(listeners.size).toBe(1);
        connected = true;
        for (const listener of [...listeners]) {listener(); listener();}
        await ready;
        expect(listeners.size).toBe(0);
    });

    test("a missing connection fails within its deadline and can be retried", async () => {
        await expect(waitForDiscordConnection(() => undefined, () => undefined, 5, 1)).rejects.toThrow("deadline");
        await expect(waitForDiscordConnection(() => ({}), () => undefined, 5, 1)).resolves.toBeUndefined();
    });

    test("tooltips have no observers while hidden and dispose hover handlers", async () => {
        document.body.innerHTML = "<div id=\"app-mount\"><button id=\"anchor\">Hover</button></div>";
        const node = document.getElementById("anchor")!;
        const tooltip = Tooltip.create(node, "fixture");
        for (let cycle = 0; cycle < 50; cycle++) {
            node.dispatchEvent(new MouseEvent("mouseenter"));
            expect(tooltip.observer).toBeDefined();
            node.dispatchEvent(new MouseEvent("mouseleave"));
            expect(tooltip.observer).toBeUndefined();
        }
        tooltip.show();
        node.remove();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(tooltip.active).toBe(false);
        document.getElementById("app-mount")!.append(node);
        tooltip.show();
        expect(tooltip.observer).toBeDefined();
        tooltip.dispose(); tooltip.dispose();
        node.dispatchEvent(new MouseEvent("mouseenter"));
        expect(tooltip.element.isConnected).toBe(false);
        expect(tooltip.observer).toBeUndefined();
    });

    test("a reused tooltip keeps exactly one placement and measures once per show", () => {
        document.body.innerHTML = "<div id=\"app-mount\"><button id=\"anchor\">Hover</button></div>";
        const node = document.getElementById("anchor")!;
        let top = 100;
        let measures = 0;
        node.getBoundingClientRect = () => {measures++; return {top, left: 100, width: 10, height: 10} as DOMRect;};
        const tooltip = Tooltip.create(node, "fixture");
        tooltip.show();
        expect(tooltip.tooltipElement.classList.contains("bd-tooltip-top")).toBe(true);
        expect(measures).toBe(1);
        tooltip.hide(); top = -1; tooltip.show();
        expect([...tooltip.tooltipElement.classList].filter(name => /^bd-tooltip-(top|bottom|left|right)$/.test(name))).toEqual(["bd-tooltip-bottom"]);
        expect(measures).toBe(2);
        tooltip.dispose();
    });

    test("store hooks rebind A to B and refresh a selector prop without a store event", async () => {
        const store = () => ({value: 1, listeners: new Set<() => void>(), addChangeListener(listener: () => void) {this.listeners.add(listener);}, removeChangeListener(listener: () => void) {this.listeners.delete(listener);}});
        const a = store(); const b = store(); b.value = 4;
        const host = document.createElement("div"); document.body.append(host);
        const root = createRoot(host); roots.push(root);
        function Consumer({source, prefix}: {source: typeof a; prefix: string;}) {
            const value = useStateFromStores(source as never, () => `${prefix}:${source.value}`);
            return <output>{value}</output>;
        }
        await act(async () => root.render(<Consumer source={a} prefix="A" />));
        expect(a.listeners.size).toBe(1);
        await act(async () => root.render(<Consumer source={b} prefix="B" />));
        expect(a.listeners.size).toBe(0); expect(b.listeners.size).toBe(1);
        expect(host.textContent).toBe("B:4");
        await act(async () => {b.value = 8; for (const listener of b.listeners) listener();});
        expect(host.textContent).toBe("B:8");
        await act(async () => root.render(<Consumer source={b} prefix="new" />));
        expect(host.textContent).toBe("new:8");
        await act(async () => root.render(null));
        expect(b.listeners.size).toBe(0);
    });
});
