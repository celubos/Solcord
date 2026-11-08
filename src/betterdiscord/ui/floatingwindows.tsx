import React from "react";
import ReactDOM from "@modules/reactdom";
import DOMManager from "@modules/dommanager";

import FloatingWindowContainer from "./floating/container";
import type {FloatingWindowProps} from "./floating/window";
import Store from "@stores/base";

class FloatingWindows extends Store {
    private hasInitialized = false;

    public initialize(): boolean {
        if (this.hasInitialized) return true;
        if (typeof ReactDOM.createRoot !== "function") return false;

        const div = document.createElement("div");
        div.id = "floating-windows-layer";

        DOMManager.bdBody.append(div);

        try {
            const root = ReactDOM.createRoot(div);
            try {root.render(<FloatingWindowContainer />);}
            catch (error) {root.unmount(); throw error;}
            this.hasInitialized = true;
            return true;
        }
        catch (error) {div.remove(); throw error;}
    }

    public windows: FloatingWindowProps[] = [];

    public open(window: FloatingWindowProps) {
        if (!this.initialize()) throw new Error("Discord floating window interface is unavailable; retry after the interface finishes loading.");

        // If one exists under the same id do nothing
        if (this.windows.findIndex((win) => win.id === window.id) === -1) {
            this.windows = [
                ...this.windows,
                window
            ];
        }

        this.emitChange();
    }

    public close(id: string) {
        this.windows = this.windows.filter((window) => {
            if (window.id === id) {
                if (typeof window.onClose === "function") window.onClose();

                return false;
            }

            return true;
        });

        this.emitChange();
    }

    public isOpened(id: string) {
        return this.windows.findIndex((window) => window.id === id) !== -1;
    }
}

export default new FloatingWindows();
