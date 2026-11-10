// SPDX-License-Identifier: Apache-2.0
// Behavior reference: zentir0g/FakeDeafen@2f529efc9028bdc318bd87ec22157a7e9a8cc4a8 (MIT).
// Solcord's independently written implementation uses scoped patch ownership,
// explicit consent, connection binding, restoration, and fail-closed validation.

export const DISCORD_VOICE_STATE_UPDATE_OPCODE = 4;

export interface SolcordGatewaySocket {
    send(opcode: number, payload: unknown, ...rest: unknown[]): unknown;
    webSocket?: unknown;
}

export interface SolcordVoiceStatePayload {
    channel_id: string | null;
    guild_id?: string | null;
    self_deaf: boolean;
    self_mute: boolean;
    self_video?: boolean;
    [key: string]: unknown;
}

export interface SolcordFakeDeafenStatus {
    phase: "off" | "ready" | "armed" | "attention";
    detail: string;
    connected: boolean;
    accountBound: boolean;
    capturedVoiceState: boolean;
    armed: boolean;
    pending?: boolean;
    voice?: {localSelfDeaf?: boolean; serverSelfDeaf?: boolean; serverDeaf?: boolean;};
}

export interface SolcordFakeDeafenDependencies {
    getAccountId(): string | undefined;
    getSocket(): SolcordGatewaySocket | undefined;
    getConnectionIdentity?(): unknown;
    getVoiceChannelId(): string | undefined;
    isLocallyDeafened(): boolean;
    toggleLocalDeafen(): void;
    patchSend(socket: SolcordGatewaySocket, observe: (args: unknown[]) => void): (() => void) | null;
    onStatus?(status: SolcordFakeDeafenStatus): void;
}

export interface SolcordFakeDeafenConsentTransition {
    persist(): void;
    synchronize(): Promise<void>;
    failClosed(): void;
}

export interface SolcordFakeDeafenButtonDependencies {
    document: Document;
    getStatus(): SolcordFakeDeafenStatus;
    toggle(): boolean | Promise<boolean>;
    onError?(detail: string): void;
}

/**
 * Keeps one owned control immediately beside Discord's native Deafen button.
 * The native control is cloned only for Discord's current dimensions and icon;
 * no React handlers or private state survive cloneNode. Solcord owns the new
 * event listener, accessible state, badge, observer, and teardown.
 */
export class SolcordFakeDeafenButton {
    #button?: HTMLButtonElement;
    #observer?: MutationObserver;
    #scheduled = false;
    #busy = false;
    #lifecycle = 0;
    #status: SolcordFakeDeafenStatus;

    constructor(private readonly dependencies: SolcordFakeDeafenButtonDependencies) {
        this.#status = dependencies.getStatus();
    }

