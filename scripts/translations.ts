import fs from "fs";
import path from "path";
import crypto from "node:crypto";
const localeFolder = path.join(__dirname, "..", "assets", "locales");

const HOST = "api.poeditor.com";
const LIST = "/v2/languages/list";
const EXPORT = "/v2/projects/export";

/* eslint-disable no-multi-spaces */
export const editorMap = {
    "en-us": "en-us.json",   // English, US
    "en": "en-gb.json",      // English, UK
    "zh-Hans": "zh-cn.json", // Chinese, Simplified
    "zh-Hant": "zh-tw.json", // Chinese, Traditional
    "cs": "cs.json",         // Czech
    "da": "da.json",         // Danish
    "nl": "nl.json",         // Dutch
    "fr": "fr.json",         // French
    "de": "de.json",         // German
    "el": "el.json",         // Greek
    "hu": "hu.json",         // Hungarian
    "it": "it.json",         // Italian
    "ja": "ja.json",         // Japanese
    "ko": "ko.json",         // Korean
    "pl": "pl.json",         // Polish
    "pt": "pt-pt.json",      // Portuguese, Portugal
    "pt-br": "pt-br.json",   // Protuguese, Brazil
    "ru": "ru.json",         // Russian
    "sk": "sk.json",         // Slovak
    "es": "es-es.json",      // Spanish (Spain)
    "es-419": "es-419.json", // Spanish (LATAM)
    "sv": "sv-se.json",      // Swedish
    "tr": "tr.json",         // Turkish
    "bg": "bg.json",         // Bulgarian
    "uk": "uk.json",         // Ukrainian
    "fi": "fi.json",         // Finnish
    "no": "no.json",         // Norwegian
    "hr": "hr.json",         // Croation
    "ro": "ro.json",         // Romanian
    "lt": "lt.json",         // Lithuanian
    "th": "th.json",         // Thai
    "vi": "vi.json",         // Vietnamese
    "hi": "hi.json",         // Hindi
};
/* eslint-enable no-multi-spaces */

interface TranslationOptions {
    directory?: string;
    fetchImpl?: typeof fetch;
    apiToken?: string;
    projectId?: string;
    maximumBytes?: number;
    timeoutMs?: number;
}

export async function downloadTranslationJson(url: URL, request: RequestInit = {}, options: TranslationOptions = {}): Promise<unknown> {
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Translation URLs must use HTTPS without URL credentials.");
    const maximum = options.maximumBytes ?? 5 * 1024 * 1024;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {controller.abort(); reject(new Error("Translation download timed out."));}, options.timeoutMs ?? 15_000);
    });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let complete = false;
    try {
        const response = await Promise.race([(options.fetchImpl ?? fetch)(url, {...request, redirect: "error", signal: controller.signal}), deadline]);
        reader = response.body?.getReader();
        if (!response.ok) throw new Error(`Translation service returned HTTP ${response.status}.`);
        if (!reader) throw new Error("Translation response has no body.");
        if (Number(response.headers.get("content-length") || 0) > maximum) throw new Error("Translation response exceeds its byte limit.");
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
            const {done, value} = await Promise.race([reader.read(), deadline]);
            if (done) break;
            total += value.byteLength;
            if (total > maximum) throw new Error("Translation response exceeds its byte limit.");
            chunks.push(value);
        }
        const result: unknown = JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
        complete = true;
        return result;
    }
    finally {
        clearTimeout(timer);
        if (!complete) {controller.abort(); void reader?.cancel().catch(() => {});}
        reader?.releaseLock();
    }
}

function record(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function validLocale(value: unknown, depth = 0): boolean {
    if (typeof value === "string") return true;
    return depth < 32 && record(value) && Object.values(value).every(child => validLocale(child, depth + 1));
}

export async function updateTranslations(options: TranslationOptions = {}) {
    const apiToken = options.apiToken ?? process.env.POEDITOR_API_KEY;
    const projectId = options.projectId ?? process.env.POEDITOR_PROJECT_ID;
    if (!apiToken || !projectId) throw new Error("Set POEDITOR_API_KEY and POEDITOR_PROJECT_ID before exporting translations.");
    const request = (endpoint: string, fields: Record<string, string> = {}) => downloadTranslationJson(new URL(`https://${HOST}${endpoint}`), {
        method: "POST", headers: {"content-type": "application/x-www-form-urlencoded"}, body: new URLSearchParams({...fields, api_token: apiToken, id: projectId}).toString()
    }, options);
    const list = await request(LIST);
    if (!record(list) || !record(list.result) || !Array.isArray(list.result.languages)) throw new Error("Translation language list is invalid.");
    const languages = list.result.languages.map(language => {
        if (!record(language) || typeof language.code !== "string" || !Object.hasOwn(editorMap, language.code)) throw new Error("Translation service returned an unmapped language.");
        return language.code as keyof typeof editorMap;
    });
    if (new Set(languages).size !== languages.length) throw new Error("Translation service returned duplicate languages.");
    const directory = path.resolve(options.directory ?? localeFolder);
    const staged: Array<{file: string; text: string; previous: Buffer | null}> = [];
    for (const code of languages) {
        const result = await request(EXPORT, {language: code, type: "key_value_json", filters: "translated"});
        if (!record(result) || !record(result.result) || typeof result.result.url !== "string") throw new Error("Translation export response is invalid.");
        // Keep the full signed URL, including its query; never forward API credentials.
        const translated = await downloadTranslationJson(new URL(result.result.url), {}, options);
        if (!record(translated) || !validLocale(translated)) throw new Error("Translation export must be a JSON object containing only string leaves.");
        const file = path.join(directory, editorMap[code]);
        if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error("Translation export refuses linked locale files.");
        staged.push({file, text: `${JSON.stringify(translated, null, 4)}\n`, previous: fs.existsSync(file) ? fs.readFileSync(file) : null});
    }
    // Nothing is written until every locale has downloaded and validated.
    const committed: typeof staged = [];
    try {
        for (const item of staged) {
            const temporary = `${item.file}.${crypto.randomUUID()}.tmp`;
            try {fs.writeFileSync(temporary, item.text, {flag: "wx"}); fs.renameSync(temporary, item.file);}
            finally {if (fs.existsSync(temporary)) fs.unlinkSync(temporary);}
            committed.push(item);
        }
    }
    catch (error) {
        for (const item of committed.reverse()) {
            if (fs.readFileSync(item.file, "utf8") !== item.text) throw new AggregateError([error], "A locale changed during failed publication; owner bytes were preserved.");
            if (item.previous) {
                const recovery = `${item.file}.${crypto.randomUUID()}.tmp`;
                try {fs.writeFileSync(recovery, item.previous, {flag: "wx"}); fs.renameSync(recovery, item.file);}
                finally {if (fs.existsSync(recovery)) fs.unlinkSync(recovery);}
            }
            else {fs.unlinkSync(item.file);}
        }
        throw error;
    }
    return staged.map(item => path.basename(item.file));
}

if (import.meta.main) updateTranslations().then(files => console.log(`Updated ${files.length} validated translations.`)).catch(error => {console.error(error.message); process.exitCode = 1;});
