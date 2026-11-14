// SPDX-License-Identifier: Apache-2.0

import React, {useRef} from "react";
import {useSolcordAction, useSolcordControlFocus} from "./use-action";

export default function ActionButton({children, onClick, tone = "neutral", disabled = false}: {children: React.ReactNode; onClick(): unknown; tone?: "neutral" | "accent" | "danger"; disabled?: boolean;}) {
    const {pending, run} = useSolcordAction(onClick);
    const button = useRef<HTMLButtonElement>(null);
    // The button is disabled while its action runs; return keyboard focus afterwards.
    const preserveFocus = useSolcordControlFocus(button, pending, disabled);
    return <button ref={button} type="button" className={`solcord-action solcord-action-${tone}`} onClick={() => {if (!disabled) {preserveFocus(); void run();}}} disabled={disabled || pending} aria-busy={pending || undefined}>{children}</button>;
}
