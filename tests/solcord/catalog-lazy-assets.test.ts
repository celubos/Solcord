import {describe, expect, test} from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import * as full from "../../src/common/solcord/addon-catalog.generated";
import * as trust from "../../src/common/solcord/addon-trust.generated";
import {loadSolcordCatalogDetails} from "../../src/betterdiscord/modules/solcord/catalog-details";
import {strictCommunityAddonActivationDecision} from "../../src/betterdiscord/modules/solcord/addon-outbound-policy";
import {solcordLocalAssets} from "../../scripts/helpers/local-assets";

const root = path.resolve(import.meta.dir, "../..");
describe("lazy local catalog and editor assets", () => {
    test("early trust decisions match the full catalog without loading its browsing fields or themes", () => {
        expect(trust.SOLCORD_CATALOG_INDEX).toHaveLength(full.SOLCORD_CATALOG_INDEX.length);
        for (const candidate of full.SOLCORD_CATALOG_INDEX) {
            const input = {fileName: candidate.fileName, sourceSha256: candidate.sourceSha256 ?? undefined};
            expect(strictCommunityAddonActivationDecision(input, trust.SOLCORD_CATALOG_INDEX) as unknown).toEqual(strictCommunityAddonActivationDecision(input, full.SOLCORD_CATALOG_INDEX));
        }
        expect(trust.SOLCORD_CATALOG_INDEX.some(candidate => "description" in candidate)).toBe(false);
        for (const theme of trust.SOLCORD_RUNTIME_THEMES) {
            expect("content" in theme).toBe(false);
            const body = full.SOLCORD_RUNTIME_THEMES.find(candidate => candidate.id === theme.id)!;
            expect(Number(theme.sizeBytes)).toBe(Buffer.byteLength(body.content));
            expect(String(theme.sourceSha256)).toBe(createHash("sha256").update(body.content).digest("hex"));
        }
    });

    test("loads integrity-bound browsing records once from the exact local URI", async () => {
        await expect(loadSolcordCatalogDetails((async () => new Response("[]")) as typeof fetch)).rejects.toThrow("integrity");
        let reads = 0;
        const read = (async (url: string | URL | Request, options?: RequestInit) => {
            reads++;
            expect(String(url)).toBe("solcord://catalog/index.json");
            expect(options?.credentials).toBe("omit");
            return new Response(fs.readFileSync(path.join(root, "assets/catalog/solcord-browsing.generated.json")));
        }) as typeof fetch;
        expect(reads).toBe(0);
        const first = await loadSolcordCatalogDetails(read);
        expect(first).toEqual(full.SOLCORD_CATALOG_INDEX);
        expect(await loadSolcordCatalogDetails(read)).toBe(first);
        expect(reads).toBe(1);
    });

    test("allowlists the pinned local Monaco loader, workers, fonts, CSS and license", () => {
        const assets = solcordLocalAssets(root);
        const targets = assets.map(asset => asset.target);
        expect(new Set(targets).size).toBe(targets.length);
        expect(targets).toContain("catalog/index.json");
        expect(targets).toContain("editor/monaco/LICENSE");
        expect(targets).toContain("editor/monaco/vs/loader.js");
        expect(targets).toContain("editor/monaco/vs/editor/editor.main.css");
        expect(targets.some(target => target.endsWith("workerMain.js"))).toBe(true);
        expect(targets.some(target => target.endsWith(".ttf"))).toBe(true);
        expect(assets.every(asset => fs.statSync(asset.source).isFile())).toBe(true);
    });
});
