import fs from "fs";
import path from "path";
import crypto from "crypto";
import Remote from "@polyfill/remote";
import {parseJsDoc} from "@common/utils";

import Logger from "@common/logger";


import {comparator as semverComparator, regex as semverRegex} from "@common/semver";

import Events from "./emitter";
import {t} from "@common/i18n";
import React from "./react";
import SettingsStore from "@stores/settings";
import Settings from "@ui/settings";
import PluginManager from "./pluginmanager";
import ThemeManager from "./thememanager";

import Toasts from "@stores/toasts";
import Notifications from "@ui/notifications";
import Modals from "@ui/modals";
import UpdaterPanel from "@ui/updater";
import Web from "@data/web";
import type AddonManager from "./addonmanager";
import type {Release} from "@typed/github";
import {Logo} from "@ui/logo";
import {RefreshCcwIcon} from "lucide-react";
import type {AddonType} from "@typed/addon";
import {fetch} from "./net";
import AddonStore from "./addonstore";
import {SOLCORD_RUNTIME_ADDONS, SOLCORD_RUNTIME_DEPENDENCIES, SOLCORD_RUNTIME_THEMES} from "@common/solcord/addon-trust.generated";
import {classifySolcordUpdateOwnership, solcordUpdateRequiresReview} from "./solcord/updater-ownership";
import {isSolcordAcceptanceMode} from "@common/solcord/acceptance-mode";
import {onSolcordUpdatePolicyChange, solcordAutomaticUpdatesAllowed} from "./solcord/privacy-runtime-state";

const ACCEPTANCE_UPDATE_HOLD = "Solcord update checks and addon writes are disabled in disposable acceptance mode.";

function acceptedSolcordArtifact(type: AddonType, fileName: string): {fileName: string; reviewedSha256: string;} | undefined {
    if (type === "theme") {
        const theme = SOLCORD_RUNTIME_THEMES.find(candidate => candidate.fileName === fileName);
        return theme && {fileName: theme.fileName, reviewedSha256: theme.sourceSha256};
    }

    const candidate = SOLCORD_RUNTIME_ADDONS.find(addon => addon.fileName === fileName) ?? SOLCORD_RUNTIME_DEPENDENCIES.find(dependency => dependency.fileName === fileName);
    if (!candidate || (candidate as {installable?: boolean;}).installable !== true) return;
    return {fileName: candidate.fileName, reviewedSha256: candidate.sourceSha256};
}

export default class Updater {
    static updateCheckInterval: ReturnType<typeof setInterval> | null = null;
    static removeSolcordPolicyListener: (() => void) | null = null;

    static initialize() {
        // TODO: get rid of element creation
        SettingsStore.registerPanel("updates", t("Panels.updates"), {
            order: 1,
            icon: RefreshCcwIcon,
            element: () => {
                return React.createElement(UpdaterPanel, {
                    coreUpdater: CoreUpdater,
                    pluginUpdater: PluginUpdater,
                    themeUpdater: ThemeUpdater
                });
            }
        });

        if (isSolcordAcceptanceMode()) {
            Logger.info("Solcord Acceptance", ACCEPTANCE_UPDATE_HOLD);
            return;
        }

        CoreUpdater.initialize();
        PluginUpdater.initialize();
        ThemeUpdater.initialize();

        this.removeSolcordPolicyListener?.();
        this.removeSolcordPolicyListener = onSolcordUpdatePolicyChange(() => this.startUpdateInterval());

        Events.on("setting-updated", (collection, category, id) => {
            if (collection !== "settings" || category !== "addons") return;
            if (id !== "updateInterval" && id !== "checkForUpdates") return;
            this.startUpdateInterval();
        });

        // This function will already check the setting
        this.startUpdateInterval();
    }

    static startUpdateInterval() {
        if (this.updateCheckInterval) {
            clearInterval(this.updateCheckInterval);
            this.updateCheckInterval = null;
        }

        if (isSolcordAcceptanceMode() || !solcordAutomaticUpdatesAllowed() || !SettingsStore.get("addons", "checkForUpdates")) return;

        const hours = SettingsStore.get<number>("addons", "updateInterval");
        this.updateCheckInterval = setInterval(async () => {
            CoreUpdater.checkForUpdate();
            PluginUpdater.checkAll();
            ThemeUpdater.checkAll();
        }, hours * 60 * 60 * 1000);
    }
}

