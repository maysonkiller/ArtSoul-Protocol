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
The startup slice was merged in PR #400 as `d02fa6e3` after candidate `4d833e09` passed CI40947174617: Linux 3,007 pass/two skips, Windows 2,545 pass/34 skips, 49 contract checks each, builds and static checks.
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

## Buffered writer fencing (October 29 follow-up)

Reproduction on the previous `d02fa6e3` source: pause a range's log response,
rewind from 115 to 109, then resume it. Both a buffered BidPlaced at 118 and an
empty range restored old headers and advanced indexed/confirmed cursors to 120.
The event case also resurrected the bid and completed registry row. Both new
regression cases failed before the patch; the 64 earlier scenarios still passed.

The writer now captures leadership and the indexer-state row version before
fetching logs/headers. Every header batch, event claim/projection/failure and
checkpoint locks leadership then state before writing; changed versions,
deployment or authority reject the original payload. A retry fetches a new
range instead of giving an old response a fresh context. Same-cursor recovery
and same-token local leadership reacquisition are explicitly tested. Cursor,
event total and digest updates commit together; separate confirmation writes
now use the same guard and atomic digest update. Missing headers stop the range.

Start/stop status and stale-lease reaping use this fence too. Shutdown captures
its lock epoch before awaiting listener shutdown. The processing heartbeat
remains a narrowly identity-bound UPDATE, with the original authority precheck;
it cannot create/claim a row and deliberately avoids the state lock held by the
event transaction that drains it. Event commit still verifies authority.

The read-only API's legacy rebuild now rejects before any deletion; its former
delete-and-replay path did not own leadership and was not atomic. Invalid
persisted deployment identity now fails startup rather than being relabelled.
Bootstrap INSERT and confirmation-depth metadata reconciliation do not advance
existing cursors; they are not claimed as fenced projection writes.

Validation before CI: 90 real PostgreSQL tests (89 nested, including 25 new
cases), no failures or skips, disposable cluster stopped. Real lock waits are
observed with pg_blocking_pids; deferred commit failures prove cursor/digest
rollback. Full local compatibility run: 2,577 pass, 34 explicit environment
skips, zero failures (includes unrelated untracked policy tests). Four focused
entry-point checks, including a subsequently added invalid-cursor check, pass.
Build, built-route verification and Tailwind verification pass. Docker-only
integration fixtures are adapted but await Linux CI, not claimed from local
skips. Independent source review found no remaining blocker in this slice.

Release evidence: candidate `823e6ec5ea819f947edba5a7faa9f43ca08ab946`
passed exact CI `40951733294`: Linux 3,036 passed / two platform skips;
Windows 2,549 passed / 34 environment skips; zero failures. Both builds,
static checks and 49 contract tests on each platform passed. Linux executed
the Docker integration and disposable PostgreSQL recovery fixtures. PR #401
merged as `1d79cee6819ae67a0770a7f12c20f24599113d22`; Vercel reports successful
deployment for that merge. This publishes the source, not the separately
operated production indexer. Private job logs are `b35-writer-ci-linux.log`
and `b35-writer-ci-windows.log`.

Private evidence: `b35-writer-fence-before.log`,
`reorg-atomicity-1793305692857-34644-2bac29fa/evidence.json`,
`b35-writer-fence-after-confirmations.log`,
`reorg-atomicity-1793306355572-14588-83a8ab96/evidence.json`,
`b35-writer-build.log`, `b35-writer-entrypoints.log`.

Implementation interpretation: xmin is a short-lived, in-memory row-version
guard, not a persistent/global transaction identity; any intervening state
update safely invalidates that range. It introduces no schema or economic rule.
Leadership SHARE locks can delay renewal during slow SQL; the existing renewal
timeout then fails closed, potentially causing election churn. Bounded history
and transaction-duration acceptance remain activation gates. No production
worker activation, live recovery or migration was performed.

## Follow-up reproduction: in-app notification resurrection

After PR #401, the disposable real-schema fixture loaded the shipped notification
migrations and exercised the actual read/mark/remove functions. In two cases,
the same transaction was re-included after rewind, first with its original global
log index and then with a changed index. Both cases lost read/dismissal state:
a previously read notice returned unread and a dismissed notice became visible.
While the source event was absent, canonical readers correctly hid the notices.
The original 89 nested recovery cases still passed; the two new intended-behavior
assertions failed, also failing the parent suite. The cluster stopped cleanly.

