// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs";
import path from "node:path";
import {parseDependencyTree, parseCircular} from "dpdm";

export function circularEdges(cycles, root = process.cwd()) {
    const edges = new Set();
    for (const cycle of cycles) {
        const normalized = cycle.map(file => (path.isAbsolute(file) ? path.relative(root, file) : file).replaceAll("\\", "/"));
        for (let index = 0; index < normalized.length; index++) edges.add(`${normalized[index]} -> ${normalized[(index + 1) % normalized.length]}`);
    }
    return [...edges].sort();
}

export function compareCircularEdges(actual, baseline) {
    const allowed = new Set(baseline);
    const present = new Set(actual);
    return {added: actual.filter(edge => !allowed.has(edge)), removed: baseline.filter(edge => !present.has(edge))};
}

if (import.meta.main) {
    const tree = await parseDependencyTree("src/betterdiscord/index.ts", {transform: true});
    const cycles = parseCircular(tree);
    const baseline = JSON.parse(fs.readFileSync("scripts/baselines/circular-dependencies.json", "utf8"));
    if (baseline.schemaVersion !== 1 || !Array.isArray(baseline.edges) || baseline.edges.some(edge => typeof edge !== "string")) throw new Error("The reviewed cycle baseline is invalid.");
    const result = compareCircularEdges(circularEdges(cycles), baseline.edges);
    console.log(`Dependency cycles: ${cycles.length} groups; ${result.added.length} new cyclic edges; ${result.removed.length} removed baseline edges.`);
    if (result.added.length) {console.error(result.added.join("\n")); process.exitCode = 1;}
}
