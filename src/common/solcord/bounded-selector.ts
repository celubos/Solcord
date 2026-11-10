// SPDX-License-Identifier: Apache-2.0

/** Preserve source order while enriching only records that can be displayed. */
export function mapSolcordVisibleRecords<T, U, V>(records: Iterable<T>, resolve: (record: T) => U | undefined, enrich: (record: U) => V, limit = 1_000): V[] {
    const visible: V[] = [];
    const maximum = Number.isFinite(limit) ? Math.max(0, Math.min(1_000, Math.floor(limit))) : 1_000;
    for (const record of records) {
        if (visible.length >= maximum) break;
        const accepted = resolve(record);
        if (accepted !== undefined) visible.push(enrich(accepted));
    }
    return visible;
}
