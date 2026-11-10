import electron from "electron";
import {setSolcordResponseAmender} from "./web-request-policy";

const TRUSTED_DOCUMENTS = new Set(["discord.com", "ptb.discord.com", "canary.discord.com"]);
export function localAssetCsp(policy: string): string {
    const directives = policy.split(";").map(part => part.trim().split(/\s+/)).filter(parts => parts[0]);
    const get = (name: string) => directives.find(parts => parts[0].toLowerCase() === name);
    // Keep the existing policy and extend only the directives used by packaged assets.
    for (const name of ["script-src", "script-src-elem", "style-src", "style-src-elem", "font-src", "worker-src", "connect-src"]) {
        let directive = get(name);
        if (!directive) {
            const fallback = (name.endsWith("-elem") ? get(name.slice(0, -5)) : undefined) ?? (name === "worker-src" ? get("child-src") ?? get("script-src") : undefined) ?? get("default-src");
            if (!fallback) continue; // An absent policy directive is already unrestricted.
            directive = [name, ...fallback.slice(1)];
            directives.push(directive);
        }
        if (!directive.includes("solcord:")) {
            if (directive.includes("'none'")) directive.splice(1, directive.length - 1);
            directive.push("solcord:");
        }
        if (name === "worker-src" && !directive.includes("blob:")) directive.push("blob:");
    }
    return directives.map(parts => parts.join(" ")).join("; ");
}

export default class {
    static async remove() {
        await electron.app.whenReady();
        setSolcordResponseAmender(electron.session.defaultSession, {urls: ["https://discord.com/*", "https://ptb.discord.com/*", "https://canary.discord.com/*"]}, (details, currentHeaders) => {
            const url = new URL(details.url);
            if (details.resourceType !== "mainFrame" || !TRUSTED_DOCUMENTS.has(url.hostname) || url.port || !/^\/(?:app|channels(?:\/|$)|login(?:\/|$))/.test(url.pathname) || !currentHeaders) return;
            const headers = {...currentHeaders};
            for (const [key, values] of Object.entries(headers)) {
                if (key.toLowerCase() === "content-security-policy") headers[key] = Array.isArray(values) ? values.map(localAssetCsp) : localAssetCsp(values);
            }
            return headers;
        });
    }
}
