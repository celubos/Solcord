import ReactDOM from "@modules/reactdom";
import React from "react";
import Settings, {type SettingsCollection} from "@stores/settings";
import JsonStore from "@stores/json";
import {Filters, getByKeys, getLazy, getMangled, getMangledLazy, getMatched, lazyListeners} from "@webpack";
import Patcher from "@modules/patcher";

import AddonPage from "@ui/settings/addonpage";

import type {SettingsCategory} from "@data/settings";
import VersionInfo from "./misc/versioninfo";
import {useForceUpdate, useStateFromStores} from "./hooks";
import SettingsPanel from "./settings/panel";
import {CustomCSS} from "@builtins/builtins";
import {lucideToDiscordIcon, type DiscordIcon} from "@utils/icon";
import {Logo} from "./logo";
import DiscordModules from "@modules/discordmodules";
import Button from "./base/button";
import {HistoryIcon} from "lucide-react";
import {t} from "@common/i18n";
import Modals from "./modals";
import changelog from "@data/changelog";
import {type Plugin} from "@modules/pluginmanager";
import DOMManager from "@modules/dommanager";
import type AddonManager from "@modules/addonmanager";
import toasts from "@stores/toasts";
import ContextMenuPatcher from "@api/contextmenu";
import type {GroupOnChange} from "./settings/group";
import {normalizeSettingsSearchTerms, resolveAddonDisplayNames} from "./settings/addon-names";
import Logger from "@common/logger";
import ModalRoot from "./modals/root";
import ErrorBoundary from "./errorboundary";
import type {Webpack} from "@typed/discord";

const ContextMenu = new ContextMenuPatcher();

const getUserSettings = () => getByKeys<any>(["openUserSettings"], {firstId: 840065, cacheId: "core-settings-usersettings"});

