export interface SolcordAddonPresentation {
    name: string;
    label: string;
    summary: string;
}

export interface SolcordAddonGroup {
    id: string;
    title: string;
    summary: string;
    addons: readonly SolcordAddonPresentation[];
}

export function visibleSolcordCommunityGroups(
    groups: readonly SolcordAddonGroup[],
    states: ReadonlyArray<{name: string; builtIn: boolean; installed: boolean; quarantine?: string;}>
): SolcordAddonGroup[] {
    const visibleNames = new Set(states.filter(addon => !addon.builtIn && (addon.installed || Boolean(addon.quarantine))).map(addon => addon.name));
    return groups.map(group => ({...group, addons: group.addons.filter(addon => visibleNames.has(addon.name))})).filter(group => group.addons.length > 0);
}

export const SOLCORD_ADDON_GROUPS: readonly SolcordAddonGroup[] = [
    {
        id: "privacy-interaction",
        title: "Privacy and interaction",
        summary: "One bounded analytics control, typing privacy, and faster reply handling.",
        addons: [
            {name: "DoNotTrack", label: "Do Not Track", summary: "Stops one validated Discord analytics track path. It does not block crash reports, process checks, or network requests."},
            {name: "InvisibleTyping", label: "Invisible Typing", summary: "Suppresses one validated outgoing typing-start path while the built-in is enabled."},
            {name: "DoubleClickToReply", label: "Double Click to Reply", summary: "Opens Discord’s normal reply composer; it never sends."},
            {name: "PinDMs", label: "Pin DMs", summary: "Keeps selected conversations in a local pinned section."},
            {name: "MessagePeek", label: "Message Peek", summary: "Previews recent conversation context without marking it read."},
            {name: "FileNameRandomization", label: "Filename Randomization", summary: "Offers less identifying names for outgoing files."},
            {name: "BlurNSFW", label: "Blur NSFW", summary: "Locally blurs media in channels Discord marks as age-restricted."}
        ]
    },
    {
        id: "voice-calls",
        title: "Voice and calls",
        summary: "Desktop voice messages, call context, and practical audio controls.",
        addons: [
            {name: "VoiceMessages", label: "Voice Messages", summary: "Adds record, preview, cancel, and explicit upload controls on desktop."},
            {name: "VoiceActivity", label: "Voice Activity", summary: "Shows local voice activity context in the client."},
            {name: "ShowSpectators", label: "Show Spectators", summary: "Displays users watching a stream when Discord exposes them."},
            {name: "CallTimeCounter", label: "Call Time Counter", summary: "Shows elapsed call time locally."},
            {name: "BetterVolume", label: "Better Volume", summary: "Provides finer per-user volume control."},
            {name: "AudioOptions", label: "Audio Options", summary: "Adds practical audio-device and playback controls."},
            {name: "NotifyWhenMuted", label: "Notify When Muted", summary: "Warns locally when you speak while muted."}
        ]
    },
    {
        id: "writing-language",
        title: "Writing and language",
        summary: "Composer aids that stay visible and user-initiated.",
        addons: [
            {name: "Translator", label: "Translator", summary: "Translates selected text through a disclosed external provider."},
            {name: "SplitLargeMessages", label: "Split Large Messages", summary: "Guarded mode previews bounded chunks for manual copy without sending. The community plugin's native multi-send mode remains held."},
            {name: "CharCounter", label: "Character Counter", summary: "Shows composer length before sending."},
            {name: "SpellCheck", label: "Spell Check", summary: "Adds language-aware spelling tools."},
            {name: "InsertTimestamps", label: "Insert Timestamps", summary: "Builds Discord timestamp markup from a local picker."}
        ]
    },
    {
        id: "servers-navigation",
        title: "Servers and navigation",
        summary: "Denser navigation and clearer server context without automated account actions.",
        addons: [
            {name: "ServerHider", label: "Server Hider", summary: "Locally hides selected servers from the rail."},
            {name: "ServerDetails", label: "Server Details", summary: "Shows available server metadata in context."},
            {name: "ReadAllNotificationsButton", label: "Read All Notifications Button", summary: "Adds a visible manual control; Solcord never presses it."},
            {name: "BetterFolders", label: "Better Folders", summary: "Improves folder layout and behavior."},
            {name: "PersonalPins", label: "Personal Pins", summary: "Stores private navigation pins locally."},
            {name: "PermissionsViewer", label: "Permissions Viewer", summary: "Explains visible role and channel permissions."},
            {name: "ActivityFilter", label: "Activity Filter", summary: "Locally filters unwanted activity cards."}
        ]
    },
    {
        id: "media-display",
        title: "Media and display",
        summary: "Media inspection, timestamps, motion, and profile presentation.",
        addons: [
            {name: "DiscordEffects", label: "Discord Effects", summary: "Adds optional visual effects; held when reduced motion is active."},
            {name: "CompleteTimestamps", label: "Complete Timestamps", summary: "Shows precise message times."},
            {name: "BetterFriendList", label: "Better Friend List", summary: "Adds local sorting and context to the friends list."},
            {name: "BetterAnimations", label: "Better Animations", summary: "Adds optional transitions; held when reduced motion is active."},
            {name: "EditServers", label: "Edit Servers", summary: "Applies local server names and icon presentation."},
            {name: "ImageUtilities", label: "Image Utilities", summary: "Adds image inspection and local utility actions."},
            {name: "HideDisabledEmojis", label: "Hide Disabled Emojis", summary: "Hides emoji entries you cannot use."},
            {name: "BetterSearchPage", label: "Better Search Page", summary: "Improves the search-results layout."},
            {name: "RevealAllSpoilers", label: "Reveal All Spoilers", summary: "Adds a deliberate reveal control for spoiler groups."},
            {name: "ViewProfilePicture", label: "View Profile Picture", summary: "Opens available avatar images at useful sizes."}
        ]
    }
] as const;

export const SOLCORD_ADDON_PRESENTATION = new Map(SOLCORD_ADDON_GROUPS.flatMap(group => group.addons).map(addon => [addon.name, addon]));

export const SOLCORD_POWER_LAB = [
    {id: "voice-anchor", name: "Voice Anchor / Anti-AFK", summary: "Calibration and pulse research. Unavailable in the V2 release candidate."},
    {id: "expression-relay", name: "Expression Relay", summary: "URL fallback research. Unavailable in the V2 release candidate."},
    {id: "decor", name: "Decor service", summary: "External OAuth and decoration service. Unavailable in the V2 release candidate."},
    {id: "fake-deafen", name: "Fake Deafen", summary: "Direct adjacent voice control with connection binding, drift shutdown, and state restoration."},
    {id: "fake-mute", name: "Fake Mute", summary: "Account-risk local experiment. Unavailable in the V2 release candidate."},
    {id: "stream-rtc", name: "Stream / RTC overrides", summary: "Volatile RTC experiment. Unavailable in the V2 release candidate."}
] as const;
