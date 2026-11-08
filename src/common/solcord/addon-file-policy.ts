// SPDX-License-Identifier: Apache-2.0

export function safeAddonFileName(value: string, kind?: "plugin" | "theme"): string {
    if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9 _&().+—-]{0,180}\.(?:plugin\.js|theme\.css)$/.test(value)
        || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) throw new TypeError("Unsafe addon filename.");
    if (kind && !value.endsWith(kind === "plugin" ? ".plugin.js" : ".theme.css")) throw new TypeError("Addon filename has the wrong kind.");
    return value;
}
