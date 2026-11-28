// SPDX-License-Identifier: Apache-2.0

import {describe, expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

const root = resolve(import.meta.dir, "../..");
const fixture = readFileSync(resolve(root, "tests/fixtures/solcord-control-center.html"), "utf8");
const renderer = readFileSync(resolve(root, "scripts/render-solcord-ui-fixture.mjs"), "utf8");
const css = readFileSync(resolve(root, "src/betterdiscord/styles/solcord.css"), "utf8");

describe("Solcord isolated Control Center fixture", () => {
    test("covers every canonical workspace and the dedicated setup state", () => {
        for (const id of ["overview", "appearance", "performance", "privacy", "chat", "voice", "friends", "extensions", "recovery"]) {
            expect(fixture).toContain(`${id}: () =>`);
        }
        expect(fixture).toContain("state === \"wizard\" ? setupScreen()");
        expect(fixture).toContain("Five quick steps. Nothing changes until Apply.");
        expect(fixture).toContain("result.workspaceHeadingCount === expectedHeadingCount");
        expect(fixture).toContain("<div class=\"solcord-section-heading\"><h3>$" + "{title}</h3>");
        expect(fixture).not.toContain("<div class=\"solcord-section-heading\"><h2>$" + "{title}</h2>");
        expect(fixture).toContain("document.querySelector(\".solcord-workspace-menu > summary\").setAttribute(\"aria-label\",");
        expect(fixture).toContain("Change workspace. Current workspace: $" + "{workspaceNames[workspace][0]}");
    });

    test("measures overflow, focus, contrast, responsive relationships, and reduced motion", () => {
        for (const contract of ["horizontalOverflow", "clippedOrOverflowingElements", "focusFailures", "normal: Number(elementContrast", "muted: Number(elementContrast", "navigation: Number(elementContrast", "settingTitle:", "settingCopy:", "navigationRelationship", "reducedMotion"]) {
            expect(fixture).toContain(contract);
        }
        expect(fixture).toContain("nativeRowSpacingFailures");
        expect(fixture).toContain("settingHintSpacingFailures");
        expect(fixture).toContain("actionHintSpacingFailures");
        expect(fixture).toContain("getPropertyValue(\"--sc-space-3\")");
        expect(fixture).toContain("labelRange.getClientRects()");
        expect(fixture).toContain("hintTop - labelBottom < 7");
        expect(fixture).toContain("switchStateFailures");
        expect(fixture).toContain("switchFocusVisible");
        expect(fixture).toContain("data-switch-matrix");
        expect(fixture).toContain("solcord-switch-track");
        expect(fixture).toContain("solcord-switch-thumb");
        expect(fixture).not.toContain("<i></i>");
        expect(fixture).toContain("compactNavigationGeometry");
        expect(fixture).toContain("opaqueBackground:");
        expect(fixture).toContain("People and Spaces");
        expect(fixture).toContain("replacement.left - title.right < 8");
        expect(renderer).toContain("isolated representative fixture using the production Solcord stylesheet; not live Discord acceptance");
        expect(renderer).toContain("appearance-light-long-320-container");
        expect(renderer).toContain("fixtureWidth=320");
        expect(renderer).toContain("privacy-light-1920x1080");
        expect(renderer).toContain("setup-dark-1280x720");
        expect(renderer).toContain("setup-dark-680x520-compact");
        expect(renderer).toContain("privacy-light-compact-short-320x568");
        for (const scale of ["scale=100", "scale=125", "scale=150", "scale=200"]) {
            expect(renderer).toContain(scale);
        }
        for (const theme of ["solcord-default", "obsidian-thread", "carbon-ember", "midnight-glass", "paper-signal", "threadline", "signal-block", "relay-classic", "workshop", "quiet-read", "night-transit"]) {
            expect(renderer).toContain(`theme=${theme}`);
            expect(renderer).toContain(`theme=${theme}&`);
            expect(fixture).toContain(`"${theme}"`);
        }
        expect(renderer.match(/switches=1/g)).toHaveLength(11);
    });

    test("uses the real standalone HUD label and native reset instead of an unrelated settings-row substitute", () => {
        expect(fixture).toContain("Show the local performance overlay");
        expect(fixture).toContain("<kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>K</kbd> opens Command Deck.");
        expect(fixture).toContain("font: 14px/1 var(--font-primary)");
        expect(fixture).toContain("h1, h2, h3, p { margin: 0; }");
        expect(fixture).not.toContain("Idle diagnostics");
        expect(css).toContain(".solcord-panel :where(label:has(> .solcord-switch))");
        expect(css).toContain(".solcord-key-hint { margin: var(--sc-space-2) 0 0;");
        expect(css).toContain(".solcord-key-hint kbd { display: inline-block;");
    });

    test("uses one switch pattern: the label leads, the switch trails, and rows share one measure", () => {
        const ui = (name: string) => readFileSync(resolve(root, "src/betterdiscord/ui/solcord", name), "utf8");
        for (const name of ["panel.tsx", "timeline.tsx", "accessibility-options.tsx", "setup-wizard.tsx", "addon-catalog.tsx"]) {
            // A switch never opens its label; the On/Off caption toggle in catalog rows is the one compound control.
            expect(ui(name), name).not.toMatch(/<label(?![^>]*solcord-toggle)[^>]*><SolcordSwitch /);
        }
        expect(ui("timeline.tsx")).toMatch(/<div className="solcord-history-switch">\s*<div>/);
        expect(ui("panel.tsx")).toContain("<label><span>Show the local performance overlay</span><SolcordSwitch label=\"Show the local performance overlay\"");
        expect(css).toContain("--sc-row-measure: 700px;");
        expect(css).toContain(".solcord-panel :where(label:has(> .solcord-switch)) { display: flex; align-items: center; justify-content: space-between; gap: 18px; max-width: var(--sc-row-measure);");
        expect(css).toContain(".solcord-panel :is(.solcord-setting-list, .solcord-setting-rows, .solcord-control-grid, .solcord-power-control, .solcord-privacy-command, .solcord-privacy-capabilities, .solcord-history-intro) { max-width: var(--sc-row-measure); }");
        expect(css).toContain(".solcord-history-switch { display: flex; align-items: center; justify-content: space-between; gap: 18px; }");
        expect(css).not.toContain(".solcord-power-control { align-items: flex-start; flex-direction: column;");
        for (const contract of ["switchPlacementFailures", "switch-not-after-label", "switch-not-at-row-end", "row-wider-than-measure", "switchEdgeSpread <= 16", "wizardStepFailures", "hidden-step-name", "step-rail-not-aligned-with-progress", "step-badges-not-level", "dialogPass", "identityTitles === 1", "actionsInView"]) {
            expect(fixture).toContain(contract);
        }
        expect(renderer).toContain("setup-light-320-container");
        expect(renderer).toContain("setup-dialog-dark-effective-200");
        expect(renderer).toContain("dialog=1&scale=200");
    });

    test("keeps Audience Guard action notes separated using the shared spacing scale", () => {
        expect(fixture).toContain("Encrypted storage is available. Enable the adapter");
        expect(fixture).toContain("Clear private list");
        expect(fixture).toContain("note.getBoundingClientRect().top - controls.getBoundingClientRect().bottom");
        expect(css).toContain(".solcord-panel :where(.solcord-actions, .solcord-dialog-actions, .solcord-inline-field, .solcord-control-grid) + p { margin-block-start: var(--sc-space-3); }");
    });

    test("keeps the normal header quiet and qualifies diagnostic builds without narrow overflow", () => {
        const normalHeader = `<div class="solcord-header-copy"><h1>Solcord</h1><p>Control Center</p></div>`;
        expect(fixture.match(new RegExp(normalHeader, "g"))).toHaveLength(1);
        expect(fixture).not.toContain("Control Center ·");
        expect(fixture).not.toContain(`<p>Control Center <span`);
        expect(fixture).toContain(`params.get("diagnostic") === "1"`);
        expect(fixture).toContain("insertAdjacentHTML(\"beforeend\", `<span class=\"solcord-build-warning\" role=\"status\">Diagnostic build</span>`);");
        expect(fixture).toContain("diagnosticIdentity: {requested: diagnostic");
        expect(renderer).toContain("diagnostic-overview-dark-320-container");
        expect(renderer).toContain("diagnostic=1&fixtureWidth=320");
        expect(css).toContain(".solcord-build-warning");
        expect(css).toContain("max-width: 100%");
        expect(css).toContain("white-space: normal");
        expect(css).toContain("overflow-wrap: anywhere");
    });

    test("keeps narrow status rows and light privacy states readable and actionable", () => {
        expect(css).toContain(".solcord-all-clear { display: grid; justify-items: start; gap: 4px; }");
        expect(css).toContain(".solcord-privacy-state { font-size: 12px; font-weight: 750;");
        expect(css).toContain("color-mix(in srgb, var(--sc-success) 58%, var(--sc-text))");
        expect(css).toContain("color-mix(in srgb, var(--sc-warning) 58%, var(--sc-text))");
        expect(fixture).toContain("Review addon");
        expect(fixture).toContain("solcord-recovery-row");
    });

    test("uses an isolated browser profile with background networking disabled", () => {
        expect(renderer).toContain("mkdtempSync");
        expect(renderer).toContain("--disable-background-networking");
        expect(renderer).toContain("--disable-component-update");
        expect(renderer).toContain("--user-data-dir=");
        expect(renderer).toContain("rmSync(profile, {recursive: true, force: true})");
    });
});