export class CoreUpdater {
    static hasUpdate = false;
    static apiData: Release;
    static remoteVersion = "";
    static readonly disabledReason = "Solcord core updates are paused until an owner-controlled release feed provides signed integrity metadata.";

    static async initialize() {
        if (!solcordAutomaticUpdatesAllowed() || !SettingsStore.get("addons", "checkForUpdates")) return;
        this.checkForUpdate();
    }

    static async checkForStable(ignoreVersion = false) {
        void ignoreVersion;
        this.hasUpdate = false;
        this.remoteVersion = "";
    }

    static async checkForCanary(ignoreVersion = false) {
        void ignoreVersion;
        this.hasUpdate = false;
        this.remoteVersion = "";
    }

    static async checkForUpdate(showNotice = true) {
        void showNotice;
        this.hasUpdate = false;
        this.remoteVersion = "";
        Logger.warn("Solcord Updater", this.disabledReason);
    }

    static async update() {
        this.hasUpdate = false;
        Logger.warn("Solcord Updater", this.disabledReason);
        Modals.showConfirmationModal("Solcord core updates are paused", this.disabledReason, {cancelText: null});
    }
}

export class AddonUpdater {
    manager: AddonManager;
    type: AddonType;
    pending: string[];
    private readonly inFlight = new Map<string, Promise<void>>();

    constructor(type: AddonType) {
        this.manager = type === "plugin" ? PluginManager : ThemeManager;
        this.type = type;
        this.pending = [];
    }

    async initialize() {
        if (isSolcordAcceptanceMode()) return;

        Events.on(`${this.type}-read`, addon => {
            if (!solcordAutomaticUpdatesAllowed() || !SettingsStore.get("addons", "checkForUpdates")) return;
            this.checkForUpdate(addon.filename, addon.version);
        });

        Events.on(`${this.type}-unloaded`, addon => {
            const index = this.pending.indexOf(addon.filename);
            if (index >= 0) this.pending.splice(index, 1);
        });

        if (!solcordAutomaticUpdatesAllowed()) return;
        AddonStore.getAddons();
        if (SettingsStore.get("addons", "checkForUpdates")) this.checkAll();
    }

    async checkAll(showNotice = true) {
        this.pending.length = 0;
        if (isSolcordAcceptanceMode()) return;

        await AddonStore.updaterRequestAddons();

        for (const addon of this.manager.addonList) this.checkForUpdate(addon.filename, addon.version);
        if (showNotice) this.showUpdateNotice();
    }

    checkForUpdate(filename: string, currentVersion: string) {
        if (this.pending.includes(filename)) return;

        const info = AddonStore.getAddon(path.basename(filename));
        if (!info) return;

        let hasUpdate = info.version > currentVersion;

        if (semverRegex.test(info.version) && semverRegex.test(currentVersion)) {
            hasUpdate = semverComparator(currentVersion, info.version) > 0;
        }

        if (!hasUpdate) return;

        this.pending.push(filename);
    }

    updateAddon(filename: string): Promise<void> {
        const existing = this.inFlight.get(filename);
        if (existing) return existing;
        const operation = this.commitAddonUpdate(filename).catch(error => {
            Logger.error("AddonUpdater", "Addon update stayed unchanged.", error);
            Toasts.error(t("Updater.addonUpdateFailed", {name: filename, version: ""}));
        }).finally(() => this.inFlight.delete(filename));
        this.inFlight.set(filename, operation);
        return operation;
    }

