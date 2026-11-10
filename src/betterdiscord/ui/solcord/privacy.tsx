import React from "react";
import {useStateFromStores} from "@ui/hooks";
import SolcordRuntime from "@modules/solcord/runtime";
import SolcordSettings from "@modules/solcord/store";
import {CoreUpdater, PluginUpdater, ThemeUpdater} from "@modules/updater";
import {privacyCapabilityStateLabel} from "@common/solcord/privacy";
import ActionButton from "./action-button";
import {useSolcordAction} from "./use-action";

export default function PrivacyProtectionPanel() {
    const state = useStateFromStores([SolcordSettings, SolcordRuntime], () => ({
        "preferences": SolcordSettings.slice("productPreferences").privacy,
        "capabilities": SolcordRuntime.privacyCapabilities(),
        "native": SolcordRuntime.privacyNativePolicyStatus(),
        "receipts": SolcordRuntime.privacyDecisionReceipts(),
        "receiptStorage": SolcordRuntime.privacyReceiptStorage()
    }));
    const [status, setStatus] = React.useState("");
    const {pending, run} = useSolcordAction(async (action: "strict" | "standard" | "updates") => {
        if (action === "updates") {
            setStatus("Checking reviewed addon and theme sources…");
            try {
                await Promise.all([CoreUpdater.checkForUpdate(false), PluginUpdater.checkAll(false), ThemeUpdater.checkAll(false)]);
                setStatus("Manual checks finished. Review the update list for results. Solcord core remains pinned until an owner-controlled integrity feed is available.");
            }
            catch {setStatus("The manual update check did not complete. Existing files were not changed.");}
            return;
        }
        const needsChoice = action !== state.preferences.profile || state.preferences.migrationPending;
        if (needsChoice && !window.confirm(action === "strict"
            ? "Apply Strict Privacy? Solcord will capture a rollback snapshot, block verified optional reporting and activity discovery, make update checks manual, and disable enabled community addons whose exact reviewed bytes do not declare local-only behavior. Core chat, calls, media, moderation, safety, sign-in, and Discord security updates remain available."
            : "Use Standard privacy? This allows optional Discord telemetry, optional crash reports, activity discovery, and automatic addon and theme update checks. Reviewed external providers may be used after their separate action confirmation. A rollback snapshot will be saved before this choice is applied.")) return;
        setStatus("Saving privacy preferences and checking protection…");
        try {
            await SolcordRuntime.setPrivacyProfile(action);
            const native = SolcordRuntime.privacyNativePolicyStatus();
            const name = action === "strict" ? "Strict Privacy" : "Standard privacy";
            setStatus(native.state === "applied" && native.profile === action
                ? `${name} saved. Review the protection status below for this session.`
                : `${name} preferences are saved, but native request protection could not be confirmed. The previous native policy may remain; restart Discord before relying on this change.`);
        }
        catch (error) {setStatus(error instanceof Error ? error.message : "The privacy change could not be completed. Check your current profile and Recovery.");}
    });
    const verified = state.native.state === "applied" && state.native.profile === state.preferences.profile;
    const settled = !state.preferences.migrationPending && verified;
    return <section className="solcord-section">
        <div className="solcord-section-heading"><h3>Privacy protection</h3><p>Optional data collection is controlled without intercepting Discord&rsquo;s essential traffic.</p></div>
        <div className="solcord-privacy-command">
            <div><p className="solcord-eyebrow">Saved profile</p><strong>{state.preferences.profile === "strict" ? "Strict Privacy" : state.preferences.profile === "standard" ? "Standard" : "Custom"}</strong><p>{state.preferences.profile === "strict" ? "Strict preferences block verified optional reporting and make updates manual. Check this session's enforcement status below." : "This profile permits some optional Discord reporting. Check the category and native policy status below."}</p></div>
            {state.preferences.migrationPending && <span className="solcord-status solcord-status-starting">Needs review</span>}
        </div>
        <div className="solcord-actions">
            <ActionButton tone="accent" disabled={pending || (state.preferences.profile === "strict" && settled)} onClick={() => run("strict")}>{state.preferences.profile === "strict" && settled ? "Strict Privacy on" : "Use Strict Privacy"}</ActionButton>
            <ActionButton disabled={pending || (state.preferences.profile === "standard" && settled)} onClick={() => run("standard")}>{state.preferences.profile === "standard" && settled ? "Standard on" : "Use Standard"}</ActionButton>
            <ActionButton disabled={pending} onClick={() => run("updates")}>Check for updates</ActionButton>
        </div>
        <p role="status" className={verified ? "solcord-key-hint" : "solcord-callout solcord-callout-danger"}>{verified
            ? "Native optional-request policy acknowledged for the saved profile. This is not a complete network audit."
            : state.native.state === "pending" ? "Native optional-request policy is being checked. Protection is not yet confirmed for the saved profile."
                : "Native optional-request protection is not confirmed for the saved profile. The previous native policy may remain. Retry the profile or restart Discord before relying on this change."}</p>
        <div className="solcord-privacy-capabilities" role="list" aria-label="Privacy capability status">{state.capabilities.map(capability => <div key={capability.dataClass} role="listitem"><span><strong>{capability.dataClass.replaceAll("-", " ")}</strong><small>{capability.summary}</small></span><span className={`solcord-privacy-state solcord-privacy-state-${capability.state.toLowerCase()}`}>{privacyCapabilityStateLabel(capability.state)}</span></div>)}</div>
        <p className="solcord-key-hint">Discord account privacy settings are separate. Solcord reports unsupported or drifting protection honestly and never claims zero tracking without an exact-build network audit.</p>
        {status && <p role="status" className="solcord-import-status">{status}</p>}
        <details className="solcord-secondary-tools"><summary>Technical details</summary>{state.receiptStorage === "session-only" && <p role="status">Diagnostics are session-only because local storage is unavailable. Enforcement status is shown above.</p>}<p>{state.receipts.length} content-free local decision receipt(s). Receipts contain only category, decision, coarse time, and result—never URLs, payloads, account IDs, messages, attachments, or file paths.</p></details>
    </section>;
}
