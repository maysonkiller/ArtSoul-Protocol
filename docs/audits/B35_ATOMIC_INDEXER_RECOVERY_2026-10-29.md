# B35 — Atomic indexer recovery

## Scope and status

This records incremental corrections for a locally reproduced Phase B3 indexer defect.
It changes failure handling and database transaction boundaries, not Bible
sections 3 (auction/settlement economics), 5 (provenance) or 17 (roadmap).
No contract, schema, network, billing or live data change is included.

The atomicity slice was merged in PR #395 as `e10831fe` after final-candidate
CI40932702941 passed Linux/Windows builds, units, contracts and static checks.
The primary-projection slice below is implemented and locally tested.
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
  and absent state before event deletion. Startup recovery uses the same path
  and replays from the actual committed cursor, even when a queued safe-block
  hint is ahead of that cursor.
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
The primary-projection follow-up requires its own exact-candidate CI before merge.
The diagnostic baseline remains separately preserved; it is not a green
regression test that asserts broken projection behavior as acceptable.

## Open acceptance and exact next step

Next: reconstruct affected resale observations and legacy eligibility at the
rewind boundary without inventing an active listing after cancellation. Then
extend the clean-replay oracle to those fields and delivery deduplication.
Primary auction/end/extension/payment/default, mint/floor, trust and metrics
now have the local recovery evidence above. Full owner/provenance acceptance
still needs to account for transfers absent from the prototype event stream.
Fence event writers and queued recovery against stale leadership and concurrent
replay. Prove bounded processing for long history and a production-like restore.

The in-memory pending purge is not a durable crash-recovery record; cache purge
still uses the existing full-prefix Redis scan. Neither limitation is declared
fixed here. Commit acknowledgement loss and process termination after commit
need operational reconciliation, not blind replay. This slice only establishes
transactional database atomicity and the current process's failure propagation.

Keep worker rollout separate until the projection-restoration gate is met.
Never run a live rollback to reproduce the issue. Snapshot tooling, backup
restoration, beta-cohort evidence and founder business inputs remain independent
Phase B gates. No economic or canonical policy ambiguity was resolved here.
