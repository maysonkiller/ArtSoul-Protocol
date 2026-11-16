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

The existing support conversation was re-read. It contains the November 9
receipt and the AI agent's escalation for human review of managed exporter
queries/session behavior. No later reply or completed correction appears in
that thread. A concise follow-up was prepared separately; this check sent no
message and granted no new project-data access.

The connector can verify the organization plan but does not expose current
Spend Cap, bill estimates, egress or Disk IO budget. The last dashboard cost
observation remains November 9: existing Pro plan, displayed current/projected
cost of USD 25, Spend Cap enabled and no displayed usage overage. Those values
must not be relabeled as today's billing measurements or a zero-cost guarantee.

Remaining operational acceptance is a provider-confirmed collector-only fix,
one bounded post-fix check, and representative IO/egress and billing evidence.
Hosted Redis/NFT consumers remain separate, optional activation gates; no new
service purchase is required by this recheck. Actual tester/operator/support
coverage is a separate Phase B requirement, not something these counters prove.

Related records: [exporter attribution](B30_EXPORTER_TEMP_FILES_2026-11-09.md),
[independent recovery and Core cutover](B35_INDEPENDENT_RECOVERY_AND_CORE_CUTOVER_2026-11-09.md).
