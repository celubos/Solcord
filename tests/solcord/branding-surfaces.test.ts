// SPDX-License-Identifier: Apache-2.0

import {describe, expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(resolve(REPOSITORY_ROOT, path), "utf8");

describe("Solcord brand surfaces", () => {
    test("leaves Discord's native launch spinner unobstructed and uses the production mark on command surfaces", () => {
        const loader = read("src/betterdiscord/loadingicon.ts");
        const commands = read("src/betterdiscord/modules/commandmanager.tsx");

        expect(loader).toContain("Solcord deliberately adds no second splash");
        expect(loader).toContain("static show(): void {return;}");
        expect(loader).toContain("static hide(): void {return;}");
        expect(loader).not.toContain("solcord-launch-");
        expect(loader).not.toContain("document.createElement");
        expect(commands).toContain("import solcordMark from \"@assets/branding/solcord-mark.svg\"");
        expect(commands).toContain("const SOLCORD_COMMAND_ICON = solcordMark;");
        expect(commands).not.toContain("%3Crect width='64'");
    });

    test("renders the production mark in the editor loader", () => {
        const editor = read("src/editor/index.html");

        expect(editor).toContain("Loading Solcord editor…");
        expect(editor).toContain("d=\"M40.2 15.7A10.5 10.5 0 1 0 25.7 30.6\"");
        expect(editor).toContain("d=\"M38.3 33.4A10.5 10.5 0 1 1 23.8 48.3\"");
        expect(editor).toContain("editor-tile");
        expect(editor).not.toContain("M52 12C43 5 26 6 17 14");
        expect(editor).toContain("#bd-icon::before,");
        expect(editor).toContain("content: none;");
        expect(editor).toContain("prefers-reduced-motion: reduce");
    });

    test("keeps saved appearance choices live across every atomic settings path", () => {
        const runtime = read("src/betterdiscord/modules/solcord/runtime.ts");
        const styles = read("src/betterdiscord/styles/solcord.css");

        const synchronize = runtime.slice(runtime.indexOf("async #synchronizeFeatures"), runtime.indexOf("async #synchronizePowerLab"));
        expect(synchronize).toContain("const fullSynchronization = ids === FEATURE_IDS;");
        expect(synchronize).toContain("if (fullSynchronization) this.#applyProductPresentation();");
        expect(synchronize).toMatch(/if \(fullSynchronization\) \{\s*this\.#synchronizeBaselineSuite\(\);\s*this\.#synchronizePrivacyPolicy\(\);/);
        expect(synchronize).toMatch(/if \(fullSynchronization\) \{\s*this\.#synchronizeCuratedAdapters\(\);\s*await this\.#synchronizePowerLab\(\);/);
        expect(styles).toContain("html[data-solcord-message-shape=\"seamed\"] #app-mount li[id^=\"chat-messages-\"]");
    });
});
