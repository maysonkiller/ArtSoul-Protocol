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

PR #338 (`f3e317e`, merged as `58148fc`) passed CI `40095824518`: Linux
2,296 pass / 2 platform skips; Windows 2,012 pass / 20 Docker-suite skips;
46 contracts on each OS. Build, static checks and preview passed.

The original search schema and indexer are deployed, and the API is enabled on
production `dpl_HDJHyuhT8FqJ2Xtd8NHjeqoNdE2i`. Eight page assets match the build;
ten real apex search requests, pagination and malformed-query rejection pass.
Saved remains enabled. Live anonymous Chrome verifies a 390px search dialog,
real artwork navigation and browser Back without a retained modal or overflow.
No native-device acceptance is claimed.

Actual metadata coverage: 37 registrations, 33 ready and four unavailable old
originals (#1-4), zero missing/pending rows. Ten bounded four-row batches were
permitted; nine were needed (last empty). The existing worker remains healthy.
Its launch configuration gained only the search-enrichment flag and the public
Storage origin; existing secrets and contract mappings are unchanged. Database
backup was read-validated, and runtime files/config were backed up separately.

### Live acceptance correction

Search initially returned one live result where Gallery returned two. Artwork
#36 has a NULL indexed active-auction pointer; its latest round #70 is active.
Two independent pinned-code RPC reads agree the contract maps #36 to #70.
Candidate lookup incorrectly required a populated pointer while the existing
public card serializer uses the latest indexed round. New forward migration
`public_artwork_search_current_round.sql` aligns candidate selection with that
serializer: select the latest round first, then test status/deadline. It never
resurrects an older active round after a newer closed one. The already-applied
original migration is unchanged; no live projection row repair is included.

Forward repair validation: 24 search/API tests and 21 PostgreSQL grants/ledger
checks passed. Forward migration/release verification is pending.

Separate upstream observation for B-02: the registration row for #36 was indexed
54ms after the later AuctionCreated row, and retained its original update block.
This is consistent with concurrent dependency processing; reproduction and a
bounded indexer repair are required before claiming the underlying drift fixed.
The search correction alone is not that repair. Private read evidence remains
under `output/audit/` and `docs/private/`, without credentials in public source.

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
