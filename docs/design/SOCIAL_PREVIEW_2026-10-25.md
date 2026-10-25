# ArtSoul social preview

Owner-requested B18 visual slice: replace the textured default social banner
with a calm, legible ArtSoul wordmark and a cyan/violet sculptural accent.
This affects public link presentation (Bible public provenance and visual-theme
sections; visual/theme part 16), not contract behavior, economics or the website
theme. A crawler has no visitor-selected Classic/Future mode, so the shared
external brand asset uses the existing ArtSoul cyan/violet identity.

## Asset and integration

- Final asset: `artsoul-social-preview-v2.png`, 1730 × 909, 1,859,858 bytes.
- SHA256: `e9b79a3f14cfdd417a0bcd3765264ca2629644620b7764293b27cc2839787fc2`.
- Generated with the built-in Imagegen tool. Original output copied unchanged;
  no watermark/provenance stripping or new dependency.
- Copy: "ArtSoul" / "Discover art worth collecting." This is a brand headline,
  not a claim of investment performance, mainnet launch or adoption.
- Replace default Open Graph and X image metadata on the six existing public
  entries and the missing-artwork-poster fallback. Actual artwork images and
  their source/title/creator metadata remain authoritative.
- Version the filename so fresh fetches use a distinct asset URL. Keep the old
  image available for historical references. Existing third-party preview caches
  are outside the website's control; no instant refresh of old messages is claimed.
- The social image is metadata only; it adds no image download to ordinary page
  rendering. Website buttons, header logo, themes and economic copy are unchanged.

## Acceptance

Asset inspected at full size. Twelve existing sharing/domain tests pass. Build
passes (11 HTML routes, 175 Tailwind utilities); all six packaged metadata sets
match the actual PNG dimensions, and the packaged asset is byte-identical to the
generator output. Evidence: `output/audit/social-preview-v2-evidence-2026-10-25.json`
and adjacent test/build logs. CI, preview and apex verification remain release
gates. No claim is made that Telegram or another app refreshed an existing card.

Reference: [Open Graph structured image properties](https://ogp.me/#structured)
define pixel dimensions, MIME type and descriptive alternative text.

## Generation prompt

Requested 1200 × 630 composition; the generator returned 1730 × 909 at the same
approximate aspect ratio. Metadata uses actual dimensions without resampling.

```text
Use case: ads-marketing.
Create one finished, extremely refined social link preview banner for ArtSoul, a digital art auction platform. Landscape 1200 by 630 pixels, approximately 1.905:1, edge-to-edge with no device mockup or surrounding frame. Premium contemporary gallery art direction, precise, calm, sophisticated and memorable at a 400px-wide thumbnail.

Composition: near-black ink background with very subtle cool depth; substantial open negative space. On the left, a large immaculate light ivory wordmark reading exactly "ArtSoul" in an elegant modern sans-serif, beautiful optical spacing, clear and confident. Under it a much smaller but still thumbnail-legible line reading exactly "Discover art worth collecting." No other words, symbols, numbers, buttons or logos. Keep both lines comfortably inside a 9% safe margin. Wordmark approximately 100px at final1200px width.

On the right, one exceptional abstract sculptural artwork: a fluid, thin folded sheet of satin silver and translucent optical glass, an elegant sweeping S-like calligraphic gesture with an arch above it, evocative of art and soul without literally drawing letters. Precisely crafted material, soft pearl highlights, cyan edge light subtly transitioning into violet, tiny restrained magenta highlights. Subtle physical reflection beneath it, almost invisible. The shape should feel like a collectible contemporary gallery sculpture, original and emotionally engaging, not a generic infinity symbol or crypto coin. Beautiful studio lighting with detailed polished surfaces and crisp silhouette, never noisy or grungy. Balanced visual weight, no overlaps with type, no heavy glow, no busy textures. A very faint broad cyan-to-violet light wash can unite the two halves without affecting text contrast.

Mood: quiet luxury, advanced art technology, confident editorial design, not cyberpunk. Avoid charts, chain logos, coins, hexagons, grids, stars, particle clouds, smoke, mountains, paint splashes, boxes, NFT characters, clichés and promotional claims. No drop shadows on type, no bevelled letters, no excessive gradients. Make the final image ready for a real Telegram/X/Open Graph website card.
```

