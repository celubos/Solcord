// SPDX-License-Identifier: Apache-2.0

import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, dirname, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = resolve(root, "tests/fixtures/solcord-control-center.html");
const output = resolve(process.argv[2] || resolve(root, "outputs/solcord-ui-fixture"));
const candidates = process.platform === "win32"
    ? [
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        "C:/Program Files/Microsoft/Edge/Application/msedge.exe"
    ]
    : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
const browser = process.env.SOLCORD_UI_BROWSER || candidates.find(existsSync);
if (!browser) throw new Error("No supported headless Chromium browser was found. Set SOLCORD_UI_BROWSER to an absolute executable path.");
if (!existsSync(fixture)) throw new Error(`Fixture is missing: ${fixture}`);

const scenarios = [
    ...["modern", "legacy"].flatMap(tokens => ["dark", "light"].map(host => ({name: `host-palette-${tokens}-${host}`, width: 1282, height: 720, query: `tokens=${tokens}&host=${host}`, fixture: "solcord-host-palette.html"}))),
    {name: "host-palette-modern-dark-narrow", width: 940, height: 540, query: "tokens=modern&host=dark", fixture: "solcord-host-palette.html"},
    ...["solcord-dark", "solcord-light", "oled"].map(mode => ({name: `host-palette-custom-${mode}`, width: 1282, height: 720, query: `tokens=modern&host=dark&mode=${mode}`, fixture: "solcord-host-palette.html"})),
    ...["on", "off", "reduced", "drift"].map(variant => ({name: `ambient-shell-${variant}`, width: 960, height: 900, query: `variant=${variant}`, fixture: "solcord-ambient-shell.html"})),
    {name: "ambient-shell-light", width: 960, height: 900, query: "variant=on&mode=solcord-light", fixture: "solcord-ambient-shell.html"},
    {name: "overview-dark-1366x768", width: 1366, height: 768, query: "workspace=overview&state=healthy&mode=solcord-dark&scale=100"},
    {name: "diagnostic-overview-dark-320-container", width: 500, height: 720, query: "workspace=overview&state=healthy&mode=solcord-dark&diagnostic=1&fixtureWidth=320&scale=100"},
    {name: "setup-dark-1280x720", width: 1280, height: 720, query: "workspace=overview&state=wizard&mode=solcord-dark&scale=100"},
    {name: "privacy-light-1920x1080", width: 1920, height: 1080, query: "workspace=privacy&state=degraded&mode=solcord-light&scale=100"},
    {name: "voice-oled-1280x720", width: 1280, height: 720, query: "workspace=voice&state=healthy&mode=oled&scale=100"},
    {name: "voice-light-narrow-320-container", width: 500, height: 1200, query: "workspace=voice&state=healthy&mode=solcord-light&motion=reduced&fixtureWidth=320&scale=200"},
    {name: "recovery-dark-1280x720", width: 1280, height: 720, query: "workspace=recovery&state=degraded&mode=solcord-dark&scale=100"},
    {name: "appearance-light-long-320-container", width: 500, height: 900, query: "workspace=appearance&state=healthy&mode=solcord-light&motion=reduced&long=1&fixtureWidth=320&scale=100"},
    {name: "extensions-dark-640x720", width: 640, height: 720, query: "workspace=extensions&state=healthy&mode=solcord-dark&scale=100"},
    {name: "setup-dark-680x520-compact", width: 680, height: 520, query: "workspace=overview&state=wizard&mode=solcord-dark&fixtureWidth=640&scale=125"},
    {name: "privacy-light-compact-short-320x568", width: 500, height: 568, query: "workspace=privacy&state=degraded&mode=solcord-light&fixtureWidth=320&scale=200"},
    {name: "performance-dark-1024x768", width: 1024, height: 768, query: "workspace=performance&state=healthy&mode=solcord-dark&scale=100"},
    {name: "performance-light-1850x1240", width: 1850, height: 1240, query: "workspace=performance&state=healthy&mode=solcord-light&scale=100"},
    {name: "performance-light-long-320-container", width: 500, height: 900, query: "workspace=performance&state=healthy&mode=solcord-light&long=1&fixtureWidth=320&scale=100"},
    {name: "chat-dark-1366x768", width: 1366, height: 768, query: "workspace=chat&state=healthy&mode=solcord-dark&scale=100"},
    {name: "friends-dark-1024x768", width: 1024, height: 768, query: "workspace=friends&state=healthy&mode=solcord-dark&scale=100"},
    {name: "overview-dark-effective-125", width: 1093, height: 614, query: "workspace=overview&state=degraded&mode=solcord-dark&scale=125"},
    {name: "privacy-light-effective-150", width: 911, height: 512, query: "workspace=privacy&state=degraded&mode=solcord-light&scale=150"},
    {name: "recovery-dark-effective-200", width: 683, height: 384, query: "workspace=recovery&state=degraded&mode=solcord-dark&scale=200"},
    {name: "theme-solcord-default", width: 960, height: 720, query: "workspace=overview&state=healthy&mode=follow-discord&theme=solcord-default&switches=1&scale=100"},
    {name: "theme-obsidian-thread", width: 960, height: 720, query: "workspace=privacy&state=healthy&mode=follow-discord&theme=obsidian-thread&switches=1&scale=100"},
    {name: "theme-carbon-ember", width: 960, height: 720, query: "workspace=chat&state=healthy&mode=follow-discord&theme=carbon-ember&switches=1&scale=100"},
    {name: "theme-midnight-glass", width: 960, height: 720, query: "workspace=voice&state=healthy&mode=follow-discord&theme=midnight-glass&switches=1&scale=100"},
    {name: "theme-paper-signal", width: 960, height: 720, query: "workspace=friends&state=healthy&mode=follow-discord&theme=paper-signal&switches=1&scale=100"},
    {name: "theme-threadline", width: 960, height: 720, query: "workspace=extensions&state=healthy&mode=follow-discord&theme=threadline&switches=1&scale=100"},
    {name: "theme-signal-block", width: 960, height: 720, query: "workspace=recovery&state=degraded&mode=follow-discord&theme=signal-block&switches=1&scale=100"},
    {name: "theme-relay-classic", width: 960, height: 720, query: "workspace=performance&state=healthy&mode=follow-discord&theme=relay-classic&switches=1&scale=100"},
    {name: "theme-workshop", width: 960, height: 720, query: "workspace=overview&state=wizard&mode=follow-discord&theme=workshop&switches=1&scale=100"},
    {name: "theme-quiet-read", width: 960, height: 720, query: "workspace=appearance&state=healthy&mode=follow-discord&theme=quiet-read&motion=reduced&switches=1&scale=100"},
    {name: "theme-night-transit", width: 960, height: 720, query: "workspace=voice&state=degraded&mode=follow-discord&theme=night-transit&switches=1&scale=100"}
];

