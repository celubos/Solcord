import {afterEach, describe, expect, test} from "bun:test";
import http, {type Server} from "node:http";
import {EventEmitter} from "node:events";
import {Writable} from "node:stream";
import legacy from "../../src/electron/preload/api/https";
import {hydrateReadableStream, type DriedRequest} from "../../src/common/native-fetch";
import {nativeFetch, waitForUploadDrain} from "../../src/electron/preload/api/fetch";

const servers: Server[] = [];
afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {server.closeAllConnections(); server.close(() => resolve());})));
});
async function listen(handler: http.RequestListener) {
    const server = http.createServer(handler); servers.push(server);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as {port: number;}).port}`;
}
const get = (url: string, options = {}) => new Promise<Buffer>((resolve, reject) => legacy.request(url, options, (error, _metadata, body) => error ? reject(error) : resolve(Buffer.from(body!))));
const init = (url: string): DriedRequest => ({url, body: null, headers: {}, method: "GET", keepalive: false, redirect: "follow", signal: null, timeout: 2000, maxRedirects: 3, rejectUnauthorized: true});

describe("transport privacy and lifetime", () => {
    test("invalid URLs reject instead of stranding the promise", async () => {
        await expect(nativeFetch(init("http://["))).rejects.toThrow();
    });
    test("upload backpressure is released on a clean socket close", async () => {
        const request = Object.assign(new EventEmitter(), {destroyed: false});
        const pending = waitForUploadDrain(request as unknown as http.ClientRequest);
        request.emit("close"); await expect(pending).rejects.toThrow("closed");
        expect(request.listenerCount("drain")).toBe(0); expect(request.listenerCount("error")).toBe(0);
    });
    test("closing a piped legacy consumer cancels its upstream transfer", async () => {
        let closed = false, sent = 0, callbacks = 0;
        const root = await listen((_request, response) => {
            const timer = setInterval(() => {sent++; response.write(Buffer.alloc(65536));}, 5);
            response.once("close", () => {clearInterval(timer); closed = true;});
        });
        const sink = new Writable({write(_chunk, _encoding, callback) {callback(); this.destroy();}});
        legacy.request(root, {}, () => {callbacks++;}).pipe(sink);
        for (let count = 0; count < 40; count++) {if (closed) break; await Bun.sleep(5);}
        expect(closed).toBe(true); expect(sent).toBeLessThan(20); expect(callbacks).toBe(1);
        expect(sink.listenerCount("close")).toBe(0); expect(sink.listenerCount("error")).toBe(0);
    });
    test("legacy redirects keep credentials and old query values at their original origin", async () => {
        let observed: http.IncomingHttpHeaders = {}, observedUrl = "", method = "";
        const to = await listen((request, response) => {observed = request.headers; observedUrl = request.url!; method = request.method!; response.end("ok");});
        const from = await listen((request, response) => {request.resume(); response.writeHead(302, {location: `${to}/final?destination=only`}); response.end();});
        expect((await get(`${from}/start?secret=private`, {method: "POST", formData: "payload", headers: {"authorization": "marker", "cookie": "private", "content-type": "text/plain"}})).toString()).toBe("ok");
        expect(observed.authorization).toBeUndefined(); expect(observed.cookie).toBeUndefined();
        expect(observed["content-type"]).toBeUndefined(); expect(observedUrl).toBe("/final?destination=only"); expect(method).toBe("GET");
    });
    test("legacy relative redirects resolve and loops fail once", async () => {
        let calls = 0;
        const root = await listen((request, response) => {response.writeHead(302, {location: request.url === "/start" ? "/final" : "/final"}); response.end();});
        await new Promise<void>(resolve => legacy.request(`${root}/start`, {}, error => {calls++; expect(error.message).toContain("redirects"); resolve();}));
        await Bun.sleep(20); expect(calls).toBe(1);
    });
    test("hydration reads only on demand and forwards cancellation", async () => {
        let reads = 0, cancellations = 0;
        const stream = hydrateReadableStream({read: async () => {reads++; return {done: false, value: new Uint8Array(65536)};}, cancel: async reason => {expect(reason).toBe("stop"); cancellations++;}});
        await Bun.sleep(20); expect(reads).toBe(0);
        const reader = stream.getReader(); await reader.read(); expect(reads).toBe(1);
        await reader.cancel("stop"); await Bun.sleep(20); expect(cancellations).toBe(1); expect(reads).toBe(1);
    });
    test("canceling a native response closes the upstream socket before the whole transfer", async () => {
        let sent = 0, closed = false;
        const root = await listen((_request, response) => {
            response.on("close", () => {closed = true;});
            const send = () => {while (!response.destroyed && sent < 64 * 1024 * 1024) {sent += 65536; if (!response.write(Buffer.alloc(65536))) {response.once("drain", send); return;}} if (!response.destroyed) response.end();}; send();
        });
        const result = await nativeFetch(init(root));
        await Bun.sleep(30); expect(sent).toBeLessThan(64 * 1024 * 1024);
        await result.body!.cancel("discard");
        for (let count = 0; count < 25; count++) {if (closed) break; await Bun.sleep(10);}
        expect(closed).toBe(true); expect(sent).toBeLessThan(64 * 1024 * 1024);
    });
});
