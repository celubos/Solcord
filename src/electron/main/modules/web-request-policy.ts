// SPDX-License-Identifier: Apache-2.0

import type {Session} from "electron";

type Filter = Electron.WebRequestFilter;
type BeforeDetails = Electron.OnBeforeRequestListenerDetails;
type BeforeResponse = Electron.CallbackResponse;
type HeadersDetails = Electron.OnHeadersReceivedListenerDetails;
type HeadersResponse = Electron.HeadersReceivedResponse;
type Headers = NonNullable<HeadersResponse["responseHeaders"]>;
type Listener<D, R> = (details: D, callback: (response: R) => void) => void;
type BeforeListener = Listener<BeforeDetails, BeforeResponse>;
type HeadersListener = Listener<HeadersDetails, HeadersResponse>;
type Registration<D, R> = {filter?: Filter; matches: (details: D) => boolean; listener: Listener<D, R>;};
type MatchDetails = {url: string; resourceType?: string;};

const owners = new WeakMap<Session, SessionWebRequestPolicy>();
const escapePattern = (value: string) => value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

/** Chromium match patterns: wildcard scheme is HTTP(S), omitted port is any port. */
export function webRequestUrlMatches(pattern: string, value: string): boolean {
    let url: URL;
    try {url = new URL(value);}
    catch {return false;}
    if (pattern === "<all_urls>") return true; // Chromium also filters the native registration.
    const parsed = pattern.match(/^(\*|[a-z][a-z0-9+.-]*):\/\/([^/]*)(\/.*)$/i);
    if (!parsed) throw new TypeError("Invalid webRequest URL pattern.");
    const [, rawScheme, authority, pathname] = parsed;
    const scheme = rawScheme.toLowerCase();
    if (scheme === "*" ? url.protocol !== "http:" && url.protocol !== "https:" : url.protocol !== `${scheme}:`) return false;
    const hostPort = authority.match(/^(\[[^\]]+\]|[^:]*)(?::(\*|\d+))?$/);
    if (!hostPort) throw new TypeError("Invalid webRequest host pattern.");
    const [, rawHost, port] = hostPort;
    if (port && port !== "*") {
        const effectivePort = url.port || ({"http:": "80", "https:": "443", "ws:": "80", "wss:": "443", "ftp:": "21"} as Record<string, string>)[url.protocol];
        if (String(Number(port)) !== effectivePort) return false;
    }
    const host = rawHost.toLowerCase();
    if (host !== "*") {
        const wildcard = host.startsWith("*.");
        const suffix = wildcard ? host.slice(2) : host;
        if (suffix.includes("*")) throw new TypeError("Invalid webRequest wildcard host.");
        const canonical = suffix ? new URL(`http://${suffix}`).hostname : "";
        if (wildcard ? url.hostname !== canonical && !url.hostname.endsWith(`.${canonical}`) : url.hostname !== canonical) return false;
    }
    return new RegExp(`^${pathname.split("*").map(escapePattern).join(".*")}$`).test(`${url.pathname}${url.search}`);
}

export function webRequestFilterMatches(filter: Filter | undefined, details: MatchDetails): boolean {
    if (!filter) return true;
    return filter.urls.some(pattern => webRequestUrlMatches(pattern, details.url))
        && !filter.excludeUrls?.some(pattern => webRequestUrlMatches(pattern, details.url))
        && (!filter.types || filter.types.some(type => type === details.resourceType));
}

function snapshotFilter(filter: Filter | undefined): Filter | undefined {
    if (!filter) return;
    if (!Array.isArray(filter.urls) || filter.urls.some(value => typeof value !== "string")) throw new TypeError("Invalid webRequest filter.");
    return {urls: [...filter.urls], ...(filter.excludeUrls ? {excludeUrls: [...filter.excludeUrls]} : {}), ...(filter.types ? {types: [...filter.types]} : {})};
}

function registration<D extends MatchDetails, R>(first: Filter | Listener<D, R> | null, second?: Listener<D, R> | null): Registration<D, R> | undefined {
    const listener = typeof first === "function" || first === null ? first : second;
    if (listener === null) return;
    if (typeof listener !== "function") throw new TypeError("A webRequest listener or null is required.");
    const filter = snapshotFilter(typeof first === "function" ? undefined : first ?? undefined);
    return {filter, listener, matches: details => webRequestFilterMatches(filter, details)};
}

class SessionWebRequestPolicy {
    #hostBefore?: Registration<BeforeDetails, BeforeResponse>;
    #hostHeaders?: Registration<HeadersDetails, HeadersResponse>;
    #blocker?: {filter: Filter; blocks: (details: BeforeDetails) => boolean;};
    #amender?: {filter: Filter; amend: (details: HeadersDetails, headers: Headers | undefined) => Headers | undefined;};
    readonly #webRequest: Session["webRequest"];
    readonly #originalBefore: Session["webRequest"]["onBeforeRequest"];
    readonly #originalHeaders: Session["webRequest"]["onHeadersReceived"];

