import {describe, expect, test} from "bun:test";
import fs from "node:fs";
import vm from "node:vm";
import {transform} from "esbuild";

const compiled = Object.fromEntries(await Promise.all(["toasts", "notifications", "floatingwindows"].map(async name => [name,
    (await transform(fs.readFileSync(new URL(`../../src/betterdiscord/ui/${name}.tsx`, import.meta.url), "utf8"), {loader: "tsx", jsxFactory: "React.createElement", format: "cjs", target: "es2022"})).code
])));

function fixture(name: "toasts" | "notifications" | "floatingwindows") {
    const state = {rendererReady: false, spring: undefined as any, renderFails: false};
    let roots = 0; let unmounts = 0; let discoveries = 0;
    const containers: any[] = []; const rendered: any[] = [];
    const notifications: any[] = [];
    const notificationStore = {
        notifications,
        addNotification: (notification: unknown) => notifications.push(notification),
        removeNotification: (id: string) => {const index = notifications.findIndex(item => item.id === id); if (index >= 0) notifications.splice(index, 1);}
    };
    const toastStore = {toasts: [{key: 1, content: "fixture", type: "info", icon: false, timeout: 1000}]};
    const react = {
        Fragment: "fragment",
        createElement: (type: any, props: any, ...children: any[]) => ({type, props: {...props, children}}),
        useState: (value: unknown) => [value, () => {}],
Children: {map: (value: any, callback: any) => [value].map(callback)}
    };
    const deps: Record<string, unknown> = {
        "react": react,
        "@modules/discordmodules": {get ReactSpring() {discoveries++; return state.spring;}},
        "@modules/reactdom": {get createRoot() {
            if (!state.rendererReady) return undefined;
            return () => {roots++; return {render: (element: unknown) => {if (state.renderFails) throw new Error("fixture render failure"); rendered.push(element);}, unmount: () => {unmounts++;}};};
        }},
        "@modules/dommanager": {bdBody: {appendChild: (container: any) => containers.push(container), append: (container: any) => containers.push(container)}},
        "@stores/base": class Store {emitChange() {}},
        "@stores/toasts": toastStore,
        "@stores/notifications": notificationStore,
        "@stores/settings": {get: () => "top-right"},
        "@ui/hooks": {useStateFromStores: (_store: unknown, selector: () => unknown) => selector()},
        "@structs/markdown": {parseToReact: (text: string) => text},
        "clsx": (...args: string[]) => args.join(" ")
    };
    const module = {exports: {} as any};
    vm.runInNewContext(compiled[name], {module,
exports: module.exports,
React: react,
        document: {
            getElementById: (id: string) => containers.find(item => item.id === id),
            createElement: () => {const element = {id: "", remove: () => {const index = containers.indexOf(element); if (index >= 0) containers.splice(index, 1);}}; return element;}
        },
        require: (specifier: string) => deps[specifier] ?? {}
    });
    function available() {
        state.rendererReady = true;
        state.spring = {
            animated: {div: "animated-div"},
config: {stiff: {}},
useSpring: () => ({width: "50%"}),
            useTransition: (items: any[]) => (render: (style: object, item: unknown) => unknown) => items.map(item => render({}, item))
        };
    }
    return {ui: module.exports.default,
exports: module.exports,
state,
available,
containers,
rendered,
notifications,
        counts: () => ({roots, unmounts, discoveries})
    };
}

describe("optional notification UI startup boundaries", () => {
    test("toast imports do not snapshot missing Spring, and initialization can retry without duplicate roots", () => {
        const f = fixture("toasts"); expect(f.counts().discoveries).toBe(0);
        expect(f.ui.initialize()).toBe(false); expect(f.containers).toEqual([]);
        f.available(); expect(f.ui.initialize()).toBe(true); expect(f.ui.initialize()).toBe(true);
        expect(f.counts().roots).toBe(1); expect(() => f.exports.ToastContainer()).not.toThrow();
        expect(f.exports.Toast({content: "fixture", type: "info", icon: false, style: {}}).type).toBe("animated-div");
    });

    test("a synchronous toast render failure removes its owned container and remains retryable", () => {
        const f = fixture("toasts"); f.available(); f.state.renderFails = true;
        expect(() => f.ui.initialize()).toThrow("fixture render failure");
        expect(f.containers).toEqual([]); expect(f.counts().unmounts).toBe(1);
        f.state.renderFails = false; expect(f.ui.initialize()).toBe(true); expect(f.containers).toHaveLength(1);
    });

    test("notification import cannot call an unavailable ReactDOM adapter before Core starts", () => {
        const f = fixture("notifications");
        expect(f.counts()).toEqual({roots: 0, unmounts: 0, discoveries: 0});
        expect(f.containers).toEqual([]);
        expect(() => f.ui.show({id: "fixture", content: "fixture"})).toThrow("notification interface is unavailable");
        expect(f.notifications).toEqual([]);
        f.available(); const handle = f.ui.show({id: "fixture", content: "fixture"});
        expect(handle.isVisible()).toBe(true); expect(f.counts().roots).toBe(1);
        handle.close(); expect(handle.isVisible()).toBe(false);
    });

    test("a notification rendered after late Spring discovery uses the available animation API", () => {
        const f = fixture("notifications"); f.available(); f.ui.show({id: "fixture", title: "Fixture"});
        const container = f.rendered[0].type();
        const notification = container.props.children[0][0];
        const node = notification.type(notification.props);
        expect(node.type).toBe("animated-div"); expect(f.counts().roots).toBe(1);
    });

    test("floating window readiness is latched only after a successful mount and unavailable opens do not claim visibility", () => {
        const f = fixture("floatingwindows");
        expect(f.ui.initialize()).toBe(false);
        expect(() => f.ui.open({id: "fixture"})).toThrow("floating window interface is unavailable");
        expect(f.ui.isOpened("fixture")).toBe(false); expect(f.containers).toEqual([]);
        f.available(); f.state.renderFails = true;
        expect(() => f.ui.open({id: "fixture"})).toThrow("fixture render failure");
        expect(f.containers).toEqual([]); expect(f.counts().unmounts).toBe(1);
        f.state.renderFails = false; f.ui.open({id: "fixture"}); f.ui.open({id: "fixture"});
        expect(f.ui.isOpened("fixture")).toBe(true); expect(f.ui.windows).toHaveLength(1); expect(f.containers).toHaveLength(1);
    });
});
