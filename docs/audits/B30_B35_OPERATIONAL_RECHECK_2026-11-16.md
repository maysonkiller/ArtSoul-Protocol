# B30/B35: bounded operational recheck, November 16, 2026

Supabase confirmed the managed collector issue on November 17. The provider
has given no date for a permanent correction. See the November 19 follow-up
below for the latest database observation.

## Read-only observations

The Supabase connector returned `ACTIVE_HEALTHY` for the existing ArtSoul
Protocol project. Its organization still reports the Pro plan. No plan,
configuration, schema, data, process or paid capacity was changed.

One database snapshot used a read-only transaction and a three-second statement
timeout. At `2026-11-16T17:36:39.561196Z` it returned:

| Measurement | Value |
| --- | ---: |
| Database size | 430,787,731 bytes |
| Connected backends | 22 |
| Temporary files, cumulative | 206,874 |
| Temporary bytes, cumulative | 474,572,441,630 |
| Deadlocks / conflicts | 0 / 0 |

The statistics reset remains `2026-04-26T02:16:05.746341Z`; database startup
remains `2026-11-02T00:22:36.181024Z`. Against the earlier November 16 snapshot
at `11:09:56.959604Z`, the cumulative change is 490 temporary files and
1,711,442,272 temporary bytes. This interval does not attribute every byte to
the exporter, establish the instantaneous spill rate, or measure billed egress.
No statement-history reset or repeated reproduction was performed.

At `17:37:39.749Z`, one ordinary request to `/api/public/indexer-status` returned
HTTP 200, a populated 3,472-byte response and no warnings:

- Base Sepolia: running, healthy, indexed six seconds before the response;
  indexed and confirmed projection block 59,643,911; three-block confirmation
  depth; 226 events.
- Legacy Ethereum Sepolia: stopped by design; its three events remain readable.

This cached public response proves a successful bounded projection read. It
does not measure live RPC-head lag, every Supabase service or load capacity.

## Provider and cost boundaries

The existing support conversation was re-read. Its latest provider response
remains the November 9 AI escalation for human review of managed exporter
queries/session behavior. On November 16, the owner-authorized follow-up was
sent in the same support case and verified in Gmail Sent. It requests a
collector-only correction/status without a paid upgrade, global memory change,
database restart or disabling Spend Cap. A human correction remains unconfirmed;
no new project-data access was granted.

The root agent then verified the existing organization's dashboard in the
browser at approximately `17:42-17:47 UTC` on November 16. The displayed
billing period was November 2-24, 2026:

| Billing measurement | Displayed value |
| --- | ---: |
| Pro plan | USD 25.00 |
| Compute | USD 4.73 |
| Compute credits | USD -4.73 |
| Current costs | USD 25.00 |
| Projected costs | USD 25.00 |
| Spend Cap | Enabled |

| Usage measurement | Used | Included allowance |
| --- | ---: | ---: |
| Uncached egress | 2.779 GB | 250 GB |
| Cached egress | 1.412 GB | 250 GB |
| Storage | 0.115 GB | 100 GB |
| Image transformations | 33 | 100 |

The existing ArtSoul disk is provisioned at 2 GB; displayed GP3 disk overage
is zero GB-hours. No billing or infrastructure setting was changed. These are
current dashboard estimates and cumulative usage, not a final invoice, a
future zero-overage guarantee or a measurement of remaining Disk IO budget.
Cached and uncached egress allowances remain separate.

## Evening bounded recheck and remaining work

At `20:08:26.752962 UTC`, one read-only `pg_stat_database` row, under a
three-second statement timeout, returned 13 connected backends, 207,062
cumulative temporary files and 475,232,633,708 cumulative temporary bytes.
Deadlocks/conflicts remained zero; the statistics-reset and database-start
timestamps were unchanged. Since the `17:36:39` observation, the counters
increased by 188 files and 660,192,078 bytes. This is an interval delta, not a
current rate, exporter-only attribution, remaining IO allowance or billed
egress. No query-text catalog scan or reproduction was repeated.

At `20:08:26 UTC`, ordinary public status/config reads returned HTTP 200.
Base Sepolia was healthy, indexed four seconds before the response, at
confirmed/indexed block 59,689,157 with depth three and 229 events; warnings
were empty. Legacy Ethereum Sepolia remained stopped by design. Public config
reported external Base wallet inventory enabled and multichain wallet assets
disabled. These public flags do not expose or verify the separate hosted
NFT-transfer writer and verified-ownership settings.

The root agent re-read the same support thread during this follow-up: the
November 16 message sent at `17:40 UTC` is present, with no newer human reply
or correction confirmation. No duplicate message was sent. Billing was not
polled again; the dashboard evidence above retains its original timestamp.

