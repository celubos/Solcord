// SPDX-License-Identifier: Apache-2.0

import React from "react";
import SolcordSwitch from "./switch";
import SolcordSlider from "./slider";

const READING_WIDTHS = [0, ...Array.from({length: 19}, (_, index) => 480 + index * 40)];

export function readingWidthStep(width: number): number {
    if (!Number.isFinite(width) || width < 480) return 0;
    return Math.min(19, 1 + Math.round((width - 480) / 40));
}

export function readingWidthAtStep(step: number): number {
    if (!Number.isFinite(step)) return 0;
    return READING_WIDTHS[Math.max(0, Math.min(19, Math.round(step)))];
}

export interface AccessibilityOptionsProps {
    enabled: boolean;
    values: Record<string, unknown>;
    onEnabledChange(enabled: boolean): unknown;
    onValueChange(key: string, value: boolean | number): unknown;
}

export default function AccessibilityOptions({enabled, values, onEnabledChange, onValueChange}: AccessibilityOptionsProps) {
    return <>
        <label><span>Use accessibility aids</span><SolcordSwitch label="Use accessibility aids" checked={enabled} onChange={onEnabledChange} /></label>
        {!enabled && <p className="solcord-key-hint">Off. Your saved choices below will apply when enabled.</p>}
        <div className="solcord-control-grid">
            <label><span>Reduced motion</span><SolcordSwitch label="Reduced motion" checked={values.reducedMotion === true} disabled={!enabled} onChange={value => onValueChange("reducedMotion", value)} /></label>
            <label><span>Role contrast aid</span><SolcordSwitch label="Role contrast aid" checked={values.roleContrast === true} disabled={!enabled} onChange={value => onValueChange("roleContrast", value)} /></label>
            <label><span>Reading ruler</span><SolcordSwitch label="Reading ruler" checked={values.readingRuler === true} disabled={!enabled} onChange={value => onValueChange("readingRuler", value)} /></label>
            <SolcordSlider label="Reading width" min={0} max={19} value={readingWidthStep(Number(values.readingWidth))} disabled={!enabled}
                formatValue={step => step ? `${readingWidthAtStep(step)} px` : "Discord default"}
                onCommit={step => onValueChange("readingWidth", readingWidthAtStep(step))} />
        </div>
    </>;
}
