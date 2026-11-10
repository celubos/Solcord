// SPDX-License-Identifier: Apache-2.0

import {describe, expect, test} from "bun:test";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

import {parseJsDoc} from "../../src/common/utils";
import {SOLCORD_RUNTIME_THEMES} from "../../src/common/solcord/addon-catalog.generated";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../..");
const THEME_FILES = [
    "Solcord-Default.theme.css",
    "Solcord-ObsidianThread.theme.css",
    "Solcord-CarbonEmber.theme.css",
    "Solcord-MidnightGlass.theme.css",
    "Solcord-PaperSignal.theme.css"
] as const;
const SOLCORD_UI_CSS = readFileSync(resolve(REPOSITORY_ROOT, "src/betterdiscord/styles/solcord.css"), "utf8");

function readTheme(fileName: string): string {
    return readFileSync(resolve(REPOSITORY_ROOT, "assets/themes", fileName), "utf8");
}

function executableCss(css: string): string {
    return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function customProperty(css: string, name: string, seen = new Set<string>()): string {
    if (seen.has(name)) throw new Error(`Circular custom property: ${name}`);
    seen.add(name);
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = [...css.matchAll(new RegExp(`${escaped}\\s*:\\s*([^;]+);`, "g"))];
    const value = matches.at(-1)?.[1].trim();
    if (!value) throw new Error(`Missing custom property: ${name}`);
    const reference = value.match(/^var\((--[a-z0-9-]+)\)$/i)?.[1];
    return reference ? customProperty(css, reference, seen) : value;
}

function luminance(hex: string): number {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Expected a six-digit color, received ${hex}`);
    const channels = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
        .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(first: string, second: string): number {
    const a = luminance(first);
    const b = luminance(second);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function ruleProperty(css: string, selector: string, name: string): string {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const block = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]+)}`, "s"))?.[1];
    if (!block) throw new Error(`Missing rule: ${selector}`);
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const value = block.match(new RegExp(`${escapedName}\\s*:\\s*([^;]+);`))?.[1].trim();
    if (!value) throw new Error(`Missing ${name} in ${selector}`);
    return value;
}

