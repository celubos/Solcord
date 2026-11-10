import {memoize} from "@common/utils";
import type {RemoteModule, UserAgentInfo, Dispatcher, InviteActions, SimpleMarkdown, ReactSpring, MessageUtils, PromptToUpload, DiscordTooltip, SimpleMarkdownWrapper} from "@typed/discord/modules";
import {Filters, getBulkKeyed, getByKeys, getBySource, getByStrings, getModule} from "@webpack";
import type React from "react";
import type {Webpack} from "@typed/discord";
import {isReactRuntime} from "@common/react-readiness";

interface Modules {
    React: typeof React;
    ReactSpring: ReactSpring;
    SimpleMarkdown: SimpleMarkdown;
    Dispatcher: Dispatcher;
    Tooltip: DiscordTooltip;
    AccessibilityContext: React.Context<{reducedMotion: {enabled: false;};}>;
    ChannelActions: {selectPrivateChannel(id: string): void; selectVoiceChannel(a: any, b: any): void;};
}

const SyncQueries = {
    React: {
        filter: isReactRuntime,
        firstId: 483362,
        cacheId: "core-React"
    },
    ReactSpring: {
        filter: m => typeof m?.useTransition === "function" && typeof m.useSpring === "function" && m.animated,
        firstId: 429783,
        cacheId: "core-ReactSpring"
    },
    SimpleMarkdown: {
        filter: Filters.byKeys(["defaultReactOutput"]),
        firstId: 791332,
        searchExports: true,
        cacheId: "core-SimpleMarkdown"
    },
    Dispatcher: {
        filter: Filters.byKeys(["dispatch", "subscribe", "register"]),
        searchExports: true,
        firstId: 570140,
        cacheId: "core-Dispatcher"
    },
    Tooltip: {
        filter: Filters.byPrototypeKeys(["renderTooltip"]),
        searchExports: true,
        firstId: 481060,
        cacheId: "core-Tooltip"
    },
    AccessibilityContext: {
        filter: m => m?._currentValue?.reducedMotion,
        searchExports: true,
        firstId: 159691,
        cacheId: "core-AccessibilityContext"
    },
    ChannelActions: {
        filter: Filters.byKeys(["selectPrivateChannel"]),
        firstId: 287734,
        cacheId: "core-ChannelActions"
    }
} satisfies Record<keyof Modules, Webpack.BulkQueries>;

const SyncModules = getBulkKeyed<Modules>(SyncQueries);
const FallbackTooltip = (props => props.children?.({}) ?? null) as DiscordTooltip;

const MemoModules = memoize({
    get InviteActions(): InviteActions | undefined {return getByKeys(["createInvite"], {firstId: 846293, cacheId: "core-InviteActions"});},
    get SimpleMarkdownWrapper(): SimpleMarkdownWrapper | undefined {return getByKeys(["reactParserFor"], {firstId: 46054, cacheId: "core-SimpleMarkdownWrapper"});},
    get RemoteModule(): RemoteModule | undefined {return getByKeys(["setBadge"], {firstId: 837921, cacheId: "core-RemoteModule"});},
    get UserAgentInfo(): UserAgentInfo | undefined {return getByKeys(["os", "layout"], {firstId: 214958, cacheId: "core-UserAgentInfo"});},
    get MessageUtils() {return getByKeys<MessageUtils>(["sendMessage"], {firstId: 843472, cacheId: "core-MessageUtils"});},
    get LinkParser(): any {return getModule(m => m.html && m.requiredFirstCharacters?.[0] === "[", {firstId: 694403, cacheId: "core-LinkParser"});},
    get DiscordMarkdown(): any {return getModule(m => m?.prototype?.render && m.rules, {firstId: 558179, cacheId: "core-DiscordMarkdown"});},
    get Layout(): Record<string, any> {return getBySource(["$Root", "buildLayout"], {searchDefault: false, firstId: 419954, cacheId: "core-Layout"})!;},
    get NoticesBaseClasses(): {base: string;} | undefined {return getByKeys(["container", "base", "sidebar"], {cacheId: "core-NoticesBaseClasses"});},
    get NoticesPageClasses(): {errorPage: string;} | undefined {return getByKeys(["errorPage"], {cacheId: "core-NoticesPageClasses"});},
    get ViewClasses(): {standardSidebarView: string;} | undefined {return getByKeys(["standardSidebarView"], {cacheId: "core-ViewClasses"});},
}, {cacheUndefined: false});

/**
 * Upload internals are loaded later than most core modules on some Discord
 * builds. Do not memoize a missing first lookup forever. The first signature is
 * the currently reviewed invariant; the second preserves the older compatible
 * shape while both results still have to be callable.
 */
export function resolvePromptToUpload(): PromptToUpload | undefined {
    const current = getByStrings<PromptToUpload>(["Unexpected mismatch between files and file metadata"], {searchExports: true, cacheId: "core-promptToUpload-current"});
    if (typeof current === "function") return current;
    const legacy = getByStrings<PromptToUpload>(["getUploadCount", ".UPLOAD_FILE_LIMIT_ERROR"], {searchExports: true, firstId: 518960, cacheId: "core-promptToUpload-legacy"});
    return typeof legacy === "function" ? legacy : undefined;
}

const DiscordModules = Object.create(null) as typeof MemoModules & Modules & {readonly promptToUpload?: PromptToUpload;};
for (const key of Object.keys(MemoModules) as Array<keyof typeof MemoModules>) {
    Object.defineProperty(DiscordModules, key, {enumerable: true, get: () => MemoModules[key]});
}
for (const key of Object.keys(SyncQueries) as Array<keyof Modules>) {
    Object.defineProperty(DiscordModules, key, {
        enumerable: true,
        get() {
            if (SyncModules[key] === undefined) {
                const query = SyncQueries[key];
                const found = getModule(query.filter, query);
                if (found !== undefined) Object.assign(SyncModules, {[key]: found});
            }
            return SyncModules[key] ?? (key === "Tooltip" ? FallbackTooltip : undefined);
        }
    });
}
Object.defineProperty(DiscordModules, "promptToUpload", {
    configurable: false,
    enumerable: true,
    get: resolvePromptToUpload
});
export default DiscordModules;
