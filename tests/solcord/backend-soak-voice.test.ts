import {describe, expect, test} from "bun:test";
import {runSolcordBackendSoak, runSolcordFakeDeafenSoakCycle} from "../../scripts/soak-solcord-backend";

describe("controlled Fake Deafen lifecycle soak", () => {
    test("repeats all six real-controller activation, restoration and ownership paths", async () => {
        for (let cycle = 1; cycle <= 120; cycle++) await runSolcordFakeDeafenSoakCycle(cycle);
        expect(document.querySelector("[data-solcord-fake-deafen]")).toBeNull();
    });

    test("reports bounded latency and memory samples with every controller cycle accounted for", async () => {
        const report = await runSolcordBackendSoak({scenario: "fake-deafen", durationMs: 60_000, cycleDelayMs: 0, sampleIntervalMs: 10, maxCycles: 12});
        expect(report.pass).toBeTrue();
        expect(report.failures).toEqual([]);
        expect(report.cycles).toBe(12);
        expect(report.fakeDeafenCycles).toBe(12);
        expect(report.cycleTiming.samples).toBe(12);
        expect(report.cycleTiming.p95Ms).toBeGreaterThanOrEqual(report.cycleTiming.medianMs);
        expect(report.cycleTiming.maximumMs).toBeGreaterThanOrEqual(report.cycleTiming.p95Ms);
        expect(report.memorySamples.length).toBeGreaterThanOrEqual(2);
        expect(report.adapterExecutions).toBe(0);
    });
});
