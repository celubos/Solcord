import {SolcordBaselineSuite, resolveSolcordEmbedTargets, resolveSolcordLayoutTarget} from "../../src/betterdiscord/modules/solcord/baseline-suite";

interface Measurement {
    name: string;
    context: Record<string, unknown>;
    samples: number;
    medianMs: number;
    p95Ms: number;
    maximumMs: number;
    containsCalls: number;
}

export interface SolcordRendererBenchmarkReport {
    pass: boolean;
    records: Measurement[];
}

const records: Measurement[] = [];

function check(condition: unknown, detail: string): asserts condition {
    if (!condition) throw new Error(detail);
}

function measure(name: string, operation: () => void, context: Record<string, unknown>, samples = 31): void {
    for (let warmup = 0; warmup < 8; warmup++) operation();
    const durations: number[] = [];
    let containsCalls = 0;
    const original = Node.prototype.contains;
    Node.prototype.contains = function (node: Node | null) {containsCalls++; return original.call(this, node);};
    try {
        for (let sample = 0; sample < samples; sample++) {
            const started = performance.now();
            operation();
            durations.push(performance.now() - started);
        }
    }
    finally {Node.prototype.contains = original;}
    durations.sort((left, right) => left - right);
    records.push({name, context, samples, medianMs: durations[Math.floor(samples / 2)], p95Ms: durations[Math.floor(samples * 0.95)], maximumMs: durations.at(-1)!, containsCalls});
}

function mountEmbeds(count: number, nested: boolean): HTMLElement {
    document.body.innerHTML = `<main id="fixture"><div class="messageListItem_perf">${Array.from({length: count}, (_, index) => nested
        ? `<div class="embedWrapper_perf"><article class="embedFull_perf"><a href="https://example.invalid/${index}">Synthetic embed</a></article></div>`
        : `<div class="embedWrapper_perf"><a href="https://example.invalid/${index}">Synthetic embed</a></div>`).join("")}</div></main>`;
    return document.getElementById("fixture")!;
}

function frame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function settle(): Promise<void> {
    await frame(); await frame(); await frame();
}