    private async commitAddonUpdate(filename: string) {
        if (isSolcordAcceptanceMode()) {
            Logger.warn("Solcord Acceptance", ACCEPTANCE_UPDATE_HOLD);
            Toasts.error(ACCEPTANCE_UPDATE_HOLD);
            return;
        }
        const basename = path.basename(filename);
        const suffix = this.type === "plugin" ? ".plugin.js" : ".theme.css";
        if (basename !== filename || !filename.endsWith(suffix)) throw new Error("Invalid addon update filename.");
        const installed = this.manager.addonList.find(addon => addon.filename === filename);
        if (!installed) return;
        const file = path.join(path.resolve(this.manager.addonFolder), filename);
        const expectedSha256 = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
        const reviewed = acceptedSolcordArtifact(this.type, basename);
        const ownership = reviewed && classifySolcordUpdateOwnership({
            accepted: true,
            addonFolder: this.manager.addonFolder,
            fileName: reviewed.fileName,
            kind: this.type,
            reviewedSha256: reviewed.reviewedSha256
        });
        if (ownership && solcordUpdateRequiresReview(ownership)) {
            const reason = ownership.state === "solcord-managed"
                ? "This exact file was installed by Solcord from an accepted source. Its update is paused until provenance, code, and runtime checks are repeated."
                : `Solcord cannot safely determine who owns this reviewed file, so its update is paused. ${ownership.reason}`;
            Logger.warn("Solcord Addon Integrity", `${basename} update paused for re-review.`);
            Toasts.error(reason);
            return;
        }
        const info = AddonStore.getAddon(filename);

        if (!info || info.filename !== filename || info.type !== this.type) return;

        const request = await fetch(Web.redirects.github(info.id.toString()));

        if (!request.ok) {
            Logger.stacktrace("AddonUpdater", `Failed to download body for ${info.id}`, request as never);
            Toasts.error(t("Updater.addonUpdateFailed", {name: info.name, version: info.version}));
            return;
        }

        const reader = request.body?.getReader();
        if (!reader) throw new Error("Addon update has no body.");
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
            while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                bytes += chunk.value.byteLength;
                if (bytes > 8 * 1024 * 1024) throw new Error("Addon update exceeds its file limit.");
                chunks.push(chunk.value);
            }
        }
        catch (error) {await reader.cancel(error); throw error;}
        finally {reader.releaseLock();}
        const content = new TextDecoder("utf-8", {fatal: true}).decode(Buffer.concat(chunks));
        const metadata = parseJsDoc(content);
        if (metadata.name !== installed.name || metadata.version !== info.version) throw new Error("Addon update metadata does not match the installed addon and reviewed version.");
        // Re-check ownership after the network wait. Native replacement also
        // compares the exact previous bytes and rejects links and path escapes.
        if (!this.manager.addonList.includes(installed)) throw new Error("Addon ownership changed during download.");
        const currentReviewed = acceptedSolcordArtifact(this.type, basename);
        if (currentReviewed && solcordUpdateRequiresReview(classifySolcordUpdateOwnership({accepted: true, addonFolder: this.manager.addonFolder, fileName: currentReviewed.fileName, kind: this.type, reviewedSha256: currentReviewed.reviewedSha256}))) throw new Error("The addon now requires a reviewed update.");
        await Remote.filesystem.writeAddonFile(this.type, filename, content, expectedSha256);

        Toasts.success(t("Updater.addonUpdated", {name: info.name, version: info.version}));
        const pendingIndex = this.pending.indexOf(filename);
        if (pendingIndex !== -1) this.pending.splice(pendingIndex, 1);
    }

    async updateAll(): Promise<void> {
        const pending = [...this.pending];
        for (let offset = 0; offset < pending.length; offset += 3) await Promise.all(pending.slice(offset, offset + 3).map(filename => this.updateAddon(filename)));
    }

    showUpdateNotice() {
        if (!this.pending.length) return;

        const addonDetails = this.pending.map(filename => {
            const info = AddonStore.getAddon(path.basename(filename));

            return {
                name: info ? info.name : filename,
                version: info ? info.version : ""
            };
        });

        Notifications.show({
            id: `addon-updates-${this.type}`,
            title: t("Updater.addonUpdaterNotificationTitle"),
            content: [
                t("Updater.addonUpdatesAvailable", {count: this.pending.length, context: this.type}),
                React.createElement("ul", {className: "bd-notification-updates-list"},
                    addonDetails.map(addon =>
                        React.createElement("li", {}, [
                            addon.name, " ", React.createElement("i", {}, `(${addon.version})`)
                        ])
                    )
                )
            ],
            type: "info",
            icon: () => React.createElement(Logo, {size: 16, accent: true}),
            duration: Infinity,
            actions: [
                {
                    label: t("Updater.viewUpdates"),
                    onClick: () => Settings.openSettingsPage("updates")
                },
                {
                    label: t("Updater.updateAll"),
                    onClick: () => this.updateAll()
                }
            ]
        });
    }
}

export const PluginUpdater = new AddonUpdater("plugin");
export const ThemeUpdater = new AddonUpdater("theme");
