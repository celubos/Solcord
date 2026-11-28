# Solcord brand system

## Character

Solcord uses compact controls, readable text, and restrained motion. Explain what a tool does, any relevant risk, and what to do next.

The visual system uses graphite surfaces and functional accents:

| Token | Value | Use |
| --- | --- | --- |
| Warm black | `#11100e` | Primary shell and quiet gutters |
| Carbon paper | `#1a1815` | Dense secondary surfaces |
| Warm bone | `#f3eee5` | High-emphasis text on dark surfaces |
| Ember | `#ff755f` | Deliberate break, recovery, causal warnings |
| Oxidized teal | `#4b9d96` | Upper cord, healthy state, focus, primary action |

The warm-black, paper, and coral direction was refined after inspecting the owner-controlled public [SOL site](https://slaveofsolace.com/). The reference established warm near-black, paper-white type, coral signals, oxidized teal, thin rules, and restrained motion. On 2026-08-30 the owner selected the homepage's paired-strand canvas as Motion Studio's shell-wide **SOL Flow**, then requested the separate `/work` character field as an interchangeable option. Solcord adapts both owner-controlled algorithms from pinned portfolio commit `91fdd4a1bf747a5cb8b4b66694741c2492c4be7e`: SOL Flow uses fewer frames and Discord-aware light/dark compositing; **Work Field** retains the sparse `.`, `:`, and `+` rhythm with bounded pointer warp and a local click ripple. **Ember Drift** is an original, low-density CSS option. Every background is local, mutually exclusive, reduced-motion aware, and fully removed on disable. No portfolio logo, image, private content, analytics, or network behavior is copied.

The runtime bundles Hanken Grotesk for interface text from the official Google Fonts repository at pinned revision `ade3d1533e06b2b1462ffcde8e08b129627ca360`. It is SIL Open Font License 1.1 and is compiled into the local Solcord payload, so no font request leaves Discord. Discord's own `gg sans` leads display hierarchy for a more native, readable Control Center. The previously evaluated Anybody font remains in source provenance but is no longer referenced by runtime CSS or shipped themes. Georgia remains the local editorial fallback for selected reading surfaces.

## Mark

The mark is a cord-cut `S`, with teal and bone strokes separated by a small ember break. Active sources:

- `assets/branding/solcord-mark.svg`
- `assets/branding/solcord-wordmark.svg`
- `assets/branding/solcord-social-preview.svg`
- `assets/branding/icons/solcord-mark-{16,24,32,64,256}.png`

At 16–24 pixels use the mark only; do not use the wordmark. Preserve its transparent field and center break. Do not recolor it to Discord blurple or place it inside a Discord-shaped silhouette.

## Asset provenance

Production PNG sizes are rendered from the SVG by `scripts/render-solcord-mark.cjs`. The runtime uses that vector and the separately licensed local font described above. See the [provenance registry](PROVENANCE_REGISTRY.md) for source and license details.

Current production-source hashes:

| Asset | SHA-256 |
| --- | --- |
| `assets/branding/solcord-mark.svg` | `6c95fa4585fdc153d75c5eb0ded40e20bddb77fcd950ef5ef49780ddeeb7534b` |
| `assets/branding/solcord-wordmark.svg` | `44e0ff79467b6ea35b92f42bf57139d9f19f54ace4288ecf415e3dfb6ed6e63d` |
| `assets/branding/solcord-social-preview.svg` | `9e1efbee3ce862ddfa947db4f433ef1e3f9e79ac5e9fb2fe889c2be3417f42e0` |
| `assets/branding/solcord-social-preview.png` | `e0b4553e07f4383e3cc3a508ac22db119e29e896f619bacccb4d80a5972d5223` |
| `assets/branding/icons/solcord-mark-16.png` | `8e3b10bb5094c65c497cd4fd1b60e5e670f0f9775ee1a42ba1e77883a1a32387` |
| `assets/branding/icons/solcord-mark-24.png` | `cae50045e449673aea5f919cf94d69cb14d7f7bbc24efffbdbc56488ecee591f` |
| `assets/branding/icons/solcord-mark-32.png` | `868bdb6498d99ce69bea29f0737ea6c05c5f47f459985b6b0f748f5253d4d20a` |
| `assets/branding/icons/solcord-mark-64.png` | `2c43fee1e0c5756a32bb602d90e3c0684adcce14a347f2185a0834806932414b` |
| `assets/branding/icons/solcord-mark-256.png` | `2a0b0f786c9f5e0effe9ca7113a08f47a974d54b0efeff9b9dfba59e9bd2f746` |

## Theme family

The theme family contains the recommended default, four accepted V1 alternatives, and six V2 full-shell alternatives. Every theme covers server/channel/chat/member and activity regions, composer and search fields, settings, popouts, and native dialogs. Each remains a self-contained local CSS file with no `@import`, remote font, remote image, or remote stylesheet.

| Theme | Character | SHA-256 |
| --- | --- | --- |
| Solcord Default | Recommended warm-black workstation with ruled structure, paper-white type, sparse signal texture, teal interaction, and restrained ember. | `04b664abb2d089644e2faf680928b79ff2782058c42b9974666ceb978aa6a8f8` |
| Obsidian Thread | Wide black gutters, square warm-carbon panels, expanded signal headings, oxidized teal, and restrained ember. | `8be041a038f7b7a601632e27dae0c1bd5b07fa9b22982192912a5a92e4f3bab9` |
| Carbon Ember | Tight charcoal instrumentation with copper interaction rails and burgundy selection signals. | `ccf2e481b2586cc133c7ce64cae04d9f561cb005421061224d6185d88c3972a9` |
| Midnight Glass | Navy-black translucent panels, restrained separation, silver seams, and ice-cyan focus without fragile modal overrides. | `6159a4b043a2e1975239c344ab34e4069b6d44e23463a906952b7149b1e4451b` |
| Paper Signal | Warm paper, readable ink, coral, teal, and editorial headings with print-like square seams. | `4d39b5bfcc9592c733b1a55af8dbe76d1b42c9d51e1ee138aa42b46bef087a3b` |
| Threadline | Compact ruled workspace with indexed navigation, measured display headings, and precise message rails. | `332608df6d5b7eba3f1688ada59e9ec7aa24dde90c832f4db88989e4cd3500bb` |
| Signal Block | High-contrast square containment with heavy, state-bearing block boundaries and deliberately compressed display type. | `2084412cb304af92db7a21d4f9473ba9af24fb149da9385bfc282374c581ffda` |
| Relay Classic | Familiar Discord density with a continuous shell and restrained relay-blue state bars. | `f94e6b71f777fd59dc69a978d3e24f487e119ec4b5308053a47b73b77f28a79f` |
| Workshop | Tactile charcoal surfaces, recessed composition areas, copper fixtures, and compact tool headings. | `b9c0f371de5726d96643a723257eacb041a58b52b509b5e51f8d56e97d5b83ae` |
| Quiet Read | Accessibility-first light surfaces, ink-dark text, generous measure, editorial headings, large targets, and still interactions. | `580bdcd0a0ef19f0fc894e674bd4c150a92a0bae20047272a48f1dcce5db0340` |
| Night Transit | Navy shell with broad wayfinding type and distinct route rails for selection, unread state, mentions, and voice. | `245f2731675eacb0c65e42fba19e5aad9619c83ab0d95a6a27699951ec61e30d` |

All eleven remain original implementations. The MIT-licensed `midnight-discord` source at pinned commit `0c6e4b5009df5f13fe33d9b279378378d5212330` was inspected as `REFERENCE ONLY` for general principles: cover current visual-refresh tokens, separate major work regions, expose bounded density tokens, and honor reduced motion. No selector block, hosted import, font, SVG, or asset was copied. The owner's existing `midnight.theme.css` was read only to confirm its canonical metadata/configuration shape and was not modified, staged, or replaced.

Only one Solcord theme is selected by the setup transaction. The preview reports declared conflicts before **Apply and verify**; skipping the wizard changes no theme state. The six V2 themes differ in at least three structural axes rather than palette alone; see [V2 theme system](V2_THEME_SYSTEM.md).

## UI rules

- Follow Discord’s settings density and navigation model; Solcord is a settings tool, not a marketing page.
- Prefer two-column fact grids and compact status rows over card walls.
- Status never relies on color alone: every state is written as text.
- Use `:focus-visible`, semantic headings, native controls, and keyboard-operable actions.
- Honor `prefers-reduced-motion`; the Accessibility Toolkit may reduce motion further.
- Explain preview and unavailable states. Do not represent a structural lookup as live when it failed validation.
- Empty states say what was observed, for example “No Activity window decision has been observed in this session.”

## Acceptance status

The owner retained the Solcord mark but rejected the prior V2 typography and generic blue-gray theme treatment on 2026-08-27. The replacement source described above is therefore `REVISE` until it passes fresh installed-shell review at the required Windows scales. Earlier technical contrast or silhouette checks do not grant acceptance to this visual pass.

## Voice

Use concrete sentences: “One same-package preload was accepted” or “No addon is quarantined.” Avoid anonymous collective voice, fictional metrics, fake quotes, canned testimonials, and vague cyber language.
