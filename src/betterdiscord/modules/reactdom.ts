import type ReactDOMBaseType from "react-dom";
import type ReactDOMClientType from "react-dom/client";
import {getByKeys} from "@webpack";

let base: typeof ReactDOMBaseType | undefined;
let client: typeof ReactDOMClientType | undefined;
function resolveModules() {
    if (!base) {
        const found = getByKeys<typeof ReactDOMBaseType>(["createPortal"], {firstId: 340287, cacheId: "core-reactdom-base"});
        if (typeof found?.createPortal === "function") base = found;
    }
    if (!client) {
        const found = getByKeys<typeof ReactDOMClientType>(["createRoot"], {firstId: 507240, cacheId: "core-reactdom-client"});
        if (typeof found?.createRoot === "function") client = found;
    }
}

// Discord may not have loaded both ReactDOM modules when this file is imported.
// Resolve on use and retain only valid modules; explicit consumer patches remain
// ordinary own properties on the proxy target.
const ReactDOM = new Proxy({} as typeof ReactDOMBaseType & typeof ReactDOMClientType, {
    get(target, key) {
        if (Object.hasOwn(target, key)) return Reflect.get(target, key);
        resolveModules();
        if (client && Object.hasOwn(client, key)) return Reflect.get(client, key);
        return base && Reflect.get(base, key);
    },
    set(target, key, value) {return Reflect.set(target, key, value, target);},
    ownKeys(target) {
        resolveModules();
        return [...new Set([...Reflect.ownKeys(target), ...Reflect.ownKeys(base ?? {}), ...Reflect.ownKeys(client ?? {})])];
    },
    getOwnPropertyDescriptor(target, key) {
        const own = Reflect.getOwnPropertyDescriptor(target, key);
        if (own) return own;
        resolveModules();
        if (!Object.hasOwn(base ?? {}, key) && !Object.hasOwn(client ?? {}, key)) return;
        return {enumerable: true, configurable: true, writable: true};
    }
});
export default ReactDOM;
