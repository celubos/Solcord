import {describe, expect, test} from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {completeTimelineRead, createTimelineRuntimeFixture, type TimelineFixtureRead} from "../fixtures/solcord-timeline-runtime";


const ROOT = path.resolve(import.meta.dir, "../..");
const source = (relative: string) => fs.readFileSync(path.join(ROOT, relative), "utf8");

describe("Solcord renderer security contracts", () => {
    test("uses measured startup phases instead of a broad renderer hold", () => {
        const core = source("src/betterdiscord/modules/core.ts");

        expect(core).toContain("SolcordRuntime.initialize()");
        expect(core).toContain("SolcordRuntime.attachControlCenter(() => {");
        expect(core).toContain("Settings.registerPanel(\"solcord\"");
        expect(core).toContain("const privacyPolicyReady = await SolcordRuntime.start();");
        expect(core).toContain("const addonActivationAllowed = privacyPolicyReady && await SolcordRuntime.enforceAddonIntegrityBeforeStart();");
        expect(core).toContain("SolcordRuntime.scheduleDeferredStartup();");
        expect(core).not.toContain("solcordNavigationRecovery");
        expect(core).not.toContain("navigationRecovery");
    });

    test("binds renderer injection to one main-process navigation boundary and the exact main frame", () => {
        const preload = source("src/electron/preload/index.ts");
        const ipc = source("src/electron/main/modules/ipc.ts");
        const betterDiscord = source("src/electron/main/modules/betterdiscord.ts");

        expect(preload).not.toContain("rendererDocumentGeneration");
        expect(preload).toContain("ipcRenderer.invoke(IPCEvents.RUN_RENDERER)");
        expect(ipc).not.toContain("isRendererDocumentGeneration");
        expect(ipc).toContain("BetterDiscord.injectRenderer(browserWindow, senderFrame)");
        expect(betterDiscord).toContain("new RendererDocumentInjectionGuard<Electron.WebContents>()");
        expect(betterDiscord).toContain("rendererOwner.on(\"did-navigate\", beginRendererDocument)");
        expect(betterDiscord).toContain("this.rendererDocuments.beginDocument(rendererOwner)");
        expect(betterDiscord).toContain("this.rendererDocuments.claim(webContents)");
        expect(betterDiscord).toContain("frame.executeJavaScript");
        expect(betterDiscord).not.toContain("injectedWebContents");
    });

    test("claims private storage before addon inventory and audits the complete inventory before activation", () => {
        const core = source("src/betterdiscord/modules/core.ts");
        const runtime = source("src/betterdiscord/modules/solcord/runtime.ts");
        const runtimeInitialize = core.indexOf("SolcordRuntime.initialize()");
        const runtimeStart = core.indexOf("await SolcordRuntime.start()");
        const pluginInitialize = core.indexOf("PluginManager.initialize()");
        const pluginHold = core.indexOf("PluginManager.holdAddonActivation()");
        const pluginEnforce = core.indexOf("await SolcordRuntime.enforceAddonIntegrityBeforeStart()", pluginInitialize);
        const activationGuard = core.indexOf("if (addonActivationAllowed)", pluginEnforce);
        const pluginRelease = core.indexOf("PluginManager.releaseAddonActivation()", activationGuard);
        const pluginStart = core.indexOf("PluginManager.startAddons", activationGuard);
        const themeInitialize = core.indexOf("ThemeManager.initialize()");
        const themeStart = core.indexOf("ThemeManager.startAddons", pluginEnforce);

        expect(runtimeInitialize).toBeGreaterThanOrEqual(0);
        expect(runtimeStart).toBeGreaterThanOrEqual(0);
        expect(runtimeInitialize).toBeLessThan(runtimeStart);
        expect(runtimeStart).toBeLessThan(pluginInitialize);
        expect(pluginHold).toBeGreaterThan(runtimeStart);
        expect(pluginHold).toBeLessThan(pluginInitialize);
        expect(pluginInitialize).toBeLessThan(themeInitialize);
        expect(themeInitialize).toBeLessThan(pluginEnforce);
        expect(pluginInitialize).toBeLessThan(pluginEnforce);
        expect(pluginEnforce).toBeLessThan(activationGuard);
        expect(activationGuard).toBeLessThan(pluginRelease);
        expect(pluginRelease).toBeLessThan(pluginStart);
        expect(pluginEnforce).toBeLessThan(pluginStart);
        expect(pluginEnforce).toBeLessThan(themeStart);

        expect(runtime).toContain("run(\"settings-storage\"");
        expect(runtime).toContain("await this.#bootstrapPrivateCapability()");
        expect(runtime).toContain("run(\"integrity-validation\"");
        expect(runtime).toContain("startupPhases: this.startupPhaseSnapshot()");
        expect(runtime).toContain("if (!this.#started) return false");
        expect(runtime).toContain("return completed === true");
        expect(core).toContain("PluginManager.setAddonActivationGuard(addon => SolcordRuntime.canActivateCommunityAddon(addon))");
        expect(runtime).toContain("strictCommunityAddonActivationDecision({");
    });

    test("fails closed on watcher-time policy changes and cleans partial plugin starts", () => {
        const manager = source("src/betterdiscord/modules/addonmanager.ts");
        const plugins = source("src/betterdiscord/modules/pluginmanager.ts");
        expect(manager).toContain("#activationGate = new AddonActivationGate<Addon>()");
        expect(manager).toContain("if (!this.approveAddonActivation(addon)) return false");
        expect(manager).toContain("this.readAddon(filename, true)");
        expect(manager).toContain("this.reloadAddon(filename)");
        expect(plugins).toContain("if (!this.approveAddonActivation(plugin))");
        expect(plugins).toContain("try {plugin.instance.stop();}");
        expect(plugins).toContain("cleanupAlreadyAttempted");
        expect(plugins).toContain("plugin.sourceSha256 = communityAddonSourceSha256(plugin.fileContent ?? \"\")");
    });

    test("captures private IPC methods before plugins and never passes account ids in storage payloads", () => {
        const runtime = source("src/betterdiscord/modules/solcord/runtime.ts");
        const ipc = source("src/betterdiscord/modules/ipc.ts");
        expect(runtime).toContain("const TIMELINE_IPC = Object.freeze");
        expect(runtime).toContain("#privateCapability?: string");
        expect(runtime).toContain("#privateCapabilityQueue");
        expect(ipc).toContain("const invokePrivate = ipc.invoke.bind(ipc)");
        expect(ipc).toContain("return invokePrivate(IPCEvents.TIMELINE_APPEND");
        expect(ipc).toContain("return invokePrivate(IPCEvents.SETUP_APPLY");
        expect(ipc).toContain("return invokePrivate(IPCEvents.SETUP_ACKNOWLEDGE");
        expect(ipc).toContain("return invokePrivate(IPCEvents.SETUP_RECONCILE");
        expect(runtime).not.toContain("IPC.appendTimeline({accountId");
        expect(runtime).not.toContain("IPC.readTimeline({accountId");
        expect(runtime).not.toContain("IPC.clearTimeline({accountId");
    });

    test("keeps account-derived workspace state out of ordinary settings and clears every private panel draft on account switch", () => {
        const runtime = source("src/betterdiscord/modules/solcord/runtime.ts");
        const product = source("src/common/solcord/product.ts");
        const panel = source("src/betterdiscord/ui/solcord/panel.tsx");
        expect(runtime).toContain("#sessionPeopleState");
        expect(runtime).toContain("await this.#loadPeopleState()");
        expect(runtime).toContain("TIMELINE_IPC.peopleWrite(capability, {state})");
        expect(runtime).toContain("peopleStatePersistence: this.#peopleStatePersistent ? \"encrypted\" : \"session\"");
        expect(runtime).toContain("#sessionFocusChannelIds");
        expect(runtime).toContain("this.#returnLater = new SolcordReturnLaterJournal()");
        expect(runtime).toContain("JsonStore.delete(\"misc\", \"solcordReturnLater\")");
        expect(runtime).not.toContain("JsonStore.set(\"misc\", \"solcordReturnLater\"");
        expect(runtime).not.toContain("nativeSuite: {...preferences.nativeSuite, pinnedDmIds");
        expect(product).toContain("pinnedDmIds: []");
        expect(product).toContain("focusChannelIds: []");
        expect(panel).toContain("accountGeneration: SolcordRuntime.privateAccountGeneration()");
        expect(panel).toContain("<NativeSuiteAccountPanel key={state.accountGeneration}");
        expect(panel).toContain("<StreamAudienceGuardAccountControls key={state.accountGeneration}");
        expect(panel).toContain("SolcordRuntime.privateAccountIsCurrent(state.accountGeneration)");
        const accountChange = runtime.slice(runtime.indexOf("const onPrivateAccountChange ="), runtime.indexOf("privateUserStore.addChangeListener(onPrivateAccountChange)"));
        expect(accountChange.indexOf("this.emitChange()")).toBeLessThan(accountChange.indexOf("this.#loadPeopleState()"));
        expect(accountChange.indexOf("this.#curatedScope.dispose()")).toBeLessThan(accountChange.indexOf("this.emitChange()"));
        expect(accountChange).toContain("this.privateAccountGeneration() !== generation");
        for (const method of ["readTranslationCredential", "writeTranslationCredential", "clearTranslationCredential", "setAudienceGuardEntries", "clearAudienceGuardEntries"]) {
            const start = runtime.indexOf(`async ${method}(`);
            const end = runtime.indexOf("\n    }", start);
            expect(runtime.slice(start, end)).toContain("if (!this.privateAccountIsCurrent(accountGeneration))");
        }
        const guardArm = runtime.slice(runtime.indexOf("    armAudienceGuard("), runtime.indexOf("    disarmAudienceGuard("));
        expect(guardArm).toContain("if (!this.privateAccountIsCurrent(accountGeneration))");
        const privatePolicy = runtime.slice(runtime.indexOf("    audienceGuardPrivatePolicy("), runtime.indexOf("    async setAudienceGuardEntries("));
        expect(privatePolicy).toContain("policy: current ? structuredClone(this.#audiencePolicy) : {version: 1, entries: []}");
    });

    test("revalidates every queued account-scoped main-process storage result before returning it", () => {
        const ipc = source("src/electron/main/modules/ipc.ts");
        const helper = ipc.slice(ipc.indexOf("const withCurrentAccountBinding"), ipc.indexOf("const bootstrapTimeline"));
        expect(helper).toContain("const result = await operation");
        expect(helper).toContain("timelineAuthority.assertCurrent(event.sender.id, authorized)");
        for (const operation of [
            "SolcordTimeline.append", "SolcordTimeline.read", "SolcordTimeline.clear",
            "SolcordFriendWatch.append", "SolcordFriendWatch.read", "SolcordFriendWatch.clear",
            "SolcordAudienceGuard.read", "SolcordAudienceGuard.write", "SolcordAudienceGuard.clear",
            "SolcordPeopleState.read", "SolcordPeopleState.write", "SolcordPeopleState.clear",
            "SolcordTranslationCredentials.read", "SolcordTranslationCredentials.write", "SolcordTranslationCredentials.clear",
            "SolcordLocalIdentityNotes.read", "SolcordLocalIdentityNotes.write", "SolcordLocalIdentityNotes.remove", "SolcordLocalIdentityNotes.clear"
        ]) {
            expect(ipc).toContain(`withCurrentAccountBinding(event, request, (accountScope, payload) => ${operation}(accountScope, payload))`);
        }
    });

    test("switches Timeline identity synchronously and buffers only the new account while storage loads", async () => {
        let finishSecondRead!: (value: TimelineFixtureRead) => void;
        let notifySecondRead!: () => void;
        const enteredSecondRead = new Promise<void>(resolve => {notifySecondRead = resolve;});
        const first = {eventId: "first-account", kind: "create" as const, observedAt: Date.now(), messageId: "10", channelId: "200", authorId: "300", authorIsBot: false, content: "first account only"};
        const second = {...first, eventId: "second-account", messageId: "20", content: "second account"};
        const fixture = createTimelineRuntimeFixture({read: accountId => accountId === "100"
            ? Promise.resolve(completeTimelineRead([first])) : new Promise(resolve => {finishSecondRead = resolve; notifySecondRead();})});
        try {
            await fixture.start();
            expect(fixture.journal.has("10")).toBeTrue();
            fixture.changeAccount("101");
            // No awaited storage operation can expose rows from the old identity.
            expect(fixture.journal.status().records).toBe(0);
            expect(fixture.state.timelinePersistent).toBeFalse();
            fixture.dispatch("MESSAGE_DELETE", {id: "20", channelId: "200"});
            fixture.dispatch("MESSAGE_CREATE", {message: {id: "21", channel_id: "200", author: {id: "301", bot: false}, content: "observed while loading"}});
            expect(fixture.journal.status().records).toBe(0);
            await enteredSecondRead;
            finishSecondRead(completeTimelineRead([second]));
            await fixture.settle();
            expect(fixture.journal.has("10")).toBeFalse();
            expect(fixture.journal.snapshot().find(record => record.messageId === "20")?.deletedAt).toBeDefined();
            expect(fixture.journal.has("21")).toBeTrue();
            expect(fixture.appended.every(batch => batch.accountId === "101")).toBeTrue();
            expect(fixture.appended.flatMap(batch => batch.events).some(event => event.messageId === "21")).toBeTrue();
        }
        finally {fixture.dispose();}
    });

    test("revalidates manual Timeline reads and clears before binding, before IPC, and before renderer effects", () => {
        const runtime = source("src/betterdiscord/modules/solcord/runtime.ts");
        const helper = runtime.slice(runtime.indexOf("#withTimelineAccount<T>"), runtime.indexOf("async #releaseTimelineAccount"));
        expect(helper).toContain("TimelineAccountChangedBeforeBinding");
        expect(helper).toContain("TimelineAccountChangedBeforeRequest");
        expect(helper).toContain("TimelineAccountChangedDuringRequest");

        const clear = runtime.slice(runtime.indexOf("async clearTimeline"), runtime.indexOf("async setTimelinePolicy"));
        expect(clear).toContain("const identity = this.#captureTimelineIdentity()");
        expect(clear).toContain("identityIsCurrent");
        expect(clear.indexOf("identityIsCurrent")).toBeLessThan(clear.indexOf("TIMELINE_IPC.clear"));
        expect(clear.lastIndexOf("identityIsCurrent")).toBeLessThan(clear.indexOf("this.#timeline.clear()"));

        const exportTimeline = runtime.slice(runtime.indexOf("async exportTimeline"), runtime.indexOf("previewSetup"));
        expect(exportTimeline).toContain("const identity = this.#captureTimelineIdentity()");
        expect(exportTimeline).toContain("identityIsCurrent");
        expect(exportTimeline).toContain("loaded.status !== \"complete\"");
        expect(exportTimeline).toContain("Export refused because the local read was incomplete");
        expect(exportTimeline.lastIndexOf("identityIsCurrent")).toBeLessThan(exportTimeline.indexOf("this.#download"));
    });

    test("clears Friend Watch synchronously across account changes and revalidates clear and export effects", () => {
        const runtime = source("src/betterdiscord/modules/solcord/runtime.ts");
        expect(runtime).toContain("#friendWatchAccountGuard = new TimelineAccountGuard()");
        expect(runtime).toContain("const {changed} = this.#observeFriendWatchIdentity");
        expect(runtime).toContain("if (changed) this.emitChange()");

        const observe = runtime.slice(runtime.indexOf("#observeFriendWatchIdentity"), runtime.indexOf("#friendWatchIdentityIsCurrent"));
        expect(observe.indexOf("this.#friendWatch.clear()")).toBeLessThan(observe.indexOf("return {identity, changed}"));

        const clear = runtime.slice(runtime.indexOf("async clearFriendWatch"), runtime.indexOf("async exportFriendWatch"));
        expect(clear).toContain("identityIsCurrent");
        expect(clear.indexOf("identityIsCurrent")).toBeLessThan(clear.indexOf("TIMELINE_IPC.friendClear"));
        expect(clear.lastIndexOf("identityIsCurrent")).toBeLessThan(clear.indexOf("this.#friendWatch.clear()"));

        const exportFriend = runtime.slice(runtime.indexOf("async exportFriendWatch"), runtime.indexOf("async exportTimeline"));
        expect(exportFriend).toContain("identityIsCurrent");
        expect(exportFriend.lastIndexOf("identityIsCurrent")).toBeGreaterThan(exportFriend.indexOf("this.#download"));

        const startFriend = runtime.slice(runtime.indexOf("async #startFriendWatch"), runtime.indexOf("async #startMessageTimeline"));
        expect(startFriend).toContain("type RelationshipActions = Record<\"removeRelationship\" | \"blockUser\" | \"unblockUser\"");
        expect(startFriend).toContain("getMutableRelationships?: () => unknown");
        expect(startFriend).toContain("typeof relationships?.getMutableRelationships === \"function\"");
        expect(startFriend).toContain("getByKeys<RelationshipActions>");
        expect(startFriend).toContain("Patcher.before(\"Solcord~FriendWatch\"");
        expect(startFriend).toContain("scope.own(unpatch, \"patch\")");
        expect(startFriend).toContain("scope.listen(window, \"online\", schedule)");
        expect(startFriend).toContain("scope.listen(document, \"visibilitychange\"");
        expect(startFriend).toContain("planSolcordFriendWatchNotices");
        expect(startFriend).not.toContain("fetch(");
    });

    test("surfaces partial Timeline reads and incomplete retention instead of claiming success", async () => {
        const partial = createTimelineRuntimeFixture({read: async () => ({...completeTimelineRead(), complete: false, truncated: true, omittedSegments: 2, unreadableSegments: 1, retentionApplied: false})});
        try {
            await partial.start();
            expect(partial.health.at(-1)).toMatchObject({maturity: "preview"});
            expect(partial.health.at(-1)?.detail).toContain("2 omitted, 1 unreadable");
            expect(partial.health.at(-1)?.detail).toContain("retention incomplete");
        }
        finally {partial.dispose();}
        const retention = createTimelineRuntimeFixture({appendRetentionApplied: false});
        try {
            await retention.start();
            retention.dispatch("MESSAGE_CREATE", {message: {id: "21", channel_id: "200", author: {id: "301", bot: false}, content: "local fixture"}});
            await retention.settle();
            await retention.state.flushTimelinePersistence?.();
            expect(retention.journal.has("21")).toBeTrue();
            expect(retention.health.at(-1)).toMatchObject({maturity: "preview"});
            expect(retention.health.at(-1)?.detail).toContain("Retention cleanup is incomplete");
        }
        finally {retention.dispose();}
    });

    test("blocks native process discovery and cached running-game publication independently", () => {
        const runtime = source("src/betterdiscord/modules/solcord/runtime.ts");
        const policy = runtime.slice(runtime.indexOf("const activitySpecs"), runtime.indexOf("const specs: PrivacyMethodSpec[]"));
        expect(policy).toContain("id: \"native-process-discovery\"");
        expect(policy).toContain("id: \"running-game-dispatch\"");
        expect(policy).toContain("id: `running-game-");
        expect(policy).not.toContain("else if (runningGamePrototype");
    });

    test("does not claim a privacy rollback succeeded until addon and settings restoration verify", () => {
        const runtime = source("src/betterdiscord/modules/solcord/runtime.ts");
        const panel = source("src/betterdiscord/ui/solcord/panel.tsx");
        const restore = runtime.slice(runtime.indexOf("#restorePrivacyRollback"), runtime.indexOf("#privacyRollbackError"));
        expect(restore).toContain("entry.kind === \"theme\" ? ThemeManager : PluginManager");
        expect(restore).toContain("manager.isEnabled(entry.fileName)");
        expect(restore).toContain("PluginDoctor.isQuarantined(entry.doctorId)");
        expect(restore).toContain("if (!SolcordSettings.rollback(snapshotId))");
        expect(restore.indexOf("SolcordSettings.rollback(snapshotId)")).toBeLessThan(restore.indexOf("manager.enableAddon(entry.fileName)"));
        expect(restore).toContain("if (failures.length) return failures");
        expect(runtime).toContain("automatic recovery was incomplete");
        expect(panel).toContain("error instanceof Error ? error.message");
        expect(panel).not.toContain("the previous snapshot was restored");
    });

    test("records every disabled addon before quarantine can fail so Strict Privacy rollback remains complete", () => {
        const runtime = source("src/betterdiscord/modules/solcord/runtime.ts");
        for (const start of [runtime.indexOf("async #enforceStrictCommunityAddonPolicy"), runtime.indexOf("async setPrivacyProfile")]) {
            const block = runtime.slice(start, runtime.indexOf("finally", start));
            expect(block.indexOf("changed.push") >= 0 ? block.indexOf("changed.push") : block.indexOf("disabledCommunity.push")).toBeLessThan(block.indexOf("PluginDoctor.quarantine"));
        }
    });

    test("refreshes Plugin Doctor health after every completed integrity audit", () => {
        const runtime = source("src/betterdiscord/modules/solcord/runtime.ts");
        const refreshStart = runtime.indexOf("#refreshAddonIntegrity(phase:");
        const refresh = runtime.slice(refreshStart, runtime.indexOf("\n    #enforceAddonIntegrity(", refreshStart));
        expect(refresh).toContain("this.#updatePluginDoctorHealth()");
        expect(runtime).toContain("const update = () => this.#updatePluginDoctorHealth()");
        expect(runtime).toContain("integrity.attention + integrity.unavailable");
    });

    test("holds genuine Solcord built-in quarantines while recovering only the classified legacy capability miss", () => {
        const runtime = source("src/betterdiscord/modules/solcord/runtime.ts");
        const synchronize = runtime.slice(runtime.indexOf("#synchronizeCuratedAdapters(curatedOverride"), runtime.indexOf("#scheduleCuratedAdapterRetry", runtime.indexOf("#synchronizeCuratedAdapters(curatedOverride")));
        expect(synchronize).toContain("!PluginDoctor.isQuarantined(solcordBuiltInDoctorId(name))");
        for (const name of ["SplitLargeMessages", "DoNotTrack", "InvisibleTyping", "DoubleClickToReply"]) {
            expect(synchronize).toContain(`PluginDoctor.isQuarantined(solcordBuiltInDoctorId("${name}"))`);
        }
        expect(synchronize).toContain("Plugin Doctor quarantine is holding the built-in until an explicit retry succeeds.");
        const retryDecision = runtime.slice(runtime.indexOf("const retryable ="), runtime.indexOf("if (retryable)", runtime.indexOf("const retryable =")));
        expect(retryDecision).toContain("!PluginDoctor.isQuarantined(solcordBuiltInDoctorId(name))");
    });

    test("treats unavailable Discord capabilities as readiness misses rather than crash-loop failures", () => {
        const runtime = source("src/betterdiscord/modules/solcord/runtime.ts");
        const synchronize = runtime.slice(runtime.indexOf("#synchronizeCuratedAdapters(curatedOverride"), runtime.indexOf("#scheduleCuratedAdapterRetry", runtime.indexOf("#synchronizeCuratedAdapters(curatedOverride")));
        expect(synchronize).toContain("PluginDoctor.recordCapabilityMiss");
        expect(synchronize).not.toContain("PluginDoctor.recordFailure");
        expect(synchronize).not.toContain("NativeSuiteAdapterUnavailable");
        expect(synchronize).toContain("if (!this.#communityAddonInstalled(name)) PluginDoctor.clearLegacyCapabilityMissQuarantine(name)");
        expect(synchronize.indexOf("clearLegacyCapabilityMissQuarantine(name)")).toBeLessThan(synchronize.indexOf("!PluginDoctor.isQuarantined(solcordBuiltInDoctorId(name))"));
        expect(synchronize).toContain("PluginDoctor.clearLegacyCapabilityMissQuarantine(solcordBuiltInDoctorId(name))");
        expect(synchronize).toContain("nativeSuite.providerAvailable(name)");
        expect(synchronize).toContain("Ready is withheld until a matching live interaction succeeds");

        const setup = runtime.slice(runtime.indexOf("const adapterResults = this.#synchronizeCuratedAdapters(requestedCurated)"), runtime.indexOf("const replacementFiles", runtime.indexOf("const adapterResults = this.#synchronizeCuratedAdapters(requestedCurated)")));
        expect(setup).toContain("PluginDoctor.recordCapabilityMiss(solcordBuiltInDoctorId(name))");
        expect(setup).not.toContain("PluginDoctor.quarantine(name, reason)");

        const toggle = runtime.slice(runtime.indexOf("async setCuratedAddonEnabled"), runtime.indexOf("async retryQuarantinedAddon"));
        expect(toggle).toContain("const guardedCanRunIndependently = guardedBuiltIn && !this.#communityAddonEnabled(name)");
        expect(toggle).toContain("const doctorId = guardedBuiltIn ? solcordBuiltInDoctorId(name) : name");
        expect(toggle).toContain("const communityAddonPresent = Boolean(resolveCommunityAddon(PluginManager, candidate.name, candidate.fileName))");
        expect(toggle).toContain("if (!communityAddonPresent) PluginDoctor.clearLegacyCapabilityMissQuarantine(name)");
        expect(toggle).toContain("PluginDoctor.clearLegacyCapabilityMissQuarantine(doctorId)");
        expect(toggle).toContain("PluginDoctor.recordCapabilityMiss(doctorId)");
        expect(toggle).not.toContain("PluginDoctor.quarantine(name, reason)");
        expect(toggle).not.toContain("SolcordSettings.setCuratedAddonEnabled(name, false, reason)");
    });

    test("treats the selected animated background as a first-party Appearance setting", () => {
        const runtime = source("src/betterdiscord/modules/solcord/runtime.ts");
        const synchronize = runtime.slice(runtime.indexOf("#synchronizeCuratedAdapters("), runtime.indexOf("#scheduleCuratedAdapterRetry", runtime.indexOf("#synchronizeCuratedAdapters(")));
        expect(synchronize).toContain("productPreferences.nativeSuite.motion.effect !== \"off\"");
        expect(synchronize).toContain(`!PluginDoctor.isQuarantined(solcordBuiltInDoctorId("DiscordEffects"))`);
        expect(synchronize).toContain(`!this.#communityAddonEnabled("DiscordEffects")`);
        expect(synchronize).toContain("nativeEnabled.DiscordEffects = true");
        expect(synchronize).toContain("Active as the selected first-party Appearance background.");
    });

    test("exposes Call Context only after its selected-channel, voice-state, optional provider, and subscription contracts validate", () => {
        const runtime = source("src/betterdiscord/modules/solcord/runtime.ts");
        expect(runtime).toContain("const voiceParticipantContextAvailable = voiceParticipantsNeeded");
        expect(runtime).toContain("voiceChannelCapability.state !== \"unavailable\"");
        expect(runtime).toContain("voiceStateCapability.state !== \"unavailable\"");
        expect(runtime).toContain("baseCallContextStores.every(store => typeof store?.addChangeListener === \"function\" && typeof store.removeChangeListener === \"function\")");
        expect(runtime).toContain("const callContextAvailable = lookups.callContext && voiceParticipantContextAvailable");
        expect(runtime).toContain("voiceActivityAvailable: callContextAvailable && voiceActivityAvailable");
        expect(runtime).toContain("spectatorsAvailable: callContextAvailable && spectatorsAvailable");
        expect(runtime).toContain("currentCall: voiceParticipantContextAvailable ? currentCall : undefined");
        expect(runtime).toContain("subscribeCall: voiceParticipantContextAvailable ? listener =>");
    });

    test("does not let stale asynchronous feature starts resurrect disabled or unavailable modules", () => {
        const runtime = source("src/betterdiscord/modules/solcord/runtime.ts");
        const startAt = runtime.indexOf("async #startFeature(id: SolcordModuleId)");
        const stopAt = runtime.indexOf("#stopFeature(id: SolcordModuleId)", startAt);
        const start = runtime.slice(startAt, stopAt);
        expect(start).toContain("#featureStartGenerations.set(id, generation)");
        expect(start).toContain("this.#featureStartGenerations.get(id) === generation");
        expect(start).toContain("this.#scopes.get(id) === scope");
        expect(start).toContain("!scope.disposed");
        expect(start).toContain("SolcordSettings.module(id).enabled");
        expect(start).toContain("this.#health.get(id)?.status === \"unavailable\"");
        expect(start).toContain("this.#scopes.delete(id)");
        expect(start).toContain("scope.dispose()");
        expect(start.indexOf("this.#health.get(id)?.status === \"unavailable\"")).toBeLessThan(start.indexOf("lastSuccessfulValidation: Date.now()"));

        const stopEnd = runtime.indexOf("#recordFailure(", stopAt);
        const stop = runtime.slice(stopAt, stopEnd);
        expect(stop).toContain("this.#featureStartGenerations.set(id, (this.#featureStartGenerations.get(id) ?? 0) + 1)");
    });

    test("prevents disposed Friend Watch work and stale Fake Deafen lookups from mutating replacement state", () => {
        const runtime = source("src/betterdiscord/modules/solcord/runtime.ts");
        const fakeStart = runtime.indexOf("async #synchronizePowerLab()");
        const fakeEnd = runtime.indexOf("\n    #stopFakeDeafen(", fakeStart);
        const fake = runtime.slice(fakeStart, fakeEnd);
        expect(fake).toContain("const generation = ++this.#fakeDeafenGeneration");
        expect(fake).toContain("generation !== this.#fakeDeafenGeneration || scope.disposed || this.#fakeDeafenScope !== scope");
        expect(fake).toContain("onStatus: status =>");

        const fakeStop = runtime.slice(fakeEnd, runtime.indexOf("async #startFeature", fakeEnd));
        expect(fakeStop).toContain("if (invalidatePending) this.#fakeDeafenGeneration++");

        const friendStart = runtime.indexOf("async #startFriendWatch(");
        const friendEnd = runtime.indexOf("async #startMessageTimeline(", friendStart);
        const friend = runtime.slice(friendStart, friendEnd);
        expect(friend).toContain("if (scope.disposed) return");
        expect(friend).toContain("if (scope.disposed || !identityIsCurrent()) return");
        expect(friend.indexOf("if (scope.disposed || !identityIsCurrent()) return")).toBeLessThan(friend.indexOf("this.#friendWatchPersistent = opened.status.persistent"));
    });

    test("keeps native-suite resynchronization and module teardown failure-atomic", () => {
        const runtime = source("src/betterdiscord/modules/solcord/runtime.ts");
        const preferences = runtime.slice(runtime.indexOf("async setProductPreferences"), runtime.indexOf("privacyCapabilities()"));
        expect(preferences).toContain("if ((effects.nativeSuite || effects.motion) && this.#curatedSynchronizationError)");
        expect(preferences).toContain("SolcordSettings.rollback(rollbackSnapshot.id)");
        expect(preferences).toContain("Previous settings were restored");

        const curatedStart = runtime.indexOf("#synchronizeCuratedAdapters(curatedOverride");
        const curated = runtime.slice(curatedStart, runtime.indexOf("#nativeSuiteAdapter(", curatedStart));
        expect(curated).toContain("try {this.#curatedScope.dispose();}");
        expect(curated).toContain("return failClosed");
        expect(curated).toContain("this.#nativeSuite = undefined");
        expect(curated).toContain("replacement adapters stayed off");

        const stopStart = runtime.indexOf("#stopFeature(id: SolcordModuleId)");
        const stop = runtime.slice(stopStart, runtime.indexOf("\n    #resetStoppedAudienceGuard(", stopStart));
        expect(stop.indexOf("scope.dispose()")).toBeLessThan(stop.indexOf("this.#scopes.delete(id)"));
        expect(stop).toContain("resources: scope.counts()");
        expect(stop).toContain("retained ownership will be retried");

        const privacyStart = runtime.indexOf("#synchronizePrivacyPolicy(): Promise<void>");
        const privacy = runtime.slice(privacyStart, runtime.indexOf("\n    #stopFakeDeafen(", privacyStart));
        expect(privacy).toContain("Solcord retained ownership and will not install a second policy");
        expect(privacy.indexOf("return nativePolicy;", privacy.indexOf("catch (error)"))).toBeLessThan(privacy.indexOf("this.#privacyScope = new SolcordDisposalScope()"));

        const fakeStopStart = runtime.indexOf("#stopFakeDeafen(invalidatePending");
        const fakeStop = runtime.slice(fakeStopStart, runtime.indexOf("\n    async #startFeature(", fakeStopStart));
        expect(fakeStop).toContain("Solcord retained teardown ownership and will not install a second adapter");
        expect(fakeStop.indexOf("return;", fakeStop.indexOf("catch (error)"))).toBeGreaterThan(-1);
    });

    test("rolls back partial Call Context subscriptions before exposing the adapter", () => {
        const runtime = source("src/betterdiscord/modules/solcord/runtime.ts");
        const start = runtime.indexOf("subscribeCall: voiceParticipantContextAvailable");
        const subscription = runtime.slice(start, runtime.indexOf("setLocalVolume:", start));
        expect(subscription).toContain("subscribeSolcordChangeStores(scope, callContextStores");
        const helper = source("src/betterdiscord/modules/solcord/native-suite.ts");
        expect(helper).toContain("cleanup remains owned for retry");
        expect(helper).toContain("scope.own(() => store.removeChangeListener(listener), \"listener\")");
    });

    test("reconciles prepared setup files before features and acknowledges only after durable settings", () => {
        const runtime = source("src/betterdiscord/modules/solcord/runtime.ts");
        const setup = source("src/electron/main/modules/solcord-setup.ts");
        const startMethod = runtime.slice(runtime.indexOf("async start():"), runtime.indexOf("get recoveryMode"));
        expect(startMethod.indexOf("TIMELINE_IPC.reconcileSetup")).toBeLessThan(startMethod.indexOf("for (const id of FEATURE_IDS)"));
        const finish = runtime.slice(runtime.indexOf("async finishSetup"), runtime.indexOf("async rollbackLatestSetup"));
        expect(finish.indexOf("SolcordSettings.completeSetup")).toBeLessThan(finish.indexOf("TIMELINE_IPC.acknowledgeSetup"));
        expect(finish).toContain("SolcordSettings.abortSetupCompletion");
        expect(setup).toContain("this.#writeMarker(transactionId, \"prepared\"");
        expect(setup).toContain("knownTransactionIds.has(transactionId)");
    });

    test("journals exact addon filenames and binds provider migration to the sealed Finish plan", () => {
        const runtime = source("src/betterdiscord/modules/solcord/runtime.ts");
        const wizard = source("src/betterdiscord/ui/solcord/setup-wizard.tsx");
        const panel = source("src/betterdiscord/ui/solcord/panel.tsx");
        const finish = runtime.slice(runtime.indexOf("async finishSetup"), runtime.indexOf("async rollbackLatestSetup"));
        expect(finish).toContain("const priorAddonStates = captureExactAddonStates(PluginManager)");
        expect(finish).toContain("const priorThemeStates = captureExactAddonStates(ThemeManager)");
        expect(runtime).toContain("#requireProviderMigrationPlan");
        expect(runtime).toContain("#assertProviderMigrationIdentityCurrent");
        expect(runtime).toContain("#providerMigrationCandidates");
        expect(runtime).toContain("#setupAcceptsAddon");
        expect(runtime).toContain("createSolcordProviderMigrationPlan(PluginManager, this.#providerMigrationCandidates(draft), draft)");
        expect(runtime).toContain("if (enabled && guardedBuiltIn && !setupExecutable) return false");
        expect(runtime).toContain("!this.#setupAcceptsAddon(\"SplitLargeMessages\", split.mode)");
        expect(finish.indexOf("#requireProviderMigrationPlan")).toBeLessThan(finish.indexOf("#refreshAddonIntegrity"));
        expect(finish.lastIndexOf("#requireProviderMigrationPlan")).toBeLessThan(finish.indexOf("PluginManager.disableAddon(current.filename)"));
        expect(finish.indexOf("TIMELINE_IPC.applySetup")).toBeLessThan(finish.indexOf("PluginManager.disableAddon(current.filename)"));
        expect(finish.indexOf("PluginManager.disableAddon(current.filename)")).toBeLessThan(finish.indexOf("SolcordSettings.completeSetup"));
        expect(wizard).toContain("SolcordRuntime.finishSetup(draft, undefined, {migrateProviders: false})");
        expect(panel).toContain("SolcordRuntime.prepareProviderMigrationPlan(state.draft)");
        expect(panel).toContain("SolcordRuntime.finishSetup(state.draft, confirmedPlan)");
        expect(wizard).toContain("active community provider changed after review");
        const restoreStart = runtime.indexOf("async #restoreAddonStates");
        const restore = runtime.slice(restoreStart, runtime.indexOf("#communityAddonEnabled", restoreStart));
        expect(restore).toContain("for (const [fileName, desired] of Object.entries(priorAddonStates))");
        expect(restore).toContain("PluginManager.resolveAddon(fileName)");
        expect(restore).toContain("Object.hasOwn(priorAddonStates, addon.filename)");
    });

    test("stands down the built-in when an owner re-enables a conflicting community provider", () => {
        const runtime = source("src/betterdiscord/modules/solcord/runtime.ts");
        expect(runtime).toContain("The community addon was re-enabled; Solcord stood down its built-in and left the owner file unchanged.");
        expect(runtime).toContain("conflict: true");
        expect(runtime).not.toContain("if (preferred === \"prefer-solcord\") PluginManager.disableAddon");
    });

    test("bounds Timeline records, dedupe state, bulk expansion, and snapshots", () => {
        const timeline = source("src/betterdiscord/modules/solcord/message-timeline.ts");
        const runtime = source("src/betterdiscord/modules/solcord/runtime.ts");
        expect(timeline).toContain("records: 20_000");
        expect(timeline).toContain("seenEvents: 80_000");
        expect(timeline).toContain("editsPerRecord: 100");
        expect(timeline).toContain("estimatedStateBytes");
        expect(timeline).toContain("while (this.#messages.size > this.#limits.records");
        expect(timeline).toContain("while (this.#seenEvents.size > this.#limits.seenEvents)");
        expect(timeline).toContain("boundedTimelineMessageIds");
        expect(runtime).toContain("this.#timeline.snapshot(channelId, 250)");
    });

    test("requires a separate exact-file execution confirmation and emits no raw Solcord stack", () => {
        const runtime = source("src/betterdiscord/modules/solcord/runtime.ts");
        const panel = source("src/betterdiscord/ui/solcord/panel.tsx");
        expect(panel).toContain("Third-party execution confirmation");
        expect(panel).toContain("Files to start or enable");
        expect(panel).toContain("Files to stop or disable");
        expect(panel).not.toContain("will not execute them automatically");
        expect(runtime).toContain("confirmedPlan?: ProfileAddonExecutionPlan");
        expect(runtime).not.toContain("Logger.stacktrace");
    });

    test("owns native review modals and closes them when Discord routes change", () => {
        const runtime = source("src/betterdiscord/modules/solcord/runtime.ts");
        expect(runtime).toContain("release = scope.own(dispose, \"element\")");
        expect(runtime).toContain("releaseRouteTimer = scope.own(() => globalThis.clearInterval(routeTimer), \"interval\")");
        expect(runtime).toContain("if (window.location.href !== previousHref) release()");
        expect(runtime).toContain("Modals.ModalActions?.closeModal(modalKey)");
        expect(runtime).toContain("productPreferences.safety.domainMemory === \"warn-only\"");
        expect(runtime).toContain("remembered?.decision === \"block\" ? onCancel : onConfirm");
    });

    test("keeps clear and setup rollback claims conditional on complete typed results", () => {
        const runtime = source("src/betterdiscord/modules/solcord/runtime.ts");
        const timelinePanel = source("src/betterdiscord/ui/solcord/timeline.tsx");
        expect(runtime).toContain("result.complete && remaining === 0 ? \"complete\" : \"incomplete\"");
        expect(runtime).toContain("if (outcome.status === \"complete\")");
        expect(timelinePanel).toContain("SolcordRuntime.clearTimeline(true)");
        expect(timelinePanel).toContain("Renderer history remains visible until cleanup is confirmed complete.");
        expect(runtime).toContain("result.complete && preserved === 0 && addonStatesRestored ? \"complete\" : \"partial\"");
    });

    test("keeps Stream Shield and Timeline copy within structural and storage evidence", () => {
        const runtime = source("src/betterdiscord/modules/solcord/runtime.ts");
        const streamShield = source("src/betterdiscord/modules/solcord/stream-shield.ts");
        const timelinePanel = source("src/betterdiscord/ui/solcord/timeline.tsx");
        expect(runtime).toContain("describeSolcordStreamShieldResolution(resolution, automaticAvailable, source())");
        expect(streamShield).toContain("structural store match; live transition acceptance remains pending");
        expect(streamShield).not.toContain("verified Go Live store connected");
        expect(timelinePanel).toContain("Persistent segments are encrypted when secure storage is available");
        expect(timelinePanel).not.toContain("A private, encrypted journal");
        expect(timelinePanel).toContain("complete bounded local event set only when its read succeeds");
    });

    test("separates code maturity, running status, and the bounded profile payload", () => {
        const runtime = source("src/betterdiscord/modules/solcord/runtime.ts");
        const panel = source("src/betterdiscord/ui/solcord/panel.tsx");
        expect(panel).toContain("Ready passed startup validation");
        expect(panel).toContain("Degraded means part of a running tool drifted or could not clean up completely");
        expect(panel).not.toContain("Ready modules are connected to Discord now");
        expect(panel).toContain("Profiles save Solcord module settings");
        expect(panel).toContain("They do not capture Timeline policy or curated-addon choices");
        expect(panel).toContain("Save module state");
        expect(panel).not.toContain("Save current state");
        expect(runtime).toContain("Profiles preview, snapshot, apply, and roll back module settings");
        expect(runtime).toContain("name: \"Module Drift Radar + Patch Canary\"");
        expect(runtime).toContain("maturity: \"ready\"");
        expect(runtime).toContain("runReversiblePatchCanary");
        expect(runtime).not.toContain("Patch Canary coverage is not available yet");
    });
});