export async function runSolcordRendererBenchmark(baselineResolve: (root: ParentNode) => HTMLElement[]): Promise<void> {
    try {
        const userAgent = navigator.userAgent;
        for (const count of [100, 1000, 2500]) {
            const root = mountEmbeds(count, false);
            const current = resolveSolcordEmbedTargets(root);
            const baseline = baselineResolve(root);
            check(current.length === count && baseline.length === count && current.every((node, index) => node === baseline[index]), "Sibling resolver behavior differs between versions.");
            measure("v2.0.0 sibling embed resolver", () => {check(baselineResolve(root).length === count, "Baseline resolver lost a target.");}, {embeds: count, nesting: "siblings", source: "9b3004f"});
            measure("RC8 sibling embed resolver", () => {check(resolveSolcordEmbedTargets(root).length === count, "Current resolver lost a target.");}, {embeds: count, nesting: "siblings", source: "accepted RC8"});
        }
        for (const count of [100, 1000]) {
            const root = mountEmbeds(count, true);
            check(resolveSolcordEmbedTargets(root).length === count && baselineResolve(root).length === count, "Nested roots were not deduplicated.");
            measure("RC8 nested embed resolver", () => {check(resolveSolcordEmbedTargets(root).length === count, "Nested resolver lost an outer root.");}, {embeds: count, rootsPerEmbed: 2});
        }

        document.body.innerHTML = `<main><nav aria-label="Servers"><div data-list-id="guildsnav"></div></nav><nav aria-label="Channels"><div data-list-id="channels-333"></div></nav><aside aria-label="Members"><div data-list-id="members-333" role="list"></div></aside>${"<div class='ordinary'>unrelated loaded DOM</div>".repeat(5000)}</main>`;
        measure("RC8 navigation region resolver", () => {
            for (let index = 0; index < 100; index++) {
                check(resolveSolcordLayoutTarget(document, "guilds")?.tagName === "NAV", "Server region did not resolve.");
                check(resolveSolcordLayoutTarget(document, "channels")?.tagName === "NAV", "Channel region did not resolve.");
                check(resolveSolcordLayoutTarget(document, "members")?.tagName === "ASIDE", "Member region did not resolve.");
            }
        }, {unrelatedNodes: 5000, regionsPerSample: 300, batchingReason: "100 repetitions keep this fast resolver above the browser timer precision floor."}, 101);

        const suite = new SolcordBaselineSuite({});
        const root = mountEmbeds(1000, false);
        const message = root.firstElementChild!;
        const unrelated = document.createElement("aside"); document.body.append(unrelated);
        const startTime = performance.now();
        suite.start({layoutCollapse: false, collapsedRegions: [], embedControls: true, crossPlatformAutoscroll: false, messageLinkPreview: false, mediaShelf: []});
        const startMs = performance.now() - startTime;
        await settle();
        check(document.querySelectorAll(".solcord-embed-control").length === 1000, "Initial control installation was incomplete.");
        const originalElementQuery = Element.prototype.querySelectorAll;
        const originalDocumentQuery = Document.prototype.querySelectorAll;
        let messageScans = 0;
        let fullDocumentScans = 0;
        Element.prototype.querySelectorAll = function (this: Element, selector: string) {
            if (selector === "article, [class*=\"embed\"]") messageScans++;
            return originalElementQuery.call(this, selector);
        } as typeof originalElementQuery;
        Document.prototype.querySelectorAll = function (this: Document, selector: string) {
            if (selector === "article, [class*=\"embed\"]") fullDocumentScans++;
            return originalDocumentQuery.call(this, selector);
        } as typeof originalDocumentQuery;
        const mutationTimings: number[] = [];
        let unrelatedScans = 0;
        try {
            for (let index = 0; index < 30; index++) {
                unrelated.append(document.createElement("span"));
                await settle();
            }
            unrelatedScans = messageScans + fullDocumentScans;
            check(unrelatedScans === 0, "Unrelated DOM mutations triggered an embed resolver scan.");
            for (let index = 0; index < 30; index++) {
                const started = performance.now();
                const embed = document.createElement("div"); embed.className = "embedWrapper_perf";
                embed.innerHTML = `<a href="https://example.invalid/new-${index}">New synthetic embed</a>`;
                message.append(embed);
                await settle();
                mutationTimings.push(performance.now() - started);
                check(embed.querySelectorAll(".solcord-embed-control").length === 1, "A dirty message did not get exactly one control.");
            }
            check(fullDocumentScans === 0, "Dirty message updates caused a full document embed scan.");
        }
        finally {
            Element.prototype.querySelectorAll = originalElementQuery;
            Document.prototype.querySelectorAll = originalDocumentQuery;
            suite.stop();
        }
        check(Object.values(suite.status().resources).every(value => value === 0), "Suite retained owned resources after teardown.");
        check(!document.querySelector(".solcord-embed-control, .solcord-embed-host, #solcord-embed-controls-runtime"), "Suite left embed DOM residue.");
        mutationTimings.sort((left, right) => left - right);
        const memory = (performance as Performance & {memory?: {usedJSHeapSize: number; totalJSHeapSize: number;};}).memory;
        const report = {
            pass: true,
            userAgent,
            records,
            embedController: {initialEmbeds: 1000, startMs, unrelatedMutations: 30, unrelatedResolverScans: unrelatedScans, dirtyMessageMutations: 30, dirtyMessageResolverScans: messageScans, fullDocumentResolverScans: fullDocumentScans, settledUpdateMedianMs: mutationTimings[15], settledUpdateP95Ms: mutationTimings[28], timingMeaning: "Includes three requestAnimationFrame turns; this is settled fixture latency, not callback CPU time.", remainingOwnedResources: suite.status().resources},
            memory: memory ? {usedJSHeapSize: memory.usedJSHeapSize, totalJSHeapSize: memory.totalJSHeapSize, precision: "Chromium may round this endpoint snapshot; it is not a forced-GC measurement."} : null,
            nonclaims: ["Isolated headless Chromium with synthetic locally loaded DOM, not live Discord or real account traffic.", "Resolver timings include browser DOM traversal and correctness checks; no performance threshold is used to conceal a regression.", "Renderer heap is an endpoint snapshot without forced browser GC, not a leak test."]
        };
        document.body.innerHTML = "<p>Benchmark complete</p>";
        document.documentElement.setAttribute("data-solcord-perf-result", btoa(JSON.stringify(report)));
    }
    catch (error) {document.documentElement.setAttribute("data-solcord-perf-error", btoa(error instanceof Error ? `${error.message}\n${error.stack}` : String(error)));}
}