describe("Solcord theme presentation", () => {
    test("starts with BetterDiscord-readable metadata", () => {
        for (const fileName of THEME_FILES) {
            const source = readTheme(fileName);
            const firstLine = source.slice(0, source.indexOf("\n"));
            expect(firstLine).toContain("/**");
            const metadata = parseJsDoc(source);
            expect(metadata.name).toStartWith("Solcord");
            expect(metadata.author).toBe("slaveofsolace");
            expect(metadata.version).toBe("1.2.0");
            expect(metadata.license).toBe("Apache-2.0");
        }
    });

    test("embeds the exact parseable files used by the setup transaction", () => {
        expect(SOLCORD_RUNTIME_THEMES).toHaveLength(THEME_FILES.length + 6);
        for (const theme of SOLCORD_RUNTIME_THEMES) {
            expect(theme.content as string).toBe(readTheme(theme.fileName));
            expect(theme.content.startsWith("/**")).toBeTrue();
            expect(parseJsDoc(theme.content).name).toStartWith("Solcord");
        }
    });

    test("keeps the recommended theme and four alternatives self-contained", () => {
        expect(THEME_FILES).toHaveLength(5);
        for (const fileName of THEME_FILES) {
            const css = executableCss(readTheme(fileName));
            expect(css).not.toMatch(/@import\b/i);
            expect(css).not.toMatch(/url\s*\(/i);
            expect(css).not.toMatch(/https?:\/\//i);
            expect(css).toContain(":focus-visible");
            expect(css).toContain("outline: 3px");
            expect(css).toContain("prefers-reduced-motion");
            expect(css).toContain("animation-iteration-count: 1");
            expect(css).toContain("color-scheme:");
            expect(css).toContain("--background-base-low:");
            expect(css).toContain("--background-surface-higher:");
            expect(css).toContain("--border-subtle:");
            expect(css).toContain("--channeltextarea-background:");
            expect(css).toContain("--brand-500:");
            expect(css).toContain("--button-filled-brand-background:");
            expect(css).toContain("--text-default:");
            expect(css).toContain("--interactive-text-default:");
            expect(css).toContain("[class*=\"peopleListItem_\"]");
            expect(css).toContain("[class*=\"itemCard_\"]");
            expect(css).toContain("[class*=\"chatContent_\"]");
            expect(css).toContain("#app-mount");
            expect(css).toContain("li[id^=\"chat-messages-\"]");
            expect(css).not.toContain("[class*=\"message_\"]");
            expect(css).not.toContain("overflow: hidden");
        }
    });

    test("applies every family member regardless of the native Discord light or dark selection", () => {
        for (const fileName of THEME_FILES) {
            const css = executableCss(readTheme(fileName));
            expect(css).toContain(".theme-light");
            expect(css).toContain(".theme-dark");
            expect(css).toContain(".theme-darker");
            expect(css).toContain(".theme-midnight");
        }
    });

    test("keeps normal and muted text readable on both primary surfaces", () => {
        for (const fileName of THEME_FILES) {
            const css = executableCss(readTheme(fileName));
            const backgrounds = [customProperty(css, "--background-primary"), customProperty(css, "--background-secondary")];
            for (const textProperty of ["--text-normal", "--text-muted"]) {
                const textColor = customProperty(css, textProperty);
                expect(Math.min(...backgrounds.map(background => contrast(textColor, background)))).toBeGreaterThanOrEqual(4.5);
            }
            const focus = customProperty(css, "--solcord-focus");
            expect(Math.min(...backgrounds.map(background => contrast(focus, background)))).toBeGreaterThanOrEqual(3);
        }
    });

    test("keeps Paper Signal semantic states readable on its light surfaces", () => {
        const css = executableCss(readTheme("Solcord-PaperSignal.theme.css"));
        const paper = customProperty(css, "--background-primary");
        const statusSurface = customProperty(css, "--background-tertiary");
        const accentSurface = customProperty(css, "--brand-500");
        for (const property of ["--solcord-accent-text", "--solcord-warning-text", "--solcord-danger-text", "--solcord-callout-text"]) {
            const color = customProperty(css, property);
            expect(contrast(color, paper), `${property} on paper`).toBeGreaterThanOrEqual(4.5);
            expect(contrast(color, statusSurface), `${property} on status surface`).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrast(customProperty(css, "--solcord-on-accent"), accentSurface)).toBeGreaterThanOrEqual(4.5);
        expect(css).toContain("[class*=\"addFriend_\"] *");
        expect(css).toContain("[class*=\"critical-secondary_\"] *");
    });

    test("keeps every application-wide appearance mode readable outside the Solcord panel", () => {
        for (const mode of ["solcord-dark", "solcord-light", "oled"] as const) {
            const selector = `html[data-solcord-mode="${mode}"]`;
            const surfaces = [
                ruleProperty(SOLCORD_UI_CSS, selector, "--sc-app-surface-0"),
                ruleProperty(SOLCORD_UI_CSS, selector, "--sc-app-surface-1"),
                ruleProperty(SOLCORD_UI_CSS, selector, "--sc-app-surface-2")
            ];
            for (const property of ["--sc-app-text", "--sc-app-muted", "--sc-app-link", "--sc-app-positive", "--sc-app-warning", "--sc-app-danger"]) {
                const color = ruleProperty(SOLCORD_UI_CSS, selector, property);
                expect(Math.min(...surfaces.map(surface => contrast(color, surface))), `${mode} ${property}`).toBeGreaterThanOrEqual(4.5);
            }
        }
    });

    test("routes Solcord controls through theme-aware semantic color pairs", () => {
        const css = executableCss(SOLCORD_UI_CSS);
        expect(css).toContain("var(--solcord-on-accent, var(--solcord-graphite))");
        expect(css).toContain("var(--solcord-accent-text, var(--solcord-sea))");
        expect(css).toContain("var(--solcord-warning-text, var(--solcord-amber))");
        expect(css).toContain("var(--solcord-danger-text, var(--solcord-coral))");
        expect(css).toContain("var(--solcord-callout-text, var(--text-muted))");
        expect(css).toContain(".solcord-wizard-body > p:not(.solcord-callout)");
    });

    test("uses Discord-native readable typography and a bounded texture without decorative signal dots", () => {
        const css = executableCss(SOLCORD_UI_CSS);
        expect(css).toContain("--sc-font-body: var(--font-primary, \"gg sans\"");
        expect(css).toContain("--sc-font-display: var(--font-display, var(--font-primary, \"gg sans\"");
        expect(css).toContain("--sc-font-editorial: var(--font-primary, \"gg sans\"");
        expect(css).toContain("--sc-font-code: \"Cascadia Code\"");
        expect(css).toContain("url(\"solcord://fonts/HankenGrotesk-variable.ttf\")");
        expect(css).not.toContain("font-family: \"Solcord Anybody\"");
        expect(css).not.toContain("url(\"./fonts/Anybody-variable.ttf\")");
        expect(css).toContain("--sc-field-grain: url(\"data:image/svg+xml");
        expect(css).not.toMatch(/url\(["']?https?:/i);
        expect(css).toContain("html:not([data-solcord-mode=\"follow-discord\"])[data-solcord-mode] body::before");
        expect(css).toContain("pointer-events: none");
        expect(css).not.toContain("html:not([data-solcord-mode=\"follow-discord\"])[data-solcord-mode] body::after");
        expect(css).toContain("mix-blend-mode: soft-light");
        expect(css).toContain(".solcord-header h1");
        expect(css).toContain("font-family: var(--sc-font-display)");

        for (const theme of SOLCORD_RUNTIME_THEMES) {
            const source = executableCss(readTheme(theme.fileName));
            expect(source, theme.fileName).toContain("font-kerning: normal");
            expect(source, theme.fileName).toContain("[class*=\"title_\"]");
            expect(source, theme.fileName).not.toMatch(/@font-face|https?:\/\//i);
        }
    });

    test("pins the locally bundled OFL font payloads", () => {
        const fonts = new Map([
            ["Anybody-variable.ttf", "b184bd7e6ca8348bbaecec98951565729d7e89b7872d4898a1f9981342b5b64c"],
            ["HankenGrotesk-variable.ttf", "813b3f8fa0965405669a89b38e51bbefd95eef6b8e20d1cb2d8c10cce062662f"]
        ]);
        for (const [fileName, expectedHash] of fonts) {
            const payload = readFileSync(resolve(REPOSITORY_ROOT, "src/betterdiscord/styles/fonts", fileName));
            expect(createHash("sha256").update(payload).digest("hex"), fileName).toBe(expectedHash);
        }
        expect(readFileSync(resolve(REPOSITORY_ROOT, "docs/licenses/Anybody-OFL-1.1.txt"), "utf8")).toContain("SIL OPEN FONT LICENSE Version 1.1");
        expect(readFileSync(resolve(REPOSITORY_ROOT, "docs/licenses/HankenGrotesk-OFL-1.1.txt"), "utf8")).toContain("SIL OPEN FONT LICENSE Version 1.1");
    });

    test("uses the default ember only as the warning and critical color", () => {
        const css = executableCss(readTheme("Solcord-Default.theme.css"));
        expect(css).not.toMatch(/gradient\s*\(/i);
        expect(css).toContain("--solcord-panel-filter: none");
        expect(css).not.toMatch(/--solcord-panel-filter:\s*blur/i);
        expect(css.match(/var\(--solcord-coral\)/g)).toHaveLength(1);
        expect(css).toContain("--status-danger: var(--solcord-coral)");
        expect(css).toContain("[class*=\"mentioned_\"]");
        expect(css).toContain("border-left: 2px solid var(--solcord-sea)");
    });
});
