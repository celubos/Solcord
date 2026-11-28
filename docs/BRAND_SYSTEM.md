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

The mark is a white `S` made of two cords on a rounded teal tile, with an ember spark where the cords are cut. Tile gradient `#2cc7b3` to `#0a5a54`; cords `#ffffff` and `#fff1de`; spark `#ffd08a` to `#ff6a3d`. Active sources:

- `assets/branding/solcord-mark.svg`
- `assets/branding/solcord-wordmark.svg`
- `assets/branding/solcord-social-preview.svg`
- `assets/branding/icons/solcord-mark-{16,24,32,64,256}.png`

At 16–24 pixels use the mark only; do not use the wordmark. Keep the tile, both cords, and the cut around the spark. Do not recolor it to Discord blurple or place it inside a Discord-shaped silhouette. `assets/branding/icons/solcord.ico` (the executable icon) is built from the 256-pixel export.

## Asset provenance

Production PNG sizes are rendered from the SVG by `scripts/render-solcord-mark.cjs`. The runtime uses that vector and the separately licensed local font described above. See the [provenance registry](PROVENANCE_REGISTRY.md) for source and license details.

Current production-source hashes:

| Asset | SHA-256 |
| --- | --- |
| `assets/branding/solcord-mark.svg` | `c3e7ce9bf98220ed845a313951a8576ce27053c40d6a136598d675891bd2cce0` |
| `assets/branding/solcord-wordmark.svg` | `d5f9996a5c8095601637328fa234d9fa51f780ce84ecef9779f332aba44493bc` |
| `assets/branding/solcord-social-preview.svg` | `a0a9031d684cb700665843622b4683cab1e568f9027b62705e84c35528ec599c` |
| `assets/branding/solcord-social-preview.png` | `e025b367c4e219b520e39d13cf76c191b0afd5bab15c16b8823163ec636dadbd` |
| `assets/branding/icons/solcord-mark-16.png` | `e3de5149146c6d9c36cf1a40d8d0cdaf31ba009fe9e7bcccf4aa0216a76ae4da` |
| `assets/branding/icons/solcord-mark-24.png` | `25cf972b38ca153866579f1920f4b58fc1522cb12371b62918cca563818c486d` |
| `assets/branding/icons/solcord-mark-32.png` | `fe2aea4bfb8f7950720c61bcb55c5c9554855c9750aca8f67fef5e306a8f5f22` |
| `assets/branding/icons/solcord-mark-64.png` | `1d6002ae9a28e24fbb2d82ea47b6eedee10ee21a1030222ae1a72e590a888426` |
| `assets/branding/icons/solcord-mark-256.png` | `95248b2dbf812094da064ee5131eba80fa16c704f3e8f7bbb1f3aa124414aa55` |

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