mkdirSync(output, {recursive: true});
const records = [];

function invoke(url, scenario, extraArgs) {
    const profile = mkdtempSync(resolve(tmpdir(), "solcord-ui-"));
    try {
        return execFileSync(browser, [
            "--headless=new",
            "--disable-gpu",
            "--disable-background-networking",
            "--disable-component-update",
            "--disable-default-apps",
            "--disable-extensions",
            "--disable-sync",
            "--metrics-recording-only",
            "--no-default-browser-check",
            "--no-first-run",
            `--user-data-dir=${profile}`,
            `--window-size=${scenario.width},${scenario.height}`,
            "--virtual-time-budget=1200",
            ...extraArgs,
            url
        ], {encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 30_000, windowsHide: true});
    }
    finally {
        rmSync(profile, {recursive: true, force: true});
    }
}

for (const scenario of scenarios) {
    const scenarioFixture = scenario.fixture ? resolve(root, "tests/fixtures", scenario.fixture) : fixture;
    const url = `${pathToFileURL(scenarioFixture).href}?${scenario.query}`;
    const screenshot = resolve(output, `${scenario.name}.png`);
    invoke(url, scenario, [`--screenshot=${screenshot}`]);
    const dom = invoke(url, scenario, ["--dump-dom"]);
    const encoded = dom.match(/data-fixture-result="([A-Za-z0-9+/=]+)"/)?.[1];
    if (!encoded) {
        const encodedError = dom.match(/data-fixture-error="([A-Za-z0-9+/=]+)"/)?.[1];
        const detail = encodedError ? Buffer.from(encodedError, "base64").toString("utf8") : "No browser-side error was published.";
        throw new Error(`The ${scenario.name} fixture did not publish a measurement result. ${detail}`);
    }
    const measurement = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    records.push({...scenario, screenshot: basename(screenshot), measurement});
}

const failed = records.filter(record => !record.measurement.pass);
const manifest = {
    generatedAt: new Date().toISOString(),
    evidenceKind: "isolated representative fixture using the production Solcord stylesheet; not live Discord acceptance",
    browser,
    fixture: fixture.slice(root.length + 1).replaceAll("\\", "/"),
    records,
    pass: failed.length === 0
};
writeFileSync(resolve(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(resolve(output, "README.txt"), [
    "SOLCORD UI FIXTURE EVIDENCE",
    "",
    "These captures use the production Solcord CSS with representative static Discord variables and DOM.",
    "They test geometry, overflow, contrast, focusability, responsive containment, and reduced-motion tokens.",
    "They do not prove live Discord selectors, runtime adapters, installer behavior, or owner-profile acceptance.",
    "",
    `Browser: ${browser}`,
    `Manifest: ${resolve(output, "manifest.json")}`,
    `Result: ${failed.length ? `FAIL (${failed.map(record => record.name).join(", ")})` : "PASS"}`
].join("\n"));

console.log(`${failed.length ? "FAIL" : "PASS"}: ${records.length} isolated UI fixture scenario(s).`);
console.log(resolve(output, "manifest.json"));
if (failed.length) process.exitCode = 1;
