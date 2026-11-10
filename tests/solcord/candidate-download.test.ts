// SPDX-License-Identifier: Apache-2.0
import {createRequire} from "node:module";
import {expect, test} from "bun:test";
const {fetchBounded} = createRequire(import.meta.url)("../../scripts/review-solcord-candidates.cjs");
const url = "https://raw.githubusercontent.com/fixture/repo/" + "a".repeat(40) + "/plugin.js";

test.each([null, "1"])("candidate downloader counts chunked bytes with content-length %s and cancels over budget", async length => {
    let cancelled = 0;
    const body = new ReadableStream({pull(controller) {controller.enqueue(new Uint8Array(4));}, cancel() {cancelled++;}});
    const response = new Response(body, {headers: length ? {"content-length": length} : {}});
    await expect(fetchBounded(url, 6, {fetchImpl: async () => response})).rejects.toThrow("exceeds 6");
    expect(cancelled).toBe(1);
});

test("candidate downloader enforces a stalled-reader deadline", async () => {
    let cancelled = 0;
    const response = new Response(new ReadableStream({cancel() {cancelled++;}}));
    await expect(fetchBounded(url, 6, {fetchImpl: async () => response, timeoutMs: 10})).rejects.toThrow("timed out");
    expect(cancelled).toBe(1);
});

test("candidate downloader preserves exact accepted bytes at the limit", async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252]);
    expect(await fetchBounded(url, bytes.length, {fetchImpl: async () => new Response(bytes)})).toEqual(Buffer.from(bytes));
});
