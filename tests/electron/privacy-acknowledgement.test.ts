import {describe, expect, mock, test} from "bun:test";
import {applyPrivacyProfile, defaultStrictPrivacyPreferences} from "../../src/common/solcord/privacy";
import {registeredNativeIpcHandlerFixture, rendererIpcMethodFixture} from "../fixtures/solcord-method-fixture";

const electron = {app: {getPath: () => {throw Error("No profile access in this fixture");}}};
mock.module("electron", () => ({"default": electron, ...electron}));
const {synchronizeNativePrivacy} = await import("../../src/electron/main/modules/privacy-network");

describe("shipping privacy policy acknowledgement across IPC", () => {
    test("returns only effective decisions through the actual native and renderer handlers", async () => {
        const calls: string[] = [];
        const native = registeredNativeIpcHandlerFixture("PRIVACY_POLICY_UPDATE", {
            requireTrustedSolcordSender: (event: unknown) => {expect(event).toBe("trusted-frame"); calls.push("trusted");},
            synchronizeNativePrivacy: (policy: unknown) => {calls.push("enforced"); return synchronizeNativePrivacy(policy);}
        });
        const renderer = rendererIpcMethodFixture("synchronizePrivacyPolicy", {
            IPCEvents: {PRIVACY_POLICY_UPDATE: "privacy-policy"},
            invokePrivate: (event: unknown, policy: unknown) => {expect(event).toBe("privacy-policy"); return Promise.resolve(native.call({}, "trusted-frame", policy));}
        });
        const acknowledgement = await renderer.call({}, applyPrivacyProfile(defaultStrictPrivacyPreferences(), "standard", 42));
        expect(calls).toEqual(["trusted", "enforced"]);
        expect(acknowledgement).toEqual({telemetry: "block", crashReporting: "block-optional"});
        expect(Object.keys(acknowledgement as object).sort()).toEqual(["crashReporting", "telemetry"]);
    });

    test("an untrusted sender cannot change or obtain policy through the handler", () => {
        let enforced = false;
        const native = registeredNativeIpcHandlerFixture("PRIVACY_POLICY_UPDATE", {
            requireTrustedSolcordSender: () => {throw Error("Untrusted frame");},
            synchronizeNativePrivacy: () => {enforced = true;}
        });
        expect(() => native.call({}, "foreign-frame", defaultStrictPrivacyPreferences())).toThrow("Untrusted frame");
        expect(enforced).toBeFalse();
    });
});
