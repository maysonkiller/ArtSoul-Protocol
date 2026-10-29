# B30 — Database egress incident

Status: indexer correction deployed and released in PR #389; provider quota
restriction remains open.
Work date: October 29, 2026 in Europe/Warsaw; measurements below use UTC.
Scope: canonical B2/B3, indexer/database operations, Bible sections 1 and 15.
No contract, economic, lifecycle, permission or schema change.

## October 29 follow-up: correct dashboard and project separation

After the owner signed into the correct organization, its Usage dashboard
confirmed the October 24–November 24 billing cycle, Pro allowance of 250 GB,
**782.023 GB uncached egress**, 3.142 GB cached egress, and service restriction.
These are the later dashboard values; the earlier email's 411.15 / 275 GB
figures are retained below as the original incident evidence, not current usage.
The dashboard states usage may take up to one hour to refresh.

The daily chart identifies Shared Pooler as the dominant source, rather than
Storage. Values below are quoted as rendered by the chart, without treating
rounded chart units as an exact reconciliation of the summary's billing total:

| Date shown | Shared Pooler | PostgREST | Storage |
| --- | --- | --- | --- |
| October 24 | 514.1 MB (98.7%) | 3.835 MB | 2.814 MB |
| October 25 | 12.489 GB (99.9%) | 7.611 MB | 831.3 KB |
| October 26 | 121.01 GB (100.0%, rounded) | 11.87 MB | 5.768 MB |
| October 27 | 248.88 GB (100.0%, rounded) | 1.393 MB | 162.5 KB |
| October 28 | 345.348 GB (100.0%, rounded) | 8.352 MB | 45.671 MB |

At 23:55:54 UTC October 28, a further read-only host check found the old query
still frozen at 1,287,486 calls / 16,221,744,465 returned rows. The new digest
query had 779 calls / 779 rows. The indexer was healthy and synchronized,
six blocks behind, with no failed/dead events or recent RPC error. Historical
dashboard totals are not a post-patch traffic-rate measurement.

The owner explicitly requested checking accidental Protocol/OS mixing in
both directions. Current live configuration and database inventories show
separate Supabase projects:

- Protocol's local configuration, running indexer environment and production
  `/api/public/config` all identify the existing Protocol project. Its only
  Storage bucket is `artworks`: 159 objects, 115,603,645 bytes. Count-only
  checks across 67 public text/JSON-bearing tables and Storage metadata found
  no current/retired OS project reference or OS domain. Protocol runtime source
  also contains none of those references.
- A bounded independent read-only check of the OS production environment and
  running API/bot confirmed its separate Frankfurt project. Its expected OS
  schema has no Protocol projection/indexer tables; Supabase Storage has zero
  buckets and zero objects. Thirty-seven relevant URL/metadata/settings columns
  contain no Protocol project reference. Current deployed OS source also has
  no Protocol project reference.
- An older local OS development checkout still references its retired OS
  project. This is stale OS development configuration, not a Protocol target;
  the current OS server uses the newer OS project. Nothing was edited there.

These are current configuration/schema/storage/reference checks. They do not
prove that no historical copy ever existed in deleted projects or backups, or
provide a semantic review of every uploaded image. No cross-project copy,
database mutation, configuration change or billing change was performed.
Sanitized exact project mappings and Protocol measurements are retained in
the ignored `docs/private/` evidence, without credentials or personal records.
No canon interpretation or amendment was required.

## Evidence and cause

The founder supplied a Supabase notice reporting 411.15 GB of 275 GB egress
and restriction until November 24. These are the notice's billing figures,
not an independently retrieved usage dashboard. The available dashboard
session belongs to a different organization; no billing setting was changed.
The existing CLI later confirmed access to the correct ArtSoul organization
and its single ArtSoul project, reported `ACTIVE_HEALTHY`. This project status
does not override the measured Data API/Storage restriction. The CLI's available
organization commands do not expose the billing-cycle egress breakdown.

