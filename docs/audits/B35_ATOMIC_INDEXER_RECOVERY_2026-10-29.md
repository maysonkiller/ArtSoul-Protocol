# B35 — Atomic indexer recovery

## Scope and status

This records incremental corrections for a locally reproduced Phase B3 indexer defect.
It changes failure handling and database transaction boundaries, not Bible
sections 3 (auction/settlement economics), 5 (provenance) or 17 (roadmap).
No contract, schema, network, billing or live data change is included.

The atomicity slice was merged in PR #395 as `e10831fe` after final-candidate
CI40932702941 passed Linux/Windows builds, units, contracts and static checks.
The primary-projection slice was merged in PR #396 as `a9ef3e3f` after
candidate `a375be94` passed CI40937573466: Linux 2,947 pass/two skips, Windows
2,535 pass/34 skips, 49 contract checks each, builds and static checks.
The boundary-pinned resale slice was merged in PR #397 as `f40bbaa8` after
candidate `dfd9e5b1` passed CI40940342981: Linux 2,978 pass/two skips, Windows
2,535 pass/34 skips, 49 contract checks each, builds and static checks.
The legacy-predecessor slice was merged in PR #398 as `bda1d519` after
candidate `c95e075e` passed CI40941394054: Linux 2,985 pass/two skips, Windows
2,535 pass/34 skips, 49 contract checks each, builds and static checks.
The startup slice below is locally tested and awaits exact-candidate CI.
Production indexer activation is **not done**.
Full reorg reconstruction remains open. Passing the atomicity tests must not be
presented as a complete reorg acceptance or Phase B closure.

The infrastructure/media-backup issue #394 already owns the B34 identifier.
The preliminary local B34 reorg intake is therefore recorded here as B35;
it is not a second implementation of the media recovery work.

## Reproduction and cause

An isolated PostgreSQL 18.4 cluster applied the repository's real ordered
indexer migrations and media-recovery migrations. Real event handlers seeded
an artwork at block 100, auction at 105, bid at 112 and settlement at 115.
The fixture rewound at block 110; another chain with identical entity IDs
was retained as an isolation control. It accepted no live database URL.

Two independent faults were observed:

1. A cache error after the rollback SQL had committed left deleted events
   behind a cursor and block-hash suffix that still referred to the old head.
   The cursor and digest were separate operations; startup recovery had the
   same interruption window and also concatenated `1` to a PostgreSQL bigint
   string instead of incrementing its numeric value.
2. The SQL rollback deletes rows by their creation block. Updates from orphaned
   events survive on older auction/artwork/trust rows: bid amount, bidder,
   minted state, token ID, floor, settled status and settlement count can remain.
   The primary-projection slice corrects the auction/artwork/trust subset.
   Resale observations and legacy eligibility remain separate recovery gates.

The mismatch detector also caught rollback errors as if they were RPC read
failures. The production poll advanced its reorg-check timestamp before
successful completion, permitting catch-up on the next poll after a failure.

## Correction

- Use one checked-out PostgreSQL client and explicit READ COMMITTED transaction
  for state locking, the existing rollback function, suffix hash deletion,
  digest recomputation, and cursor/hash update. SQL failure rolls back all of
  these effects, including the existing media revision/quarantine effects.
- Never advance either cursor during rewind; reject invalid block boundaries
  and absent state before event deletion. Startup recovery uses the same path;
  the startup follow-up below rejects stale versioned hints and delegates replay
  to the runner's confirmed-head catch-up.
- Preserve the egress fix: the database returns one SHA-256 digest, never its
  complete block-hash history. The transaction computes that digest from its
  own post-delete state.
- Purge only after commit. Recovery uses strict error propagation; a failed
  purge remains pending and retries before further detection/catch-up without
  repeating the database rewind. Non-recovery cache callers stay best-effort.
- Propagate rollback errors out of mismatch detection. Mark the periodic check
  complete only after success, so failed recovery retries on the next poll.

