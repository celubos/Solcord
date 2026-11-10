import * as https from "https";
import * as http from "http";
import type {RequestCallback, RequestOptions} from "@common/types/ipc";
import {REDIRECT_CODES, redirectMethod, redirectHeaders, redirectUrl} from "@common/redirect-policy";
import {isWebhookUrl} from "./webhook";

const methods = ["get", "put", "post", "delete", "head"] as const;
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const dataToClone: Array<keyof http.IncomingMessage> = ["statusCode", "statusMessage", "url", "headers", "method", "aborted", "complete", "rawHeaders"];

const request = function (url: string, options: RequestOptions, callback: RequestCallback) {
    let active: http.ClientRequest | undefined;
    let response: http.IncomingMessage | undefined;
    const destinations = new Map<NodeJS.WritableStream,() => void>();
    let settled = false;
    let stopped = false;
    const finish = (error: Error | null, metadata?: Record<string, any>, body?: Buffer) => {
        if (settled) return;
        settled = true;
        for (const [stream, cancel] of destinations) {stream.off("close", cancel); stream.off("error", cancel);}
        destinations.clear();
        callback(error as Error, metadata, body);
    };
    const execute = (uri: string, current: RequestOptions, hops: number) => {
        if (stopped) return;
        let target: URL;
        try {
            target = new URL(uri);
            if (!["http:", "https:"].includes(target.protocol) || target.username || target.password || isWebhookUrl(uri)) throw new Error("Failed to fetch");
        }
        catch (error) {finish(error as Error); return;}
        const transport = target.protocol === "https:" ? https : http;
        const req = active = transport.request(uri, {...current, timeout: current.timeout ?? 8_000}, res => {
            response = res;
            if (REDIRECT_CODES.has(res.statusCode ?? 0) && res.headers.location) {
                try {
                    if (hops >= 20) throw new Error("Maximum amount of redirects reached (20)");
                    const next = redirectUrl(res.headers.location, uri);
                    const transition = redirectMethod(res.statusCode!, current.method ?? "GET");
                    if (current.formData && transition.keepBody) throw new Error("Request body cannot be replayed across redirects");
                    if (Array.isArray(current.headers)) throw new TypeError("Redirects require named headers");
                    const nextOptions: RequestOptions = {...current,
method: transition.method,
                        headers: redirectHeaders(current.headers as http.OutgoingHttpHeaders | undefined, target, next, transition.keepBody),
                        formData: transition.keepBody ? current.formData : undefined};
                    delete nextOptions.hostname; delete nextOptions.host; delete nextOptions.port; delete nextOptions.path; delete nextOptions.protocol;
                    if (target.origin !== next.origin) delete nextOptions.auth;
                    res.resume();
                    execute(next.href, nextOptions, hops + 1);
                }
                catch (error) {res.destroy(); finish(error as Error);}
                return;
            }
            const chunks: Buffer[] = [];
            let total = 0;
            for (const stream of destinations.keys()) res.pipe(stream);
            res.once("error", error => finish(error));
            res.once("aborted", () => finish(new Error("Response was aborted")));
            res.on("data", chunk => {
                if (destinations.size) return;
                total += chunk.length;
                if (total > MAX_BODY_BYTES) {req.destroy(new RangeError("Response exceeds the buffered request limit")); return;}
                chunks.push(Buffer.from(chunk));
            });
            res.once("end", () => finish(null, Object.fromEntries(dataToClone.map(key => [key, res[key]])), Buffer.concat(chunks, total)));
        });
        req.once("timeout", () => req.destroy(new Error("Request timed out")));
        req.once("error", error => finish(error));
        req.end(current.formData);
    };
    execute(url, options ?? {}, 0);
    const abort = () => {stopped = true; response?.destroy(); active?.destroy(new Error("Request was aborted"));};
    return {
        end() {active?.end();},
        abort,
        destroy: abort,
        pipe(stream: NodeJS.WritableStream) {
            if (!destinations.has(stream) && !settled) {
                const cancel = () => {
                    stream.off("close", cancel); stream.off("error", cancel);
                    destinations.delete(stream);
                    response?.unpipe(stream);
                    if (!destinations.size) abort();
                };
                destinations.set(stream, cancel);
                stream.once("close", cancel); stream.once("error", cancel);
                response?.pipe(stream);
            }
            return stream;
        }
    };
};

type HttpsModule = {request: typeof request;} & {[M in typeof methods[number]]: typeof request;};
export default Object.assign({request}, Object.fromEntries(methods.map(method => [method,
    function (this: HttpsModule, ...args: any[]) {
        args[1] ??= {};
        args[1].method ??= method.toUpperCase();
        return Reflect.apply(request, this, args);
    }
]))) as HttpsModule;