| Area | Existing implementation/evidence | Remaining bounded work |
| --- | --- | --- |
| B2 monitoring | `npm run monitor:indexer` calls `scripts/check-indexer-health.mjs`: one timed health read, stable failure codes, no embedded polling or message delivery. `A9_INFRA_COST_MONITORING.md` already defines the no-cost Tuesday/Friday and post-deployment operator checks; `B3_INCIDENT_RESPONSE.md` covers site, indexer, errors, cost, moderation and cached metrics. | Record the actual operator, support/pause coverage and assigned observation window with the B1 cohort. A local passing checker or today's read does not establish unattended alert delivery. No new monitoring subscription is required. |
| B30 resource incident | The original full-history transfer correction and managed-exporter attribution are already recorded. Current SQL/public reads work and current displayed costs remain those above. | Await the provider's collector-only response; then perform one bounded post-correction check and retain representative IO/egress/invoice evidence. Repeating diagnostic spills, raising global memory or buying capacity would not prove this repair. |
| B35 Core | Independent recovery, owner key custody, committed migrations and Core activation passed November 9. The later local combined PostgreSQL/real-Redis test closes its local transport gap. | No repeated backup ceremony, migration or Core restart is needed to re-establish that evidence. Continue ordinary monitoring; hosted cache/NFT activation is a separate optional change. |
| Optional B35 NFT coverage/cache | `resolveNftTransferConfig` requires explicit deployment/origin hashes and a recovery-capable Redis URL. `readNftOwnershipConfig` has its own server flag. The last hosted activation record has both flags off and no Redis connection. | Before activation, qualify actual provider history/coverage, cache purge acknowledgement and hosted recovery, plus resource headroom. These are not prerequisites for the already-running Core-only worker. No flag was changed or claimed freshly inspected here. |
| External wallet inventory / B36 | `external-wallet-nfts.js` uses a separate server credential, bounded pages, five-minute caching and request budgets. Current Base inventory is enabled; the separate multichain flag is off. | Keep Base inventory distinct from B35 protocol-transfer coverage. Multichain activation retains the per-network support/account-budget probe in `B36_ALCHEMY_CU_PROBE_2026-11-06.md`; no probe or paid request was triggered here. |