const SettingsRenderer = new class SettingsRenderer {
    private initialized = false;
    private initializing?: Promise<boolean>;
    private searchPatched = false;
    private versionPatched = false;
    private navigationRootAvailable = false;
    private lateNavigationListener?: Webpack.ModuleFilter;
    private retryQueued = false;
    private disposed = false;
    private activeController?: AbortController;
    private controlCenterModal?: string | number;
    get isAvailable() {return this.initialized;}
    private readonly onPageHide = () => {
        this.disposed = true;
        this.activeController?.abort();
        this.stopLateNavigationWatch();
    };

    private stopLateNavigationWatch() {
        if (this.lateNavigationListener) lazyListeners.delete(this.lateNavigationListener);
        this.lateNavigationListener = undefined;
        window.removeEventListener("pagehide", this.onPageHide);
    }

    private watchLateNavigation() {
        if (this.lateNavigationListener || this.initialized || this.disposed) return;
        this.lateNavigationListener = (_, module) => {
            const root = getMatched(module, m => m?.key === "$Root" && typeof m.buildLayout === "function", {searchExports: true, searchDefault: false});
            if (root) this.navigationRootAvailable = true;
            if (!this.navigationRootAvailable || this.retryQueued) return;
            this.retryQueued = true;
            queueMicrotask(async () => {
                // A late module may arrive while the bounded startup attempt is
                // settling. Retry after it releases ownership, never alongside it.
                await this.initializing;
                this.retryQueued = false;
                if (!this.disposed && !this.initialized) void this.initialize();
            });
        };
        lazyListeners.add(this.lateNavigationListener);
        window.addEventListener("pagehide", this.onPageHide, {once: true});
    }

    initialize(): Promise<boolean> {
        if (this.disposed) return Promise.resolve(false);
        // The product-owned entry must remain available even when Discord's
        // private settings layout has not loaded or changed shape.
        Settings.setPanelOpener(id => this.openSettingsPage(id));
        if (this.initialized) return Promise.resolve(true);
        if (this.initializing) return this.initializing;
        this.watchLateNavigation();
        const controller = new AbortController();
        this.activeController = controller;
        const deadline = setTimeout(() => controller.abort(), 10_000);
        // Version decoration is optional. It shares the bounded lookup lifetime
        // but cannot reject the navigation registration or delay its readiness.
        void this.patchVersionInformation(controller.signal).catch(() => {
            Logger.warn("SettingsRenderer", "Optional version decoration is unavailable.");
        });
        this.initializing = this.patchModalSettings(controller.signal).then(ready => {
            this.initialized = ready;
            if (ready) this.stopLateNavigationWatch();
            return ready;
        }).catch(() => {
            Logger.warn("SettingsRenderer", "Discord settings integration is unavailable; initialization can be retried after modules load.");
            return false;
        }).finally(() => {
            clearTimeout(deadline);
            controller.abort();
            this.activeController = undefined;
            this.initializing = undefined;
        });
        return this.initializing;
    }

    onDrawerToggle(collection: string, group: string, state: boolean) {
        const drawerStates: Partial<Record<string, Record<string, boolean>>> = JsonStore.get("misc", "drawerStates") || {};
        if (!drawerStates[collection]) drawerStates[collection] = {};
        drawerStates[collection][group] = state;
        JsonStore.set("misc", "drawerStates", drawerStates);
    }

    getDrawerState(collection: string, group: string, defaultValue: boolean) {
        const drawerStates: Partial<Record<string, Record<string, boolean>>> = JsonStore.get("misc", "drawerStates") || {};
        if (!drawerStates[collection]) return defaultValue;
        if (!drawerStates[collection].hasOwnProperty(group)) return defaultValue;
        return drawerStates[collection][group];
    }

    buildSettingsPanel(id: string, title: string, groups: SettingsCategory[], onChange: GroupOnChange) {
        return React.createElement(SettingsPanel, {
            id,
            title,
            groups,
            onChange: onChange.bind(this),
            onDrawerToggle: this.onDrawerToggle.bind(this),
            getDrawerState: this.getDrawerState.bind(this)
        });
    }

    getAddonPanel(title: string, options: {store: AddonManager;}) {
        return (props: any) => {
            return React.createElement(AddonPage, Object.assign({}, {
                title: title,
                ...props
            }, options));
        };
    }

    private layoutBuilder?: LayoutBuilder;
    private getLayoutBuilder() {
        if (this.layoutBuilder) return this.layoutBuilder;

        const layoutModuleRaw = DiscordModules.Layout;

        const out: Partial<LayoutBuilder> = {};
        for (const key in layoutModuleRaw) {
            if (!Object.hasOwn(layoutModuleRaw, key)) continue;
            if (typeof layoutModuleRaw[key] !== "function") continue;

            const match = String(layoutModuleRaw[key]).match(/\..{1,3}\.(.+?),/);

            if (match) {
                // Format FOO -> foo and FOO_BAR -> fooBar
                const outKey = match[1].toLowerCase().replace(/_([a-z])/gi, (_, letter) => letter.toUpperCase());

                Object.defineProperty(out, outKey, {
                    value(id: string, ...args: any) {
                        if (typeof id === "string") {
                            id = `betterdiscord_${id}_${outKey}`;
                        }

                        return layoutModuleRaw[key](id, ...args);
                    }
                });
            }
        }

        for (const key of ["custom", "category", "panel", "sidebarItem", "section"] as const) {
            if (typeof out[key] !== "function") throw new Error("Discord settings layout builders are unavailable");
        }
        return this.layoutBuilder = out as LayoutBuilder;
    }

    async patchModalSettings(signal?: AbortSignal): Promise<boolean> {
        // if discords creates another root check buildLayout
        const rootLayout = await getLazy<{
            key: "$Root";
            buildLayout(): SectionLayout[];
        }>(m => m?.key === "$Root" && typeof m.buildLayout === "function", {searchExports: true, searchDefault: false, signal});
        if (!rootLayout || signal?.aborted) return false;
        this.navigationRootAvailable = true;

        const layoutBuilder = this.getLayoutBuilder();

        const section = layoutBuilder.section("betterdiscord", {
            buildLayout: () => {
                const layouts: SidebarItemLayout[] = [];

                const insert = (key: string, item: LayoutConstructor) => {
                    let layout: [] | [panel: PanelLayout] = [];

                    if ("render" in item) {
                        const custom = layoutBuilder.custom(key, {
                            Component: () => <item.render />
                        });

                        const category = layoutBuilder.category(key, {
                            buildLayout: () => [custom]
                        });

                        const panel = layoutBuilder.panel(key, {
                            buildLayout: () => [category],
                            useTitle: item.header
                        });

                        layout = [panel];
                    }

                    const sidebar = layoutBuilder.sidebarItem(key, {
                        buildLayout: () => layout,
                        useTitle: item.title,
                        icon: item.icon,
                        usePredicate: () => true,
                        useSearchTerms: () => normalizeSettingsSearchTerms([
                            "betterdiscord", "bd", item.useSearchTerms()
                        ])
                    });

                    if (typeof item.predicate === "function") {
                        sidebar.usePredicate = () => !!item.predicate!();
                    }

                    if (typeof item.useMenu === "function") {
                        sidebar.useMenu = () => item.useMenu!();
                    }

                    if ("onClick" in item) {
                        sidebar.onClick = item.onClick;
                    }

                    layouts.push(sidebar);
                };

                const makeSettingsPanelProvider = (panelContent: React.ReactNode) => {
                    const listeners = new Set<() => void>();
                    let items = {
                        text: null as React.ReactNode,
                        children: null as React.ReactNode
                    };

                    function PanelHeader() {
                        const [node, setNode] = React.useState<HTMLElement | undefined>();
                        const {text, children: headerChildren} = items;

                        const [, forceUpdate] = useForceUpdate();

                        React.useLayoutEffect(() => {
                            listeners.add(forceUpdate);
                            return () => {listeners.delete(forceUpdate);};
                        }, [forceUpdate]);

                        return (
                            <>
                                <div
                                    className="bd-settings-page-title"
                                    ref={(v) => {
                                        const flex = v?.closest("div[data-wrap][data-full-width] > nav")?.parentElement as HTMLElement;

                                        if (flex) {
                                            flex.classList.add("bd-settings-title-extend");
                                            setNode(flex);
                                        }
                                        else if (v?.parentElement?.parentElement) {
                                            v.parentElement.parentElement.classList.add("bd-settings-title-extend");
                                            setNode(v.parentElement.parentElement);
                                        }
                                        else {
                                            setNode(v!);
                                        }

                                        return () => setNode(undefined);
                                    }}
                                >
                                    {text}
                                </div>

                                {node && (
                                    ReactDOM.createPortal(
                                        <div className="bd-settings-page-title-children">{headerChildren}</div>,
                                        node
                                    )
                                )}
                            </>
                        );
                    }

                    return {
                        header: () => <PanelHeader />,
                        render: () => (
                            <SettingsTitleContext
                                value={(value) => {
                                    items = {
                                        children: (value as React.ReactElement<{children: React.ReactNode;}>).props.children,
                                        text: (value as React.ReactElement<{text: React.ReactNode;}>).props.text
                                    };

                                    listeners.forEach(listener => listener());

                                    return null;
                                }}
                            >
                                {panelContent}
                            </SettingsTitleContext>
                        )
                    };
                };

                for (const collection of Settings.collections) {
                    const items = collection.settings.map(m => [m.name, m.settings.map(setting => setting.name)]).flat(2) as string[];

                    insert(collection.id, {
                        ...makeSettingsPanelProvider(
                            this.buildSettingsPanel(
                                collection.id,
                                collection.name,
                                collection.settings,
                                Settings.onSettingChange.bind(Settings, collection.id) as GroupOnChange
                            )
                        ),
                        icon: Logo.Discord,
                        title: () => collection.name,
                        useMenu: () => useCollectionMenu(collection),
                        useSearchTerms: () => normalizeSettingsSearchTerms([collection.name, items])
                    });
                }

                for (const panel of Settings.panels.sort((a, b) => a.order > b.order ? 1 : -1)) {
                    if (panel.type === "addon" && !panel.element) panel.element = this.getAddonPanel(panel.label, {store: panel.manager!});

                    const icon = panel.icon ? lucideToDiscordIcon(panel.icon) : () => panel.id;

                    if (panel.id === "customcss") {
                        insert("customcss_tab", {
                            ...makeSettingsPanelProvider(React.createElement(panel.element!)),
                            icon,
                            title: () => panel.label,
                            predicate: checkAll(useCustomCSSEnabled, () => !useCustomCSSClickable()),
                            useSearchTerms: () => [panel.label],
                        });

                        insert("customcss_clickable", {
                            icon,
                            title: () => panel.label,
                            predicate: checkAll(useCustomCSSEnabled, useCustomCSSClickable),
                            onClick: () => CustomCSS.open(),
                            useSearchTerms: () => [panel.label]
                        });

                        continue;
                    }

                    insert(panel.id, {
                        ...makeSettingsPanelProvider(React.createElement(panel.element!)),
                        icon,
                        title: () => panel.label,
                        useMenu: panel.type === "addon" ? () => useAddonMenu(panel.manager!) : undefined,
                        useSearchTerms: () => normalizeSettingsSearchTerms([
                            panel.label,
                            typeof panel.searchable === "function" ? panel.searchable() : []
                        ])
                    });
                }

                return layouts;
            },
            useTitle: () => Object.assign(<LayerSettingTitle />, {toString: () => "Solcord"}),
        });

        const cancel = Patcher.after("SettingsManager", rootLayout, "buildLayout", (_, __, res) => {
            if (!Array.isArray(res) || res.includes(section)) return;
            const index = res.findIndex((layout) => (layout as any).key === "games_and_apps_section") + 1;

            res.splice(index, 0, section);
        });
        if (typeof cancel !== "function") return false;
        try {this.patchSettingsSearch();}
        catch {Logger.warn("SettingsRenderer", "Optional settings search integration is unavailable.");}
        return true;
    }

    patchSettingsSearch() {
        if (this.searchPatched) return;
        const search = getMangled<{
            search(): Record<string, any>;
        }>(".PRIVACY_AND_SAFETY_PERSISTENT_VERIFICATION_CODES]", {
            search: Filters.byStrings(".PRIVACY_AND_SAFETY_PERSISTENT_VERIFICATION_CODES]")
        }, {cacheId: "core-settings-search"});

        if (typeof search.search !== "function") return;
        const cancel = Patcher.after("SettingsManager", search, "search", (_, __, res) => {
            res = {...res}; // Discord freezes the object

            function insert(key: string, item: {
                label: string;
                searchableTitles: string[];
            }) {
                const label = typeof item.label === "string" && item.label.trim().length > 0 ? item.label : key;
                res[`BETTERDISCORD_${key}`] = {
                    ...item,
                    label,
                    ariaLabel: label,
                    searchableTitles: normalizeSettingsSearchTerms(item.searchableTitles),
                    section: "betterdiscord"
                };
            }

            for (const collection of Settings.collections) {
                const items = collection.settings.map(m => [m.name, m.settings.map(setting => setting.name)]).flat(2) as string[];

                insert(collection.id, {
                    label: collection.name,
                    searchableTitles: normalizeSettingsSearchTerms(["betterdiscord", collection.name, items])
                });
            }

            for (const panel of Settings.panels.sort((a, b) => a.order > b.order ? 1 : -1)) {
                const content = {
                    label: panel.label,
                    searchableTitles: normalizeSettingsSearchTerms([
                        "betterdiscord",
                        panel.label,
                        typeof panel.searchable === "function" ? panel.searchable() : []
                    ])
                };

                if (panel.id === "customcss") {
                    insert("customcss_tab", content);
                    insert("customcss_clickable", content);

                    continue;
                }

                insert(panel.id, content);
            }

            return Object.freeze(res);
        });
        this.searchPatched = typeof cancel === "function";
    }

    async patchVersionInformation(signal?: AbortSignal) {
        if (this.versionPatched) return;
        const versionDisplayModule = await getMangledLazy<{
            versionDisplay: React.FC;
        }>(["copyValue", "RELEASE_CHANNEL", "Build Override"], {
            versionDisplay: Filters.byStrings("copyValue", "RELEASE_CHANNEL", "Build Override")
        }, {
            searchDefault: false,
            mapDeclarations: true,
            signal
        });

        if (typeof versionDisplayModule.versionDisplay !== "function") return;

        const cancel = Patcher.instead("SettingsManager", versionDisplayModule, "versionDisplay", () => <VersionInfo />);
        this.versionPatched = typeof cancel === "function";
    }

    public openSettingsPage(key: string): boolean {
        if (key === "solcord") return this.openControlCenter();
        const UserSettings = getUserSettings();
        if (typeof UserSettings?.openUserSettings !== "function") return false;
        UserSettings.openUserSettings(`betterdiscord_${key === "customcss" ? "customcss_tab" : key}_panel`, {
            section: key
        });
        return true;
    }

    private openControlCenter(): boolean {
        const Panel = Settings.panels.find(panel => panel.id === "solcord")?.element;
        if (!Panel) return false;
        if (this.controlCenterModal !== undefined) return true;
        const retired = () => {this.controlCenterModal = undefined;};
        try {
            this.controlCenterModal = Modals.openModal(rawProps => {
                const props = (rawProps ?? {}) as {onClose?(): void; transitionState?: number;};
                const close = () => {retired(); props.onClose?.();};
                return <ModalRoot className="solcord-control-center-dialog" transitionState={props.transitionState}>
                    <div className="solcord-control-center-dialog-header">
                        <h2>Solcord Suite</h2>
                        <button type="button" onClick={close} aria-label="Close Solcord settings">Close</button>
                    </div>
                    <div className="solcord-control-center-dialog-content">
                        <ErrorBoundary id="SolcordControlCenter" name="Solcord settings" fallback={<p role="alert">Solcord could not render this page. Close and reopen settings to retry.</p>}>
                            <Panel />
                        </ErrorBoundary>
                    </div>
                </ModalRoot>;
            }, {modalKey: "solcord-control-center", onCloseCallback: retired});
            return true;
        }
        catch {
            retired();
            toasts.error("Solcord settings could not open. Please retry after Discord finishes loading.", {forceShow: true});
            return false;
        }
    }

    private get DISCORD_USER_SETTINGS_MODAL_KEY(): string {
        const UserSettings = getUserSettings();
        return typeof UserSettings?.USER_SETTINGS_MODAL_KEY === "string" ? UserSettings.USER_SETTINGS_MODAL_KEY : "USER_SETTINGS_MODAL_MODAL_KEY";
    }

    public closeUserSettingsModal() {
        Modals.ModalActions?.closeModal?.(this.DISCORD_USER_SETTINGS_MODAL_KEY);
    }
};