    constructor(session: Session) {
        this.#webRequest = session.webRequest;
        this.#originalBefore = this.#webRequest.onBeforeRequest;
        this.#originalHeaders = this.#webRequest.onHeadersReceived;
        if (typeof this.#originalBefore !== "function" || typeof this.#originalHeaders !== "function") throw new TypeError("Both webRequest policy hooks are required.");
        this.#webRequest.onBeforeRequest = ((first: Filter | BeforeListener | null, second?: BeforeListener | null) => {
            const previous = this.#hostBefore;
            this.#hostBefore = registration(first, second);
            try {this.#refreshBefore();}
            catch (error) {this.#hostBefore = previous; this.#refreshBefore(); throw error;}
        }) as Session["webRequest"]["onBeforeRequest"];
        this.#webRequest.onHeadersReceived = ((first: Filter | HeadersListener | null, second?: HeadersListener | null) => {
            const previous = this.#hostHeaders;
            this.#hostHeaders = registration(first, second);
            try {this.#refreshHeaders();}
            catch (error) {this.#hostHeaders = previous; this.#refreshHeaders(); throw error;}
        }) as Session["webRequest"]["onHeadersReceived"];
    }

    block(filter: Filter, blocks: (details: BeforeDetails) => boolean): void {
        this.#blocker = {filter: snapshotFilter(filter)!, blocks};
        this.#refreshBefore();
    }

    amend(filter: Filter, amend: (details: HeadersDetails, headers: Headers | undefined) => Headers | undefined): void {
        this.#amender = {filter: snapshotFilter(filter)!, amend};
        this.#refreshHeaders();
    }

    #refreshBefore(): void {
        const urls = this.#patterns(this.#hostBefore?.filter, Boolean(this.#hostBefore), this.#blocker?.filter);
        if (!urls.length) {Reflect.apply(this.#originalBefore, this.#webRequest, [null]); return;}
        Reflect.apply(this.#originalBefore, this.#webRequest, [{urls}, (details: BeforeDetails, callback: (response: BeforeResponse) => void) => {
            if (this.#blocker && webRequestFilterMatches(this.#blocker.filter, details) && this.#blocker.blocks(details)) return callback({cancel: true});
            const host = this.#hostBefore;
            if (!host?.matches(details)) return callback({});
            let finished = false;
            host.listener(details, response => {if (!finished) {finished = true; callback(response);}});
        }]);
    }

    #refreshHeaders(): void {
        const urls = this.#patterns(this.#hostHeaders?.filter, Boolean(this.#hostHeaders), this.#amender?.filter);
        if (!urls.length) {Reflect.apply(this.#originalHeaders, this.#webRequest, [null]); return;}
        Reflect.apply(this.#originalHeaders, this.#webRequest, [{urls}, (details: HeadersDetails, callback: (response: HeadersResponse) => void) => {
            let finished = false;
            const complete = (response: HeadersResponse) => {
                if (finished) return;
                finished = true;
                if (response.cancel === true) return callback(response);
                const headers = this.#amender && webRequestFilterMatches(this.#amender.filter, details)
                    ? this.#amender.amend(details, response.responseHeaders ?? details.responseHeaders) : undefined;
                callback(headers ? {...response, responseHeaders: headers} : response);
            };
            const host = this.#hostHeaders;
            if (host?.matches(details)) host.listener(details, complete);
            else complete({});
        }]);
    }

    #patterns(filter: Filter | undefined, hasHost: boolean, policy?: Filter): string[] {
        return [...new Set([...(hasHost ? filter?.urls ?? ["<all_urls>"] : []), ...(policy?.urls ?? [])])];
    }
}

/** Install before the host registers its first callbacks; main/index.ts owns early setup. */
export function installSessionWebRequestPolicy(session: Session): SessionWebRequestPolicy {
    let owner = owners.get(session);
    if (!owner) {owner = new SessionWebRequestPolicy(session); owners.set(session, owner);}
    return owner;
}

export function setSolcordRequestBlocker(session: Session, filter: Filter, blocks: (details: BeforeDetails) => boolean): void {
    installSessionWebRequestPolicy(session).block(filter, blocks);
}

export function setSolcordResponseAmender(session: Session, filter: Filter, amend: (details: HeadersDetails, headers: Headers | undefined) => Headers | undefined): void {
    installSessionWebRequestPolicy(session).amend(filter, amend);
}
