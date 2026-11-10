import {describe, expect, test} from "bun:test";

import {
    applyModulePreferenceBindings,
    applyProductPreferenceBindings,
    createSolcordImportPreview,
    defaultProfiles,
    diffModules,
    MODULE_DEFAULTS,
    normalizeSetupDraft,
    normalizeSolcordDocument,
    parseSolcordImport,
    previewSolcordImportChanges,
    previewSetupChanges,
    reopenOnboardingState,
    restoreSnapshotState,
    serializeSolcordSettingsExport,
    SOLCORD_PRESET_ADDONS,
    verifySolcordImportAtApply
} from "../../src/betterdiscord/modules/solcord/store";
import {recommendedSolcordSetupAddons, resolveSolcordSetupPlan} from "../../src/common/solcord/setup-catalog";


describe("Solcord settings schema", () => {
    test("binds Control Center preferences to the live module switches they govern", () => {
        const document = normalizeSolcordDocument({schemaVersion: 5});

        applyProductPreferenceBindings(document, {
            ...document.productPreferences,
            safety: {...document.productPreferences.safety, linkLens: true},
            friendWatch: {enabled: true, retentionDays: 30, digest: "daily"}
        });

        expect(document.modules["link-lens"].enabled).toBeTrue();
        expect(document.modules["friend-watch"].enabled).toBeTrue();
        expect(document.modules["friend-watch"].values).toEqual(expect.objectContaining({retentionDays: 30, digest: "daily"}));

        applyProductPreferenceBindings(document, {
            ...document.productPreferences,
            safety: {...document.productPreferences.safety, linkLens: false},
            friendWatch: {enabled: false, retentionDays: 7, digest: "off"}
        });

        expect(document.modules["link-lens"].enabled).toBeFalse();
        expect(document.modules["friend-watch"].enabled).toBeFalse();
    });

    test("keeps explicit schema-v5 module disables authoritative during restart normalization", () => {
        const document = normalizeSolcordDocument({
            schemaVersion: 5,
            productPreferences: {safety: {linkLens: true}, friendWatch: {enabled: false, retentionDays: 7, digest: "off"}},
            modules: {
                "link-lens": {enabled: false, values: {}},
                "friend-watch": {enabled: true, values: {retentionDays: 90, digest: "per-event"}}
            }
        });

        expect(document.modules["link-lens"].enabled).toBeFalse();
        expect(document.modules["friend-watch"]).toEqual(expect.objectContaining({enabled: true, values: expect.objectContaining({retentionDays: 90, digest: "per-event"})}));
        expect(document.productPreferences.safety.linkLens).toBeFalse();
        expect(document.productPreferences.friendWatch).toEqual(expect.objectContaining({enabled: true, retentionDays: 90, digest: "per-event"}));
    });

    test("migrates pre-v5 product preferences into their module bindings once", () => {
        const document = normalizeSolcordDocument({
            schemaVersion: 4,
            productPreferences: {safety: {linkLens: true}, friendWatch: {enabled: true, retentionDays: 7, digest: "daily"}},
            modules: {
                "link-lens": {enabled: false, values: {}},
                "friend-watch": {enabled: false, values: {retentionDays: 90, digest: "per-event"}}
            }
        });

        expect(document.modules["link-lens"].enabled).toBeTrue();
        expect(document.modules["friend-watch"]).toEqual(expect.objectContaining({enabled: true, values: expect.objectContaining({retentionDays: 7, digest: "daily"})}));
    });

    test("keeps generic module and profile controls synchronized with product preferences", () => {
        const document = normalizeSolcordDocument({schemaVersion: 5});
        document.productPreferences.safety.linkLens = true;
        document.productPreferences.friendWatch = {enabled: true, retentionDays: 30, digest: "daily", includeDisplaySnapshot: true};
        document.modules["link-lens"].enabled = false;
        document.modules["friend-watch"] = {enabled: false, values: {retentionDays: 7, digest: "off"}};

        applyModulePreferenceBindings(document);

        expect(document.productPreferences.safety.linkLens).toBeFalse();
        expect(document.productPreferences.friendWatch).toEqual(expect.objectContaining({enabled: false, retentionDays: 7, digest: "off"}));
    });

    test("bounds numeric fields and strips unknown values from imports", () => {
        const document = normalizeSolcordDocument({
            modules: {
                "performance-hud": {enabled: true, values: {sampleSeconds: 999, bearerToken: "must-not-survive"}},
                "accessibility-toolkit": {enabled: true, values: {readingWidth: -5, injectedCss: "nope"}}
            }
        });

        expect(document.modules["performance-hud"].values.sampleSeconds).toBe(30);
        expect(document.modules["accessibility-toolkit"].values.readingWidth).toBe(0);
        expect(document.modules["performance-hud"].values).not.toHaveProperty("bearerToken");
        expect(document.modules["accessibility-toolkit"].values).not.toHaveProperty("injectedCss");
    });

    test("produces a complete profile diff without mutating either side", () => {
        const before = structuredClone(MODULE_DEFAULTS);
        const after = structuredClone(MODULE_DEFAULTS);
        after["stream-shield"].enabled = true;
        after["performance-hud"].values.sampleSeconds = 12;

        expect(diffModules(before, after)).toEqual([
            "performance-hud.sampleSeconds",
            "stream-shield: off → on"
        ]);
        expect(before["stream-shield"].enabled).toBeFalse();
    });

    test("restores modules and profiles from a validated snapshot copy", () => {
        const document = normalizeSolcordDocument(undefined);
        const snapshotModules = structuredClone(document.modules);
        snapshotModules["stream-shield"].enabled = true;
        document.snapshots.push({
            id: "known",
            reason: "test",
            createdAt: 1,
            modules: snapshotModules,
            profiles: defaultProfiles().slice(0, 1),
            selectedTheme: document.selectedTheme,
            curatedAddons: structuredClone(document.curatedAddons),
            timelinePolicy: structuredClone(document.timelinePolicy),
            productPreferences: structuredClone(document.productPreferences)
        });

        const restored = restoreSnapshotState(document, "known");
        expect(restored?.modules["stream-shield"].enabled).toBeTrue();
        expect(restored?.profiles).toHaveLength(1);
        restored!.modules["stream-shield"].enabled = false;
        expect(document.snapshots[0].modules["stream-shield"].enabled).toBeTrue();
        expect(restoreSnapshotState(document, "missing")).toBeUndefined();
    });

    test("canonicalizes legacy snapshot preference drift before rollback can restore it", () => {
        const document = normalizeSolcordDocument({
            schemaVersion: 5,
            snapshots: [{
                id: "legacy-drift",
                reason: "pre-fix snapshot",
                createdAt: 1,
                modules: {
                    "link-lens": {enabled: false, values: {}},
                    "friend-watch": {enabled: false, values: {retentionDays: 7, digest: "off"}}
                },
                profiles: [],
                selectedTheme: "solcord-default",
                curatedAddons: {},
                timelinePolicy: {},
                productPreferences: {
                    safety: {linkLens: true},
                    friendWatch: {enabled: true, retentionDays: 90, digest: "per-event", includeDisplaySnapshot: true}
                }
            }]
        });

        const restored = restoreSnapshotState(document, "legacy-drift")!;
        expect(restored.modules["link-lens"].enabled).toBeFalse();
        expect(restored.modules["friend-watch"]).toEqual(expect.objectContaining({
            enabled: false,
            values: expect.objectContaining({retentionDays: 7, digest: "off"})
        }));
        expect(restored.productPreferences.safety.linkLens).toBeFalse();
        expect(restored.productPreferences.friendWatch).toEqual(expect.objectContaining({enabled: false, retentionDays: 7, digest: "off"}));
    });

    test("migrates pre-v5 snapshot preferences into module bindings exactly once", () => {
        const document = normalizeSolcordDocument({
            schemaVersion: 4,
            snapshots: [{
                id: "pre-v5",
                reason: "migration",
                createdAt: 1,
                modules: {
                    "link-lens": {enabled: false, values: {}},
                    "friend-watch": {enabled: false, values: {retentionDays: 7, digest: "off"}}
                },
                profiles: [],
                selectedTheme: "solcord-default",
                curatedAddons: {},
                timelinePolicy: {},
                productPreferences: {
                    safety: {linkLens: true},
                    friendWatch: {enabled: true, retentionDays: 30, digest: "daily", includeDisplaySnapshot: false}
                }
            }]
        });

        const restored = restoreSnapshotState(document, "pre-v5")!;
        expect(restored.modules["link-lens"].enabled).toBeTrue();
        expect(restored.modules["friend-watch"]).toEqual(expect.objectContaining({
            enabled: true,
            values: expect.objectContaining({retentionDays: 30, digest: "daily"})
        }));
    });

    test("rejects malformed or foreign settings imports", () => {
        expect(parseSolcordImport("not json")).toBeUndefined();
        expect(parseSolcordImport(JSON.stringify({format: "other", version: 1}))).toBeUndefined();
        expect(parseSolcordImport(JSON.stringify({format: "solcord-settings", version: 99}))).toBeUndefined();
        expect(parseSolcordImport(JSON.stringify({format: "solcord-settings", version: 2}))).toBeDefined();
    });

    test("ordinary settings exports omit Timeline channel identifiers and normalize their scope", () => {
        const document = normalizeSolcordDocument({
            schemaVersion: 4,
            timelinePolicy: {enabled: true, scope: "selected-channels", serverChannelIds: ["123456789012345678"], retention: "30-days", content: "text-only"},
            modules: {"message-timeline": {enabled: true, values: {scope: "selected-channels", retention: "30-days", content: "text-only"}}}
        });
        document.curatedAddons.DoNotTrack = {
            ...document.curatedAddons.DoNotTrack,
            selected: true,
            enabled: true,
            provider: "prefer-solcord",
            reviewedSha256: "a".repeat(64),
            quarantineReason: "machine-local hold"
        };
        document.productPreferences.nativeSuite = {
            ...document.productPreferences.nativeSuite,
            pinnedDmIds: ["123456789012345670"],
            hiddenGuildIds: ["123456789012345671"],
            guildAliases: {"123456789012345671": "Private workshop"},
            focusChannelIds: ["123456789012345672"],
            voiceHealthEnabled: true,
            translation: {provider: "libretranslate", endpoint: "https://private.example/translate", sourceLanguage: "auto", targetLanguage: "EN"},
            composer: {doubleClickReplyModifier: "shift", splitBoundary: "newlines", preserveBlankLines: true, splitLimit: 1_800, maxSplitParts: 8, attachmentThreshold: 12_000, counterWarningPercent: 75, timestampFormat: "compact"}
        };

        const exported = serializeSolcordSettingsExport(document);
        const imported = parseSolcordImport(exported);

        expect(exported).not.toContain("123456789012345678");
        expect(imported?.timelinePolicy.scope).toBe("dm-only");
        expect(imported?.timelinePolicy.serverChannelIds).toEqual([]);
        expect(imported?.modules["message-timeline"].values.scope).toBe("dm-only");
        expect(imported?.curatedAddons.DoNotTrack).toEqual({selected: true, enabled: false, mode: "default", provider: "prefer-solcord"});
        expect(exported).not.toContain("machine-local hold");
        expect(exported).not.toContain("a".repeat(64));
        expect(exported).not.toContain("123456789012345670");
        expect(exported).not.toContain("123456789012345671");
        expect(exported).not.toContain("123456789012345672");
        expect(exported).not.toContain("Private workshop");
        expect(exported).not.toContain("private.example");
        expect(document.timelinePolicy.serverChannelIds).toEqual(["123456789012345678"]);
    });

    test("never imports curated runtime enablement or review receipts", () => {
        const imported = parseSolcordImport(JSON.stringify({
            format: "solcord-settings",
            version: 2,
            schemaVersion: 4,
            curatedAddons: {
                DoNotTrack: {
                    selected: true,
                    enabled: true,
                    mode: "default",
                    provider: "prefer-solcord",
                    reviewedSha256: "b".repeat(64),
                    quarantineReason: "forged local receipt"
                }
            },
            setupTransactions: [{id: "setup-0123456789abcdef", snapshotId: "forged", priorAddonStates: {"owner.plugin.js": true}}]
        }));

        expect(imported?.curatedAddons.DoNotTrack).toEqual({selected: true, enabled: false, mode: "default", provider: "prefer-solcord"});
        expect(imported?.setupTransactions).toEqual([]);
    });

    test("previews every imported theme, addon, Timeline, and Power Lab mutation without exposing channel identifiers", () => {
        const current = normalizeSolcordDocument({
            schemaVersion: 4,
            powerLab: {decor: {enabled: true, acknowledgementVersion: 3, acknowledgedAt: 5}},
            timelinePolicy: {enabled: false, scope: "dm-only", serverChannelIds: [], retention: "7-days", content: "text-only"}
        });
        const candidate = normalizeSolcordDocument({
            schemaVersion: 4,
            selectedTheme: "paper-signal",
            curatedAddons: {DoNotTrack: {selected: false, enabled: true, mode: "native", reviewedSha256: "a".repeat(64), quarantineReason: "held"}},
            timelinePolicy: {enabled: true, scope: "selected-channels", serverChannelIds: ["987654321098765432"], retention: "90-days", content: "encrypted-media", mediaBudgetBytes: 5_368_709_120}
        });

        const changes = previewSolcordImportChanges(current, candidate);
        const preview = changes.join("\n");

        expect(changes).toContain("theme: solcord-default → paper-signal");
        expect(changes).toContain("DoNotTrack selected: on → off");
        expect(changes).toContain("DoNotTrack enabled: off → on");
        expect(changes).toContain("DoNotTrack mode: default → native");
        expect(changes).toContain("DoNotTrack review receipt: none → present");
        expect(changes).toContain("DoNotTrack quarantine: none → present");
        expect(changes).toContain("Message Timeline enabled: off → on");
        expect(changes).toContain("Message Timeline scope: dm-only → selected-channels");
        expect(changes).toContain("Message Timeline selected channels: 0 → 1 (identifiers hidden)");
        expect(changes).toContain("Message Timeline retention: 7-days → 90-days");
        expect(changes).toContain("Message Timeline content: text-only → encrypted-media");
        expect(changes).toContain("Message Timeline media budget: 1073741824 → 5368709120 bytes");
        expect(changes).toContain("Power Lab: clear 1 acknowledgement(s) and disable 1 experiment(s)");
        expect(preview).not.toContain("987654321098765432");
    });

    test("revalidates the complete normalized import preview immediately before apply", () => {
        const current = normalizeSolcordDocument({schemaVersion: 3});
        const text = serializeSolcordSettingsExport(normalizeSolcordDocument({schemaVersion: 3, selectedTheme: "carbon-ember"}));
        const candidate = parseSolcordImport(text)!;
        const preview = createSolcordImportPreview(current, candidate);

        expect(verifySolcordImportAtApply(current, text, preview.fingerprint)?.selectedTheme).toBe("carbon-ember");
        expect(verifySolcordImportAtApply(current, text, "0".repeat(64))).toBeUndefined();
    });

    test("binds approval to opaque normalized state when privacy-safe summaries collide", () => {
        const current = normalizeSolcordDocument({schemaVersion: 3});
        current.timelinePolicy = {...current.timelinePolicy, scope: "selected-channels", serverChannelIds: ["111"]};
        current.modules["performance-hud"].values.sampleSeconds = 5;
        current.curatedAddons.DoNotTrack = {...current.curatedAddons.DoNotTrack, reviewedSha256: "a".repeat(64), quarantineReason: "first"};
        current.profiles[0] = {...current.profiles[0], name: "Current profile"};

        const candidate = structuredClone(current);
        candidate.timelinePolicy.serverChannelIds = ["333"];
        candidate.modules["performance-hud"].values.sampleSeconds = 10;
        candidate.curatedAddons.DoNotTrack = {...candidate.curatedAddons.DoNotTrack, reviewedSha256: "c".repeat(64), quarantineReason: "candidate"};
        candidate.profiles[0] = {...candidate.profiles[0], name: "Candidate profile"};
        const text = JSON.stringify({format: "solcord-settings", version: 2, ...candidate});
        const normalizedCandidate = parseSolcordImport(text)!;
        const approved = createSolcordImportPreview(current, normalizedCandidate);

        const drifted = structuredClone(current);
        drifted.timelinePolicy.serverChannelIds = ["222"];
        drifted.modules["performance-hud"].values.sampleSeconds = 15;
        drifted.curatedAddons.DoNotTrack = {...drifted.curatedAddons.DoNotTrack, reviewedSha256: "b".repeat(64), quarantineReason: "second"};
        drifted.profiles[0] = {...drifted.profiles[0], name: "Drifted profile"};
        const collidingSummary = createSolcordImportPreview(drifted, normalizedCandidate);

        expect(collidingSummary.changes).toEqual(approved.changes);
        expect(collidingSummary.fingerprint).not.toBe(approved.fingerprint);
        expect(verifySolcordImportAtApply(drifted, text, approved.fingerprint)).toBeUndefined();
    });

    test("bounds and deduplicates imported profiles while preserving later unique entries", () => {
        const base = defaultProfiles()[0];
        const profiles = [
            {...base, id: "same", name: "First"},
            {...base, id: "same", name: "Duplicate"},
            ...Array.from({length: 55}, (_, index) => ({...base, id: `custom-${index}`, name: `Custom ${index}`}))
        ];
        const document = parseSolcordImport(JSON.stringify({format: "solcord-settings", version: 1, profiles}));

        expect(document?.profiles).toHaveLength(50);
        expect(document?.profiles.filter(profile => profile.id === "same")).toHaveLength(1);
        expect(document?.profiles.some(profile => profile.id === "custom-48")).toBeTrue();
        expect(document?.profiles.some(profile => profile.id === "custom-49")).toBeFalse();
    });

    test("restores built-in profiles when an import contains no valid profile", () => {
        const document = parseSolcordImport(JSON.stringify({format: "solcord-settings", version: 1, profiles: [{id: 1}]}));
        expect(document?.profiles.map(profile => profile.id)).toEqual(["activities", "gaming", "calls", "streaming", "focus"]);
    });

    test("migrates an older schema to v10 fail-closed without carrying stale Link Lens or Power Lab consent", () => {
        const document = normalizeSolcordDocument({
            schemaVersion: 2,
            modules: {"link-lens": {enabled: true, values: {confirmAllExternal: true, removeTrackers: true}}},
            powerLab: {"voice-anchor": {enabled: true, acknowledgementVersion: 2, acknowledgedAt: 1}}
        });

        expect(document.schemaVersion).toBe(10);
        expect(document.consentVersion).toBe(3);
        expect(document.onboarding.status).toBe("pending");
        expect(document.modules["link-lens"].enabled).toBeFalse();
        expect(document.powerLab["voice-anchor"].enabled).toBeFalse();
        expect(document.migrationProvenance.at(-1)).toEqual(expect.objectContaining({fromSchema: 2, toSchema: 10}));
    });

    test("starts a genuinely new profile in Strict Privacy without a false migration receipt", () => {
        const document = normalizeSolcordDocument(undefined);

        expect(document.productPreferences.privacy).toEqual(expect.objectContaining({
            profile: "strict",
            migrationPending: false,
            telemetry: "block",
            crashReporting: "block-optional",
            activityDiscovery: "block",
            updates: "manual"
        }));
        expect(document.migrationProvenance).toEqual([]);
    });

    test("keeps a persisted pre-v7 profile on the explicit privacy migration path", () => {
        const document = normalizeSolcordDocument({schemaVersion: 6});

        expect(document.productPreferences.privacy).toEqual(expect.objectContaining({
            profile: "strict",
            migrationPending: true,
            telemetry: "block",
            crashReporting: "block-optional",
            activityDiscovery: "block",
            updates: "manual",
            externalProviders: "off"
        }));
        expect(document.migrationProvenance.at(-1)).toEqual(expect.objectContaining({fromSchema: 6, toSchema: 10}));
    });

    test("preserves an explicitly selected standard or custom privacy profile with a migration receipt", () => {
        for (const profile of ["standard", "custom"] as const) {
            const document = normalizeSolcordDocument({schemaVersion: 6, productPreferences: {privacy: {profile, migratedAt: 123, telemetry: "allow", updates: "automatic"}}});
            expect(document.productPreferences.privacy).toMatchObject({profile, migratedAt: 123, telemetry: "allow", updates: "automatic"});
        }
    });

    test("disables Power Lab entries unless their versioned acknowledgement is current", () => {
        const document = normalizeSolcordDocument({
            schemaVersion: 4,
            powerLab: {
                "voice-anchor": {enabled: true, acknowledgementVersion: 1, acknowledgedAt: 1},
                "decor": {enabled: true, acknowledgementVersion: 3, acknowledgedAt: 2}
            }
        });

        expect(document.powerLab["voice-anchor"]).toEqual({enabled: false, acknowledgementVersion: 1, acknowledgedAt: 1});
        expect(document.powerLab.decor).toEqual({enabled: true, acknowledgementVersion: 3, acknowledgedAt: 2});
        expect(document.powerLab["fake-mute"]).toEqual({enabled: false, acknowledgementVersion: 0});
    });

    test("migrates schema-v4 built-ins to the Solcord provider and expires old Power Lab consent", () => {
        const document = normalizeSolcordDocument({
            schemaVersion: 4,
            curatedAddons: {DoNotTrack: {selected: true, enabled: false, mode: "default", provider: "prefer-community"}},
            powerLab: {"fake-deafen": {enabled: true, acknowledgementVersion: 2, acknowledgedAt: 12}}
        });

        expect(document.schemaVersion).toBe(10);
        expect(document.curatedAddons.DoNotTrack.provider).toBe("prefer-solcord");
        expect(document.powerLab["fake-deafen"]).toEqual({enabled: false, acknowledgementVersion: 2, acknowledgedAt: 12});
    });

    test("normalizes and retains a resumable setup draft only as onboarding state", () => {
        const document = normalizeSolcordDocument({
            schemaVersion: 5,
            onboarding: {
                status: "pending",
                lastStep: 4,
                draft: {selectedTheme: "paper-signal", selectedAddons: ["DoNotTrack", "forged"], addonProviders: {DoNotTrack: "prefer-solcord"}}
            }
        });

        expect(document.onboarding.version).toBe(5);
        expect(document.onboarding.lastStep).toBe(4);
        expect(document.onboarding.draft?.selectedTheme).toBe("paper-signal");
        expect(document.onboarding.draft?.selectedAddons).toEqual(["DoNotTrack"]);
        expect(document.onboarding.draft?.addonProviders.DoNotTrack).toBe("prefer-solcord");
    });

    test("resumes a deferred setup at the saved step and restarts completed setup from Welcome", () => {
        const draft = normalizeSetupDraft({selectedTheme: "paper-signal"});
        expect(reopenOnboardingState({version: 5, status: "skipped", lastStep: 2, completedAt: 10, draft})).toEqual({
            version: 5,
            status: "pending",
            lastStep: 2,
            draft
        });
        expect(reopenOnboardingState({version: 5, status: "complete", lastStep: 4, completedAt: 10})).toEqual({
            version: 5,
            status: "pending",
            lastStep: 0
        });
    });

    test("normalizes a setup draft to the 36 known addons and safe defaults", () => {
        const draft = normalizeSetupDraft({
            selectedTheme: "unknown",
            selectedAddons: ["DoNotTrack", "DoNotTrack", "not-real"],
            addonModes: {SplitLargeMessages: "native", DoNotTrack: "invalid"},
            addonProviders: {DoNotTrack: "prefer-solcord", InvisibleTyping: "forged"},
            timelinePolicy: {
                enabled: true,
                scope: "selected-channels",
                serverChannelIds: ["123", "123", "../bad"],
                retention: "90-days",
                content: "text-and-metadata",
                textBudgetBytes: 1,
                mediaBudgetBytes: 123
            }
        });

        expect(draft.selectedTheme).toBe("solcord-default");
        expect(draft.selectedAddons).toEqual(["DoNotTrack"]);
        expect(Object.keys(draft.addonModes)).toHaveLength(36);
        expect(draft.addonModes.SplitLargeMessages).toBe("native");
        expect(draft.addonModes.DoNotTrack).toBe("default");
        expect(Object.keys(draft.addonProviders)).toHaveLength(36);
        expect(draft.addonProviders.DoNotTrack).toBe("prefer-solcord");
        expect(draft.addonProviders.InvisibleTyping).toBe("prefer-solcord");
        expect(draft.timelinePolicy).toEqual(expect.objectContaining({
            enabled: true,
            serverChannelIds: ["123"],
            textBudgetBytes: 262_144_000,
            mediaBudgetBytes: 1_073_741_824
        }));

        const recommended = recommendedSolcordSetupAddons();
        expect(normalizeSetupDraft(undefined).selectedAddons).toEqual(recommended);
        expect(normalizeSetupDraft(undefined).selectedTheme).toBe("solcord-default");
        expect(normalizeSetupDraft(undefined).addonProviders.DoNotTrack).toBe("prefer-solcord");
        expect(normalizeSetupDraft(undefined).addonProviders.InvisibleTyping).toBe("prefer-solcord");
        expect(normalizeSetupDraft(undefined).addonProviders.DoubleClickToReply).toBe("prefer-solcord");
        expect(normalizeSetupDraft(undefined).addonProviders.PinDMs).toBe("prefer-solcord");

        const defaults = normalizeSolcordDocument({});
        expect(defaults.selectedTheme).toBe("solcord-default");
        expect(SOLCORD_PRESET_ADDONS.filter(name => defaults.curatedAddons[name].selected).map(String).sort()).toEqual([...recommended].sort());

        const stalePreview = normalizeSolcordDocument({
            curatedAddons: {SplitLargeMessages: {selected: true, enabled: true, mode: "guarded", provider: "prefer-solcord"}}
        });
        expect(stalePreview.curatedAddons.SplitLargeMessages).toEqual(expect.objectContaining({selected: true, enabled: true, mode: "guarded"}));
    });

    test("reopens an older completed setup once for the full provider-consolidation review", () => {
        const document = normalizeSolcordDocument({schemaVersion: 3, onboarding: {status: "skipped", completedAt: 10}});
        const before = structuredClone(document);
        const noChangeDraft = {
            selectedTheme: document.selectedTheme,
            selectedAddons: Object.entries(document.curatedAddons).filter(([, state]) => state.selected).map(([name]) => name),
            addonModes: Object.fromEntries(Object.entries(document.curatedAddons).map(([name, state]) => [name, state.mode])),
            addonProviders: Object.fromEntries(Object.entries(document.curatedAddons).map(([name, state]) => [name, state.provider])),
            timelinePolicy: document.timelinePolicy,
            productPreferences: document.productPreferences
        };

        expect(document.onboarding).toEqual({version: 5, status: "pending", lastStep: 0});
        const enablePreview = previewSetupChanges(document, noChangeDraft);
        const recommended = recommendedSolcordSetupAddons();
        expect(enablePreview).toHaveLength(recommended.length);
        expect(enablePreview.filter(change => change.endsWith(": stage, verify, and enable individually"))).toHaveLength(0);
        for (const name of recommended) {
            expect(enablePreview).toContain(`${name}: enable Solcord clean-room adapter (no community file)`);
        }
        expect(document).toEqual(before);

        const allSelectedPreview = previewSetupChanges(document, {...noChangeDraft, selectedAddons: [...SOLCORD_PRESET_ADDONS]});
        const allSelectedPlan = resolveSolcordSetupPlan(SOLCORD_PRESET_ADDONS, noChangeDraft.addonModes);
        expect(allSelectedPreview.filter(change => change.includes(": skip this run — "))).toHaveLength(allSelectedPlan.skipped.length);
        expect(allSelectedPreview).toContain("BlurNSFW: skip this run — optional · held for review");
        expect(allSelectedPreview).toContain("BetterSearchPage: skip this run — optional · dependency held");
        expect(allSelectedPreview).toContain("PermissionsViewer: skip this run — optional · runtime pending");

        expect(previewSetupChanges(document, {...noChangeDraft, selectedTheme: "paper-signal", selectedAddons: []})).toContain("theme: solcord-default → paper-signal");
        expect(previewSetupChanges(document, {...noChangeDraft, addonProviders: {...noChangeDraft.addonProviders, DoNotTrack: "prefer-community"}})).toContain("DoNotTrack.provider: prefer-solcord → prefer-community");
        expect(document).toEqual(before);
    });

    test("previews a held request without falsely claiming an active owner addon will be stopped", () => {
        const document = normalizeSolcordDocument({
            schemaVersion: 3,
            curatedAddons: {BlurNSFW: {selected: true, enabled: true, mode: "default"}}
        });
        const draft = normalizeSetupDraft({selectedAddons: ["BlurNSFW"]});
        const preview = previewSetupChanges(document, draft);

        expect(preview).toContain("BlurNSFW: skip this run — optional · held for review");
        expect(preview.some(change => change.startsWith("BlurNSFW: ") && change.includes("disable"))).toBeFalse();
        expect(preview.some(change => change.startsWith("BlurNSFW: ") && change.includes("deselect"))).toBeFalse();

        const deselected = previewSetupChanges(document, {...draft, selectedAddons: []});
        expect(deselected).toContain("BlurNSFW: remove from Solcord selection; existing owner file remains unchanged");
        expect(deselected.some(change => change.startsWith("BlurNSFW: ") && change.includes("disable"))).toBeFalse();
    });

    test("preserves exact safe addon filenames in rollback journals and drops aliases or paths", () => {
        const document = normalizeSolcordDocument({
            schemaVersion: 3,
            setupTransactions: [{
                id: "setup-0123456789abcdef",
                at: 5,
                snapshotId: "before-setup",
                priorAddonStates: {"owner-renamed.plugin.js": true, "DoNotTrack.plugin.js": false, "DoNotTrack": true, "../escape.plugin.js": true},
                priorThemeStates: {"Solcord-ObsidianThread.theme.css": true, "foreign.theme.css": true, "../escape.theme.css": true}
            }, {
                id: "path/traversal",
                snapshotId: "bad",
                priorAddonStates: {}
            }]
        });

        expect(document.setupTransactions).toEqual([{
            id: "setup-0123456789abcdef",
            at: 5,
            snapshotId: "before-setup",
            priorAddonStates: {"owner-renamed.plugin.js": true, "DoNotTrack.plugin.js": false},
            priorThemeStates: {"Solcord-ObsidianThread.theme.css": true, "foreign.theme.css": true}
        }]);
    });
});
