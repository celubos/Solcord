export interface SolcordFakeDeafenRowRefreshOptions {
    root: (ParentNode & Node) | null;
    channelId: unknown;
    getInternalInstance(element: Element): unknown;
    /** Revalidate the caller's account, session, channel, and lifecycle lease. */
    isCurrent(): boolean;
}

const DISCORD_ID = /^[1-9]\d{16,19}$/;
const MAX_OWNER_DEPTH = 32;
let refreshing = false;

/**
 * Refresh only the native class that renders the current channel's voice rows.
 * The caller coalesces this after dispatch and removes its presentation patch
 * before requesting a cleanup refresh. No native store or media state changes.
 */
export function refreshSolcordFakeDeafenCurrentChannelRow({root, channelId, getInternalInstance, isCurrent}: SolcordFakeDeafenRowRefreshOptions): boolean {
    if (refreshing || !root || typeof channelId !== "string" || !DISCORD_ID.test(channelId)) return false;
    refreshing = true;
    try {
        if (!isCurrent()) return false;
        // Public ChannelItem166444 uses rm(channel.id); list616740 has id
        // "channels", and navigation602034 encodes `${listId}___${itemId}`.
        const anchor = root.querySelector(`[data-list-item-id="channels___${channelId}"]`);
        if (!anchor?.isConnected) return false;
        let current = getInternalInstance(anchor);
        const visited = new Set<object>();
        for (let depth = 0; current && typeof current === "object" && depth < MAX_OWNER_DEPTH; depth++) {
            if (visited.has(current)) return false;
            visited.add(current);
            const fiber = current as {stateNode?: unknown; return?: unknown;};
            const instance = fiber.stateNode;
            if (instance && typeof instance === "object") {
                const owner = instance as {
                    props?: {channel?: {id?: unknown;};};
                    isReactComponent?: unknown;
                    forceUpdate?: unknown;
                    renderVoiceUsers?: unknown;
                };
                if (owner.props?.channel?.id === channelId && owner.isReactComponent && typeof owner.isReactComponent === "object"
                    && typeof owner.forceUpdate === "function" && typeof owner.renderVoiceUsers === "function" && owner.renderVoiceUsers.length === 0) {
                    const source = Function.prototype.toString.call(owner.renderVoiceUsers);
                    if (source.length > 4096 || !source.includes("this.props") || !source.includes("channel") || !source.includes("voiceStates")) return false;
                    if (!anchor.isConnected || !root.contains(anchor) || !isCurrent() || owner.props?.channel?.id !== channelId) return false;
                    Reflect.apply(owner.forceUpdate, owner, []);
                    return true;
                }
            }
            current = fiber.return;
        }
    }
    catch {/* Changed, detached, or inaccessible native owners stay untouched. */}
    finally {refreshing = false;}
    return false;
}
