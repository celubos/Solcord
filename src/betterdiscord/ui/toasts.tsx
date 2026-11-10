import React, {Fragment} from "react";
import DiscordModules from "@modules/discordmodules";
import DOMManager from "@modules/dommanager";
import ReactDOM from "@modules/reactdom";
import ToastStore from "@stores/toasts";
import ToastIcon from "@ui/toasts/ToastIcon";
import {useStateFromStores} from "@ui/hooks";

import clsx from "clsx";
import type {Root} from "react-dom/client";
import type {AnimatedProps} from "@react-spring/web";

export type ToastType = "default" | "info" | "success" | "warning" | "error";

export interface ToastProps {
    key: number;
    group?: string;
    content: string;
    type: ToastType;
    icon: boolean;
    timeout: number;
}

interface ToastItemProps {
    content: string;
    type: ToastType;
    icon: boolean;
    style: AnimatedProps<React.CSSProperties>;
}

export function Toast({content, type, icon, style}: ToastItemProps) {
    const ReactSpring = DiscordModules.ReactSpring;
    return (
        <ReactSpring.animated.div className={clsx("bd-toast", `toast-${type}`)} style={style}>
            {icon && <ToastIcon type={type} />}
            <span>{content}</span>
        </ReactSpring.animated.div>
    );
}

export function ToastContainer() {
    const ReactSpring = DiscordModules.ReactSpring;
    const toasts = useStateFromStores(ToastStore, () => ToastStore.toasts);

    const transition = ReactSpring.useTransition(toasts, {
        keys: (toast: ToastProps) => toast.key,
        from: {opacity: 0, transform: "translateY(100%)"},
        enter: {opacity: 1, transform: "translateY(0px)"},
        leave: {opacity: 0, transform: "translateY(100%)"},
        config: ReactSpring.config.stiff,
    });

    return (
        <Fragment>
            {transition((style, item) => (
                <Toast key={item.key} content={item.content} type={item.type} icon={item.icon} style={style} />
            ))}
        </Fragment>
    );
}

export default class Toasts {
    static root?: Root;

    static initialize(): boolean {
        if (this.root) return true;
        const spring = DiscordModules.ReactSpring;
        if (typeof ReactDOM.createRoot !== "function" || typeof spring?.useTransition !== "function" || !spring.animated?.div) return false;
        const container = document.createElement("div");
        container.id = "bd-toasts";
        DOMManager.bdBody.appendChild(container);
        try {
            const root = ReactDOM.createRoot(container);
            try {root.render(React.createElement(ToastContainer));}
            catch (error) {root.unmount(); throw error;}
            this.root = root;
            return true;
        }
        catch (error) {container.remove(); throw error;}
    }
}
