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

The interface, playback controls, help text and assistant replies use English in both themes, including when a visitor's browser uses another language. Preserve names, descriptions and other original artwork content in the language its author supplied. Input recognition can understand another language without changing the interface language.

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

Users do not pick aura colors. The Future border label defaults to off. The admin panel's **NFT appearance** setting applies to verified frames on cards and artwork details. Platform and Partner labels move along the bottom edge. Genesis and reduced-motion labels stay stationary. Classic retains its static frame.

Open [NFT appearance](/admin#nft-appearance) with a verified administrator wallet or an active Team wallet in the current staff-authority pair. Each change records the actor, staff authorization version and setting revision. Team changes also record the [authority policy version](../../sql/migrations/20261125185000_aura_authority_team.sql). Saving checks the role and revision in the same transaction and rechecks Team membership for the site's origin and network. The public artwork API reads the boolean only for already verified frames. Missing settings storage leaves labels off.

### Evidence for each frame

A November 26 mobile viewport check exercised the built Gallery NFT tab and artwork detail at 430 pixels using a fixture with verified Platform status. Chromium and WebKit both measured the caption changing position in Future. Classic hid the caption, and the reduced-motion preference kept the Future caption stationary. The mobile motion stylesheet permits this animation only for Platform and Partner captions.

In **Manage frame sources**, a Platform publisher can be designated for the current Base Sepolia catalog or for the new auction rehearsal before the catalog switches. Each choice uses its exact issuing Core. Reviewers can enter a wallet, select their connected wallet or search public profiles by name and check the resulting full address before saving. The selection prepares a visual designation without changing the public catalog or its on-chain contracts.

The artwork API can supply Platform status when ownership verification is active and a verified Base Sepolia NFT's original registration matches the designated Core and publisher. Gallery, profile, Saved and detail consume the same projected status. The admin panel previews the label on a sample frame as soon as the checkbox changes, confirms persistence after the server responds and identifies missing verification or publisher configuration. Previewing leaves every artwork's eligibility unchanged. Historical Ethereum Sepolia cards have no aura.

The resolver also accepts evidence for the two new mint formats. A finalized mint receipt must match a canonical block obtained independently, and the NFT contract must emit the ERC-721 mint to the same recipient as its grant or collection event.

- A grant on the designated Base mainnet Genesis contract identifies that exact Genesis token. The receipt must show its mint, lock and grant in order, from the same issuer. Showing a frame on a separate artwork requires its own verified link. The transferable testnet prototype and a creator's wallet holdings cannot establish that link.
- A Partner mint requires the current curated Partner approval for that chain and collection address, plus a matching token in the range emitted by `CollectionMinted`. A blue identity check authenticates the collection's origin and confers no Partner status.
- Top-100k is a numbered mainnet profile badge. It has no input to this resolver. Its live display depends on confirmed eligibility and issuance records.

All eight combinations of eligible sources and rollback cases are covered in `test/verified-artwork-aura.test.mjs`. The Genesis and Partner receipt formats were also exercised on a disposable chain using a two-token Genesis grant and a three-token collection mint.

Verified appearance staff can manage visual sources in **NFT appearance → Manage frame sources**. Select the source type and check the full address before enabling or disabling it. Platform designations bind the original publishing wallet to the active Base Sepolia Core. Partner designations bind a collection contract to Base or Base Sepolia. Each decision appends a reason and revision. The server checks both the role and, for Team, the current authority pair. These entries grant no wallet access, trading permission, discovery weight or blue mark. Genesis uses only the designated mainnet grant contract. Frame eligibility follows the minted token across transfers.

The wallet inventory verifies a Partner mint transaction locator against its receipt and an independently read finalized chain boundary and mint block. It omits the decoration when evidence is incomplete. Collection-wide public gallery and detail coverage still depends on the hosted collection catalog publishing actual collection tokens. The ordinary gallery and artwork detail already consume the same Platform proof. The three-pixel frame and the Future caption appear on both surfaces. The label moves continuously along the bottom edge for Platform and Partner. Genesis and reduced-motion labels stay stationary, and Classic shows the frame alone.

In the signed-in owner's Wallet NFTs, the dedicated Genesis token itself can receive its static frame after the reviewed Base mainnet issuer is enabled. Both inventory views check the exact contract, serial and recipient against finalized grants. One private database call covers the eligible candidates on a page and reads the Future caption setting. The profile's lowest serial remains a separate display. Hosted activation requires the wallet frame migration and the reviewed Genesis pilot. [Wallet grant projection](../../sql/migrations/20261125223000_wallet_genesis_frames.sql)