This follows node-postgres's requirement to keep every transaction statement
on [one client](https://node-postgres.com/features/transactions). No dependency
was added.

## Primary-projection correction

After suffix deletion, in the same transaction, rebuild surviving affected
auction and artwork fields from the retained facts in their chain. Bid and
extension order uses block number and log index; payment status and deadline,
mint/token/floor, default amounts and current auction mapping are restored.
Trust settlement counts are recounted from retained settlements while preserving
independent suspicious flags. The original row, metadata and media identities
are not deleted or recreated. SQL failure rolls back reconstruction together
with event deletion, the media fence and cursor changes.

Do not replay notification-producing event handlers to reconstruct old rows.
Retained outbox rows keep their identities. This does not yet guarantee that an
orphaned transaction re-included later cannot produce another notification:
the existing rewind removes the orphan's delivery/deduplication row.

The existing schema and event sources are reused; no migration or contract
change is required for this primary-only slice. Resale cancellation cannot be
inferred from the prototype's event history alone and must use the existing
hash-pinned reconciliation path. It is not reconstructed as an active listing
merely because an older listing event survives.

## Boundary-pinned resale correction

Cancellation has no event in the current prototype. Before starting the rewind
transaction, capture the cursor pair, deployment and PostgreSQL row revision,
then read affected retained listings, including inactive listings and observations
whose values happen to match the boundary state. Read `resaleListings` through
the existing RPC primitive in batches of eight, pinned to the exact retained
block hash with EIP-1898 `requireCanonical`. Do not read `latest`.

The transaction revalidates the captured cursor revision (including ABA changes),
complete affected listing set and each row revision. It locks and verifies the
current worker lease after any wait and again immediately before commit. An
expired/replaced worker, changed deployment/cursor/row/header, incomplete response
or failed write aborts the entire rewind. Original listing event provenance is
preserved; seller, price, active state and observation boundary are restored.
New orphaned listings are deleted by the existing rollback. No event or delivery
is invented for cancellation. If a queued boundary is ahead of the persisted
cursor, deletion and replay both use the actual cursor plus one.

The exact retained header is required. Sparse history without that header fails
closed; it does not substitute a nearby block or overwrite a conflicting header.
This deliberate limitation must be handled by the broader common-ancestor and
recovery acceptance before worker activation. The new checks do not prevent an
unfenced event writer from committing later; shared writer fencing remains open.

Local validation: 68 focused passes, two Docker-dependent skips, zero failures,
including 46 real-schema PostgreSQL checks. Cases include retained/orphaned
eventless cancellations, repricing, resale completion, new orphan listing removal,
ten affected listings in batches of eight/two, identical values with a future
observation marker, repeated rewind, row/cursor ABA, extra affected rows,
leadership loss/expiry during a lock wait or reconstruction, missing/conflicting
headers, unavailable archive state, wrong chain, malformed/partial responses,
lost-row writes and atomic rollback on failure. Replacement events after recovery
match clean replay with a cancellation observed through normal reconciliation.

Evidence: `docs/private/b35-resale-focused-final.log` and stopped isolated cluster
`reorg-atomicity-1793301929764-35228-322136fa`. No live database, RPC, wallet or
worker was used. Independent source review found no blocker within this slice.
The full local unit suite also passed: 2,564 pass, 34 environment-dependent skips,
zero failures (`docs/private/b35-resale-unit-final.log`). As above, that local
total includes the unrelated pre-existing authority-policy tests; they are not
included in this change.

## Legacy prototype predecessors

The legacy `ProjectNFTEligibilityAchieved` and `ProjectNFTMinted` handlers upsert
one row per user, replacing the original row's block and transaction fields.
Deleting an orphaned newest row therefore lost an older surviving fact.
Capture and lock affected users inside the rewind transaction before deletion.
After deletion, restore their latest retained event by block/log order directly
into the existing projection tables. A user with no predecessor remains absent.
An insertion or uniqueness failure aborts the whole rewind.

This reconstructs historical testnet prototype facts, not mainnet Genesis grants
or eligibility. Retained raw contract source addresses are untouched, including
unknown/null provenance. No event handler, notification or AI job is replayed.
Unchanged users and other chains are preserved. No schema or policy amendment.

Validation: 75 focused passes/two Docker-dependent skips, including 53 real-schema
PostgreSQL checks; zero failures. The seven added cases cover both projections,
latest/same-block ordering, missing predecessors, independent users and chains,
known/unknown provenance, repeat rewind, failed inserts and replacement-versus-
clean-replay equality. Full local units remain 2,564 pass/34 skips with the same
unrelated pre-existing tests excluded from the PR. Evidence:
`docs/private/b35-legacy-focused-final.log`, `b35-legacy-unit-final.log`.
All disposable clusters were stopped. Independent source review found no blocker.

## Validation

- `node --test test/indexer-recovery-failures.test.mjs
  test/indexer-state-hash-egress.test.mjs test/indexer-leadership-drain.test.mjs
  test/resale-state-reconciliation.test.mjs`: 22 pass, one Docker-dependent skip.
- With `ARTSOUL_TEST_POSTGRES_BIN` set to installed local binaries,
  `node --test test/indexer-reorg-atomicity.test.cjs`: 15 pass, no skips
  in the final combined run below.
  A fresh loopback-only cluster is created and stopped by the test; no existing
  database is used. Both rewind entry points, SQL failures at event deletion,
  hash deletion and cursor update, and post-commit cache retry are exercised.
  Rollback preserves both chains byte-for-byte in the SQL snapshots; successful
  rewind changes only its own chain and keeps the digest/cursor consistent.
- `npm run test:unit`: 2,564 pass, 34 environment-dependent skips, zero failures.
  The local total includes pre-existing untracked authority-policy tests, which
  are not part of this change. The new real-PostgreSQL test was run separately
  as described above, rather than counted as exercised by this generic run.
- Primary recovery cases cover orphaned bid/extension, completed/defaulted
  settlement, no-bid end followed by a new round, later floor update, same-block
  ordering, retained earlier trust counts, repeated rewind and SQL failure.
  Replacement-chain replay matches clean replay for primary projections,
  history, trust and public metric facts. Surrogate history IDs and aggregate
  metric observation time are excluded; event provenance/timestamps are not.
- Final combined focused run: 37 pass, two Docker-dependent skips, zero failures
  (`b35-projection-focused-final.log`), including all 15 real PostgreSQL checks.
  Full local units: 2,564 pass, 34 skips, zero failures
  (`b35-projection-unit-final.log`). The environment-dependent skips are explicit.
- Linux CI now discovers its installed PostgreSQL binaries and requires the
  isolated real-schema fixture; Windows coverage retains the independent local
  PostgreSQL run. Existing Docker media-fence tests retain their sparse rows,
  with the reconstruction columns and trust table explicitly supplied. Their
  Docker execution must pass CI; it is not claimed from local skips.
- Independent focused source review found a missing Docker-fixture schema;
  it was corrected before CI. No other primary-field blocker was identified.

Private local evidence: `docs/private/b34-unit-focused.log`,
`b34-postgres.log`, `b34-full-unit.log`, and the retained disposable-cluster
evidence under `reorg-atomicity-1793298457004-17656-b12339a6`.
First-slice final replay-boundary/fixture-portability recheck:
`b35-focused-final.log` (29 pass, one Docker skip, seven real PostgreSQL checks)
and `b35-full-unit-final.log`. PR #395 final candidate
`b4fddec0ababeac93b7cda30c4f706b08094102a` passed CI40932702941.
The primary-projection follow-up passed exact-candidate CI40937573466 and was
merged as recorded above. Its first CI40936553945 passed Windows and both Linux recovery fixtures but
failed an unrelated TOTP setup fixture at a 30-second boundary. Even a previous
step computed as a SQL argument can expire before the function obtains its
locks. The test helper now enrolls with the current step, then explicitly
models a prior-step enrollment in the disposable fixture. Production code,
accepted time windows, replay checks and real activation cases are unchanged.
The corrected candidate passed the entire suite before merge.
The diagnostic baseline remains separately preserved; it is not a green
regression test that asserts broken projection behavior as acceptable.

## Startup recovery and leadership drain

Startup previously queued a `system-recovery` job without a matching consumer,
then continued catch-up. Its callable recovery path also replayed through the
current unconfirmed head. A failed start could leave the runner marked running,
preventing a later election from retrying correctly.

Startup now completes the atomic rewind synchronously before catch-up. It uses
the original versioned state snapshot and rejects changed cursor, deployment or
row revision. Authority is mandatory even when there are no resale rows. A
captured local lock epoch prevents reuse of an old authority after reacquisition
with the same token and instance. Startup recovery and catch-up are drainable:
leadership loss and shutdown wait for them, and a failed start releases the lock
and remains retryable. A stopped attempt cannot install polling timers.

Validation: 27 focused unit tests; 64 real PostgreSQL scenarios (65 TAP tests
including the parent); 22 compatibility checks, three Docker skips. Independent
read-only review found no blocker in this bounded slice. The root full unit run
initially found four existing mock-query failures because the state SELECT now
includes its row revision. The fixture was updated without relaxing the event
integrity assertions; the final local suite passed 2,574 tests with 34 skips.
That local total includes unrelated untracked policy tests; clean CI remains
the release authority. Private logs: `b35-startup-full-unit-final.log`, disposable
cluster evidence `reorg-atomicity-1793303753685-23764-16eb52b2/evidence.json`.
The disposable PostgreSQL cluster was stopped. No live recovery was performed.

## Open acceptance and exact next step

Next: require the startup slice's exact-candidate CI, then fence all event,
block-hash and cursor writers against stale leadership and concurrent replay.
Startup guards do not fence every writer or status update. Extend the clean-replay
oracle to delivery deduplication.
Primary auction/end/extension/payment/default, mint/floor, trust and metrics
now have the local recovery evidence above. Full owner/provenance acceptance
still needs to account for transfers absent from the prototype event stream.
Prove bounded processing for long history and a production-like restore.

The in-memory pending purge is not a durable crash-recovery record; cache purge
still uses the existing full-prefix Redis scan. Neither limitation is declared
fixed here. Commit acknowledgement loss and process termination after commit
need operational reconciliation, not blind replay. This slice only establishes
transactional database atomicity and the current process's failure propagation.

Keep worker rollout separate until the projection-restoration gate is met.
Never run a live rollback to reproduce the issue. Snapshot tooling, backup
restoration, beta-cohort evidence and founder business inputs remain independent
Phase B gates. No economic or canonical policy ambiguity was resolved here.
