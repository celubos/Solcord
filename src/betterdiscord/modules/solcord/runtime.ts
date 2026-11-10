import Logger from "@common/logger";
import {chunkTimelineEvents, drainTimelineChunks, fitTimelineEventBytes, timelineSerializedBytes} from "@common/solcord/timeline-limits";
import {mapSolcordVisibleRecords} from "@common/solcord/bounded-selector";
import {SolcordAccountReadCoalescer} from "@common/solcord/account-read";
import Store from "@stores/base";
import JsonStore from "@stores/json";
import Toasts from "@stores/toasts";
import IPC from "@modules/ipc";
import Patcher from "@modules/patcher";
import PluginManager from "@modules/pluginmanager";
import ThemeManager from "@modules/thememanager";
import SettingsRenderer from "@ui/settings";
import Modals from "@ui/modals";
import DiscordModules from "@modules/discordmodules";
import {getInternalInstance} from "@utils/react";
import {Filters, getByKeys, getLazy, getLazyBySource, getModule, getStore, getWithKey} from "@webpack";

import type {PrivacyCapabilityRecord, PrivacyDecisionReceipt, PrivacyProfile, SolcordCuratedAddonState, SolcordMaturity, SolcordModuleHealth, SolcordModuleId, SolcordPowerExperimentId} from "./contracts";
import {SolcordDisposalScope} from "./disposal";
import SolcordSettings, {normalizeSetupDraft, SOLCORD_THEMES, type SolcordImportPreview} from "./store";
import PluginDoctor from "./doctor";
import {runReversiblePatchCanary, runStructuralProbes, type StructuralProbeResult} from "./drift";
import {inspectLink, interceptLinkActivation, LinkReviewLifecycle, type LinkInspection} from "./link-lens";
import {BoundedPerformanceSampler, type PerformanceSample} from "./performance";
import {evaluateCrashGuard, type CrashGuardDocument} from "./crash-guard";
import {channelIsInTimelineScope, MessageTimelineJournal, normalizeDiscordTimelineDispatch, normalizeTimelineAccountId, resolveTimelineEventIdentity, timelineAuthorPolicyAllows, TimelineAccountGuard, timelineEventAccountMatches, type DiscordTimelineDispatchType, type TimelineAccountIdentity, type TimelineEvent, type TimelineMessageState} from "./message-timeline";
import {planLargeMessage} from "./message-splitter";
import {configureReviewedExecutionOwnership, integrityBlocksExecution, integrityFailureReason, integrityRecordIsAccepted, integrityRequiresQuarantine, normalizeIntegrityAudit, reviewBlocksEnable, summarizeIntegrity, unavailableIntegrityRecords, type AddonIntegrityKind, type AddonIntegrityRecord, type AddonIntegritySummary, type ReviewedExecutionOwnership} from "./integrity";
import {SOLCORD_CATALOG_INDEX, SOLCORD_RUNTIME_ADDONS, SOLCORD_RUNTIME_DEPENDENCIES, SOLCORD_RUNTIME_THEMES} from "@common/solcord/addon-trust.generated";
import {canonicalizeSolcordProviderMigrationPlan, captureExactAddonStates, communityAddonIsEnabled, createSolcordProviderMigrationPlan, isSolcordBuiltInAddon, planSolcordNativeSuiteLookups, resolveCommunityAddon, solcordBuiltInDoctorId, solcordProviderMigrationPlansMatch, solcordProviderReplacementIsReady, solcordStandaloneProviderFileName, type SolcordProviderMigrationIdentity, type SolcordProviderMigrationPlan} from "@common/solcord/builtin-addons";
import {resolveSolcordSetupPlan} from "@common/solcord/setup-catalog";
import {InvisibleTypingAdapter} from "./invisible-typing";
import {DoubleClickReplyFeature, type DoubleClickReplyAdapter, type DoubleClickReplyContext, type DoubleClickReplyTarget} from "./double-click-reply";
import {DoNotTrackAdapter, discordAnalyticsMethods, resolveDiscordAnalyticsTrack, type AnalyticsMethodTarget} from "./do-not-track";
import {applySolcordFakeDeafenConsentTransition, SolcordFakeDeafenButton, SolcordFakeDeafenController, type SolcordFakeDeafenStatus, type SolcordGatewaySocket} from "./fake-deafen";
import {discoverSolcordFakeDeafenCapabilities, isSolcordFakeDeafenGateway, isSolcordFakeDeafenMediaActions} from "./fake-deafen-capabilities";
import {readSolcordOwnVoiceDeafenState} from "./fake-deafen-voice-state";
import {findSolcordFakeDeafenPresentationKey, isSolcordFakeDeafenPresentationModule, preserveSolcordOwnVoiceDeafenPresentation} from "./fake-deafen-presentation";
import {patchSolcordFakeDeafenSend} from "./fake-deafen-send";
import {refreshSolcordFakeDeafenCurrentChannelRow} from "./fake-deafen-row-refresh";
import {normalizeDiscordRelationships, planSolcordFriendWatchNotices, reconcileSolcordRelationships, SolcordFriendWatchAccountBarrier, SolcordFriendWatchJournal, type SolcordFriendWatchNoticeState, type SolcordOwnerRelationshipAction, type SolcordRelationshipEvent, type SolcordRelationshipSnapshot} from "@common/solcord/friend-watch";
import {inspectSolcordDomain, SolcordDomainMemory, type SolcordDomainDecision, type SolcordDomainMemoryRecord, type SolcordDomainRisk} from "@common/solcord/domain-memory";
import {inspectSolcordAttachment, inspectSolcordLocalAttachment, type SolcordAttachmentInspection} from "@common/solcord/attachment-guard";
import {solcordReturnLaterTarget, SolcordReturnLaterJournal, SolcordReturnRouteMemory, type SolcordReturnLaterItem} from "@common/solcord/return-later";
import {filterSolcordCommands} from "@common/solcord/command-deck";
import {currentSolcordPeopleObjectId, resolveSolcordPeopleObject, type SolcordPeopleObjectResolution} from "@common/solcord/people-spaces";
import {audienceGuardHealthMaturity, isAudienceGuardStartAction, isAudienceGuardStopAction, normalizeAudienceGuardEntries, normalizeAudienceGuardPrivatePolicy, SolcordStreamAudienceGuard, type SolcordAudienceGuardArmReadiness, type SolcordAudienceGuardPrivatePolicy, type SolcordAudienceGuardStatus} from "./stream-audience-guard";
import {resolveSolcordRelationshipReader, resolveSolcordSpeakingReader, SolcordNativeSuiteController, subscribeSolcordChangeStores, type SolcordNativeSuiteAdapter, type SolcordNativeSuiteStatus} from "./native-suite";
import {resolveCachedVoiceHealthCapability} from "./voice-health";
import {normalizeSolcordVoiceStateIds, resolveSolcordLocalVolumeAction, resolveSolcordStreamingReaders, resolveSolcordVoiceChannelReader, resolveSolcordVoiceNoteCapture, resolveSolcordVoiceStateReader} from "./voice-adapter-capabilities";
import {SolcordBaselineSuite, type SolcordBaselineSuiteStatus} from "./baseline-suite";
import {describeSolcordStreamShieldResolution, normalizeSolcordStreamShieldSettings, SolcordStreamShieldDom, type SolcordStreamShieldResolution} from "./stream-shield";
import {SOLCORD_V2_REPLACEMENT_MANIFEST, solcordV2ArchiveReceiptMatchesPreview, solcordV2QuarantineIdsForArchivedFiles} from "@common/solcord/v2-replacement-manifest";
import {resolveSolcordPerformancePolicy} from "@common/solcord/product";
import {planSolcordPreferenceEffects} from "@common/solcord/preference-effects";
import {applyPrivacyProfile, boundPrivacyReceipts, createPrivacyDecisionReceipt, type SolcordPrivacyPreferences} from "@common/solcord/privacy";
import {resolvePrivacyMethodTarget, SolcordPrivacyPolicyAdapter, type PrivacyMethodSpec} from "./privacy-policy";
import {setSolcordAutomaticUpdatesAllowed} from "./privacy-runtime-state";
import {strictCommunityAddonActivationDecision} from "./addon-outbound-policy";
import {strictCommunityThemeActivationDecision} from "./theme-outbound-policy";
import {boundedSolcordStartupOperation, SolcordStartupPhaseController, type SolcordStartupPhaseReceipt} from "./startup-phases";

interface ActivityCompatibilityHealth {
    status: "idle" | "healthy" | "attention";
    unrestrictedOverride: boolean;
    counters: Record<string, number>;
    events: Array<{sequence: number; timestamp: number; action: string; context: string; reason?: string; webContentsId?: number; packageFile?: string;}>;
}

export interface AddonIntegrityStatus {
    checkedAt?: number;
    phase: "pending" | "startup" | "pre-setup" | "post-setup" | "pre-rollback" | "toggle" | "retry" | "failed";
    summary: AddonIntegritySummary;
    records: AddonIntegrityRecord[];
}

export interface NativePrivacyPolicyStatus {
    state: "unverified" | "pending" | "applied" | "failed";
    profile?: PrivacyProfile;
}

interface SolcordPrivateStorageStatus {
    persistent: boolean;
    sessionOnly: boolean;
    reason?: string;
}

interface SolcordPeoplePrivateState {
    pinnedDmIds: string[];
    hiddenGuildIds: string[];
    guildAliases: Record<string, string>;
    favoriteFriendIds: string[];
    hiddenFriendIds: string[];
    ignoredVoiceChannelIds: string[];
    ignoredVoiceGuildIds: string[];
}

function normalizePrivatePeopleState(value: unknown): SolcordPeoplePrivateState {
    const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const privateIds = (candidate: unknown) => Array.isArray(candidate)
        ? [...new Set(candidate.filter((id): id is string => typeof id === "string" && /^\d{1,32}$/.test(id)))].slice(0, 500)
        : [];
    const rawAliases = record.guildAliases && typeof record.guildAliases === "object" && !Array.isArray(record.guildAliases)
        ? record.guildAliases as Record<string, unknown>
        : {};
    const guildAliases = Object.fromEntries(Object.entries(rawAliases)
        .filter(([id, alias]) => /^\d{1,32}$/.test(id) && typeof alias === "string")
        .slice(0, 500)
        .map(([id, alias]) => [id, [...(alias as string)].map(character => {
            const code = character.charCodeAt(0);
            return code < 32 || code === 127 ? " " : character;
        }).join("").replace(/\s+/g, " ").trim().slice(0, 80)])
        .filter(([, alias]) => Boolean(alias)));
    return {
        pinnedDmIds: privateIds(record.pinnedDmIds),
        hiddenGuildIds: privateIds(record.hiddenGuildIds),
        guildAliases,
        favoriteFriendIds: privateIds(record.favoriteFriendIds),
        hiddenFriendIds: privateIds(record.hiddenFriendIds),
        ignoredVoiceChannelIds: privateIds(record.ignoredVoiceChannelIds),
        ignoredVoiceGuildIds: privateIds(record.ignoredVoiceGuildIds)
    };
}

export interface ProfileAddonExecutionPlan {
    enablePlugins: string[];
    disablePlugins: string[];
    enableThemes: string[];
    disableThemes: string[];
}

export interface TimelineClearOutcome {
    status: "complete" | "incomplete" | "unavailable" | "failed";
    cleared: number;
    remaining: number;
    opaqueStores: number;
    requiresOpaqueRecovery: boolean;
}

export interface TimelineExportOutcome {
    status: "complete" | "incomplete" | "unavailable";
    omittedSegments: number;
    unreadableSegments: number;
    retentionApplied: boolean;
}

interface TimelineReadOutcome extends TimelineExportOutcome {
    events: TimelineEvent[];
    persistent: boolean;
    truncated: boolean;
}

export interface CuratedAdapterResult {
    enabled: boolean;
    provider: "community" | "solcord" | "off";
    ready?: boolean;
    conflict?: boolean;
    reason?: string;
}

const INDEPENDENT_BUILTIN_PROVIDERS = new Set(["DoNotTrack", "InvisibleTyping", "DoubleClickToReply", "SplitLargeMessages"]);

export interface SetupRollbackOutcome {
    status: "complete" | "partial" | "unavailable" | "failed";
    removed: number;
    preserved: number;
}

interface StrictPrivacyAddonChange {
    kind: "plugin" | "theme";
    fileName: string;
    doctorId: string;
    newlyQuarantined: boolean;
}

const FEATURE_META: Record<SolcordModuleId, {name: string; risk: SolcordModuleHealth["risk"]; maturity: SolcordMaturity; detail: string;}> = {
    "activity-bridge": {name: "Activity Bridge", risk: "standard", maturity: "ready", detail: "Waiting for the main-process compatibility ledger."},
    "plugin-doctor": {name: "Plugin Doctor + Addon Quarantine", risk: "standard", maturity: "ready", detail: "Monitoring local addon failures."},
    "drift-radar": {name: "Module Drift Radar + Patch Canary", risk: "standard", maturity: "ready", detail: "Running bounded structural probes and an isolated reversible-patch canary."},
    "performance-hud": {name: "Performance HUD", risk: "standard", maturity: "ready", detail: "Sampling local renderer measurements."},
    "workspace-profiles": {name: "Workspace Profiles", risk: "standard", maturity: "ready", detail: "Profiles preview, snapshot, apply, and roll back module settings. Optional exact addon states require a separate execution confirmation."},
    "command-deck": {name: "Command Deck", risk: "standard", maturity: "ready", detail: "Local command palette; no message actions."},
    "link-lens": {name: "Link Lens + Invite Inspector", risk: "standard", maturity: "ready", detail: "Native external-link review is available; invite metadata stays local and is never fetched."},
    "stream-shield": {name: "Stream Shield + Screenshot Scrubber", risk: "standard", maturity: "preview", detail: "Manual shield is ready; Go Live detection is validated at runtime."},
    "stream-audience-guard": {name: "Stream Audience Guard", risk: "experimental", maturity: "preview", detail: "Disabled and unarmed by default. Volatile stream, voice, and action adapters must all validate before this feature becomes available."},
    "settings-time-machine": {name: "Settings Time Machine + Update Ledger", risk: "standard", maturity: "ready", detail: "Bounded snapshots and migration records are active."},
    "accessibility-toolkit": {name: "Accessibility Toolkit", risk: "standard", maturity: "ready", detail: "Local presentation controls apply immediately and restore completely on disable."},
    "friend-watch": {name: "Friend Watch", risk: "experimental", maturity: "preview", detail: "Disabled until separate consent. Uses only the already-loaded relationship store and never polls Discord."},
    "message-timeline": {name: "Message Timeline", risk: "experimental", maturity: "preview", detail: "Observed-message journal is disabled until setup consent is completed."}
};

const FEATURE_IDS = Object.keys(FEATURE_META) as SolcordModuleId[];

function errorName(error: unknown): string {
    return error instanceof Error ? error.name.slice(0, 80) : typeof error;
}

function normalizeTimelineReadOutcome(value: unknown): TimelineReadOutcome {
    const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const boundedCount = (candidate: unknown) => typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= 0 ? Math.min(candidate, 100_000) : 0;
    const omittedSegments = boundedCount(record.omittedSegments);
    const unreadableSegments = boundedCount(record.unreadableSegments);
    const retentionApplied = record.retentionApplied === true;
    const truncated = record.truncated === true || omittedSegments > 0;
    const complete = record.complete === true && retentionApplied && !truncated && unreadableSegments === 0;
    return {
        status: complete ? "complete" : "incomplete",
        events: Array.isArray(record.events) ? record.events.slice(-10_000) as TimelineEvent[] : [],
        persistent: record.persistent === true,
        truncated,
        omittedSegments,
        unreadableSegments,
        retentionApplied
    };
}

function textElement(tag: string, text: string, className?: string): HTMLElement {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "solcord-local-button";
    element.textContent = label;
    element.addEventListener("click", onClick);
    return element;
}

function handleDialogKeydown(event: KeyboardEvent, root: HTMLElement, close: () => void): void {
    if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
    }
    if (event.key !== "Tab") return;
    event.stopPropagation();
    const focusable = [...root.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])")]
        .filter(element => !(element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) || !element.disabled);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    }
    else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

function countResources(scopes: Map<SolcordModuleId, SolcordDisposalScope>): number {
    let total = 0;
    for (const scope of scopes.values()) total += Object.values(scope.counts()).reduce((sum, value) => sum + value, 0);
    return total;
}

export function normalizeTimelineClearOutcome(value: unknown): TimelineClearOutcome {
    if (!value || typeof value !== "object") return {status: "failed", cleared: 0, remaining: 0, opaqueStores: 0, requiresOpaqueRecovery: false};
    const result = value as Record<string, unknown>;
    const cleared = typeof result.cleared === "number" && Number.isSafeInteger(result.cleared) && result.cleared >= 0 ? result.cleared : undefined;
    const remaining = typeof result.remaining === "number" && Number.isSafeInteger(result.remaining) && result.remaining >= 0 ? result.remaining : undefined;
    const opaqueStores = typeof result.opaqueStores === "number" && Number.isSafeInteger(result.opaqueStores) && result.opaqueStores >= 0 ? result.opaqueStores : undefined;
    if (cleared === undefined || remaining === undefined || opaqueStores === undefined || typeof result.complete !== "boolean" || typeof result.requiresOpaqueRecovery !== "boolean") {
        return {status: "failed", cleared: 0, remaining: 0, opaqueStores: 0, requiresOpaqueRecovery: false};
    }
    return {
        status: result.complete && remaining === 0 ? "complete" : "incomplete",
        cleared,
        remaining,
        opaqueStores,
        requiresOpaqueRecovery: result.requiresOpaqueRecovery
    };
}

export function normalizeSetupRollbackOutcome(value: unknown, addonStatesRestored: boolean): SetupRollbackOutcome {
    if (!value || typeof value !== "object") return {status: "failed", removed: 0, preserved: 0};
    const result = value as Record<string, unknown>;
    if (typeof result.complete !== "boolean" || !Array.isArray(result.removed) || !Array.isArray(result.preserved)) {
        return {status: "failed", removed: 0, preserved: 0};
    }
    const removed = result.removed.length;
    const preserved = result.preserved.length;
    return {status: result.complete && preserved === 0 && addonStatesRestored ? "complete" : "partial", removed, preserved};
}

const PRIVATE_CAPABILITY = /^[a-zA-Z0-9_-]{43}$/;
const TIMELINE_IPC = Object.freeze({
    claimBootstrap: IPC.claimSolcordTimelineBootstrap.bind(IPC),
    bootstrap: IPC.bootstrapTimeline.bind(IPC),
    bindAccount: IPC.bindTimelineAccount.bind(IPC),
    releaseAccount: IPC.releaseTimelineAccount.bind(IPC),
    status: IPC.getTimelineStatus.bind(IPC),
    append: IPC.appendTimeline.bind(IPC),
    read: IPC.readTimeline.bind(IPC),
    clear: IPC.clearTimeline.bind(IPC),
    friendStatus: IPC.getFriendWatchStatus.bind(IPC),
    friendAppend: IPC.appendFriendWatch.bind(IPC),
    friendRead: IPC.readFriendWatch.bind(IPC),
    friendClear: IPC.clearFriendWatch.bind(IPC),
    audienceStatus: IPC.getAudienceGuardStatus.bind(IPC),
    audienceRead: IPC.readAudienceGuard.bind(IPC),
    audienceWrite: IPC.writeAudienceGuard.bind(IPC),
    audienceClear: IPC.clearAudienceGuard.bind(IPC),
    peopleStatus: IPC.getPeopleStateStatus.bind(IPC),
    peopleRead: IPC.readPeopleState.bind(IPC),
    peopleWrite: IPC.writePeopleState.bind(IPC),
    peopleClear: IPC.clearPeopleState.bind(IPC),
    applySetup: IPC.applySolcordSetup.bind(IPC),
    acknowledgeSetup: IPC.acknowledgeSolcordSetup.bind(IPC),
    reconcileSetup: IPC.reconcileSolcordSetup.bind(IPC),
    rollbackSetup: IPC.rollbackSolcordSetup.bind(IPC),
    auditSetup: IPC.auditSolcordSetup.bind(IPC),
    claimFirstSetupIntent: IPC.claimSolcordFirstSetupIntent.bind(IPC),
    acknowledgeFirstSetupIntent: IPC.acknowledgeSolcordFirstSetupIntent.bind(IPC),
    previewProviderArchive: IPC.previewSolcordProviderArchive.bind(IPC),
    applyProviderArchive: IPC.applySolcordProviderArchive.bind(IPC),
    rollbackProviderArchive: IPC.rollbackSolcordProviderArchive.bind(IPC),
    readTranslationCredential: IPC.readSolcordTranslationCredential.bind(IPC),
    writeTranslationCredential: IPC.writeSolcordTranslationCredential.bind(IPC),
    clearTranslationCredential: IPC.clearSolcordTranslationCredential.bind(IPC),
    notesStatus: IPC.getSolcordLocalIdentityNotesStatus.bind(IPC),
    notesRead: IPC.readSolcordLocalIdentityNotes.bind(IPC),
    notesWrite: IPC.writeSolcordLocalIdentityNote.bind(IPC),
    notesRemove: IPC.removeSolcordLocalIdentityNote.bind(IPC),
    notesClear: IPC.clearSolcordLocalIdentityNotes.bind(IPC)
});

