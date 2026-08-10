# Visual, Status, Theme, And Aura Canon

## Theme Separation

Classic and Future are separate themes.

- All theme colors live in `unified-styles.css` as variables.
- Use `var(--c-*)` variables for theme colors.
- Do not hardcode theme hex colors in pages or JS.
- Future colors never appear in Classic.
- Classic colors never appear in Future.
- Classic may use animation, but only in its own colors (Amended 2026-08-10; supersedes "Classic is static"). Animation in Classic stays functional — loading and progress feedback — and never adopts Future's glow or neon treatment.
- Future may use animation, glow, and neon effects.
- Mobile and desktop differ in layout only; color semantics stay identical.
- Any animation must be disabled under `prefers-reduced-motion: reduce` in both themes.

## Artwork Media

Artwork media is contained, OpenSea-style. It is not full-bleed on detail pages unless a future canon update explicitly changes that.

## Status Labels

Use user-facing status labels, not developer internals:

- Live Auction
- Auction Ended
- Sold
- Ended - no bids
- Auction unsettled
- Finalizing...
- Not yet minted
- Minted

Do not show "indexer", "projection", or "pending indexer" as public product language.

## Aura System

One aura can be auto-assigned to an NFT by priority:

1. Platform aura: shimmer cyan/purple/pink.
2. Genesis aura: gold, static.
3. Partner collection aura: cyan/blue.
4. None.

Users do not pick aura colors. Running border text is Future-only and admin-toggleable.
