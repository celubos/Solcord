// SPDX-License-Identifier: Apache-2.0

export const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const SENSITIVE_HEADERS = new Set(["authorization", "cookie", "cookie2", "proxy-authorization", "host"]);
const BODY_HEADERS = new Set(["content-length", "content-type", "transfer-encoding"]);

export function redirectMethod(status: number, method: string): {method: string; keepBody: boolean;} {
    const upper = method.toUpperCase();
    if (status === 303 && upper !== "HEAD" || (status === 301 || status === 302) && upper === "POST") return {method: "GET", keepBody: false};
    return {method: upper, keepBody: true};
}

export function redirectHeaders<T>(headers: Record<string, T> | undefined, from: URL, to: URL, keepBody: boolean): Record<string, T> | undefined {
    if (!headers) return undefined;
    return Object.fromEntries(Object.entries(headers).filter(([name]) => {
        const normalized = name.toLowerCase();
        return !(from.origin !== to.origin && SENSITIVE_HEADERS.has(normalized)) && !(!keepBody && BODY_HEADERS.has(normalized));
    }));
}

export function redirectUrl(location: string, from: string): URL {
    const target = new URL(location, from);
    if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) throw new TypeError("Invalid redirect destination.");
    if (new URL(from).protocol === "https:" && target.protocol !== "https:") throw new TypeError("Refusing an insecure redirect.");
    return target;
}
