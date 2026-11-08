// SPDX-License-Identifier: Apache-2.0

import {app, protocol, net} from "electron";
import path from "node:path";
import {pathToFileURL} from "url";

export function resolveLocalAsset(url: string, root: string): string | null {
    const request = new URL(url);
    if (request.protocol !== "solcord:" || request.username || request.password || request.port || request.search) return null;
    if (request.hostname === "catalog" && request.pathname === "/index.json") return path.join(root, "catalog", "index.json");
    if (request.hostname === "fonts" && request.pathname === "/HankenGrotesk-variable.ttf") return path.join(root, "fonts", "HankenGrotesk-variable.ttf");
    if (request.hostname !== "editor" || !request.pathname.startsWith("/monaco/vs/")) return null;
    const segments = request.pathname.slice(1).split("/").map(segment => decodeURIComponent(segment));
    if (segments.some(segment => !segment || segment === "." || segment === ".." || /[\\/:\0]/.test(segment))) return null;
    return path.join(root, "editor", ...segments);
}

export function registerSolcordLocalAssets(): void {
    protocol.registerSchemesAsPrivileged([{scheme: "solcord", privileges: {standard: true, secure: true, supportFetchAPI: true, corsEnabled: true}}]);
    void app.whenReady().then(() => protocol.handle("solcord", async request => {
        try {
            const target = resolveLocalAsset(request.url, __dirname);
            if (target) {
                const response = await net.fetch(pathToFileURL(target).href);
                const headers = new Headers(response.headers);
                // These are public packaged assets, never user files or credentials.
                headers.set("Access-Control-Allow-Origin", "*");
                headers.set("Cache-Control", "no-store");
                return new Response(response.body, {status: response.status, headers});
            }
        }
        catch {/* Malformed escapes are not an asset request. */}
        return new Response("Not found", {status: 404});
    }));
}