interface PanelLayout {
    buildLayout(): [category: CategoryLayout];
    useTitle(): React.ReactNode;
}

type Trailing = ({
    // ngl idk
    type: 0,
} | {
    type: 1,
    badgeComponent?: unknown;
} | {
    type: 2,
    useCount(): number;
} | {
    type: 3,
    useDecoration(x: unknown, y: unknown): React.ReactNode;
}) & {
    getDismissibleContentTypes?(): unknown[];
};

interface SidebarItemLayout {
    icon: DiscordIcon;
    useTitle(): React.ReactNode;
    buildLayout(): [] | [panel: PanelLayout];
    useSearchTerms(): string[];

    /**
     * ⚠️ You cannot have page with onClick!
     */
    onClick?(): void;

    /** You can use react hooks here! */
    usePredicate?(): boolean;

    trailing?: Trailing;

    useMenu?(): React.ReactNode;
}

interface SectionLayout {
    useTitle(): React.ReactNode;
    buildLayout(): SidebarItemLayout[];
    usePredicate?(): boolean;
}

interface CustomLayout {
    Component: React.ComponentType;
}

interface CategoryLayout {
    buildLayout(): CustomLayout[];
}

interface LayoutBuilder {
    custom(key: string, custom: CustomLayout): CustomLayout;
    category(key: string, custom: CategoryLayout): CategoryLayout;
    panel(key: string, panel: PanelLayout): PanelLayout;
    sidebarItem(key: string, panel: SidebarItemLayout): SidebarItemLayout;
    section(key: string, panel: SectionLayout): SectionLayout;
}

