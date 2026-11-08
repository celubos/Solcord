import type React from "react";

const requiredFunctions = [
    "Component", "createElement", "cloneElement", "createContext", "forwardRef", "memo",
    "useCallback", "useEffect", "useMemo", "useRef", "useState", "useSyncExternalStore"
] as const;

/** The renderer consumes these APIs during imports and its first render. */
export function isReactRuntime(value: unknown): value is typeof React {
    if (!value || (typeof value !== "object" && typeof value !== "function")) return false;
    try {
        const api = value as Record<string, unknown>;
        return api.Fragment !== undefined && requiredFunctions.every(key => typeof api[key] === "function");
    }
    catch {return false;}
}
