// SPDX-License-Identifier: Apache-2.0

import {describe, expect, test} from "bun:test";
import {spawnSync} from "node:child_process";
import {mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";

import {normalizePortableText, portableTextByteLength} from "../../scripts/helpers/portable-text.mjs";

describe("Solcord repository audit portability", () => {
    test("counts all tracked files and detects a stale report", () => {
        const tempRoot = realpathSync(tmpdir());
        const fixture = mkdtempSync(path.join(tempRoot, "solcord-repository-audit-"));
        const command = (program: string, args: string[]) => spawnSync(program, args, {
            cwd: fixture, encoding: "utf8", timeout: 15_000, windowsHide: true
        });
        const removeFixture = () => {
            const resolved = realpathSync(fixture);
            if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith("solcord-repository-audit-")) {
                throw new Error("Refusing to remove a fixture outside its temporary parent.");
            }
            rmSync(resolved, {recursive: true});
        };
        const script = path.resolve(import.meta.dir, "../../scripts/audit-solcord-repository.mjs");
        try {
            expect(command("git", ["init", "--quiet"]).status).toBe(0);
            const files = [
                "scripts/finalize-solcord-audit.mjs",
                ".github/workflows/solcord-quality-finalization.yml",
                ".github/workflows/solcord-final-docs.yml",
                "src/betterdiscord/modules/solcord/runtime.ts",
                "installer/Solcord.Installer/InstallerEngine.cs"
            ];
            for (const file of files) {
                mkdirSync(path.dirname(path.join(fixture, file)), {recursive: true});
                writeFileSync(path.join(fixture, file), "fixture\n");
            }
            writeFileSync(path.join(fixture, files[3]), "setTimeout(work, 10);\n");
            writeFileSync(path.join(fixture, files[4]), "// TODO: installer ownership fixture\n");
            expect(command("git", ["add", "--", ...files]).status).toBe(0);
            expect(command(process.execPath, [script]).status).toBe(0);
            const report = readFileSync(path.join(fixture, "docs/audit/FULL_REPOSITORY_AUDIT.md"), "utf8");
            expect(report).toContain("| Persistent tracked files | 5 |");
            expect(report).toContain("| Timer calls | 1 | 1 |");
            expect(report).toContain("| TODO / FIXME / HACK | 1 | 1 |");
            for (const file of files) expect(report).toContain(file);
            expect(command(process.execPath, [script, "--check"]).status).toBe(0);

            writeFileSync(path.join(fixture, files[0]), "changed\nextra line\n");
            const stale = command(process.execPath, [script, "--check"]);
            expect(stale.status).toBe(1);
            expect(stale.stderr).toContain("is stale");
        }
        finally {
            removeFixture();
        }
    });

    test("measures equivalent text identically across checkout line endings", () => {
        const lf = "alpha\nbeta\ngamma\n";
        const crlf = "alpha\r\nbeta\r\ngamma\r\n";
        const legacyCr = "alpha\rbeta\rgamma\r";

        expect(portableTextByteLength(crlf)).toBe(portableTextByteLength(lf));
        expect(portableTextByteLength(legacyCr)).toBe(portableTextByteLength(lf));
        expect(portableTextByteLength("cafe\n")).toBe(Buffer.byteLength("cafe\n", "utf8"));
        expect(() => portableTextByteLength(null as unknown as string)).toThrow("Text metrics require a string.");
    });

    test("compares checked-out reports without treating Windows line endings as stale content", () => {
        const report = "# Repository audit\n\n| Files | Lines |\n| 3 | 42 |\n";
        expect(normalizePortableText(report.replace(/\n/g, "\r\n"))).toBe(report);
        expect(normalizePortableText(report.replace(/\n/g, "\r"))).toBe(report);
        expect(normalizePortableText(report)).toBe(report);
    });

    test("still detects changed content, spacing, and missing final newlines", () => {
        const report = "audit: 42\n";
        expect(normalizePortableText("audit: 43\r\n")).not.toBe(report);
        expect(normalizePortableText("audit: 42 \r\n")).not.toBe(report);
        expect(normalizePortableText("audit: 42")).not.toBe(report);
        expect(normalizePortableText("\ufeffaudit: 42\r\n")).not.toBe(report);
        expect(() => normalizePortableText(undefined as unknown as string)).toThrow("Text metrics require a string.");
    });
});