class SolcordRuntimeStore extends Store {
    #initialized = false;
    #initializePromise?: Promise<void>;
    #started = false;
    #startPromise?: Promise<boolean>;
    #completionPromise?: Promise<void>;
    #deferredStartupScheduled = false;
    #startupPhases?: SolcordStartupPhaseController;
    #recoveryMode = false;
    #rootScope = new SolcordDisposalScope();
    #scopes = new Map<SolcordModuleId, SolcordDisposalScope>();
    #featureStartGenerations = new Map<SolcordModuleId, number>();
    #health = new Map<SolcordModuleId, SolcordModuleHealth>();
    #activityHealth?: ActivityCompatibilityHealth;
    #driftResults: StructuralProbeResult[] = [];
    #sampler = new BoundedPerformanceSampler();
    #lastPerformanceSample?: PerformanceSample;
    #timeline = new MessageTimelineJournal();
    #friendWatch = new SolcordFriendWatchJournal();
    #friendWatchPersistent = false;
    #friendWatchAccountGuard = new TimelineAccountGuard();
    #friendWatchIdentity?: TimelineAccountIdentity;
    #domainMemory = new SolcordDomainMemory();
    #returnLater = new SolcordReturnLaterJournal();
    #returnRouteMemory = new SolcordReturnRouteMemory();
    #privateUiAccountGuard = new TimelineAccountGuard();
    #privateUiAccountIdentity?: TimelineAccountIdentity;
    #sessionPeopleState: SolcordPeoplePrivateState = {pinnedDmIds: [], hiddenGuildIds: [], guildAliases: {}, favoriteFriendIds: [], hiddenFriendIds: [], ignoredVoiceChannelIds: [], ignoredVoiceGuildIds: []};
    #peopleStatePersistent = false;
    #peopleStateLoadGeneration = 0;
    #sessionFocusChannelIds: string[] = [];
    #timelinePersistent = false;
    #flushTimelinePersistence?: () => Promise<boolean>;
    #timelinePolicyChanged?: () => void;
    #timelineUnpersisted = false;
    #timelineIncompleteAccounts = new Set<string>();
    #resetTimelinePersistence?: () => void;
    #timelineRetentionDirty = false;
    #curatedScope = new SolcordDisposalScope();
    #curatedSynchronizationError?: string;
    #curatedCommunitySignature = "";
    #curatedAdapterResults: Record<string, CuratedAdapterResult> = {};
    #curatedAdapterRetryAttempt = 0;
    #curatedAdapterRetryScheduled = false;
    #curatedAdapterRetryGeneration = 0;
    #nativeSuite?: SolcordNativeSuiteController;
    readonly #emptyNativeSuiteView: readonly SolcordNativeSuiteStatus[] = Object.freeze([]);
    #baselineSuite?: SolcordBaselineSuite;
    #splitReviewOpen = false;
    #integrityQueue = Promise.resolve();
    #privateCapability?: string;
    #privateCapabilityQueue: Promise<void> = Promise.resolve();
    #boundTimelineAccountId?: string;
    #timelineAccountGuard = new TimelineAccountGuard();
    #integrity: AddonIntegrityStatus = {
        phase: "pending",
        records: unavailableIntegrityRecords(),
        summary: summarizeIntegrity(unavailableIntegrityRecords())
    };
    #fakeDeafen?: SolcordFakeDeafenController;
    #fakeDeafenButton?: SolcordFakeDeafenButton;
    #fakeDeafenScope = new SolcordDisposalScope();
    #fakeDeafenGeneration = 0;
    #fakeDeafenIndicatorReady = false;
    #fakeDeafenStatus: SolcordFakeDeafenStatus = {phase: "off", detail: "Built-in adapter is idle. Use the Fake Deafen button beside Discord's normal Deafen control.", connected: false, accountBound: false, capturedVoiceState: false, armed: false};
    #audienceGuard?: SolcordStreamAudienceGuard;
    #audienceGuardStatus: SolcordAudienceGuardStatus = {phase: "off", detail: "Audience Guard is off.", available: false, armed: false, accountBound: false, channelBound: false, denylistCount: 0, detectedCount: 0, activeModes: {preventStart: false, stopOnJoin: false, stopOnWatch: false}};
    #audiencePolicy: SolcordAudienceGuardPrivatePolicy = {version: 1, entries: []};
    #audiencePolicyAccountId?: string;
    #audienceReads = new SolcordAccountReadCoalescer<boolean>();
    #audiencePersistent = false;
    #audienceStorageStatus: SolcordPrivateStorageStatus = {persistent: false, sessionOnly: true, reason: "Audience Guard storage has not been checked yet."};
    #audienceLoadGeneration = 0;
    #privacyScope = new SolcordDisposalScope();
    #privacyCapabilities: PrivacyCapabilityRecord[] = [];
    #privacyReceipts: PrivacyDecisionReceipt[] = [];
    #privacyReceiptStorage: "unverified" | "persistent" | "session-only" = "unverified";
    #privacySequence = 0;
    #privacyNativeGeneration = 0;
    #privacyNativeStatus: NativePrivacyPolicyStatus = {state: "unverified"};
    #strictCommunityPolicyBusy = false;
    #firstSetupIntentId?: string;

    initialize(): Promise<void> {
        if (this.#initializePromise) return this.#initializePromise;
        this.#initialized = true;
        const phases = new SolcordStartupPhaseController({
            limit: JsonStore.get("misc", "solcordStartupPhaseLimit"),
            readResources: () => this.#startupResourceCounts()
        });
        this.#startupPhases = phases;
        const task = this.#initializePhases(phases).catch(error => {
            if (this.#initializePromise === task) this.#initializePromise = undefined;
            throw error;
        });
        this.#initializePromise = task;
        return task;
    }

    async #initializePhases(phases: SolcordStartupPhaseController): Promise<void> {
        try {
            phases.runSync("identity-config", () => {
                this.#privacyReceipts = boundPrivacyReceipts(JsonStore.get("misc", "solcordPrivacyReceipts"));
                this.#privacySequence = this.#privacyReceipts.at(-1)?.sequence ?? 0;
                this.#domainMemory = new SolcordDomainMemory(JsonStore.get("misc", "solcordDomainMemory"));
                const misc = JsonStore.get("misc");
                if (Object.prototype.hasOwnProperty.call(misc, "solcordReturnLater")) {
                    // Older builds stored account-derived Discord routes in the
                    // shared misc document. Remove the value without reading,
                    // migrating, or logging its content.
                    JsonStore.delete("misc", "solcordReturnLater");
                }
                this.#returnLater = new SolcordReturnLaterJournal();
            });
            await phases.run("settings-storage", async () => {
                SolcordSettings.initialize();
                setSolcordAutomaticUpdatesAllowed(SolcordSettings.snapshot().productPreferences.privacy.updates === "automatic");
                this.#refreshReviewedExecutionOwnership();
                await this.#bootstrapPrivateCapability();
            });
            phases.runSync("runtime-initialize", () => {
                PluginDoctor.initialize();
                this.#recoveryMode = this.#initializeCrashGuard();
                for (const id of FEATURE_IDS) {
                    const meta = FEATURE_META[id];
                    this.#health.set(id, {
                        id,
                        name: meta.name,
                        risk: meta.risk,
                        maturity: meta.maturity,
                        status: "stopped",
                        failures: [],
                        resources: {},
                        detail: meta.detail
                    });
                }
                const markClean = () => JsonStore.set("misc", "solcordCrashGuard", {attempts: [], state: "clean", at: Date.now()} satisfies CrashGuardDocument);
                this.#rootScope.listen(window, "beforeunload", markClean);
                this.#rootScope.own(() => this.#baselineSuite?.stop(), "other");
                this.#rootScope.own(() => this.#privacyScope.dispose(), "other");
                this.#rootScope.own(() => this.#startupPhases?.cancel(), "other");
            });
        }
        catch (error) {
            phases.cancel();
            this.#initialized = false;
            throw error;
        }
    }

    async start(): Promise<boolean> {
        if (this.#startPromise) return this.#startPromise;
        const task = (async () => {
            await this.initialize();
            const privacyReady = await this.#startupPhases!.run("privacy-outbound", async () => {
                // Required privacy policy installs before optional addon traffic.
                // Native acknowledgement gates activation; optional renderer
                // adapter misses remain separate capability records.
                await this.#synchronizePrivacyPolicy();
                const profile = SolcordSettings.snapshot().productPreferences.privacy.profile;
                if (this.#privacyNativeStatus.state !== "applied" || this.#privacyNativeStatus.profile !== profile) throw new Error("NativePrivacyPolicyUnconfirmed");
                return true;
            });
            this.#started = privacyReady === true;
            // The adjacent voice control is a primary user-facing control, so
            // it must not depend on the lower-priority deferred module pass.
            // Starting here installs only one dormant DOM observer until the
            // native Deafen button exists; the later call is idempotent.
            if (this.#started) this.#ensureFakeDeafenButton();
            return this.#started;
        })().catch(error => {
            this.#started = false;
            if (this.#startPromise === task) this.#startPromise = undefined;
            throw error;
        });
        this.#startPromise = task;
        return task;
    }

    async completeStartup(): Promise<void> {
        if (this.#completionPromise) return this.#completionPromise;
        if (!await this.start()) return;
        const task = this.#completeStartupPhases().catch(error => {
            if (this.#completionPromise === task) this.#completionPromise = undefined;
            throw error;
        });
        this.#completionPromise = task;
        return task;
    }

    async #completeStartupPhases(): Promise<void> {
        await this.#startupPhases!.run("module-registry", async () => {
            this.#applyProductPresentation();
            this.#synchronizeBaselineSuite();
            await this.#refreshAudienceGuardStorageStatus();
            try {
                const transactionIds = SolcordSettings.snapshot().setupTransactions.map(transaction => transaction.id);
                await this.#withPrivateCapability(capability => TIMELINE_IPC.reconcileSetup(capability, transactionIds));
            }
            catch (error) {
                this.#recoveryMode = true;
                configureReviewedExecutionOwnership([]);
                Logger.error("Solcord", "Setup transaction reconciliation failed; startup recovery mode is active.", error);
            }
            for (const id of FEATURE_IDS) {
                if (this.#recoveryMode && id !== "plugin-doctor") {
                    this.#setHealth(id, {status: "stopped", detail: "Held off by Solcord startup recovery mode."});
                    continue;
                }
                if (SolcordSettings.module(id).enabled) await this.#startFeature(id);
            }
        });

        await this.#startupPhases!.run("patch-observer", async () => {
            await this.#installRuntimeObservers();
            this.#synchronizeCuratedAdapters();
            this.#ensureFakeDeafenButton();
            await this.#synchronizePowerLab();
        });
    }

    scheduleDeferredStartup(): void {
        if (!this.#initialized || this.#deferredStartupScheduled) return;
        this.#deferredStartupScheduled = true;
        this.#rootScope.idle(() => {
            void this.completeStartup()
                .then(() => this.scheduleBackgroundStartup())
                .catch(error => Logger.error("Solcord", `Deferred module startup failed closed (${errorName(error)}).`));
        }, 1_500);
    }

    async #installRuntimeObservers(): Promise<void> {
        const privateUserStore = getStore("UserStore") as {getCurrentUser?: () => {id?: string;} | undefined; addChangeListener?: (listener: () => void) => void; removeChangeListener?: (listener: () => void) => void;} | undefined;
        this.#observePrivateUiAccount();
        await this.#loadPeopleState();
        const reducedMotionQuery = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
        if (reducedMotionQuery) {
            const onReducedMotionChange = () => {
                if (!this.#started || this.#recoveryMode) return;
                this.#applyProductPresentation();
                try {this.#synchronizeMotion();}
                catch (error) {Logger.warn("Solcord", `Motion policy update failed closed (${errorName(error)}).`);}
            };
            if (typeof reducedMotionQuery.addEventListener === "function" && typeof reducedMotionQuery.removeEventListener === "function") {
                reducedMotionQuery.addEventListener("change", onReducedMotionChange);
                this.#rootScope.own(() => reducedMotionQuery.removeEventListener("change", onReducedMotionChange), "listener");
            }
            else if (typeof reducedMotionQuery.addListener === "function" && typeof reducedMotionQuery.removeListener === "function") {
                reducedMotionQuery.addListener(onReducedMotionChange);
                this.#rootScope.own(() => reducedMotionQuery.removeListener(onReducedMotionChange), "listener");
            }
        }
        if (typeof privateUserStore?.addChangeListener === "function" && typeof privateUserStore.removeChangeListener === "function") {
            const onPrivateAccountChange = () => {
                if (!this.#observePrivateUiAccount()) return;
                // Retire account-bound controllers and notify views before any
                // queued disk read. A slow People store must not retain A's UI in B.
                const generation = this.privateAccountGeneration();
                this.#curatedAdapterRetryGeneration++;
                this.#curatedAdapterRetryScheduled = false;
                try {this.#curatedScope.dispose();}
                catch (error) {Logger.warn("Solcord", `Account-change cleanup needs review (${errorName(error)}).`);}
                this.#nativeSuite = undefined;
                this.#audienceGuard?.disarm("Audience Guard disarmed because the Discord account changed.");
                this.emitChange();
                void this.#loadPeopleState().finally(() => {
                    if (!this.#started || this.privateAccountGeneration() !== generation) return;
                    this.#synchronizeCuratedAdapters();
                    this.emitChange();
                });
            };
            privateUserStore.addChangeListener(onPrivateAccountChange);
            this.#rootScope.own(() => privateUserStore.removeChangeListener?.(onPrivateAccountChange), "listener");
        }
        const synchronizeCuratedAdapters = () => {
            const nextSignature = this.#communityAddonSignature();
            if (nextSignature !== this.#curatedCommunitySignature) this.#synchronizeCuratedAdapters();
            this.#synchronizePrivacyPolicy();
            void this.#enforceStrictCommunityAddonPolicy().catch(error => Logger.error("Solcord", `Strict Privacy addon enforcement failed closed (${errorName(error)}).`));
            void this.#synchronizePowerLab();
        };
        PluginManager.addChangeListener(synchronizeCuratedAdapters);
        this.#rootScope.own(() => PluginManager.removeChangeListener(synchronizeCuratedAdapters), "listener");
    }

    scheduleBackgroundStartup(): void {
        if (!this.#initialized || !this.#startupPhases) return;
        this.#rootScope.idle(() => {
            void this.#startupPhases!.run("background", async signal => {
                signal.throwIfAborted();
                try {await this.#enforceStrictCommunityAddonPolicy();}
                catch (error) {Logger.error("Solcord", `Strict Privacy could not quarantine an undeclared community addon; the previous addon states were restored (${errorName(error)}).`);}
                signal.throwIfAborted();
                this.#rootScope.timeout(() => {
                    JsonStore.set("misc", "solcordCrashGuard", {attempts: [], state: "stable", at: Date.now()} satisfies CrashGuardDocument);
                }, 30_000);
            }).catch(error => Logger.warn("Solcord", `Deferred startup work failed closed (${errorName(error)}).`));
        });
    }

    attachControlCenter(register: () => void): boolean {
        if (!this.#startupPhases) return false;
        return this.#startupPhases.runSync("control-center", () => {
            register();
            return true;
        }) === true;
    }

    async openPendingFirstSetup(): Promise<boolean> {
        try {
            const claim = await this.#withPrivateCapability(capability => boundedSolcordStartupOperation(TIMELINE_IPC.claimFirstSetupIntent(capability))) as {pending?: boolean; intentId?: unknown;};
            if (claim.pending !== true || typeof claim.intentId !== "string" || !/^[0-9a-f]{32}$/.test(claim.intentId)) return false;
            const intentId = claim.intentId;
            if (SolcordSettings.snapshot().onboarding.status !== "pending") {
                await this.#withPrivateCapability(capability => boundedSolcordStartupOperation(TIMELINE_IPC.acknowledgeFirstSetupIntent(capability, intentId)));
                return false;
            }
            SolcordSettings.setOnboardingStep(0);
            this.#firstSetupIntentId = intentId;
            SettingsRenderer.openSettingsPage("solcord");
            return true;
        }
        catch (error) {
            Logger.warn("Solcord", `Automatic First Setup stayed closed (${errorName(error)}); Discord startup continues.`);
            return false;
        }
    }

    async acknowledgeFirstSetupIntent(): Promise<boolean> {
        const intentId = this.#firstSetupIntentId;
        if (!intentId) return false;
        try {
            const result = await this.#withPrivateCapability(capability => boundedSolcordStartupOperation(TIMELINE_IPC.acknowledgeFirstSetupIntent(capability, intentId))) as {acknowledged?: boolean;};
            if (result.acknowledged !== true) return false;
            this.#firstSetupIntentId = undefined;
            return true;
        }
        catch {return false;}
    }

    startupPhaseSnapshot(): SolcordStartupPhaseReceipt[] {
        return this.#startupPhases?.snapshot() ?? [];
    }

    async enforceAddonIntegrityBeforeStart(): Promise<boolean> {
        if (!this.#started) return false;
        const completed = await this.#startupPhases?.run("integrity-validation", async () => {
            await this.#refreshAddonIntegrity("startup");
            await this.#enforceStrictCommunityAddonPolicy();
            return true;
        });
        return completed === true;
    }

    #startupResourceCounts(): Record<string, number> {
        const totals: Record<string, number> = {"feature-scope": this.#scopes.size};
        const scopes = [this.#rootScope, this.#privacyScope, this.#curatedScope, this.#fakeDeafenScope, ...this.#scopes.values()];
        for (const scope of scopes) {
            for (const [kind, count] of Object.entries(scope.counts())) totals[kind] = (totals[kind] ?? 0) + count;
        }
        return totals;
    }

    async #bootstrapPrivateCapability(): Promise<void> {
        try {
            const result = await boundedSolcordStartupOperation((async () => {
                const bootstrapCapability = await TIMELINE_IPC.claimBootstrap();
                if (!PRIVATE_CAPABILITY.test(bootstrapCapability)) throw new Error("SolcordBootstrapCapabilityInvalid");
                return TIMELINE_IPC.bootstrap(bootstrapCapability);
            })());
            if (!PRIVATE_CAPABILITY.test(result?.capability)) throw new Error("SolcordPrivateCapabilityInvalid");
            this.#privateCapability = result.capability;
            this.#boundTimelineAccountId = undefined;
        }
        catch (error) {
            this.#privateCapability = undefined;
            this.#boundTimelineAccountId = undefined;
            this.#setHealth("message-timeline", {maturity: "preview", detail: `Private storage capability stayed unavailable (${errorName(error)}); Timeline and setup mutations remain fail-closed.`});
        }
    }

    #withPrivateCapability<T>(operation: (capability: string) => Promise<T>): Promise<T> {
        const run = async () => {
            const capability = this.#privateCapability;
            if (!capability || !PRIVATE_CAPABILITY.test(capability)) throw new Error("SolcordPrivateCapabilityUnavailable");
            return operation(capability);
        };
        const result = this.#privateCapabilityQueue.then(run, run);
        this.#privateCapabilityQueue = result.then(() => undefined, () => undefined);
        return result;
    }

    #withTimelineAccount<T>(accountId: string, operation: (capability: string) => Promise<T>, identityIsCurrent: () => boolean = () => true): Promise<T> {
        return this.#withPrivateCapability(async capability => {
            if (!identityIsCurrent()) throw new Error("TimelineAccountChangedBeforeBinding");
            let activeCapability = capability;
            if (this.#boundTimelineAccountId !== accountId) {
                try {
                    const rotated = await TIMELINE_IPC.bindAccount(capability, accountId);
                    if (!PRIVATE_CAPABILITY.test(rotated?.capability)) throw new Error("SolcordTimelineBindingInvalid");
                    activeCapability = rotated.capability;
                    this.#privateCapability = activeCapability;
                    this.#boundTimelineAccountId = accountId;
                }
                catch (error) {
                    this.#privateCapability = undefined;
                    this.#boundTimelineAccountId = undefined;
                    throw error;
                }
            }
            if (!identityIsCurrent()) throw new Error("TimelineAccountChangedBeforeRequest");
            const result = await operation(activeCapability);
            if (!identityIsCurrent()) throw new Error("TimelineAccountChangedDuringRequest");
            return result;
        });
    }

    #currentTimelineAccountId(): string | undefined {
        const userStore = getStore("UserStore") as {getCurrentUser?: () => {id?: string;} | undefined;} | undefined;
        return normalizeTimelineAccountId(userStore?.getCurrentUser?.()?.id);
    }

    #captureTimelineIdentity(): TimelineAccountIdentity {
        return this.#timelineAccountGuard.observe(this.#currentTimelineAccountId());
    }

    #timelineIdentityIsCurrent(identity: TimelineAccountIdentity): boolean {
        return this.#timelineAccountGuard.matches(identity, this.#currentTimelineAccountId());
    }

    #observeFriendWatchIdentity(value: unknown = this.#currentTimelineAccountId()): {identity: TimelineAccountIdentity; changed: boolean;} {
        const identity = this.#friendWatchAccountGuard.observe(value);
        const previous = this.#friendWatchIdentity;
        const changed = !previous || previous.accountId !== identity.accountId || previous.generation !== identity.generation;
        if (changed) {
            this.#friendWatchIdentity = identity;
            this.#friendWatch.clear();
            this.#friendWatchPersistent = false;
        }
        return {identity, changed};
    }

    #friendWatchIdentityIsCurrent(identity: TimelineAccountIdentity): boolean {
        const current = this.#friendWatchIdentity;
        return current?.accountId === identity.accountId
            && current?.generation === identity.generation
            && this.#friendWatchAccountGuard.matches(identity, this.#currentTimelineAccountId());
    }

    async #releaseTimelineAccount(): Promise<void> {
        if (!this.#privateCapability || !this.#boundTimelineAccountId) return;
        try {
            await this.#withPrivateCapability(async capability => {
                const rotated = await TIMELINE_IPC.releaseAccount(capability);
                if (!PRIVATE_CAPABILITY.test(rotated?.capability)) throw new Error("SolcordTimelineReleaseInvalid");
                this.#privateCapability = rotated.capability;
                this.#boundTimelineAccountId = undefined;
            });
        }
        catch {
            this.#privateCapability = undefined;
            this.#boundTimelineAccountId = undefined;
        }
    }

    get recoveryMode(): boolean {
        return this.#recoveryMode;
    }

    health(): SolcordModuleHealth[] {
        return FEATURE_IDS.map(id => structuredClone(this.#health.get(id)!));
    }

    activityHealth(): ActivityCompatibilityHealth | undefined {
        return this.#activityHealth ? structuredClone(this.#activityHealth) : undefined;
    }

    driftResults(): StructuralProbeResult[] {
        return structuredClone(this.#driftResults);
    }

    performanceSamples(): PerformanceSample[] {
        return this.#sampler.snapshot();
    }

    integrityStatus(): AddonIntegrityStatus {
        return structuredClone(this.#integrity);
    }

    curatedAdapterStatus(): Record<string, CuratedAdapterResult> {
        const results = structuredClone(this.#curatedAdapterResults);
        for (const [name, result] of Object.entries(results)) {
            if (!result.enabled || result.provider !== "solcord" || INDEPENDENT_BUILTIN_PROVIDERS.has(name)) continue;
            result.ready = this.#nativeSuite?.providerReady(name) === true;
            result.enabled = result.ready || this.#nativeSuite?.providerAvailable(name) === true;
            if (result.ready) {delete result.reason;}
            else {
                result.reason = result.enabled
                    ? "Available — the first-party adapter is active, but Ready is withheld until a matching live interaction succeeds."
                    : "This feature is unavailable on the current Discord build.";
            }
        }
        return results;
    }

    timelineEntries(channelId?: string): TimelineMessageState[] {
        if (this.#timeline.prune(SolcordSettings.slice("timelinePolicy"))) this.#timelineRetentionDirty = true;
        return this.#timeline.snapshot(channelId, 250);
    }

    timelineView(): readonly TimelineMessageState[] {
        if (this.#timeline.prune(SolcordSettings.slice("timelinePolicy"))) this.#timelineRetentionDirty = true;
        return this.#timeline.view();
    }

    timelineStatus(): ReturnType<MessageTimelineJournal["status"]> & {persistent: boolean;} {
        if (this.#timeline.prune(SolcordSettings.slice("timelinePolicy"))) this.#timelineRetentionDirty = true;
        return {...this.#timeline.status(), persistent: this.#timelinePersistent};
    }

    timelineCurrentChannel(): {eligible: boolean; included: boolean;} {
        const selectedChannelStore = getStore("SelectedChannelStore") as {getChannelId?: () => string | undefined;} | undefined;
        const channelStore = getStore("ChannelStore") as {getChannel?: (id: string) => {id?: string; guild_id?: string; type?: number;} | undefined;} | undefined;
        const channelId = selectedChannelStore?.getChannelId?.();
        const channel = typeof channelId === "string" ? channelStore?.getChannel?.(channelId) : undefined;
        const eligible = Boolean(channel && typeof channel.id === "string" && /^\d{1,32}$/.test(channel.id) && typeof channel.guild_id === "string");
        return {eligible, included: eligible && SolcordSettings.snapshot().timelinePolicy.serverChannelIds.includes(channel!.id!)};
    }

    async setCurrentChannelInTimeline(included: boolean): Promise<boolean> {
        const selectedChannelStore = getStore("SelectedChannelStore") as {getChannelId?: () => string | undefined;} | undefined;
        const channelStore = getStore("ChannelStore") as {getChannel?: (id: string) => {id?: string; guild_id?: string;} | undefined;} | undefined;
        const channelId = selectedChannelStore?.getChannelId?.();
        const channel = typeof channelId === "string" ? channelStore?.getChannel?.(channelId) : undefined;
        if (!channel || typeof channel.id !== "string" || !/^\d{1,32}$/.test(channel.id) || typeof channel.guild_id !== "string") return false;
        const current = SolcordSettings.slice("timelinePolicy");
        const serverChannelIds = included ? [...new Set([...current.serverChannelIds, channel.id])] : current.serverChannelIds.filter(id => id !== channel.id);
        await this.setTimelinePolicy({...current, scope: serverChannelIds.length ? "selected-channels" : "dm-only", serverChannelIds});
        return true;
    }

    async clearTimeline(clearOpaqueStores = false): Promise<TimelineClearOutcome> {
        if (this.#flushTimelinePersistence) await this.#flushTimelinePersistence();
        const identity = this.#captureTimelineIdentity();
        if (!identity.accountId) return {status: "unavailable", cleared: 0, remaining: 0, opaqueStores: 0, requiresOpaqueRecovery: false};
        const identityIsCurrent = () => this.#timelineIdentityIsCurrent(identity);
        try {
            const raw = await this.#withTimelineAccount(identity.accountId, capability => TIMELINE_IPC.clear(capability, {
                policy: SolcordSettings.snapshot().timelinePolicy,
                clearOpaqueStores
            }), identityIsCurrent);
            if (!identityIsCurrent()) return {status: "failed", cleared: 0, remaining: 0, opaqueStores: 0, requiresOpaqueRecovery: false};
            const outcome = normalizeTimelineClearOutcome(raw);
            if (outcome.status === "complete") {
                if (!identityIsCurrent()) return {status: "failed", cleared: 0, remaining: 0, opaqueStores: 0, requiresOpaqueRecovery: false};
                this.#timeline.clear();
                this.#timelineIncompleteAccounts.delete(identity.accountId);
                this.#timelineUnpersisted = false;
                this.#resetTimelinePersistence?.();
                this.emitChange();
            }
            return outcome;
        }
        catch {
            return {status: "failed", cleared: 0, remaining: 0, opaqueStores: 0, requiresOpaqueRecovery: false};
        }
    }

    async setTimelinePolicy(value: Partial<import("./contracts").SolcordTimelinePolicy>): Promise<void> {
        const current = SolcordSettings.snapshot().timelinePolicy;
        await SolcordSettings.setTimelinePolicyAsync({...current, ...value});
        const next = SolcordSettings.slice("timelinePolicy");
        if (this.#started && current.enabled !== next.enabled) await this.#synchronizeFeatures(["message-timeline"]);
        else this.#timelinePolicyChanged?.();
    }

    friendWatchEvents(): SolcordRelationshipEvent[] {
        this.#observeFriendWatchIdentity();
        return this.#friendWatch.snapshot();
    }

    friendWatchPersistent(): boolean {
        this.#observeFriendWatchIdentity();
        return this.#friendWatchPersistent;
    }

    async setProductPreferences(value: unknown): Promise<void> {
        const previous = SolcordSettings.slice("productPreferences");
        const rollbackSnapshot = await SolcordSettings.setProductPreferencesAsync(value);
        const next = SolcordSettings.slice("productPreferences");
        const effects = planSolcordPreferenceEffects(previous, next);
        if (!effects.changed) return;
        if (effects.presentation) this.#applyProductPresentation();
        this.emitChange();
        if (!this.#started) return;
        try {
            if (effects.baseline) this.#synchronizeBaselineSuite();
            if (!this.#recoveryMode) {
                if (effects.nativeSuite) this.#synchronizeCuratedAdapters();
                else if (effects.motion) this.#synchronizeMotion();
                if ((effects.nativeSuite || effects.motion) && this.#curatedSynchronizationError) throw new Error(this.#curatedSynchronizationError);
            }
        }
        catch (error) {
            try {
                if (!rollbackSnapshot || !SolcordSettings.rollback(rollbackSnapshot.id)) throw new Error("The change's rollback snapshot is unavailable.");
                this.#applyProductPresentation();
                if (effects.baseline) this.#synchronizeBaselineSuite();
                if (!this.#recoveryMode) {
                    if (effects.nativeSuite) this.#synchronizeCuratedAdapters();
                    else if (effects.motion) this.#synchronizeMotion();
                }
            }
            catch (rollbackError) {
                throw new AggregateError([error, rollbackError], "Settings could not be applied or fully restored. Open Recovery before retrying.");
            }
            this.emitChange();
            throw new Error("The change was not applied. Previous settings were restored.", {cause: error});
        }
        if (effects.privacy) this.#synchronizePrivacyPolicy();
        if (effects.features.length) await this.#synchronizeFeatures(effects.features);
        this.emitChange();
    }

    privateAccountGeneration(): number {
        return this.#privateUiAccountIdentity?.generation ?? 0;
    }

    privateAccountIsCurrent(generation: number): boolean {
        const identity = this.#privateUiAccountIdentity;
        return Boolean(identity?.accountId && identity.generation === generation && this.#privateUiIdentityIsCurrent(identity));
    }

    #observePrivateUiAccount(): boolean {
        const identity = this.#privateUiAccountGuard.observe(this.#currentTimelineAccountId());
        const previous = this.#privateUiAccountIdentity;
        this.#privateUiAccountIdentity = identity;
        if (previous && previous.accountId === identity.accountId && previous.generation === identity.generation) return false;
        this.#peopleStateLoadGeneration++;
        this.#sessionPeopleState = {pinnedDmIds: [], hiddenGuildIds: [], guildAliases: {}, favoriteFriendIds: [], hiddenFriendIds: [], ignoredVoiceChannelIds: [], ignoredVoiceGuildIds: []};
        this.#peopleStatePersistent = false;
        this.#audienceLoadGeneration++;
        this.#audiencePolicy = {version: 1, entries: []};
        this.#audiencePolicyAccountId = undefined;
        this.#audiencePersistent = false;
        this.#sessionFocusChannelIds = [];
        this.#returnLater = new SolcordReturnLaterJournal();
        this.#returnRouteMemory.clear();
        this.#returnRouteMemory.remember(window.location.href);
        return true;
    }

    #privateUiIdentityIsCurrent(identity: TimelineAccountIdentity): boolean {
        const current = this.#privateUiAccountIdentity;
        return current?.accountId === identity.accountId
            && current?.generation === identity.generation
            && this.#privateUiAccountGuard.matches(identity, this.#currentTimelineAccountId());
    }

    async #loadPeopleState(): Promise<void> {
        const identity = this.#privateUiAccountIdentity;
        if (!identity?.accountId) return;
        const generation = ++this.#peopleStateLoadGeneration;
        const identityIsCurrent = () => generation === this.#peopleStateLoadGeneration && this.#privateUiIdentityIsCurrent(identity);
        try {
            const result = await this.#withTimelineAccount(identity.accountId, capability => TIMELINE_IPC.peopleRead(capability), identityIsCurrent) as {state?: unknown; persistent?: boolean; complete?: boolean;};
            if (!identityIsCurrent()) return;
            this.#sessionPeopleState = normalizePrivatePeopleState(result.state);
            this.#peopleStatePersistent = result.persistent === true && result.complete === true;
        }
        catch {
            if (identityIsCurrent()) this.#peopleStatePersistent = false;
        }
    }

    async #persistPeopleState(state: SolcordPeoplePrivateState): Promise<void> {
        const identity = this.#privateUiAccountIdentity;
        if (!identity?.accountId) return;
        const generation = ++this.#peopleStateLoadGeneration;
        const identityIsCurrent = () => generation === this.#peopleStateLoadGeneration && this.#privateUiIdentityIsCurrent(identity);
        try {
            const result = await this.#withTimelineAccount(identity.accountId, capability => TIMELINE_IPC.peopleWrite(capability, {state}), identityIsCurrent) as {state?: unknown; persistent?: boolean; complete?: boolean;};
            if (!identityIsCurrent()) return;
            this.#sessionPeopleState = normalizePrivatePeopleState(result.state);
            this.#peopleStatePersistent = result.persistent === true && result.complete === true;
            this.#nativeSuite?.updatePeoplePersistence(this.#peopleStatePersistent);
            this.emitChange();
        }
        catch {
            if (!identityIsCurrent()) return;
            this.#peopleStatePersistent = false;
            this.#nativeSuite?.updatePeoplePersistence(false);
            this.emitChange();
        }
    }

    privacyCapabilities(): PrivacyCapabilityRecord[] {
        return structuredClone(this.#privacyCapabilities);
    }

    privacyDecisionReceipts(): PrivacyDecisionReceipt[] {
        return structuredClone(this.#privacyReceipts);
    }

    privacyReceiptStorage(): "unverified" | "persistent" | "session-only" {
        return this.#privacyReceiptStorage;
    }

    privacyNativePolicyStatus(): NativePrivacyPolicyStatus {
        return {...this.#privacyNativeStatus};
    }

    canActivateCommunityAddon(addon: {filename: string; fileContent?: string; sourceSha256?: string;}): boolean {
        if (SolcordSettings.snapshot().productPreferences.privacy.profile !== "strict") return true;
        return strictCommunityAddonActivationDecision({
            fileName: addon.filename,
            fileContent: addon.fileContent,
            sourceSha256: addon.sourceSha256
        }, SOLCORD_CATALOG_INDEX)?.action === "keep";
    }

    canActivateCommunityTheme(theme: {filename: string; fileContent?: string; css?: string;}): boolean {
        if (SolcordSettings.snapshot().productPreferences.privacy.profile !== "strict") return true;
        return strictCommunityThemeActivationDecision({fileName: theme.filename, fileContent: theme.fileContent, css: theme.css}).action === "keep";
    }

    #communityAddonPolicy() {
        const enabled = PluginManager.addonList.filter(addon => PluginManager.isEnabled(addon.filename));
        const decisions = enabled.flatMap(addon => {
            const decision = strictCommunityAddonActivationDecision({fileName: addon.filename, fileContent: addon.fileContent, sourceSha256: addon.sourceSha256}, SOLCORD_CATALOG_INDEX);
            return decision ? [decision] : [];
        });
        return {enabled, decisions};
    }

    #communityThemePolicy() {
        const enabled = ThemeManager.addonList.filter(theme => ThemeManager.isEnabled(theme.filename));
        const decisions = enabled.map(theme => strictCommunityThemeActivationDecision({fileName: theme.filename, fileContent: theme.fileContent, css: theme.css}));
        return {enabled, decisions};
    }

    #restorePrivacyRollback(changed: readonly StrictPrivacyAddonChange[], snapshotId: string): string[] {
        const failures: string[] = [];
        try {
            if (!SolcordSettings.rollback(snapshotId)) failures.push("the settings snapshot was unavailable");
        }
        catch {failures.push("the settings snapshot could not be restored");}
        if (failures.length) return failures;

        for (const entry of changed) {
            const manager = entry.kind === "theme" ? ThemeManager : PluginManager;
            let enabled = false;
            try {
                manager.enableAddon(entry.fileName);
                enabled = manager.isEnabled(entry.fileName);
                if (!enabled) failures.push(`${entry.fileName} did not re-enable`);
            }
            catch {failures.push(`${entry.fileName} could not be re-enabled`);}
            if (!enabled || !entry.newlyQuarantined) continue;
            try {
                PluginDoctor.clearQuarantine(entry.doctorId);
                if (PluginDoctor.isQuarantined(entry.doctorId)) failures.push(`${entry.fileName} remained quarantined`);
            }
            catch {failures.push(`${entry.fileName} quarantine could not be cleared`);}
        }
        return failures;
    }

    #privacyRollbackError(snapshotId: string, failures: readonly string[]): Error {
        return new Error(`The privacy change failed closed, but automatic recovery was incomplete: ${failures.join("; ")}. Open Recovery and restore snapshot ${snapshotId}.`);
    }

    async #enforceStrictCommunityAddonPolicy(): Promise<void> {
        if (this.#strictCommunityPolicyBusy || SolcordSettings.snapshot().productPreferences.privacy.profile !== "strict") return;
        const addonPolicy = this.#communityAddonPolicy();
        const themePolicy = this.#communityThemePolicy();
        const blockedAddons = addonPolicy.decisions.filter(item => item.action === "disable");
        const blockedThemes = themePolicy.decisions.filter(item => item.action === "disable");
        if (!blockedAddons.length && !blockedThemes.length) return;
        const snapshot = SolcordSettings.capture("Before enforcing Strict Privacy for community addons", {
            plugins: this.#enabledAddonFiles(PluginManager),
            themes: this.#enabledAddonFiles(ThemeManager)
        });
        this.#strictCommunityPolicyBusy = true;
        const changed: StrictPrivacyAddonChange[] = [];
        try {
            for (const decision of blockedAddons) {
                const addon = addonPolicy.enabled.find(item => item.filename === decision.fileName);
                if (!addon || !PluginManager.isEnabled(addon.filename)) continue;
                PluginManager.disableAddon(addon.filename);
                if (PluginManager.isEnabled(addon.filename)) throw new Error("StrictPrivacyAddonDisableFailed");
                const doctorId = addon.name || addon.filename;
                const newlyQuarantined = !PluginDoctor.isQuarantined(doctorId);
                changed.push({kind: "plugin", fileName: addon.filename, doctorId, newlyQuarantined});
                PluginDoctor.quarantine(doctorId, decision.reason);
            }
            for (const decision of blockedThemes) {
                const theme = themePolicy.enabled.find(item => item.filename === decision.fileName);
                if (!theme || !ThemeManager.isEnabled(theme.filename)) continue;
                ThemeManager.disableAddon(theme.filename);
                if (ThemeManager.isEnabled(theme.filename)) throw new Error("StrictPrivacyThemeDisableFailed");
                const doctorId = theme.name || theme.filename;
                const newlyQuarantined = !PluginDoctor.isQuarantined(doctorId);
                changed.push({kind: "theme", fileName: theme.filename, doctorId, newlyQuarantined});
                PluginDoctor.quarantine(doctorId, decision.reason);
            }
        }
        catch (error) {
            const failures = this.#restorePrivacyRollback(changed, snapshot.id);
            if (failures.length) throw this.#privacyRollbackError(snapshot.id, failures);
            throw error;
        }
        finally {
            this.#strictCommunityPolicyBusy = false;
            this.#synchronizePrivacyPolicy();
        }
    }

    async setPrivacyProfile(profile: PrivacyProfile): Promise<string | undefined> {
        const current = SolcordSettings.snapshot().productPreferences;
        if (current.privacy.profile === profile && !current.privacy.migrationPending) {
            await this.#synchronizePrivacyPolicy();
            return;
        }
        const snapshot = SolcordSettings.capture(`Before applying ${profile} privacy`, {
            plugins: this.#enabledAddonFiles(PluginManager),
            themes: this.#enabledAddonFiles(ThemeManager)
        });
        const disabledCommunity: StrictPrivacyAddonChange[] = [];
        if (profile === "strict") this.#strictCommunityPolicyBusy = true;
        try {
            SolcordSettings.setProductPreferences({...current, privacy: applyPrivacyProfile(current.privacy, profile)});
            if (profile === "strict") {
                const enabled = PluginManager.addonList.filter(addon => PluginManager.isEnabled(addon.filename));
                const policy = enabled.flatMap(addon => {
                    const decision = strictCommunityAddonActivationDecision({fileName: addon.filename, fileContent: addon.fileContent, sourceSha256: addon.sourceSha256}, SOLCORD_CATALOG_INDEX);
                    return decision ? [decision] : [];
                });
                for (const decision of policy.filter(item => item.action === "disable")) {
                    const addon = enabled.find(item => item.filename === decision.fileName);
                    if (!addon) continue;
                    PluginManager.disableAddon(addon.filename);
                    if (PluginManager.isEnabled(addon.filename)) throw new Error("StrictPrivacyAddonDisableFailed");
                    const doctorId = addon.name || addon.filename;
                    const newlyQuarantined = !PluginDoctor.isQuarantined(doctorId);
                    disabledCommunity.push({kind: "plugin", fileName: addon.filename, doctorId, newlyQuarantined});
                    PluginDoctor.quarantine(doctorId, decision.reason);
                }
                const themes = ThemeManager.addonList.filter(theme => ThemeManager.isEnabled(theme.filename));
                for (const decision of themes.map(theme => strictCommunityThemeActivationDecision({fileName: theme.filename, fileContent: theme.fileContent, css: theme.css})).filter(item => item.action === "disable")) {
                    const theme = themes.find(item => item.filename === decision.fileName);
                    if (!theme) continue;
                    ThemeManager.disableAddon(theme.filename);
                    if (ThemeManager.isEnabled(theme.filename)) throw new Error("StrictPrivacyThemeDisableFailed");
                    const doctorId = theme.name || theme.filename;
                    const newlyQuarantined = !PluginDoctor.isQuarantined(doctorId);
                    disabledCommunity.push({kind: "theme", fileName: theme.filename, doctorId, newlyQuarantined});
                    PluginDoctor.quarantine(doctorId, decision.reason);
                }
            }
            this.#strictCommunityPolicyBusy = false;
            await this.#synchronizePrivacyPolicy();
            this.emitChange();
            return snapshot.id;
        }
        catch (error) {
            const failures = this.#restorePrivacyRollback(disabledCommunity, snapshot.id);
            this.#strictCommunityPolicyBusy = false;
            await this.#synchronizePrivacyPolicy();
            if (failures.length) throw this.#privacyRollbackError(snapshot.id, failures);
            throw error;
        }
    }

    fakeDeafenStatus(): SolcordFakeDeafenStatus {
        const status = structuredClone(this.#fakeDeafenStatus);
        status.ownRowIndicator = this.#fakeDeafenIndicatorReady;
        try {
            const user = getStore("UserStore") as {getCurrentUser?: () => {id?: string;} | undefined;} | undefined;
            const selected = getStore("SelectedChannelStore") as {getVoiceChannelId?: () => string | undefined;} | undefined;
            status.voice = readSolcordOwnVoiceDeafenState({
                userId: user?.getCurrentUser?.()?.id,
                channelId: selected?.getVoiceChannelId?.(),
                mediaEngineStore: getStore("MediaEngineStore"),
                voiceStateStore: getStore("VoiceStateStore")
            });
        }
        catch {status.voice = undefined;}
        return status;
    }

    fakeDeafenProvider(): "community" | "solcord" | "off" {
        const communityAddon = PluginManager.resolveAddon("FakeDeafen") ?? PluginManager.resolveAddon("FakeDeafen.plugin.js");
        if (communityAddon && PluginManager.isEnabled(communityAddon.filename)) return "community";
        return SolcordSettings.snapshot().powerLab["fake-deafen"].enabled ? "solcord" : "off";
    }

    audienceGuardStatus(): SolcordAudienceGuardStatus {
        return structuredClone(this.#audienceGuardStatus);
    }

    audienceGuardArmReadiness(): SolcordAudienceGuardArmReadiness {
        const settings = SolcordSettings.module("stream-audience-guard");
        if (!settings.enabled || this.#audiencePolicyAccountId !== this.#currentTimelineAccountId()) return {ready: false, detail: "Audience Guard is waiting for its account-private policy."};
        return this.#audienceGuard?.armReadiness(this.#audiencePolicy.entries, {
            preventStart: settings.values.preventStart === true,
            stopOnJoin: settings.values.stopOnJoin === true,
            stopOnWatch: settings.values.stopOnWatch === true
        }) ?? {ready: false, detail: "Audience Guard is unavailable on this Discord build."};
    }

    nativeSuiteStatus(): SolcordNativeSuiteStatus[] {
        return this.#nativeSuite?.statuses() ?? [];
    }

    nativeSuiteView(): readonly SolcordNativeSuiteStatus[] {
        return this.#nativeSuite?.statusView() ?? this.#emptyNativeSuiteView;
    }

    nativeSuiteController(): SolcordNativeSuiteController | undefined {
        return this.#nativeSuite;
    }

    resolvePeopleObject(id: string): SolcordPeopleObjectResolution {
        type Channel = {id?: unknown; type?: unknown; guild_id?: unknown; guildId?: unknown;};
        type Server = {id?: unknown; name?: unknown;};
        type User = {id?: unknown; username?: unknown; globalName?: unknown; global_name?: unknown;};
        const channels = getStore("ChannelStore") as {getChannel?(id: string): Channel | undefined;} | undefined;
        const servers = getStore("GuildStore") as {getGuild?(id: string): Server | undefined;} | undefined;
        const users = getStore("UserStore") as {getUser?(id: string): User | undefined;} | undefined;
        return resolveSolcordPeopleObject(id, {
            channel: objectId => {
                const channel = channels?.getChannel?.(objectId);
                return channel ? {id: channel.id, type: channel.type, guildId: channel.guild_id ?? channel.guildId} : undefined;
            },
            server: objectId => servers?.getGuild?.(objectId),
            user: objectId => {
                const user = users?.getUser?.(objectId);
                return user ? {id: user.id, label: user.globalName ?? user.global_name ?? user.username} : undefined;
            }
        });
    }

    currentPeopleObjectId(): string | undefined {
        type Channel = {id?: unknown; type?: unknown; guild_id?: unknown; guildId?: unknown;};
        type Server = {id?: unknown; name?: unknown;};
        const selectedChannels = getStore("SelectedChannelStore") as {getChannelId?(): unknown;} | undefined;
        const selectedServers = getStore("SelectedGuildStore") as {getGuildId?(): unknown;} | undefined;
        const channels = getStore("ChannelStore") as {getChannel?(id: string): Channel | undefined;} | undefined;
        const servers = getStore("GuildStore") as {getGuild?(id: string): Server | undefined;} | undefined;
        return currentSolcordPeopleObjectId(selectedChannels?.getChannelId?.(), selectedServers?.getGuildId?.(), {
            channel: objectId => {
                const channel = channels?.getChannel?.(objectId);
                return channel ? {id: channel.id, type: channel.type, guildId: channel.guild_id ?? channel.guildId} : undefined;
            },
            server: objectId => servers?.getGuild?.(objectId)
        });
    }

    baselineSuiteStatus(): SolcordBaselineSuiteStatus {
        return this.#baselineSuite?.status() ?? {active: false, resources: {}, enabled: [], unavailable: []};
    }

    async readTranslationCredential(provider: "deepl" | "libretranslate", endpoint: string, accountGeneration: number): Promise<{credential: string; persistent: boolean; complete: boolean;}> {
        if (!this.privateAccountIsCurrent(accountGeneration)) return {credential: "", persistent: false, complete: false};
        const identity = this.#captureTimelineIdentity();
        if (!identity.accountId) return {credential: "", persistent: false, complete: false};
        try {return await this.#withTimelineAccount(identity.accountId, capability => TIMELINE_IPC.readTranslationCredential(capability, {provider, endpoint}), () => this.#timelineIdentityIsCurrent(identity)) as {credential: string; persistent: boolean; complete: boolean;};}
        catch {return {credential: "", persistent: false, complete: false};}
    }

    async writeTranslationCredential(provider: "deepl" | "libretranslate", endpoint: string, credential: string, accountGeneration: number): Promise<{persistent: boolean; complete: boolean;}> {
        if (!this.privateAccountIsCurrent(accountGeneration)) return {persistent: false, complete: false};
        const identity = this.#captureTimelineIdentity();
        if (!identity.accountId) return {persistent: false, complete: false};
        try {return await this.#withTimelineAccount(identity.accountId, capability => TIMELINE_IPC.writeTranslationCredential(capability, {provider, endpoint, credential}), () => this.#timelineIdentityIsCurrent(identity)) as {persistent: boolean; complete: boolean;};}
        catch {return {persistent: false, complete: false};}
    }

    async clearTranslationCredential(provider: "deepl" | "libretranslate", endpoint: string, accountGeneration: number): Promise<{persistent: boolean; complete: boolean;}> {
        if (!this.privateAccountIsCurrent(accountGeneration)) return {persistent: false, complete: false};
        const identity = this.#captureTimelineIdentity();
        if (!identity.accountId) return {persistent: false, complete: false};
        try {return await this.#withTimelineAccount(identity.accountId, capability => TIMELINE_IPC.clearTranslationCredential(capability, {provider, endpoint}), () => this.#timelineIdentityIsCurrent(identity)) as {persistent: boolean; complete: boolean;};}
        catch {return {persistent: false, complete: false};}
    }

    async localIdentityNotesStatus(): Promise<{persistent: boolean; sessionOnly: boolean; reason?: string;}> {
        try {return await this.#withPrivateCapability(capability => TIMELINE_IPC.notesStatus(capability)) as {persistent: boolean; sessionOnly: boolean; reason?: string;};}
        catch {return {persistent: false, sessionOnly: true, reason: "Private note storage is unavailable."};}
    }

    async readLocalIdentityNotes(): Promise<{notes: Array<{subjectId: string; text: string; tags: string[]; updatedAt: number;}>; persistent: boolean; complete: boolean;}> {
        const accountId = this.#currentTimelineAccountId();
        if (!accountId) return {notes: [], persistent: false, complete: false};
        try {return await this.#withTimelineAccount(accountId, capability => TIMELINE_IPC.notesRead(capability), () => accountId === this.#currentTimelineAccountId()) as {notes: Array<{subjectId: string; text: string; tags: string[]; updatedAt: number;}>; persistent: boolean; complete: boolean;};}
        catch {return {notes: [], persistent: false, complete: false};}
    }

    async writeLocalIdentityNote(payload: {subjectId: string; note: string; tags: readonly string[]; storage: "secure-only";}): Promise<{persistent: boolean; complete: boolean;}> {
        const accountId = this.#currentTimelineAccountId();
        if (!accountId) return {persistent: false, complete: false};
        try {
            const result = await this.#withTimelineAccount(accountId, capability => TIMELINE_IPC.notesWrite(capability, {subjectId: payload.subjectId, note: payload.note, tags: [...payload.tags], storage: payload.storage}), () => accountId === this.#currentTimelineAccountId()) as {persistent: boolean; complete: boolean;};
            return {persistent: result.persistent === true, complete: result.complete === true};
        }
        catch {return {persistent: false, complete: false};}
    }

    async removeLocalIdentityNote(subjectId: string): Promise<{removed: boolean; persistent: boolean; complete: boolean;}> {
        const accountId = this.#currentTimelineAccountId();
        if (!accountId) return {removed: false, persistent: false, complete: false};
        try {return await this.#withTimelineAccount(accountId, capability => TIMELINE_IPC.notesRemove(capability, subjectId), () => accountId === this.#currentTimelineAccountId()) as {removed: boolean; persistent: boolean; complete: boolean;};}
        catch {return {removed: false, persistent: false, complete: false};}
    }

    async clearLocalIdentityNotes(): Promise<{cleared: number; persistent: boolean; complete: boolean;}> {
        const accountId = this.#currentTimelineAccountId();
        if (!accountId) return {cleared: 0, persistent: false, complete: false};
        try {return await this.#withTimelineAccount(accountId, capability => TIMELINE_IPC.notesClear(capability), () => accountId === this.#currentTimelineAccountId()) as {cleared: number; persistent: boolean; complete: boolean;};}
        catch {return {cleared: 0, persistent: false, complete: false};}
    }

    audienceGuardPrivatePolicy(): {policy: SolcordAudienceGuardPrivatePolicy; persistent: boolean; loaded: boolean; storage: SolcordPrivateStorageStatus;} {
        const current = Boolean(this.#audiencePolicyAccountId && this.#audiencePolicyAccountId === this.#currentTimelineAccountId());
        return {
            policy: current ? structuredClone(this.#audiencePolicy) : {version: 1, entries: []},
            persistent: current && this.#audiencePersistent,
            loaded: current,
            storage: structuredClone(this.#audienceStorageStatus)
        };
    }

    async setAudienceGuardEntries(value: unknown, accountGeneration: number): Promise<boolean> {
        if (!this.privateAccountIsCurrent(accountGeneration)) return false;
        const accountId = this.#currentTimelineAccountId();
        if (!accountId) return false;
        const policy: SolcordAudienceGuardPrivatePolicy = {version: 1, entries: normalizeAudienceGuardEntries(value)};
        this.#audienceGuard?.disarm("Audience Guard disarmed because its private denylist changed.");
        const generation = ++this.#audienceLoadGeneration;
        try {
            const result = await this.#withTimelineAccount(accountId, capability => TIMELINE_IPC.audienceWrite(capability, {policy}), () => generation === this.#audienceLoadGeneration && accountId === this.#currentTimelineAccountId()) as {policy?: unknown; persistent?: boolean; complete?: boolean;};
            if (generation !== this.#audienceLoadGeneration || accountId !== this.#currentTimelineAccountId()) return false;
            this.#audiencePolicy = normalizeAudienceGuardPrivatePolicy(result.policy);
            this.#audiencePolicyAccountId = accountId;
            this.#audiencePersistent = result.persistent === true && result.complete === true;
            this.#audienceStorageStatus = result.persistent === true && result.complete === true
                ? {persistent: true, sessionOnly: false}
                : {persistent: false, sessionOnly: true, reason: result.complete === true ? "Electron safeStorage is unavailable; the Audience Guard denylist remains in memory only." : "Audience Guard encrypted persistence failed closed for this write."};
            this.emitChange();
            return result.complete === true;
        }
        catch {
            if (generation === this.#audienceLoadGeneration && this.privateAccountIsCurrent(accountGeneration) && accountId === this.#currentTimelineAccountId()) {
                this.#audiencePolicy = policy;
                this.#audiencePolicyAccountId = accountId;
                this.#audiencePersistent = false;
                this.#audienceStorageStatus = {persistent: false, sessionOnly: true, reason: "Audience Guard encrypted persistence failed closed for this write."};
                this.emitChange();
            }
            return false;
        }
    }

    async clearAudienceGuardEntries(accountGeneration: number): Promise<boolean> {
        if (!this.privateAccountIsCurrent(accountGeneration)) return false;
        const accountId = this.#currentTimelineAccountId();
        if (!accountId) return false;
        this.#audienceGuard?.disarm("Audience Guard disarmed because its private denylist was cleared.");
        const generation = ++this.#audienceLoadGeneration;
        try {
            const result = await this.#withTimelineAccount(accountId, capability => TIMELINE_IPC.audienceClear(capability, {}), () => generation === this.#audienceLoadGeneration && accountId === this.#currentTimelineAccountId()) as {complete?: boolean; persistent?: boolean;};
            if (generation !== this.#audienceLoadGeneration || accountId !== this.#currentTimelineAccountId()) return false;
            this.#audiencePolicy = {version: 1, entries: []};
            this.#audiencePolicyAccountId = accountId;
            this.#audiencePersistent = result.persistent === true && result.complete === true;
            this.#audienceStorageStatus = result.persistent === true && result.complete === true
                ? {persistent: true, sessionOnly: false}
                : {persistent: false, sessionOnly: true, reason: result.complete === true ? "Electron safeStorage is unavailable; Audience Guard clear completed in memory only." : "Audience Guard encrypted cleanup needs attention."};
            this.emitChange();
            return result.complete === true;
        }
        catch {return false;}
    }

    armAudienceGuard(accountGeneration: number): boolean {
        if (!this.privateAccountIsCurrent(accountGeneration)) return false;
        const settings = SolcordSettings.module("stream-audience-guard");
        if (!settings.enabled || this.#audiencePolicyAccountId !== this.#currentTimelineAccountId()) return false;
        return this.#audienceGuard?.arm(this.#audiencePolicy.entries, {
            preventStart: settings.values.preventStart === true,
            stopOnJoin: settings.values.stopOnJoin === true,
            stopOnWatch: settings.values.stopOnWatch === true
        }) === true;
    }

    disarmAudienceGuard(): boolean {
        return this.#audienceGuard?.disarm() ?? false;
    }

    async setPowerExperiment(id: SolcordPowerExperimentId, enabled: boolean, acknowledged = false): Promise<boolean> {
        if (enabled && id !== "fake-deafen") return false;
        if (id === "fake-deafen") {
            const accepted = await applySolcordFakeDeafenConsentTransition({
                persist: () => SolcordSettings.setPowerExperiment(id, enabled, acknowledged),
                synchronize: async () => {if (this.#started) await this.#synchronizePowerLab();},
                failClosed: () => this.#stopFakeDeafen()
            });
            if (!accepted) {
                this.#fakeDeafenStatus = {
                    phase: "attention",
                    detail: "Fake Deafen could not finish applying the change and was stopped for this session. Check the saved selection before restarting.",
                    connected: false,
                    accountBound: false,
                    capturedVoiceState: false,
                    armed: false
                };
                this.emitChange();
                return false;
            }
        }
        else {
            SolcordSettings.setPowerExperiment(id, enabled, acknowledged);
            if (this.#started) await this.#synchronizePowerLab();
        }
        return SolcordSettings.snapshot().powerLab[id].enabled === enabled
            && (id !== "fake-deafen" || (enabled
                ? Boolean(this.#fakeDeafen && this.#fakeDeafenStatus.accountBound && !this.#fakeDeafenStatus.pending && this.#fakeDeafenStatus.phase !== "attention")
                : this.#fakeDeafenStatus.phase !== "attention"));
    }

    armFakeDeafen(): boolean {
        const consent = SolcordSettings.snapshot().powerLab["fake-deafen"];
        if (!consent.enabled || consent.acknowledgementVersion !== SolcordSettings.snapshot().consentVersion) return false;
        const armed = this.#fakeDeafen?.arm() === true;
        this.#fakeDeafenStatus = this.#fakeDeafen?.snapshot() ?? this.#fakeDeafenStatus;
        this.emitChange();
        return armed;
    }

    disarmFakeDeafen(): boolean {
        const disarmed = this.#fakeDeafen?.disarm() ?? true;
        this.#fakeDeafenStatus = this.#fakeDeafen?.snapshot() ?? this.#fakeDeafenStatus;
        this.emitChange();
        return disarmed;
    }

    async toggleFakeDeafenDirect(): Promise<boolean> {
        if (!this.#started) {
            Toasts.error("Solcord is still starting. Wait for startup to finish, then retry Fake Deafen.", {forceShow: true});
            return false;
        }
        if (this.#recoveryMode) {
            Toasts.error("Fake Deafen is unavailable during Safe Start. Resume Solcord first.", {forceShow: true});
            return false;
        }
        const communityAddon = PluginManager.resolveAddon("FakeDeafen") ?? PluginManager.resolveAddon("FakeDeafen.plugin.js");
        if (communityAddon && PluginManager.isEnabled(communityAddon.filename)) {
            Toasts.error("Disable the separate FakeDeafen plugin before using Solcord's built-in control.", {forceShow: true});
            return false;
        }
        try {
            const wasCancelled = (generation: number) => !SolcordSettings.snapshot().powerLab["fake-deafen"].enabled
                || (generation !== this.#fakeDeafenGeneration && this.#fakeDeafenStatus.phase !== "attention");
            // Ownership failure removes the old controller's patch. A deliberate
            // click may load a fresh adapter; background checks never re-arm it.
            if (this.#fakeDeafen && !this.#fakeDeafen.validateOwnership()) {
                this.#stopFakeDeafen();
                if (this.#fakeDeafen) {
                    Toasts.error(this.#fakeDeafenStatus.detail, {forceShow: true});
                    return false; // Cleanup ownership was retained.
                }
            }
            if (!SolcordSettings.snapshot().powerLab["fake-deafen"].enabled) {
                const change = this.setPowerExperiment("fake-deafen", true, true);
                const generation = this.#fakeDeafenGeneration;
                const accepted = await change;
                if (wasCancelled(generation)) return false;
                if (!accepted) {
                    Toasts.error(this.#fakeDeafenStatus.detail, {forceShow: true});
                    return false;
                }
            }
            if (!this.#fakeDeafen) {
                const synchronization = this.#synchronizePowerLab();
                const generation = this.#fakeDeafenGeneration;
                await synchronization;
                if (wasCancelled(generation)) return false;
            }
            const controller = this.#fakeDeafen;
            let toggled = controller?.toggleDirect() === true;
            if (toggled && controller?.snapshot().pending) toggled = await controller.waitForActivation();
            if (controller !== this.#fakeDeafen) return false;
            if (toggled && controller && !controller.validateOwnership()) toggled = false;
            this.#fakeDeafenStatus = controller?.snapshot() ?? this.#fakeDeafenStatus;
            this.#fakeDeafenButton?.update(this.#fakeDeafenStatus);
            this.emitChange();
            if (toggled && this.#fakeDeafenStatus.armed && this.#fakeDeafenIndicatorReady) Toasts.success("Fake Deafen is on. Click the adjacent control again to restore normal deafen state.", {timeout: 4_000});
            else if (toggled && this.#fakeDeafenStatus.armed) Toasts.info("Fake Deafen is active, but its voice-row indicator is not available yet. Check the Voice workspace for its current state.", {timeout: 4_000});
            else if (toggled) Toasts.info("Fake Deafen is off and Discord's normal voice state is restored.", {timeout: 4_000});
            else Toasts.error(this.#fakeDeafenStatus.detail, {forceShow: true});
            return toggled;
        }
        catch {
            this.#stopFakeDeafen();
            if (this.#fakeDeafenStatus.phase !== "attention") {
                this.#fakeDeafenStatus = {...this.#fakeDeafenStatus, phase: "attention", detail: "Fake Deafen could not apply the native voice action. Its adapter was stopped; click again to retry.", armed: false, pending: false};
            }
            this.#fakeDeafenButton?.update(this.#fakeDeafenStatus);
            this.emitChange();
            Toasts.error(this.#fakeDeafenStatus.detail, {forceShow: true});
            return false;
        }
    }

    #applyProductPresentation(): void {
        const preferences = SolcordSettings.snapshot().productPreferences;
        const appearance = preferences.appearance;
        const root = document.documentElement;
        root.dataset.solcordMode = appearance.mode;
        root.dataset.solcordAccent = appearance.accent;
        root.dataset.solcordDensity = appearance.density;
        root.dataset.solcordMotion = appearance.motion;
        root.dataset.solcordMessageShape = appearance.messageShape;
        root.dataset.solcordPerformance = preferences.performanceProfile;
        const reducedByOs = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
        const policy = resolveSolcordPerformancePolicy(preferences.performanceProfile, appearance.motion, reducedByOs);
        root.dataset.solcordEffectiveMotion = policy.effectiveMotion;
        root.dataset.solcordAmbientMotion = String(policy.ambientEffects);
    }

    #synchronizeBaselineSuite(): void {
        const preferences = SolcordSettings.snapshot().productPreferences.baseline;
        if (!this.#started || this.#recoveryMode) {
            this.#baselineSuite?.stop();
            this.#baselineSuite = undefined;
            return;
        }
        if (this.#baselineSuite?.matchesPreferences(preferences)) return;
        const enabled = preferences.layoutCollapse
            || preferences.embedControls
            || preferences.crossPlatformAutoscroll
            || preferences.messageLinkPreview;
        this.#baselineSuite?.stop();
        this.#baselineSuite = undefined;
        if (!enabled) return;
        let messageStore: {getMessage?: (channelId: string, messageId: string) => {id?: string; content?: string; author?: {globalName?: string; username?: string;}; timestamp?: string | number | Date;};} | undefined;
        if (preferences.messageLinkPreview) messageStore = getStore("MessageStore") as typeof messageStore;
        const adapter = typeof messageStore?.getMessage === "function"
            ? {getLoadedMessage: (channelId: string, messageId: string) => messageStore.getMessage?.(channelId, messageId)}
            : {};
        this.#baselineSuite = new SolcordBaselineSuite(adapter);
        this.#baselineSuite.start(preferences);
    }

    #synchronizeMotion(): void {
        if (!this.#started || this.#recoveryMode) return;
        if (!this.#nativeSuite) {
            this.#synchronizeCuratedAdapters();
            return;
        }
        const {productPreferences: preferences, curatedAddons: curated} = SolcordSettings.snapshot();
        const motionRequested = preferences.nativeSuite.motion.effect !== "off";
        const canRun = (name: "BetterAnimations" | "DiscordEffects") => !PluginDoctor.isQuarantined(solcordBuiltInDoctorId(name))
            && !this.#communityAddonEnabled(name)
            && ((name === "DiscordEffects" && motionRequested) || (curated[name]?.enabled === true && isSolcordBuiltInAddon(name, curated[name]?.mode)));
        const providers = {BetterAnimations: canRun("BetterAnimations"), DiscordEffects: canRun("DiscordEffects")};
        const policy = resolveSolcordPerformancePolicy(preferences.performanceProfile, preferences.appearance.motion, globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true);
        this.#curatedSynchronizationError = undefined;
        this.#nativeSuite.configureMotion(preferences.nativeSuite.motion, {effectiveMotion: policy.effectiveMotion, ambientEffects: policy.ambientEffects}, providers);
        const detail = this.#nativeSuite.statuses().find(status => status.id === "motion-studio")?.detail;
        for (const name of ["BetterAnimations", "DiscordEffects"] as const) {
            if (this.#communityAddonEnabled(name)) continue;
            const enabled = providers[name] && this.#nativeSuite.providerReady(name);
            this.#curatedAdapterResults[name] = {
                enabled,
                ready: enabled,
                provider: enabled ? "solcord" : "off",
                reason: PluginDoctor.isQuarantined(solcordBuiltInDoctorId(name))
                    ? "Plugin Doctor is holding this feature until an explicit retry succeeds."
                    : detail
            };
        }
        this.emitChange();
    }

    async clearFriendWatch(): Promise<boolean> {
        const {identity} = this.#observeFriendWatchIdentity();
        if (!identity.accountId) return false;
        const identityIsCurrent = () => this.#friendWatchIdentityIsCurrent(identity);
        try {
            const result = await this.#withTimelineAccount(identity.accountId, capability => TIMELINE_IPC.friendClear(capability, {retentionDays: SolcordSettings.snapshot().productPreferences.friendWatch.retentionDays}), identityIsCurrent) as {complete?: boolean; persistent?: boolean;};
            if (result.complete !== true || !identityIsCurrent()) return false;
            this.#friendWatch.clear();
            this.#friendWatchPersistent = result.persistent === true;
            this.#setHealth("friend-watch", {detail: "This account's Friend Watch history is empty. The relationship snapshot remains subscribed until the feature is disabled."});
            this.emitChange();
            return true;
        }
        catch {return false;}
    }

    async exportFriendWatch(format: "json" | "csv"): Promise<boolean> {
        const {identity} = this.#observeFriendWatchIdentity();
        if (!identity.accountId || !globalThis.crypto?.subtle) return false;
        const identityIsCurrent = () => this.#friendWatchIdentityIsCurrent(identity);
        const events = this.#friendWatch.snapshot();
        const scoped = await Promise.all(events.map(async event => {
            const subjectKey = event.transition === "reconciled" ? "" : event.subjectKey ?? [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${identity.accountId}:${event.subjectId}`)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
            const {subjectId: _subjectId, subjectKey: _subjectKey, displayLabel: _displayLabel, ...safe} = event;
            return {...safe, subjectKey};
        }));
        if (!identityIsCurrent()) return false;
        if (format === "csv") {
            const quote = (value: unknown) => `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
            const rows = ["observedAt,subjectKey,transition,label,source,confidence", ...scoped.map(event => [event.observedAt, event.subjectKey, event.transition, event.label, event.source, event.confidence].map(quote).join(","))];
            this.#download(`solcord-friend-watch-${new Date().toISOString().slice(0, 10)}.csv`, `${rows.join("\n")}\n`, "text/csv");
        }
        else {this.#download(`solcord-friend-watch-${new Date().toISOString().slice(0, 10)}.json`, `${JSON.stringify({format: "solcord-friend-watch", version: 1, exportedAt: new Date().toISOString(), limitations: ["Observed relationship-store transitions only", "No cause guess for relationship loss", "No extra Discord requests"], events: scoped}, null, 2)}\n`, "application/json");}
        return identityIsCurrent();
    }

    async exportTimeline(): Promise<TimelineExportOutcome> {
        if (this.#flushTimelinePersistence) await this.#flushTimelinePersistence();
        if (this.#timelineUnpersisted) return {status: "incomplete", omittedSegments: 1, unreadableSegments: 0, retentionApplied: false};
        const identity = this.#captureTimelineIdentity();
        if (!identity.accountId) return {status: "unavailable", omittedSegments: 0, unreadableSegments: 0, retentionApplied: false};
        if (this.#timelineIncompleteAccounts.has(identity.accountId)) return {status: "incomplete", omittedSegments: 1, unreadableSegments: 0, retentionApplied: false};
        const identityIsCurrent = () => this.#timelineIdentityIsCurrent(identity);
        const policy = SolcordSettings.snapshot().timelinePolicy;
        let loaded: TimelineReadOutcome;
        try {
            const raw = await this.#withTimelineAccount(identity.accountId, capability => TIMELINE_IPC.read(capability, {policy}), identityIsCurrent);
            loaded = normalizeTimelineReadOutcome(raw);
        }
        catch {return {status: "unavailable", omittedSegments: 0, unreadableSegments: 0, retentionApplied: false};}
        if (!identityIsCurrent()) return {status: "unavailable", omittedSegments: 0, unreadableSegments: 0, retentionApplied: false};
        if (loaded.status !== "complete") {
            this.#setHealth("message-timeline", {maturity: "preview", detail: `Export refused because the local read was incomplete (${loaded.omittedSegments} omitted, ${loaded.unreadableSegments} unreadable; retention ${loaded.retentionApplied ? "applied" : "incomplete"}).`});
            return loaded;
        }
        const payload = {
            format: "solcord-private-message-timeline",
            version: 1,
            exportedAt: new Date().toISOString(),
            scope: policy.scope,
            retention: policy.retention,
            content: policy.content,
            persistent: loaded.persistent === true,
            complete: true,
            truncated: false,
            omittedSegments: 0,
            unreadableSegments: 0,
            retentionApplied: true,
            limitations: ["Observed by this running client only", "No API backfill", "No offline recovery", "No hidden-channel access"],
            events: loaded.events
        };
        if (!identityIsCurrent()) return {status: "unavailable", omittedSegments: 0, unreadableSegments: 0, retentionApplied: false};
        this.#download(`solcord-timeline-${new Date().toISOString().slice(0, 10)}.json`, `${JSON.stringify(payload, null, 2)}\n`, "application/json");
        return loaded;
    }

    previewSetup(rawDraft: unknown): string[] {
        return SolcordSettings.previewSetup(rawDraft);
    }

    #setupAcceptsAddon(name: string, mode: string | undefined): boolean {
        return resolveSolcordSetupPlan([name], {[name]: mode}).executableAddons.includes(name);
    }

    #providerMigrationCandidates(draft: ReturnType<typeof normalizeSetupDraft>) {
        return SOLCORD_RUNTIME_ADDONS.filter(candidate => this.#setupAcceptsAddon(candidate.name, draft.addonModes[candidate.name]));
    }

    prepareProviderMigrationPlan(rawDraft: unknown): SolcordProviderMigrationPlan | undefined {
        const draft = normalizeSetupDraft(rawDraft);
        return createSolcordProviderMigrationPlan(PluginManager, this.#providerMigrationCandidates(draft), draft);
    }

    #requireProviderMigrationPlan(rawDraft: unknown, confirmedPlan: unknown): readonly SolcordProviderMigrationIdentity[] {
        const draft = normalizeSetupDraft(rawDraft);
        const confirmed = canonicalizeSolcordProviderMigrationPlan(confirmedPlan);
        const current = createSolcordProviderMigrationPlan(PluginManager, this.#providerMigrationCandidates(draft), draft);
        if (!confirmed || !current || !solcordProviderMigrationPlansMatch(confirmed, current)) throw new Error("SetupProviderMigrationConfirmationChanged");
        return confirmed.entries;
    }

    #assertProviderMigrationIdentityCurrent(entry: SolcordProviderMigrationIdentity, draft: ReturnType<typeof normalizeSetupDraft>): void {
        const standaloneFileName = solcordStandaloneProviderFileName(entry.name);
        if (standaloneFileName) {
            const current = resolveCommunityAddon(PluginManager, entry.name, standaloneFileName);
            if (!current
                || current.filename !== entry.fileName
                || (PluginManager.isEnabled(current.filename) === true) !== entry.enabled
                || (entry.name === "MessageLoggerV2" && entry.enabled && !draft.timelinePolicy.enabled)
                || (entry.name === "FakeDeafen" && entry.enabled)) throw new Error("SetupProviderMigrationConfirmationChanged");
            return;
        }
        const candidate = SOLCORD_RUNTIME_ADDONS.find(item => item.name === entry.name);
        const current = candidate ? resolveCommunityAddon(PluginManager, candidate.name, candidate.fileName) : undefined;
        if (!candidate
            || !draft.selectedAddons.includes(candidate.name)
            || !isSolcordBuiltInAddon(candidate.name, draft.addonModes[candidate.name])
            || draft.addonProviders[candidate.name] !== entry.provider
            || !current
            || current.filename !== entry.fileName
            || (PluginManager.isEnabled(current.filename) === true) !== entry.enabled) throw new Error("SetupProviderMigrationConfirmationChanged");
    }

    async finishSetup(rawDraft: unknown, confirmedProviderMigrationPlan: unknown, options: {migrateProviders?: boolean;} = {}): Promise<{transactionId: string; enabled: string[]; quarantined: Array<{name: string; reason: string;}>; providerConflicts: Array<{name: string; fileName: string;}>;}> {
        const draft = normalizeSetupDraft(rawDraft);
        const migrateProviders = options.migrateProviders !== false;
        let providerMigrations = migrateProviders ? this.#requireProviderMigrationPlan(draft, confirmedProviderMigrationPlan) : [];
        await this.#refreshAddonIntegrity("pre-setup");
        const plan = resolveSolcordSetupPlan(draft.selectedAddons, draft.addonModes);
        const executableAddons = new Set(plan.executableAddons);
        const stagedAddons = plan.executableAddons.filter(name => !isSolcordBuiltInAddon(name, draft.addonModes[name]));
        const selectedCandidates = stagedAddons.map(name => SOLCORD_RUNTIME_ADDONS.find(candidate => candidate.name === name)!);
        const requiredDependencies = new Set(selectedCandidates.flatMap(candidate => [...candidate.dependencies]));
        const priorAddonStates = captureExactAddonStates(PluginManager);
        const priorThemeStates = captureExactAddonStates(ThemeManager);
        this.#refreshReviewedExecutionOwnership([...stagedAddons, ...requiredDependencies], true);
        providerMigrations = migrateProviders ? this.#requireProviderMigrationPlan(draft, confirmedProviderMigrationPlan) : [];
        let transaction: {transactionId: string;};
        try {
            transaction = await this.#withPrivateCapability(capability => TIMELINE_IPC.applySetup(capability, {selectedAddons: stagedAddons, selectedTheme: draft.selectedTheme})) as {transactionId: string;};
        }
        catch (error) {
            this.#refreshReviewedExecutionOwnership();
            throw error;
        }
        const results: Record<string, {enabled: boolean; reviewedSha256?: string; quarantineReason?: string;}> = {};
        const enabled: string[] = [];
        const quarantined: Array<{name: string; reason: string;}> = [];
        const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
        let settingsRecorded = false;
        let providerArchiveTransactionId: string | undefined;
        let providerArchiveFiles: string[] = [];

        try {
            const integrity = await this.#refreshAddonIntegrity("post-setup");
            const selectedTheme = SOLCORD_THEMES.find(theme => theme.id === draft.selectedTheme)!;
            const requiredRecords = [
                ...selectedCandidates.map(candidate => integrity.find(record => record.kind === "addon" && record.name === candidate.name)),
                ...[...requiredDependencies].map(name => integrity.find(record => record.kind === "dependency" && record.name === name)),
                integrity.find(record => record.kind === "theme" && record.name === selectedTheme.name)
            ];
            if (requiredRecords.some(record => record?.status !== "match")) throw new Error("SetupIntegrityValidationFailed");

            for (const name of plan.executableAddons) {
                const candidate = SOLCORD_RUNTIME_ADDONS.find(entry => entry.name === name)!;
                if (isSolcordBuiltInAddon(name, draft.addonModes[name])) continue;
                if (reducedMotion && (name === "DiscordEffects" || name === "BetterAnimations")) {
                    const reason = "Held because Windows or Discord reduced motion is active.";
                    results[name] = {enabled: false, reviewedSha256: candidate.sourceSha256, quarantineReason: reason};
                    quarantined.push({name, reason});
                    continue;
                }
                if (PluginDoctor.isQuarantined(name)) {
                    const reason = "Plugin Doctor quarantine requires an explicit successful retry before setup can enable this addon.";
                    results[name] = {enabled: false, reviewedSha256: candidate.sourceSha256, quarantineReason: reason};
                    quarantined.push({name, reason});
                    continue;
                }
                if (!await this.#waitForAddon(PluginManager, candidate.fileName)) {
                    const reason = "The verified file did not load before the bounded setup deadline.";
                    PluginDoctor.quarantine(name, reason);
                    results[name] = {enabled: false, reviewedSha256: candidate.sourceSha256, quarantineReason: reason};
                    quarantined.push({name, reason});
                    continue;
                }
                if (PluginManager.isEnabled(candidate.fileName)) PluginManager.disableAddon(candidate.fileName);
                const started = PluginManager.enableAddon(candidate.fileName) === true || PluginManager.isEnabled(candidate.fileName);
                await new Promise(resolve => globalThis.setTimeout(resolve, 150));
                if (!started || PluginDoctor.isQuarantined(name) || !PluginManager.isEnabled(candidate.fileName)) {
                    const reason = "Startup validation failed; the addon was disabled and quarantined.";
                    if (PluginManager.isEnabled(candidate.fileName)) PluginManager.disableAddon(candidate.fileName);
                    PluginDoctor.quarantine(name, reason);
                    results[name] = {enabled: false, reviewedSha256: candidate.sourceSha256, quarantineReason: reason};
                    quarantined.push({name, reason});
                    continue;
                }
                results[name] = {enabled: true, reviewedSha256: candidate.sourceSha256};
                enabled.push(name);
            }

            for (const theme of SOLCORD_THEMES) {
                if (theme.fileName !== selectedTheme.fileName && ThemeManager.isEnabled(theme.fileName)) ThemeManager.disableAddon(theme.fileName);
            }
            if (!await this.#waitForAddon(ThemeManager, selectedTheme.fileName)) throw new Error("SelectedThemeLoadTimeout");
            if (!ThemeManager.isEnabled(selectedTheme.fileName) && ThemeManager.enableAddon(selectedTheme.fileName) !== true && !ThemeManager.isEnabled(selectedTheme.fileName)) throw new Error("SelectedThemeStartFailed");

            providerMigrations = migrateProviders ? this.#requireProviderMigrationPlan(draft, confirmedProviderMigrationPlan) : [];
            const timelineReplacementReady = this.#health.get("message-timeline")?.status === "active";
            for (const migration of providerMigrations) {
                this.#assertProviderMigrationIdentityCurrent(migration, draft);
                if (migration.name === "MessageLoggerV2" && migration.enabled && !timelineReplacementReady) continue;
                const candidate = SOLCORD_RUNTIME_ADDONS.find(entry => entry.name === migration.name);
                const standaloneFileName = solcordStandaloneProviderFileName(migration.name);
                const current = candidate
                    ? resolveCommunityAddon(PluginManager, candidate.name, candidate.fileName)
                    : standaloneFileName
                        ? resolveCommunityAddon(PluginManager, migration.name, standaloneFileName)
                        : undefined;
                if (!current || current.filename !== migration.fileName) throw new Error("SetupCommunityCounterpartChanged");
                if (!PluginManager.isEnabled(current.filename)) continue;
                PluginManager.disableAddon(current.filename);
                if (PluginManager.isEnabled(current.filename)) throw new Error("SetupCommunityCounterpartStopFailed");
            }

            const existingCurated = SolcordSettings.snapshot().curatedAddons;
            const requestedCurated = Object.fromEntries(Object.entries(existingCurated).map(([name, state]) => [name, {
                ...state,
                enabled: executableAddons.has(name),
                mode: draft.addonModes[name] ?? state.mode,
                provider: draft.addonProviders[name] ?? state.provider
            }])) as Record<string, SolcordCuratedAddonState>;
            const adapterResults = this.#synchronizeCuratedAdapters(requestedCurated);
            const providerConflicts = providerMigrations.filter(migration => adapterResults[migration.name]?.conflict);
            for (const name of plan.executableAddons.filter(entry => isSolcordBuiltInAddon(entry, draft.addonModes[entry]))) {
                const adapter = adapterResults[name];
                if (adapter?.enabled) {
                    results[name] = {enabled: true};
                    enabled.push(name);
                    continue;
                }
                const reason = adapter?.reason ?? "The Solcord adapter failed its runtime validation and stayed off.";
                PluginDoctor.recordCapabilityMiss(solcordBuiltInDoctorId(name));
                results[name] = {enabled: false};
                Logger.warn("Solcord", `${name} remains selected but unavailable on this Discord build (${reason})`);
            }

            const replacementFiles = new Set(SOLCORD_V2_REPLACEMENT_MANIFEST.entries.map(entry => entry.fileName));
            const replacementReadyFiles = providerMigrations
                .filter(migration => replacementFiles.has(migration.fileName) && solcordProviderReplacementIsReady(migration, adapterResults[migration.name], draft.timelinePolicy.enabled, timelineReplacementReady))
                .map(migration => migration.fileName);
            if (migrateProviders && resolveCommunityAddon(PluginManager, "BDFDB", "0BDFDB.plugin.js")) replacementReadyFiles.push("0BDFDB.plugin.js");
            if (replacementReadyFiles.length) {
                const retainedBdfdbConsumers = PluginManager.addonList
                    .filter(addon => !replacementFiles.has(addon.filename))
                    .map(addon => addon.filename.length <= 120 ? addon.filename : "Unreviewed external plugin")
                    .slice(0, 128);
                const preview = await this.#withPrivateCapability(capability => TIMELINE_IPC.previewProviderArchive(capability, {replacementReadyFiles, retainedBdfdbConsumers})) as {previewId?: unknown; records?: unknown[];};
                if (typeof preview.previewId !== "string" || !Array.isArray(preview.records)) throw new Error("ProviderArchivePreviewInvalid");
                if (preview.records.length) {
                    const previewId = preview.previewId;
                    const archived = await this.#withPrivateCapability(capability => TIMELINE_IPC.applyProviderArchive(capability, previewId)) as {transactionId?: unknown; archived?: unknown;};
                    if (typeof archived.transactionId !== "string") throw new Error("ProviderArchiveApplyInvalid");
                    providerArchiveTransactionId = archived.transactionId;
                    const archivedRecords = solcordV2ArchiveReceiptMatchesPreview(archived.archived, preview.records);
                    providerArchiveFiles = archivedRecords.map(record => record.fileName);
                }
            }

            SolcordSettings.completeSetup(draft, results, {id: transaction.transactionId, priorAddonStates, priorThemeStates, providerArchiveTransactionId});
            settingsRecorded = true;
            await this.#withPrivateCapability(capability => TIMELINE_IPC.acknowledgeSetup(capability, transaction.transactionId));
            this.#refreshReviewedExecutionOwnership();
            await this.#synchronizeFeatures();
            for (const quarantineId of solcordV2QuarantineIdsForArchivedFiles(providerArchiveFiles)) PluginDoctor.clearQuarantine(quarantineId);
            if (providerArchiveFiles.length) this.emitChange();
            return {transactionId: transaction.transactionId, enabled, quarantined, providerConflicts};
        }
        catch (error) {
            const settingsRestored = !settingsRecorded || SolcordSettings.abortSetupCompletion(transaction.transactionId);
            this.#refreshReviewedExecutionOwnership();
            let providerArchiveRestored = true;
            if (providerArchiveTransactionId) {
                try {
                    const restored = await this.#withPrivateCapability(capability => TIMELINE_IPC.rollbackProviderArchive(capability, providerArchiveTransactionId!)) as {complete?: boolean;};
                    providerArchiveRestored = restored.complete === true;
                }
                catch {providerArchiveRestored = false;}
            }
            const statesRestored = await this.#restoreAddonStates(priorAddonStates, priorThemeStates);
            this.#synchronizeCuratedAdapters();
            const rollback = await this.#withPrivateCapability(capability => TIMELINE_IPC.rollbackSetup(capability, transaction.transactionId));
            if (normalizeSetupRollbackOutcome(rollback, statesRestored && settingsRestored && providerArchiveRestored).status !== "complete") throw new Error("SetupFailedRollbackIncomplete");
            throw error;
        }
    }

    async rollbackLatestSetup(): Promise<SetupRollbackOutcome> {
        await this.#refreshAddonIntegrity("pre-rollback");
        const transaction = SolcordSettings.latestSetupTransaction();
        if (!transaction) return {status: "unavailable", removed: 0, preserved: 0};
        let providerArchiveRestored = true;
        if (transaction.providerArchiveTransactionId) {
            try {
                const restored = await this.#withPrivateCapability(capability => TIMELINE_IPC.rollbackProviderArchive(capability, transaction.providerArchiveTransactionId!)) as {complete?: boolean;};
                providerArchiveRestored = restored.complete === true;
            }
            catch {providerArchiveRestored = false;}
        }
        const statesRestored = await this.#restoreAddonStates(transaction.priorAddonStates, transaction.priorThemeStates);
        let rollback: unknown;
        try {rollback = await this.#withPrivateCapability(capability => TIMELINE_IPC.rollbackSetup(capability, transaction.id));}
        catch {return {status: "failed", removed: 0, preserved: 0};}
        const outcome = normalizeSetupRollbackOutcome(rollback, statesRestored && providerArchiveRestored);
        if (outcome.status === "failed") return outcome;
        if (!SolcordSettings.abortSetupCompletion(transaction.id)) return {...outcome, status: "failed"};
        this.#refreshReviewedExecutionOwnership();
        await this.#synchronizeFeatures();
        return outcome;
    }

    async setCuratedAddonEnabled(name: string, enabled: boolean): Promise<boolean> {
        const candidate = SOLCORD_RUNTIME_ADDONS.find(entry => entry.name === name);
        if (!candidate) return false;
        const integrity = await this.#refreshAddonIntegrity("toggle");
        const integrityRecord = integrity.find(record => record.kind === "addon" && record.name === name);
        const state = SolcordSettings.snapshot().curatedAddons[name];
        const guardedBuiltIn = isSolcordBuiltInAddon(name, state?.mode);
        const setupExecutable = this.#setupAcceptsAddon(name, state?.mode);
        const communityAddonPresent = Boolean(resolveCommunityAddon(PluginManager, candidate.name, candidate.fileName));
        const guardedCanRunIndependently = guardedBuiltIn && !this.#communityAddonEnabled(name);
        const dependenciesVerified = candidate.dependencies.every(dependencyName => integrity.some(record => record.kind === "dependency" && record.name === dependencyName && record.status === "match"));
        const doctorId = guardedBuiltIn ? solcordBuiltInDoctorId(name) : name;
        if (enabled && guardedCanRunIndependently) {
            // The old unprefixed key is safe to migrate only when it cannot
            // belong to an installed community file with the same product id.
            if (!communityAddonPresent) PluginDoctor.clearLegacyCapabilityMissQuarantine(name);
            PluginDoctor.clearLegacyCapabilityMissQuarantine(doctorId);
        }
        if (enabled && guardedBuiltIn && !setupExecutable) return false;
        if (enabled && reviewBlocksEnable(candidate, guardedBuiltIn)) return false;
        if (enabled && ((!guardedCanRunIndependently && (integrityRecord?.status !== "match" || !dependenciesVerified)) || PluginDoctor.isQuarantined(doctorId))) return false;
        if (guardedBuiltIn) {
            SolcordSettings.setCuratedAddonEnabled(name, enabled);
            this.#refreshReviewedExecutionOwnership();
            this.#applyProductPresentation();
            if (name === "BetterAnimations" || name === "DiscordEffects") this.#synchronizeMotion();
            else this.#synchronizeCuratedAdapters();
            const result = this.#curatedAdapterResults[name];
            if (!enabled || result?.enabled) return true;
            const reason = result?.reason ?? "The Solcord adapter failed its runtime validation and stayed off.";
            PluginDoctor.recordCapabilityMiss(doctorId);
            Logger.warn("Solcord", `${name} remains selected but unavailable on this Discord build (${reason})`);
            return true;
        }
        if (!PluginManager.isLoaded(candidate.fileName)) return false;
        const succeeded = enabled
            ? PluginManager.enableAddon(candidate.fileName) === true || PluginManager.isEnabled(candidate.fileName)
            : PluginManager.disableAddon(candidate.fileName) === true || !PluginManager.isEnabled(candidate.fileName);
        SolcordSettings.setCuratedAddonEnabled(name, succeeded ? enabled : false, succeeded ? undefined : "Runtime toggle failed; Plugin Doctor kept the addon off.");
        this.#refreshReviewedExecutionOwnership();
        if (succeeded && enabled) PluginDoctor.recordSuccessfulStart(name);
        return succeeded;
    }

    async retryQuarantinedAddon(addonId: string): Promise<boolean> {
        const integrity = await this.#refreshAddonIntegrity("retry");
        const candidate = SOLCORD_RUNTIME_ADDONS.find(entry => entry.name === addonId || entry.fileName === addonId);
        const dependency = SOLCORD_RUNTIME_DEPENDENCIES.find(entry => entry.name === addonId || entry.fileName === addonId);
        if (candidate || dependency) {
            const kind: AddonIntegrityKind = candidate ? "addon" : "dependency";
            const name = (candidate ?? dependency)!.name;
            const record = integrity.find(entry => entry.kind === kind && entry.name === name);
            const state = candidate ? SolcordSettings.snapshot().curatedAddons[candidate.name] : undefined;
            const guardedBuiltIn = Boolean(candidate && isSolcordBuiltInAddon(candidate.name, state?.mode));
            const setupExecutable = Boolean(candidate && this.#setupAcceptsAddon(candidate.name, state?.mode));
            const guardedWithoutCommunityFile = guardedBuiltIn && record?.status === "missing";
            const dependenciesVerified = !candidate || candidate.dependencies.every(dependencyName => integrity.some(entry => entry.kind === "dependency" && entry.name === dependencyName && entry.status === "match"));
            if (candidate && guardedBuiltIn && !setupExecutable) return false;
            if (candidate && reviewBlocksEnable(candidate, guardedBuiltIn)) return false;
            if (dependency && reviewBlocksEnable(dependency)) return false;
            if (!guardedWithoutCommunityFile && (record?.status !== "match" || !dependenciesVerified)) return false;
            const reviewed = candidate ?? dependency!;
            const clearedName = PluginDoctor.clearQuarantine(name);
            const clearedFile = PluginDoctor.clearQuarantine(reviewed.fileName);
            if (!clearedName && !clearedFile) return false;
            const succeeded = candidate
                ? await this.setCuratedAddonEnabled(candidate.name, true)
                : PluginManager.isLoaded(dependency!.fileName) && (PluginManager.enableAddon(dependency!.fileName) === true || PluginManager.isEnabled(dependency!.fileName));
            if (succeeded) PluginDoctor.recordSuccessfulStart(name);
            else PluginDoctor.quarantine(name, "Manual retry failed; the addon remains disabled.");
            return succeeded;
        }

        const addon = PluginManager.resolveAddon(addonId);
        if (!addon || !PluginDoctor.clearQuarantine(addonId)) return false;
        const succeeded = PluginManager.enableAddon(addon.filename) === true || PluginManager.isEnabled(addon.filename);
        if (succeeded) PluginDoctor.recordSuccessfulStart(addonId);
        else PluginDoctor.quarantine(addonId, "Manual retry failed; the addon remains disabled.");
        return succeeded;
    }

    async setEnabled(id: SolcordModuleId, enabled: boolean): Promise<void> {
        if (SolcordSettings.module(id).enabled === enabled) return;
        SolcordSettings.setEnabled(id, enabled);
        if (SolcordSettings.module(id).enabled !== enabled) return;
        if (!this.#started || (this.#recoveryMode && id !== "plugin-doctor")) return;
        if (enabled) await this.#startFeature(id);
        else this.#stopFeature(id);
    }

    async setValue(id: SolcordModuleId, key: string, value: unknown): Promise<void> {
        const previous = SolcordSettings.module(id);
        await SolcordSettings.setValueAsync(id, key, value);
        const next = SolcordSettings.module(id);
        if (!this.#started || !next.enabled || (this.#recoveryMode && id !== "plugin-doctor") || JSON.stringify(previous) === JSON.stringify(next)) return;
        this.#stopFeature(id);
        await this.#startFeature(id);
    }

    saveProfile(name: string, includeThirdPartyAddons = false) {
        const plugins = includeThirdPartyAddons ? this.#enabledAddonFiles(PluginManager) : [];
        const themes = includeThirdPartyAddons ? this.#enabledAddonFiles(ThemeManager) : [];
        return SolcordSettings.saveProfile(name, plugins, themes);
    }

    previewProfile(profileId: string): string[] {
        const profile = SolcordSettings.profile(profileId);
        if (!profile) return [];
        const changes = SolcordSettings.previewProfile(profileId);
        if (!profile.includesThirdPartyAddons) return changes;
        const desiredPlugins = new Set(profile.selectedPlugins);
        const desiredThemes = new Set(profile.selectedThemes);
        for (const addon of PluginManager.addonList) {
            const desired = desiredPlugins.has(addon.filename);
            if (PluginManager.isEnabled(addon.filename) !== desired) changes.push(`plugin ${addon.filename}: ${desired ? "enable" : "disable"}`);
        }
        for (const theme of ThemeManager.addonList) {
            const desired = desiredThemes.has(theme.filename);
            if (ThemeManager.isEnabled(theme.filename) !== desired) changes.push(`theme ${theme.filename}: ${desired ? "enable" : "disable"}`);
        }
        return changes;
    }

    profileAddonExecutionPlan(profileId: string): ProfileAddonExecutionPlan | undefined {
        const profile = SolcordSettings.profile(profileId);
        if (!profile?.includesThirdPartyAddons) return;
        const desiredPlugins = new Set(profile.selectedPlugins);
        const desiredThemes = new Set(profile.selectedThemes);
        const plan: ProfileAddonExecutionPlan = {enablePlugins: [], disablePlugins: [], enableThemes: [], disableThemes: []};
        for (const addon of PluginManager.addonList) {
            const enabled = PluginManager.isEnabled(addon.filename);
            if (desiredPlugins.has(addon.filename) && !enabled) plan.enablePlugins.push(addon.filename);
            else if (!desiredPlugins.has(addon.filename) && enabled) plan.disablePlugins.push(addon.filename);
        }
        for (const theme of ThemeManager.addonList) {
            const enabled = ThemeManager.isEnabled(theme.filename);
            if (desiredThemes.has(theme.filename) && !enabled) plan.enableThemes.push(theme.filename);
            else if (!desiredThemes.has(theme.filename) && enabled) plan.disableThemes.push(theme.filename);
        }
        for (const values of Object.values(plan) as string[][]) values.sort((left: string, right: string) => left.localeCompare(right));
        return plan;
    }

    async applyProfile(profileId: string, confirmedPlan?: ProfileAddonExecutionPlan): Promise<boolean> {
        await this.#refreshAddonIntegrity("toggle");
        const profile = SolcordSettings.profile(profileId);
        if (!profile) return false;
        if (profile.includesThirdPartyAddons) {
            const currentPlan = this.profileAddonExecutionPlan(profileId);
            const matchesConfirmation = currentPlan && confirmedPlan && (Object.keys(currentPlan) as Array<keyof ProfileAddonExecutionPlan>).every(key =>
                currentPlan[key].length === confirmedPlan[key].length && currentPlan[key].every((fileName, index) => fileName === confirmedPlan[key][index])
            );
            if (!matchesConfirmation) return false;
        }
        const pluginStates = Object.fromEntries(PluginManager.addonList.map(addon => [addon.filename, PluginManager.isEnabled(addon.filename)]));
        const themeStates = Object.fromEntries(ThemeManager.addonList.map(addon => [addon.filename, ThemeManager.isEnabled(addon.filename)]));
        const snapshot = SolcordSettings.capture(`Before applying ${profile.name}`, {
            plugins: Object.entries(pluginStates).filter(([, enabled]) => enabled).map(([fileName]) => fileName),
            themes: Object.entries(themeStates).filter(([, enabled]) => enabled).map(([fileName]) => fileName)
        });
        if (!SolcordSettings.applyProfile(profileId, false)) return false;
        try {
            if (profile.includesThirdPartyAddons) {
                await this.#applyAddonSelection(PluginManager, new Set(profile.selectedPlugins));
                await this.#applyAddonSelection(ThemeManager, new Set(profile.selectedThemes));
            }
            await this.#synchronizeFeatures();
            return true;
        }
        catch {
            await this.#restoreCompleteAddonStates(PluginManager, pluginStates);
            await this.#restoreCompleteAddonStates(ThemeManager, themeStates);
            SolcordSettings.rollback(snapshot.id);
            await this.#synchronizeFeatures();
            return false;
        }
    }

    async rollback(snapshotId: string): Promise<boolean> {
        const snapshot = SolcordSettings.snapshotById(snapshotId);
        const rolledBack = SolcordSettings.rollback(snapshotId);
        if (!rolledBack) return false;
        this.#refreshReviewedExecutionOwnership();
        let addonsRestored = true;
        if (snapshot?.activePlugins) {
            const active = new Set(snapshot.activePlugins);
            addonsRestored = await this.#restoreCompleteAddonStates(PluginManager, Object.fromEntries(PluginManager.addonList.map(addon => [addon.filename, active.has(addon.filename)]))) && addonsRestored;
        }
        if (snapshot?.activeThemes) {
            const active = new Set(snapshot.activeThemes);
            addonsRestored = await this.#restoreCompleteAddonStates(ThemeManager, Object.fromEntries(ThemeManager.addonList.map(addon => [addon.filename, active.has(addon.filename)]))) && addonsRestored;
        }
        await this.#synchronizeFeatures();
        return addonsRestored;
    }

    previewSettingsImport(text: string): SolcordImportPreview | undefined {
        return SolcordSettings.previewImport(text);
    }

    async importSettings(text: string, expectedFingerprint: string): Promise<boolean> {
        if (!SolcordSettings.importDocument(text, expectedFingerprint)) return false;
        this.#refreshReviewedExecutionOwnership();
        await this.#synchronizeFeatures();
        return true;
    }

    async leaveRecoveryMode(): Promise<void> {
        if (!this.#recoveryMode) return;
        JsonStore.set("misc", "solcordCrashGuard", {attempts: [], state: "stable", at: Date.now()} satisfies CrashGuardDocument);
        this.#recoveryMode = false;
        await this.#synchronizeFeatures();
    }

    openCommandDeck(): void {
        const scope = this.#scopes.get("command-deck");
        if (!scope || scope.disposed) return;
        this.#rememberReturnRoute();
        const existing = document.querySelector<HTMLElement>(".solcord-command-deck");
        if (existing) return (existing.querySelector<HTMLInputElement>("input[type='search']") ?? existing).focus({preventScroll: true});
        const overlay = document.createElement("div");
        overlay.className = "solcord-local-overlay solcord-command-deck";
        overlay.tabIndex = -1;
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
        const dialog = document.createElement("div");
        dialog.className = "solcord-local-dialog";
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.setAttribute("aria-label", "Solcord Command Deck");
        dialog.append(textElement("h2", "Command Deck"), textElement("p", "Local Solcord actions only. This palette cannot send, join, upload, or authorize."));
        const search = document.createElement("input");
        search.type = "search";
        search.placeholder = "Filter commands";
        search.setAttribute("aria-label", "Filter commands");
        const list = document.createElement("div");
        list.className = "solcord-command-list";
        dialog.append(search, list);
        overlay.append(dialog);
        document.body.append(overlay);
        const appMount = document.getElementById("app-mount");
        const previousInert = appMount?.inert ?? false;
        const previousAriaHidden = appMount?.getAttribute("aria-hidden") ?? null;
        if (appMount) {
            appMount.inert = true;
            appMount.setAttribute("aria-hidden", "true");
        }
        let cleanup = () => {};
        const documentKeydown = (event: KeyboardEvent) => {
            if (!overlay.isConnected || (event.key !== "Tab" && event.key !== "Escape")) return;
            handleDialogKeydown(event, dialog, cleanup);
        };
        const containFocus = (event: FocusEvent) => {
            if (!overlay.isConnected || dialog.contains(event.target as Node)) return;
            search.focus({preventScroll: true});
        };
        document.addEventListener("keydown", documentKeydown, true);
        document.addEventListener("focusin", containFocus, true);
        const release = scope.own(() => {
            document.removeEventListener("keydown", documentKeydown, true);
            document.removeEventListener("focusin", containFocus, true);
            overlay.remove();
            if (appMount) {
                appMount.inert = previousInert;
                if (previousAriaHidden === null) appMount.removeAttribute("aria-hidden");
                else appMount.setAttribute("aria-hidden", previousAriaHidden);
            }
            if (previousFocus?.isConnected) previousFocus.focus({preventScroll: true});
        }, "element");
        cleanup = () => release();
        const commands = [
            {name: "Open Solcord Suite", run: () => SettingsRenderer.openSettingsPage("solcord")},
            {
                name: "Toggle Stream Shield",
                run: () => {
                const current = SolcordSettings.module("stream-shield").values.manualActive === true;
                void this.setValue("stream-shield", "manualActive", !current);
                }
            },
            {name: "Capture settings snapshot", run: () => SolcordSettings.capture("Command Deck snapshot")},
            {
                name: "Save current DM or channel for later",
                run: () => {
                    const added = this.addCurrentViewToReturnLater("Saved from Command Deck", Date.now() + 24 * 60 * 60 * 1_000);
                    if (added) Toasts.success("Saved this DM or channel for later. Open Solcord > Chat & Composer to snooze, open, or complete it.");
                    else Toasts.info("Nothing was saved. Open a specific DM or channel, then use Ctrl+Alt+K again.");
                }
            },
            {name: "Refresh Activity Bridge", run: () => void this.#refreshActivityHealth()}
        ];
        const render = () => {
            list.replaceChildren();
            const matches = filterSolcordCommands(commands, search.value);
            for (const command of matches) {
                list.append(button(command.name, () => {cleanup(); command.run();}));
            }
            if (!matches.length) {
                const empty = textElement("p", "No matching local command.", "solcord-empty");
                empty.setAttribute("role", "status");
                list.append(empty);
            }
        };
        search.addEventListener("input", render);
        overlay.addEventListener("pointerdown", event => {if (event.target === overlay) cleanup();});
        dialog.addEventListener("pointerdown", event => event.stopPropagation());
        search.addEventListener("pointerdown", event => {event.stopPropagation(); search.focus({preventScroll: true});});
        render();
        queueMicrotask(() => {
            if (!search.isConnected) return;
            search.focus({preventScroll: true});
            requestAnimationFrame(() => {if (search.isConnected && document.activeElement !== search) search.focus({preventScroll: true});});
        });
    }

    inspectLink(input: string): LinkInspection {
        return inspectLink(input);
    }

    domainMemoryDecision(input: string): SolcordDomainMemoryRecord | undefined {
        return this.#domainMemory.decision(input);
    }

    inspectDomain(input: string): SolcordDomainRisk {
        return inspectSolcordDomain(input);
    }

    rememberDomain(input: string, decision: SolcordDomainDecision, ttlMs = 7 * 24 * 60 * 60 * 1_000): boolean {
        const next = new SolcordDomainMemory(this.#domainMemory.snapshot());
        const record = next.remember(input, decision, ttlMs);
        if (!record) return false;
        JsonStore.set("misc", "solcordDomainMemory", next.snapshot());
        this.#domainMemory = next;
        this.emitChange();
        return true;
    }

    forgetDomain(host: string): boolean {
        const next = new SolcordDomainMemory(this.#domainMemory.snapshot());
        if (!next.forget(host)) return false;
        JsonStore.set("misc", "solcordDomainMemory", next.snapshot());
        this.#domainMemory = next;
        this.emitChange();
        return true;
    }

    inspectAttachment(input: string, declaredMime?: string): SolcordAttachmentInspection {
        return inspectSolcordAttachment(input, declaredMime);
    }

    inspectLocalAttachment(file: Pick<File, "name" | "type">): SolcordAttachmentInspection {
        return inspectSolcordLocalAttachment(file.name, file.type || undefined);
    }

    returnLaterItems(): SolcordReturnLaterItem[] {
        return this.#returnLater.snapshot();
    }

    #rememberReturnRoute(input = window.location.href): string | undefined {
        this.#returnRouteMemory.remember(input);
        return this.#returnRouteMemory.current();
    }

    addCurrentViewToReturnLater(label: string, dueAt: number): boolean {
        const id = `return_${globalThis.crypto?.randomUUID?.().replaceAll("-", "") ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`}`;
        const route = this.#rememberReturnRoute();
        const item = route ? this.#returnLater.add(id, route, label, dueAt) : undefined;
        if (!item) return false;
        this.emitChange();
        return true;
    }

    snoozeReturnLater(id: string, durationMs: number): boolean {
        if (!this.#returnLater.snooze(id, durationMs)) return false;
        this.emitChange();
        return true;
    }

    completeReturnLater(id: string): boolean {
        if (!this.#returnLater.complete(id)) return false;
        this.emitChange();
        return true;
    }

    openReturnLater(id: string): boolean {
        const item = this.#returnLater.snapshot().find(candidate => candidate.id === id);
        const target = item ? solcordReturnLaterTarget(item.route) : undefined;
        if (!target) return false;
        window.location.assign(target);
        return true;
    }

    exportDiagnostics(): void {
        const document = SolcordSettings.snapshot();
        const diagnostics = {
            format: "solcord-sanitized-diagnostics",
            version: 1,
            generatedAt: new Date().toISOString(),
            privacy: "No tokens, message content, server names, account identifiers, or local paths are included.",
            recoveryMode: this.#recoveryMode,
            startupPhases: this.startupPhaseSnapshot(),
            modules: this.health(),
            activityCompatibility: this.activityHealth(),
            drift: this.driftResults(),
            performance: this.performanceSamples().slice(-12),
            addonDoctor: PluginDoctor.snapshot(),
            addonIntegrity: this.integrityStatus(),
            settings: {
                schemaVersion: document.schemaVersion,
                consentVersion: document.consentVersion,
                enabledModules: Object.fromEntries(Object.entries(document.modules).map(([id, setting]) => [id, setting.enabled])),
                snapshotCount: document.snapshots.length,
                updateLedger: document.updateLedger.map(({at, kind, version}) => ({at, kind, version}))
            }
        };
        this.#download("solcord-diagnostics.json", `${JSON.stringify(diagnostics, null, 2)}\n`, "application/json");
    }

    exportSettings(): void {
        this.#download("solcord-settings.json", SolcordSettings.exportDocument(), "application/json");
    }

    #refreshReviewedExecutionOwnership(extraPluginNames: readonly string[] = [], includeAllSolcordThemes = false): void {
        const settings = SolcordSettings.snapshot();
        const extra = new Set(extraPluginNames);
        const records: ReviewedExecutionOwnership[] = [];
        const acceptedAddons = SOLCORD_RUNTIME_ADDONS.filter(candidate => {
            const state = settings.curatedAddons[candidate.name];
            return extra.has(candidate.name) || (settings.setupTransactions.length > 0 && state?.reviewedSha256 === candidate.sourceSha256 && (state.selected || state.enabled));
        });
        for (const candidate of acceptedAddons) records.push({kind: "plugin", fileName: candidate.fileName, reviewedSha256: candidate.sourceSha256});
        const dependencyNames = new Set([...extra, ...acceptedAddons.flatMap(candidate => [...candidate.dependencies])]);
        for (const dependency of SOLCORD_RUNTIME_DEPENDENCIES) {
            if (dependencyNames.has(dependency.name)) records.push({kind: "plugin", fileName: dependency.fileName, reviewedSha256: dependency.sourceSha256});
        }
        const selectedTheme = SOLCORD_THEMES.find(theme => theme.id === settings.selectedTheme);
        for (const theme of SOLCORD_RUNTIME_THEMES) {
            if (includeAllSolcordThemes || (settings.setupTransactions.length > 0 && selectedTheme?.fileName === theme.fileName)) {
                records.push({kind: "theme", fileName: theme.fileName, reviewedSha256: theme.sourceSha256});
            }
        }
        configureReviewedExecutionOwnership(records);
    }

    #refreshAddonIntegrity(phase: Exclude<AddonIntegrityStatus["phase"], "pending" | "failed">): Promise<AddonIntegrityRecord[]> {
        const run = async () => {
            let records: AddonIntegrityRecord[];
            let resolvedPhase: AddonIntegrityStatus["phase"] = phase;
            try {
                records = normalizeIntegrityAudit(await this.#withPrivateCapability(capability => boundedSolcordStartupOperation(TIMELINE_IPC.auditSetup(capability))));
            }
            catch {
                records = unavailableIntegrityRecords();
                resolvedPhase = "failed";
            }
            this.#integrity = {
                checkedAt: Date.now(),
                phase: resolvedPhase,
                summary: summarizeIntegrity(records),
                records
            };
            this.#enforceAddonIntegrity(records);
            this.#updatePluginDoctorHealth();
            this.emitChange();
            return structuredClone(records);
        };
        const result = this.#integrityQueue.then(run, run);
        this.#integrityQueue = result.then(() => undefined, () => undefined);
        return result;
    }

    #enforceAddonIntegrity(records: readonly AddonIntegrityRecord[]): void {
        const settings = SolcordSettings.snapshot();
        const ownership = {curatedAddons: settings.curatedAddons, selectedTheme: settings.selectedTheme, hasSetupTransaction: settings.setupTransactions.length > 0};
        const doctorRecords = new Map(PluginDoctor.snapshot().map(record => [record.addonId, record]));
        const quarantine = (name: string, reason: string) => {
            if (doctorRecords.get(name)?.quarantineReason === reason) return;
            PluginDoctor.quarantine(name, reason);
            doctorRecords.set(name, PluginDoctor.snapshot().find(record => record.addonId === name)!);
        };
        const disablePlugin = (fileName: string, label: string) => {
            try {
                if (PluginManager.isEnabled(fileName)) PluginManager.disableAddon(fileName);
            }
            catch {Logger.warn("Solcord", `Integrity enforcement could not stop ${label}; it remains quarantined.`);}
        };

        for (const record of records) {
            if (!integrityRecordIsAccepted(record, ownership)) continue;
            if (!integrityBlocksExecution(record)) continue;
            if (record.status === "missing") {
                if (record.kind === "addon") {
                    const candidate = SOLCORD_RUNTIME_ADDONS.find(entry => entry.name === record.name);
                    if (candidate) disablePlugin(candidate.fileName, candidate.name);
                }
                else if (record.kind === "dependency") {
                    const dependency = SOLCORD_RUNTIME_DEPENDENCIES.find(entry => entry.name === record.name);
                    if (dependency) {
                        for (const candidate of SOLCORD_RUNTIME_ADDONS.filter(entry => entry.dependencies.some(name => String(name) === dependency.name))) disablePlugin(candidate.fileName, candidate.name);
                    }
                }
                continue;
            }
            const reason = integrityFailureReason(record)!;
            if (record.kind === "addon") {
                const candidate = SOLCORD_RUNTIME_ADDONS.find(entry => entry.name === record.name);
                if (!candidate) continue;
                const configured = settings.curatedAddons[candidate.name];
                const guardedBuiltIn = candidate.name === "SplitLargeMessages" && configured?.mode === "guarded";
                if (guardedBuiltIn && record.status === "unavailable") continue;
                const installed = Boolean(PluginManager.resolveAddon(candidate.fileName));
                if (record.status === "unavailable" && !installed && configured?.enabled !== true) continue;
                disablePlugin(candidate.fileName, candidate.name);
                if (integrityRequiresQuarantine(record)) {
                    quarantine(candidate.name, reason);
                    try {SolcordSettings.setCuratedAddonEnabled(candidate.name, false, reason);}
                    catch {Logger.warn("Solcord", `Integrity enforcement could not persist the disabled state for ${candidate.name}.`);}
                }
                continue;
            }

            if (record.kind === "dependency") {
                const dependency = SOLCORD_RUNTIME_DEPENDENCIES.find(entry => entry.name === record.name);
                if (!dependency) continue;
                const dependents = SOLCORD_RUNTIME_ADDONS.filter(candidate => candidate.dependencies.some(name => String(name) === dependency.name));
                const dependencyInstalled = Boolean(PluginManager.resolveAddon(dependency.fileName));
                const dependentActive = dependents.some(candidate => PluginManager.isEnabled(candidate.fileName) || settings.curatedAddons[candidate.name]?.enabled === true);
                if (record.status === "unavailable" && !dependencyInstalled && !dependentActive) continue;
                for (const candidate of dependents) disablePlugin(candidate.fileName, candidate.name);
                disablePlugin(dependency.fileName, dependency.name);
                if (integrityRequiresQuarantine(record)) {
                    quarantine(dependency.name, reason);
                    for (const candidate of dependents) {
                        const dependentReason = `Dependency ${dependency.name} failed integrity validation; this addon was disabled and quarantined.`;
                        quarantine(candidate.name, dependentReason);
                        try {SolcordSettings.setCuratedAddonEnabled(candidate.name, false, dependentReason);}
                        catch {Logger.warn("Solcord", `Integrity enforcement could not persist the disabled state for ${candidate.name}.`);}
                    }
                }
                continue;
            }

            const theme = SOLCORD_THEMES.find(entry => entry.name === record.name);
            if (!theme || (record.status === "unavailable" && !ThemeManager.isEnabled(theme.fileName))) continue;
            try {if (ThemeManager.isEnabled(theme.fileName)) ThemeManager.disableAddon(theme.fileName);}
            catch {Logger.warn("Solcord", `Integrity enforcement could not stop the reviewed theme ${theme.name}.`);}
        }
    }

    #download(filename: string, content: string, type: string): void {
        const url = URL.createObjectURL(new Blob([content], {type}));
        const anchor = document.createElement("a");
        anchor.download = filename;
        anchor.href = url;
        anchor.click();
        queueMicrotask(() => URL.revokeObjectURL(url));
    }

    #enabledAddonFiles(manager: {addonList: Array<{filename: string;}>; isEnabled(id: string): boolean;}): string[] {
        return manager.addonList.filter(addon => manager.isEnabled(addon.filename)).map(addon => addon.filename);
    }

    #reviewedAddonHeld(fileName: string): boolean {
        const reviewed = SOLCORD_RUNTIME_ADDONS.find(candidate => candidate.fileName === fileName) ?? SOLCORD_RUNTIME_DEPENDENCIES.find(dependency => dependency.fileName === fileName);
        if (!reviewed) return false;
        const kind: AddonIntegrityKind = "dependencies" in reviewed ? "addon" : "dependency";
        const settings = SolcordSettings.snapshot();
        if (settings.setupTransactions.length === 0) return false;
        const accepted = kind === "addon"
            ? settings.curatedAddons[reviewed.name]?.reviewedSha256 === reviewed.sourceSha256 && (settings.curatedAddons[reviewed.name]?.selected || settings.curatedAddons[reviewed.name]?.enabled)
            : SOLCORD_RUNTIME_ADDONS.some(candidate => candidate.dependencies.some(name => name === reviewed.name) && settings.curatedAddons[candidate.name]?.reviewedSha256 === candidate.sourceSha256 && (settings.curatedAddons[candidate.name]?.selected || settings.curatedAddons[candidate.name]?.enabled));
        if (!accepted) return false;
        const record = this.#integrity.records.find(entry => entry.kind === kind && entry.name === reviewed.name);
        return integrityBlocksExecution(record) || PluginDoctor.isQuarantined(reviewed.name) || PluginDoctor.isQuarantined(reviewed.fileName);
    }

    #reviewedAddonBlockedForEnable(fileName: string): boolean {
        const reviewed = SOLCORD_RUNTIME_ADDONS.find(candidate => candidate.fileName === fileName) ?? SOLCORD_RUNTIME_DEPENDENCIES.find(dependency => dependency.fileName === fileName);
        if (!reviewed) return false;
        return reviewBlocksEnable(reviewed) || this.#reviewedAddonHeld(fileName);
    }

    async #applyAddonSelection(manager: {addonList: Array<{filename: string;}>; isEnabled(id: string): boolean; enableAddon(id: string): boolean | undefined; disableAddon(id: string): boolean | undefined;}, desiredFiles: ReadonlySet<string>): Promise<void> {
        for (const addon of [...manager.addonList]) {
            const desired = desiredFiles.has(addon.filename);
            const current = manager.isEnabled(addon.filename);
            if (current === desired) continue;
            if (desired && this.#reviewedAddonBlockedForEnable(addon.filename)) throw new Error("AddonReviewHeld");
            if (desired) manager.enableAddon(addon.filename);
            else manager.disableAddon(addon.filename);
            if (manager.isEnabled(addon.filename) !== desired) throw new Error("AddonProfileApplyFailed");
            await new Promise(resolve => globalThis.setTimeout(resolve, 25));
        }
    }

    async #restoreCompleteAddonStates(manager: {addonList: Array<{filename: string;}>; isEnabled(id: string): boolean; enableAddon(id: string): boolean | undefined; disableAddon(id: string): boolean | undefined;}, states: Record<string, boolean>): Promise<boolean> {
        let complete = true;
        for (const addon of [...manager.addonList]) {
            const desired = states[addon.filename] === true;
            if (manager.isEnabled(addon.filename) === desired) continue;
            if (desired && this.#reviewedAddonHeld(addon.filename)) {
                complete = false;
                continue;
            }
            try {
                if (desired) manager.enableAddon(addon.filename);
                else manager.disableAddon(addon.filename);
            }
            catch {complete = false;}
            if (manager.isEnabled(addon.filename) !== desired) complete = false;
        }
        return complete;
    }

    async #waitForAddon(manager: {isLoaded(id: string): boolean;}, fileName: string, timeoutMs = 8_000): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (manager.isLoaded(fileName)) return true;
            await new Promise(resolve => globalThis.setTimeout(resolve, 100));
        }
        return manager.isLoaded(fileName);
    }

    async #restoreAddonStates(priorAddonStates: Record<string, boolean>, priorThemeStates: Record<string, boolean>): Promise<boolean> {
        let complete = true;
        const transactionPluginFiles = new Set<string>([
            ...SOLCORD_RUNTIME_ADDONS.map(candidate => candidate.fileName),
            ...SOLCORD_RUNTIME_DEPENDENCIES.map(candidate => candidate.fileName)
        ]);
        for (const addon of PluginManager.addonList) {
            if (Object.hasOwn(priorAddonStates, addon.filename) || !transactionPluginFiles.has(addon.filename) || !PluginManager.isEnabled(addon.filename)) continue;
            PluginManager.disableAddon(addon.filename);
            if (PluginManager.isEnabled(addon.filename)) complete = false;
        }
        for (const [fileName, desired] of Object.entries(priorAddonStates)) {
            const addon = PluginManager.resolveAddon(fileName);
            if (!addon) {
                if (desired) complete = false;
                continue;
            }
            const current = PluginManager.isEnabled(addon.filename);
            if (desired && !current) PluginManager.enableAddon(addon.filename);
            else if (!desired && current) PluginManager.disableAddon(addon.filename);
            if (PluginManager.isEnabled(addon.filename) !== desired) complete = false;
        }

        const transactionThemeFiles = new Set(SOLCORD_THEMES.map(theme => theme.fileName));
        for (const theme of ThemeManager.addonList) {
            if (Object.hasOwn(priorThemeStates, theme.filename) || !transactionThemeFiles.has(theme.filename) || !ThemeManager.isEnabled(theme.filename)) continue;
            ThemeManager.disableAddon(theme.filename);
            if (ThemeManager.isEnabled(theme.filename)) complete = false;
        }
        for (const [fileName, desired] of Object.entries(priorThemeStates)) {
            const theme = ThemeManager.resolveAddon(fileName);
            if (!theme) {
                if (desired) complete = false;
                continue;
            }
            const current = ThemeManager.isEnabled(theme.filename);
            if (desired && !current) ThemeManager.enableAddon(theme.filename);
            else if (!desired && current) ThemeManager.disableAddon(theme.filename);
            if (ThemeManager.isEnabled(theme.filename) !== desired) complete = false;
        }
        return complete;
    }

    #communityAddonEnabled(name: string): boolean {
        const candidate = SOLCORD_RUNTIME_ADDONS.find(entry => entry.name === name);
        return Boolean(candidate && communityAddonIsEnabled(PluginManager, candidate.name, candidate.fileName));
    }

    #communityAddonInstalled(name: string): boolean {
        const candidate = SOLCORD_RUNTIME_ADDONS.find(entry => entry.name === name);
        return Boolean(candidate && resolveCommunityAddon(PluginManager, candidate.name, candidate.fileName));
    }

    #communityAddonSignature(): string {
        return SOLCORD_RUNTIME_ADDONS
            .filter(candidate => isSolcordBuiltInAddon(candidate.name, candidate.name === "SplitLargeMessages" ? "guarded" : undefined))
            .map(candidate => {
                const addon = resolveCommunityAddon(PluginManager, candidate.name, candidate.fileName);
                return `${candidate.name}:${addon?.filename ?? "missing"}:${addon && PluginManager.isEnabled(addon.filename) ? "on" : "off"}`;
            })
            .join("|");
    }

    #synchronizeCuratedAdapters(curatedOverride?: Record<string, SolcordCuratedAddonState>): Record<string, CuratedAdapterResult> {
        const curated = curatedOverride ?? SolcordSettings.snapshot().curatedAddons;
        const results: Record<string, CuratedAdapterResult> = {};
        const communityResult = (name: string): CuratedAdapterResult => {
            const preferred = curated[name]?.provider;
            return preferred === "prefer-solcord"
                ? {enabled: true, ready: true, provider: "community", conflict: true, reason: "The community addon was re-enabled; Solcord stood down its built-in and left the owner file unchanged."}
                : {enabled: true, ready: true, provider: "community"};
        };
        const failClosed = (reason: string): Record<string, CuratedAdapterResult> => {
            this.#curatedSynchronizationError = reason;
            this.#nativeSuite = undefined;
            for (const [name, state] of Object.entries(curated)) {
                results[name] = this.#communityAddonEnabled(name)
                    ? communityResult(name)
                    : {enabled: false, provider: "off", ...(state.enabled && isSolcordBuiltInAddon(name, state.mode) ? {reason} : {})};
            }
            this.#curatedAdapterResults = structuredClone(results);
            Logger.error("Solcord", reason);
            if (!curatedOverride) this.emitChange();
            return results;
        };
        this.#curatedSynchronizationError = undefined;
        try {this.#curatedScope.dispose();}
        catch (error) {return failClosed(`Native-suite cleanup is incomplete (${errorName(error)}); replacement adapters stayed off to prevent duplicate patches or listeners.`);}
        this.#curatedScope = new SolcordDisposalScope();
        const scope = this.#curatedScope;
        if (!this.#started || this.#recoveryMode) {
            for (const name of Object.keys(curated)) {
                results[name] = this.#communityAddonEnabled(name)
                    ? communityResult(name)
                    : {enabled: false, provider: "off", reason: this.#recoveryMode ? "Held off by startup recovery mode." : "Waiting for Solcord startup."};
            }
            this.#curatedAdapterResults = structuredClone(results);
            return results;
        }
        this.#curatedCommunitySignature = this.#communityAddonSignature();
        for (const [name, state] of Object.entries(curated)) {
            if (state.enabled === true
                && isSolcordBuiltInAddon(name, state.mode)
                && !this.#communityAddonEnabled(name)) {
                if (!this.#communityAddonInstalled(name)) PluginDoctor.clearLegacyCapabilityMissQuarantine(name);
                PluginDoctor.clearLegacyCapabilityMissQuarantine(solcordBuiltInDoctorId(name));
            }
        }
        const nativeEnabled: Record<string, boolean> = Object.fromEntries(Object.entries(curated).map(([name, state]) => [name,
            state.enabled === true
            && isSolcordBuiltInAddon(name, state.mode)
            && !INDEPENDENT_BUILTIN_PROVIDERS.has(name)
            && !PluginDoctor.isQuarantined(solcordBuiltInDoctorId(name))
            && !this.#communityAddonEnabled(name)
        ]));
        const motionRequested = SolcordSettings.snapshot().productPreferences.nativeSuite.motion.effect !== "off";
        const firstPartyMotionEnabled = motionRequested
            && !PluginDoctor.isQuarantined(solcordBuiltInDoctorId("DiscordEffects"))
            && !this.#communityAddonEnabled("DiscordEffects");
        // Animated backgrounds are a first-party Appearance setting, not a
        // hidden dependency on whether the old DiscordEffects card completed
        // setup. Selecting any scene therefore activates only Solcord's local,
        // reversible motion provider. The curated card still controls provider
        // migration/parity and remains independently reportable.
        if (firstPartyMotionEnabled) nativeEnabled.DiscordEffects = true;
        const nativeSuite = new SolcordNativeSuiteController(scope, nativeEnabled, this.#nativeSuiteAdapter(nativeEnabled, scope));
        this.#nativeSuite = nativeSuite;
        scope.own(() => {
            nativeSuite.dispose();
            if (this.#nativeSuite === nativeSuite) this.#nativeSuite = undefined;
        }, "other");
        try {nativeSuite.start();}
        catch (error) {
            try {scope.dispose();}
            catch (cleanupError) {return failClosed(`Native-suite startup failed (${errorName(error)}) and cleanup remains incomplete (${errorName(cleanupError)}); every replacement adapter stayed off.`);}
            return failClosed(`Native-suite startup failed closed (${errorName(error)}); every replacement adapter stayed off.`);
        }
        const split = curated.SplitLargeMessages;
        if (!split?.enabled || split.mode !== "guarded" || !this.#setupAcceptsAddon("SplitLargeMessages", split.mode)) {
            results.SplitLargeMessages = {enabled: false, provider: "off"};
        }
        else if (PluginDoctor.isQuarantined(solcordBuiltInDoctorId("SplitLargeMessages"))) {
            results.SplitLargeMessages = {enabled: false, provider: "off", reason: "Plugin Doctor quarantine is holding the built-in until an explicit retry succeeds."};
        }
        else if (this.#communityAddonEnabled("SplitLargeMessages")) {
            results.SplitLargeMessages = communityResult("SplitLargeMessages");
        }
        else {
            scope.listen(window, "keydown", (rawEvent: Event) => {
                const event = rawEvent as KeyboardEvent;
                if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.repeat) return;
                const target = event.target instanceof HTMLElement ? event.target : undefined;
                const editor = target?.closest<HTMLElement>("[role='textbox'][contenteditable='true']");
                if (!editor || !editor.closest("[class*='channelTextArea']")) return;
                const content = editor.innerText || editor.textContent || "";
                if (content.length <= 2_000) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                this.#showGuardedSplitReview(scope, content);
            }, true);
            results.SplitLargeMessages = {enabled: true, ready: true, provider: "solcord"};
        }

        if (!curated.DoNotTrack?.enabled) {
            results.DoNotTrack = {enabled: false, provider: "off"};
        }
        else if (PluginDoctor.isQuarantined(solcordBuiltInDoctorId("DoNotTrack"))) {
            results.DoNotTrack = {enabled: false, provider: "off", reason: "Plugin Doctor quarantine is holding the built-in until an explicit retry succeeds."};
        }
        else if (SolcordSettings.snapshot().productPreferences.privacy.telemetry === "block" && this.#privacyCapabilities.find(capability => capability.dataClass === "telemetry")?.state === "Protected") {
            results.DoNotTrack = {enabled: true, ready: true, provider: "solcord"};
            PluginDoctor.recordSuccessfulStart(solcordBuiltInDoctorId("DoNotTrack"));
        }
        else if (this.#communityAddonEnabled("DoNotTrack")) {
            results.DoNotTrack = communityResult("DoNotTrack");
        }
        else {
            const analyticsContainer = getModule<Record<string, unknown>>(candidate => Boolean(resolveDiscordAnalyticsTrack(candidate)), {firstId: 129230, cacheId: "solcord-analytics-container", searchDefault: false});
            const adapter = new DoNotTrackAdapter({
                scope,
                patcher: Patcher,
                methods: discordAnalyticsMethods(analyticsContainer),
                getSettings: () => ({enabled: true})
            });
            if (adapter.start()) {
                results.DoNotTrack = {enabled: true, ready: true, provider: "solcord"};
                PluginDoctor.recordSuccessfulStart(solcordBuiltInDoctorId("DoNotTrack"));
            }
            else {
                const reason = "Full analytics coverage is unavailable because an emitter is missing or cannot be safely patched. Existing Privacy protection remains in effect.";
                results.DoNotTrack = {enabled: false, provider: "off", reason};
                PluginDoctor.recordCapabilityMiss(solcordBuiltInDoctorId("DoNotTrack"));
            }
        }

        if (!curated.InvisibleTyping?.enabled) {
            results.InvisibleTyping = {enabled: false, provider: "off"};
        }
        else if (PluginDoctor.isQuarantined(solcordBuiltInDoctorId("InvisibleTyping"))) {
            results.InvisibleTyping = {enabled: false, provider: "off", reason: "Plugin Doctor quarantine is holding the built-in until an explicit retry succeeds."};
        }
        else if (this.#communityAddonEnabled("InvisibleTyping")) {
            results.InvisibleTyping = communityResult("InvisibleTyping");
        }
        else {
            const typingModule = getByKeys<Record<string, unknown>>(["startTyping", "stopTyping"]);
            const adapter = new InvisibleTypingAdapter({
                scope,
                patcher: Patcher,
                lookupTypingStart: () => typingModule && ({module: typingModule, key: "startTyping"}),
                getSettings: () => ({enabled: true, allowlistChannelIds: []}),
                validateTypingStart: target => target.module === typingModule && typeof typingModule?.stopTyping === "function"
            });
            if (adapter.start()) {
                results.InvisibleTyping = {enabled: true, ready: true, provider: "solcord"};
                PluginDoctor.recordSuccessfulStart(solcordBuiltInDoctorId("InvisibleTyping"));
            }
            else {
                const reason = "Discord typing lookup failed structural validation; Invisible Typing stayed off.";
                results.InvisibleTyping = {enabled: false, provider: "off", reason};
                PluginDoctor.recordCapabilityMiss(solcordBuiltInDoctorId("InvisibleTyping"));
            }
        }

        if (!curated.DoubleClickToReply?.enabled) {
            results.DoubleClickToReply = {enabled: false, provider: "off"};
        }
        else if (PluginDoctor.isQuarantined(solcordBuiltInDoctorId("DoubleClickToReply"))) {
            results.DoubleClickToReply = {enabled: false, provider: "off", reason: "Plugin Doctor quarantine is holding the built-in until an explicit retry succeeds."};
        }
        else if (this.#communityAddonEnabled("DoubleClickToReply")) {
            results.DoubleClickToReply = communityResult("DoubleClickToReply");
        }
        else {
            const modifier = SolcordSettings.snapshot().productPreferences.nativeSuite.composer.doubleClickReplyModifier;
            const feature = new DoubleClickReplyFeature(this.#doubleClickReplyAdapter(), modifier);
            if (feature.start()) {
                scope.own(() => feature.stop(), "listener");
                results.DoubleClickToReply = {enabled: true, ready: true, provider: "solcord"};
                PluginDoctor.recordSuccessfulStart(solcordBuiltInDoctorId("DoubleClickToReply"));
            }
            else {
                const reason = "Discord reply lookup failed structural validation; Double Click to Reply stayed off.";
                results.DoubleClickToReply = {enabled: false, provider: "off", reason};
                PluginDoctor.recordCapabilityMiss(solcordBuiltInDoctorId("DoubleClickToReply"));
            }
        }
        for (const [name, state] of Object.entries(curated)) {
            if (Object.hasOwn(results, name) || !isSolcordBuiltInAddon(name, state.mode)) continue;
            if (name === "DiscordEffects" && motionRequested) {
                if (PluginDoctor.isQuarantined(solcordBuiltInDoctorId(name))) {
                    results[name] = {enabled: false, provider: "off", reason: "Plugin Doctor quarantine is holding the animated background until an explicit retry succeeds."};
                }
                else if (this.#communityAddonEnabled(name)) {
                    results[name] = communityResult(name);
                }
                else if (nativeSuite.providerReady(name)) {
                    results[name] = {enabled: true, ready: true, provider: "solcord", reason: "Active as the selected first-party Appearance background."};
                    PluginDoctor.recordSuccessfulStart(solcordBuiltInDoctorId(name));
                }
                else {
                    const reason = "The selected animated background did not validate and stayed off.";
                    results[name] = {enabled: false, provider: "off", reason};
                    PluginDoctor.recordCapabilityMiss(solcordBuiltInDoctorId(name));
                }
                continue;
            }
            if (!state.enabled || !this.#setupAcceptsAddon(name, state.mode)) {
                results[name] = {enabled: false, provider: "off"};
                continue;
            }
            if (PluginDoctor.isQuarantined(solcordBuiltInDoctorId(name))) {
                results[name] = {enabled: false, provider: "off", reason: "Plugin Doctor quarantine is holding the built-in until an explicit retry succeeds."};
                continue;
            }
            if (this.#communityAddonEnabled(name)) {
                results[name] = communityResult(name);
                continue;
            }
            if (nativeSuite.providerReady(name)) {
                results[name] = {enabled: true, ready: true, provider: "solcord"};
                PluginDoctor.recordSuccessfulStart(solcordBuiltInDoctorId(name));
                continue;
            }
            if (nativeSuite.providerAvailable(name)) {
                results[name] = {enabled: true, ready: false, provider: "solcord", reason: "Available — the first-party adapter is active, but Ready is withheld until a matching live interaction succeeds."};
                PluginDoctor.recordCapabilityMiss(solcordBuiltInDoctorId(name));
                continue;
            }
            const reason = `${name}'s native adapter did not validate on this Discord build and stayed off.`;
            results[name] = {enabled: false, provider: "off", reason};
            PluginDoctor.recordCapabilityMiss(solcordBuiltInDoctorId(name));
        }
        if (!curatedOverride) {
            const retryable = Object.entries(results).some(([name, result]) => {
                const state = curated[name];
                return state?.enabled === true
                    && isSolcordBuiltInAddon(name, state.mode)
                    && !this.#communityAddonEnabled(name)
                    && !PluginDoctor.isQuarantined(solcordBuiltInDoctorId(name))
                    && !result.enabled
                    && Boolean(result.reason);
            });
            if (retryable) {
                this.#scheduleCuratedAdapterRetry();
            }
            else {
                this.#curatedAdapterRetryAttempt = 0;
                this.#curatedAdapterRetryScheduled = false;
                this.#curatedAdapterRetryGeneration++;
            }
        }
        this.#curatedAdapterResults = structuredClone(results);
        if (!curatedOverride) this.emitChange();
        return results;
    }

    #scheduleCuratedAdapterRetry(): void {
        if (this.#curatedAdapterRetryScheduled || this.#curatedAdapterRetryAttempt >= 3 || !this.#initialized) return;
        const delays = [1_500, 5_000, 15_000] as const;
        const delay = delays[this.#curatedAdapterRetryAttempt] ?? delays.at(-1)!;
        const generation = ++this.#curatedAdapterRetryGeneration;
        this.#curatedAdapterRetryAttempt++;
        this.#curatedAdapterRetryScheduled = true;
        this.#rootScope.timeout(() => {
            if (generation !== this.#curatedAdapterRetryGeneration) return;
            this.#curatedAdapterRetryScheduled = false;
            if (!this.#started || this.#recoveryMode) return;
            this.#synchronizeCuratedAdapters();
        }, delay);
    }

    #nativeSuiteAdapter(nativeEnabled: Readonly<Record<string, boolean>>, scope: SolcordDisposalScope): SolcordNativeSuiteAdapter {
        const privateIdentity = this.#privateUiAccountIdentity;
        type FluxStore = {addChangeListener?(listener: () => void): void; removeChangeListener?(listener: () => void): void;};
        type Message = {id?: string; timestamp?: {valueOf?(): number;} | number; content?: string; author?: {username?: string; globalName?: string;};};
        type Channel = {id?: string; guild_id?: string; type?: number; recipientId?: string; getRecipientId?(): string | undefined; recipients?: Array<string | {id?: string;}>; rawRecipients?: Array<string | {id?: string;}>;};
        type GuildChannelBucket = {channel?: Channel;};
        const productPreferences = SolcordSettings.snapshot().productPreferences;
        const nativePreferences = productPreferences.nativeSuite;
        const reducedByOs = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
        const motionPolicy = resolveSolcordPerformancePolicy(productPreferences.performanceProfile, productPreferences.appearance.motion, reducedByOs);
        const voiceHealthEnabled = nativePreferences.voiceHealthEnabled;
        const lookups = planSolcordNativeSuiteLookups(nativeEnabled, voiceHealthEnabled);
        const voiceParticipantsNeeded = lookups.callContext || lookups.audioConsole;
        const selectedChannelStore = voiceParticipantsNeeded || lookups.voiceNoteStudio
            ? getStore("SelectedChannelStore") as FluxStore & {getChannelId?(): string | undefined; getVoiceChannelId?(): string | undefined;} | undefined
            : undefined;
        const selectedGuildStore = lookups.notificationReview
            ? getStore("SelectedGuildStore") as {getGuildId?(): string | undefined;} | undefined
            : undefined;
        const voiceStateStore = voiceParticipantsNeeded
            ? getStore("VoiceStateStore") as FluxStore & {getVoiceStatesForChannel?(channelId: string): unknown;} | undefined
            : undefined;
        const speakingStore = lookups.callContext
            ? getStore("SpeakingStore") as FluxStore & {getSpeakingUsers?(): unknown; getSpeakers?(): unknown;} | undefined
            : undefined;
        const streamingStore = lookups.callContext
            ? getStore("ApplicationStreamingStore") as FluxStore & {getCurrentUserActiveStream?(): unknown; getStreamerActiveStreamMetadata?(): unknown; getViewerIds?(stream?: unknown): unknown;} | undefined
            : undefined;
        const messageStore = lookups.channelGlance
            ? getStore("MessageStore") as {getMessages?(channelId: string): {toArray?(): Message[];} | Message[] | undefined;} | undefined
            : undefined;
        const channelStore = lookups.callContext || lookups.voiceNoteStudio || lookups.notificationReview || lookups.peopleAndSpaces
            ? getStore("ChannelStore") as {getChannel?(channelId: string): Channel | undefined; getSortedPrivateChannels?(): Channel[];} | undefined
            : undefined;
        const guildStore = lookups.notificationReview || lookups.peopleAndSpaces
            ? getStore("GuildStore") as {getGuilds?(): Record<string, unknown>; getGuild?(guildId: string): {id?: string; name?: string; ownerId?: string; owner_id?: string; memberCount?: number; joinedAt?: unknown; joined_at?: unknown; premiumSubscriptionCount?: unknown; preferredLocale?: unknown;} | undefined;} | undefined
            : undefined;
        const userStore = lookups.callContext || lookups.peopleAndSpaces
            ? getStore("UserStore") as {getUser?(userId: string): {id?: string; username?: string; globalName?: string; bot?: boolean;} | undefined; getCurrentUser?(): {id?: string;} | undefined;} | undefined
            : undefined;
        const memberCountStore = lookups.peopleAndSpaces
            ? getStore("MemberCountStore") as {getMemberCount?(guildId: string): number | undefined;} | undefined
            : undefined;
        const relationshipStore = lookups.peopleAndSpaces
            ? getStore("RelationshipStore") as {getRelationships?(): unknown; getMutableRelationships?(): unknown; getRelationshipSince?(userId: string): unknown;} | undefined
            : undefined;
        const relationshipReader = resolveSolcordRelationshipReader(relationshipStore);
        const relationshipReaderAvailable = relationshipReader?.() !== undefined;
        const mutualGuildStore = lookups.peopleAndSpaces
            ? getStore("MutualGuildStore") as {getMutualGuilds?(userId: string): unknown;} | undefined
            : undefined;
        const presenceStore = lookups.peopleAndSpaces
            ? getStore("PresenceStore") as {getStatus?(userId: string): unknown;} | undefined
            : undefined;
        const guildChannelStore = lookups.notificationReview || lookups.peopleAndSpaces
            ? getStore("GuildChannelStore") as {getChannels?(guildId: string): Record<string, GuildChannelBucket[]>;} | undefined
            : undefined;
        const guildRoleStore = lookups.peopleAndSpaces
            ? getStore("GuildRoleStore") as {getRoles?(guildId: string): Record<string, unknown> | undefined;} | undefined
            : undefined;
        const readStateStore = lookups.notificationReview || lookups.peopleAndSpaces
            ? getStore("ReadStateStore") as {hasUnread?(channelId: string): boolean; getMentionCount?(channelId: string): number; lastMessageId?(channelId: string): string | null;} | undefined
            : undefined;
        const notificationMuteStore = lookups.notificationReview
            ? getStore("UserGuildSettingsStore") as {isChannelMuted?(guildId: string | null | undefined, channelId: string): boolean; isGuildOrCategoryOrChannelMuted?(guildId: string, channelId: string): boolean;} | undefined
            : undefined;
        const streamerModeStore = lookups.peopleAndSpaces
            ? getStore("StreamerModeStore") as FluxStore & {enabled?: boolean; getSettings?(): {enabled?: unknown;} | undefined;} | undefined
            : undefined;
        const volumeActions = lookups.audioConsole
            ? getByKeys<{setLocalVolume?(userId: string, volume: number): void;}>(["setLocalVolume"])
            : undefined;
        const voiceChannelCapability = resolveSolcordVoiceChannelReader(selectedChannelStore);
        const voiceStateCapability = resolveSolcordVoiceStateReader(voiceStateStore);
        const streamingCapability = resolveSolcordStreamingReaders(streamingStore);
        const localVolumeCapability = resolveSolcordLocalVolumeAction(volumeActions);
        const voiceNoteCapture = resolveSolcordVoiceNoteCapture({mediaDevices: navigator.mediaDevices, mediaRecorder: typeof MediaRecorder === "function" ? MediaRecorder : undefined});
        const voiceHealthCapability = voiceHealthEnabled
            ? resolveCachedVoiceHealthCapability([
                getStore("RTCConnectionStore"),
                getStore("VoiceConnectionStore"),
                getStore("MediaEngineStore")
            ])
            : {state: "unavailable" as const, detail: "Voice Health is off."};
        const speakingReader = resolveSolcordSpeakingReader(speakingStore);
        const baseCallContextStores = [selectedChannelStore, voiceStateStore];
        const voiceParticipantContextAvailable = voiceParticipantsNeeded
            && voiceChannelCapability.state !== "unavailable"
            && voiceStateCapability.state !== "unavailable"
            && baseCallContextStores.every(store => typeof store?.addChangeListener === "function" && typeof store.removeChangeListener === "function");
        const voiceActivityAvailable = typeof speakingReader === "function"
            && typeof speakingStore?.addChangeListener === "function"
            && typeof speakingStore.removeChangeListener === "function";
        const spectatorsAvailable = (typeof streamingStore?.getCurrentUserActiveStream === "function"
            || typeof streamingStore?.getStreamerActiveStreamMetadata === "function")
            ? streamingCapability.state !== "unavailable"
            : false;
        const callContextStores = [...baseCallContextStores];
        if (nativeEnabled.VoiceActivity && voiceActivityAvailable) callContextStores.push(speakingStore);
        if (nativeEnabled.ShowSpectators && spectatorsAvailable) callContextStores.push(streamingStore);
        const callContextAvailable = lookups.callContext && voiceParticipantContextAvailable;
        let connectedChannelId: string | undefined;
        let connectedAt = Date.now();
        const currentCall = () => {
            const channelId = voiceChannelCapability.value?.();
            if (!channelId) {connectedChannelId = undefined; return;}
            if (connectedChannelId !== channelId) {connectedChannelId = channelId; connectedAt = Date.now();}
            const participantIds = voiceStateCapability.value?.(channelId) ?? [];
            const speakingIds = voiceActivityAvailable ? normalizeSolcordVoiceStateIds(speakingReader?.()) : [];
            if (voiceActivityAvailable && !speakingIds) throw new Error("SpeakingStoreSnapshotShapeDrifted");
            const speakerIds = (speakingIds ?? []).filter(id => participantIds.includes(id));
            const stream = spectatorsAvailable ? streamingCapability.value?.currentStream() : undefined;
            const viewers = spectatorsAvailable && stream ? streamingCapability.value?.viewerIds(stream) ?? [] : [];
            const viewerLabels = viewers.map(id => {
                const user = userStore?.getUser?.(id);
                return (user?.globalName || user?.username || "Viewer").slice(0, 80);
            });
            return {channelId, connectedAt, participantCount: participantIds.length, speakerCount: speakerIds.length, viewerCount: Math.min(participantIds.length, viewers.length), participantIds, speakerIds, viewerLabels};
        };
        const guildDetails = (guildId: string) => {
            const guild = guildStore?.getGuild?.(guildId);
            if (!guild || guild.id !== guildId) return;
            const ownerId = normalizeTimelineAccountId(guild.ownerId ?? guild.owner_id);
            const owner = ownerId ? userStore?.getUser?.(ownerId) : undefined;
            const memberCount = memberCountStore?.getMemberCount?.(guildId) ?? guild.memberCount;
            let createdAt: number | undefined;
            try {createdAt = Number(BigInt(guildId) >> 22n) + 1_420_070_400_000;}
            catch {/* malformed ids were already excluded */}
            const rawJoinedAt = guild.joinedAt ?? guild.joined_at;
            const joinedCandidate = rawJoinedAt instanceof Date ? rawJoinedAt.valueOf() : typeof rawJoinedAt === "number" ? rawJoinedAt : typeof rawJoinedAt === "string" ? Date.parse(rawJoinedAt) : Number.NaN;
            const joinedAt = Number.isFinite(joinedCandidate) && joinedCandidate >= 0 ? joinedCandidate : undefined;
            const channelIds = new Set<string>();
            const channelGroups = guildChannelStore?.getChannels?.(guildId);
            if (channelGroups && typeof channelGroups === "object") {
                for (const bucket of Object.values(channelGroups)) {
                    if (!Array.isArray(bucket)) continue;
                    for (const entry of bucket) {
                        const id = normalizeTimelineAccountId(entry?.channel?.id);
                        if (id) channelIds.add(id);
                    }
                }
            }
            const roles = guildRoleStore?.getRoles?.(guildId);
            const roleCount = roles && typeof roles === "object" ? Object.keys(roles).length : undefined;
            const boostCount = typeof guild.premiumSubscriptionCount === "number" && Number.isSafeInteger(guild.premiumSubscriptionCount) && guild.premiumSubscriptionCount >= 0 ? guild.premiumSubscriptionCount : undefined;
            const locale = typeof guild.preferredLocale === "string" && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(guild.preferredLocale) ? guild.preferredLocale : undefined;
            return {
                name: typeof guild.name === "string" ? guild.name.slice(0, 100) : undefined,
                ownerLabel: (owner?.globalName || owner?.username || "").slice(0, 80) || undefined,
                memberCount: typeof memberCount === "number" && Number.isSafeInteger(memberCount) && memberCount >= 0 ? memberCount : undefined,
                createdAt,
                joinedAt,
                channelCount: channelIds.size || undefined,
                roleCount,
                boostCount,
                locale
            };
        };
        const loadedFriends = () => {
            if (!relationshipReaderAvailable || typeof userStore?.getUser !== "function") return [];
            const relationships = relationshipReader?.();
            if (!relationships) return [];
            const statuses = new Set(["online", "idle", "dnd", "offline"]);
            const relationshipTypes = new Map<number, "friend" | "blocked" | "incoming" | "outgoing" | "ignored">([[1, "friend"], [2, "blocked"], [3, "incoming"], [4, "outgoing"], [5, "ignored"]]);
            const entries = relationships instanceof Map ? relationships.entries() : Object.entries(relationships);
            return mapSolcordVisibleRecords(entries, ([id, relationship]) => {
                const relationshipLabel = typeof relationship === "number" ? relationshipTypes.get(relationship) : undefined;
                if (!relationshipLabel) return;
                const normalizedId = normalizeTimelineAccountId(id);
                const user = normalizedId ? userStore.getUser!(normalizedId) : undefined;
                if (!normalizedId || user?.id !== normalizedId) return;
                return {normalizedId, user, relationshipLabel};
            }, ({normalizedId, user, relationshipLabel}) => {
                const rawStatus = presenceStore?.getStatus?.(normalizedId);
                const status = typeof rawStatus === "string" && statuses.has(rawStatus) ? rawStatus as "online" | "idle" | "dnd" | "offline" : "unknown" as const;
                const rawSince = relationshipStore?.getRelationshipSince?.(normalizedId);
                const sinceCandidate = rawSince instanceof Date ? rawSince.valueOf()
                    : typeof rawSince === "number" ? rawSince
                        : typeof rawSince === "string" ? Date.parse(rawSince)
                            : rawSince && typeof rawSince === "object" && typeof (rawSince as {valueOf?(): unknown;}).valueOf === "function" ? Number((rawSince as {valueOf(): unknown;}).valueOf()) : Number.NaN;
                const relationshipSince = Number.isFinite(sinceCandidate) && sinceCandidate >= 0 && sinceCandidate <= Date.now() + 86_400_000 ? sinceCandidate : undefined;
                const rawMutualGuilds = mutualGuildStore?.getMutualGuilds?.(normalizedId);
                const mutualGuildCount = Array.isArray(rawMutualGuilds) ? Math.min(500, rawMutualGuilds.length)
                    : rawMutualGuilds && typeof rawMutualGuilds === "object" ? Math.min(500, Object.keys(rawMutualGuilds as Record<string, unknown>).length) : undefined;
                return {id: normalizedId, label: (user.globalName || user.username || "Unknown person").slice(0, 80), status, relationship: relationshipLabel, relationshipSince, mutualGuildCount};
            });
        };
        const dmUnreadCount = (channelId: string): number => {
            const count = readStateStore?.getMentionCount?.(channelId);
            return typeof count === "number" && Number.isSafeInteger(count) && count > 0 ? Math.min(999, count) : 0;
        };
        const dmLastMessageTimestamp = (channelId: string): number => {
            const messageId = normalizeTimelineAccountId(readStateStore?.lastMessageId?.(channelId));
            if (!messageId) return 0;
            try {return Number(BigInt(messageId) >> 22n) + 1_420_070_400_000;}
            catch {return 0;}
        };
        const dmCategory = (channelId: string): "friends" | "groups" | "bots" | "blocked" | "others" => {
            const channel = channelStore?.getChannel?.(channelId);
            if (channel?.type === 3) return "groups";
            let rawRecipient: unknown;
            try {rawRecipient = channel?.getRecipientId?.() ?? channel?.recipientId ?? channel?.recipients?.[0] ?? channel?.rawRecipients?.[0];}
            catch {return "others";}
            const recipientId = normalizeTimelineAccountId(typeof rawRecipient === "string" ? rawRecipient : rawRecipient && typeof rawRecipient === "object" ? (rawRecipient as {id?: unknown;}).id : undefined);
            if (!recipientId) return "others";
            if (userStore?.getUser?.(recipientId)?.bot === true) return "bots";
            const relationships = relationshipReader?.();
            const relationship = relationships instanceof Map ? relationships.get(recipientId) : relationships?.[recipientId];
            if (relationship === 2) return "blocked";
            if (relationship === 1) return "friends";
            return "others";
        };
        const cachedGuildChannelIds = (guildIds: readonly string[]): string[] => {
            if (typeof guildChannelStore?.getChannels !== "function") return [];
            const result: string[] = [];
            for (const guildId of guildIds) {
                const groups = guildChannelStore.getChannels(guildId);
                if (!groups || typeof groups !== "object") continue;
                for (const bucket of Object.values(groups)) {
                    if (!Array.isArray(bucket)) continue;
                    for (const entry of bucket) {
                        const id = normalizeTimelineAccountId(entry?.channel?.id);
                        if (id) result.push(id);
                        if (result.length >= 500) return [...new Set(result)];
                    }
                }
            }
            return [...new Set(result)];
        };
        const notificationIds = (notificationScope: "guild" | "mentions" | "all"): string[] => {
            if (typeof readStateStore?.hasUnread !== "function" || typeof readStateStore.getMentionCount !== "function" || typeof readStateStore.lastMessageId !== "function") return [];
            const selectedGuildId = normalizeTimelineAccountId(selectedGuildStore?.getGuildId?.());
            const notificationPreferences = nativePreferences.notifications;
            const knownGuildIds = !notificationPreferences.includeGuilds ? [] : notificationScope === "guild"
                ? (selectedGuildId ? [selectedGuildId] : [])
                : Object.keys(guildStore?.getGuilds?.() ?? {}).map(normalizeTimelineAccountId).filter((id): id is string => Boolean(id));
            const channelIds = cachedGuildChannelIds(knownGuildIds);
            if (notificationPreferences.includeDms && notificationScope !== "guild" && typeof channelStore?.getSortedPrivateChannels === "function") {
                for (const channel of channelStore.getSortedPrivateChannels()) {
                    const id = normalizeTimelineAccountId(channel?.id);
                    if (id) channelIds.push(id);
                    if (channelIds.length >= 500) break;
                }
            }
            return [...new Set(channelIds)].filter(id => {
                const channel = channelStore?.getChannel?.(id);
                const guildId = normalizeTimelineAccountId(channel?.guild_id);
                if (!notificationPreferences.includeMuted && guildId && (
                    notificationMuteStore?.isChannelMuted?.(guildId, id) === true
                    || notificationMuteStore?.isGuildOrCategoryOrChannelMuted?.(guildId, id) === true
                )) return false;
                return notificationScope === "mentions" ? readStateStore.getMentionCount!(id) > 0 : readStateStore.hasUnread!(id) || readStateStore.getMentionCount!(id) > 0;
            }).slice(0, 500);
        };
        const markNotificationsRead = (_scope: "guild" | "mentions" | "all", reviewedIds: readonly string[], reviewedMessages: Readonly<Record<string, string>> = {}): void => {
            if (typeof readStateStore?.lastMessageId !== "function" || typeof DiscordModules.Dispatcher?.dispatch !== "function") throw new Error("Discord's reviewed notification action is unavailable.");
            const channels = reviewedIds.slice(0, 500).map(channelId => {
                const id = normalizeTimelineAccountId(channelId);
                const messageId = id ? normalizeTimelineAccountId(reviewedMessages[id]) : undefined;
                return id && messageId ? {channelId: id, messageId, readStateType: 0} : undefined;
            }).filter((entry): entry is {channelId: string; messageId: string; readStateType: number;} => Boolean(entry));
            if (!channels.length) return;
            DiscordModules.Dispatcher.dispatch({type: "BULK_ACK", context: "APP", channels});
        };
        const notificationMuteReviewAvailable = nativePreferences.notifications.includeMuted
            || typeof notificationMuteStore?.isChannelMuted === "function"
            || typeof notificationMuteStore?.isGuildOrCategoryOrChannelMuted === "function";
        const notificationAdapterAvailable = typeof guildChannelStore?.getChannels === "function"
            && typeof readStateStore?.hasUnread === "function"
            && typeof readStateStore.getMentionCount === "function"
            && typeof readStateStore.lastMessageId === "function"
            && typeof DiscordModules.Dispatcher?.dispatch === "function"
            && notificationMuteReviewAvailable;
        const promptToUpload = DiscordModules.promptToUpload;
        const saveVoiceNoteFile = lookups.voiceNoteStudio && typeof URL.createObjectURL === "function" && typeof URL.revokeObjectURL === "function"
            ? (file: File) => {
                const url = URL.createObjectURL(file);
                const releaseUrl = scope.own(() => URL.revokeObjectURL(url), "object-url");
                const link = document.createElement("a");
                link.href = url;
                link.download = file.name;
                link.rel = "noopener";
                link.hidden = true;
                try {
                    document.body.append(link);
                    link.click();
                }
                catch (error) {
                    releaseUrl();
                    throw error;
                }
                finally {link.remove();}
                scope.timeout(releaseUrl, 60_000);
            }
            : undefined;
        return {
            onStatusChange: () => this.emitChange(),
            currentCall: voiceParticipantContextAvailable ? currentCall : undefined,
            voiceActivityAvailable: callContextAvailable && voiceActivityAvailable,
            spectatorsAvailable: callContextAvailable && spectatorsAvailable,
            spectatorsReady: callContextAvailable && spectatorsAvailable ? () => {
                const stream = streamingCapability.value?.currentStream();
                if (!stream) return false;
                streamingCapability.value?.viewerIds(stream);
                return true;
            } : undefined,
            currentChannelId: lookups.voiceNoteStudio && typeof selectedChannelStore?.getChannelId === "function" ? () => normalizeTimelineAccountId(selectedChannelStore.getChannelId?.()) : undefined,
            subscribeCall: voiceParticipantContextAvailable ? listener => subscribeSolcordChangeStores(scope, callContextStores as Array<Required<FluxStore>>, listener) : undefined,
            setLocalVolume: localVolumeCapability.value ? (userId, percent) => localVolumeCapability.value!.apply(userId, percent) : undefined,
            localVolumeCapability: localVolumeCapability.state,
            localVolumeCapabilityDetail: localVolumeCapability.detail,
            loadedChannelMessages: typeof messageStore?.getMessages === "function" ? channelId => {
                const collection = messageStore.getMessages!(channelId);
                const messages = Array.isArray(collection) ? collection : collection?.toArray?.();
                if (!Array.isArray(messages)) return;
                return messages.slice(-5).map(message => ({
                    id: normalizeTimelineAccountId(message.id) ?? "0",
                    authorLabel: (message.author?.globalName || message.author?.username || "Unknown").slice(0, 80),
                    text: (message.content || "").slice(0, 2_000),
                    timestamp: typeof message.timestamp === "number" ? message.timestamp : message.timestamp?.valueOf?.() ?? Date.now()
                }));
            } : undefined,
            notificationIds: notificationAdapterAvailable ? notificationIds : undefined,
            notificationMessageId: notificationAdapterAvailable ? channelId => normalizeTimelineAccountId(readStateStore?.lastMessageId?.(channelId)) : undefined,
            notificationAccountId: notificationAdapterAvailable ? () => normalizeTimelineAccountId(userStore?.getCurrentUser?.()?.id) : undefined,
            markNotificationsRead: notificationAdapterAvailable ? markNotificationsRead : undefined,
            voiceHealthSample: voiceHealthCapability.reader,
            voiceHealthInitialSample: voiceHealthCapability.initialSample,
            voiceHealthCapability: voiceHealthCapability.state,
            voiceHealthCapabilityDetail: voiceHealthCapability.detail,
            voiceNoteCaptureCapability: voiceNoteCapture.state,
            voiceNoteCaptureDetail: voiceNoteCapture.detail,
            prepareVoiceNoteUpload: typeof promptToUpload === "function" && typeof channelStore?.getChannel === "function" ? (channelId, file) => {
                const channel = channelStore.getChannel!(channelId);
                if (!channel) throw new Error("The selected channel is unavailable.");
                promptToUpload([file], channel as never, 0);
            } : undefined,
            saveVoiceNoteFile,
            guildDetails: lookups.peopleAndSpaces && typeof guildStore?.getGuild === "function" ? guildDetails : undefined,
            loadedFriends: lookups.peopleAndSpaces && relationshipReaderAvailable && typeof userStore?.getUser === "function" ? loadedFriends : undefined,
            dmUnreadCount: lookups.peopleAndSpaces && typeof readStateStore?.getMentionCount === "function" ? dmUnreadCount : undefined,
            dmLastMessageTimestamp: lookups.peopleAndSpaces && typeof readStateStore?.lastMessageId === "function" ? dmLastMessageTimestamp : undefined,
            dmCategory: lookups.peopleAndSpaces && typeof channelStore?.getChannel === "function" ? dmCategory : undefined,
            peopleState: this.#sessionPeopleState,
            peopleStatePersistence: this.#peopleStatePersistent ? "encrypted" : "session",
            savePeopleState: state => {
                if (!privateIdentity || !this.#privateUiIdentityIsCurrent(privateIdentity)) throw new Error("Discord account changed. Reopen People and Spaces before editing.");
                const next = normalizePrivatePeopleState(state);
                this.#sessionPeopleState = next;
                this.#peopleStatePersistent = false;
                this.emitChange();
                void this.#persistPeopleState(next);
            },
            focusChannelIds: this.#sessionFocusChannelIds,
            voiceHealthEnabled,
            composerPreferences: nativePreferences.composer,
            timestampPreferences: nativePreferences.timestamps,
            peoplePreferences: nativePreferences.people,
            voiceActivityPreferences: nativePreferences.voiceActivity,
            voiceActivityCurrentUserId: normalizeTimelineAccountId(userStore?.getCurrentUser?.()?.id),
            currentVoiceContext: lookups.callContext && voiceChannelCapability.value && typeof channelStore?.getChannel === "function" ? () => {
                const channelId = voiceChannelCapability.value?.();
                if (!channelId) return;
                const channel = channelStore.getChannel!(channelId);
                return {channelId, ...(normalizeTimelineAccountId(channel?.guild_id) ? {guildId: normalizeTimelineAccountId(channel?.guild_id)} : {})};
            } : undefined,
            streamerModeActive: lookups.peopleAndSpaces ? () => streamerModeStore?.enabled === true || streamerModeStore?.getSettings?.()?.enabled === true : undefined,
            subscribeStreamerMode: lookups.peopleAndSpaces && typeof streamerModeStore?.addChangeListener === "function" && typeof streamerModeStore.removeChangeListener === "function"
                ? listener => subscribeSolcordChangeStores(scope, [streamerModeStore as Required<FluxStore>], listener)
                : undefined,
            voiceNotePreferences: nativePreferences.voiceNotes,
            notificationPreferences: nativePreferences.notifications,
            motionPreferences: nativePreferences.motion,
            motionPolicy: {effectiveMotion: motionPolicy.effectiveMotion, ambientEffects: motionPolicy.ambientEffects},
            saveFocusChannelIds: channelIds => {
                this.#sessionFocusChannelIds = [...channelIds];
                this.emitChange();
            },
            identityNotesAvailable: Boolean(this.#privateCapability),
            translationPreferences: nativePreferences.translation,
            externalProvidersAllowed: () => SolcordSettings.snapshot().productPreferences.privacy.externalProviders === "approved-only"
        };
    }

    #doubleClickReplyAdapter(): DoubleClickReplyAdapter {
        type DiscordMessage = {id?: string; channel_id?: string; author?: {id?: string;};};
        type DiscordChannel = {id?: string; guild_id?: string;};
        const messageStore = getStore("MessageStore") as {getMessage?: (channelId: string, messageId: string) => DiscordMessage | undefined;} | undefined;
        const channelStore = getStore("ChannelStore") as {getChannel?: (channelId: string) => DiscordChannel | undefined;} | undefined;
        const [replyModule, replyKey] = getWithKey(candidate => typeof candidate === "function" && String(candidate).includes("CREATE_PENDING_REPLY"));
        const replyFunction = typeof replyKey === "string" && replyModule ? replyModule[replyKey] : undefined;

        const messageIdentity = (element: Element): {channelId: string; messageId: string;} | undefined => {
            const container = element.closest<HTMLElement>("[data-list-item-id^='chat-messages'], [id^='chat-messages-']");
            const identity = container?.getAttribute("data-list-item-id") ?? container?.id;
            const match = identity?.match(/chat-messages(?:___|[_-])(\d{1,32})[_-](\d{1,32})/);
            if (!match) return;
            return {channelId: match[1], messageId: match[2]};
        };
        const resolve = (target: DoubleClickReplyTarget): {message: DiscordMessage; channel: DiscordChannel;} | undefined => {
            const message = messageStore?.getMessage?.(target.channelId, target.messageId);
            const channel = channelStore?.getChannel?.(target.channelId);
            if (message?.id !== target.messageId || message.channel_id !== target.channelId || channel?.id !== target.channelId) return;
            return {message, channel};
        };

        return {
            validate: () => typeof messageStore?.getMessage === "function"
                && typeof channelStore?.getChannel === "function"
                && typeof replyFunction === "function"
                && typeof replyKey === "string",
            installDoubleClickListener: listener => {
                const handler = (event: Event) => listener(event);
                document.addEventListener("dblclick", handler, true);
                return () => document.removeEventListener("dblclick", handler, true);
            },
            installAltClickSuppressor: () => {
                const handler = (event: MouseEvent) => {
                    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0 || !(event.target instanceof Element)) return;
                    if (!messageIdentity(event.target)) return;
                    event.preventDefault();
                    event.stopImmediatePropagation();
                };
                document.addEventListener("click", handler, true);
                return () => document.removeEventListener("click", handler, true);
            },
            inspect: event => {
                if (!(event instanceof MouseEvent) || !(event.target instanceof Element)) return null;
                const identity = messageIdentity(event.target);
                const resolved = identity && resolve(identity);
                if (!identity || !resolved) return null;
                const selection = window.getSelection?.();
                const ancestors = event.composedPath().flatMap(node => node instanceof HTMLElement ? [{
                    tagName: node.tagName,
                    role: node.getAttribute("role"),
                    contentEditable: node.getAttribute("contenteditable"),
                    solcordOwned: [...node.classList].some(name => name.startsWith("solcord-"))
                }] : []);
                return {
                    eventType: event.type,
                    button: event.button,
                    detail: event.detail,
                    altKey: event.altKey,
                    ctrlKey: event.ctrlKey,
                    metaKey: event.metaKey,
                    shiftKey: event.shiftKey,
                    hasSelection: Boolean(selection && !selection.isCollapsed),
                    ancestors,
                    message: identity
                } satisfies DoubleClickReplyContext;
            },
            requestReply: target => {
                const resolved = resolve(target);
                if (!resolved || typeof replyFunction !== "function" || !replyModule || typeof replyKey !== "string") return;
                Reflect.apply(replyFunction, replyModule, [{
                    channel: resolved.channel,
                    message: resolved.message,
                    shouldMention: true,
                    showMentionToggle: Boolean(resolved.channel.guild_id)
                }]);
            }
        };
    }

    #showGuardedSplitReview(scope: SolcordDisposalScope, content: string): void {
        if (this.#splitReviewOpen) return;
        const settings = SolcordSettings.snapshot().productPreferences.nativeSuite.composer;
        const preview = planLargeMessage(content, {
            limit: settings.splitLimit,
            delayMs: 1_200,
            boundary: settings.splitBoundary,
            preserveBlankLines: settings.preserveBlankLines,
            maxParts: settings.maxSplitParts,
            attachmentThreshold: settings.attachmentThreshold
        });
        if (!preview.attachment && preview.parts.length < 2) return;
        this.#splitReviewOpen = true;
        const summaries = preview.parts.map((part, index) => {
            const sample = part.slice(0, 140).replace(/[`*_~|]/g, " ").replace(/\s+/g, " ");
            return `Part ${index + 1}/${preview.parts.length} · ${part.length} characters · ${sample}${part.length > 140 ? "…" : ""}`;
        });
        if (typeof Modals.ModalActions?.closeModal !== "function") {
            this.#splitReviewOpen = false;
            return;
        }
        const previousHref = window.location.href;
        let finished = false;
        let modalKey: string | number | undefined;
        let routeTimer = 0;
        let release = () => {};
        let releaseRouteTimer = () => {};
        const dispose = () => {
            releaseRouteTimer();
            const shouldClose = !finished;
            finished = true;
            this.#splitReviewOpen = false;
            if (shouldClose && (typeof modalKey === "string" || typeof modalKey === "number")) Modals.ModalActions?.closeModal(modalKey);
        };
        const finish = () => {
            if (finished) return;
            finished = true;
            release();
        };
        try {
            const attachment = preview.attachment;
            const openedModal = Modals.showConfirmationModal(attachment ? "Save reviewed text file" : "Guarded message split", [
                attachment
                    ? `${attachment.text.length.toLocaleString("en-US")} characters reached your local text-file threshold.`
                    : `${preview.parts.length} parts · ${preview.delayMs} ms planned spacing · ${preview.totalDelayMs} ms total delay.`,
                attachment
                    ? "Solcord will save a local .txt file. It will not attach or send it."
                    : "Solcord will not send automatically. Confirm to copy the ordered parts, then review and send each part yourself.",
                ...(preview.truncated ? [`Your ${preview.maxParts}-part cap omits ${preview.omittedCharacters.toLocaleString("en-US")} characters. Nothing omitted will be sent or copied.`] : []),
                ...summaries
            ], {
                key: "solcord-guarded-split-review",
                confirmText: attachment ? "Save .txt locally" : "Copy ordered parts",
                cancelText: "Keep editing",
                onConfirm: () => {
                    finish();
                    if (attachment) {
                        const url = URL.createObjectURL(new Blob([attachment.text], {type: attachment.mime}));
                        try {
                            const anchor = document.createElement("a");
                            anchor.href = url;
                            anchor.download = attachment.fileName;
                            anchor.click();
                        }
                        finally {URL.revokeObjectURL(url);}
                    }
                    else {void navigator.clipboard.writeText(preview.parts.join("\n\n--- Solcord part break ---\n\n")).catch(() => Logger.warn("Solcord", "Guarded splitter clipboard write was unavailable."));}
                },
                onCancel: finish,
                onClose: finish
            });
            modalKey = typeof openedModal === "string" || typeof openedModal === "number" ? openedModal : "solcord-guarded-split-review";
            release = scope.own(dispose, "element");
            if (scope.disposed) return;
            routeTimer = globalThis.setInterval(() => {
                if (window.location.href !== previousHref) release();
            }, 200) as unknown as number;
            releaseRouteTimer = scope.own(() => globalThis.clearInterval(routeTimer), "interval");
        }
        catch {
            dispose();
        }
    }

    async #synchronizeFeatures(ids: readonly SolcordModuleId[] = FEATURE_IDS): Promise<void> {
        const fullSynchronization = ids === FEATURE_IDS;
        if (fullSynchronization) this.#applyProductPresentation();
        if (!this.#started) return;
        if (fullSynchronization) {
            this.#synchronizeBaselineSuite();
            this.#synchronizePrivacyPolicy();
        }
        // Settings import, setup completion, profile apply, and rollback all converge here.
        // Reapply presentation so those atomic paths do not leave the saved controls inert
        // until a restart or a later direct Appearance edit.
        for (const id of ids) {
            const shouldRun = !this.#recoveryMode || id === "plugin-doctor";
            const enabled = SolcordSettings.module(id).enabled && shouldRun;
            if (enabled) {
                this.#stopFeature(id);
                await this.#startFeature(id);
            }
            else {
                this.#stopFeature(id);
            }
        }
        if (fullSynchronization) {
            this.#synchronizeCuratedAdapters();
            await this.#synchronizePowerLab();
        }
    }

    async #synchronizePowerLab(): Promise<void> {
        const consent = SolcordSettings.snapshot().powerLab["fake-deafen"];
        if (this.#recoveryMode || !consent.enabled) {
            this.#fakeDeafenGeneration++;
            this.#stopFakeDeafen(false);
            return;
        }
        const communityAddon = PluginManager.resolveAddon("FakeDeafen") ?? PluginManager.resolveAddon("FakeDeafen.plugin.js");
        if (communityAddon && PluginManager.isEnabled(communityAddon.filename)) {
            this.#fakeDeafenGeneration++;
            this.#stopFakeDeafen(false);
            this.#fakeDeafenStatus = {phase: "attention", detail: "The community FakeDeafen plugin is active. Disable it before loading Solcord's scoped adapter; Solcord will not stack both patches.", connected: false, accountBound: false, capturedVoiceState: false, armed: false};
            this.emitChange();
            return;
        }
        if (this.#fakeDeafen) return;
        const generation = ++this.#fakeDeafenGeneration;

        this.#fakeDeafenScope.dispose();
        this.#fakeDeafenScope = new SolcordDisposalScope();
        const scope = this.#fakeDeafenScope;
        const cancellation = new AbortController();
        const releaseDiscovery = scope.own(() => cancellation.abort());
        const userStore = getStore("UserStore") as {getCurrentUser?: () => {id?: string;} | undefined;} | undefined;
        const accountId = normalizeTimelineAccountId(userStore?.getCurrentUser?.()?.id);
        this.#fakeDeafenStatus = {phase: "ready", detail: "Waiting for Discord's voice controls. The adapter will stay off if they are unavailable.", connected: false, accountBound: false, capturedVoiceState: false, armed: false, pending: true};
        this.#fakeDeafenButton?.update(this.#fakeDeafenStatus);
        this.emitChange();
        let capabilities;
        try {
            capabilities = await discoverSolcordFakeDeafenCapabilities({
                gateway: signal => getLazy(isSolcordFakeDeafenGateway, {signal}),
                mediaActions: signal => getLazy(isSolcordFakeDeafenMediaActions, {signal})
            }, cancellation.signal);
        }
        finally {releaseDiscovery();}
        if (generation !== this.#fakeDeafenGeneration || scope.disposed || this.#fakeDeafenScope !== scope) return;
        const {gateway, mediaActions} = capabilities ?? {};
        const selectedChannelStore = getStore("SelectedChannelStore") as {getVoiceChannelId?: () => string | undefined;} | undefined;
        const mediaEngineStore = getStore("MediaEngineStore") as {isDeaf?: () => boolean; isSelfDeaf?: () => boolean;} | undefined;
        const socket = gateway?.getSocket?.();
        if (!socket || typeof socket.send !== "function" || !mediaActions || typeof selectedChannelStore?.getVoiceChannelId !== "function" || typeof userStore?.getCurrentUser !== "function" || !accountId || accountId !== normalizeTimelineAccountId(userStore.getCurrentUser()?.id) || (typeof mediaEngineStore?.isDeaf !== "function" && typeof mediaEngineStore?.isSelfDeaf !== "function")) {
            this.#fakeDeafenStatus = {phase: "attention", detail: "Discord voice or account controls are unavailable or changed while loading. Fake Deafen stayed off; click again to retry.", connected: false, accountBound: false, capturedVoiceState: false, armed: false};
            this.#fakeDeafenButton?.update(this.#fakeDeafenStatus);
            this.emitChange();
            return;
        }

        let scheduleOwnRowRefresh = () => {};
        const controller = new SolcordFakeDeafenController({
            getAccountId: () => normalizeTimelineAccountId(userStore.getCurrentUser?.()?.id),
            getSocket: () => gateway?.getSocket?.(),
            getConnectionIdentity: () => (gateway?.getSocket?.() as SolcordGatewaySocket & {webSocket?: unknown;} | undefined)?.webSocket,
            getVoiceChannelId: () => selectedChannelStore.getVoiceChannelId?.(),
            isLocallyDeafened: () => Boolean(mediaEngineStore.isSelfDeaf?.() ?? mediaEngineStore.isDeaf?.()),
            toggleLocalDeafen: () => mediaActions.toggleSelfDeaf!(),
            patchSend: (target, before, after) => patchSolcordFakeDeafenSend(target, before, after, Patcher),
            onStatus: status => {
                if (generation !== this.#fakeDeafenGeneration || scope.disposed || this.#fakeDeafenScope !== scope) return;
                const presentationChanged = status.armed !== this.#fakeDeafenStatus.armed;
                this.#fakeDeafenStatus = status;
                this.#fakeDeafenButton?.update(status);
                if (presentationChanged) scheduleOwnRowRefresh();
                this.emitChange();
            }
        });
        // Starting publishes status synchronously. Own the controller first so
        // a throwing observer or reentrant stop cannot orphan its gateway patch.
        this.#fakeDeafen = controller;
        scope.own(() => controller.stop(), "patch");
        if (!controller.start()) {
            const failedStatus = controller.snapshot();
            this.#stopFakeDeafen();
            if (!this.#fakeDeafen) {
                this.#fakeDeafenStatus = failedStatus;
                this.#fakeDeafenButton?.update(failedStatus);
                this.emitChange();
            }
            return;
        }
        if (generation !== this.#fakeDeafenGeneration || scope.disposed || this.#fakeDeafenScope !== scope || this.#fakeDeafen !== controller) return;
        // Discord loads this presentation helper with its guild call layout.
        // Watch for that arrival without blocking voice activation or fetching
        // another chunk. The scope owns and aborts the one lazy listener.
        const indicatorCancellation = new AbortController();
        const releaseIndicatorDiscovery = scope.own(() => indicatorCancellation.abort());
        const connectionIdentity = socket.webSocket;
        const ownsIndicator = () => generation === this.#fakeDeafenGeneration && !scope.disposed && this.#fakeDeafenScope === scope && this.#fakeDeafen === controller;
        this.#fakeDeafenIndicatorReady = false;
        const readRowIdentity = () => {
            try {
                const userId = normalizeTimelineAccountId(userStore.getCurrentUser?.()?.id);
                const channelId = normalizeTimelineAccountId(selectedChannelStore.getVoiceChannelId?.());
                const authentication = getStore("AuthenticationStore") as {getSessionId?: () => unknown;} | undefined;
                const sessionId = authentication?.getSessionId?.();
                if (userId !== accountId || !channelId || typeof sessionId !== "string" || !sessionId || sessionId.length > 256) return;
                return {userId, channelId, sessionId};
            }
            catch {return;}
        };
        const refreshRow = (identity: NonNullable<ReturnType<typeof readRowIdentity>>, owns: () => boolean) => {
            refreshSolcordFakeDeafenCurrentChannelRow({
                root: document.getElementById("app-mount"),
                channelId: identity.channelId,
                getInternalInstance,
                isCurrent: () => {
                    const current = readRowIdentity();
                    return owns() && current?.userId === identity.userId && current?.channelId === identity.channelId && current?.sessionId === identity.sessionId;
                }
            });
        };
        let rowRefreshQueued = false;
        scheduleOwnRowRefresh = () => {
            if (rowRefreshQueued || !ownsIndicator() || !this.#fakeDeafenIndicatorReady) return;
            const identity = readRowIdentity();
            if (!identity) return;
            rowRefreshQueued = true;
            queueMicrotask(() => {rowRefreshQueued = false; if (ownsIndicator()) refreshRow(identity, ownsIndicator);});
        };
        type VoicePresentationModule = Record<string, (...args: unknown[]) => unknown>;
        void getLazy<VoicePresentationModule>(isSolcordFakeDeafenPresentationModule, {signal: indicatorCancellation.signal, searchDefault: false}).then(target => {
            if (!target || !ownsIndicator()) return;
            const key = findSolcordFakeDeafenPresentationKey(target);
            if (!key) return;
            const unpatch = Patcher.after("Solcord~FakeDeafenIndicator", target, key, (_thisObject, args, result) => {
                try {
                    if (!this.#fakeDeafenStatus.armed || !ownsIndicator() || !args[0] || typeof args[0] !== "object" || (args[0] as {userId?: unknown;}).userId !== accountId) return result;
                    if (!controller.canPresentArmedState() || normalizeTimelineAccountId(userStore.getCurrentUser?.()?.id) !== accountId || gateway?.getSocket?.() !== socket || socket.webSocket !== connectionIdentity) return result;
                    const authentication = getStore("AuthenticationStore") as {getSessionId?: () => unknown;} | undefined;
                    return preserveSolcordOwnVoiceDeafenPresentation(args[0], args[1], result, {
                        userId: accountId,
                        channelId: selectedChannelStore.getVoiceChannelId?.(),
                        sessionId: authentication?.getSessionId?.(),
                        status: this.fakeDeafenStatus()
                    });
                }
                catch {return result;}
            }, {forcePatch: false});
            if (typeof unpatch !== "function") return;
            scope.own(() => {
                const identity = readRowIdentity();
                unpatch();
                // Native hooks do not subscribe to Solcord. Refresh the exact
                // current row after unpatch even when no native snapshot changes.
                const cleanupGeneration = this.#fakeDeafenGeneration;
                if (identity) queueMicrotask(() => refreshRow(identity, () => cleanupGeneration === this.#fakeDeafenGeneration));
            }, "patch");
            if (!ownsIndicator()) return;
            this.#fakeDeafenIndicatorReady = true;
            scheduleOwnRowRefresh();
            this.emitChange();
        }).catch(() => {
            if (ownsIndicator()) Logger.warn("Solcord", "Fake Deafen's own-row indicator is unavailable on this Discord layout.");
        }).finally(releaseIndicatorDiscovery);
        // Flux listeners only schedule work: never dispatch a native action from
        // inside another store's dispatch. Read only our own voice record, and
        // avoid rerendering the suite for other participants' voice updates.
        let voiceSignature = JSON.stringify(this.fakeDeafenStatus().voice);
        let voiceUpdateQueued = false;
        const refreshVoiceState = () => {
            if (generation !== this.#fakeDeafenGeneration || scope.disposed || this.#fakeDeafenScope !== scope || this.#fakeDeafen !== controller) return;
            try {
                if (!controller.validateOwnership()) return;
                const next = JSON.stringify(this.fakeDeafenStatus().voice);
                if (next === voiceSignature) return;
                voiceSignature = next;
                scheduleOwnRowRefresh();
                this.emitChange();
            }
            catch {Logger.warn("Solcord", "Fake Deafen voice-state observation is unavailable.");}
        };
        const scheduleVoiceState = () => {
            if (voiceUpdateQueued || scope.disposed) return;
            voiceUpdateQueued = true;
            queueMicrotask(() => {voiceUpdateQueued = false; refreshVoiceState();});
        };
        type ObservableVoiceStore = {addChangeListener?(listener: () => void): void; removeChangeListener?(listener: () => void): void;};
        for (const candidate of [mediaEngineStore, getStore("VoiceStateStore"), selectedChannelStore]) {
            const store = candidate as ObservableVoiceStore | undefined;
            if (typeof store?.addChangeListener !== "function" || typeof store.removeChangeListener !== "function") continue;
            const release = scope.own(() => store.removeChangeListener?.(scheduleVoiceState), "listener");
            try {store.addChangeListener(scheduleVoiceState);}
            catch {release();}
            if (generation !== this.#fakeDeafenGeneration || scope.disposed || this.#fakeDeafenScope !== scope || this.#fakeDeafen !== controller) {
                // A host can finish registration after reentering stop. The
                // scope's earlier remover ran before that late addition.
                store.removeChangeListener(scheduleVoiceState);
                return;
            }
        }
        scope.interval(refreshVoiceState, 5_000);
        this.#fakeDeafenStatus = controller.snapshot();
        this.#fakeDeafenButton?.update(this.#fakeDeafenStatus);
        this.emitChange();
    }

    #ensureFakeDeafenButton(): void {
        if (this.#fakeDeafenButton) {
            this.#fakeDeafenButton.update(this.#fakeDeafenStatus);
            this.#fakeDeafenButton.reconcile();
            return;
        }
        const directVoiceControl = new SolcordFakeDeafenButton({
            document,
            getStatus: () => this.fakeDeafenStatus(),
            toggle: () => this.toggleFakeDeafenDirect(),
            onError: detail => Toasts.error(detail, {forceShow: true})
        });
        if (!directVoiceControl.start()) return;
        this.#fakeDeafenButton = directVoiceControl;
        this.#rootScope.own(() => {
            directVoiceControl.stop();
            if (this.#fakeDeafenButton === directVoiceControl) this.#fakeDeafenButton = undefined;
        }, "element");
    }

    #recordPrivacyDecision(receipt: PrivacyDecisionReceipt): void {
        const latest = [...this.#privacyReceipts].reverse().find(item => item.dataClass === receipt.dataClass);
        if (latest
            && latest.timeBucket === receipt.timeBucket
            && latest.decision === receipt.decision
            && latest.result === receipt.result) return;
        const next = {...receipt, sequence: ++this.#privacySequence};
        this.#privacyReceipts.push(next);
        this.#privacyReceipts.splice(0, Math.max(0, this.#privacyReceipts.length - 100));
        try {
            JsonStore.set("misc", "solcordPrivacyReceipts", structuredClone(this.#privacyReceipts));
            this.#privacyReceiptStorage = "persistent";
        }
        catch {
            if (this.#privacyReceiptStorage !== "session-only") Logger.warn("Solcord", "Privacy diagnostics are session-only because local storage is unavailable. Privacy enforcement remains active.");
            this.#privacyReceiptStorage = "session-only";
        }
    }

    #synchronizeNativePrivacyPolicy(preferences: SolcordPrivacyPreferences): Promise<void> {
        const generation = ++this.#privacyNativeGeneration;
        const notify = () => {
            try {this.emitChange();}
            catch (error) {Logger.warn("Solcord", `Privacy status observer failed (${errorName(error)}); native policy synchronization continues.`);}
        };
        this.#privacyNativeStatus = {state: "pending", profile: preferences.profile};
        notify();
        return boundedSolcordStartupOperation(Promise.resolve().then(() => IPC.synchronizePrivacyPolicy(preferences))).then(acknowledgement => {
            if (generation !== this.#privacyNativeGeneration) return;
            if (acknowledgement?.telemetry !== preferences.telemetry || acknowledgement?.crashReporting !== preferences.crashReporting) throw new Error("NativePrivacyPolicyMismatch");
            this.#privacyNativeStatus = {state: "applied", profile: preferences.profile};
            notify();
        }).catch(error => {
            Logger.warn("Solcord", `Native optional-network policy could not be confirmed (${errorName(error)}); review the effective protection status.`);
            if (generation !== this.#privacyNativeGeneration) return;
            this.#privacyNativeStatus = {state: "failed", profile: preferences.profile};
            notify();
        });
    }

    #synchronizePrivacyPolicy(): Promise<void> {
        const preferences = SolcordSettings.snapshot().productPreferences.privacy;
        const nativePolicy = this.#synchronizeNativePrivacyPolicy(preferences);
        setSolcordAutomaticUpdatesAllowed(preferences.updates === "automatic");
        if (SolcordSettings.snapshot().productPreferences.privacy.externalProviders !== "approved-only") this.#nativeSuite?.cancelExternalTranslations();
        try {this.#privacyScope.dispose();}
        catch (error) {
            const detail = `Privacy adapter cleanup is incomplete (${errorName(error)}). Solcord retained ownership and will not install a second policy; restart Discord before relying on optional-data protection.`;
            Logger.warn("Solcord", detail);
            this.#privacyCapabilities = this.#privacyCapabilities.map(record => record.dataClass === "core-discord"
                ? record
                : {...record, state: "Degraded", summary: detail});
            this.emitChange();
            return nativePolicy;
        }
        this.#privacyScope = new SolcordDisposalScope();

        const analyticsContainer = getModule<Record<string, unknown>>(candidate => Boolean(resolveDiscordAnalyticsTrack(candidate)), {firstId: 129230, cacheId: "solcord-analytics-container", searchDefault: false});
        const crashModule = getByKeys<Record<string, unknown>>(["captureException", "captureMessage"]);
        const nativeProcessUtils = (globalThis as typeof globalThis & {DiscordNative?: {processUtils?: Record<string, unknown>;};}).DiscordNative?.processUtils;
        const runningGameStore = getStore("RunningGameStore") as unknown as Record<string, unknown> | undefined;
        const runningGamePrototype = runningGameStore ? Object.getPrototypeOf(runningGameStore) as Record<string, unknown> | null : null;
        const dispatcher = DiscordModules.Dispatcher as unknown as Record<string, unknown> | undefined;
        const activitySpecs: PrivacyMethodSpec[] = [];
        if (typeof nativeProcessUtils?.getProcesses === "function") {
            activitySpecs.push({
                id: "native-process-discovery",
                dataClass: "activity-discovery",
                key: "getProcesses",
                lookup: () => nativeProcessUtils,
                validate: candidate => candidate.module === nativeProcessUtils && candidate.key === "getProcesses",
                blockedValue: () => Promise.resolve([])
            });
        }
        if (runningGamePrototype && dispatcher
            && typeof dispatcher.dispatch === "function"
            && typeof dispatcher.subscribe === "function"
            && typeof dispatcher.unsubscribe === "function"
            && typeof runningGamePrototype.getRunningGames === "function"
            && typeof runningGamePrototype.getVisibleRunningGames === "function") {
            activitySpecs.push({
                id: "running-game-dispatch",
                dataClass: "activity-discovery",
                key: "dispatch",
                lookup: () => dispatcher,
                validate: candidate => candidate.module === dispatcher
                    && candidate.key === "dispatch"
                    && typeof dispatcher.subscribe === "function"
                    && typeof dispatcher.unsubscribe === "function",
                blockedValue: () => undefined,
                intercept: (thisObject, args, original) => {
                    const [action, ...rest] = args;
                    if (!action || typeof action !== "object" || (action as {type?: unknown;}).type !== "RUNNING_GAMES_CHANGE") return Reflect.apply(original, thisObject, args);
                    if (!Array.isArray((action as {games?: unknown;}).games)) return undefined;
                    return Reflect.apply(original, thisObject, [{...action, games: []}, ...rest]);
                }
            });
            const emptyArrayMethods = [
                "getRunningGames",
                "getVisibleRunningGames",
                "getRunningNonGames",
                "getRunningDiscordApplicationIds",
                "getRunningVerifiedApplicationIds",
                "getCandidateGames"
            ] as const;
            const emptyValueMethods = ["getVisibleGame", "getCurrentGameForAnalytics", "getCurrentNonGameForAnalytics"] as const;
            for (const key of emptyArrayMethods) {
                activitySpecs.push({
                    id: `running-game-${key}`,
                    dataClass: "activity-discovery",
                    key,
                    lookup: () => runningGamePrototype,
                    validate: candidate => candidate.module === runningGamePrototype && candidate.key === key,
                    blockedValue: () => []
                });
            }
            for (const key of emptyValueMethods) {
                activitySpecs.push({
                    id: `running-game-${key}`,
                    dataClass: "activity-discovery",
                    key,
                    lookup: () => runningGamePrototype,
                    validate: candidate => candidate.module === runningGamePrototype && candidate.key === key,
                    blockedValue: () => undefined
                });
            }
            for (const key of ["isObservedAppRunning", "isDetectionEnabled"] as const) {
                activitySpecs.push({
                    id: `running-game-${key}`,
                    dataClass: "activity-discovery",
                    key,
                    lookup: () => runningGamePrototype,
                    validate: candidate => candidate.module === runningGamePrototype && candidate.key === key,
                    blockedValue: () => false
                });
            }
        }
        const adapter = new SolcordPrivacyPolicyAdapter({
            scope: this.#privacyScope,
            patcher: Patcher,
            preferences: () => SolcordSettings.snapshot().productPreferences.privacy,
            receipt: receipt => this.#recordPrivacyDecision(receipt),
            specs: [
                ...discordAnalyticsMethods(analyticsContainer).map(method => ({
                    id: `discord-analytics-${method.key}`,
                    dataClass: "telemetry" as const,
                    key: method.key,
                    lookup: () => (method.lookup() as AnalyticsMethodTarget | undefined)?.module,
                    validate: method.validate,
                    blockedValue: method.blockedValue ?? (() => undefined)
                })),
                {
                    id: "optional-crash-exception",
                    dataClass: "crash-reporting",
                    key: "captureException",
                    lookup: () => crashModule,
                    validate: candidate => candidate.module === crashModule && Boolean(resolvePrivacyMethodTarget(crashModule, "captureMessage")),
                    blockedValue: () => undefined
                },
                {
                    id: "optional-crash-message",
                    dataClass: "crash-reporting",
                    key: "captureMessage",
                    lookup: () => crashModule,
                    validate: candidate => candidate.module === crashModule && Boolean(resolvePrivacyMethodTarget(crashModule, "captureException")),
                    blockedValue: () => undefined
                },
                ...activitySpecs
            ]
        });
        const optional = adapter.start();
        const core: PrivacyCapabilityRecord = {dataClass: "core-discord", state: "Protected", summary: "Authentication, chat, voice, media, moderation, safety, and client security updates remain allowed."};
        const updates: PrivacyCapabilityRecord = preferences.updates === "manual"
            ? {dataClass: "solcord-updates", state: "Protected", summary: "Automatic Solcord, plugin, and theme checks are paused. Check for updates remains available on demand."}
            : {dataClass: "solcord-updates", state: "NeedsReview", summary: "Automatic update checks are allowed by this profile."};
        const enabledCommunity = PluginManager.addonList?.filter(addon => PluginManager.isEnabled(addon.filename)) ?? [];
        const communityPolicy = enabledCommunity.flatMap(addon => {
            const decision = strictCommunityAddonActivationDecision({fileName: addon.filename, fileContent: addon.fileContent, sourceSha256: addon.sourceSha256}, SOLCORD_CATALOG_INDEX);
            return decision ? [decision] : [];
        });
        const communityAttention = communityPolicy.filter(item => item.action === "disable");
        const enabledThemes = ThemeManager.addonList?.filter(theme => ThemeManager.isEnabled(theme.filename)) ?? [];
        const themeAttention = enabledThemes.map(theme => strictCommunityThemeActivationDecision({fileName: theme.filename, fileContent: theme.fileContent, css: theme.css})).filter(item => item.action === "disable");
        const enabledCommunityCount = enabledCommunity.length + enabledThemes.length;
        const communityAttentionCount = communityAttention.length + themeAttention.length;
        const community: PrivacyCapabilityRecord = enabledCommunityCount === 0
            ? {dataClass: "community-addons", state: "Protected", summary: "No enabled community plugin or theme requires outbound review."}
            : communityAttentionCount === 0
                ? {dataClass: "community-addons", state: "Protected", summary: `${enabledCommunityCount} approved local-only community extension${enabledCommunityCount === 1 ? "" : "s"} may continue.`}
                : {dataClass: "community-addons", state: "NeedsReview", summary: `${communityAttentionCount} enabled community extension${communityAttentionCount === 1 ? "" : "s"} require outbound review.`};
        const provider = SolcordSettings.snapshot().productPreferences.nativeSuite.translation.provider;
        const externalConfigured = provider === "deepl" || provider === "libretranslate";
        const external: PrivacyCapabilityRecord = !externalConfigured
            ? {dataClass: "external-providers", state: "Protected", summary: provider === "local" ? "On-device translation is selected; reviewed text is not sent to an external provider." : "No external provider is active."}
            : {dataClass: "external-providers", state: "NeedsReview", summary: "Translation is configured; its provider and transmitted text remain action-visible."};
        this.#privacyCapabilities = [core, ...optional, updates, community, external];
        this.#recordPrivacyDecision(createPrivacyDecisionReceipt(0, Date.now(), "core-discord", "allow", "applied"));
        this.#recordPrivacyDecision(createPrivacyDecisionReceipt(0, Date.now(), "solcord-updates", preferences.updates === "manual" ? "block" : "allow", "applied"));
        this.#recordPrivacyDecision(createPrivacyDecisionReceipt(0, Date.now(), "community-addons", communityAttentionCount ? "hold" : "allow", communityAttentionCount ? "declaration-required" : "not-applicable"));
        this.#recordPrivacyDecision(createPrivacyDecisionReceipt(0, Date.now(), "external-providers", externalConfigured ? "hold" : "block", externalConfigured ? "declaration-required" : "not-applicable"));
        return nativePolicy;
    }

    #stopFakeDeafen(invalidatePending = true): void {
        if (invalidatePending) this.#fakeDeafenGeneration++;
        this.#fakeDeafenIndicatorReady = false;
        const controller = this.#fakeDeafen;
        try {this.#fakeDeafenScope.dispose();}
        catch (error) {
            const stoppedStatus = controller?.snapshot();
            this.#fakeDeafenStatus = {
                phase: "attention",
                detail: `Fake Deafen cleanup is incomplete (${errorName(error)}). Solcord retained teardown ownership and will not install a second adapter; restart Discord before using voice experiments again.`,
                connected: stoppedStatus?.connected ?? false,
                accountBound: false,
                capturedVoiceState: stoppedStatus?.capturedVoiceState ?? false,
                armed: false
            };
            Logger.warn("Solcord", this.#fakeDeafenStatus.detail);
            this.emitChange();
            return;
        }
        const stoppedStatus = controller?.snapshot();
        this.#fakeDeafenScope = new SolcordDisposalScope();
        this.#fakeDeafen = undefined;
        this.#fakeDeafenStatus = stoppedStatus?.phase === "attention"
            ? {...stoppedStatus, armed: false}
            : {phase: "off", detail: "Built-in adapter is idle. Use the Fake Deafen button beside Discord's normal Deafen control.", connected: false, accountBound: false, capturedVoiceState: false, armed: false};
        this.#fakeDeafenButton?.update(this.#fakeDeafenStatus);
        this.emitChange();
    }

    async #startFeature(id: SolcordModuleId): Promise<void> {
        const previousScope = this.#scopes.get(id);
        if (previousScope) {
            if (!previousScope.disposed) return;
            try {
                previousScope.dispose();
                this.#scopes.delete(id);
            }
            catch (error) {
                this.#setHealth(id, {
                    status: "failed",
                    detail: `Previous cleanup is still incomplete (${errorName(error)}); the adapter stayed off and will not be duplicated.`,
                    resources: previousScope.counts()
                });
                return;
            }
        }
        const generation = (this.#featureStartGenerations.get(id) ?? 0) + 1;
        this.#featureStartGenerations.set(id, generation);
        const scope = new SolcordDisposalScope();
        this.#scopes.set(id, scope);
        const start = performance.now();
        this.#setHealth(id, {status: "starting", detail: "Starting validated adapter."});
        try {
            switch (id) {
                case "activity-bridge": await this.#startActivityBridge(scope); break;
                case "plugin-doctor": this.#startPluginDoctor(scope); break;
                case "drift-radar": this.#startDriftRadar(scope); break;
                case "performance-hud": this.#startPerformanceHud(scope); break;
                case "workspace-profiles": this.#setHealth(id, {detail: "Module-setting profile preview, snapshot, apply, and rollback are available. Optional exact addon states execute only after a separate action-time confirmation."}); break;
                case "command-deck": this.#startCommandDeck(scope); break;
                case "link-lens": await this.#startLinkLens(scope); break;
                case "stream-shield": this.#startStreamShield(scope); break;
                case "stream-audience-guard": await this.#startStreamAudienceGuard(scope); break;
                case "settings-time-machine": this.#setHealth(id, {detail: `${SolcordSettings.snapshot().snapshots.length} bounded local snapshot(s); exports contain no secrets.`}); break;
                case "accessibility-toolkit": this.#startAccessibilityToolkit(scope); break;
                case "friend-watch": await this.#startFriendWatch(scope); break;
                case "message-timeline": await this.#startMessageTimeline(scope); break;
            }
            const startIsCurrent = this.#featureStartGenerations.get(id) === generation
                && this.#scopes.get(id) === scope
                && !scope.disposed
                && this.#started
                && SolcordSettings.module(id).enabled
                && (!this.#recoveryMode || id === "plugin-doctor");
            if (!startIsCurrent) {
                if (!scope.disposed) scope.dispose();
                return;
            }
            if (this.#health.get(id)?.status === "unavailable") {
                scope.dispose();
                this.#scopes.delete(id);
                this.#setHealth(id, {resources: {}});
                return;
            }
            this.#setHealth(id, {
                status: "active",
                startupDurationMs: Math.round((performance.now() - start) * 10) / 10,
                lastSuccessfulValidation: Date.now(),
                resources: scope.counts()
            });
        }
        catch (error) {
            const startIsCurrent = this.#featureStartGenerations.get(id) === generation && this.#scopes.get(id) === scope;
            if (!startIsCurrent) {
                if (!scope.disposed) scope.dispose();
                return;
            }
            let cleanupError: unknown;
            try {
                scope.dispose();
                this.#scopes.delete(id);
            }
            catch (caughtCleanupError) {
                cleanupError = caughtCleanupError;
                Logger.warn("Solcord", `${id} cleanup after failed start reported ${errorName(caughtCleanupError)}.`);
            }
            const health = this.#health.get(id)!;
            const failures = [...health.failures, {at: Date.now(), phase: "start", errorName: errorName(error)}].slice(-10);
            const recent = failures.filter(item => Date.now() - item.at <= 10 * 60 * 1_000);
            const quarantined = recent.length >= 3;
            this.#setHealth(id, {
                status: quarantined ? "quarantined" : "failed",
                failures,
                quarantineReason: quarantined ? "Three adapter failures within ten minutes; manual retry required." : undefined,
                detail: cleanupError
                    ? `Adapter failed with ${errorName(error)} and cleanup remains incomplete (${errorName(cleanupError)}); retained ownership will be retried before restart.`
                    : `Adapter failed closed with ${errorName(error)}.`,
                resources: cleanupError ? scope.counts() : {}
            });
            Logger.warn("Solcord", `${id} failed closed with ${errorName(error)}.`);
        }
    }

    #stopFeature(id: SolcordModuleId): void {
        this.#featureStartGenerations.set(id, (this.#featureStartGenerations.get(id) ?? 0) + 1);
        const scope = this.#scopes.get(id);
        if (!scope) {
            if (id === "stream-audience-guard") this.#resetStoppedAudienceGuard();
            else if (this.#health.has(id) && this.#health.get(id)!.status !== "quarantined") this.#setHealth(id, {status: "stopped", resources: {}});
            return;
        }
        try {
            scope.dispose();
            this.#scopes.delete(id);
            if (id === "stream-audience-guard") this.#resetStoppedAudienceGuard();
            else this.#setHealth(id, {status: "stopped", resources: {}, detail: "Stopped; all owned resources released."});
        }
        catch (error) {
            this.#setHealth(id, {
                status: "failed",
                resources: scope.counts(),
                detail: `Cleanup is incomplete (${errorName(error)}); retained ownership will be retried before this adapter can start again.`
            });
        }
    }

    #resetStoppedAudienceGuard(): void {
        this.#audienceGuard = undefined;
        this.#audienceGuardStatus = {phase: "off", detail: "Audience Guard is off.", available: false, armed: false, accountBound: false, channelBound: false, denylistCount: 0, detectedCount: 0, activeModes: {preventStart: false, stopOnJoin: false, stopOnWatch: false}};
        this.#audiencePolicy = {version: 1, entries: []};
        this.#audiencePolicyAccountId = undefined;
        this.#audiencePersistent = false;
        this.#audienceLoadGeneration++;
        this.#audienceReads.invalidate();
        this.#setHealth("stream-audience-guard", {status: "stopped", maturity: "preview", resources: {}, detail: "Audience Guard is off; all owned resources and private session state were released."});
        this.emitChange();
    }

    async #startActivityBridge(scope: SolcordDisposalScope): Promise<void> {
        await this.#refreshActivityHealth();
        scope.interval(() => void this.#refreshActivityHealth(), 10_000);
    }

    async #refreshActivityHealth(): Promise<void> {
        try {
            const health = await IPC.getActivityCompatibilityHealth() as ActivityCompatibilityHealth;
            const validStatus = health?.status === "idle" || health?.status === "healthy" || health?.status === "attention";
            const validCounters = health?.counters && Object.values(health.counters).every(value => Number.isSafeInteger(value) && value >= 0);
            const validEvents = Array.isArray(health?.events) && health.events.length <= 64 && health.events.every(event =>
                Number.isSafeInteger(event.sequence)
                && Number.isFinite(event.timestamp)
                && typeof event.action === "string"
                && typeof event.context === "string"
            );
            if (!validStatus || typeof health.unrestrictedOverride !== "boolean" || !validCounters || !validEvents) throw new TypeError("InvalidActivityHealth");
            this.#activityHealth = health;
            this.#setHealth("activity-bridge", {
                maturity: "ready",
                detail: health.unrestrictedOverride
                    ? "The legacy unrestricted preload override is ON; disable it before Activity testing."
                    : health.status === "healthy" || health.status === "idle"
                    ? "Restricted same-package preload policy is active; no compatibility exceptions are currently rejected."
                    : "The compatibility ledger needs review; no unrestricted override was enabled."
            });
        }
        catch (error) {
            this.#setHealth("activity-bridge", {maturity: "preview", detail: `Main-process ledger unavailable (${errorName(error)}); policy remains fail-closed.`});
        }
        this.emitChange();
    }

    #startPluginDoctor(scope: SolcordDisposalScope): void {
        const update = () => this.#updatePluginDoctorHealth();
        PluginDoctor.addChangeListener(update);
        scope.own(() => PluginDoctor.removeChangeListener(update), "listener");
        update();
    }

    #updatePluginDoctorHealth(): void {
        const records = PluginDoctor.snapshot();
        const quarantined = records.filter(record => record.quarantinedAt !== undefined).length;
        const integrity = this.#integrity.summary;
        this.#setHealth("plugin-doctor", {detail: `${quarantined} quarantined addon(s); ${records.reduce((sum, record) => sum + record.failures.length, 0)} recent sanitized failure record(s). Integrity: ${integrity.match} installed file(s) verified, ${integrity.missing} optional catalog item(s) not installed, ${integrity.attention + integrity.unavailable} installed item(s) require review.`});
    }

    #startDriftRadar(scope: SolcordDisposalScope): void {
        const fixture = {evaluate(value: number) {return value + 1;}};
        const patchCanary = runReversiblePatchCanary({
            id: "reversible-patch",
            install: callback => Patcher.instead("Solcord~PatchCanary", fixture, "evaluate", (thisObject, args, original) => callback(thisObject, args, (...values: unknown[]) => original(...values as [number])), {forcePatch: false}),
            invoke: () => fixture.evaluate(40),
            expectedPatched: 41,
            expectedRestored: 41
        });
        const validate = () => {
            const userStore = getStore("UserStore") as {getCurrentUser?: () => unknown;} | undefined;
            this.#driftResults = [patchCanary, ...runStructuralProbes([
                {id: "renderer-dom", description: "document root", validate: () => document.documentElement instanceof HTMLElement},
                {id: "webpack-runtime", description: "Discord module chunk array", validate: () => {const runtime = globalThis as typeof globalThis & {rspackChunkdiscord_app?: unknown; webpackChunkdiscord_app?: unknown;}; return Array.isArray(runtime.rspackChunkdiscord_app ?? runtime.webpackChunkdiscord_app);}},
                {id: "current-user-store", description: "UserStore.getCurrentUser", validate: () => typeof userStore?.getCurrentUser === "function"},
                {id: "patcher", description: "reversible patch registry", validate: () => Array.isArray(Patcher.patches)}
            ])];
            const failed = this.#driftResults.filter(result => !result.ok).length;
            this.#setHealth("drift-radar", {detail: failed ? `${failed} compatibility check(s) unavailable; volatile adapters validate their own lookup and fail closed.` : "All core structural probes and the reversible Patch Canary passed."});
        };
        validate();
        scope.interval(validate, 60_000);
    }

    #startPerformanceHud(scope: SolcordDisposalScope): void {
        const settings = SolcordSettings.module("performance-hud");
        const preferences = SolcordSettings.snapshot().productPreferences;
        const configuredSeconds = Number(settings.values.sampleSeconds) || 5;
        const policy = resolveSolcordPerformancePolicy(preferences.performanceProfile, preferences.appearance.motion, globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true);
        const seconds = Math.max(configuredSeconds, policy.sampleSeconds);
        let overlay: HTMLElement | undefined;
        if (settings.values.showOverlay === true) {
            overlay = scope.element(textElement("output", "Solcord: measuring…", "solcord-performance-overlay"));
            overlay.setAttribute("aria-live", "off");
        }
        if (!overlay) {
            this.#setHealth("performance-hud", {detail: "Overlay hidden; recurring performance sampling is suspended. Open the overlay when you want a bounded live reading."});
            return;
        }
        this.#sampler.begin();
        const sample = () => {
            this.#lastPerformanceSample = this.#sampler.sample(seconds * 1_000, countResources(this.#scopes));
            if (overlay) overlay.textContent = `Solcord · lag ${this.#lastPerformanceSample.eventLoopLagMs} ms · ${this.#lastPerformanceSample.ownedResources} owned resources`;
            this.#setHealth("performance-hud", {detail: `Last event-loop lag ${this.#lastPerformanceSample.eventLoopLagMs} ms; ${this.#lastPerformanceSample.ownedResources} Solcord-owned resources. No optimization claim is inferred.`});
        };
        scope.interval(sample, seconds * 1_000);
        sample();
    }

    #startCommandDeck(scope: SolcordDisposalScope): void {
        const rememberRoute = () => {this.#rememberReturnRoute();};
        rememberRoute();
        scope.listen(window, "popstate", rememberRoute);
        scope.listen(window, "hashchange", rememberRoute);
        const pushStatePatch = Patcher.after("Solcord~ReturnLaterRoute", window.history, "pushState", rememberRoute, {forcePatch: false});
        const replaceStatePatch = Patcher.after("Solcord~ReturnLaterRoute", window.history, "replaceState", rememberRoute, {forcePatch: false});
        if (pushStatePatch) scope.own(pushStatePatch, "patch");
        if (replaceStatePatch) scope.own(replaceStatePatch, "patch");
        scope.listen(window, "keydown", (event: Event) => {
            const keyboard = event as KeyboardEvent;
            if (keyboard.ctrlKey && keyboard.altKey && !keyboard.shiftKey && keyboard.key.toLowerCase() === "k") {
                keyboard.preventDefault();
                this.openCommandDeck();
            }
        }, true);
        this.#setHealth("command-deck", {detail: "Ready at Ctrl+Alt+K with local-only actions, including a session-only Return Later shortcut for the visible DM or channel."});
    }

    async #startLinkLens(scope: SolcordDisposalScope): Promise<void> {
        const target = await getLazyBySource([".trackAnnouncementMessageLinkClicked("]);
        const [module, key] = getWithKey((candidate) => String(candidate).includes(".trackAnnouncementMessageLinkClicked("), {target});
        if (!module || typeof key !== "string" || typeof module[key] !== "function") throw new Error("LinkActivationAdapterUnavailable");

        const lifecycle = new LinkReviewLifecycle({
            href: () => window.location.href,
            activeElement: () => document.activeElement instanceof HTMLElement ? document.activeElement : undefined,
            setInterval: (callback, delay) => globalThis.setInterval(callback, delay),
            clearInterval: handle => globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>),
            deferFocus: callback => {
                let userIntervened = false;
                const markIntervened = () => {userIntervened = true;};
                const releasePointer = scope.listen(globalThis, "pointerdown", markIntervened, true);
                const releaseKeyboard = scope.listen(globalThis, "keydown", markIntervened, true);
                scope.timeout(() => {
                    releasePointer();
                    releaseKeyboard();
                    if (!userIntervened) callback();
                }, 700);
            }
        });
        scope.own(() => lifecycle.dispose(), "element");

        const unpatch = Patcher.instead("Solcord~LinkLens", module, key, (thisObject, args, original) => {
            const values = SolcordSettings.module("link-lens").values;
            const href = typeof (args[0] as {href?: unknown;} | undefined)?.href === "string" ? (args[0] as {href: string;}).href : "";
            const memoryEnabled = SolcordSettings.snapshot().productPreferences.safety.domainMemory === "warn-only";
            const remembered = memoryEnabled && href ? this.#domainMemory.decision(href) : undefined;
            const domainRisk = href ? inspectSolcordDomain(href) : {restricted: false, reasons: []};
            return interceptLinkActivation(thisObject, args as Array<{href?: string;} | Event | undefined>, original, {
                currentHref: window.location.href,
                confirmAllExternal: values.confirmAllExternal === true || domainRisk.restricted || remembered?.decision === "warn" || remembered?.decision === "block",
                removeTrackers: values.removeTrackers !== false,
                review: (inspection, onConfirm, onCancel, onFailure) => {
                    const warnings = [...new Set([...inspection.warnings, ...domainRisk.reasons.map(reason => `Domain check: ${reason}.`)])];
                    const enriched = {...inspection, warnings, requiresConfirmation: true};
                    return this.#showLinkReview(lifecycle, enriched, remembered?.decision === "block" ? onCancel : onConfirm, onCancel, onFailure, remembered?.decision === "warn" || remembered?.decision === "block" ? remembered.decision : undefined);
                },
                open: destination => window.open(destination, "_blank", "noopener,noreferrer")
            });
        }, {forcePatch: false});
        if (!unpatch) throw new Error("LinkActivationPatchRejected");
        scope.own(unpatch, "patch");
        this.#setHealth("link-lens", {maturity: "ready", detail: "Native external-link review is attached. Internal Discord navigation passes through unchanged; one review owns focus and cleanup at a time."});
    }

    #showLinkReview(lifecycle: LinkReviewLifecycle, inspection: LinkInspection, onConfirm: () => void, onCancel: () => void, onFailure: () => void, remembered?: "warn" | "block"): boolean {
        const warnings = inspection.warnings.length
            ? inspection.warnings.map(warning => `• ${warning}`)
            : ["• No local warning rules matched; review is enabled for every external link."];
        const content = [
            `Visible host: **${inspection.host ?? "invalid"}**`,
            ...(inspection.finalHost && inspection.finalHost !== inspection.host ? [`Declared final host: **${inspection.finalHost}**`] : []),
            ...(remembered ? [`Domain Memory: **${remembered === "block" ? "blocked" : "warn on access"}** for this scheme and exact host.`] : []),
            ...warnings
        ];
        const result = lifecycle.open({
            open: callbacks => Modals.showNativeConfirmationModal(remembered === "block" ? "Blocked external link" : "Review external link", content, {
                key: "solcord-link-review",
                confirmText: remembered === "block" ? "Keep blocked" : "Open reviewed link",
                cancelText: "Close",
                onConfirm: callbacks.onConfirm,
                onCancel: callbacks.onCancel,
                onClose: callbacks.onClose,
                onRenderError: callbacks.onRenderError
            }),
            close: modalKey => Modals.ModalActions?.closeModal(modalKey)
        }, {confirm: onConfirm, cancel: onCancel, failure: onFailure});
        return result !== "unavailable";
    }

    #startStreamShield(scope: SolcordDisposalScope): void {
        const root = document.documentElement;
        const settings = SolcordSettings.module("stream-shield").values;
        const streamStore = getStore("ApplicationStreamingStore") as {
            addChangeListener?: (listener: () => void) => void;
            removeChangeListener?: (listener: () => void) => void;
            getCurrentUserActiveStream?: () => unknown;
            getStreamerActiveStreamMetadata?: () => unknown;
        } | undefined;
        const getter = typeof streamStore?.getCurrentUserActiveStream === "function"
            ? () => streamStore.getCurrentUserActiveStream?.()
            : typeof streamStore?.getStreamerActiveStreamMetadata === "function"
                ? () => streamStore.getStreamerActiveStreamMetadata?.()
                : undefined;
        const dom = new SolcordStreamShieldDom(document);
        const redactionSettings = normalizeSolcordStreamShieldSettings(settings);
        let active = false;
        let automatic = false;
        let automaticAvailable = Boolean(getter);
        let frame = 0;
        let lastHealth = "";
        let lastMaturity: SolcordMaturity | undefined;
        const source = () => settings.previewActive === true ? "preview" as const : settings.manualActive === true ? "manual" as const : automatic ? "stream" as const : "ready" as const;
        const publish = (resolution: SolcordStreamShieldResolution) => {
            const detail = describeSolcordStreamShieldResolution(resolution, automaticAvailable, source());
            const maturity: SolcordMaturity = resolution.active && resolution.requested.length > 0 && resolution.resolved.length === resolution.requested.length && resolution.drift.length === 0
                ? "ready"
                : "preview";
            if (detail === lastHealth && maturity === lastMaturity) return;
            lastHealth = detail;
            lastMaturity = maturity;
            this.#setHealth("stream-shield", {maturity, detail});
        };
        const scan = () => {
            frame = 0;
            if (scope.disposed) return;
            publish(dom.reconcile(active, redactionSettings));
        };
        const schedule = () => {
            if (!active || frame || scope.disposed) return;
            frame = requestAnimationFrame(scan);
        };
        const sync = () => {
            try {
                automatic = Boolean(getter?.());
            }
            catch {
                automatic = false;
                automaticAvailable = false;
            }
            active = settings.manualActive === true || settings.previewActive === true || automatic;
            root.classList.toggle("solcord-stream-shield", active);
            root.classList.toggle("solcord-stream-preview", settings.previewActive === true);
            scan();
        };
        scope.style("solcord-stream-shield-style", `
            html.solcord-stream-shield .solcord-stream-redaction {filter: blur(11px) saturate(0) !important; opacity: .16 !important; user-select: none !important;}
            .solcord-stream-preview::after {content: "STREAM SHIELD PREVIEW"; position: fixed; inset: 12px 12px auto auto; z-index: 2147483647; padding: 6px 9px; color: #161819; background: #f4b860; font: 700 11px/1 sans-serif; letter-spacing: .08em; border-radius: 3px;}
        `);
        const observer = new MutationObserver(schedule);
        scope.observe(observer, document.body, {childList: true, subtree: true});
        scope.listen(window, "popstate", schedule);
        scope.listen(window, "hashchange", schedule);
        scope.own(() => {
            if (frame) cancelAnimationFrame(frame);
            frame = 0;
            active = false;
            dom.dispose();
            root.classList.remove("solcord-stream-shield", "solcord-stream-preview");
        }, "element");
        if (getter && typeof streamStore?.addChangeListener === "function") {
            streamStore.addChangeListener(sync);
            scope.own(() => streamStore.removeChangeListener?.(sync), "listener");
        }
        scope.listen(window, "keydown", (event: Event) => {
            const keyboard = event as KeyboardEvent;
            if (!keyboard.ctrlKey || !keyboard.altKey || !keyboard.shiftKey || keyboard.key.toLowerCase() !== "s") return;
            keyboard.preventDefault();
            const current = SolcordSettings.module("stream-shield").values.manualActive === true;
            void this.setValue("stream-shield", "manualActive", !current);
        }, true);
        sync();
    }

    async #startStreamAudienceGuard(scope: SolcordDisposalScope): Promise<void> {
        type FluxStore = {addChangeListener?: (listener: () => void) => void; removeChangeListener?: (listener: () => void) => void;};
        type StreamingStore = FluxStore & {
            getCurrentUserActiveStream?: () => unknown;
            getStreamerActiveStreamMetadata?: () => unknown;
            getViewerIds?: (stream?: unknown) => unknown;
        };
        type VoiceStateStore = FluxStore & {getVoiceStatesForChannel?: (channelId: string) => unknown;};
        type SelectedChannelStore = FluxStore & {getVoiceChannelId?: () => string | undefined;};
        type UserStore = FluxStore & {getCurrentUser?: () => {id?: string;} | undefined;};

        const streamingStore = getStore("ApplicationStreamingStore") as StreamingStore | undefined;
        const voiceStateStore = getStore("VoiceStateStore") as VoiceStateStore | undefined;
        const selectedChannelStore = getStore("SelectedChannelStore") as SelectedChannelStore | undefined;
        const userStore = getStore("UserStore") as UserStore | undefined;
        const streamingCapability = resolveSolcordStreamingReaders(streamingStore);
        const voiceStateCapability = resolveSolcordVoiceStateReader(voiceStateStore);
        const voiceChannelCapability = resolveSolcordVoiceChannelReader(selectedChannelStore);
        const [streamStartModule, streamStartKey] = getWithKey(isAudienceGuardStartAction);
        const [streamStopModule, streamStopKey] = getWithKey(isAudienceGuardStopAction);
        const streamStartAction = streamStartModule && typeof streamStartKey === "string" ? streamStartModule[streamStartKey] : undefined;
        const streamStopAction = streamStopModule && typeof streamStopKey === "string" ? streamStopModule[streamStopKey] : undefined;
        const currentStream = () => streamingCapability.value?.currentStream();
        const stores = [streamingStore, voiceStateStore, selectedChannelStore, userStore];
        const storesObservable = stores.every(store => typeof store?.addChangeListener === "function" && typeof store?.removeChangeListener === "function");
        const structurallyValid = Boolean(
            streamingCapability.value
            && voiceStateCapability.value
            && voiceChannelCapability.value
            && typeof userStore?.getCurrentUser === "function"
            && isAudienceGuardStartAction(streamStartAction)
            && isAudienceGuardStopAction(streamStopAction)
            && storesObservable
        );

        if (!structurallyValid || !streamingStore || !voiceStateStore || !selectedChannelStore || !userStore || !streamStartModule || typeof streamStartKey !== "string" || !streamStopModule || typeof streamStopKey !== "string") {
            this.#audienceGuardStatus = {phase: "unavailable", detail: "Audience Guard stayed unavailable because one or more Discord stream, viewer, voice-state, account, or action adapters failed structural validation.", available: false, armed: false, accountBound: false, channelBound: false, denylistCount: 0, detectedCount: 0, activeModes: {preventStart: false, stopOnJoin: false, stopOnWatch: false}};
            this.#setHealth("stream-audience-guard", {status: "unavailable", maturity: "unavailable", detail: this.#audienceGuardStatus.detail});
            this.emitChange();
            return;
        }

        const observeAccount = () => {
            const accountId = normalizeTimelineAccountId(userStore.getCurrentUser?.()?.id);
            if (accountId === this.#audiencePolicyAccountId || accountId === this.#audienceReads.pendingAccountId) return;
            this.#audienceLoadGeneration++;
            this.#audienceGuard?.disarm("Audience Guard disarmed because the Discord account changed.");
            this.#audiencePolicy = {version: 1, entries: []};
            this.#audiencePolicyAccountId = undefined;
            this.#audiencePersistent = false;
            this.emitChange();
            if (accountId) void this.#loadAudienceGuardPolicy(accountId);
        };

        const controller = new SolcordStreamAudienceGuard({
            currentAccountId: () => normalizeTimelineAccountId(userStore.getCurrentUser?.()?.id),
            currentVoiceChannelId: () => voiceChannelCapability.value?.(),
            currentStream,
            voiceMemberIds: channelId => voiceStateCapability.value!(channelId),
            viewerIds: stream => streamingCapability.value!.viewerIds(stream),
            stopOwnStream: () => {
                const stop = streamStopModule[streamStopKey];
                if (!isAudienceGuardStopAction(stop)) throw new Error("StreamAudienceGuardStopActionDrifted");
                const result = stop.call(streamStopModule, true);
                return result instanceof Promise ? result.then(() => undefined) : undefined;
            },
            interceptStreamStart: decide => Patcher.instead("Solcord~StreamAudienceGuard", streamStartModule, streamStartKey, (thisObject, args, original) => {
                if (!isAudienceGuardStartAction(original)) return original.apply(thisObject, args);
                if (decide()) return original.apply(thisObject, args);
                Toasts.show("Go Live was not started because Stream Audience Guard detected a denied user in this call.", {type: "error"});
                return undefined;
            }, {forcePatch: false}) ?? undefined,
            subscribe: listener => {
                const sync = () => {observeAccount(); listener();};
                return subscribeSolcordChangeStores(scope, stores as Array<Required<FluxStore>>, sync);
            },
            setTimer: (callback, delay) => globalThis.setTimeout(callback, delay),
            clearTimer: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)
        }, status => {
            this.#audienceGuardStatus = status;
            const storageDetail = this.#audiencePersistent
                ? "The private denylist is encrypted at rest."
                : this.#audienceStorageStatus.persistent
                    ? "Encrypted storage is available; a durable account policy will load after setup."
                    : `The private denylist is session-only on this system.${this.#audienceStorageStatus.reason ? ` ${this.#audienceStorageStatus.reason}` : ""}`;
            this.#setHealth("stream-audience-guard", {
                maturity: audienceGuardHealthMaturity(status),
                detail: `${status.detail} ${storageDetail}`
            });
            this.emitChange();
        });
        this.#audienceGuard = controller;
        scope.own(() => {
            controller.stop();
            this.#audienceGuard = undefined;
            this.#audiencePolicy = {version: 1, entries: []};
            this.#audiencePolicyAccountId = undefined;
            this.#audiencePersistent = false;
            this.#audienceLoadGeneration++;
        }, "patch");
        if (!controller.start()) throw new Error("StreamAudienceGuardAdapterUnavailable");
        const accountId = normalizeTimelineAccountId(userStore.getCurrentUser?.()?.id);
        if (accountId) await this.#loadAudienceGuardPolicy(accountId);
        this.#setHealth("stream-audience-guard", {maturity: "preview", detail: "Audience Guard is ready but unarmed. Live start and stop behavior still requires owner acceptance in a designated call."});
    }

    async #refreshAudienceGuardStorageStatus(): Promise<SolcordPrivateStorageStatus> {
        try {
            const status = await this.#withPrivateCapability(capability => TIMELINE_IPC.audienceStatus(capability)) as SolcordPrivateStorageStatus;
            this.#audienceStorageStatus = {
                persistent: status.persistent === true,
                sessionOnly: status.sessionOnly !== false,
                ...(typeof status.reason === "string" && status.reason ? {reason: status.reason.slice(0, 180)} : {})
            };
        }
        catch {
            this.#audienceStorageStatus = {persistent: false, sessionOnly: true, reason: "Audience Guard private storage capability is unavailable."};
        }
        this.emitChange();
        return structuredClone(this.#audienceStorageStatus);
    }

    #loadAudienceGuardPolicy(accountId: string): Promise<boolean> {
        return this.#audienceReads.load(accountId, () => this.#readAudienceGuardPolicy(accountId, ++this.#audienceLoadGeneration));
    }

    async #readAudienceGuardPolicy(accountId: string, generation: number): Promise<boolean> {
        this.#audiencePolicy = {version: 1, entries: []};
        this.#audiencePolicyAccountId = undefined;
        this.#audiencePersistent = false;
        try {
            const opened = await this.#withTimelineAccount(accountId, async capability => ({
                status: await TIMELINE_IPC.audienceStatus(capability) as SolcordPrivateStorageStatus,
                read: await TIMELINE_IPC.audienceRead(capability, {}) as {policy?: unknown; persistent?: boolean; complete?: boolean;}
            }), () => accountId === this.#currentTimelineAccountId());
            if (generation !== this.#audienceLoadGeneration || accountId !== this.#currentTimelineAccountId()) return false;
            this.#audiencePolicy = normalizeAudienceGuardPrivatePolicy(opened.read.policy);
            this.#audiencePolicyAccountId = accountId;
            this.#audienceStorageStatus = {
                persistent: opened.status.persistent === true,
                sessionOnly: opened.status.sessionOnly !== false,
                ...(typeof opened.status.reason === "string" && opened.status.reason ? {reason: opened.status.reason.slice(0, 180)} : {})
            };
            this.#audiencePersistent = opened.status.persistent === true && opened.read.persistent === true && opened.read.complete === true;
            this.emitChange();
            return opened.read.complete === true;
        }
        catch {
            if (generation !== this.#audienceLoadGeneration || accountId !== this.#currentTimelineAccountId()) return false;
            this.#audiencePolicy = {version: 1, entries: []};
            this.#audiencePolicyAccountId = accountId;
            this.#audiencePersistent = false;
            this.#audienceStorageStatus = {persistent: false, sessionOnly: true, reason: "Audience Guard encrypted policy read failed closed."};
            this.emitChange();
            return false;
        }
    }

    #startAccessibilityToolkit(scope: SolcordDisposalScope): void {
        const values = SolcordSettings.module("accessibility-toolkit").values;
        const rules: string[] = [
            `.solcord-keyboard-focus :focus-visible {outline: 2px solid #4ecdc4 !important; outline-offset: 2px !important;}`
        ];
        document.documentElement.classList.add("solcord-keyboard-focus");
        scope.own(() => document.documentElement.classList.remove("solcord-keyboard-focus"), "other");
        if (values.reducedMotion === true) rules.push(`html.solcord-keyboard-focus *, html.solcord-keyboard-focus *::before, html.solcord-keyboard-focus *::after {animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important;}`);
        if (values.roleContrast === true) rules.push(`[class*="roleColor"] {text-shadow: 0 0 1px currentColor, 0 0 2px var(--background-base-lowest) !important;}`);
        const width = Number(values.readingWidth) || 0;
        if (width >= 480) rules.push(`[class*="messagesWrapper"] [class*="messageListItem"] {max-width: ${Math.min(width, 1_200)}px;}`);
        if (values.readingRuler === true) rules.push(`[class*="messageListItem"]:focus-within, [class*="messageListItem"]:hover {background: color-mix(in srgb, #4ecdc4 10%, transparent) !important;}`);
        scope.style("solcord-accessibility-style", rules.join("\n"));
    }

    async #startFriendWatch(scope: SolcordDisposalScope): Promise<void> {
        type RelationshipStore = {
            getRelationships?: () => unknown;
            getMutableRelationships?: () => unknown;
            addChangeListener?: (callback: () => void) => void;
            removeChangeListener?: (callback: () => void) => void;
        };
        type UserStore = {
            getCurrentUser?: () => {id?: string;} | undefined;
            getUser?: (id: string) => {globalName?: string; username?: string;} | undefined;
            addChangeListener?: (callback: () => void) => void;
            removeChangeListener?: (callback: () => void) => void;
        };
        type RelationshipActions = Record<"removeRelationship" | "blockUser" | "unblockUser", (...args: unknown[]) => unknown>;
        const relationships = getStore("RelationshipStore") as RelationshipStore | undefined;
        const users = getStore("UserStore") as UserStore | undefined;
        const readRelationships = typeof relationships?.getRelationships === "function"
            ? relationships.getRelationships.bind(relationships)
            : typeof relationships?.getMutableRelationships === "function"
                ? relationships.getMutableRelationships.bind(relationships)
                : undefined;
        if (!readRelationships || typeof relationships?.addChangeListener !== "function" || typeof relationships.removeChangeListener !== "function") throw new Error("FriendWatchRelationshipStoreUnavailable");
        const getRelationships = () => readRelationships();

        let accountId: string | undefined;
        let accountGeneration = -1;
        let previous = normalizeDiscordRelationships(getRelationships());
        let ready = false;
        let work = Promise.resolve();
        let noticeState: SolcordFriendWatchNoticeState = {};
        let ownerActions: SolcordOwnerRelationshipAction[] = [];
        const accountBarrier = new SolcordFriendWatchAccountBarrier();
        const policy = () => SolcordSettings.snapshot().productPreferences.friendWatch;
        const actionModule = getByKeys<RelationshipActions>(["removeRelationship", "blockUser", "unblockUser"]);
        if (actionModule) {
            const recordOwnerAction = (action: SolcordOwnerRelationshipAction["action"], args: unknown[]) => {
                const subjectId = args.find(value => typeof value === "string" && /^\d{1,32}$/.test(value)) as string | undefined;
                if (!subjectId) return;
                const observedAt = Date.now();
                ownerActions = [...ownerActions.filter(entry => observedAt - entry.observedAt <= 5_000), {subjectId, action, observedAt}].slice(-32);
            };
            for (const [key, action] of [["removeRelationship", "remove"], ["blockUser", "block"], ["unblockUser", "unblock"]] as const) {
                const unpatch = Patcher.before("Solcord~FriendWatch", actionModule, key, (_this, args) => recordOwnerAction(action, args), {forcePatch: false});
                if (unpatch) scope.own(unpatch, "patch");
            }
        }
        const holdAfterAccountChange = () => {
            if (scope.disposed) return;
            ready = false;
            accountId = undefined;
            accountGeneration = -1;
            noticeState = {};
            ownerActions = [];
            previous = new Map<string, SolcordRelationshipSnapshot>();
            this.#friendWatch.clear();
            this.#friendWatchPersistent = false;
            this.#setHealth("friend-watch", {maturity: "preview", detail: "Paused after an account identity change because Discord does not account-bind RelationshipStore snapshots. Retry Friend Watch after the new account finishes loading."});
            this.emitChange();
        };
        const activate = async (nextAccountId: string | undefined) => {
            if (scope.disposed) return;
            if (accountBarrier.observe(nextAccountId) === "hold") {holdAfterAccountChange(); return;}
            const {identity} = this.#observeFriendWatchIdentity(nextAccountId);
            accountId = identity.accountId;
            accountGeneration = identity.generation;
            const targetIdentity: TimelineAccountIdentity = {accountId, generation: accountGeneration};
            const identityIsCurrent = () => this.#friendWatchIdentityIsCurrent(targetIdentity);
            ready = false;
            noticeState = {};
            previous = normalizeDiscordRelationships(getRelationships());
            this.#friendWatch.clear();
            this.#friendWatchPersistent = false;
            if (!accountId) {
                await this.#releaseTimelineAccount();
                this.#setHealth("friend-watch", {maturity: "preview", detail: "Logged out; relationship memory is empty."});
                this.emitChange();
                return;
            }
            const target = accountId;
            try {
                const opened = await this.#withTimelineAccount(target, async capability => ({
                    status: await TIMELINE_IPC.friendStatus(capability) as {persistent?: boolean;},
                    read: await TIMELINE_IPC.friendRead(capability, {retentionDays: policy().retentionDays}) as {events?: unknown[]; persistent?: boolean; complete?: boolean;}
                }), identityIsCurrent);
                if (scope.disposed || !identityIsCurrent()) return;
                const loaded = Array.isArray(opened.read.events) ? opened.read.events as SolcordRelationshipEvent[] : [];
                this.#friendWatch.append(loaded, policy().retentionDays);
                const observedAt = Date.now();
                const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "").slice(0, 16) ?? Math.random().toString(36).slice(2, 18);
                const reconciliation: SolcordRelationshipEvent = {
                    eventId: `reconcile_${observedAt.toString(36)}_${random}`,
                    observedAt,
                    transition: "reconciled",
                    label: "Session relationship snapshot reconciled",
                    source: "reconciliation",
                    confidence: "unknown",
                    schemaVersion: 1
                };
                this.#friendWatch.append([reconciliation], policy().retentionDays);
                const persisted = await this.#withTimelineAccount(target, capability => TIMELINE_IPC.friendAppend(capability, {events: [reconciliation], retentionDays: policy().retentionDays}), identityIsCurrent) as {persistent?: boolean;};
                if (scope.disposed || !identityIsCurrent()) return;
                this.#friendWatchPersistent = opened.status.persistent === true && opened.read.persistent === true && persisted.persistent === true;
                ready = true;
                this.#setHealth("friend-watch", {maturity: opened.read.complete === true ? "ready" : "preview", detail: `${this.#friendWatch.snapshot().length} account-isolated relationship event(s) loaded. ${this.#friendWatchPersistent ? "AES-256-GCM persistence is active through safeStorage." : "Session-only fallback is active."}`});
            }
            catch (error) {
                if (scope.disposed || !identityIsCurrent()) return;
                ready = true;
                this.#friendWatchPersistent = false;
                this.#setHealth("friend-watch", {maturity: "preview", detail: `Encrypted history failed closed (${errorName(error)}); this account remains session-only.`});
            }
            this.emitChange();
        };
        const reconcile = async () => {
            if (scope.disposed) return;
            const currentAccountId = normalizeTimelineAccountId(users?.getCurrentUser?.()?.id);
            if (accountBarrier.observe(currentAccountId) === "hold") {holdAfterAccountChange(); return;}
            const observed = this.#observeFriendWatchIdentity(currentAccountId);
            if (observed.identity.accountId !== accountId || observed.identity.generation !== accountGeneration || !ready) {await activate(currentAccountId); return;}
            if (!accountId || scope.disposed) return;
            const activeIdentity: TimelineAccountIdentity = {accountId, generation: accountGeneration};
            const identityIsCurrent = () => this.#friendWatchIdentityIsCurrent(activeIdentity);
            const next = normalizeDiscordRelationships(getRelationships());
            const now = Date.now();
            ownerActions = ownerActions.filter(action => now - action.observedAt <= 5_000);
            const rawEvents = reconcileSolcordRelationships(previous, next, ownerActions, now);
            previous = next;
            const settings = policy();
            const events = rawEvents.map(event => {
                if (!settings.includeDisplaySnapshot) return event;
                const user = event.subjectId ? users?.getUser?.(event.subjectId) : undefined;
                const displayLabel = user?.globalName ?? user?.username;
                return displayLabel ? {...event, displayLabel: displayLabel.slice(0, 160)} : event;
            });
            if (events.length) {
                this.#friendWatch.append(events, settings.retentionDays);
                try {
                    const result = await this.#withTimelineAccount(accountId, capability => TIMELINE_IPC.friendAppend(capability, {events, retentionDays: settings.retentionDays}), identityIsCurrent) as {persistent?: boolean;};
                    if (!identityIsCurrent()) return;
                    this.#friendWatchPersistent = result.persistent === true;
                }
                catch {
                    this.#observeFriendWatchIdentity();
                    if (identityIsCurrent()) this.#friendWatchPersistent = false;
                    else return;
                }
                if (!identityIsCurrent()) return;
                const noticePlan = planSolcordFriendWatchNotices(settings.digest, events, this.#friendWatch.snapshot(), noticeState);
                noticeState = noticePlan.state;
                for (const message of noticePlan.messages) Toasts.info(message, {timeout: 7_500});
            }
            if (!identityIsCurrent()) return;
            const count = this.#friendWatch.snapshot().length;
            this.#setHealth("friend-watch", {maturity: this.#friendWatchPersistent ? "ready" : "preview", detail: `${count} relationship event(s). Zero REST or Gateway requests are initiated; ${this.#friendWatchPersistent ? "encrypted account-isolated persistence is active" : "session-only fallback is active"}.`});
            this.emitChange();
        };
        const schedule = () => {
            const run = () => reconcile();
            work = work.then(run, run).then(() => undefined, error => {
                if (scope.disposed) return;
                this.#friendWatchPersistent = false;
                this.#setHealth("friend-watch", {maturity: "preview", detail: `Relationship reconciliation failed closed (${errorName(error)}); the next bounded reconciliation may retry.`});
                this.emitChange();
            });
        };
        relationships.addChangeListener(schedule);
        scope.own(() => relationships.removeChangeListener?.(schedule), "listener");
        scope.listen(window, "online", schedule);
        scope.listen(document, "visibilitychange", () => {if (document.visibilityState === "visible") schedule();});
        if (typeof users?.addChangeListener === "function" && typeof users.removeChangeListener === "function") {
            const onAccountChange = () => {
                if (scope.disposed) return;
                const {changed} = this.#observeFriendWatchIdentity(normalizeTimelineAccountId(users.getCurrentUser?.()?.id));
                if (changed) this.emitChange();
                schedule();
            };
            users.addChangeListener(onAccountChange);
            scope.own(() => users.removeChangeListener?.(onAccountChange), "listener");
        }
        scope.interval(schedule, 60_000);
        scope.own(() => {ready = false; noticeState = {}; ownerActions = []; previous = new Map<string, SolcordRelationshipSnapshot>(); this.#friendWatch.clear(); this.#friendWatchPersistent = false; this.#friendWatchIdentity = undefined; accountId = undefined; accountGeneration = -1;}, "cache");
        await activate(normalizeTimelineAccountId(users?.getCurrentUser?.()?.id));
    }

    async #startMessageTimeline(scope: SolcordDisposalScope): Promise<void> {
        type Dispatcher = {
            subscribe?(type: string, callback: (payload: Record<string, unknown>) => void): void;
            unsubscribe?(type: string, callback: (payload: Record<string, unknown>) => void): void;
            register?(callback: (payload: Record<string, unknown>) => void): string;
            unregister?(token: string): void;
            dispatch(payload: unknown): void;
        };
        type Channel = {id?: string; type?: number; guild_id?: string; nsfw?: boolean; isNSFW?(): boolean;};
        type Message = {id?: string; channel_id?: string; channelId?: string; content?: string; attachments?: unknown[]; mentions?: unknown[]; author?: {id?: string; bot?: boolean; global_name?: string; globalName?: string; username?: string;};};
        type MessageCollection = {toArray?(): Message[];};
        const dispatcherIsUsable = (candidate: Dispatcher | undefined): candidate is Dispatcher => Boolean(candidate && typeof candidate.dispatch === "function" && (
            (typeof candidate.subscribe === "function" && typeof candidate.unsubscribe === "function")
            || (typeof candidate.register === "function" && typeof candidate.unregister === "function")
        ));
        let dispatcher = DiscordModules.Dispatcher as unknown as Dispatcher | undefined;
        if (!dispatcherIsUsable(dispatcher)) {
            const controller = new AbortController();
            const releaseAbort = scope.own(() => controller.abort(), "other");
            let timeout = 0;
            const releaseTimeout = scope.own(() => globalThis.clearTimeout(timeout), "timer");
            timeout = globalThis.setTimeout(() => controller.abort(), 2_000) as unknown as number;
            try {
                dispatcher = await getLazy<Dispatcher>(Filters.byKeys(["dispatch", "subscribe", "register"]), {searchExports: true, signal: controller.signal, cacheId: "solcord-timeline-dispatcher"});
            }
            finally {
                releaseTimeout();
                releaseAbort();
            }
        }
        const channelStore = getStore("ChannelStore") as {getChannel?: (id: string) => Channel | undefined;} | undefined;
        const messageStore = getStore("MessageStore") as {getMessage?: (channelId: string, messageId: string) => Message | undefined; getMessages?: (channelId: string) => Message[] | MessageCollection | undefined;} | undefined;
        const selectedChannelStore = getStore("SelectedChannelStore") as {
            getChannelId?: () => string | undefined;
            addChangeListener?: (callback: () => void) => void;
            removeChangeListener?: (callback: () => void) => void;
        } | undefined;
        const userStore = getStore("UserStore") as {
            getCurrentUser?: () => {id?: string;} | undefined;
            addChangeListener?: (callback: () => void) => void;
            removeChangeListener?: (callback: () => void) => void;
        } | undefined;
        const relationshipStore = getStore("RelationshipStore") as {
            getRelationshipType?: (userId: string) => number | undefined;
            getRelationships?: () => Record<string, number>;
        } | undefined;
        const muteStore = getStore("UserGuildSettingsStore") as {
            isChannelMuted?: (guildId: string | null | undefined, channelId: string) => boolean;
            isGuildOrCategoryOrChannelMuted?: (guildId: string, channelId: string) => boolean;
            isGuildMuted?: (guildId: string) => boolean;
        } | undefined;
        if (!dispatcherIsUsable(dispatcher) || typeof channelStore?.getChannel !== "function") {
            throw new Error("TimelineAdapterUnavailable");
        }

        let policy = SolcordSettings.slice("timelinePolicy");
        this.#timelinePersistent = false;
        let accountId: string | undefined;
        let accountGeneration = -1;
        let accountInitialized = false;
        let accountReady = false;
        let storageReadComplete = true;
        let initialReadComplete = true;
        let appendRetentionComplete = true;
        let storageAttention = "";
        const seededChannels = new Set<string>();
        const pendingChunks: TimelineEvent[][] = [];
        let queuedEvents = 0;
        let queueOverflow = false;
        let bufferedBytes = 0;
        let flushPromise: Promise<boolean> | undefined;
        let replayBuffered = () => {};
        const buffered: Array<{event: ReturnType<typeof normalizeDiscordTimelineDispatch>[number]; at: number;}> = [];
        let seedSelectedChannel = () => {};
        let previousHealthKey = "";

        const updateHealth = () => {
            const status = this.#timeline.status();
            const detail = `${status.records} observed message record(s); ${status.deleted} deleted, ${status.edited} edited, and ${status.ghostPings} ghost ping(s). ${this.#timelinePersistent ? "AES-256-GCM persistence is active through safeStorage." : "Session-only mode is active."}${storageAttention ? ` ${storageAttention}` : ""}`;
            const key = `${storageReadComplete}:${detail}`;
            if (key === previousHealthKey) return;
            previousHealthKey = key;
            this.#setHealth("message-timeline", {
                maturity: storageReadComplete ? "ready" : "preview",
                detail
            });
        };

        const policyChanged = () => {
            const previousRetention = policy.retention;
            policy = SolcordSettings.slice("timelinePolicy");
            if (this.#timeline.prune(policy) || policy.retention !== previousRetention) this.#timelineRetentionDirty = true;
            if (accountReady && this.#timelineRetentionDirty) {
                pendingChunks.push([]);
                this.#timelineUnpersisted = true;
                this.#timelineRetentionDirty = false;
                void flush();
            }
            updateHealth();
        };
        this.#timelinePolicyChanged = policyChanged;

        const currentAccountId = () => normalizeTimelineAccountId(userStore?.getCurrentUser?.()?.id);
        const activateAccount = async () => {
            const identity = this.#timelineAccountGuard.observe(currentAccountId());
            const valid = identity.accountId;
            if (accountInitialized && valid === accountId && identity.generation === accountGeneration) return;
            if (accountId && (pendingChunks.length || buffered.length)) this.#timelineIncompleteAccounts.add(accountId);
            accountInitialized = true;
            accountId = valid;
            accountReady = false;
            storageReadComplete = true;
            initialReadComplete = true;
            appendRetentionComplete = true;
            storageAttention = "";
            seededChannels.clear();
            buffered.splice(0);
            bufferedBytes = 0;
            pendingChunks.splice(0);
            queuedEvents = 0;
            this.#timelineRetentionDirty = false;
            queueOverflow = false;
            this.#timelineUnpersisted = valid ? this.#timelineIncompleteAccounts.has(valid) : false;
            accountGeneration = identity.generation;
            const generation = identity.generation;
            this.#timeline.clear();
            this.#timelinePersistent = false;
            this.#setHealth("message-timeline", {
                maturity: "preview",
                detail: accountId ? "Switching to an isolated Timeline account store; prior-account rows were removed before storage I/O." : "Waiting for a validated current-account scope; no messages are retained."
            });
            if (!accountId) {
                await this.#releaseTimelineAccount();
                const currentIdentity = this.#timelineAccountGuard.observe(currentAccountId());
                if (scope.disposed || generation !== accountGeneration || currentIdentity.generation !== generation || currentIdentity.accountId !== undefined) return;
                this.#timelinePersistent = false;
                this.#setHealth("message-timeline", {maturity: "preview", detail: "Waiting for a validated current-account scope; no messages are retained."});
                return;
            }
            const targetAccountId = accountId;
            const targetIdentity: TimelineAccountIdentity = {accountId: targetAccountId, generation};
            const identityIsCurrent = () => this.#timelineAccountGuard.matches(targetIdentity, currentAccountId());
            try {
                const opened = await this.#withTimelineAccount(targetAccountId, async capability => {
                    const storage = await TIMELINE_IPC.status(capability) as {persistent?: boolean; sessionOnly?: boolean;};
                    if (!identityIsCurrent()) throw new Error("TimelineAccountChangedBeforeRead");
                    const loaded = normalizeTimelineReadOutcome(await TIMELINE_IPC.read(capability, {policy}));
                    return {storage, loaded};
                }, identityIsCurrent);
                if (scope.disposed || generation !== accountGeneration || !identityIsCurrent()) return;
                this.#timelinePersistent = policy.retention !== "session" && opened.storage.persistent === true && opened.loaded.persistent === true;
                initialReadComplete = opened.loaded.status === "complete";
                storageReadComplete = initialReadComplete && !queueOverflow;
                storageAttention = queueOverflow ? "Some events exceeded Timeline's capture buffer. Export is incomplete until recovery."
                    : storageReadComplete ? "" : `The persistent read is partial (${opened.loaded.omittedSegments} omitted, ${opened.loaded.unreadableSegments} unreadable; retention ${opened.loaded.retentionApplied ? "applied" : "incomplete"}).`;
                this.#timeline.hydrate(opened.loaded.events, policy);
                accountReady = true;
                replayBuffered();
                updateHealth();
                seedSelectedChannel();
            }
            catch (error) {
                if (scope.disposed || generation !== accountGeneration || !identityIsCurrent()) return;
                this.#timelinePersistent = false;
                initialReadComplete = false;
                storageReadComplete = false;
                storageAttention = `The persistent read failed closed (${errorName(error)}).`;
                accountReady = true;
                replayBuffered();
                this.#setHealth("message-timeline", {maturity: "preview", detail: `Persistent timeline opened in fail-closed session mode (${errorName(error)}).`});
                seedSelectedChannel();
            }
        };

        const eventId = (kind: TimelineEvent["kind"]) => {
            const random = globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 16) ?? Math.random().toString(36).slice(2, 18);
            return `${kind}-${Date.now().toString(36)}-${random}`;
        };
        const scopedChannel = (channelId: unknown): channelId is string => typeof channelId === "string" && /^\d{1,32}$/.test(channelId) && channelIsInTimelineScope(channelStore.getChannel!(channelId), policy);
        const relationshipType = (userId: string): number | undefined => relationshipStore?.getRelationshipType?.(userId) ?? relationshipStore?.getRelationships?.()?.[userId];
        const observedEventAllowed = (event: ReturnType<typeof normalizeDiscordTimelineDispatch>[number]): boolean => {
            if (event.kind === "delete" || event.kind === "bulk-delete") return true;
            if (policy.filters.alwaysLogGhostPings && event.mentionedCurrentUser) return true;
            if (!timelineAuthorPolicyAllows(event, policy.filters, accountId, Boolean(event.authorId && relationshipType(event.authorId) === 2))) return false;
            const channel = channelStore.getChannel!(event.channelId);
            if (!channel) return false;
            const dm = channel.type === 1 || channel.type === 3;
            if (dm && policy.filters.alwaysLogDms) return true;
            const guildId = normalizeTimelineAccountId(channel.guild_id);
            if (policy.filters.ignoreNsfw && (channel.nsfw === true || channel.isNSFW?.() === true)) return false;
            if (policy.filters.ignoreMutedGuilds && guildId && muteStore?.isGuildMuted?.(guildId) === true) return false;
            if (policy.filters.ignoreMutedChannels && (
                muteStore?.isChannelMuted?.(guildId, event.channelId) === true
                || Boolean(guildId && muteStore?.isGuildOrCategoryOrChannelMuted?.(guildId, event.channelId) === true)
            )) return false;
            return true;
        };
        const flush = (): Promise<boolean> => {
            if (flushPromise) return flushPromise;
            const flushingAccount = accountId;
            const flushingGeneration = accountGeneration;
            const isCurrent = () => !scope.disposed && flushingAccount === currentAccountId() && flushingGeneration === accountGeneration;
            const operation = (async () => {
                try {
                    await drainTimelineChunks(pendingChunks, async chunk => {
                        const raw = await this.#withTimelineAccount(flushingAccount!, capability => TIMELINE_IPC.append(capability, {events: chunk, policy}), isCurrent);
                        if (!isCurrent()) return;
                        const result = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
                        queuedEvents -= chunk.length;
                        this.#timelinePersistent = policy.retention !== "session" && result.persistent === true;
                        if (result.retentionApplied !== true) {
                            appendRetentionComplete = false;
                            storageReadComplete = false;
                            storageAttention = "Retention cleanup is incomplete; encrypted residue requires review.";
                        }
                    }, isCurrent);
                }
                catch (error) {
                    if (!isCurrent()) return false;
                    storageAttention = `Timeline persistence is incomplete (${errorName(error)}). ${queuedEvents} event(s) remain queued; Export retries them before writing a file.`;
                    storageReadComplete = false;
                    this.#timelinePersistent = false;
                    updateHealth();
                    return false;
                }
                if (!isCurrent()) return false;
                this.#timelineUnpersisted = pendingChunks.length > 0 || queueOverflow || Boolean(accountId && this.#timelineIncompleteAccounts.has(accountId));
                storageReadComplete = initialReadComplete && appendRetentionComplete && !this.#timelineUnpersisted;
                if (storageReadComplete) storageAttention = "";
                updateHealth();
                return !this.#timelineUnpersisted;
            })();
            flushPromise = operation.finally(() => {
                flushPromise = undefined;
                if (flushingGeneration !== accountGeneration && accountReady && pendingChunks.length) void flush();
            });
            return flushPromise;
        };
        this.#flushTimelinePersistence = flush;
        const resetPending = () => {pendingChunks.splice(0); queuedEvents = 0; queueOverflow = false; buffered.splice(0); bufferedBytes = 0;};
        this.#resetTimelinePersistence = resetPending;
        const persistMany = (events: readonly TimelineEvent[]) => {
            const current = currentAccountId();
            if (!timelineEventAccountMatches(accountId, current, accountReady)) {
                if (current !== accountId) void activateAccount();
                return;
            }
            const changed = this.#timeline.applyBatch(events.map(fitTimelineEventBytes), policy);
            if (!changed.length) return;
            this.#timelineUnpersisted = true;
            if (queuedEvents + changed.length > 10_000) {
                queueOverflow = true;
                storageReadComplete = false;
                storageAttention = "Timeline's persistence queue reached its safety limit. Some session records are not stored; export is unavailable until recovery.";
                updateHealth();
                return;
            }
            pendingChunks.push(...chunkTimelineEvents(changed));
            queuedEvents += changed.length;
            updateHealth();
            void flush();
        };
        const createFromLoadedMessage = (message: Message | undefined, channelId: string): TimelineEvent | undefined => {
            if (!message) return;
            const normalized = normalizeDiscordTimelineDispatch("MESSAGE_CREATE", {message, channelId}, accountId)[0];
            if (normalized?.authorId) normalized.authorIsBot = message.author?.bot === true;
            if (!normalized || !scopedChannel(normalized.channelId) || !observedEventAllowed(normalized)) return;
            return {
                ...normalized,
                eventId: eventId("create"),
                observedAt: Date.now(),
                ...(policy.content === "text-only" ? {attachments: []} : {})
            };
        };
        const prepareObservedEvent = (raw: ReturnType<typeof normalizeDiscordTimelineDispatch>[number], at = Date.now()): TimelineEvent[] => {
            const loaded = messageStore?.getMessage?.(raw.channelId, raw.messageId);
            const cached = loaded ? normalizeDiscordTimelineDispatch("MESSAGE_CREATE", {message: loaded, channelId: raw.channelId}, accountId)[0] : undefined;
            if (cached?.authorId) cached.authorIsBot = loaded?.author?.bot === true;
            const known = this.#timeline.identity(raw.messageId) ?? cached;
            // A partial update never creates a new identity or bypasses a rejected seed.
            const event = resolveTimelineEventIdentity(raw, known);
            if (!event) return [];
            if (!scopedChannel(event.channelId) || !observedEventAllowed(event)) return [];
            const normalized: TimelineEvent = {
                ...event,
                eventId: eventId(event.kind),
                observedAt: at,
                ...(policy.content === "text-only" ? {attachments: []} : {})
            };
            if (event.kind === "create" || this.#timeline.has(event.messageId)) return [normalized];
            const seed = createFromLoadedMessage(messageStore?.getMessage?.(event.channelId, event.messageId), event.channelId);
            if (seed) return [seed, normalized];
            if (event.kind === "edit" && event.content !== undefined && known?.authorId) return [{...normalized, eventId: eventId("create"), kind: "create"}];
            return [normalized];
        };
        const handleDispatch = (type: DiscordTimelineDispatchType, payload: Record<string, unknown>) => {
            const normalized = normalizeDiscordTimelineDispatch(type, payload, accountId);
            if (!accountReady) {
                const bytes = timelineSerializedBytes(normalized);
                if (accountId === currentAccountId() && accountId && buffered.length + normalized.length <= 500 && bufferedBytes + bytes <= 4 * 1024 * 1024) {
                    buffered.push(...normalized.map(event => ({event, at: Date.now()})));
                    bufferedBytes += bytes;
                }
                else if (normalized.length && accountId) {
                    queueOverflow = true;
                    this.#timelineUnpersisted = true;
                    this.#timelineIncompleteAccounts.add(accountId);
                }
                return;
            }
            const events = normalized.flatMap(event => prepareObservedEvent(event));
            if (events.length) persistMany(events);
        };
        replayBuffered = () => {
            const events = buffered.splice(0).flatMap(({event, at}) => prepareObservedEvent(event, at));
            bufferedBytes = 0;
            if (events.length) persistMany(events);
        };
        seedSelectedChannel = () => {
            if (!accountReady) return;
            const channelId = normalizeTimelineAccountId(selectedChannelStore?.getChannelId?.());
            if (!channelId || !scopedChannel(channelId) || seededChannels.has(channelId)) return;
            const collection = messageStore?.getMessages?.(channelId);
            const messages = Array.isArray(collection) ? collection : collection?.toArray?.();
            if (!Array.isArray(messages)) return;
            seededChannels.add(channelId);
            const events = messages.slice(-250).flatMap(message => {
                const seed = createFromLoadedMessage(message, channelId);
                return seed && !this.#timeline.has(seed.messageId) ? [seed] : [];
            });
            if (events.length) persistMany(events);
        };

        const onCreate = (payload: Record<string, unknown>) => handleDispatch("MESSAGE_CREATE", payload);
        const onUpdate = (payload: Record<string, unknown>) => handleDispatch("MESSAGE_UPDATE", payload);
        const onDelete = (payload: Record<string, unknown>) => handleDispatch("MESSAGE_DELETE", payload);
        const onBulkDelete = (payload: Record<string, unknown>) => handleDispatch("MESSAGE_DELETE_BULK", payload);

        const subscriptions: Array<[string, (payload: Record<string, unknown>) => void]> = [
            ["MESSAGE_CREATE", onCreate],
            ["MESSAGE_UPDATE", onUpdate],
            ["MESSAGE_DELETE", onDelete],
            ["MESSAGE_DELETE_BULK", onBulkDelete]
        ];
        if (typeof dispatcher.subscribe === "function" && typeof dispatcher.unsubscribe === "function") {
            for (const [type, callback] of subscriptions) {
                dispatcher.subscribe(type, callback);
                scope.own(() => dispatcher.unsubscribe?.(type, callback), "listener");
            }
        }
        else if (typeof dispatcher.register === "function" && typeof dispatcher.unregister === "function") {
            const callbackByType = new Map(subscriptions);
            const token = dispatcher.register(payload => {
                const type = typeof payload?.type === "string" ? payload.type : "";
                callbackByType.get(type)?.(payload);
            });
            scope.own(() => dispatcher.unregister?.(token), "listener");
        }
        if (typeof selectedChannelStore?.addChangeListener === "function" && typeof selectedChannelStore.removeChangeListener === "function") {
            selectedChannelStore.addChangeListener(seedSelectedChannel);
            scope.own(() => selectedChannelStore.removeChangeListener?.(seedSelectedChannel), "listener");
        }
        if (typeof userStore?.addChangeListener === "function" && typeof userStore.removeChangeListener === "function") {
            const onAccountChange = () => {
                this.#timelineAccountGuard.observe(currentAccountId());
                void activateAccount();
            };
            userStore.addChangeListener(onAccountChange);
            scope.own(() => userStore.removeChangeListener?.(onAccountChange), "listener");
        }
        scope.interval(() => {
            const removed = this.#timeline.prune(policy);
            if (removed || this.#timelineRetentionDirty) {
                updateHealth();
                if (accountReady) {
                    pendingChunks.push([]);
                    this.#timelineUnpersisted = true;
                    this.#timelineRetentionDirty = false;
                    void flush();
                }
            }
            void activateAccount();
        }, 5_000);
        scope.own(() => {
            if (accountId && (pendingChunks.length || buffered.length)) this.#timelineIncompleteAccounts.add(accountId);
            accountId = undefined;
            accountGeneration = -1;
            accountInitialized = false;
            accountReady = false;
            buffered.splice(0);
            if (this.#flushTimelinePersistence === flush) this.#flushTimelinePersistence = undefined;
            if (this.#timelinePolicyChanged === policyChanged) this.#timelinePolicyChanged = undefined;
            if (this.#resetTimelinePersistence === resetPending) this.#resetTimelinePersistence = undefined;
            seededChannels.clear();
            this.#timeline.clear();
            this.#timelinePersistent = false;
            void this.#releaseTimelineAccount();
        }, "cache");
        await activateAccount();
    }

    #initializeCrashGuard(now = Date.now()): boolean {
        const raw = JsonStore.get("misc", "solcordCrashGuard") as Partial<CrashGuardDocument> | undefined;
        const result = evaluateCrashGuard(raw, now);
        JsonStore.set("misc", "solcordCrashGuard", result.next);
        return result.recovery;
    }

    #setHealth(id: SolcordModuleId, update: Partial<SolcordModuleHealth>): void {
        const current = this.#health.get(id);
        if (!current) return;
        this.#health.set(id, {...current, ...update});
        this.emitChange();
    }
}

export default new SolcordRuntimeStore();
