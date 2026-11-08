// SPDX-License-Identifier: Apache-2.0

/** Shared renderer/main wire limits. Count UTF-8 JSON bytes, not UTF-16 units. */
export const TIMELINE_MAX_EVENT_BYTES = 96 * 1024;
export const TIMELINE_MAX_APPEND_BYTES = 4 * 1024 * 1024;
export const TIMELINE_MAX_APPEND_EVENTS = 100;

const encoder = new TextEncoder();
export function timelineSerializedBytes(value: unknown): number {return encoder.encode(JSON.stringify(value)).byteLength;}

/** Normalize observed text before displaying it, so memory and native storage agree. */
export function fitTimelineEventBytes<T extends {content?: string;}>(event: T): T {
    if (timelineSerializedBytes(event) <= TIMELINE_MAX_EVENT_BYTES) return event;
    if (typeof event.content !== "string") throw new RangeError("Timeline event metadata exceeds the byte limit.");
    const text = event.content;
    let low = 0;
    let high = text.length;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (timelineSerializedBytes({...event, content: text.slice(0, middle)}) <= TIMELINE_MAX_EVENT_BYTES) low = middle;
        else high = middle - 1;
    }
    if (low > 0 && /[\uD800-\uDBFF]/.test(text[low - 1])) low--;
    const bounded = {...event, content: text.slice(0, low)};
    if (timelineSerializedBytes(bounded) > TIMELINE_MAX_EVENT_BYTES) throw new RangeError("Timeline event metadata exceeds the byte limit.");
    return bounded;
}

export function chunkTimelineEvents<T>(events: readonly T[]): T[][] {
    const chunks: T[][] = [];
    let chunk: T[] = [];
    let bytes = 2;
    for (const event of events) {
        const size = timelineSerializedBytes(event);
        if (size > TIMELINE_MAX_EVENT_BYTES) throw new RangeError("Timeline event exceeds the byte limit.");
        if (chunk.length && (chunk.length >= TIMELINE_MAX_APPEND_EVENTS || bytes + size + 1 > TIMELINE_MAX_APPEND_BYTES)) {
            chunks.push(chunk); chunk = []; bytes = 2;
        }
        bytes += size + (chunk.length ? 1 : 0);
        chunk.push(event);
    }
    if (chunk.length) chunks.push(chunk);
    return chunks;
}

/** Remove a chunk only after its writer acknowledges it for the same identity. */
export async function drainTimelineChunks<T>(pending: T[][], write: (chunk: readonly T[]) => Promise<void>, isCurrent: () => boolean): Promise<boolean> {
    while (pending.length && isCurrent()) {
        const chunk = pending[0];
        await write(chunk);
        if (!isCurrent() || pending[0] !== chunk) return false;
        pending.shift();
    }
    return isCurrent() && pending.length === 0;
}
