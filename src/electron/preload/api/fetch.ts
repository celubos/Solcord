import https from "https";
import http from "http";
import {hydrateReadableStream, dryReadableStream, type DriedRequest, type DriedResponse} from "@common/native-fetch";
import {REDIRECT_CODES as redirectCodes, redirectMethod, redirectHeaders, redirectUrl} from "@common/redirect-policy";
import {isWebhookUrl} from "./webhook";

const DEFAULT_TIMEOUT = 8_000;

const bodylessStatusCodes = new Set([101, 204, 205, 304]);

export function waitForUploadDrain(request: http.ClientRequest): Promise<void> {
    return new Promise((resolve, reject) => {
        const cleanup = () => {request.off("drain", drained); request.off("close", closed); request.off("error", failed);};
        const drained = () => {cleanup(); resolve();};
        const closed = () => {cleanup(); reject(new Error("Request closed during upload"));};
        const failed = (error: Error) => {cleanup(); reject(error);};
        request.once("drain", drained); request.once("close", closed); request.once("error", failed);
        if (request.destroyed) closed();
    });
}

export function nativeFetch({url, signal: dryAbortSignal, body: dryBody, ...init}: DriedRequest) {
    const {promise, resolve, reject} = Promise.withResolvers<DriedResponse>();

    const maxRedirects = init.maxRedirects ?? 20;

    const body = dryBody ? hydrateReadableStream(dryBody) : null;

    let redirectCount = 0;

    function out(uri: string, res: http.IncomingMessage): DriedResponse {
        const status = res.statusCode ?? 0;

        let stream: ReadableStream | null = null;

        if (!bodylessStatusCodes.has(status)) {
            const iterator = res[Symbol.asyncIterator]();
            stream = new ReadableStream<Uint8Array>({
                async pull(controller) {
                    try {
                        const {done, value} = await iterator.next();
                        if (done) controller.close();
                        else controller.enqueue(new Uint8Array(value));
                    }
                    catch (error) {controller.error(error);}
                },
                async cancel() {
                    res.destroy();
                    try {await iterator.return?.();}
 catch {/* Explicit cancellation closes the socket. */}
                }
            }, {highWaterMark: 1});
        }
        else {res.resume();}

        return {
            body: stream ? dryReadableStream(stream) : null,
            url: uri,
            headers: res.headers as Record<string, string>,
            status: status,
            statusText: res.statusMessage || "",
            redirected: redirectCount !== 0
        };
    }

    // If null or infinite no timeout | undefined or finite then timeout
    const timeout = ((t) => init.timeout === null || !isFinite(t) ? undefined : t)(init.timeout ?? DEFAULT_TIMEOUT);

    async function execute(uri: string, method: string, sendBody: boolean, headers = init.headers) {
        if (dryAbortSignal?.aborted()) {
            const reason = dryAbortSignal.reason() || new Error("Request was aborted");
            void body?.cancel(reason).catch(() => {});
            reject(reason);
            return;
        }
        // Mirror the renderer's former webhook block for BdApi.Net.fetch, which runs here over
        // Node's https and does not inherit the origin/referrer of Discord.com which Discord
        // uses to block requests to webhooks by default. Checked per hop so a redirect into a
        // webhook URL is caught too.
        if (isWebhookUrl(uri)) {
            reject(new Error("Failed to fetch"));
            return;
        }

        const httpModule = uri.startsWith("http:") ? http : uri.startsWith("https:") ? https : null;
        if (!httpModule) {
            reject(new Error(`Unsupported protocol: ${uri.slice(0, uri.indexOf(":"))}:`));
            return;
        }

        const request = httpModule.request(uri, {
            headers,
            method,
            timeout,
            rejectUnauthorized: init.rejectUnauthorized
        }, (res) => {
            if (redirectCodes.has(res.statusCode!)) {
                if (init.redirect === "error") {
                    res.destroy();
                    request.destroy(new Error("Failed to fetch"));
                    return;
                }
                if (init.redirect === "manual") {
                    resolve(out(uri, res));
                    return;
                }
                if (redirectCount >= maxRedirects) {
                    res.resume();
                    reject(new Error(`Maximum amount of redirects reached (${maxRedirects})`));
                    return;
                }

                if (res.headers.location) {
                    let final: URL;
                    try {
                        final = redirectUrl(res.headers.location, uri);
                    }
                    catch (error) {
                        res.resume();
                        reject(error);
                        return;
                    }

                    const transition = redirectMethod(res.statusCode!, method);
                    if (sendBody && transition.keepBody) {
                        reject(new Error("Request body cannot be replayed across redirects"));
                        res.resume();
                        return;
                    }
                    const current = new URL(uri);
                    const nextHeaders = redirectHeaders(headers, current, final, transition.keepBody);
                    redirectCount++;
                    res.resume();
                    return execute(final.href, transition.method, sendBody && transition.keepBody, nextHeaders).catch(reject);
                }
            }

            resolve(out(uri, res));
        });

        request.shouldKeepAlive = init.keepalive;

        if (dryAbortSignal) {
            const undo = dryAbortSignal.addListener(() => {
                request.destroy(dryAbortSignal.reason() || new Error("Request was aborted"));
            });

            request.once("close", () => undo());
        }

        request.once("timeout", () => request.destroy(new Error("Request timed out")));

        request.once("error", (err) => reject(err));

        if (body && sendBody) {
            const reader = body.getReader();
            const cancelUpload = () => {void reader.cancel(new Error("Request closed")).catch(() => {});};
            request.once("error", cancelUpload);
            request.once("close", cancelUpload);
            try {
                while (true) {
                    const {done, value} = await reader.read();
                    if (done) break;
                    if (request.destroyed) throw new Error("Request was closed");
                    if (!request.write(value)) await waitForUploadDrain(request);
                }

                request.end();
            }
            catch (error) {
                await reader.cancel(error).catch(() => {});
                request.destroy(error as Error);
            }
            finally {request.off("error", cancelUpload); request.off("close", cancelUpload); reader.releaseLock();}
        }
        else {request.end();}
    }

    void execute(url, init.method ?? "GET", Boolean(body)).catch(reject);

    return promise;
}
