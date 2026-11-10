import Logger from "@common/logger";
import React, {type ComponentType, type ReactElement, type ReactNode, type RefObject} from "react";
import ReactDOM from "@modules/reactdom";
import {t} from "@common/i18n";
import Settings from "@stores/settings";
import Events from "@modules/emitter";
import Patcher from "@modules/patcher";
import DiscordModules from "@modules/discordmodules";
import DOMManager from "@modules/dommanager";

import AddonErrorModal from "./modals/addonerrormodal";
import ErrorBoundary from "./errorboundary";
import TextElement from "./base/text";
import ModalRoot from "./modals/root";

import Root from "./modals/root.jsx";
import ConfirmationModal, {type ConfirmationModalOptions} from "./modals/confirmation";
import ChangelogModal, {type ChangelogProps} from "./modals/changelog";
import ModalStack, {generateKey} from "./modals/stack";
import {Filters, getMangled} from "@webpack";
import AddonError from "@structs/addonerror";
import AddonErrorsStore from "@stores/addonerrors";
import SimpleMarkdownExt from "@structs/markdown";


const queue: Array<() => void> = [];

interface ModalActions {
    openModal(e: (p?: any) => ReactNode, o?: object): string | number;
    closeModal(key: string | number): void;
    closeAllModals(): void;
}

interface NativeConfirmationModalOptions extends ConfirmationModalOptions {
    /** Called when the native React modal fails after its activation was intercepted. */
    onRenderError?(): void;
}

export default class Modals {
    static get shouldShowAddonErrors() {return Settings.get("settings", "addons", "addonErrors");}
    static get hasModalOpen() {return !!document.getElementsByClassName("bd-modal").length;}
    static get ModalQueue() {return queue;}

    static _ModalActions: ModalActions | undefined;
    static get ModalActions(): ModalActions | undefined {
        // currently the module is unmangled, but keeping this incase it gets mangled again
        if (this._ModalActions) return this._ModalActions;
        const actions = getMangled("?.stackNextByDefault", {
            openModal: Filters.byStrings("?.stackNextByDefault"),
            closeModal: Filters.byStrings(".setState", ".getState()["),
            closeAllModals: Filters.byStrings(".getState();for")
        }, {
            firstId: 192308,
            cacheId: "betterdiscord-modals"
        }) as Partial<ModalActions>;
        if (typeof actions?.openModal !== "function" || typeof actions.closeModal !== "function" || typeof actions.closeAllModals !== "function") return;
        return this._ModalActions = actions as ModalActions;
    }

