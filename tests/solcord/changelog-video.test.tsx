import {afterEach, describe, expect, test} from "bun:test";
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import ChangelogVideo, {isYoutubeEmbed} from "../../src/betterdiscord/ui/modals/changelog-video";

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean;}).IS_REACT_ACT_ENVIRONMENT = true;
(window as unknown as {happyDOM: {settings: {disableIframePageLoading: boolean;}};}).happyDOM.settings.disableIframePageLoading = true;
let root: Root | undefined;
afterEach(async () => {if (root) await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren();});
describe("changelog media boundaries", () => {
    test("only HTTPS exact YouTube embed hosts and paths qualify for an iframe", () => {
        expect(isYoutubeEmbed("https://www.youtube.com/embed/abc-123_foo")).toBe(true);
        expect(isYoutubeEmbed("https://www.youtube-nocookie.com/embed/abc123")).toBe(true);
        for (const url of ["https://youtube.com.attacker.test/embed/abc", "https://attacker.test/video?youtube.com", "http://youtube.com/embed/abc", "https://youtube.com/watch?v=abc", "https://user:password@youtube.com/embed/abc"]) expect(isYoutubeEmbed(url)).toBe(false);
    });

    test("YouTube makes no request before the user's explicit load action and removes capabilities", async () => {
        const host = document.createElement("div"); root = createRoot(host);
        await act(async () => root!.render(<ChangelogVideo src="https://www.youtube.com/embed/abc123?autoplay=1&origin=https://private.test" />));
        expect(host.querySelector("iframe")).toBeNull();
        expect(host.querySelector("button")?.textContent).toBe("Load YouTube video");
        await act(async () => host.querySelector("button")!.click());
        const iframe = host.querySelector("iframe")!;
        expect(iframe.src).toBe("https://www.youtube-nocookie.com/embed/abc123");
        expect(iframe.allow).not.toContain("clipboard"); expect(iframe.allow).not.toContain("autoplay"); expect(iframe.allow).not.toContain("web-share");
        expect(iframe.referrerPolicy).toBe("no-referrer");
        await act(async () => root!.render(null)); expect(host.querySelector("iframe")).toBeNull();
    });

    test("direct MP4 and unrelated matching-query sources use native controls without preloading", async () => {
        const host = document.createElement("div"); root = createRoot(host);
        for (const src of ["https://media.example.test/movie.mp4", "https://other.example.test/movie.mp4?source=youtube.com"]) {
            await act(async () => root!.render(<ChangelogVideo src={src} />));
            expect(host.querySelector("iframe")).toBeNull();
            expect(host.querySelector("video")?.controls).toBe(true);
            expect(host.querySelector("video")?.preload).toBe("none");
        }
    });
});
