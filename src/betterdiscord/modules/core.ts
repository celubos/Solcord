import Logger from "@common/logger";

import Config from "@stores/config";
import Changelog from "@data/changelog";

import * as Builtins from "@builtins/builtins";

import LoadingIcon from "../loadingicon";

import LocaleManager from "./localemanager";
import DOMManager from "./dommanager";
import PluginManager from "./pluginmanager";
import ThemeManager from "./thememanager";
import Settings from "@stores/settings";
import JsonStore from "@stores/json";
import ToastStore from "@stores/toasts";
import DiscordModules from "./discordmodules";

import Updater from "./updater";
import AddonStore from "./addonstore";

import Styles from "@styles/index.css";
import SolcordHankenFont from "@styles/fonts/HankenGrotesk-variable.ttf";
import Modals from "@ui/modals";
import FloatingWindows from "@ui/floatingwindows";
import Toasts from "@ui/toasts";
import SettingsRenderer from "@ui/settings";
import CommandManager from "./commandmanager";
import InstallCSS from "@ui/customcss/mdinstallcss";
import {allModulesLoaded, getStore, Stores} from "@webpack";
import Patcher from "./patcher";
import SolcordRuntime from "./solcord/runtime";
import SolcordPanel from "@ui/solcord/panel";
import {ShieldCheckIcon} from "lucide-react";
import {waitForDiscordConnection} from "./connection";

export default new class Core {
    hasStarted = false;
    startupState: "idle" | "starting" | "ready" | "failed" = "idle";
    private startupPromise?: Promise<void>;
    private readonly completedPhases = new Set<string>();
    private async phase(name: string, action: () => unknown) {
        if (this.completedPhases.has(name)) return;
        await action();
        this.completedPhases.add(name);
    }

    trustBetterDiscordProtocol() {
        const store = getStore("MaskedLinkStore");
        if (store && typeof store.isTrustedProtocol === "function") Patcher.after("BetterDiscordProtocol", store, "isTrustedProtocol", (_, [url]: any, ret) => ret || url.startsWith("betterdiscord://"));
    }

    startup(): Promise<void> {
        if (this.hasStarted) return Promise.resolve();
        if (this.startupPromise) return this.startupPromise;
        this.startupState = "starting";
        this.startupPromise = this.runStartup().then(() => {
            this.hasStarted = true;
            this.startupState = "ready";
        }, error => {
            this.startupState = "failed";
            Logger.error("Startup", "Solcord startup did not complete; addon activation remains guarded.", error);
            ToastStore.error("Solcord could not finish startup. Check your connection and restart Discord to retry.", {forceShow: true, timeout: 10_000, group: "solcord-startup-failure"});
        }).finally(() => {
            LoadingIcon.hide();
            this.startupPromise = undefined;
        });
        return this.startupPromise;
    }

    private async runStartup() {

        await this.phase("protocol", () => this.trustBetterDiscordProtocol());

        // Load css early
        Logger.log("Startup", "Injecting BD Styles");
        const bundledStyles = Styles.toString().replace("./fonts/HankenGrotesk-variable.ttf", SolcordHankenFont);
        DOMManager.injectStyle("bd-stylesheet", bundledStyles);

        Logger.log("Startup", "Initializing LocaleManager");
        await this.phase("locale", () => LocaleManager.initialize());

        Logger.log("Startup", "Initializing Settings");
        await this.phase("settings", () => Settings.initialize());
        await this.phase("runtime", () => SolcordRuntime.initialize());
        await this.phase("panel", () => SolcordRuntime.attachControlCenter(() => {
            Settings.registerPanel("solcord", "Solcord Suite", {
                order: 0,
                icon: ShieldCheckIcon,
                element: SolcordPanel,
                translateLabel: false,
                searchable: () => ["Solcord", "Activity Bridge", "Plugin Doctor", "profiles", "privacy", "recovery", "Do Not Track", "Invisible Typing", "Double Click to Reply"]
            });
        }));
        await this.phase("settings-renderer", () => SettingsRenderer.initialize());

        Logger.log("Startup", "Initializing AddonStore");
        await this.phase("addon-store", () => AddonStore.initialize());

        Logger.log("Startup", "Initializing CommandManager");
        await this.phase("commands", () => CommandManager.initialize());

        Logger.log("Startup", "Initializing Internal InstallCSS");
        await this.phase("css", () => InstallCSS.initialize());

        Logger.log("Startup", "Waiting for connection...");
        await this.waitForConnection();

        Logger.log("Startup", "Checking first-install setup handoff");
        await SolcordRuntime.openPendingFirstSetup();

        Logger.log("Startup", "Initializing FloatingWindows");
        await this.phase("floating-windows", () => FloatingWindows.initialize());

        Logger.log("Startup", "Initializing Toasts");
        await this.phase("toasts", () => Toasts.initialize());

        Logger.log("Startup", "Starting Solcord privacy policy");
        const privacyPolicyReady = await SolcordRuntime.start();

        Logger.log("Startup", "Initializing Builtins");
        for (const module in Builtins) {
            await this.phase(`builtin:${module}`, () => Builtins[module as keyof typeof Builtins].initialize());
        }

        PluginManager.holdAddonActivation();
        ThemeManager.holdAddonActivation();
        PluginManager.setAddonActivationGuard(addon => SolcordRuntime.canActivateCommunityAddon(addon));
        ThemeManager.setAddonActivationGuard(theme => SolcordRuntime.canActivateCommunityTheme(theme));

        Logger.log("Startup", "Loading Plugins");
        await this.phase("plugins", () => PluginManager.initialize());

        Logger.log("Startup", "Loading Themes");
        await this.phase("themes", () => ThemeManager.initialize());

        Logger.log("Startup", "Validating reviewed addons before activation");
        const addonActivationAllowed = privacyPolicyReady && await SolcordRuntime.enforceAddonIntegrityBeforeStart();
        if (addonActivationAllowed) {
            PluginManager.releaseAddonActivation();
            ThemeManager.releaseAddonActivation();
            PluginManager.startAddons("connection");
            ThemeManager.startAddons();
        }
        else {
            Logger.warn("Startup", "Community addon activation remains held because Solcord privacy or integrity validation did not complete.");
        }

        Logger.log("Startup", "Initializing Updater");
        await this.phase("updater", () => Updater.initialize());

        Logger.log("Startup", "Removing Loading Icon");
        LoadingIcon.hide();
        SolcordRuntime.scheduleDeferredStartup();
        ToastStore.success(`Solcord ${Config.get("candidate")} active`, {
            forceShow: true,
            timeout: 5_000,
            group: "solcord-startup-identity"
        });

        const previousVersion = JsonStore.get("misc", "version");
        if (Config.get("version") !== previousVersion) {
            Modals.showChangelogModal(Changelog);
            JsonStore.set("misc", "version", Config.get("version"));
        }

        if (addonActivationAllowed) allModulesLoaded.then(() => PluginManager.startAddons("idle"));
    }

    waitForConnection() {
        return waitForDiscordConnection(() => Stores.UserStore?.getCurrentUser(), () => DiscordModules.Dispatcher);
    }
};
