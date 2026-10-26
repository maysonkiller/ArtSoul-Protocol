# B23: Minted NFT sale management

Status: implemented and tested locally; release verification pending.
Workspace: `C:\Projects\ArtSoul`, `codex/takeover-audit`, started at `56536ec`.

## Reproduction and cause

An owner opening a listed NFT saw only an informational message. The deployed
Core already supports repricing with `listResale` and cancellation with
`cancelResale`. Cancellation emits no event, so a UI-only fix would leave the
event projection stale. Two read-only Base Sepolia RPC checks verified ABI,
executable bytecode and canonical block-hash calls. No user listing changed.

## Implementation

- Current owner: Change price, Use floor price, List NFT after cancellation.
  Listing seller: Remove from sale, even after ownership moved. Live account,
  chain and contract authority are rechecked before sending.
- Existing listing flow now uses a native top-layer dialog. Decimal commas
  work; integer wei comparison rejects even one wei below floor. Failed wallet
  requests retain the editor; success requires a confirmed receipt.
- A bounded two-minute receipt bridge updates detail/profile/gallery/homepage
  while indexing catches up. Later indexed blocks win. It cannot alter owner,
  floor, visibility or provenance. Longer indexer outages remain outages.
- Worker reads up to eight active/inactive listing tuples per poll at the
  indexed confirmed block hash using EIP-1898 `requireCanonical`. Conditional
  writes require unchanged row revision, canonical boundary and leadership.
  Original event provenance stays intact; failures preserve rows and degrade
  health. Poll/reorg work is serialized. A reproduced leader reacquisition
  race during follower drain is fixed with the existing lifecycle guard.

## Evidence so far

- Full prototype contract suite: 22 passing, including cancel/reprice, exact
  floor, authorization, stale-price purchase and cancel/relist regressions.
- Shipped adapter/namespace/wallet/receipt checks: 20 passing, local transport.
- API/client/action/cache: 106 passing, no skips.
- Indexer group: 84 passing, no skips, including disposable PostgreSQL.
  Leadership-drain group: 21 passing, no skips, old race reproduced first.
  Groups overlap; these are not a combined count.
- Build: 11 routes / 173 required utilities verified.
- Built Chromium, Classic/Future at 390/1440px: floor validation, refusal,
  edit/cancel/relist, stale API and viewport bounds pass; zero page errors.
  These are not physical iPhone or signed Base Sepolia acceptance tests.
- Full local unit run: 2,836 passed; two stale source/version assertions failed
  and were updated to the guarded polling condition and runtime v15. Their
  focused reruns pass. Exact-candidate Linux/Windows CI remains the release gate.

Private evidence: `output/audit/resale-*`,
`output/audit/indexer-leadership-drain-*`, `output/playwright/resale-*`.

## Interpretations and limits

Bible sections 4 (floor), 9 (marketplace), 16 (interface); Phase B3 defect.
No economics, contract, storage layout, schema, lifecycle or network changes.
Prototype fee splits remain the documented deviation. Use floor refers to
this artwork's canonical floor, not the cheapest listing in a collection.
Preview menus retain Donate/Report/transaction; owner controls live on detail.
An explicit cancellation event for future contracts is a proposal only.

## Release gate

Full CI and exact preview, then bounded worker rollout with source backups,
health/canonical listing checks, and exact website deployment verification.
Never cancel an existing user's sale as a release probe.
