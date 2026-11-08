import React, {type ReactNode} from "react";
import Events from "@modules/emitter";

import Backdrop from "./backdrop";
import {getWithKey} from "@webpack";

const {Fragment, useState, useCallback, useLayoutEffect, useRef} = React;


const [Transitions, TransitionKey] = getWithKey(m => m?.defaultProps?.transitionAppear);
const TransitionGroup = Transitions && TransitionKey ? Transitions[TransitionKey] : ({children}: React.PropsWithChildren) => <>{children}</>;

class ModalLayer extends React.Component<{onClose(): void; render(p: any): ReactNode;}, {transitionState: number | null;}> {
    constructor(props: {onClose(): void; render(p: any): ReactNode;}) {
        super(props);
        this.state = {transitionState: 1};
    }

    transitionTimer?: ReturnType<typeof setTimeout>;
    componentWillUnmount() {clearTimeout(this.transitionTimer);}

    componentWillEnter(finish: () => void) {
        this.setState({transitionState: 0});
        clearTimeout(this.transitionTimer);
        this.transitionTimer = setTimeout(() => {
            this.setState({transitionState: 1});
            finish();
        }, 300);

    }
    componentWillLeave(finish: () => void) {
        this.setState({transitionState: 2});
        clearTimeout(this.transitionTimer);
        this.transitionTimer = setTimeout(() => {
            this.setState({transitionState: 3});
            finish();
        }, 300);
    }

    render() {
        return React.createElement("div", {className: "bd-modal-layer"}, this.props.render({
            transitionState: this.state.transitionState,
            onClose: this.props.onClose
        }));
    }
}

// ENTERING 0
// ENTERED 1
// EXITING 2
// EXITED 3
// HIDDEN 4

let modalKey = 0;
export const generateKey = (key?: string | number) => key ? `${key}-${modalKey++}` : modalKey++;

export default function ModalStack({onReady}: {onReady?(): void;}) {
    const [modals, setModals] = useState<Array<{render(props?: unknown): ReactNode; modalKey: string; onClose?(): void;}>>([]);
    const currentModals = useRef(modals);

    const addModal = useCallback((render: (props?: unknown) => ReactNode, props: any = {}) => {
        const next = [...currentModals.current, {...props, render}];
        currentModals.current = next;
        setModals(next);
    }, []);
    const removeModal = useCallback((key: string) => {
        const removed = currentModals.current.filter(modal => modal.modalKey === key);
        const next = currentModals.current.filter(modal => modal.modalKey !== key);
        currentModals.current = next;
        setModals(next);
        for (const modal of removed) modal.onClose?.();
    }, []);

    useLayoutEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const last = currentModals.current.at(-1);
            if (last && event.key === "Escape" && !event.defaultPrevented) {
                event.preventDefault();
                removeModal(last.modalKey);
            }
        };
        Events.on("open-modal", addModal);
        Events.on("close-modal", removeModal);
        document.addEventListener("keydown", onKeyDown);
        onReady?.();
        return () => {
            Events.off("open-modal", addModal);
            Events.off("close-modal", removeModal);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [addModal, removeModal, onReady]);

    return <TransitionGroup component={Fragment}>
        <Backdrop isVisible={!!modals.length} onClick={() => removeModal(modals[modals.length - 1].modalKey)} />
        {!!modals.length && <ModalLayer key={modals[modals.length - 1].modalKey} {...modals[modals.length - 1]} onClose={() => removeModal(modals[modals.length - 1].modalKey)} />}
    </TransitionGroup>;
}