The active database measured 100,912,275 bytes; Storage metadata recorded
159 objects totaling 115,603,645 bytes. Egress is cumulative network transfer,
not stored size. Supabase separately labels PostgREST and Supavisor traffic;
see [egress documentation](https://supabase.com/docs/guides/platform/manage-your-usage/egress).

`IndexerSyncEngine._computeStateHash` downloaded every historical block hash
through the confirmed cursor, joined the strings in Node, and sent the result
back to PostgreSQL for SHA-256. It runs during synchronization and reorg checks.
The host polls every two seconds. One measured Base history held 140,197 rows,
or 9,253,002 bytes of hash text before row/protocol overhead.

At containment, `pg_stat_statements` query `-8998087275607607246` showed
1,287,486 calls and 16,221,744,465 returned rows. These counters are cumulative
over the statistics collection period, **not** this billing cycle. They prove
the repeated large transfer, but do not attribute every billed byte of the
411.15 GB notice to this query. The provider breakdown remains required.

## Correction and safe rollout

The same ordered, comma-separated SHA-256 is now calculated entirely inside
PostgreSQL using `string_agg`, `digest` and `encode`. Empty history remains the
hash of the empty string. Chain and block cutoff remain bound parameters.
One query returns one 64-character digest instead of the history. No hash
version, reorg check, cursor, polling interval or historical row is changed.
This bounds response size; database computation still grows with history.

The deployed host contains previously reviewed targeted fixes, so the full
checkout was not replaced. Only this method was substituted after checking the
complete pre-patch file hash and preserving a root-only source backup/journal.

- Pre-patch source SHA-256:
  `565bc4dd76381f94d89363b334c550b15904cb19c62b1dd154640bce077de3fc`.
- Post-patch source SHA-256:
  `85ff8cca6410216ee2d84df98fb8a49fe4072cfb9216e94ed3e1af933785fa02`.
- Candidate method SHA-256:
  `08e89dca51bb368d29444f847dfb82309faf4ec7daa91f48121d9a4e644b7a6e`.
- Base worker stopped at 23:16:14 UTC and resumed at 23:21:22 UTC, October 28.
- Preserved confirmed cursor: 51,537,518. The new query exactly matched stored
  hash `0xeb97c0a2a719c7acca6542a3011aeb8467946e30899167358e1fc658ec29f5cb`.
- The legacy Ethereum Sepolia worker remained stopped.

Before deployment, six real PostgreSQL read-only fixtures passed: empty
history, ordered prefix, multiple blocks, cutoff, another chain and absent
chain. Eighteen focused unit/event-failure/rollback checks passed. No new
transaction was signed and no projection or checkpoint was reset.

At 23:22:33 and 23:24:13 UTC the old query's call/row counters were unchanged.
The new query advanced from 19 calls/19 rows to 69 calls/69 rows: 50 digest
calculations, exactly 50 returned rows. Confirmed cursor advanced from
51,539,419 to 51,539,919. Health was healthy/synchronized, 12 blocks behind,
zero unresolved, failed or dead events, and zero recent RPC errors. The new
query's execution time over this interval averaged about 43 ms. This is a
bounded observation, not a future monthly usage guarantee.

At 23:31 UTC an RPC latency spike coincided with lag 85 (`isSynced: false`),
while digest counters still showed one row per call and zero hash mismatches.
The bounded follow-up at 23:32 UTC found lag 12 and synchronization restored,
with one recent RPC error and zero failed/dead events. No cursor reset,
threshold relaxation or second process restart was used. Record this transient
degradation rather than treating all samples as continuously synchronized.

## Regression and acceptance

- New transport tests reject a second history round trip and propagate query
  failures without retry/fallback writes.
- Disposable PostgreSQL regression exercises 2,048 reverse-inserted blocks,
  multiple cutoffs, chain isolation, empty input and response below 100 bytes.
  Docker is unavailable locally; this test passed in Linux CI.
- Local full unit run: 2,535 passed, 33 skipped, no failures. That run includes
  the existing unrelated untracked policy tests, which are not part of this
  change; exact committed-candidate CI results are recorded below.
- Private read-only measurements and the bounded rollout journal are retained
  under `docs/private/` and the host recovery directory. They are not public
  source files and contain no emitted credential values.

## Repository release

PR #389 merged exact candidate `38bbf544700b4a6ee7122a4c34c4b28182509dc3`
as main `25bd610247e823a985535fa3658b7193acd9b17f` on October 28 at
23:33:45 UTC. Candidate CI **40787623379** passes: Linux 2,903 unit checks
(two skips), Windows 2,506 (33 skips), 49 contract tests on each platform,
both builds and static checks. The new disposable PostgreSQL transport/parity
subtest executed successfully on Linux. Production deployment 7399975277
succeeded; post-merge CI 40788220794 also passed. The active host's
source-only rollout preceded the repository release to contain ongoing egress.

## Remaining incident gates

Real Data API and Storage read requests returned **HTTP 402** at 23:24 UTC.
Before B31, the public artwork endpoint returned HTTP 200 with `success: true` and
11 upstream warnings, so HTTP status alone must not be used as an availability
check. Direct database access and the indexer remained operational. This is
not a claim that the user-facing product is restored.

PR #390 subsequently corrected that API failure response. At 23:45:58 UTC,
both production public feed and direct artwork requests returned uncached
HTTP 503 / `ARTWORKS_UNAVAILABLE`, as required while the source is unavailable.
See [B31 verification](B31_PROJECTION_OUTAGE_2026-10-29.md). This is an outage
handling correction, not provider service recovery.

Fixing the consumer does not erase consumed allowance. Retain Spend Cap and
do not move projects, delete data, reset statistics, bypass service restrictions
or enable chargeable usage automatically. The owner must choose restoration
with the provider or an explicitly approved paid-overage decision; otherwise
the notice's refill date remains the stated recovery date. See
[cost control](https://supabase.com/docs/guides/platform/cost-control).

The correct organization's billing-cycle dashboard/category breakdown is now
verified as recorded above. Before closing the incident: restore provider
service under an approved decision, verify real
Data API/Storage and populated public results, and record post-fix egress slope.
The historical A9 cost window does not prove present-day cost readiness.
Phase B remains open. No financial support request was sent on the owner's behalf.

For the provider restoration discussion, the evidence is ready: the notice's
411.15 GB / 275 GB figures; roughly 101 MB database and 116 MB stored objects;
the recurring full-history query; the correction and rollout timestamps;
unchanged old-query counters; and one returned row per new digest calculation.
The current-cycle dashboard now corroborates Shared Pooler dominance. Request
whether restoration is possible after remediation while retaining the spend
cap. Do not describe the cumulative SQL counters as billing-cycle totals, or
promise a quota waiver. Sending this request still requires owner authorization.

## Interpretation and rollback

No canon amendment is needed: computation location changes, not the checksum
or protocol behavior. Temporary worker containment was a reversible response
to confirmed ongoing waste. If a new digest mismatch appears, stop the worker
and preserve the cursor/logs; compare the stored hash before reverting. Blindly
restoring the old method while running would resume the excessive transfer.
