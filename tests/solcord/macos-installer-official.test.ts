import {describe, expect, test} from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {downloadOfficialMacDMG, isOfficialMacDownloadURL} from "../../scripts/verify-solcord-macos-official";

const CDN = "https://stable.dl2.discordapp.net/distro/app/stable/osx/universal/0.0.421/Discord.dmg";
describe("official macOS bundle download boundary", () => {
    test("only the observed official stable macOS API and CDN shapes are allowed", () => {
        expect(isOfficialMacDownloadURL(CDN, "arm64")).toBe(true);
        expect(isOfficialMacDownloadURL("https://discord.com/api/downloads/distributions/app/installers/latest?arch=x64&channel=stable&platform=osx", "x64")).toBe(true);
        for (const url of ["http://discord.com/api/download?platform=osx", "https://discord.com.evil.test/api/download?platform=osx", "https://user:secret@discord.com/api/download?platform=osx", CDN + "?credential=value", CDN.replace("stable.dl2", "unverified"), CDN.replace("/stable/", "/canary/"), "https://discord.com/api/downloads/distributions/app/installers/latest?arch=x64&channel=stable&platform=osx&extra=1"]) expect(isOfficialMacDownloadURL(url, "arm64")).toBe(false);
    });
    test("redirects stay allowlisted, omit credentials and stream the exact bounded bytes", async () => {
        const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "solcord-official-download-test-"))), file = path.join(folder, "Discord.dmg");
        const calls: Array<{url: string; options: RequestInit;}> = [];
        const result = await downloadOfficialMacDMG(file, "arm64", {fetcher: async (url, options) => {calls.push({url, options}); return calls.length === 1 ? new Response(null, {status: 302, headers: {location: CDN}}) : new Response("controlled-dmg");}});
        expect(fs.readFileSync(file, "utf8")).toBe("controlled-dmg"); expect(result.bytes).toBe(14); expect(result.url).toBe(CDN);
        expect(calls).toHaveLength(2); expect(calls.every(call => call.options.credentials === "omit" && call.options.redirect === "manual")).toBe(true);
    });
    test("an untrusted redirect is never fetched and an oversized body stops before accepting an image", async () => {
        const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "solcord-official-download-test-"))); let requests = 0;
        await expect(downloadOfficialMacDMG(path.join(folder, "outside.dmg"), "arm64", {fetcher: async () => {requests++; return new Response(null, {status: 302, headers: {location: "https://other.test/Discord.dmg"}});}})).rejects.toThrow("allowlist");
        expect(requests).toBe(1); expect(fs.existsSync(path.join(folder, "outside.dmg"))).toBe(false);
        await expect(downloadOfficialMacDMG(path.join(folder, "large.dmg"), "arm64", {maximumBytes: 4, fetcher: async () => new Response("too-large")})).rejects.toThrow("byte limit");
    });
    test("redirect loops, empty images and existing destination files fail closed", async () => {
        const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "solcord-official-download-test-"))); let requests = 0;
        await expect(downloadOfficialMacDMG(path.join(folder, "loop.dmg"), "arm64", {fetcher: async () => {requests++; return new Response(null, {status: 302, headers: {location: CDN}});}})).rejects.toThrow("redirect limit"); expect(requests).toBe(5);
        await expect(downloadOfficialMacDMG(path.join(folder, "empty.dmg"), "arm64", {fetcher: async () => new Response("")})).rejects.toThrow("empty");
        const file = path.join(folder, "owner.dmg"); fs.writeFileSync(file, "preserve-me");
        await expect(downloadOfficialMacDMG(file, "arm64", {fetcher: async () => new Response("new")})).rejects.toThrow(); expect(fs.readFileSync(file, "utf8")).toBe("preserve-me");
    });
});
