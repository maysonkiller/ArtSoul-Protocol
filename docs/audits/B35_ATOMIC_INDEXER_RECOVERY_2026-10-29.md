# B35 — Atomic indexer recovery

## Scope and status

This records incremental corrections for a locally reproduced Phase B3 indexer defect.
It changes failure handling and database transaction boundaries, not Bible
sections 3 (auction/settlement economics), 5 (provenance) or 17 (roadmap).
The initial atomicity slice added no schema. Later source migrations are recorded
below; no contract, network, billing or live data change is included.

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

## Durable cache recovery: local implementation and verification

The previous crash reproduction is fixed in the source candidate. Ordered feature
migration `20261029220854_recovery_cache_obligation.sql` records a nullable UUID
on `indexer_state`. Existing and newly initialized rows receive an initial purge
obligation; applying the migration again preserves acknowledged NULLs and pending
tokens. Rewind rotates the token in its existing SQL transaction, including calls
to either rollback overload. A real deployment-address replacement also rearms it.

Startup and recovery read that durable token. The purge runs outside database
locks. Only an actual successful purge is acknowledged, against the original
chain, deployment, token, row revision and leadership epoch. A failed purge or
acknowledgement leaves retry work. Intentionally disabled caching allows progress
but retains the token; configured cache unavailability fails closed. Ordinary
range/event/header/confirmation writes reject pending configured-cache recovery
at admission and again under their write fence. The runner drains it between
periodic chain checks, and resale reconciliation checks before RPC and under its
locked update. An old process cannot acknowledge a newer rewind or deployment.

Local PostgreSQL 18.4: 124/124 checks pass, zero skips, cluster stopped. These
retain the preceding 111 checks and add 13 cache/recovery/admission cases. Actual
child termination after rewind commit leaves the token in PostgreSQL; the next
engine purges once, serves the corrected bid and does not rewind again. The
fixture uses the real cache-service methods with a parent-owned Map transport;
it does not claim a real Redis server or distributed-reader acceptance. Includes
rollback, purge/ack failures, newer-rewind races, authority/deployment changes,
disabled cache, migration reapplication, and pending-before/during-RPC admission.
Evidence: `docs/private/b35-durable-cache-admission.log` and
`docs/private/reorg-atomicity-1793312395052-29992-e1836d8e/evidence.json`.
The failing baseline remains `docs/private/b35-cache-crash-before.log` and
`docs/private/reorg-atomicity-1793310797557-25372-b920eb22/evidence.json`.

Focused runtime/admission checks: 35 pass, one explicit environment skip.
Full local suite: 2,579 pass / 34 explicit environment skips / zero failures;
it includes unrelated untracked policy tests. Build, built-route and Tailwind
checks pass. Independent source review found no remaining blocker in this slice.
Candidate6187df00 passed CI40965512672: Linux3,072 pass/two skips, Windows2,550
pass/34 skips,49 contract checks each,both builds/static green. Linux exercised
Docker media and no-default-grant checks. PR404 merged as51cda1b4; source only.
Private logs: b35-cache-ci-linux.log and b35-cache-ci-windows.log.
The older minimal media fixture installs the actual cache migration with an
explicitly inert notification-detach adapter; full retention is tested only by
the complete-schema atomicity fixture, not that adapter.

Interpretations: a successful purge and its acknowledgement are separate steps;
a retry after an acknowledgement failure may safely purge again. Disabled cache
is not proof that a surviving external cache was cleared, so the obligation is
retained. Initial obligations conservatively cover earlier lost process-local
intent. These are internal recovery semantics under canon sections 5 and 17;
no contract, economic, eligibility or user authorization rule changes.

Activation requires the ordered notification migration above, then the new cache
migration, then the corresponding indexer worker after the remaining gates. A
worker without the new schema fails startup instead of silently bypassing it.
No live migration, Redis operation, rollback or worker update was performed.
Do not remove the token or reinstall an older rollback function while this worker
is running. Preserve pending obligations and rehearse any rollback on the isolated
restore copy first. The normal 001-017 bootstrap runner is not extended by this
separately gated feature migration.

## Delayed cache refill: reproduction and source correction

The next failure was reproduced using the actual cache service and a local Map
transport: a query captured bid 2500 before rewind, finished after a successful
purge, and cached 2500 while the authoritative fixture value was 0. The next read
served 2500 without fetching. This is a controlled cache-boundary reproduction,
not a live database or Redis claim. The failing baseline is preserved in
`docs/private/b35-cache-refill-before.log` and `b35-cache-refill-evidence.json`.

Recovery purge now rotates a random generation before enumerating/deleting data
keys, and retains that marker. A cache miss captures a nonempty generation before
its authoritative fetch. A small Redis script compares that original generation
and writes with the original TTL atomically. A delayed pre-purge fetch therefore
cannot refill the cleared cache. A missing marker is initialized with a fresh
UUID using SET NX; eviction/recreation cannot reuse an empty default generation.
Cache hits retain the original single GET path.

On a rejected or uncertain guarded write, the reader fetches once more without
caching. Errors in that final read propagate; the old result is not a fallback.
Repeated purges cannot produce an unbounded retry loop. This interpretation is
limited to read-only fetchers, as used by the current auction, bid and health
readers. The implementation uses existing ioredis and Node crypto; no dependency,
SQL migration, fee or user authorization change is added by this slice.

