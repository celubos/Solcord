// SPDX-License-Identifier: Apache-2.0

import type {SolcordBaselinePreferences, SolcordLayoutRegion} from "@common/solcord/product";

import {SolcordDisposalScope} from "./disposal";

const MESSAGE_LINK = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(?:@me|\d{1,32})\/(\d{1,32})\/(\d{1,32})(?:[/?#]|$)/i;
const REGION_CLASSES: Readonly<Record<SolcordLayoutRegion, string>> = Object.freeze({
    guilds: "solcord-layout-hide-guilds",
    channels: "solcord-layout-hide-channels",
    members: "solcord-layout-hide-members"
});
const LAYOUT_TARGET_CLASS = "solcord-layout-region-hidden";
const MESSAGE_CONTAINER_SELECTOR = "[id^=\"chat-messages-\"], [data-list-item-id^=\"chat-messages\"], [class*=\"messageListItem_\"]";
const EMBED_ROOT_CLASS = /^(?:embed|embedFull|embedWrapper|inlineMediaEmbed)[_-]/i;

export interface SolcordLoadedMessage {
    id?: string;
    content?: string;
    author?: {globalName?: string; username?: string;};
    timestamp?: string | number | Date;
}

export interface SolcordBaselineSuiteAdapter {
    getLoadedMessage?(channelId: string, messageId: string): SolcordLoadedMessage | undefined;
}

export interface SolcordBaselineSuiteStatus {
    active: boolean;
    resources: Record<string, number>;
    enabled: string[];
    unavailable: string[];
}

export function parseLoadedDiscordMessageLink(value: string): {channelId: string; messageId: string;} | undefined {
    const match = MESSAGE_LINK.exec(value.trim());
    return match ? {channelId: match[1], messageId: match[2]} : undefined;
}

function scrollableAncestor(target: EventTarget | null): HTMLElement | undefined {
    let node = target instanceof HTMLElement ? target : undefined;
    while (node && node !== document.body) {
        const style = getComputedStyle(node);
        if (node.scrollHeight > node.clientHeight + 8 && /(auto|scroll)/.test(style.overflowY)) return node;
        node = node.parentElement ?? undefined;
    }
}

function labelledLandmark(root: ParentNode, pattern: RegExp, excluded?: RegExp): HTMLElement | undefined {
    for (const candidate of root.querySelectorAll<HTMLElement>("nav[aria-label], aside[aria-label], [role=\"navigation\"][aria-label], [role=\"complementary\"][aria-label]")) {
        const label = candidate.getAttribute("aria-label")?.trim() ?? "";
        if (pattern.test(label) && !excluded?.test(label)) return candidate;
    }
}

function structuralContainer(seed: Element | null, selector: string): HTMLElement | undefined {
    const candidate = seed?.closest<HTMLElement>(selector);
    return candidate && candidate !== document.body && candidate !== document.documentElement ? candidate : undefined;
}

/**
 * Resolve only landmarks whose role or stable list identity proves the requested
 * Discord shell region. Hashed classes are last-resort evidence, never the sole
 * signal for the server or channel rails.
 */
export function resolveSolcordLayoutTarget(root: ParentNode, region: SolcordLayoutRegion): HTMLElement | undefined {
    if (region === "guilds") {
        const list = root.querySelector<HTMLElement>("[data-list-id=\"guildsnav\"], [data-list-id^=\"guildsnav-\"]");
        const landmark = structuralContainer(list, "nav, [role=\"navigation\"]");
        return landmark ?? labelledLandmark(root, /(?:server|guild)/i);
    }
    if (region === "channels") {
        const list = root.querySelector<HTMLElement>("[data-list-id^=\"channels\"], [data-list-id^=\"private-channels\"]");
        const landmark = structuralContainer(list, "nav, [role=\"navigation\"]");
        return landmark ?? labelledLandmark(root, /(?:channel|direct message|private)/i, /(?:server|guild)/i);
    }
    const list = root.querySelector<HTMLElement>("[data-list-id^=\"members\"]");
    const landmark = structuralContainer(list, "aside, [role=\"complementary\"]");
    if (landmark) return landmark;
    const labelled = labelledLandmark(root, /member/i);
    if (labelled) return labelled;
    const classCandidate = root.querySelector<HTMLElement>("[class*=\"membersWrap_\"]");
    return classCandidate?.querySelector("[role=\"list\"], [data-list-id^=\"members\"]") ? classCandidate : undefined;
}

function richEmbedEvidence(candidate: HTMLElement): boolean {
    const message = candidate.closest<HTMLElement>(MESSAGE_CONTAINER_SELECTOR);
    if (!message || candidate === message) return false;
    const rootClass = [...candidate.classList].some(token => EMBED_ROOT_CLASS.test(token));
    const article = candidate.tagName === "ARTICLE";
    if (!rootClass && !article) return false;
    return Boolean(candidate.querySelector("a[href^=\"https://\"], a[href^=\"http://\"], img, video, [role=\"img\"], [class*=\"embedMedia_\"]"));
}

/** Return the outermost structurally verified rich-embed roots on loaded messages. */
export function resolveSolcordEmbedTargets(root: ParentNode): HTMLElement[] {
    const verified = [...root.querySelectorAll<HTMLElement>("article, [class*=\"embed\"]")].filter(richEmbedEvidence);
    const candidates = new Set(verified);
    return verified.filter(candidate => {
        for (let parent = candidate.parentElement; parent; parent = parent.parentElement) {
            if (candidates.has(parent)) return false;
            if (parent.matches(MESSAGE_CONTAINER_SELECTOR)) break;
        }
        return true;
    });
}

function createBoundedAnimationScheduler(scope: SolcordDisposalScope, callback: () => void): () => void {
    let active = true;
    let scheduled = false;
    let frame = 0;
    let fallback = 0;
    const run = () => {
        if (!active || !scheduled) return;
        scheduled = false;
        if (frame) cancelAnimationFrame(frame);
        if (fallback) window.clearTimeout(fallback);
        frame = 0;
        fallback = 0;
        callback();
    };
    const schedule = () => {
        if (!active || scheduled) return;
        scheduled = true;
        frame = requestAnimationFrame(run);
        fallback = window.setTimeout(run, 120);
    };
    scope.own(() => {
        active = false;
        scheduled = false;
        if (frame) cancelAnimationFrame(frame);
        if (fallback) window.clearTimeout(fallback);
        frame = 0;
        fallback = 0;
    }, "timer");
    return schedule;
}

export class SolcordBaselineSuite {
    #scope?: SolcordDisposalScope;
    #preferences?: string;
    #status: SolcordBaselineSuiteStatus = {active: false, resources: {}, enabled: [], unavailable: []};
    #runtimeIssues = new Map<string, string>();
    #statusReconcilers = new Set<() => void>();

    constructor(private readonly adapter: SolcordBaselineSuiteAdapter) {}

    matchesPreferences(preferences: SolcordBaselinePreferences): boolean {
        return this.#preferences === this.#configuration(preferences);
    }

    #configuration(preferences: SolcordBaselinePreferences): string {
        return JSON.stringify({
            layoutCollapse: preferences.layoutCollapse,
            collapsedRegions: preferences.layoutCollapse ? [...preferences.collapsedRegions].sort() : [],
            embedControls: preferences.embedControls,
            crossPlatformAutoscroll: preferences.crossPlatformAutoscroll,
            messageLinkPreview: preferences.messageLinkPreview
        });
    }

    start(preferences: SolcordBaselinePreferences): SolcordBaselineSuiteStatus {
        if (this.matchesPreferences(preferences)) return this.status();
        this.stop();
        this.#runtimeIssues.clear();
        const scope = new SolcordDisposalScope();
        const enabled: string[] = [];
        const unavailable: string[] = [];
        this.#scope = scope;

        if (preferences.layoutCollapse) {
            if (preferences.collapsedRegions.length) {
                enabled.push("Layout Collapse");
                this.#startLayout(scope, preferences.collapsedRegions);
            }
            else {
                unavailable.push("Layout Collapse: select at least one region; no layout adapter is running.");
            }
        }
        if (preferences.embedControls) {
            enabled.push("Embed Controls");
            this.#startEmbedControls(scope);
        }
        if (preferences.crossPlatformAutoscroll) {
            enabled.push("Cross-platform Autoscroll");
            this.#startAutoscroll(scope);
        }
        if (preferences.messageLinkPreview) {
            if (this.adapter.getLoadedMessage) {
                enabled.push("Message Link Preview");
                this.#startMessageLinkPreview(scope);
            }
            else {unavailable.push("Message Link Preview: loaded message store unavailable");}
        }
        if (!enabled.length) {
            scope.dispose();
            this.#scope = undefined;
        }
        this.#status = {active: enabled.length > 0, resources: this.#scope?.counts() ?? {}, enabled, unavailable};
        this.#preferences = this.#configuration(preferences);
        return this.status();
    }

    status(): SolcordBaselineSuiteStatus {
        for (const reconcile of this.#statusReconcilers) reconcile();
        return structuredClone({...this.#status, resources: this.#scope?.counts() ?? {}, unavailable: [...this.#status.unavailable, ...this.#runtimeIssues.values()]});
    }

    stop(): void {
        const scope = this.#scope;
        this.#preferences = undefined;
        try {scope?.dispose();}
        catch (error) {
            this.#status = {active: false, resources: scope?.counts() ?? {}, enabled: [], unavailable: ["Previous cleanup is incomplete; retry before enabling another baseline adapter."]};
            throw error;
        }
        this.#scope = undefined;
        this.#statusReconcilers.clear();
        this.#runtimeIssues.clear();
        this.#status = {active: false, resources: {}, enabled: [], unavailable: []};
    }

    #setRuntimeIssue(key: string, detail?: string): void {
        if (detail) this.#runtimeIssues.set(key, detail);
        else this.#runtimeIssues.delete(key);
    }

    #startLayout(scope: SolcordDisposalScope, collapsed: readonly SolcordLayoutRegion[]): void {
        const root = document.documentElement;
        const targets = new Map<SolcordLayoutRegion, HTMLElement>();
        let suspended = false;
        const restore = document.createElement("button");
        const placeRestore = () => {
            let clearance = 12;
            // Discord's account panel grows when a call is active. Keep the
            // recovery control above its measured bounds, including at zoom.
            for (const panel of document.querySelectorAll<HTMLElement>("#app-mount [class*=\"panels_\"]")) {
                if (!panel.querySelector("button")) continue;
                const bounds = panel.getBoundingClientRect();
                if (bounds.width <= 0 || bounds.height <= 0 || bounds.left > 240 || bounds.right <= 12 || bounds.bottom < window.innerHeight - 72 || bounds.top <= 0) continue;
                clearance = Math.max(clearance, window.innerHeight - bounds.top + 12);
            }
            const bottom = `${Math.ceil(clearance)}px`;
            if (restore.style.bottom !== bottom) restore.style.bottom = bottom;
        };
        const clearTargets = () => {
            for (const target of targets.values()) target.classList.remove(LAYOUT_TARGET_CLASS);
            targets.clear();
            for (const target of document.querySelectorAll<HTMLElement>(`.${LAYOUT_TARGET_CLASS}`)) target.classList.remove(LAYOUT_TARGET_CLASS);
            root.classList.remove(...Object.values(REGION_CLASSES));
        };
        const scan = () => {
            if (suspended) return;
            for (const region of collapsed) {
                const next = resolveSolcordLayoutTarget(document, region);
                const previous = targets.get(region);
                if (previous && previous !== next) previous.classList.remove(LAYOUT_TARGET_CLASS);
                if (!next) {
                    targets.delete(region);
                    this.#setRuntimeIssue(`layout:${region}`, `Layout Collapse (${region}): this Discord build exposed no structurally verified target. Nothing was hidden.`);
                    continue;
                }
                next.classList.add(LAYOUT_TARGET_CLASS);
                targets.set(region, next);
                this.#setRuntimeIssue(`layout:${region}`);
            }
            placeRestore();
        };
        const schedule = createBoundedAnimationScheduler(scope, scan);
        scope.style("solcord-layout-collapse-runtime", `
            .${LAYOUT_TARGET_CLASS} { display: none !important; }
            .solcord-layout-restore { position: fixed; z-index: 2147483000; left: 12px; bottom: 12px; max-width: calc(100vw - 24px); min-height: 32px; padding: 6px 10px; color: var(--text-normal); background: var(--background-floating); border: 1px solid var(--border-subtle); border-radius: 6px; box-shadow: var(--elevation-high); font: inherit; cursor: pointer; }
            .solcord-layout-restore:focus-visible { outline: 2px solid var(--focus-primary, var(--brand-500)); outline-offset: 2px; }
        `);
        restore.type = "button";
        restore.className = "solcord-layout-restore";
        restore.textContent = "Show hidden panels";
        restore.title = "Temporarily show every Discord panel (Ctrl+Shift+L)";
        restore.setAttribute("aria-keyshortcuts", "Control+Shift+L");
        restore.hidden = collapsed.length === 0;
        const reveal = () => {
            suspended = true;
            clearTargets();
            restore.hidden = true;
            this.#setRuntimeIssue("layout:recovery", "Layout Collapse: panels are shown temporarily. Change the saved regions in Solcord settings before the adapter restarts.");
        };
        scope.element(restore);
        scope.listen(restore, "click", reveal);
        scope.listen(window, "resize", schedule);
        scope.listen(document, "keydown", event => {
            const key = event as KeyboardEvent;
            if (!key.ctrlKey || !key.shiftKey || key.altKey || key.code !== "KeyL") return;
            key.preventDefault();
            reveal();
        }, true);
        scan();
        this.#statusReconcilers.add(scan);
        scope.own(() => this.#statusReconcilers.delete(scan));
        const observer = new MutationObserver(schedule);
        scope.observe(observer, document.body, {childList: true, subtree: true});
        scope.own(() => {
            clearTargets();
        }, "element");
    }

    #startEmbedControls(scope: SolcordDisposalScope): void {
        scope.style("solcord-embed-controls-runtime", `
            .solcord-embed-control { position: absolute; z-index: 1; top: 4px; right: 4px; min-width: 28px; min-height: 24px; color: var(--interactive-normal); background: var(--background-secondary-alt); border: 1px solid var(--border-subtle); border-radius: 4px; cursor: pointer; }
            .solcord-embed-host { position: relative !important; }
            .solcord-embed-host.solcord-embed-collapsed > :not(.solcord-embed-control) { display: none !important; }
        `);
        const controls = new Map<HTMLElement, {button: HTMLButtonElement; listener: EventListener;}>();
        const releaseDetachedControls = () => {
            for (const [candidate, {button, listener}] of controls) {
                if (candidate.isConnected && button.isConnected && richEmbedEvidence(candidate)) continue;
                button.removeEventListener("click", listener);
                button.remove();
                candidate.classList.remove("solcord-embed-host", "solcord-embed-collapsed");
                controls.delete(candidate);
            }
        };
        const dirtyMessages = new Set<HTMLElement>();
        const scan = (roots: ParentNode[] = [document]) => {
            releaseDetachedControls();
            const candidates = roots.flatMap(resolveSolcordEmbedTargets);
            for (const candidate of candidates) {
                if (controls.has(candidate) || candidate.querySelector(":scope > .solcord-embed-control")) continue;
                candidate.classList.add("solcord-embed-host");
                const button = document.createElement("button");
                button.type = "button";
                button.className = "solcord-embed-control";
                button.textContent = "−";
                button.title = "Collapse this embed locally";
                button.setAttribute("aria-label", "Collapse this embed locally");
                const toggle: EventListener = event => {
                    event.preventDefault();
                    event.stopPropagation();
                    const collapsed = candidate.classList.toggle("solcord-embed-collapsed");
                    button.textContent = collapsed ? "+" : "−";
                    button.title = collapsed ? "Expand this embed locally" : "Collapse this embed locally";
                    button.setAttribute("aria-label", button.title);
                };
                button.addEventListener("click", toggle);
                controls.set(candidate, {button, listener: toggle});
                candidate.prepend(button);
            }
            if (controls.size) {
                this.#setRuntimeIssue("embed-controls");
            }
            else if (roots.includes(document)) {
                const possible = [...document.querySelectorAll<HTMLElement>(MESSAGE_CONTAINER_SELECTOR)].some(message => message.querySelector("article, [class*=\"embed\"]"));
                this.#setRuntimeIssue("embed-controls", possible
                    ? "Embed Controls: loaded embed-like markup could not be structurally verified, so Solcord injected nothing."
                    : "Embed Controls: no loaded rich embed is present on this route; the adapter is waiting without changing messages.");
            }
        };
        const schedule = createBoundedAnimationScheduler(scope, () => {
            const roots = [...dirtyMessages];
            dirtyMessages.clear();
            scan(roots);
        });
        scan();
        this.#statusReconcilers.add(scan);
        scope.own(() => this.#statusReconcilers.delete(scan));
        const observer = new MutationObserver(mutations => {
            let removedControl = false;
            for (const mutation of mutations) {
                const message = mutation.target instanceof Element ? mutation.target.closest<HTMLElement>(MESSAGE_CONTAINER_SELECTOR) : null;
                if (message) dirtyMessages.add(message);
                for (const node of mutation.addedNodes) {
                    if (!(node instanceof HTMLElement)) continue;
                    if (node.matches(MESSAGE_CONTAINER_SELECTOR)) dirtyMessages.add(node);
                    for (const addedMessage of node.querySelectorAll<HTMLElement>(MESSAGE_CONTAINER_SELECTOR)) dirtyMessages.add(addedMessage);
                }
                for (const node of mutation.removedNodes) {
                    if (node instanceof Element && (node.classList.contains("solcord-embed-host") || node.querySelector(".solcord-embed-host"))) removedControl = true;
                }
            }
            if (dirtyMessages.size || removedControl) schedule();
        });
        scope.observe(observer, document.body, {childList: true, subtree: true});
        scope.own(() => {
            for (const [candidate, {button, listener}] of controls) {
                button.removeEventListener("click", listener);
                button.remove();
                candidate.classList.remove("solcord-embed-host", "solcord-embed-collapsed");
            }
            controls.clear();
            for (const host of document.querySelectorAll(".solcord-embed-host")) host.classList.remove("solcord-embed-host", "solcord-embed-collapsed");
        }, "element");
    }

    #startAutoscroll(scope: SolcordDisposalScope): void {
        scope.style("solcord-autoscroll-runtime", "html.solcord-autoscroll-active, html.solcord-autoscroll-active * { cursor: ns-resize !important; }");
        let active: {element: HTMLElement; originY: number;} | undefined;
        let pointerY = 0;
        let frame = 0;
        const stop = () => {
            active = undefined;
            document.documentElement.classList.remove("solcord-autoscroll-active");
            if (frame) cancelAnimationFrame(frame);
            frame = 0;
        };
        const tick = () => {
            if (!active) return;
            const delta = pointerY - active.originY;
            if (Math.abs(delta) > 8) active.element.scrollBy({top: Math.sign(delta) * Math.min(42, Math.max(2, Math.abs(delta) / 5)), behavior: "auto"});
            frame = requestAnimationFrame(tick);
        };
        scope.listen(document, "mousedown", event => {
            const pointer = event as MouseEvent;
            if (pointer.button !== 1 || active) return;
            const element = scrollableAncestor(pointer.target);
            if (!element) return;
            pointer.preventDefault();
            active = {element, originY: pointer.clientY};
            pointerY = pointer.clientY;
            document.documentElement.classList.add("solcord-autoscroll-active");
            frame = requestAnimationFrame(tick);
        }, true);
        scope.listen(document, "mousemove", event => {pointerY = (event as MouseEvent).clientY;}, true);
        scope.listen(document, "mouseup", event => {if ((event as MouseEvent).button === 1) stop();}, true);
        scope.listen(window, "blur", stop);
        scope.listen(document, "keydown", event => {if ((event as KeyboardEvent).key === "Escape") stop();}, true);
        scope.own(stop, "other");
    }

    #startMessageLinkPreview(scope: SolcordDisposalScope): void {
        let preview: HTMLElement | undefined;
        const close = () => {preview?.remove(); preview = undefined;};
        scope.listen(document, "mouseover", event => {
            const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
            if (!anchor) return;
            const parsed = parseLoadedDiscordMessageLink(anchor.href);
            if (!parsed) return;
            const message = this.adapter.getLoadedMessage?.(parsed.channelId, parsed.messageId);
            if (!message) return;
            close();
            preview = document.createElement("aside");
            preview.className = "solcord-message-link-preview";
            preview.setAttribute("role", "status");
            const author = message.author?.globalName ?? message.author?.username ?? "Loaded message";
            const text = typeof message.content === "string" && message.content.trim() ? message.content.trim().slice(0, 420) : "No text content in the loaded record.";
            preview.append(Object.assign(document.createElement("strong"), {textContent: author}), Object.assign(document.createElement("p"), {textContent: text}));
            const rect = anchor.getBoundingClientRect();
            preview.style.left = `${Math.max(12, Math.min(window.innerWidth - 332, rect.left))}px`;
            preview.style.top = `${Math.max(12, Math.min(window.innerHeight - 180, rect.bottom + 8))}px`;
            document.body.append(preview);
        }, true);
        scope.listen(document, "mouseout", event => {
            const next = (event as MouseEvent).relatedTarget;
            if (next instanceof Node && preview?.contains(next)) return;
            close();
        }, true);
        scope.listen(window, "blur", close);
        scope.own(close, "element");
        scope.style("solcord-message-link-preview-runtime", `
            .solcord-message-link-preview { position: fixed; z-index: 10000; width: min(320px, calc(100vw - 24px)); padding: 10px 12px; color: var(--text-normal); background: var(--background-floating); border: 1px solid var(--border-subtle); border-radius: 6px; box-shadow: var(--elevation-high); pointer-events: none; }
            .solcord-message-link-preview strong { display: block; margin-bottom: 4px; }
            .solcord-message-link-preview p { margin: 0; color: var(--text-muted); line-height: 1.4; overflow-wrap: anywhere; }
        `);
    }
}
