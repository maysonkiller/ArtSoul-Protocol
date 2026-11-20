# Visual, Status, Theme, And Aura Canon

## Theme Separation

Classic and Future are separate themes.

- All theme colors live in `unified-styles.css` as variables.
- Use `var(--c-*)` variables for theme colors.
- Do not hardcode theme hex colors in pages or JS.
- Future colors never appear in Classic.
- Classic colors never appear in Future.
- Classic interface feedback is static: no animated transitions, loading effects or smooth scrolling (founder amendment, 2026-11-01; supersedes the August 10 allowance). Keep the original Classic palette. Artwork video/audio remains user-controlled content, not interface animation. Verification marks and any separately approved static frame treatment remain available.
- Future may use animation, glow, and neon effects.
- Mobile and desktop differ in layout only; color semantics stay identical.
- Any animation must be disabled under `prefers-reduced-motion: reduce` in both themes.
- Token, network and wallet brand marks retain their original asset colors in both themes (founder clarification, 2026-11-09). A neutral backing may preserve contrast; do not tint their artwork with the interface palette. This does not change either theme's interface colors.

## Artwork Media

Artwork media is contained, OpenSea-style. It is not full-bleed on detail pages unless a future canon update explicitly changes that.

Card network identity sits beside the title below the media, consistently for image, audio, video and external wallet NFTs (founder amendment, 2026-11-16). It must not overlap playback or Saved controls. The icon retains its original brand colors and an accessible network name.

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

Users do not pick aura colors. The planned running border text is Future-only. It stays off until the application has an explicitly authorized appearance-setting writer and durable storage for this boolean with a revision and an audit trail. The current moderation role handles complaints, and the signed staff action list covers role changes, authority rotation and sign-in setup. Neither grants a visual-setting write. When enabled, reduced motion must keep the label stationary.

### Evidence for each frame

The artwork API currently supplies Platform status for a verified Base Sepolia NFT whose original registration matches the designated Core and publisher. Gallery, profile, Saved and detail consume the same projected status. Historical Ethereum Sepolia cards have no aura.

The resolver also accepts evidence for the two new mint formats. A finalized mint receipt must match a canonical block obtained independently, and the NFT contract must emit the ERC-721 mint to the same recipient as its grant or collection event.

- A grant on the designated Base mainnet Genesis contract identifies that exact Genesis token. Showing a frame on a separate artwork requires its own verified link. The transferable testnet prototype and a creator's wallet holdings cannot establish that link.
- A Partner mint requires the current curated Partner approval for that chain and collection address, plus a matching token in the range emitted by `CollectionMinted`. A blue identity check authenticates the collection's origin and confers no Partner status.
- Top-100k is a numbered mainnet profile badge. It has no input to this resolver. Its live display depends on confirmed eligibility and issuance records.

All eight combinations of eligible sources and rollback cases are covered in `test/verified-artwork-aura.test.mjs`. The Genesis and Partner receipt formats were also exercised on a disposable chain using a two-token Genesis grant and a three-token collection mint. The public feed currently lacks both the new mint sources and the curated Partner approval registry. Neither status is active there.
