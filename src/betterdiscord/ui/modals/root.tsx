import clsx from "clsx";
import React, {type PropsWithChildren} from "react";
import DiscordModules from "@modules/discordmodules";
import {getByKeys, getModule} from "@webpack";


export const ModalSizes = Object.freeze({
    SMALL: "bd-modal-small",
    MEDIUM: "bd-modal-medium",
    LARGE: "bd-modal-large",
    DYNAMIC: ""
});

export const ModalStyles = Object.freeze({
    STANDARD: "bd-modal-standard",
    CUSTOM: ""
});


const DefaultAccessibilityContext = React.createContext<{reducedMotion?: {enabled?: boolean;};}>({});
const focusableSelector = "button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex='-1'])";

/** Keep the local recovery dialog keyboard-accessible while native focus modules load. */
function LocalFocusLock({children}: PropsWithChildren) {
    const container = React.useRef<HTMLDivElement>(null);
    React.useLayoutEffect(() => {
        const node = container.current!;
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
        const focusFirst = () => (node.querySelector<HTMLElement>(focusableSelector) ?? node).focus();
        if (!node.contains(document.activeElement)) focusFirst();
        const focusIn = (event: FocusEvent) => {if (!node.contains(event.target as Node)) focusFirst();};
        const keyDown = (event: KeyboardEvent) => {
            if (event.key !== "Tab") return;
            const items = [...node.querySelectorAll<HTMLElement>(focusableSelector)].filter(item => !item.hidden && item.getAttribute("aria-hidden") !== "true");
            const first = items.at(0);
            const last = items.at(-1);
            if (!first || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
                event.preventDefault();
                (event.shiftKey ? last : first)?.focus();
            }
        };
        document.addEventListener("focusin", focusIn);
        node.addEventListener("keydown", keyDown);
        return () => {
            document.removeEventListener("focusin", focusIn);
            node.removeEventListener("keydown", keyDown);
            if (previous?.isConnected) previous.focus();
        };
    }, []);
    return <div ref={container} role="dialog" aria-modal="true" tabIndex={-1}>{children}</div>;
}

type RootProps = PropsWithChildren<{
    className?: string;
    transitionState?: number;
    size?: typeof ModalSizes[keyof typeof ModalSizes];
    style?: typeof ModalStyles[keyof typeof ModalStyles];
}>;

export default function ModalRoot({className, transitionState, children, size = ModalSizes.DYNAMIC, style = ModalStyles.CUSTOM}: RootProps) {
    // Resolve optional modules once per dialog. Late loading must not remount its form.
    const [modules] = React.useState(() => {
        const context = DiscordModules.AccessibilityContext as React.Context<{reducedMotion?: {enabled?: boolean;};}> | undefined;
        const spring = DiscordModules.ReactSpring as Partial<typeof DiscordModules.ReactSpring> | undefined;
        return {
            context: context ?? DefaultAccessibilityContext,
            spring: typeof spring?.useSpring === "function" && spring.animated?.div !== undefined ? spring : undefined,
            easing: getByKeys<any>(["Easing"], {firstId: 615300, cacheId: "core-modalroot-anims"})?.Easing,
            FocusLock: getModule<any>(m => m?.render?.toString().includes("impressionProperties") && m?.render?.toString().includes(".Provider"), {
                searchExports: true, firstId: 305866, cacheId: "core-modalroot-focuslock"
            }) ?? LocalFocusLock
        };
    });
    const preferences = React.useContext(modules.context);
    const reducedMotion = preferences?.reducedMotion?.enabled ?? document.documentElement?.classList.contains("reduce-motion");
    const visible = transitionState === undefined || transitionState === null || transitionState === 0 || transitionState === 1;
    const classes = clsx("bd-modal-root", size, className, style);
    const FocusLock = modules.FocusLock;
    return <FocusLock disableTrack={true}>
        {modules.spring ? <AnimatedRoot spring={modules.spring} easing={modules.easing} visible={visible} reducedMotion={reducedMotion} className={classes}>{children}</AnimatedRoot>
            : <div className={classes} style={{opacity: visible ? 1 : 0}}>{children}</div>}
    </FocusLock>;
}

function AnimatedRoot({spring: Spring, easing: Easing, visible, reducedMotion, className, children}: PropsWithChildren<{spring: any; easing: any; visible: boolean; reducedMotion: boolean; className: string;}>) {
    const easing = typeof Easing?.inOut === "function" && typeof Easing.back === "function" && typeof Easing.quad === "function"
        ? (visible ? Easing.inOut(Easing.back()) : Easing.quad) : undefined;
    const springStyles = Spring.useSpring({
        opacity: visible ? 1 : 0,
        transform: visible || reducedMotion ? "scale(1)" : "scale(0.7)",
        config: {
            duration: visible ? 300 : 100,
            ...(easing ? {easing} : {}),
            clamp: true
        }
    });

    return <Spring.animated.div
            className={className}
            style={springStyles}
        >
            {children}
        </Spring.animated.div>;
}

ModalRoot.Sizes = ModalSizes;
ModalRoot.Styles = ModalStyles;
