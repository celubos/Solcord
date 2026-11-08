// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs";
import path from "node:path";
import stylelint from "stylelint";

export function cssDiagnostics(results, root = process.cwd()) {
    const counts = new Map();
    for (const result of results) {
        if (result.parseErrors?.length) throw new Error("A stylesheet could not be parsed.");
        const file = path.relative(root, result.source).replaceAll("\\", "/");
        for (const warning of result.warnings) {
            const key = JSON.stringify([file, warning.rule, warning.severity, warning.text]);
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
    }
    return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right, "en")));
}

export function addedCssDiagnostics(actual, baseline) {
    return Object.entries(actual).filter(([key, count]) => count > (baseline[key] ?? 0)).map(([key, count]) => ({key, count: count - (baseline[key] ?? 0)}));
}

if (import.meta.main) {
    const baseline = JSON.parse(fs.readFileSync("scripts/baselines/stylelint.json", "utf8"));
    if (baseline.schemaVersion !== 1 || !baseline.diagnostics || typeof baseline.diagnostics !== "object") throw new Error("The reviewed CSS baseline is invalid.");
    const result = await stylelint.lint({files: "src/betterdiscord/styles/**/*.css"});
    const added = addedCssDiagnostics(cssDiagnostics(result.results), baseline.diagnostics);
    console.log(`Full CSS inventory: ${result.results.length} stylesheets; ${added.length} new diagnostic groups. Existing baseline debt remains recorded.`);
    if (added.length) {console.error(JSON.stringify(added, null, 2)); process.exitCode = 1;}
}