    start(): boolean {
        if (this.#observer) {
            this.reconcile();
            return true;
        }
        const body = this.dependencies.document.body;
        const Observer = this.dependencies.document.defaultView?.MutationObserver ?? globalThis.MutationObserver;
        if (!body || typeof Observer !== "function") return false;
        this.#lifecycle++;
        this.#status = this.dependencies.getStatus();
        this.#observer = new Observer(() => {
            // Discord mutates chat constantly. Once the owned control is in
            // place, those unrelated mutations must cost no query or queued
            // reconciliation work.
            if (this.#button?.isConnected) return;
            this.#schedule();
        });
        this.#observer.observe(body, {childList: true, subtree: true});
        this.reconcile();
        return true;
    }

    update(status: SolcordFakeDeafenStatus): void {
        this.#status = structuredClone(status);
        this.#render();
    }

    reconcile(): boolean {
        this.#scheduled = false;
        if (this.#button?.isConnected) {
            this.#render();
            return true;
        }
        this.#button = undefined;
        const root = this.dependencies.document.querySelector("#app-mount") ?? this.dependencies.document.body;
        const owned = [...root.querySelectorAll<HTMLButtonElement>("button[data-solcord-fake-deafen]")];
        if (owned.length) {
            this.#button = owned.shift();
            for (const duplicate of owned) duplicate.remove();
            this.#button?.addEventListener("click", this.#onClick);
            this.#render();
            return true;
        }
        const native = root.querySelector<HTMLButtonElement>([
            "button[aria-label=\"Deafen\"]",
            "button[aria-label^=\"Deafen \" i]",
            "button[aria-label=\"Undeafen\"]",
            "button[aria-label^=\"Undeafen \" i]",
            "button[data-list-item-id*=\"deafen\" i]"
        ].join(","));
        if (!native || native.dataset.solcordFakeDeafen !== undefined) return false;
        const button = native.cloneNode(true) as HTMLButtonElement;
        button.removeAttribute("id");
        button.removeAttribute("aria-describedby");
        button.removeAttribute("data-list-item-id");
        for (const child of button.querySelectorAll("[id]")) child.removeAttribute("id");
        button.type = "button";
        button.dataset.solcordFakeDeafen = "true";
        button.classList.add("solcord-fake-deafen-button");
        button.addEventListener("click", this.#onClick);
        native.insertAdjacentElement("afterend", button);
        this.#button = button;
        this.#render();
        return true;
    }

    stop(): void {
        this.#lifecycle++;
        this.#busy = false;
        this.#observer?.disconnect();
        this.#observer = undefined;
        this.#scheduled = false;
        this.#button?.removeEventListener("click", this.#onClick);
        this.#button?.remove();
        this.#button = undefined;
        for (const duplicate of this.dependencies.document.querySelectorAll("button[data-solcord-fake-deafen]")) duplicate.remove();
    }

    #schedule(): void {
        if (this.#scheduled) return;
        this.#scheduled = true;
        const lifecycle = this.#lifecycle;
        queueMicrotask(() => {if (this.#observer && lifecycle === this.#lifecycle) this.reconcile();});
    }

    #render(): void {
        const button = this.#button;
        if (!button) return;
        const active = this.#status.armed;
        const waiting = this.#busy || this.#status.pending === true;
        button.dataset.solcordFakeDeafenState = active ? "active" : this.#status.phase;
        button.setAttribute("aria-pressed", String(active));
        button.setAttribute("aria-busy", String(waiting));
        button.setAttribute("aria-label", active ? "Fake Deafen on. Click to restore normal deafen state." : "Fake Deafen. Click to toggle.");
        button.title = waiting ? (this.#status.pending ? this.#status.detail : "Activating Fake Deafen…") : active ? "Fake Deafen is on — click to restore" : "Toggle Fake Deafen";
        button.disabled = waiting;
    }

    #onClick = (event: Event): void => {
        event.preventDefault();
        event.stopPropagation();
        if (this.#busy) return;
        this.#busy = true;
        this.#render();
        const lifecycle = this.#lifecycle;
        void (async () => {
            try {await this.dependencies.toggle();}
            catch {if (lifecycle === this.#lifecycle) this.dependencies.onError?.("Fake Deafen could not toggle on this Discord build.");}
            finally {
                if (lifecycle === this.#lifecycle) {
                    this.#busy = false;
                    this.update(this.dependencies.getStatus());
                }
            }
        })();
    };
}

/**
 * Persistence is part of the safety boundary: a failed settings write must not
 * prevent an already-live account-risk patch from being torn down. Returning
 * false lets the UI report that the requested durable state was not accepted.
 */
export async function applySolcordFakeDeafenConsentTransition(
    transition: SolcordFakeDeafenConsentTransition
): Promise<boolean> {
    try {
        transition.persist();
        await transition.synchronize();
    }
    catch {
        transition.failClosed();
        return false;
    }
    return true;
}

function discordId(value: unknown): string | undefined {
    return typeof value === "string" && /^[1-9]\d{16,19}$/.test(value) ? value : undefined;
}

export function normalizeVoiceStatePayload(value: unknown): SolcordVoiceStatePayload | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const payload = value as Record<string, unknown>;
    const channel = payload.channel_id === null ? null : discordId(payload.channel_id);
    if (channel === undefined || typeof payload.self_deaf !== "boolean" || typeof payload.self_mute !== "boolean") return;
    if (payload.guild_id !== undefined && payload.guild_id !== null && !discordId(payload.guild_id)) return;
    if (payload.self_video !== undefined && typeof payload.self_video !== "boolean") return;
    return {...payload, channel_id: channel, self_deaf: payload.self_deaf, self_mute: payload.self_mute} as SolcordVoiceStatePayload;
}

export class SolcordFakeDeafenController {
    #socket?: SolcordGatewaySocket;
    #unpatch?: () => void;
    #lastPayload?: SolcordVoiceStatePayload;
    #boundAccountId?: string;
    #boundConnectionIdentity?: unknown;
    #armedChannelId?: string;
    #directArmPending = false;
    #directArmChannelId?: string;
    #directAwaitingUndeafened = false;
    #directPrimeQueued = false;
    #localRestorePending = false;
    #directArmGeneration = 0;
    #directArmTimer?: ReturnType<typeof setTimeout>;
    #directArmResult?: Promise<boolean>;
    #resolveDirectArm?: (armed: boolean) => void;
    #status: SolcordFakeDeafenStatus = {
        phase: "off",
        detail: "Adapter is off.",
        connected: false,
        accountBound: false,
        capturedVoiceState: false,
        armed: false
    };

    constructor(private readonly dependencies: SolcordFakeDeafenDependencies) {}

    snapshot(): SolcordFakeDeafenStatus {
        return structuredClone(this.#status);
    }

    waitForActivation(): Promise<boolean> {
        return this.#directArmResult ?? Promise.resolve(this.#status.armed);
    }

    start(): boolean {
        if (this.#unpatch) return this.validateOwnership();
        const accountId = discordId(this.dependencies.getAccountId());
        const socket = this.dependencies.getSocket();
        const channelId = discordId(this.dependencies.getVoiceChannelId());
        if (!accountId) {
            this.#setStatus("attention", "A validated signed-in account was not available; Fake Deafen stayed off and patched nothing.");
            return false;
        }
        if (!socket || typeof socket.send !== "function") {
            this.#setStatus("attention", "Discord's scoped gateway sender was not available; nothing was patched.");
            return false;
        }
        let connectionIdentity: unknown;
        try {connectionIdentity = this.dependencies.getConnectionIdentity?.();}
        catch {
            this.#setStatus("attention", "Discord's gateway transport could not be validated; nothing was patched.");
            return false;
        }
        const unpatch = this.dependencies.patchSend(socket, args => this.#observeSend(args));
        if (!unpatch) {
            this.#setStatus("attention", "Discord's scoped gateway sender failed structural validation; nothing was patched.");
            return false;
        }
        this.#boundAccountId = accountId;
        this.#boundConnectionIdentity = connectionIdentity;
        this.#socket = socket;
        this.#unpatch = unpatch;
        this.#setStatus("ready", channelId
            ? "Ready. Use the Fake Deafen button beside Discord's normal Deafen control."
            : "Ready. Join a voice channel, then use the Fake Deafen button beside Discord's normal Deafen control.");
        return true;
    }

    validateOwnership(): boolean {
        if (!this.#unpatch) return false;
        if (discordId(this.dependencies.getAccountId()) !== this.#boundAccountId) {
            this.#stop(false, "The Discord account changed; Fake Deafen disarmed and removed its scoped patch.");
            return false;
        }
        if (this.dependencies.getSocket() !== this.#socket) {
            this.#stop(false, "Discord replaced the gateway connection; Fake Deafen disarmed and requires a manual restart.");
            return false;
        }
        if (this.dependencies.getConnectionIdentity) {
            let connectionIdentity: unknown;
            try {connectionIdentity = this.dependencies.getConnectionIdentity();}
            catch {connectionIdentity = undefined;}
            if (connectionIdentity !== this.#boundConnectionIdentity) {
                this.#stop(false, "Discord replaced the underlying gateway transport; Fake Deafen disarmed and requires a manual restart.");
                return false;
            }
        }
        const expectedChannel = this.#armedChannelId ?? this.#directArmChannelId;
        if (expectedChannel && discordId(this.dependencies.getVoiceChannelId()) !== expectedChannel) {
            this.#lastPayload = undefined;
            this.#armedChannelId = undefined;
            this.#finishDirectArm(false);
            this.#setStatus("attention", "The voice connection changed; Fake Deafen disarmed without sending a replacement state.");
            return false;
        }
        return true;
    }

    arm(): boolean {
        if (!this.validateOwnership()) return false;
        if (this.#armedChannelId) return true;
        const accountId = discordId(this.dependencies.getAccountId());
        const channelId = discordId(this.dependencies.getVoiceChannelId());
        if (!accountId || accountId !== this.#boundAccountId) {
            this.#finishDirectArm(false);
            this.#setStatus("attention", "The Discord account changed before arming; Fake Deafen stayed disarmed.");
            return false;
        }
        if (!channelId) {
            this.#finishDirectArm(false);
            this.#setStatus("attention", "Join a voice channel before arming Fake Deafen.");
            return false;
        }
        if (!this.dependencies.isLocallyDeafened()) {
            this.#finishDirectArm(false);
            this.#setStatus("attention", "Deafen normally before arming. Solcord will not invent an unverified voice-state payload.");
            return false;
        }
        if (!this.#lastPayload || this.#lastPayload.channel_id !== channelId || this.#lastPayload.self_deaf !== true) {
            this.#finishDirectArm(false);
            this.#setStatus("attention", "No matching deafened voice-state update has been observed. Toggle normal deafen once, then try again.");
            return false;
        }

        if (!this.#directArmResult) this.#beginDirectArm(channelId);
        this.#directArmPending = true;
        this.#localRestorePending = true;
        this.#armedChannelId = channelId;
        const generation = this.#directArmGeneration;
        this.#setStatus("ready", "Waiting for Discord to restore local audio and emit its matching voice-state update.");
        if (!this.#directArmPending || generation !== this.#directArmGeneration || !this.#localRestorePending || !this.validateOwnership()) return false;
        try {this.dependencies.toggleLocalDeafen();}
        catch {
            this.#armedChannelId = undefined;
            this.#finishDirectArm(false);
            this.#setStatus("attention", "Discord's local deafen action failed; Fake Deafen disarmed without sending a replacement state.");
            return false;
        }
        return this.#status.armed || this.#directArmPending;
    }

    /** One-click path used by the adjacent voice control. */
    toggleDirect(): boolean {
        if (!this.validateOwnership()) return false;
        if (this.#armedChannelId) return this.disarm();
        if (this.#directArmPending) {
            this.#finishDirectArm(false);
            this.#setStatus("ready", "Pending Fake Deafen activation was canceled; normal Deafen remains under your control.");
            return true;
        }
        const channelId = discordId(this.dependencies.getVoiceChannelId());
        if (!channelId) {
            this.#setStatus("attention", "Join a voice channel before using Fake Deafen.");
            return false;
        }
        if (this.dependencies.isLocallyDeafened() && this.#lastPayload?.channel_id === channelId && this.#lastPayload.self_deaf) return this.arm();

        this.#beginDirectArm(channelId);
        this.#directAwaitingUndeafened = this.dependencies.isLocallyDeafened();
        const generation = this.#directArmGeneration;
        this.#setStatus("ready", "Activating Fake Deafen from the adjacent voice control.");
        if (!this.#directArmPending || generation !== this.#directArmGeneration || !this.validateOwnership()) return false;
        try {
            // Prime one native transition at a time. Discord may coalesce two
            // same-dispatch toggles and emit no fresh voice-state packet.
            this.dependencies.toggleLocalDeafen();
        }
        catch {
            this.#finishDirectArm(false);
            this.#setStatus("attention", "Discord's native Deafen action failed; Fake Deafen stayed off.");
            return false;
        }
        if (!this.#directArmPending) return this.#status.armed;
        if (!this.#directAwaitingUndeafened && this.#lastPayload?.channel_id === channelId && this.#lastPayload.self_deaf && this.dependencies.isLocallyDeafened()) {
            return this.arm();
        }
        return true;
    }

    disarm(): boolean {
        const pending = this.#directArmPending;
        this.#finishDirectArm(false);
        if (!this.#armedChannelId) {
            if (pending) this.#setStatus("ready", "Pending Fake Deafen activation was canceled; normal Deafen remains under your control.");
            return true;
        }
        if (!this.validateOwnership()) return false;
        const accountId = discordId(this.dependencies.getAccountId());
        const channelId = discordId(this.dependencies.getVoiceChannelId());
        const socket = this.#socket;
        const payload = this.#lastPayload;
        this.#armedChannelId = undefined;
        if (!accountId || accountId !== this.#boundAccountId) {
            this.#setStatus("attention", "Disarmed after an account change. No voice-state payload was sent to the new account.");
            return false;
        }
        if (!channelId || !socket || !payload || payload.channel_id !== channelId) {
            this.#setStatus("ready", "Disarmed. The voice connection changed, so Solcord sent no synthetic state.");
            return false;
        }
        try {
            socket.send(DISCORD_VOICE_STATE_UPDATE_OPCODE, {...payload, channel_id: channelId, self_deaf: this.dependencies.isLocallyDeafened()});
            this.#setStatus("ready", "Disarmed and restored the server-visible deafen state to match the local client.");
            return true;
        }
        catch {
            this.#setStatus("attention", "Disarmed locally, but Discord's state-restoration send failed. Toggle normal deafen once to resynchronize.");
            return false;
        }
    }

    stop(): boolean {
        return this.#stop(true, "Adapter is off; its scoped patch was removed.");
    }

    #stop(restore: boolean, detail: string): boolean {
        const activationWasPending = restore && this.#directArmPending;
        const restored = !restore || this.disarm();
        const restorationDetail = this.#status.detail;
        const unpatch = this.#unpatch;
        this.#socket = undefined;
        this.#lastPayload = undefined;
        this.#boundAccountId = undefined;
        this.#boundConnectionIdentity = undefined;
        this.#armedChannelId = undefined;
        this.#finishDirectArm(false);
        try {unpatch?.();}
        catch (error) {
            // Keep the exact cleanup callback. A later stop may retry it, but
            // start must not stack another patch over the one still owned here.
            this.#setStatus("attention", "Cleanup is incomplete. Fake Deafen is disarmed and will not load another patch until cleanup succeeds.");
            throw error;
        }
        this.#unpatch = undefined;
        if (activationWasPending) this.#setStatus("attention", "Fake Deafen stopped while a native Deafen action was pending. That action may still complete; verify the normal Deafen control and use it to resynchronize.");
        else if (restore && !restored) this.#setStatus("attention", restorationDetail);
        else this.#setStatus(restore ? "off" : "attention", detail);
        return restored && !activationWasPending;
    }

    #observeSend(args: unknown[]): void {
        if (args[0] !== DISCORD_VOICE_STATE_UPDATE_OPCODE) return;
        if (!this.validateOwnership()) return;
        const payload = normalizeVoiceStatePayload(args[1]);
        if (!payload) {
            this.#lastPayload = undefined;
            this.#armedChannelId = undefined;
            this.#finishDirectArm(false);
            this.#setStatus("attention", "Discord's voice-state shape changed; Fake Deafen failed closed and needs a fresh validated update before arming.");
            return;
        }
        this.#lastPayload = structuredClone(payload);
        const currentAccountId = discordId(this.dependencies.getAccountId());
        if (!currentAccountId || currentAccountId !== this.#boundAccountId) {
            this.#lastPayload = undefined;
            this.#armedChannelId = undefined;
            this.#finishDirectArm(false);
            this.#setStatus("attention", "The Discord account changed; Fake Deafen failed closed and stopped rewriting voice state.");
            return;
        }
        const currentChannelId = discordId(this.dependencies.getVoiceChannelId());
        if (payload.channel_id === null || !currentChannelId) {
            this.#armedChannelId = undefined;
            this.#finishDirectArm(false);
            this.#setStatus("ready", "Voice disconnected; Fake Deafen disarmed automatically.");
            return;
        }
        if (this.#directArmPending && this.#directAwaitingUndeafened && !payload.self_deaf && payload.channel_id === currentChannelId && !this.#directPrimeQueued) {
            this.#directPrimeQueued = true;
            const generation = this.#directArmGeneration;
            queueMicrotask(() => {
                if (!this.#directArmPending || generation !== this.#directArmGeneration || !this.#directAwaitingUndeafened) return;
                if (!this.validateOwnership()) return;
                if (discordId(this.dependencies.getVoiceChannelId()) !== payload.channel_id || this.dependencies.isLocallyDeafened()) {
                    this.#finishDirectArm(false);
                    this.#setStatus("attention", "The native voice state changed during activation; Fake Deafen stayed off. Retry from the current voice connection.");
                    return;
                }
                this.#directAwaitingUndeafened = false;
                this.#directPrimeQueued = false;
                try {this.dependencies.toggleLocalDeafen();}
                catch {
                    this.#finishDirectArm(false);
                    this.#setStatus("attention", "Discord's native Deafen action failed while activating; Fake Deafen stayed off.");
                }
            });
        }
        if (this.#directArmPending && !this.#directAwaitingUndeafened && payload.self_deaf) {
            const generation = this.#directArmGeneration;
            queueMicrotask(() => {
                if (!this.#directArmPending || this.#armedChannelId || generation !== this.#directArmGeneration) return;
                this.arm();
            });
        }
        if (!this.#armedChannelId) {
            this.#setStatus("ready", payload.self_deaf
                ? "Deafened voice state validated. Use the adjacent Fake Deafen button to toggle it."
                : "Voice state validated. Use the adjacent Fake Deafen button to toggle it.");
            return;
        }
        if (payload.channel_id !== this.#armedChannelId || currentChannelId !== this.#armedChannelId) {
            this.#armedChannelId = undefined;
            this.#setStatus("attention", "Voice channel changed; Fake Deafen disarmed and passed the new state through unchanged.");
            return;
        }
        args[1] = {...payload, self_deaf: true};
        const generation = this.#directArmGeneration;
        const restoredLocalAudio = this.#localRestorePending && !payload.self_deaf && !this.dependencies.isLocallyDeafened();
        if (restoredLocalAudio) {
            this.#localRestorePending = false;
            this.#directArmPending = false;
        }
        try {
            this.#setStatus(this.#localRestorePending ? "ready" : "armed", this.#localRestorePending
                ? "Waiting for Discord to restore local audio and emit its matching voice-state update."
                : "Armed for this voice connection. Server-visible self-deafen is held while local audio remains under your control.");
        }
        catch (error) {
            this.#armedChannelId = undefined;
            this.#finishDirectArm(false);
            this.#status = {...this.#status, phase: "attention", detail: "Fake Deafen could not publish its confirmed state. Its rewrite was canceled; verify the normal Deafen control before retrying.", armed: false, pending: false};
            throw error;
        }
        finally {
            // A synchronous status observer may stop or replace this operation.
            // Its nested restoration must not be followed by this older rewrite.
            let owned = false;
            try {owned = Boolean(this.#armedChannelId && this.#armedChannelId === payload.channel_id && generation === this.#directArmGeneration && this.validateOwnership());}
            finally {if (!owned) args[1] = payload;}
        }
        if (restoredLocalAudio && this.#armedChannelId === payload.channel_id && generation === this.#directArmGeneration && this.validateOwnership()) this.#finishDirectArm(true);
    }

    #beginDirectArm(channelId: string): void {
        this.#directArmPending = true;
        this.#directArmChannelId = channelId;
        const generation = ++this.#directArmGeneration;
        this.#directArmResult = new Promise(resolve => {this.#resolveDirectArm = resolve;});
        this.#directArmTimer = setTimeout(() => {
            if (!this.#directArmPending || generation !== this.#directArmGeneration) return;
            if (!this.validateOwnership()) return;
            this.#armedChannelId = undefined;
            this.#finishDirectArm(false);
            this.#lastPayload = undefined;
            this.#setStatus("attention", "Fake Deafen did not receive a validated native Deafen update in time. Normal Deafen may still be on; use its native control before retrying.");
        }, 5_000);
    }

    #finishDirectArm(armed: boolean): void {
        this.#directArmPending = false;
        this.#directArmChannelId = undefined;
        this.#directAwaitingUndeafened = false;
        this.#directPrimeQueued = false;
        this.#localRestorePending = false;
        this.#directArmGeneration++;
        clearTimeout(this.#directArmTimer);
        this.#directArmTimer = undefined;
        const resolve = this.#resolveDirectArm;
        this.#resolveDirectArm = undefined;
        this.#directArmResult = undefined;
        resolve?.(armed);
    }

    #setStatus(phase: SolcordFakeDeafenStatus["phase"], detail: string): void {
        this.#status = {
            phase,
            detail,
            connected: Boolean(discordId(this.dependencies.getVoiceChannelId())),
            accountBound: Boolean(this.#boundAccountId && discordId(this.dependencies.getAccountId()) === this.#boundAccountId),
            capturedVoiceState: Boolean(this.#lastPayload),
            armed: Boolean(this.#armedChannelId && !this.#localRestorePending),
            pending: this.#directArmPending
        };
        this.dependencies.onStatus?.(this.snapshot());
    }
}
