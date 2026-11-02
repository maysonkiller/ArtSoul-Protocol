# NFT identity and recorded sale details — November 2, 2026

## Scope and evidence

The founder requested wallet-held NFT metadata, including network, token,
purchase amount and venue, and subsequently included external NFTs on Base.
This first contained slice improves the existing ArtSoul artwork detail view.
It does not claim an external-wallet inventory or new marketplace integration.

The existing expandable Artwork details now shows the minted token ID, validated
NFT contract/explorer link, last completed indexed ArtSoul sale, venue and
transaction link. It reuses the already loaded provenance response; there are
no additional browser, database, RPC or metadata requests.

Only matching-token settlement/resale events qualify. Chain block/log order
determines the latest sale. A bid, asking price, floor, transfer or metadata
field never substitutes for a purchase. Unavailable, incomplete and empty
history remain distinct. A newer sale with an unknown amount does not fall
back to an older price. The interface explicitly distinguishes the last
recorded sale from what the current owner might have paid elsewhere.

The shared provenance formatter previously truncated ETH amounts to six decimal
places and mapped malformed/missing values to zero. It now preserves the full
18-decimal wei precision, rejects invalid uint256 values and represents unknown
amounts as null. Explicit zero remains zero. Monetary NUMERIC projections are
requested as text so JSON transport cannot round wei before formatting.
Legacy records without an available history source show an unavailable state,
not a perpetual loading message.

## Verification

- 200 focused checks pass across sale selection, presentation, network labels,
  provenance, source-qualified ownership and timeline routes.
- Production build passes.
- 38 built-browser checks pass at 320, 390, 768 and 1366 pixels in both palettes:
  exact amount, venue/receipt, contract wrapping, no horizontal overflow,
  unavailable/incomplete/empty history, and no NFT identity before minting.
- No page exceptions or writes occurred in this isolated browser fixture.
  This is not a real iPhone, wallet signing or new on-chain acceptance claim.

## Interpretation and boundaries

Canon sections 1, 4, 5, 9 and 16 apply: Base scope, lazy mint, provenance,
marketplace context and theme separation. The product label is **Last ArtSoul
sale**, not **You paid**, because current ownership alone cannot establish an
acquisition price. This is a display clarification; economics, contracts,
authentication and indexer activation are unchanged. No dependency is added.

External Base inventory is separate work. An existing provider can answer an
ownership request, but that alone proves neither account spending controls nor
historical third-party purchase prices. No paid service is activated here.

PR #460 was merged as `1b9bf1026ad558132d2f6bb71f4dbefb12856b96` after
static, Linux and Windows checks passed (Actions run `41501102604`). Vercel
reported a successful production deployment. A November 2 read-only check
found the shipped NFT identity/sale labels in the production artwork bundle
and a complete artwork 32 provenance response with token 5 and exact decimal
string price `0.0001`. This sample does not exercise a sale beyond six decimal
places; precision edge cases remain covered by the local regression checks.
The live check was HTTP asset/API verification, not another wallet or receipt
rehearsal. Phase B remains open for the device, signed-journey, operational
recovery and real-beta gates in the current phase status.
