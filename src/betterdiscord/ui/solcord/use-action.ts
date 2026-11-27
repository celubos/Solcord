// SPDX-License-Identifier: Apache-2.0

import {createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type RefObject} from "react";

export const SolcordActionErrorContext = createContext<((error: unknown) => void) | undefined>(undefined);

/** A temporary disabled state must not strand keyboard users after a save. */
export function useSolcordControlFocus(input: RefObject<HTMLInputElement | HTMLButtonElement | null>, pending: boolean, disabled: boolean) {
    const restore = useRef(false);
    useLayoutEffect(() => {
        if (pending || !restore.current) return;
        restore.current = false;
        const target = input.current;
        if (!target?.isConnected || disabled || target.disabled) return;
        const document = target.ownerDocument;
        // Do not take focus back if the user moved to another control.
        if (!document.activeElement || document.activeElement === document.body) target.focus({preventScroll: true});
    }, [input, pending, disabled]);
    return () => {
        const target = input.current;
        restore.current = Boolean(target && target.ownerDocument.activeElement === target);
    };
}

/** Results belong to the latest request in one account/provider/input context. */
export function useSolcordResultScope(key: string, validate?: () => boolean) {
    const scope = useRef({key, revision: 0, mounted: true});
    const validation = useRef(validate);
    validation.current = validate;
    if (scope.current.key !== key) {
        scope.current.key = key;
        scope.current.revision++;
    }
    useEffect(() => {
        const current = scope.current;
        current.mounted = true;
        return () => {current.mounted = false; current.revision++;};
    }, []);
    const invalidate = () => {scope.current.revision++;};
    const begin = () => {
        const revision = ++scope.current.revision;
        return () => {
            if (!scope.current.mounted || scope.current.revision !== revision) return false;
            try {return validation.current?.() ?? true;}
            catch {return false;}
        };
    };
    return {begin, invalidate};
}

/** Inputs may update different fields in succession; failures still need feedback. */
export function useSolcordWrite<Args extends unknown[]>(write: (...args: Args) => unknown, onError?: (error: unknown) => void) {
    const reportError = useContext(SolcordActionErrorContext);
    return async (...args: Args): Promise<boolean> => {
        try {return await write(...args) !== false;}
        catch (error) {(onError ?? reportError)?.(error); return false;}
    };
}

/** Keep repeat clicks and rejected writes inside one user interaction. */
export function useSolcordAction<Args extends unknown[]>(action: (...args: Args) => unknown, onError?: (error: unknown) => void) {
    const reportError = useContext(SolcordActionErrorContext);
    const [pending, setPending] = useState(false);
    const inFlight = useRef(false);
    const mounted = useRef(true);
    useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);

    const run = async (...args: Args): Promise<boolean> => {
        if (inFlight.current || !mounted.current) return false;
        inFlight.current = true;
        setPending(true);
        try {return await action(...args) !== false;}
        catch (error) {
            if (mounted.current) {
                (onError ?? reportError)?.(error);
            }
            return false;
        }
        finally {
            inFlight.current = false;
            if (mounted.current) setPending(false);
        }
    };
    return {pending, run};
}
