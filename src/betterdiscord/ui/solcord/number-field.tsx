// SPDX-License-Identifier: Apache-2.0

import React from "react";

const {useEffect, useRef, useState} = React;

/**
 * A number setting that saves when the user finishes typing (blur or Enter),
 * not on every keystroke. Saving per keystroke clamped partial input such as
 * "3" in "3500" and replaced it before the next digit arrived.
 */
export default function DraftNumberField({label, value, min, max, onCommit}: {label: string; value: number; min: number; max: number; onCommit(value: number): unknown;}) {
    const [draft, setDraft] = useState(String(value));
    const [note, setNote] = useState("");
    const editing = useRef(false);
    useEffect(() => {if (!editing.current) setDraft(String(value));}, [value]);
    const commit = () => {
        editing.current = false;
        const parsed = Number(draft.trim());
        if (!draft.trim() || !Number.isFinite(parsed)) {
            setNote(`Enter a number from ${min} to ${max}. The saved value was kept.`);
            setDraft(String(value));
            return;
        }
        const bounded = Math.min(max, Math.max(min, Math.round(parsed)));
        setNote(bounded !== parsed ? `Saved ${bounded}; the allowed range is ${min} to ${max}.` : "");
        setDraft(String(bounded));
        if (bounded !== value) void onCommit(bounded);
    };
    return <label>{label}
        <input type="number" inputMode="numeric" min={min} max={max} value={draft}
            onFocus={() => {editing.current = true;}}
            onChange={event => {editing.current = true; setDraft(event.currentTarget.value);}}
            onBlur={commit}
            onKeyDown={event => {if (event.key === "Enter") commit();}} />
        {note && <small role="status">{note}</small>}
    </label>;
}
