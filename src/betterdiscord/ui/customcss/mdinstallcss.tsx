import Patcher from "@modules/patcher";
import CustomCSS from "@builtins/customcss";
import React from "react";
import DOMManager from "@modules/dommanager";
import Settings from "@stores/settings";
import Toasts from "@stores/toasts";
import DiscordModules from "@modules/discordmodules";
import {t} from "@common/i18n";
import {PackageOpenIcon} from "lucide-react";
import {Filters, getLazy} from "@webpack";
import Logger from "@common/logger";
import NotificationUI from "@ui/notifications";
import Modals from "@ui/modals";
import {findInTree} from "@common/utils";
import type {Rule} from "@typed/discord/modules";

class InstallCSS {
    static activeNotifications = new Map();
    private static initialized = false;
    private static initializing?: Promise<boolean>;

    static initialize(): Promise<boolean> {
        if (this.initialized) return Promise.resolve(true);
        if (this.initializing) return this.initializing;
        const controller = new AbortController();
        const cancel = () => controller.abort();
        const deadline = setTimeout(cancel, 10_000);
        window.addEventListener("beforeunload", cancel, {once: true});
        // Defer work so the single-flight owner exists before any host callback.
        this.initializing = Promise.resolve().then(() => this.initializeOwned(controller.signal)).catch(() => {
            Logger.warn("InstallCSS", "Optional CSS message integration is unavailable; initialization can be retried.");
            return false;
        }).finally(() => {
            clearTimeout(deadline);
            window.removeEventListener("beforeunload", cancel);
            controller.abort();
            this.initializing = undefined;
        });
        return this.initializing;
    }

    private static async initializeOwned(signal: AbortSignal): Promise<boolean> {
        const patch = DiscordModules.SimpleMarkdownWrapper?.defaultRules?.codeBlock as Required<Rule> | undefined;
        if (signal.aborted || typeof patch?.react !== "function") return false;

        let cancelLookup: () => void = () => {};
        const cancelled = new Promise<undefined>(resolve => {
            cancelLookup = () => resolve(undefined);
            signal.addEventListener("abort", cancelLookup, {once: true});
        });
        let codeBlockStyles: Record<string, unknown> | undefined;
        try {
            codeBlockStyles = await Promise.race([getLazy<Record<string, unknown>>(Filters.byKeys(["codeActions"]), {firstId: 992595, cacheId: "core-mdinstallcss-codeBlockStyles", signal}), cancelled]);
        }
        finally {signal.removeEventListener("abort", cancelLookup);}
        if (signal.aborted || !codeBlockStyles || !["markup", "codeContainer", "codeActions"].every(key => typeof codeBlockStyles![key] === "string" && codeBlockStyles![key])) return false;

        const unpatch = Patcher.after("InstallCSS", patch, "react", (_, [args]: [{content?: string; lang?: string;}, any, any], child) => {
            const isEnabled = Settings.get("customcss", "customcss");
            if (!isEnabled) return;

            const content = args.content;
            if (!content) return;

            if (child?.type !== "pre") return;
            if (args?.lang?.toLowerCase() !== "css") return;

            const codeActions = findInTree(child, x => x?.className?.includes("codeActions"), {walkable: ["props", "children"]});
            if (!codeActions) return;

            if (!args?.content) return;

            const existingCodeblocks = Array.isArray(codeActions.children) ? codeActions.children : [codeActions.children];
            codeActions.children = [
                ...existingCodeblocks,
                <PackageOpenIcon
                    style={{cursor: "pointer"}}
                    size="16px"
                    key="icon"
                    onClick={async (event) => {
                        if (event.shiftKey) {
                            if (args.content) this.handleCSSInstall(args.content);
                            return;
                        }

                        Modals.showConfirmationModal(
                            t("Modals.confirmAction"),
                            t("Modals.installCss"),
                            {
                                confirmText: t("Modals.okay"),
                                cancelText: t("Modals.cancel"),
                                onConfirm: () => args?.content && this.handleCSSInstall(args.content)
                            }
                        );
                    }}
                />
            ];
        });

        if (typeof unpatch !== "function") return false;
        try {
            DOMManager.injectStyle("bd-installcss",
            `.${codeBlockStyles.markup} .${codeBlockStyles.codeContainer}:hover .${codeBlockStyles.codeActions} {
                display: flex;
                flex-direction: row-reverse;
                gap: 8px;
            }`
            );
            this.initialized = true;
            return true;
        }
        catch (error) {
            try {unpatch();}
            finally {DOMManager.removeStyle("bd-installcss");}
            throw error;
        }
    }

    static handleCSSInstall(cssBlock: string) {
        try {
            const currentCSS = CustomCSS.savedCss || "";
            const newCSS = currentCSS + "\n" + cssBlock;

            CustomCSS.saveCSS(newCSS);
            CustomCSS.insertCSS(newCSS);
            Toasts.show(t("CustomCSS.cssInstallSuccess"), {type: "success"});

            const notificationId = `css-undo-${Date.now()}`;

            this.activeNotifications.set(notificationId, cssBlock);

            NotificationUI.show({
                id: notificationId,
                title: t("CustomCSS.cssInstalled"),
                content: t("CustomCSS.cssReverting"),
                type: "warning",
                duration: 10000,
                actions: [{
                    label: "Keep",
                    onClick: () => this.keepChanges(notificationId)
                }],
                onClose: () => this.revertCSS(notificationId)
            });
        }
        catch (error) {
            Logger.log("InstallCSS", "Failed to install CSS:", error);
            Toasts.show(t("CustomCSS.cssInstallError"), {type: "error"});
        }
    }

    static keepChanges(notificationId: string) {
        this.activeNotifications.delete(notificationId);
        Toasts.show(t("CustomCSS.cssKept"), {type: "success"});
    }

    static revertCSS(notificationId: string) {
        const cssBlock = this.activeNotifications.get(notificationId);
        if (!cssBlock) return;

        const currentCSS = CustomCSS.savedCss || "";
        const newCSS = currentCSS.replace(cssBlock, "");

        CustomCSS.saveCSS(newCSS);
        CustomCSS.insertCSS(newCSS);
        this.activeNotifications.delete(notificationId);
        Toasts.show(t("CustomCSS.cssReverted"), {type: "error"});
    }
}

export default InstallCSS;
