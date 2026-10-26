# B23: Minted NFT sale management

Status: released in PR #373; candidate `171ac62`, production merge `960794b`.
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
  while indexing catches up. Same/later indexed blocks win, since the public
  projection does not expose within-block transaction order. Review reproduced
  an earlier cancel overriding a later same-block relist; regression added.
  It cannot alter owner,
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

## Release verification

- Exact-candidate CI40350911939 passed: Linux 2,808 unit checks / two skips,
  Windows 2,413 / 32 skips, zero failures; 49 contract tests on each platform.
  Post-merge CI40352342602 also passed. Earlier stale local assertions are
  superseded by these clean exact-candidate runs, not silently counted as green.
- Preview and apex: eight HTML routes, 37 asset hashes, protected guest API
  denial and the production alias binding to `960794b` verified. Four owner
  flows each on the deployed preview/apex pass in Classic/Future at 390/1440px,
  with synthetic wallet/API responses, zero page errors and no real writes.
- Worker released before the website, with a journal and previous-source
  backup. Health remained healthy across advancing confirmed boundaries;
  unresolved errors and resale reconciliation errors are zero/null. Unrelated
  sources, environment files, process configuration and inactive legacy worker
  remain unchanged. No database migration, reset or manual listing edit.
- Both independent Base Sepolia RPCs agreed with all four indexed listing
  tuples at confirmed block 50537988 and the pinned contract code hash. Two
  active sales remain. Original event transaction/block/log fields are intact.
- Live public-data browser checks on artwork 18 / token 3 and artwork 32 /
  token 5 pass for a guest and a synthetic owner identity. Owner dialogs show
  the actual listing prices (0.05 / 0.1 ETH) and canonical floors (0.01 /
  0.0001 ETH); guests do not see edit/cancel controls. Editors were closed
  without submission. The initial probe used the wrong expected buyer label
  (`Buy NFT`); correcting it to the actual `Buy Now` label passed unchanged code.
- No user's listing was cancelled/repriced, no real wallet was signed, and no
  native phone acceptance is claimed. Signed cancellation/relisting is covered
  on the disposable contract chain; a future owner-run testnet journey remains
  useful acceptance evidence, not a completed action in this release.

Private rollout/evidence: `docs/private/resale-worker-stage-20261026/`,
`output/audit/resale-worker-rollout.json`, `resale-worker-after.json`,
`resale-*-browser.log`, `b23-resale-*.json`. Remote source backup and journal:
`/root/artsoul-resale-20261026/` on the existing indexer host. Do not replay apply.
Next Phase B slice: B21 Donate/Report preparation through existing review dialogs.