    static default(title: string, content: string | ReactElement | readonly ReactElement[] | HTMLElement | ReadonlyArray<string | ReactElement>, buttons: Array<{danger?: boolean; label: string; action: (e?: MouseEvent) => void;}> = []) {
        const modal = DOMManager.parseHTML(`<div class="bd-modal-wrapper theme-dark">
                <div class="bd-backdrop backdrop-1wrmKB"></div>
                <div class="bd-modal modal-1UGdnR">
                    <div class="bd-modal-inner inner-1JeGVc">
                        <div class="header header-1R_AjF">
                            <div class="title">${title}</div>
                        </div>
                        <div class="bd-modal-body">
                            <div class="scroller-wrap fade">
                                <div class="scroller"></div>
                            </div>
                        </div>
                        <div class="footer footer-2yfCgX footer-3rDWdC footer-2gL1pp"></div>
                    </div>
                </div>
            </div>`) as HTMLElement;

        const handleClose = () => {
            modal.classList.add("closing");
            setTimeout(() => {
                modal.remove();

                const next = this.ModalQueue.shift();
                if (!next) return;

                next();
            }, 300);
        };

        if (!buttons.length) {
            buttons.push({
                label: t("Modals.okay"),
                action: handleClose
            });
        }

        const buttonContainer = modal.querySelector(".footer")!;
        for (const button of buttons) {
            const buttonEl = Object.assign(document.createElement("button"), {
                onclick: (e: MouseEvent) => {
                    try {
                        button.action(e);
                    }
                    catch (error) {
                        Logger.stacktrace("Modals", "Could not fire button listener", error as Error);
                    }

                    handleClose();
                },
                type: "button",
                className: "bd-button"
            });

            if (button.danger) buttonEl.classList.add("bd-button-danger");

            buttonEl.append(button.label);
            buttonContainer.appendChild(buttonEl);
        }

        if (Array.isArray(content) ? content.every(el => React.isValidElement(el)) : React.isValidElement(content)) {
            const container = modal.querySelector(".scroller")!;

            const root = ReactDOM.createRoot(container);
            try {
                root.render(content as ReactElement);
            }
            catch (error) {
                container.append(DOMManager.parseHTML(`<span style="color: red">There was an unexpected error. Modal could not be rendered.</span>`) as HTMLElement);
                Logger.stacktrace("Modals", "Could not render modal", error as Error);
            }

            DOMManager.onRemoved(container, () => {
                root.unmount();
            });
        }
        else {
            modal.querySelector(".scroller")!.append(content as Element);
        }

        modal.querySelector(".footer button")!.addEventListener("click", handleClose);
        modal.querySelector(".bd-backdrop")!.addEventListener("click", handleClose);

        const handleOpen = () => document.getElementById("app-mount")!.append(modal);

        if (this.hasModalOpen) {
            this.ModalQueue.push(handleOpen);
        }
        else {
            handleOpen();
        }
    }

    static alert(title: string, content: (string | ReactElement | ReadonlyArray<string | ReactElement>)) {
        this.showConfirmationModal(title, content, {cancelText: null});
    }

    /**
     * Shows a generic but very customizable confirmation modal with optional confirm and cancel callbacks.
     * @param title The title of the modal
     * @param content A single or mixed array of react elements and strings. Everything is wrapped in Discord's `Markdown` component so strings will show and render properly.
     * @returns The key used for this modal
     */
    static showConfirmationModal(title: string, content: (string | ReactElement | ReadonlyArray<string | ReactElement>), options: ConfirmationModalOptions = {}) {
        const emptyFunction = () => {};
        const {onClose = emptyFunction, onConfirm = emptyFunction, onCancel = emptyFunction, confirmText = t("Modals.okay"), cancelText = t("Modals.cancel"), danger = false, key = undefined, size = Root.Sizes.SMALL} = options;

        if (!this.ModalActions) {
            return this.default(title, content, [
                confirmText && {label: confirmText, action: onConfirm},
                cancelText && {label: cancelText, action: onCancel, danger}
            ].filter(Boolean) as any);
        }

        let contentArray = Array.isArray(content) ? content : [content];
        contentArray = contentArray.map(c => typeof (c) === "string" ? SimpleMarkdownExt.parseToReact(c) : c);

        const modalKey = this.openModal((props: any) => {
            return React.createElement(ErrorBoundary, {
                onError: () => {
                    setTimeout(() => {
                        this.ModalActions?.closeModal(modalKey);
                        this.default(title, contentArray, [
                            confirmText && {label: confirmText, action: onConfirm},
                            cancelText && {label: cancelText, action: onCancel, danger}
                        ].filter(Boolean) as any);
                    });
                }
            }, React.createElement(ConfirmationModal, Object.assign({
                header: title,
                danger: danger,
                confirmText: confirmText,
                cancelText: cancelText,
                onConfirm: onConfirm,
                onCancel: onCancel,
                className: size,
                onCloseCallback: () => {
                    if (props?.transitionState === 2) onClose?.();
                }
            }, props), React.createElement(ErrorBoundary, {id: "showConfirmationModal", name: "Modals"}, contentArray)));
        }, {modalKey: key});
        return modalKey;
    }