On November 16, two source-only runbook corrections were completed:
[B3](../runbooks/B3_INCIDENT_RESPONSE.md#5-cost) now uses A9's accepted
Tuesday/Friday and post-deployment review cadence, replacing the unsupported
aggregate USD 150-200 estimate with dated per-provider evidence;
[A11](../runbooks/A11_PUBLIC_METRICS_ROLLOUT.md#hetzner-deployment-and-acceptance)
now passes `ARTSOUL_MONITOR_MAX_BLOCKS_BEHIND=50` to the standalone checker.
The command matches `loadMonitorConfig` and its strict less-than lag check;
chain, confirmation-depth, RPC-error, response-age and timeout thresholds are
unchanged. Documentation links and the bounded diff were checked. This did
not execute deployment commands, poll health again or change hosted settings.

Remaining operational acceptance is a provider-confirmed collector-only fix,
one bounded post-fix check, and representative IO/egress and billing evidence.
Hosted Redis/NFT consumers remain separate, optional activation gates; no new
service purchase is required by this recheck. Actual tester/operator/support
coverage is a separate Phase B requirement, not something these counters prove.

Related records: [exporter attribution](B30_EXPORTER_TEMP_FILES_2026-11-09.md),
[independent recovery and Core cutover](B35_INDEPENDENT_RECOVERY_AND_CORE_CUTOVER_2026-11-09.md).

## November 18 provider follow-up

On November 17, Supabase Support confirmed that its managed exporter scans
`pg_stat_statements` every minute. As that dataset grows the query can spill
to temporary files. Support attributed this incident to the collector and is
tracking a permanent fix internally, with no delivery date. This supersedes
the earlier status of awaiting a human diagnosis.

At 12:23:57 UTC on November 18 the project reported `ACTIVE_HEALTHY`. One
bounded read of the current database row returned 210,076 cumulative
temporary files, 485,831,708,304 cumulative temporary bytes, 21 backends,
zero deadlocks and zero conflicts, on the same statistics epoch as November 16.
The increase since 20:08:26 UTC on November 16 was 3,014 files and
10,599,074,596 bytes. These counts measure cumulative disk work. They do not
measure occupied disk, remaining burst budget, billed egress or the fraction
attributable to each query. The most recent verified billing figures above
are dated November 16.

At 13:01:51 UTC on November 18 the hosted database occupied 450,096,275
bytes. Inspection of the development PC's Windows scheduled tasks, services,
running processes and Protocol scripts found no recurring download of that
database. The November 9 restore check downloaded its backup once. The
Control Center login task launches a separate local application. The
temporary-write counter measures work inside hosted PostgreSQL. Checking the
current plan confirmed Pro. Today's invoice projection was unavailable through
the connector. Spend Cap covers listed usage categories. Separately selected
compute and certain add-ons have their own charges.
[Supabase cost controls](https://supabase.com/docs/guides/platform/cost-control)

Support suggested clearing statement statistics to reduce the size of the next
scan. A reset discards diagnostic history and the same scan can grow again.
Retain the current baseline while the service is healthy. If the live Disk IO
budget declines enough to affect response times, inspect Database Health and
consider a separately approved one-time reset after preserving a private,
bounded aggregate snapshot. Compare equivalent observation windows before and
after. No scheduled reset, raw SQL history table or capacity change was made.
[Supabase Disk IO](https://supabase.com/kb/troubleshooting/exhaust-disk-io)
and [PostgreSQL statement statistics](https://www.postgresql.org/docs/17/pgstatstatements.html).

Both Alchemy account notices supplied by the founder describe opt-in Spyglass
beta access. Existing per-app Request Logs already support filtering by chain,
RPC method and response status. Use those for current investigations. The
invitation gives no additional RPC compute allowance and promises free access
only during the beta. No account setting, key or plan was changed.
[Alchemy Request Logs](https://www.alchemy.com/docs/alchemy-request-logs).

## November 19 support and database check

The provider followed up in the existing case on November 19, asking whether
assistance was still needed. At 12:41 UTC ArtSoul reported `ACTIVE_HEALTHY`.
A single read-only observation of `pg_stat_database` found 211,870 cumulative
temporary files and 492,153,113,692 cumulative temporary bytes. Against
November 18 at 12:23:57 UTC, the same statistics epoch gained 1,794 files and
6,321,405,388 bytes in 24 hours and 17 minutes. The database occupied
460,835,987 bytes. The deadlock and conflict counters were both zero.

These are aggregate temporary writes for the database. Per-query attribution,
remaining Disk IO budget and billing require different measurements. The
operator replied in the existing thread with the interval and asked Support
to keep the case open or link it to the engineering issue, identify the
recommended Disk IO metric and notify ArtSoul when the fix reaches the
project. Gmail confirmed the reply was sent. The operator preserved statement
statistics and retained the existing compute configuration.

The connector still reported Pro. The authenticated billing dashboard was
unavailable in this session, so November 16 remains the most recent verified
current/projected invoice and Spend Cap observation. Today's Disk IO Balance
was likewise unavailable.

## Local test storage

PostgreSQL and Redis Docker images create anonymous data volumes. The previous
test teardown could remove a container but leave its volume on the development
machine. Updated 38 existing integration test files and the new reminder test
to dispose of the volumes that their own fixtures create. Former fixed-name
fixtures use unique instances so parallel runs cannot remove another run.
The 38 affected file suites passed 737 checks. Dedicated probes confirmed
volume disposal for both images and container cleanup on startup failure.
No existing volume or retained recovery directory was removed. This local
issue has a different cause and different counters from the managed exporter.

The [indexer recovery test](../../test/indexer-reorg-atomicity.test.cjs)
also initializes PostgreSQL directly on the development machine. On November 18,
68 earlier run directories contained 4,231,191,430 bytes of cluster files.
Two runs created in the preceding 48 hours accounted for 276,038,386 bytes.
These are local file sizes from the test's own directories.

Successful runs now stop the loopback server, check its stopped status and
save `evidence.json` before removing that run's `cluster` directory. The
server log, generated fixture code and query plans stay with the evidence.
On a setup or test failure the physical data remains available for diagnosis.
An unsuccessful stop or cleanup requires inspection of that run. Historical
directories are preserved.

The full local recovery suite passed all 275 checks with PostgreSQL enabled.
The run recorded a clean stop, kept its evidence and removed its own data
directory after the final check.

The operator also preserved 29 older runs with independent passing logs on
the recovery drive. The archives contain 35,970 files (1,734,034,874 source
bytes). Every extracted entry matched its source SHA-256. The recovery
directory holds the checksums, original paths and restoration instructions.
The hold ends no earlier than December 18, 2026. The 39 remaining runs were
recent or lacked independent evidence for archival. All originals remain on
the development drive.

On the 12-logical-CPU development machine, the default Node test runner
started enough database fixtures together to miss a PostgreSQL readiness
check and the ordered-indexer suite's deadline. The project runner now caps
parallel test files at four. The ordinary run passed 4,184 checks with zero
failures or cancellations. The opt-in native PostgreSQL suite passed its 275
checks separately. The existing query and test timeouts are unchanged.
