# A-33 — artwork-page composition acceptance, 2026-09-14

A-33 has two halves. The transaction-feedback half was measured on 2026-09-06
and is recorded in
[`A33_TRANSACTION_FEEDBACK_CHECK_2026-09-06.md`](A33_TRANSACTION_FEEDBACK_CHECK_2026-09-06.md).
This file covers the other half: whether the artwork page composes correctly
against canon rules 11, 16 and 17.

## What was run

Production, `artsoulprotocol.com`, signed out, on 2026-09-14.

| | |
| --- | --- |
| Works | `9fa043e8` "Rialo" (image, legacy Ethereum Sepolia) and `19d557e7` "music" (audio, Base Sepolia) |
| Viewports | 1440x900 emulated desktop, 375x812 mobile |
| Browser | the in-app browser, which is an embedded view |

The embedded view is why this file claims composition only. Anything touching
the back/forward cache, wallet sessions or SIWE needs an ordinary browser on a
real device; see [`A48_BACK_NAVIGATION_PROBE.md`](A48_BACK_NAVIGATION_PROBE.md)
for that boundary.

## What passed

- **Media is contained, not full-bleed** (canon 17), at both viewports and for
  both media types. The audio work shows the ArtSoul mark as its poster rather
  than an empty frame, which is the A-71 behaviour holding on a second surface.
- **Primary content is visible without scrolling** (canon 11) at both viewports:
  media, title, artwork details and the auction panel. On mobile the order is
  media, title, details, auction, valuation.
- **No emoji appears on any provenance or status surface** (canon 11).
- **Creator is present and named.** First Collector and Owner are absent, and
  that absence is correct: no work on the public testnet has settled, so under
  canon 4 no NFT exists to have either role.
- **The valuation panel carries its guidance-only disclaimer** (canon 19), and
  states plainly that it does not affect settlement, floor, royalties or mint
  rights.

## What failed, and what changed

**The Artwork details list printed the stored network key.** "Rialo" read
`Network  sepolia` and "music" read `Network  baseSepolia`, at both viewports.

Two separate problems in one field. `baseSepolia` is a database key, not a
network name. And `sepolia` is a legacy Ethereum Sepolia record, which canon 13
keeps readable but never active — a visitor reading a bare "sepolia" has no way
to learn that, and the page was the only surface that showed them the value at
all.

The field now renders `Base Sepolia` and `Ethereum Sepolia (legacy, read-only)`,
decided by chain id where the record has one and by the stored key otherwise.
The media type keeps its record value and is capitalised by stylesheet for
display, per canon 16. Pinned in `test/artwork-network-label.test.cjs`.

## What stays open on A-33

1. **Real-device transaction feedback.** A connected run that produces a failed
   transaction, to confirm the 2026-09-06 repair holds outside a local harness.
2. **The full provenance triple.** Creator, First Collector and Owner together
   cannot be accepted until one work settles on the public testnet. This is a
   data precondition, not a defect.
