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

## Artwork frames and the official mark

| Caption in Future | Source of the frame |
| --- | --- |
| ArtSoul | An official publisher's verified registration on its designated Core, or a proven mint from a designated official collection. The ArtSoul logo is reserved for a verified official NFT. |
| ArtSoul Founder | The verified creator has a Founder artist designation on that network, or a historical Founder designation for that publishing contract. The metallic turquoise frame can appear at verified registration. |
| ArtSoul Genesis | A blue frame can identify a verified grant for the exact Genesis NFT on Base mainnet, or a visual designation for works by a Team-reviewed artist wallet. |
| ArtSoul Partner | The gold frame can identify a verified mint from a reviewed Partner collection, or a work created by a designated Partner artist wallet. |

Previews and artwork details share the same frame and caption. The public site uses one frame per item. A purchase or wallet transfer preserves the token's origin. Holding an eligible NFT does not decorate unrelated works in its owner's wallet. A personal Founder designation gives no identity check, Genesis grant or discovery weight.

In Classic the frame is static. In Future, **Show labels on verified frames** places the full caption on the edge. It follows all four sides with both horizontal edges readable left to right. Larger artwork views use larger text and a slower lap. Reduced motion keeps the caption still. The switch controls label visibility and defaults to off. Previewing a frame changes the sample only.

### Staff controls

A passkey-verified Administrator or a verified Team member in the current staff-authority pair can change label visibility and review a blue identity check for a profile or collection. An applicant's own wallet cannot approve its application. Only a verified Team member of the active pair manages frame sources. A change belongs to the selected network, source and revision. The database rechecks the staff role and current authority policy on write.

In **Admin → NFT appearance → Manage frame sources**, choose the frame and network. For an artist wallet, search a profile or paste the wallet address, review it and record the reason. These designations apply only to works with verified authorship on that network. One revision per wallet guards replacement or removal of its current frame. The manual Genesis frame confers no Genesis grant, token, holder benefits, discovery weight or blue identity check. A verified official publication takes priority over an artist frame.

Under **Official ArtSoul**, choose a publishing wallet or an NFT collection. An official publishing wallet is scoped to its reviewed Core. The original Base Sepolia catalog and replacement rehearsal have different Core contracts. For a collection, provide its contract address. Two readers check the reviewed runtime and read its original issuer. Team can remove an existing designation even if the collection RPC is offline. Keep a dedicated publishing wallet for official mainnet works, separate from personal accounts, treasury accounts and Safe signer keys.

### How the site verifies an NFT

- **Ordinary works.** The catalog joins the reviewed Core and publisher to the registration. A finalized NFT mint establishes eligibility for the official logo beside the title. The profile's blue check comes from its independent identity review. The gallery, home, profile, Saved and artwork detail use the common projection.
- **Official collections.** Record the collection NFT contract and its original issuer. For an eligible token in Wallet NFTs, both readers must agree with the reviewed runtime and issuer at the mint block. The mint receipt must contain the transfer from zero and the matching collection mint for that token. Collection titles and owner-supplied metadata cannot establish origin.
- **Partners.** Approve a dedicated ERC-721 collection on its own network. An ArtSoul-format receipt must contain the token in the reported mint range and the corresponding mint to the same recipient. A reviewed external ERC-721 can supply its standard transfer from zero for that exact token. The readers check the code at the mint block. Shared ArtSoul NFT contracts are ineligible as Partner collections. A partner can have a separately reviewed blue identity check. [ERC-721 mint events](https://eips.ethereum.org/EIPS/eip-721#specification)
- **Genesis.** Team can manage the visual source for the designated Base mainnet contract. Issuance follows the existing multisig grant process. A wallet inventory entry must match its chain, contract, serial and verified grant. The transferable test prototype and other NFTs in a holder's wallet remain ineligible. Top-100k is a separate profile badge.

The [receipt tests](../../test/verified-artwork-aura.test.mjs) cover source priority, token identity, contract and issuer mismatch, and replaced blocks. The [wallet tests](../../test/wallet-genesis-frames.test.mjs) cover both inventory views and the detail dialog. Live acceptance for the collection catalog and the mainnet Genesis pilot requires their actual deployments and indexed mints.