Redis documents atomic Lua execution and SET NX semantics in its official
[scripting guide](https://redis.io/docs/latest/develop/programmability/eval-intro/)
and [SET reference](https://redis.io/docs/latest/commands/set/).
The short fixed script has no scan or loop; existing full-prefix purge cost is
not solved by this change.

Activation must drain every legacy cache-filling process before the reviewed
recovery purge: old code or a raw SET can bypass the generation guard. The current
production cache-fill call sites all use remember; the separate direct set helper
is only used by test seeding. Restoring/failing over Redis to an older snapshot can
restore its old marker too, so that operation requires a fresh durable purge
obligation and purge before reusing cache data. No Redis restoration acceptance
or mixed-version rollout guarantee is claimed.

Local verification: 26 focused boundary/failure tests pass; the full local suite
passes 2,586 tests with 35 explicit environment skips (including unrelated
untracked policy tests). Build, route and Tailwind checks pass. The retained
PostgreSQL 18.4 fixture passes all 124 tests, zero skips, cluster stopped. Evidence:
`docs/private/b35-refill-focused.log`, `b35-refill-full-units.log`,
`b35-refill-build.log`, `b35-cache-refill-postgres.log`, and
`reorg-atomicity-1793313646570-31908-1bd21110/evidence.json`.
Independent runtime review found no blocker for this scoped refill race and
identified the mixed-version/Redis-restoration limitations above.

The disposable Redis suite uses two real clients and the actual cache source
to exercise TTL, overlapping purges, missing-marker recreation, concurrent NX,
and actual Redis ACL failures. Local Windows explicitly skips because no Linux
Docker server is available; Linux CI requires this suite to run. Candidate
`ca44ddebed684b3a8551ca62d6eef69dc5eaa89d` passed CI40968117393: Linux 3,092
pass/two skips, including the real Redis 7.4.12 suite; Windows CI passed, and both
platforms passed 49 contract checks and builds. The downloaded Windows log omits
its aggregate Node summary, so a test count is not inferred. PR #405 merged as
`92b1b330436d706984bb3e5d7ed5eccc2afa5c12`. Private CI evidence is retained in
`b35-refill-ci-linux.log` and `b35-refill-ci-windows.log`. Source-only release;
the separate indexer worker and ordered feature migrations remain inactive.

## Ordinary invalidation: separate reproduced refill race

Recovery-generation fencing alone does not cover a normal new bid: the ordinary
auction invalidation used DEL without changing that generation. Actual cache
methods with controlled snapshots and Map transport reproduced an older query
refilling bid100 after bid200 and invalidation completed; the next request served
100 without reading again. Preserved baseline: `docs/private/b35-key-invalidation-before.log`
and `b35-key-invalidation-before.json`. No live service was used.

The next source correction captures a separate per-entry UUID before fetching and
atomically checks both that UUID and the recovery generation before storing.
Ordinary invalidation atomically rotates the entry UUID and deletes its data.
Auction and bid entries are both covered; an unrelated auction does not force
other in-flight queries to read twice. The single uncached retry remains bounded.

Entry markers expire rather than accumulating indefinitely: initialization uses
the requested cache TTL, while invalidation retains its marker for one hour, the
existing default cache lifetime. This duration is an internal storage bound, not
a protocol parameter. Correctness does not require the marker to survive for the
whole request: missing markers reject old writes, and recreation uses a fresh
random UUID. Recovery purge removes entry markers along with data, while its
global marker remains. Direct helper SET, mixed old writers and Redis snapshot
restoration retain the activation limitations described above.

Ordinary invalidation retains its existing best-effort error policy. A Redis
permission/connection failure can leave cached data until expiry; this slice does
not claim guaranteed ordinary invalidation during a Redis outage. Recovery purge
still fails strictly and retains its durable PostgreSQL obligation.

The auction and bid invalidations are separate sequential Lua calls, not one
transaction across both entries. Failure on one call stops the remaining calls
under the existing best-effort policy. The extra expiring marker per touched
entry increases memory and full-prefix scan work, including for cold invalidated
keys. No atomic pair deletion or outage convergence is claimed.

Local verification of this source candidate: 29 focused checks; full suite
2,589 pass/35 explicit environment skips (includes untracked policy tests);
build/11 routes/173 utilities pass. The isolated PostgreSQL fixture passes
124/124 with zero skips and cluster stopped. Evidence:
`docs/private/b35-entry-focused.log`, `b35-entry-full-units.log`,
`b35-entry-build.log`, `b35-key-invalidation-postgres.log`, and
`reorg-atomicity-1793314445789-33136-cc1510a5/evidence.json`.
Independent review found no scoped blocker and confirmed the per-key failure
and marker-memory limitations. Eleven added real-Redis cases cover ordinary
invalidation, auction/bid pairs, unrelated keys, expired/deleted markers,
reinitialization, overlapping recovery, competing NX and actual ACL failures.
Docker is unavailable locally, so Redis explicitly skipped; Linux CI requires
the real fixture. No live Redis or database was contacted by these fixtures.

Candidate `400c6867a1ec3f55fed2eb996e5de623d03200d7` passed exact CI40969928038:
Linux 3,106 pass/two skips, Windows 2,560 pass/35 skips, both builds/static checks
and 49 contract checks per platform. All 23 real-Redis subtests ran successfully
against Redis 7.4.12 on Linux; the fixture was not skipped there. PR #406 merged
at October 29 23:04:20 UTC as `c8e57cce95c4a0bedee3ec829a5120eede44311e`.
Private evidence: `b35-entry-ci-linux.log` and `b35-entry-ci-windows.log`.
This is source readiness only; no separate worker activation or live migration.

## Bounded recovery purge (October 30 local time)

The old cache source uses full-keyspace KEYS followed by a single DEL containing
every matching key. Ten deterministic boundary/failure checks failed against
that source; evidence is preserved in `docs/private/b35-bounded-purge-before.log`.
The correction uses SCAN with a count hint of 128, deletes at most 128 keys per
command, and permits at most 1,024 scan/delete commands after the generation SET.
The cursor is kept as an opaque decimal string; empty pages and duplicate keys
are valid. The recovery marker and other namespaces are not deleted. Success
requires cursor zero and completion of every deletion. Invalid responses,
partial errors and exhausted budgets leave the durable obligation pending.

These are internal execution bounds, not protocol parameters. Redis documents
that [SCAN COUNT is a hint](https://redis.io/docs/latest/commands/scan/): it does
not bound response bytes or wall time. MATCH still traverses the entire Redis
database. Many unrelated keys can exhaust every attempt before cursor zero,
leaving recovery safely blocked; namespace isolation or resumable progress must
be reviewed before a large shared-cache deployment. No new dependency or schema
change is introduced. Existing queue connection timeout/retry behavior is unchanged.

Validation: 39 focused checks; full local suite 2,599 pass/35 explicit environment
skips (includes unrelated untracked policy tests); build/11 routes/173 utilities
pass. Isolated PostgreSQL passes 125/125, zero skips, cluster stopped, including
partial cache deletion followed by scan failure, retained obligation and complete
retry. Evidence: `docs/private/b35-bounded-purge-{focused,full-units,build,postgres}.log`
and `reorg-atomicity-1793317277847-29848-ed107ccf/evidence.json`.
The disposable Redis suite adds 1,200-key multi-page iteration, bounded deletion,
old-fill fencing and partial SCAN/DEL failures followed by successful retry.
Local Docker explicitly skipped; Linux CI ran all 26 Redis subtests.
Independent review found no scoped blocker and identified the shared-keyspace
progress limit above. Candidate `534a3ab1db5a0d4891b8520c9ab9762b0d20df67`
passed exact CI40975324696: Linux 3,120 pass/two skips, Windows 2,570 pass/35
skips, both builds/static checks and 49 contract checks per platform. All 26
real-Redis subtests ran against Redis 7.4.12 on Linux. PR #407 merged as
`4d9a04d33cc80e9b7e43c10ddb7156987b0a6a1e` at October 29 23:50:10 UTC
(October 30 00:50:10 Europe/Warsaw). Retained private CI evidence:
`b35-bounded-purge-ci-linux.log` and `b35-bounded-purge-ci-windows.log`.
The source merge does not activate the separately operated worker.

Existing deployment was checked read-only at October 30 00:40:44 Europe/Warsaw:
the existing Hetzner Base Sepolia worker was online, /health returned 200/healthy,
database healthy, observed lag 11 blocks and zero reported errors. The deployed
sync-engine hash matched the retained B30 egress correction; newer B35 writer
fencing was absent. Vercel deploys the website/API, not this long-running worker.
No new server is planned or created. The Protocol and OS separation evidence
remains the October 29 record, not a fresh full audit of OS.

## Sparse-ancestor reproduction and correction

The next boundary defect is now reproduced against merge `4d9a04d3` using the
existing isolated PostgreSQL 18.4 harness, actual `detectReorg` / `_handleReorg`
methods and shipped SQL. Only RPC headers and external queue/cache side effects
are simulated. A fork starts at block 103; registration at 100 remains valid,
but the old auction at 105 must disappear. The four-header control checks 100
and 105 and removes that auction. A two-header sample first checks 110 and
rewinds to 109, retaining it. With the normal default sample of 12 and 17 stored
headers, detection first checks 113 and rewinds to 112, also retaining the
orphan auction. Both failing cases incorrectly report completed recovery.
The other chain remains unchanged in all cases. These are deliberate failing
baseline assertions, not successful recovery acceptance: one control passes,
two scenarios fail, and the parent test consequently fails. No skips.

Evidence: `docs/private/b35-sparse-ancestor-default-before.log` and
`reorg-atomicity-1793318334542-11260-a22bbb60/evidence.json`; the disposable
cluster stopped cleanly. The initial two-case evidence is also retained in
`b35-sparse-ancestor-before.log`. No product source, migration or live service
was changed for this reproduction. The private fixture is derived from the
existing test harness, not another application checkout.

The November 1 source correction now searches up to 64 retained headers, newest
first and no later than both the captured indexed cursor and the requested
boundary minus one. A candidate must match a raw RPC header at exactly that
height on the configured chain. Only that proven ancestor defines the rollback
boundary, including when there are no resale observations. Missing, malformed,
unavailable or exhausted evidence stops recovery before BEGIN. A missing exact
predecessor can safely use an earlier matching retained header; it cannot
invent an unrecorded predecessor. Resale observations are then prepared at the
selected hash and the ancestor is checked again after all archive reads.
The existing transaction locks and checks the captured state version and stored
ancestor hash before mutation; leadership, row revision and cache fences remain.
All three detection paths now pass their original state snapshot into recovery.
Late callbacks from timed-out RPC providers cannot continue to their next send
after abandonment or replacement by another attempt.

This is an operational evidence bound, not a protocol parameter: 64 limits
candidates, not RPC sends. Each header proof uses three calls plus configured
provider fallback attempts, with another proof after archive preparation.
No database/schema, contract, economic, active-chain or billing change.
There is no atomic snapshot across RPC and PostgreSQL: a further chain change
after the last proof remains possible and must be detected in a later recovery.
The database digest is not itself proof of RPC canonicality.

Validation and release evidence for this correction is recorded below.
Deployment namespace/progress bounds,
Redis restoration and independent CDN caches remain separate gates.
Reads already in flight are not cancelled by a purge.
No all-cache convergence or production-scale recovery claim is made.

Do not activate the new B35 worker release until the remaining gates have
independent evidence. The existing Base Sepolia worker remains running with its
previously verified B30 egress correction; no additional server is required.
Full owner/provenance acceptance still needs to account for transfers absent from
the prototype event stream. Bounded history/renewal time,
external delivery guarantees and independent database AND object-byte restoration
remain open. Snapshot A stays at the end of public testnet; no destructive reset
or mainnet step is authorized by this source change. Phase B remains in progress.

## November 1 common-ancestor validation

Independent review found no scoped blocker. The new offline ancestor suite
passes 41/41, including late timed-out callbacks, fallback supersession, wrong
chain/deployment, missing or malformed headers, candidate-budget exhaustion,
final-proof changes and database hash/version locking. All three retained
sparse-history reproductions now remove the orphan auction and rewind to100,
while retaining registration100 and the foreign chain. Detection also rejects
a state revision changed while sampling.

Full local units: 2,645 pass, 35 explicit environment skips, zero failures.
This workspace includes a previously untracked authority-policy test; exact
committed-candidate CI counts are recorded separately rather than equated to it.
The first full PostgreSQL run exposed four fixture expectations now corrected
and hit its 120-second suite limit. A separate run reached 110 passing checks
before the same limit. The next run encountered a real 10-second SQL timeout
while the preceding disposable cluster completed a slow Windows checkpoint.
These runs are not full PostgreSQL passes. The suite bound is now300 seconds;
individual SQL10-second and concurrency5-second limits remain unchanged.
Shutdown waits up to180 seconds for durable cleanup instead of abandoning a
slow checkpoint after30 seconds. No durability setting was disabled.
Logs: `docs/private/b35-common-ancestor-{targeted,postgres,postgres-final,units,build}.log`.
The second cluster was separately verified stopped after its checkpoint.
Exact-candidate CI and final release status are recorded in the checkpoint.

Next B35 gate: reconstruct owner/provenance from transfers absent in the
prototype core event stream, using evidence and bounded read-only fixtures
before proposing another implementation. Worker activation remains blocked by
the separately listed operations, recovery and restore gates.

## November 1 final proof and merge

PR #412 merged as 8ed3ce0efab05a79a10d00e35130da9fc64fc06f from
fc754924c1ad487744bdf59b27856629374f783f. Exact CI41255813076 passed:
Linux 3,171 unit checks/two skips; Windows 2,616/35 skips; 49 contract
checks on each platform; both builds and static checks. Linux exercised the
real PostgreSQL recovery and Docker media suites. Vercel preview was green.
The final isolated local PostgreSQL rerun also passed 130/130, zero skips,
with the disposable cluster stopped. Evidence:
`docs/private/b35-common-ancestor-timeout-recheck.log` and
`docs/private/reorg-atomicity-1793492096964-40124-91a84420/evidence.json`.
These supersede the earlier incomplete local runs, without hiding their timing
failures. The separate server worker and live schema remain unchanged; the
remaining B35 gates above still apply.

## November 1 transfer-source fixture and implementation boundary

At source commit `723461df21dfc50116c5ab64c46f4a207d81e7fa`, the next
owner/provenance gap is reproduced offline by
`test/fixtures/b35-nft-transfer-recovery.mjs`. Run it explicitly with
`node --test test/fixtures/b35-nft-transfer-recovery.mjs`.
This is a standalone failing evidence fixture, deliberately outside the normal
`*.test.*` unit collection until the transfer path is implemented. It asserts
the desired behavior rather than treating the missing transfer as correct.

The fixture encodes standard ERC-721 logs: settlement mints to A at block100;
A transfers to B at110/log3; B transfers to C at110/log9; C transfers to D
at120. There is no `ResaleCompleted`. Shuffled inputs include another NFT
deployment, another token, and the legacy chain with a colliding token ID.
Retained snapshot inputs cover boundaries111,101 and100. These are supplied
in-memory snapshots, not execution or proof of PostgreSQL rollback.
The real listener and both public API handlers run with injected offline
sources. No environment file, live RPC, database, service or wallet is used.

Result: **5 controls pass; 6 desired transfer checks fail**, exit1. Controls
preserve settlement-only ownership, First Collector/floor semantics, removal
of all subsequent transfers, removal of settlement, and the legacy identity.
Failures show missing listener ingestion, stale public-card owner, stale
provenance owner, absent transfer timeline, missing same-block ownership order,
and failure to derive C from the retained snapshot after D is orphaned.
The fixture does not establish real-chain occurrence or affected user counts.

The existing relevant suites pass **77/77**, zero skips/failures:

```text
node --test test/donation-event-listener.test.mjs test/public-provenance-projection.test.cjs test/artwork-provenance-timeline.test.cjs test/indexer-reorg-ancestor.test.mjs
```

The source boundary is larger than a recovery-helper correction:

- `src/indexer/event-listener.js::_queryLogsChunk` requests and accepts only
  configured Core/donation addresses. The Core ABI contains no NFT `Transfer`.
- `src/indexer/sync-engine.js` also validates non-donation journal sources
  against Core. Merely adding an NFT log filter would fail that write fence.
- `src/api/routes/public/artworks.js::ownershipProjection` and
  `src/api/routes/public/artwork-provenance.js` derive ownership from settlement,
  resale history and listing state. Neither consumes NFT transfer facts.
- `src/indexer/reorg-projections.js` restores lifecycle state; there is no
  transfer-backed owner projection to restore. The existing journal has
  `contract_address` and chain-scoped rollback, so a new transfer table must
  not be assumed necessary.

The next implementation should first bind the NFT to the configured chain/Core
deployment, then ingest its ordered transfer facts through the existing fenced
journal. It must establish bounded historical coverage before publishing a
transfer-backed owner: adding only future logs cannot repair earlier movements.
Review a bounded/indexed token-and-deployment lookup and coverage checkpoint
before deciding whether storage/index migration is needed. Apply ownership to
all public card hydration paths, owner filters and provenance, and resolve the
token to its artwork for invalidation. Keep mint/resale timeline attribution
distinct from non-sale movement; a Transfer must not create sale volume, floor,
royalties, Trust changes, or sale notifications. Retained transfers must survive
rewind while orphan transfers disappear under the existing recovery fences.

Interpretation: canon §§1,4,5,9 require indexer-backed current ownership and
non-sale wallet movement without changing settlement-defined First Collector or
floor. This fixture proposes no protocol amendment. Historical records lacking
deployment/transfer coverage are not silently assigned the current deployment.
No runtime source, migration, contract, worker activation or operational gate
was changed by this evidence slice. Full owner/provenance acceptance remains open.

## November 1 deployment-proof foundation

The next bounded implementation adds `nft-deployment-proof.js`, with no runner,
listener-ingestion or public-API import. It verifies the configured Base Sepolia
Core/NFT pair at one explicit canonical block, comparing both runtime-code hashes
against required caller-supplied pins and checking `Core.nftContract()` and
`NFT.core()`. The NFT reverse binding is mutable; a successful observation at one
block does not prove any earlier or later interval, transfer coverage or readiness.

All code/getter reads use the block hash with `requireCanonical: true`, as defined
by [EIP-1898](https://eips.ethereum.org/EIPS/eip-1898). Chain and canonical header
are checked before and after the reads. Eight sequential calls per provider
attempt are bounded by the existing read-RPC timeout/failover. A failed provider
restarts the complete proof; late timed-out callbacks cannot continue issuing
reads or publish their old result. Inputs are captured immutably; changing
leadership or listener chain/Core/configured NFT invalidates an in-flight proof.
Unsupported hash-pinned reads fail, without a latest-state fallback.

Focused helper/ancestor/resale tests pass150 with one explicit environment skip.
The helper has106 offline cases including malformed and mismatched sources,
changed reverse bindings, unsupported providers, complete failover and late
callbacks. These use the real listener timeout code with synthetic providers;
no live RPC, database, credential, transaction or deployment is involved.
Full local units pass2,823 with35 explicit environment skips (including29
pre-existing untracked authority-policy checks outside this candidate). The
production build verifies11 routes and172 utilities. Exact CI/release results
remain pending. Evidence: ignored `docs/private/b35-nft-proof-{focused,units,build}.log`.

Interpretation of canon §§1,4,5,9: this is a prerequisite for source-correct
ownership, not a new token rule or economic change. Historical coverage still
requires a deployment-scoped contiguous lower/upper boundary. Reuse the existing
event journal with an indexed token/deployment lookup; add coverage independently
of the Core cursor before exposing Transfer-derived ownership. Mint Transfer
precedes SettlementCompleted, and wallet transfers remain non-sale events.
Expected Transfer parse failures must stop coverage progress. Recovery must
invalidate/clamp coverage with journal rewind under existing writer/cache fences.
The existing server worker remains on B30; no new server or activation is implied.

## November 1 proof release and historical-source limitation

PR #419 merged as `c9c911bf8d774096d9b6a35cce2fb51423988a26` from
`b7dcfe8eb5d8e40592b52e90d567b65d5d6623dd`. Exact CI41267051306 passed:
Linux3,349/two skips, Windows2,794/35 skips,49 contracts on each platform,
both builds and static checks. Preview7467751424 and production7467785503
succeeded. Six apex routes serve the exact tested stylesheet hash
`39b90d05b45c77084d9df94b80b93d1c63ee5d1afe4b123290bce5d6e03df884`.
This release does not activate NFT transfer indexing.

The real read-only proof passed independently through both existing RPCs at
Base Sepolia block52,892,193, hash
`0x3458cb1b41c81e6236fbc9c5d2a108abb057c71ba3af98ee6cf535e6f9e7cfe3`.
Both matched the existing reviewed Core/NFT addresses, runtime hashes and
reciprocal bindings. Evidence: ignored `b35-nft-proof-live.json` and
`b35-nft-proof-{ci,preview-release,production-release}.log` under `docs/private`.
This observation establishes identity at one block, not historical coverage.

The tracked historical runbook supplies41976861 as a candidate start, with
no creation receipt/hash manifest. A read-only probe of its predecessor41976860
on both existing RPCs failed with error4444, pruned historical state, earliest
available46500000. Evidence: `docs/private/b35-nft-history-origin.json`.
Do not move the start forward or treat the error as an empty history. Historical
activation requires an archive-capable source or independently verified origin
evidence; no paid endpoint or provider setting was added.

For the reviewed NFT runtime, a hash-pinned zero `totalSupply()` at the
predecessor proves no earlier tokens: its supply only increments and has no
reset/decrement path. That origin proof is distinct from the range endpoint.
The immutable original Core-to-NFT binding and original Core settlement/token
mapping determine token membership; a later change to mutable `NFT.core()`
does not invalidate ownership of previously minted tokens. These are explicit
indexer interpretations of canon §§1,4,5,9, not changes to minting or economics.

## November 1 bounded transfer reader

The existing deployment-proof module now also reads a bounded Transfer range.
The original reciprocal-proof interface retains its behavior and106 regressions.
The range reader verifies the immutable Core-to-NFT binding, both pinned runtime
hashes, predecessor and endpoint, every represented log's canonical block and
timestamp, and the final chain/endpoint again. Bootstrap additionally verifies
the predecessor's NFT runtime and zero supply. Continuation cannot be mistaken
for bootstrap. Ranges are limited to1,000 blocks/10,000 logs, with complete
provider restart under the existing timeout/failover and stale-callback fence.
Malformed expected logs, foreign sources, removed logs, duplicate/conflicting
positions, missing timestamps or pruned state reject the whole range. IDs remain
exact decimal strings; mint and ordinary transfer facts carry no price or sale.

Combined offline proof/range checks pass161/161. Full local units pass2,878
with35 environment skips, including29 unrelated authority-policy checks outside
this candidate. Build verifies11 routes/172 utilities. Evidence:
`docs/private/b35-nft-range-{focused,build}.log` and
`docs/private/b35-nft-coverage-units-final.log`.

Both existing live RPCs independently returned the same successful empty recent
range52,896,213–52,896,222. They also returned the same actual mint of token7
at block51,484,121, transaction
`0x9276c36e2d3df54fa13b6c3e8efdadda2b6c38b5c368027dd2dee9d6125d457f`,
matching the previously accepted Taes settlement. Only historical reads were
performed; no wallet operation was repeated. Evidence:
`docs/private/b35-nft-range-live{,-historical}.json`.
Neither sampled range proves the missing contiguous prefix.

A single bounded probe of the [documented public BlockReq endpoint](https://blockreq.com/docs/build/api-reference/base-sepolia/)
also rejected the origin: its public service exposes only the most recent1,024
blocks. No account, API key, paid access or runtime endpoint change was created.
Original-history activation therefore remains open.

## November 1 atomic transfer coverage storage

The ordered `20261101120000_nft_transfer_coverage.sql` feature migration adds
an empty, deployment-scoped coverage table and a partial token journal index.
It does not create a cursor from existing rows or activate an NFT writer/reader.
The table records the predecessor hash, runtime pins and contiguous upper bound;
its declarations alone do not attest those values. A fenced writer must supply
verified origin and range evidence. Chain identity follows the existing INTEGER
state key; token IDs remain exact decimal strings in the event journal.

Recovery-token rotation, Core replacement and state deletion invalidate the
coverage in the same database transaction. This also covers direct SQL rewinds
that delete no events. A successful cache acknowledgement to NULL preserves
newly verified coverage; unchanged tokens and case-only Core changes do not
invalidate it. Recovery conservatively requires verified reconstruction rather
than guessing a retained coverage hash. The existing journal rollback deletes
NFT events with other events; no lifecycle handler is copied or replayed here.

Forced RLS and explicit SELECT-only access for `service_role` deny Data API
writes. The migration joins both the no-default-grant rehearsal and migration
disposition ledger, independently of historical Supabase defaults. It has not
been applied to the live database. Remaining gates: fenced atomic ingestion,
source-qualified token/artwork association, consistent public ownership and
timeline reads, cache/external delivery recovery, historical bootstrap and
the separately verified existing-worker update.

The unchanged migration/recovery patch passed142/142 checks in isolated
PostgreSQL, including direct/empty rewinds, failed writes, concurrent state
locking, source-scoped token ordering, idempotence and all API-role denials.
The cluster was stopped. Evidence:
`docs/private/b35-coverage-check/postgres-tests-relocation-recheck.log` and
`docs/private/reorg-atomicity-1793502828309-49912-c70185bc/evidence.json`.
The first private relocated harness had three relative-import failures; those
were corrected only in that private harness, then the whole unchanged public
patch reran successfully. Earlier failed evidence is retained. Final local
units pass2,878/35 explicit environment skips and the build verifies11 routes
and172 utilities. Exact-candidate hosted CI/release verification is pending.

Released through PR420: candidate `59c7118e6cbab5814acb094df51a24ef46da523b`,
merge `e1faa425d8830ad3f1b980ad36b0a6f99c5bf897`. CI41268756634 passed
Linux3,416/two skips and Windows2,849/35 skips,49 contract tests on each,
both builds/static. Preview7467979886 and production7468037607 succeeded;
six apex routes retain the exact previously tested stylesheet hash. Logs:
`docs/private/b35-nft-coverage-{ci,preview-release,production-release}.log`.
This is a code release, not a live migration or worker activation.

The bounded free-origin follow-up located creation transaction
`0x9a72e3433da68094a5c2c9a2285c41014064083338d1abe252b59c24d60ecef5`
at block41,976,856. Base's receipt and transaction agree with Blockscout and
the CREATE address derivation; the embedded runtime matches the pinned NFT
hash. Only the metadata trailer differs from the local artifact. Both existing
RPCs still reject the historical canonical header. A receipt/explorer match is
not substituted for the required origin/range proof. This narrows the missing
evidence without claiming bootstrap success or adding a paid provider.
Details and raw public responses: `docs/private/b35-nft-origin-free-review.md`.

## November 1 fenced atomic NFT range writer

The dormant `syncNftTransferRange` helper captures existing leadership, Core
deployment and state revision before reading coverage or RPC. It verifies a
bounded range through the existing reader, then locks leadership, state and
the same coverage row in the recovery order. Continuation must match the
previous endpoint/hash and both runtime pins; bootstrap requires absent
coverage and the reader's zero-supply proof. It cannot run ahead of the Core
checkpoint or accept changed engine/listener chain, deployment or authority.

Journal insertion and coverage advancement share one transaction. Exact
retained facts can replay after invalidation; differing payload, source, time,
unproven artwork association or extra retained range events reject the whole
write. Token IDs stay exact. Transfer rows deliberately have no artwork_id
until a separate source-qualified mapping exists. The helper runs no economic,
mint, AI, metric or notification handler and does not advance the Core cursor.

Bootstrap, ranges containing transfers and empty ranges reaching the Core
checkpoint rotate the existing durable cache-purge token, then reinsert the
validated coverage in that transaction. Partial empty ranges only advance
coverage and state revision. Configured caching blocks further writes until
the existing fenced purge path acknowledges the obligation. No new worker
loop or automatic activation is included; operational purge frequency and
public-reader readiness remain integration concerns.

Local verification: the full isolated PostgreSQL run passed171 checks; two
additional post-proof listener-chain regressions passed in a filtered run
(three tests including its parent). Both clusters stopped. Evidence:
`docs/private/b35-nft-writer-postgres.log`,
`docs/private/b35-nft-writer-chain-fence.log`, and the corresponding
`reorg-atomicity-1793503502413-54004-ee9b201e` /
`reorg-atomicity-1793503891551-61800-2d737dbe` evidence directories.
The final full local units pass2,878/35 environment skips (29 unrelated
untracked authority-policy passes excluded from this candidate); the build
verifies11 routes/172 utilities. Focused security/proof checks pass194 with
one unavailable-Docker skip. Exact hosted CI/release is pending. The local
full database matrix exceeded its earlier300-second allowance, so its overall
limit is now360 seconds; individual statement/concurrency bounds are unchanged.

This adds no new interpretation of economics or NFT lifecycle. It implements
the same canon §§1,4,5,9 source and non-sale-transfer boundaries. Historical
bootstrap, source-qualified public ownership/timeline reads, independent
restore, external delivery/cache acceptance and worker activation remain open.

PR421 released the writer from candidate `1162f5d86c3e748b8da7ebaa6eec6b7be1e82fba`,
merge `19a0b5e95bd13d12513506095844d8379af6c3c8`. Exact CI41269676707 passed
Linux3,447/two skips, Windows2,849/35 skips,49 contracts each and both builds/static.
Preview7468101385 and production7468146673 succeeded; six apex routes retain the
exact tested stylesheet. Evidence: `docs/private/b35-nft-writer-{ci,preview-release,production-release}.log`.
The writer is still dormant; this release made no live database or worker change.

## November 1 source-qualified ownership read foundation

The dormant `read_verified_nft_owners` SQL function accepts at most20 exact
artwork IDs and explicit Core/NFT runtime pins. It uses one stable statement
snapshot for coverage, indexer state, original registration and settlement
journals, mutable projections, mint and the latest NFT transfer. Readiness
requires coverage to equal the Core indexed boundary and the durable cache
obligation to be acknowledged. The response includes that boundary, confirmed
boundary, coverage hash and state revision; it does not claim chain finality.

A non-NULL original-Core journal source must match every registration and
settlement identity/payload. The same token cannot belong to two original
settlements and the same artwork cannot belong to two tokens. Its first NFT
transfer must be zero-to-winner in the settlement transaction, before the Core
settlement log. Subsequent ordinary transfers change only the derived current
owner; neither mutable `NFT.core()` nor a foreign deployment can establish
membership. Missing, partial or ambiguous evidence returns `verified=false`
with no owner or First Collector claim. Consumers must never interpret that
result as permission to fall back to a known-stale settlement/listing owner.

The function is stable, invoker-only, service-executable and mutation-free.
It reuses the existing search settlement index and adds two bounded source
lookups to avoid scanning unrelated settlements. A5,000-settlement/10,000-event
decoy fixture used all four intended indexes without a journal/settlement
sequential scan (local execution0.52ms; not a production latency promise).

Local checks pass38/38 in real isolated PostgreSQL, including the existing
engine rewind, concurrent snapshot, missing/foreign sources, mismatched mint,
uint256 limits, cache obligation and role denial. Cluster stopped; evidence:
`docs/private/b35-nft-owners-postgres-reviewed.log` and
`docs/private/reorg-atomicity-1793504788806-51584-950a19a8/`.
An earlier test incorrectly expected primitive SQL rewind to move the Core
cursor; it correctly failed closed. The corrected regression calls the actual
engine rewind before rebuilding fixture coverage. Failed evidence is retained.
Independent review found and resolved the same-artwork/different-token ambiguity
and optional-search-index dependency before release. Full local units pass2,878
with35 environment skips (including29 unrelated untracked authority-policy passes).
Security checks pass25 with one unavailable-Docker skip. Hosted exact CI remains
required. The expanded overall PG-suite allowance is480seconds; individual SQL
and concurrency timeouts remain unchanged.

This is the next B35 prerequisite under canon §§1,4,5,9, not a new NFT rule.
The migration is unapplied live and public endpoints do not call it yet.
Next: integrate qualified ownership/timeline and owner filtering consistently
with recovery/cache handling, then prove the existing-worker activation gates.
Verified historical bootstrap remains separately unavailable on existing RPCs.

## November 1 integrated ownership and provenance consumers

The next dormant integration gives artwork detail, gallery/home cards, profile
ownership filters, Saved and search the same verified owner. It never falls back
to an old settlement, seller or resale recipient when association is unknown.
Active listings require an exact original-Core journal match, current seller,
price and update block, and a listing after the latest transfer (including a
round trip back to the same wallet). Legacy Ethereum Sepolia detail reads remain
independent of Base coverage and remain read-only.

Provenance now consumes exact original-Core registration/auction/settlement/resale
events and verified NFT transfers under one database boundary. It does not fetch
token-only resale history after verification. Transfers are neutral movements,
not invented sales, royalties or floor updates. Registration can predate the NFT
coverage origin. Missing original registration fails closed; lifecycle and
transfer truncation are explicit. Owner-filter responses fail closed when the
latest-200 feed cannot establish complete membership.

Before/after boundary and proof checks fence recovery, configuration changes,
visibility reads and per-event commits ahead of the Core checkpoint. Enabled
responses bypass the old projection cache and use no-store. This conservative
policy must be cost/latency-tested before enabling it; it is not a claim that
each future feed can scale indefinitely without pagination/caching work.

Local validation: 110 helper checks, 21 real-handler fixture checks, and 29
isolated PostgreSQL checks pass, with the database cluster stopped. Actual query
plans use all three source-specific indexes without sequential journal scans.
The first plan exposed a broad block-index scan; an equivalent chronology guard
fixed it before acceptance. Security/proof/route coverage passes 328 with one
unavailable-Docker skip. The build verifies 11 routes and 172 utilities. Six
rendered width/theme combinations (320,390,1366; Classic/Future) and two unknown-
proof states pass 22 assertions: no overflow, correct roles, neutral transfer
copy, no fallback collector, no browser exceptions or remote mutations. These
are isolated browser fixtures, not new native-iPhone or wallet acceptance.

Evidence: `docs/private/b35-history-focused-final.log`,
`docs/private/b35-route-current.log`, `docs/private/b35-history-build-current.log`,
`docs/private/b35-history-render-result.json`, and
`docs/private/reorg-atomicity-1793506747109-18336-dd40ba1f/`.
No contract, economics, public data deletion or new chain was introduced.
Canon §§1,4,5,9 still apply; the read boundary is an implementation detail,
not a new NFT ownership rule.

PR423 released candidate `2034e3304ea0787f4815221fc99d3f02e9450264`,
merge `47a3eacef2257a12a2c811b8f7eee44bd7895897`. Exact CI41272919032
passed Linux3,654/two skips, Windows2,991/35 skips,49 contract checks on each,
both builds and static checks. Preview7468515107 and production7468545248
succeeded; all six apex entry routes serve the tested stylesheet. Evidence:
`docs/private/b35-history-ci.json`, `b35-history-preview-release.log` and
`b35-history-production-release.log`. The migration remains unapplied and
the new ownership consumers remain disabled until the operational gates pass.

### Read-only historical coverage now available

The earlier original-RPC archive blocker is narrowed by a successful bounded
read through Tenderly's documented anonymous Base Sepolia endpoint. No account,
paid service, runtime provider configuration or live database write was added.
The shipped reader verified 110 contiguous ranges from block41,976,861 through
52,911,896, including zero-supply bootstrap, pinned runtimes and canonical range
endpoints. It recorded seven mints and three transfers across seven tokens:
1,114 requests and 6,195,497 response bytes. The first unpaced rate-limit failure
remains recorded separately; only the complete paced run is accepted.

Independent replay verified every saved SHA-256 range digest, endpoint
continuity, unique event and holder transition. Both original RPCs then agreed
at the final block on its hash, both runtime hashes, totalSupply and all seven
ownerOf values (12 bounded reads per provider). Final block hash:
`0x4f214a9f0711fa28864471937b093b1fdb628f22c3fc999b922ebed1d01ca25b`.
Evidence: `docs/private/b35-nft-archive-paced/evidence.json` and
`docs/private/b35-archive-reconcile.json`. This is chain-read evidence, not
persisted production coverage, an independent backup, or worker activation.

Remaining B35 gates include original-Core journal source qualification (old
NULL rows need event replay, not blanket address assignment), independent
restore, recovery/cache and external-delivery acceptance, then updating and
observing the existing worker. B35 and the full Phase B are not closed here.

## November 1 source proof, archive restore and dormant runner

Read-only source qualification now proves 178 legacy NULL-source Core events
against canonical receipts and decoded ABI payloads; four Donation rows are
explicitly excluded. Independent verification binds every database identity to
the saved proof, re-encodes log payloads without address/number coercion, and
checks chain/header/hash-pinned runtime/header/chain through all three providers.
No source column was updated. Evidence: `docs/private/b35-core-source-proof-1793507642069.json`
and `b35-core-source-final-verify-1793508123503.json`. Applying this evidence still
requires fresh database identity checks and a reversible, bounded update.

The October 26 full database archive was restored into a separate PostgreSQL
17.6 container with no network or published ports. All 111 archived tables,
49,349 rows, sorted content digests, sequence values and 1,241 ownership/grant/
default/RLS declarations matched. The single unvalidated constraint,
`realtime.messages.messages_payload_exclusive`, is explicitly `NOT VALID` in
both the source archive and restored schema; it is not a restore regression.
The container was stopped. This is not a current backup, storage-object restore,
or second durable copy. Global roles and extension owners came from a separately
captured November 1 catalog. Evidence: `docs/private/b35-restore-1793508572589-d05313b0/evidence.json`.
The archive SHA-256 is `d8798c2b9b475f026ae95531d0014d29f29dc0e825f9d7136aa10237cec25e49`.

The existing worker now has an opt-in bounded NFT range step after successful
Core catch-up, both at startup and in the serialized poll. It uses persisted
coverage, the same leadership fencing and drain path, and the existing durable
cache purge. Missing coverage restarts at the explicitly reviewed origin; no
recent-block shortcut is allowed. A terminal NFT range must match the retained
Core checkpoint hash before RPC and again under the commit lock. Health checks
read Core revision/cursor/cache token and coverage in one statement and reject
a changed captured boundary. Partial, failed or unpurged coverage cannot claim
sync completion. Disabled deployments perform no extra coverage query.

Configuration is deliberately separate from the API ownership flag:

- `ARTSOUL_NFT_TRANSFER_INDEX_ENABLED` defaults off; only exact `true` enables it.
- Explicit Base Sepolia Core/NFT addresses must match the resolved worker.
- `ARTSOUL_NFT_OWNERSHIP_CORE_CODE_HASH` and `ARTSOUL_NFT_OWNERSHIP_NFT_CODE_HASH`
  pin both deployments; neither may be empty or zero.
- `ARTSOUL_NFT_TRANSFER_FROM_BLOCK` and `ARTSOUL_NFT_TRANSFER_ORIGIN_BLOCK_HASH`
  identify the reviewed origin and its predecessor. They are mandatory.
- `ARTSOUL_NFT_TRANSFER_MAX_BLOCKS` defaults to 1,000, bounded to 1..100,000;
  larger windows require provider/archive evidence, not guessed completeness.
- Optional `BASE_SEPOLIA_READ_RPC_URLS` accepts an explicit HTTP(S) read-provider
  order only for Base Sepolia. No runtime provider or default order was changed.

Local lifecycle/configuration checks pass 151; build checks pass 11 routes and
172 utilities. The first parallel full-unit run passed 3,550 with two failures,
one cancellation and one environment skip: disposable database readiness and a
60-second ordered-catch-up timeout under concurrent database load. Both affected
files subsequently passed all 45 checks in a serial rerun with no skips. The
expanded 250-check recovery matrix also exceeded its 480-second limit under
that load. Its overall allowance is now 900 seconds for the expanded Windows
matrix; individual SQL, lease and concurrency bounds are unchanged. The final
isolated rerun and exact hosted CI remain required. Failed logs
are retained rather than counted as passes. Evidence: `docs/private/b35-runner-*.log`
and `b35-checkpoint-postgres*.log`.

Six bounded read-only samples of empty five-block ranges measured nine proof
RPCs and 44.4–44.7KB per range, excluding endpoint acquisition, SQL and purge.
Base took 1,144–1,327ms; PublicNode took 443–452ms. These are small local samples,
not an SLA, a provider comparison at the same finality head, or runtime approval.
At a two-second poll, the approximately ten-call path could approach 432,000
RPCs/day before retries. Every advancing terminal range also schedules a cache
purge, and the API intentionally refuses incomplete coverage during catch-up.
This measured cost/availability gate must be resolved before activation.
Evidence: `docs/private/b35-nft-poll-cost-1793509416765.json`.

No new server, contract, economics, chain, payment, live migration or source
assignment was introduced. Canon sections 1,4,5,9 apply unchanged. The existing
worker remains on B30 and ownership API activation stays off. Next: finish exact
candidate verification, then resolve poll/cache cost and availability in an
isolated end-to-end rehearsal before any existing-worker rollout.

## November 1 worker integration release and coordinated publication

PR #424 candidate `49e181db` passed exact CI41276022695: Linux3,808 passes/two
skips, Windows3,133 passes/35 skips,49 contract checks each, both builds and
static checks. It merged as `14af0d0f`. Preview7468906592 and production7468978313
serve the reviewed assets; six public routes match stylesheet SHA-256
`39b90d05b45c77084d9df94b80b93d1c63ee5d1afe4b123290bce5d6e03df884`.
The full isolated Windows recovery rerun passed250/250 in550seconds with the
900-second overall allowance. Earlier failed runs above remain retained.

The fresh November1 archive was also restored, not merely inspected:
111 tables,286,532 rows and1,258 security declarations match the archive,
including table digests and sequences. No invalid indexes were found. The
one inherited NOT VALID realtime constraint is present in the source archive;
it is not claimed as newly validated. The isolated container was stopped.
Archive SHA-256 is
`5105452a4aa9de17329ecf98e9bd2b97d26f37dfb2185abd786790bc97627cd3`.
Private restore evidence: `b35-restore-1793510113311-555134dc/evidence.json`.
Object-storage bytes and a second independent durable copy remain open gates.

The next, still local slice removes a publication gap: the legacy runner
commits mutable Core rows before its final cursor, while NFT coverage remains
at the previous cursor. The opt-in runner now holds Core during historical NFT
catch-up, then prepares both sources outside database locks and publishes their
journal, projections, lifecycle outbox, event leases, retained headers, coverage
and cursors in one fenced transaction. Existing event handlers are reused.
Wrong sources, forks, transaction positions, extra retained logs, changed
leadership or an expired lease abort the entire range. Only a failing event's
retry record can survive an aborted transaction.

Publication is bounded to the configured block window,1,000 Core/Donation
events and a30-second transaction work allowance. It attempts at most one
publication per10seconds while head/recovery observation retains its normal
cadence. An empty already-ready range does not purge caches. A changed range
clears its durable purge obligation before optional AI enrichment. A purge
failure preserves the committed range and retries the obligation without
replaying its events. Activation now requires a valid Redis configuration:
the existing no-cache path deliberately cannot acknowledge that obligation.
This adds no service or billing change.

Local evidence at this checkpoint:262 focused checks pass;20 coordinated
PostgreSQL scenarios (21 including the parent test) pass, including concurrent
readers, four injected rollback stages, source/lease changes and post-commit
cache failure. The expanded full recovery run, exact candidate CI, cost and
API-boundary acceptance are still required. No live migration, source update,
new writer or ownership gate has been enabled. Canon1/4/5/9 are unchanged;
the10-second cadence is an operational cost bound, not auction economics.

The ownership consumers now retry one whole read only after a validated forward,
fully confirmed boundary change. Cards, feeds, Saved/search hydration and
provenance discard the first attempt together. Same-height rewrites, malformed
proofs, changed deployment settings and repeated movement remain unavailable;
HTTP output is sent only after the final check. The focused API suites pass255
checks. Strict historical log parsing also prevents a malformed known Core or
Donation event from being silently omitted from a coordinated publication;
unknown valid ABI topics retain the existing behavior.

Final review found that a retained event without its completed processing record
cannot safely be replayed: settlement handlers increment trust counters, and an
old bid could overwrite a later completed bid. The coordinated path now rejects
that inconsistent state before applying any projection. Recovery must reconcile
it; no guess or automatic completion is permitted. Two additional database
regressions cover retained settlements and bids, including unchanged counters,
outbox, projections and boundaries.

The first expanded full local run completed with267 passes and two failing
subtests (three failures including the parent): both failed in fixture reset,
where TRUNCATE exceeded the unchanged ten-second SQL limit while another local
database suite was running. Evidence is retained in
`docs/private/b35-atomic-postgres-full.log`; the cluster stopped successfully.
This is not recorded as a passing matrix. The final two new regressions and
isolated reruns, plus exact candidate CI, remain required before release.

The isolated follow-up now passes25/25 (24 scenarios and the parent), including
both timed-out cases and22 coordinated scenarios. Its new bid fixture initially
lacked the processing record required by notification provenance; it now seeds
completed processing normally, then removes only the first completion to model
the reported inconsistency. No production guard was weakened to satisfy it.
Final evidence: `docs/private/b35-atomic-pg-recheck-final.log` and
`reorg-atomicity-1793512314091-61636-cdc44aaf/evidence.json`; cluster stopped.
The first fixture failure remains in `b35-atomic-pg-recheck.log`.
Preview7469179359 serves the exact six-route stylesheet and successful real
artwork13/provenance reads, using520,393 response bytes for the bounded check.
These existing-data reads exercise the disabled ownership gate, not activation.


## November 1 object-byte recovery rehearsal

The fresh database archive above is now paired with all 159 public objects in
the Protocol artworks bucket (115,603,645 bytes). Each conditional download
matched the archived ETag and size; 158 ordinary ETags also matched the byte
MD5. The one multipart ETag was checked as an opaque version identifier, not
incorrectly treated as a full-file MD5. Every saved object has a SHA-256 digest.

A separate offline restore reconstructed every original bucket/key path from
the manifest and verified all 159 sizes and SHA-256 digests, with no source
writes and no missing or extra inventory keys. This is the Protocol project
only; ArtSoul OS was not accessed. Manifest SHA-256:
`bc3a8818db0c5ba1be4d6caf6f8a8865232254d41b6c512dca498acf4e435d3b`.
Private evidence: `docs/private/b35-storage-restore-summary.json`.

This closes the local object-byte recovery check, not the independent durable
encrypted-copy gate. Both local copies share one computer. No new storage
subscription, billing change, migration, live writer or ownership flag was
enabled. The next independent work is the bounded poll/cache cost and API
boundary acceptance rehearsal; an independent backup destination and recovery
procedure remain necessary before activation.


## November 1 API response-boundary cost reduction

A bounded offline measurement used the current public handler and its existing
synthetic ownership fixture for 1, 20 and 200 works. It included stable reads,
one forward publication and two consecutive forward publications. No network,
real database, provider latency or paid usage was involved. The initial probe
incorrectly expected all 200 cards in the response; the existing default page
cap is 100. That probe failure is retained and its expectation was corrected.

The measurement exposed three complete ownership proof passes per feed: initial
hydration, an intermediate projection check and the terminal response check.
The intermediate check was removed; the Saved single-card entry point now owns
its terminal check explicitly. HTTP and search retain their checks after all
visibility/permission reads. Proof contents, same-boundary mutation rejection,
one whole-read retry and unavailable responses are unchanged. This is API
orchestration within canon sections 1/4/5/9, not an economic or lifecycle change.

At 200 fixture works, stable reads fell from 43 to 33 database HTTP requests,
30 to 20 ownership batches, and 549,031 to 415,037 response body bytes (24.4%).
These are fixture payloads excluding headers/TLS; they are not billed egress or
a production latency claim. A single forward publication fell from 66 to 56
requests; a second move still returned 503 after the single permitted retry.

Three cost regressions failed before the patch and pass afterward. Four new
cases prove direct/feed/Saved/search reject owner changes under an unchanged
boundary. The Saved extraction fixture initially lacked the newly explicit
guard dependencies; it now supplies them and asserts both execution and denial.
Final focused validation: 224/224 checks and the 11-route/172-utility build pass.
Private evidence: `b35-api-cost-{acceptance-final,after-guard}.json`,
`b35-redundant-read-reproduction.log` and `b35-response-guard-final.log`.

The combined poll/RPC/SQL/cache workload and independent encrypted backup copy
remain open. This patch does not enable the ownership API or update the live
worker. Exact release checks remain necessary.

Independent review found no regression in the changed entry points. Existing
acceptance limitation: Saved pages hydrate separate groups of cards, and global
search may await artist profiles alongside card hydration. Per-card/segment
proof does not by itself establish one publication boundary for the entire
outer response. That broader acceptance remains open before activation.

## November 2 whole Saved/search response acceptance

The outer-response limitation above is now addressed in code and isolated
real-handler acceptance. Saved captured independently verified groups of four
cards; search could finish card verification while outer artist profiles were
still pending. Neither established a single publication for its complete HTTP
response. This was an opt-in-path defect, not evidence of an incident in the
currently disabled ownership projection.

Both handlers now capture one ownership boundary, retain every hydrated proof,
and recheck the combined bounded set after all response dependencies complete.
One validated forward publication retries the entire response once, including
Saved membership/visibility or search categories/profiles. Helpers inside that
response cannot independently retry. A second publication, unchanged-marker
owner mutation, changed deployment, or changed feature configuration returns
one sanitized 503 without a partial 200. Route flags are checked again after
the final asynchronous proof. Membership-only Saved lookups and artist-only
search do not acquire ownership proofs.

The real-handler fixture contains 18 acceptance cases (19 Node tests including
the parent). An in-memory loader using the four production modules from
`f9f7168a` reproduced eight behavioral failures without reverting the working
tree; the completed implementation passes all cases. It covers five Saved
cards across two groups, delayed outer search profiles, one and two publication
moves, late owner/configuration changes, unavailable entries, empty responses,
privacy, and the disabled ownership path. All requests are synthetic; no live
database, environment flag, transaction, or worker was modified.

A stable five-card Saved response uses one boundary read and six ownership
proof RPCs (five captures plus one final batch), versus five boundary reads and
ten proof RPCs in the previous per-card path. Search retains one boundary read
and two proof passes. These are asserted fixture request budgets, not claims
about production latency or billed bandwidth. The disabled path performs no
ownership RPCs and retains its existing cached projection.

Validation: 205 focused tests pass; the full local unit run reports 3,401 passes
and 35 skips. The local tree contains preserved unrelated tests, so exact
tracked CI remains the release authority. Evidence is retained privately in
`b35-outer-focused-final.log` and `b35-outer-unit.log`. Exact candidate CI and
deployment verification belong to this change's PR.

Interpretation: this closes the whole outer Saved/search response acceptance
slice within canon sections 1/4/5/9. It does not change economics, lifecycle,
contracts, roles, or the public API schema. Combined poll/RPC/SQL/cache workload,
independent durable encrypted recovery, and live worker/API activation remain
separate open gates. The existing server still requires its reviewed worker
update; no additional server is required.

PR #442 released this outer-response slice as main
`759a5ab718475b4a5e7fe716c1f6c184743d2068`, candidate
`11e9465adf598b016a0ca3dbe35c54f47b12d2c3`. Exact CI 41365711915 passed
Linux, Windows and static checks. Preview 7481218048 and production 7481332433
succeeded; eight routes and six runtime/CSS assets matched the built candidate.
No feature flag, schema or worker-source activation was performed. Private
evidence: `b18-runtime-b35-nov2-{preview,production}-release.json`.