    /**
     * Opens only through Discord's native modal actions. Unlike the public
     * compatibility helper above, this never falls back to a raw DOM modal.
     * Callers must fail open when this returns undefined or onRenderError fires.
     */
    static showNativeConfirmationModal(title: string, content: (string | ReactElement | ReadonlyArray<string | ReactElement>), options: NativeConfirmationModalOptions = {}): string | number | undefined {
        const emptyFunction = () => {};
        const {
            onClose = emptyFunction,
            onConfirm = emptyFunction,
            onCancel = emptyFunction,
            onRenderError = emptyFunction,
            confirmText = t("Modals.okay"),
            cancelText = t("Modals.cancel"),
            danger = false,
            key = undefined,
            size = Root.Sizes.SMALL
        } = options;

        let actions: ModalActions | undefined;
        try {actions = this.ModalActions;}
        catch {return;}
        if (typeof actions?.openModal !== "function" || typeof actions.closeModal !== "function") return;

        let contentArray: Array<string | ReactElement> = Array.isArray(content) ? [...content] : [content];
        try {contentArray = contentArray.map(item => typeof item === "string" ? SimpleMarkdownExt.parseToReact(item) : item);}
        catch {return;}

        let renderFailureQueued = false;
        const reportRenderFailure = () => {
            if (renderFailureQueued) return;
            renderFailureQueued = true;
            queueMicrotask(onRenderError);
        };
        try {
            const modalKey = actions.openModal((props: any) => React.createElement(ErrorBoundary, {
                onError: reportRenderFailure
            }, React.createElement(ConfirmationModal, Object.assign({
                header: title,
                danger,
                confirmText,
                cancelText,
                onConfirm,
                onCancel,
                className: size,
                onCloseCallback: () => {
                    if (props?.transitionState === 2) onClose?.();
                }
            }, props), React.createElement(ErrorBoundary, {
                id: "showNativeConfirmationModal",
                name: "Modals",
                onError: reportRenderFailure
            }, contentArray))), key === undefined ? undefined : {modalKey: key});
            return typeof modalKey === "string" || typeof modalKey === "number" ? modalKey : undefined;
        }
        catch {return;}
    }

    static addonErrorsOpen = false;
    static showAddonError(error: AddonError) {
        if (!this.shouldShowAddonErrors) return;

        // Add the error to the store
        if (error.type === "theme") AddonErrorsStore.addThemeError(error);
        else AddonErrorsStore.addPluginError(error);

        // Don't have the modal open more than once, since the current one will just update
        if (this.addonErrorsOpen) return;
        this.addonErrorsOpen = true;

        this.openModal((props: any) => {
            return React.createElement(
                ErrorBoundary,
                {id: "showAddonErrors", name: "Modals"},
                React.createElement(AddonErrorModal, {
                    ...props
                })
            );
        }, {
            onCloseCallback: () => {
                this.addonErrorsOpen = false;
                AddonErrorsStore.clearErrors();
            }
        });
    }

    static showChangelogModal(options: ChangelogProps = {}) {
        const key = this.openModal(props => {
            return React.createElement(ErrorBoundary, {id: "showChangelogModal", name: "Modals"}, React.createElement(ChangelogModal, Object.assign({}, options, props)));
        });
        return key;
    }

    /**
     * Shows the guild join modal, to join invites.
     */
    static async showGuildJoinModal(code: string) {
        const tester = /\.gg\/(.*)$/;
        if (tester.test(code)) code = code.match(tester)![1];

        const {invite} = await DiscordModules.InviteActions?.resolveInvite(code) ?? {invite: null};

        if (!invite) {
            Logger.debug("Utilities", "Failed to resolve invite:", code);
            return;
        }

        const minimize = Patcher.instead("BetterDiscord~showGuildJoinModal", DiscordModules.RemoteModule!, "minimize", () => {});
        const focus = Patcher.instead("BetterDiscord~showGuildJoinModal", DiscordModules.RemoteModule!, "focus", () => {});

        try {
            await DiscordModules.Dispatcher?.dispatch({
                type: "INVITE_MODAL_OPEN",
                invite,
                code,
                context: "APP"
            });
        }
        finally {
            minimize!();
            focus!();
        }
    }

