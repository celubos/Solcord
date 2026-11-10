import type {LintResult} from "stylelint";
export function cssDiagnostics(results: LintResult[], root?: string): Record<string, number>;
export function addedCssDiagnostics(actual: Record<string, number>, baseline: Record<string, number>): {key: string; count: number}[];
