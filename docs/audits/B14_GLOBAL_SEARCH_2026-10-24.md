# B-14: public global search

## Scope and architecture

October 24, 2026. Canon sections 5/6 (public discovery and provenance), 11
(visibility and privacy), 13 (safe delivery) and 17 (Phase B). The founder
authorized routine Phase B PRs, additive migrations and releases in this chat.
No contract, lifecycle, economics, roles or authentication change. No dependency.

The previous gallery search filtered only loaded cards. The new shared header
opens a wallet-free search dialog on all eight header surfaces. The gallery
retains its clearly labelled loaded-card filter and offers global search.

- All, Artworks, Live auctions and Artists use real current Base Sepolia records.
- Indexed title/artist/verified-handle word prefixes, full creator addresses and
  explicit artwork IDs are supported. All shows five per category; category
  pages load twenty with opaque query-bound cursors and exact integer IDs.
- The service-only title projection covers the indexed corpus rather than a
  latest-200 sample. Missing old metadata remains identifiable by artwork ID
  and creator; an unavailable title is not fabricated or counted as covered.
- Public serialization and a final visibility/existence check are reused.
  Neither private email/provider identifiers/staff data nor Saved are exposed.
- The existing indexer optionally enriches four pending metadata records per
  minute, outside chain processing. URI/reorg revisions fence stale writes.
- Native dialog, keyboard navigation, Escape, focus return, request cancellation,
  empty/error/retry states and theme variables are shared across pages.
- Optional recent queries and identifiers opened from search are stored only
  in this browser and can be cleared. No old private/hidden metadata is stored.

## Interpretation record

"Auctions" means current live auctions; the UI says "Live auctions". Artists
must have at least one visible registered work. Prefix search is deliberately
not fuzzy matching or full-description search. The existing WebMCP tool retains
its different documented filter/description semantics; no agent compatibility
change is implied. Collection/network categories are absent until supported.

## Validation before release

- 82 focused frontend/state/header/dialog checks and production build passed.
- Backend API/Saved/projection regression batch: 82 passed.
- Real PostgreSQL search/grants/ledger batch: 33 passed; includes a 260-work
  corpus, oldest work, Unicode, exact uint256 IDs, hidden/current-round cases,
  private fields, restricted grants and reorg/URI replacement fencing.
- Search/indexer regressions: 58 passed. Final adjusted backend batch: 21 passed.
- Isolated local Chrome with synthetic responses: open/close, one-Escape close,
  keyboard focus, retry after 503, pagination from 20 to 40 and 320px geometry
  pass. Both Classic and Future inspected; desktop screenshot also captured.
  No user Chrome profile, wallet/session or database was used. This is not a
  native iPhone acceptance test. Screenshots: `output/playwright/b14-search-*`.

Full repository CI, production schema/worker rollout and real public API/UI
acceptance are pending. Logs and fixture remain local under `output/audit/`.

First full local unit run: 2,324 passed, one failure in the historical table
classification check. Added the new self-hardening migration to that explicit
registry; its actual grants/RLS remain exercised in PostgreSQL. This initial
run is not reported as a clean full pass. Independent review additionally found
JSON accepted by JavaScript but rejected by PostgreSQL, and early batch rejection
that could release the worker drain guard. Both are fixed: invalid storage data
backs off hourly, and all sibling work drains before failure. The final real
PostgreSQL/API batch passes 23 checks; classifier/state regression batch passes
30. Empty results, clearing browser history and focus return also
passed in the isolated browser.

## Controlled activation and rollback

1. Review exact candidate, full CI and current server/DB/Core mapping. Preserve
   the current diff and take a protected read-validated database backup.
2. Apply only `sql/migrations/public_artwork_search.sql` transactionally; verify
   service-only table/function privileges and deny anon/authenticated access.
3. Back up the indexer launch/config and changed source files. Deploy the reviewed
   worker and existing safe metadata helper dependency. Set only
   `ARTSOUL_SEARCH_INDEX_ENABLED=true`, restart the existing Base worker and
   verify confirmed height/health. Do not start legacy Ethereum indexing.
4. Verify every registration has a projection and each metadata status is ready
   or explicitly unavailable, with no unexplained pending records. Check title,
   creator, exact-ID and current-round queries against actual public records.
5. Release reviewed frontend/API, enable `ARTSOUL_SEARCH_ENABLED=true`, and verify
   real anonymous responses, deployed assets, query latency and dialog behavior.

Rollback: disable the public API flag and restore the prior site deployment;
disable the indexer enrichment flag and restore backed-up source if needed.
Preserve the additive projection and all user/contract data. No destructive
schema downgrade is needed.