This was the failing baseline before the durable-identity change below. It is
not evidence of duplicate external email. Original reproduction evidence:
`docs/private/b35-notification-replay-before-corrected.log` and
`docs/private/reorg-atomicity-1793307259641-31572-29b72f29/evidence.json`.
Retaining rows alone is insufficient: current-source bindings must be renewed,
different events must not inherit state, and reminder materialization has its
own identity path.

## Notification identity: local implementation and verification

The ordered feature migration `20261029212603_notification_reorg_identity.sql`
adds a private ledger linking a proven event identity to its original outbox ID.
The identity includes chain, actual contract, transaction, event name, occurrence
within that transaction/contract/event name, exact JSONB event data, aggregate
and full notification payload including recipient. Block height and block-global
log index are deliberately excluded. A different transaction, event payload or
recipient receives a new identity. Identical repeated occurrences stay distinct.

Rewind adopts source-proven legacy rows before deleting source evidence, then
detaches notifications, tombstones their current keys and quarantines their
delivery status. Unknown-source rows remain retained but receive no invented
identity. A restrictive ledger foreign key prevents accidental deletion of
protected inbox rows. Proven replay rebinds the original ID and restores its
previous processing status without changing recipient read/dismissal timestamps.
Already active identical writes do not update either row. This is inbox recovery,
not an external-email exactly-once guarantee or permission to enable delivery.

The engine and existing bounded reminder materializer use the same invoker
writer. The bell summary resolves retained reminder state before the inbox is
opened, without creating or rebinding rows. Existing canonical source/recipient
proofs still decide visibility. API roles cannot access the private schema,
ledger or helpers; the existing protected inbox RPC signatures are unchanged.

Recovery locks state before media; the state self-update also invalidates short-
lived buffered writer contexts for privileged primitive calls. The helper takes
media SHARE before reading the source. A writer released after source deletion
fails closed rather than inserting a stale key. Full recovery still requires the
engine transaction for cursor, digest, headers and predecessor reconstruction;
the SQL rollback primitive alone is not a replacement recovery procedure.

Local PostgreSQL 18.4: 111/111 checks pass, zero skips (89 retained nested cases,
21 notification cases and the parent). Includes read/dismissal with unchanged or
shifted indices, different transactions/data/recipients/payloads, repeated logs,
key collisions, failure rollback, legacy adoption/quarantine, reminders and bell
counts before materialization, privileges, reapplication and actual concurrent
lock waits. The disposable loopback cluster stopped cleanly. Evidence:
`docs/private/reorg-atomicity-1793309902248-33084-dec372c8/evidence.json` and
`docs/private/b35-notification-recovery-concurrency.log`.
Build and built-route/Tailwind checks pass; independent source review found no
remaining blocker. Full local suite: 2,580 pass / 34 explicit environment skips /
zero failures (includes unrelated untracked policy tests). Older minimal-schema
fixtures use an explicitly test-only adapter for the new writer signature; the
real retention implementation is exercised by the full-stack PostgreSQL fixture.
Candidate ba7b59b5 passed exact CI40960261913: Linux 3,060 pass/two platform
skips, Windows 2,551 pass/34 environment skips; contracts, builds and static
checks passed. Linux exercised Docker recovery and no-default-grant integration.
PR402 merged as 199aa28e. This releases source only; the migration and indexer
worker remain inactive pending the operational gates below.

Interpretations: same creation transaction plus exact creation data/recipient/
offset preserves an existing reminder across extension; a reused auction number
from a different creation transaction does not. Unknown historical provenance
is quarantined, never inferred from current configuration. Canon sections 5 and
17 are touched through database recovery; no economic or contract rule changes.

Activation order: reviewed media reorg and notification migrations through
`notification_inbox_removal.sql`, then this feature migration, privilege and
restore rehearsal, then the matching indexer release. This is intentionally not
inserted into the existing numbered 001-017 core migration runner. The deployed
worker has NOT been updated and this feature migration has NOT run on a live
database. No mainnet, reset, fee, billing, DNS or external delivery change.
Keep retained rows/ledger during rollback planning; do not drop the ledger or
reinstall an older destructive rollback function as a shortcut. Pause the writer
and validate the selected source/schema combination in the disposable restore
rehearsal before any separately authorized worker activation or rollback.

## Open acceptance and exact next step

Next: reproduce process termination after committed rewind and before cache
invalidation, then make that recovery obligation durable. Keep the worker inactive until
the remaining recovery gates have independent evidence.
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
