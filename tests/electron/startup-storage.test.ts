// SPDX-License-Identifier: Apache-2.0

import {afterEach, describe, expect, test} from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {mainStartupMethodFixture} from "../fixtures/solcord-method-fixture";
import {RendererDocumentInjectionGuard} from "../../src/electron/main/modules/renderer-document-guard";
import {rendererStartupFailureScript} from "../../src/electron/main/modules/renderer-startup-health";

const roots: string[] = [];
afterEach(() => {for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true});});
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "solcord-startup-storage-")); roots.push(root);
    const bdFolder = path.join(root, "missing-parent", "BetterDiscord");
    const errors: string[] = [];
    const ensure = mainStartupMethodFixture("ensureDirectories", {fs, path, bdFolder, console: {error: (message: string) => errors.push(message)}});
    return {root, bdFolder, ensure, errors, owner: {startupPrerequisiteFailure: false}};
}

describe("shipping main storage prerequisites", () => {
    test("creates required directories even when the approved parent has not been created", () => {
        const {bdFolder, ensure, owner} = fixture();
        expect(ensure.call(owner)).toBe(true); expect(owner.startupPrerequisiteFailure).toBe(false);
        for (const entry of ["data/stable", "data/canary", "data/ptb", "data/development", "plugins", "themes"]) {
            expect(fs.statSync(path.join(bdFolder, entry)).isDirectory()).toBe(true);
        }
    });

    test("a blocking file is preserved and disables Solcord without throwing into host startup", () => {
        for (const blocked of ["data", "plugins"]) {
            const {bdFolder, ensure, owner, errors} = fixture();
            fs.mkdirSync(bdFolder, {recursive: true}); const target = path.join(bdFolder, blocked); fs.writeFileSync(target, "owned-user-data");
            expect(ensure.call(owner)).toBe(false); expect(owner.startupPrerequisiteFailure).toBe(true);
            expect(fs.readFileSync(target, "utf8")).toBe("owned-user-data");
            expect(errors).toHaveLength(1); expect(errors[0]).not.toContain(bdFolder);
        }
    });

    test("a failed prerequisite prevents bundle evaluation while retaining the main document boundary", async () => {
        const documents = new RendererDocumentInjectionGuard<object>(); const scripts: string[] = [];
        const frame = {processId: 1, routingId: 2, isDestroyed: () => false, detached: false, async executeJavaScript(script: string) {scripts.push(script);}};
        const webContents = {mainFrame: frame}; documents.beginDocument(webContents);
        const owner = {startupPrerequisiteFailure: true, rendererDocuments: documents, rendererHealth: {cancel() {}}};
        const inject = mainStartupMethodFixture("injectRenderer", {hasCrashed: false, rendererStartupFailureScript, fs: {existsSync() {throw Error("must-not-read-bundle");}}});
        await inject.call(owner, {webContents}, frame);
        expect(scripts).toEqual([rendererStartupFailureScript()]);
        expect(documents.claim(webContents)).toEqual({status: "duplicate"});
    });
});