    static showAddonSettingsModal(name: string, panel: Element | string | (() => ReactNode) | ReactNode | ComponentType) {

        let child = panel;
        if (panel instanceof Node || typeof (panel) === "string") {
            child = class ReactWrapper extends React.Component<any, {hasError: boolean;}> {
                element: Element | string;
                elementRef: RefObject<Element | string | null>;
                constructor(props?: any) {
                    super(props);
                    this.elementRef = React.createRef();
                    this.element = panel as (Element | string);
                    this.state = {hasError: false};
                }

                componentDidCatch() {
                    this.setState({hasError: true});
                }

                componentDidMount() {
                    if (this.element instanceof Node) (this.elementRef as RefObject<Element>).current?.appendChild(this.element as Element);
                }

                render() {
                    if (this.state.hasError) return React.createElement(TextElement, {color: TextElement.Colors.STATUS_RED}, t("Addons.settingsError"));
                    return React.createElement("div", {
                        className: "bd-addon-settings-wrap",
                        ref: this.elementRef,
                        dangerouslySetInnerHTML: typeof (this.element) === "string" ? {__html: this.element} : undefined
                    });
                }
            };
        }
        if (typeof (child) === "function") child = React.createElement(child);

        const options = {
            className: "bd-addon-modal",
            size: ModalRoot.Sizes.MEDIUM,
            header: `${name} Settings`,
            cancelText: null,
            confirmText: t("Modals.done")
        };

        return this.openModal((props: any) => {
            return React.createElement(ErrorBoundary, {id: "showAddonSettingsModal", name: "Modals"}, React.createElement(ConfirmationModal, Object.assign(options, props), child as ReactElement));
        });
    }

    static hasInitialized = false;
    static stackReady = false;
    static pendingModals: Array<{render: (props?: unknown) => ReactNode; options: {modalKey?: string | number; onClose?(): void;};}> = [];
    static makeStack() {
        if (this.hasInitialized) return;
        const div = DOMManager.parseHTML(`<div id="bd-modal-container">`) as HTMLElement;
        let root: ReturnType<typeof ReactDOM.createRoot> | undefined;
        let renderFailure: Error | undefined;
        let cleaned = false;
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            this.stackReady = false;
            this.hasInitialized = false;
            this.pendingModals.length = 0;
            try {root?.unmount();}
            catch {/* Preserve the original rendering failure. */}
            finally {div.remove();}
        };
        try {
            if (typeof ReactDOM.createRoot !== "function" || typeof ReactDOM.flushSync !== "function") throw new Error("Local modal renderer is not ready.");
            DOMManager.bdBody.append(div);
            root = ReactDOM.createRoot(div);
            this.hasInitialized = true;
            ReactDOM.flushSync(() => root!.render(
                React.createElement(ErrorBoundary, {id: "makeStack",
name: "Modals",
hideError: true,
onError: error => {
                    renderFailure = error;
                    queueMicrotask(cleanup);
                }}, React.createElement(ModalStack, {onReady: () => {
                    this.stackReady = true;
                    for (const pending of this.pendingModals.splice(0)) Events.emit("open-modal", pending.render, pending.options);
                }}))
            ));
            if (renderFailure) throw renderFailure;
            if (!this.stackReady) throw new Error("Local modal stack did not become ready.");
        }
        catch (error) {
            cleanup();
            throw error;
        }
    }

    static openModal(render: (props?: unknown) => ReactNode, options: {modalKey?: string | number; onClose?(): void; onCloseCallback?(): void;} = {}) {
        const actions = this.ModalActions;
        if (actions) return actions.openModal(render, options);
        const localOptions = {...options, onClose: options.onClose ?? options.onCloseCallback, modalKey: generateKey(options.modalKey)};
        if (this.stackReady) Events.emit("open-modal", render, localOptions);
        else this.pendingModals.push({render, options: localOptions});
        if (!this.hasInitialized) this.makeStack();
        return localOptions.modalKey;
    }
}