type LayoutConstructor = {
    title(): React.ReactNode;
    icon: DiscordIcon;

    predicate?(): boolean;
    useMenu?(): React.ReactNode;
    useSearchTerms(): string[];
} & ({
    header(): React.ReactNode;
    render(): React.ReactNode;
} | {
    onClick(): void;
});

const checkAll = (...hooks: Array<() => boolean>) => () => hooks.map(hook => hook()).every(x => x);

const useCustomCSSEnabled = () => useStateFromStores(Settings, () => Settings.get<boolean>("settings", "customcss", "customcss"), []);

/** @description On true clicking open will open not open the page. On false will open the page */
const useCustomCSSClickable = () => {
    const state = useStateFromStores(Settings, () => Settings.get<string>("settings", "customcss", "openAction"), []);
    const isDetached = useStateFromStores(CustomCSS, () => CustomCSS.isDetached, []);

    return isDetached || ["detached", "external", "system"].includes(state);
};

function LayerSettingTitle() {
    const [node, setNode] = React.useState<HTMLElement | undefined | null | void>();

    return (
        <>
            <div
                className="bd-sidebar-header"
                ref={(v) => {
                    let nNode = v as HTMLElement;
                    if (v?.parentElement?.parentElement) {
                        // If discord changes the dom layout don't blame me
                        // if context menu
                        if (v.parentElement.parentElement.role === "group") {
                            nNode = v.parentElement as HTMLElement;
                        }
                        // if settings modal layer
                        else {
                            nNode = v.parentElement.parentElement as HTMLElement;
                        }
                    }

                    setNode(nNode);
                    return setNode;
                }}
            >
                Solcord
            </div>
            {!!node && ReactDOM.createPortal(
                <DiscordModules.Tooltip color="primary" position="top" text={t("Modals.changelog")}>
                    {props =>
                        <Button {...props} className="bd-changelog-button" look={Button.Looks.BLANK} color={Button.Colors.TRANSPARENT} size={Button.Sizes.NONE} onClick={() => Modals.showChangelogModal(changelog)}>
                            <HistoryIcon className="bd-icon" size="16px" />
                        </Button>
                    }
                </DiscordModules.Tooltip>,
                node
            )}
        </>
    );
}

