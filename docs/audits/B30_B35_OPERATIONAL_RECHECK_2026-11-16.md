# B30/B35: bounded operational recheck, November 16, 2026

Status: current database and public projection reads are healthy. The managed
exporter correction is still unconfirmed. This does not close representative
resource/cost acceptance or the public tester cohort.

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

Remaining operational acceptance is a provider-confirmed collector-only fix,
one bounded post-fix check, and representative IO/egress and billing evidence.
Hosted Redis/NFT consumers remain separate, optional activation gates; no new
service purchase is required by this recheck. Actual tester/operator/support
coverage is a separate Phase B requirement, not something these counters prove.

Related records: [exporter attribution](B30_EXPORTER_TEMP_FILES_2026-11-09.md),
[independent recovery and Core cutover](B35_INDEPENDENT_RECOVERY_AND_CORE_CUTOVER_2026-11-09.md).