export const SettingsTitleContext = React.createContext((v: React.ReactNode) => v);

function openCategory(id: string) {
    ContextMenu.close();
    SettingsRenderer.openSettingsPage(id);
}

function useCollectionMenu(collection: SettingsCollection) {
    const settings = useStateFromStores(Settings, () => {
        return collection.settings.map(category => ({
            id: category.id,
            name: category.name!,
            settings: category.settings.filter(s => s.type === "switch" && !s.hidden).map(setting => ({
                id: setting.id,
                label: setting.name!,
                disabled: setting.disabled,
                checked: Settings.get<boolean>(collection.id, category.id, setting.id),
                action: () => Settings.set(collection.id, category.id, setting.id, !Settings.get(collection.id, category.id, setting.id))
            }))
        }));
    }, []);

    return (
        <>
            {settings.map(category => (
                <ContextMenu.Item
                    label={category.name}
                    id={category.id}
                    action={() => openCategory(collection.id)}
                    key={`bd.${collection.id}.${category.id}`}
                >
                    {category.settings.map(setting => (
                        <ContextMenu.CheckboxItem {...setting} key={`bd.${collection.id}.${category.id}.${setting.id}`} />
                    ))}
                </ContextMenu.Item>
            ))}
        </>
    );
}

function useAddonMenu(manager: AddonManager) {
    const addons = useStateFromStores(manager, () => resolveAddonDisplayNames(manager.addonList).map((name) => [name, manager.resolveAddon(name), manager.isEnabled(name)] as const), [], true);
    const addonStoreIsEnabled = useStateFromStores(Settings, () => Settings.get("settings", "store", "bdAddonStore"), []);

    const toggles = React.useMemo(() => addons.map(([name, addon, enabled]) => (
        <ContextMenu.CheckboxItem
            label={name}
            id={name}
            checked={enabled}
            key={`bd.${manager.prefix}.${name}`}
            disabled={addon?.partial}
            action={(e: React.MouseEvent) => {
                if (!e.shiftKey) {
                    manager.toggleAddon(name);
                    return;
                }

                if (!manager.isEnabled(name)) {
                    toasts.warning(t("Addons.isDisabled", {name}));
                    return;
                }

                const hasSettings = (addon as Plugin).instance && typeof ((addon as Plugin).instance.getSettingsPanel) === "function";
                const getSettings = (hasSettings && (addon as Plugin).instance.getSettingsPanel!.bind((addon as Plugin).instance)) as () => any;

                if (hasSettings) {
                    Modals.showAddonSettingsModal(name, getSettings());
                }
                else {
                    toasts.warning(t("Addons.noSettings", {name}));
                }
            }}
        />
    )), [addons, manager]);

    return (
        <>
            <ContextMenu.Group key={`bd.${manager.prefix}.installed`}>
                {toggles}
            </ContextMenu.Group>
            {!!addonStoreIsEnabled && (
                <ContextMenu.Group key={`bd.${manager.prefix}.store`}>
                    <ContextMenu.Item
                        label={t("Addons.openStore", {context: manager.prefix})}
                        id={`${manager.prefix}-store`}
                        action={() => {
                            openCategory(manager.prefix + "s");
                            // If the addon store instantly opens have it just stop basically
                            DOMManager.onAdded(":where(.bd-store-card, .bd-addon-title > :nth-child(3))", (elem) => (elem as HTMLElement)?.click());
                        }}
                    />
                </ContextMenu.Group>
            )}
        </>
    );
}

export default SettingsRenderer;
