# A9 Infrastructure Cost and Health Monitoring

This runbook covers the Phase A cost-and-health evidence required by canonical item A9. It does not change RPC routing, database behavior, contracts, wallet behavior, or the deployed indexer by itself.

## Current platform constraints

- Keep the Supabase Spend Cap enabled. Supabase documents that Spend Cap blocks covered overages, but it does not provide fine-grained budget thresholds or threshold notifications. Review organization usage and the upcoming invoice manually: <https://supabase.com/docs/guides/platform/cost-control>.
- Alchemy dashboard usage and error-rate alerts are not available on the Free tier. Do not claim that an Alchemy alert is configured while the project remains on that tier: <https://www.alchemy.com/docs/dashboard-alerts>.
- Keep Alchemy Auto-Scale disabled unless a funded operating decision explicitly approves overages. Account-level usage limits are documented at <https://www.alchemy.com/docs/how-to-set-usage-limits-and-alerts-for-your-account>.
- Do not add a paid monitoring service only to close A9. Until the project has funded monitoring, the safe acceptance path is hard spend controls, a tested local health check, and a named manual review schedule.

## Repository health check

The checker reads the existing indexer `/health` response and exits non-zero when any accepted invariant fails:

- overall and database health are healthy;
- chain ID is Base Sepolia `84532`;
- confirmation depth is `3` and has no synchronization error;
- there are zero unresolved indexer errors;
- block lag is below `20` and `isSynced` is true;
- RPC errors in the last minute do not exceed `5`;
- the response timestamp is no more than two minutes old.

Run on the Hetzner host from the deployed repository:

```bash
cd /opt/artsoul
npm run --silent monitor:indexer
echo $?
```

Successful output is one JSON line with `"ok":true` and exit code `0`. Failure output contains stable failure codes and exit code `1`. The output intentionally omits the configured endpoint URL so credentials cannot be copied into logs if an operator overrides it incorrectly.

The indexer uses `INDEXER_HEALTH_MAX_BLOCKS_BEHIND=20`; normally keep that production default. The standalone checker also supports these explicit overrides for a non-production rehearsal:

```text
ARTSOUL_INDEXER_HEALTH_URL
ARTSOUL_MONITOR_EXPECTED_CHAIN_ID
ARTSOUL_MONITOR_EXPECTED_CONFIRMATION_DEPTH
ARTSOUL_MONITOR_MAX_BLOCKS_BEHIND
ARTSOUL_MONITOR_MAX_RPC_ERRORS_PER_MINUTE
ARTSOUL_MONITOR_MAX_RESPONSE_AGE_MS
ARTSOUL_MONITOR_REQUEST_TIMEOUT_MS
```

Production values remain Base Sepolia, depth `3`, lag below `20`, at most `5` RPC errors per minute, response age at most `120000` ms, and request timeout `10000` ms. The lag boundary allows one normal 15-second polling interval on Base plus confirmation depth and a small scheduling margin. The indexer and standalone checker share the same default. Do not weaken a threshold merely to make a sustained failing check green.

The `/health` handler observes the current block. Do not poll this command more often than once every five minutes; excessive health polling becomes an RPC consumer itself.

## Manual review schedule

Until native threshold alerts are available, the founder or named operator performs this review every Tuesday and Friday and after any indexer/RPC/database deployment:

1. Run `npm run --silent monitor:indexer` on Hetzner.
2. Run `pm2 status` and confirm `artsoul-base-sepolia` is online while the retired Ethereum Sepolia process remains stopped.
3. Run `pm2 logs artsoul-base-sepolia --lines 80 --nostream` and inspect new errors only.
4. In Alchemy, record current billing-cycle Compute Units, forecast, hard limit, success rate, and top methods. Investigate a renewed sustained rise in `eth_blockNumber`, `eth_getLogs`, or `eth_getBlockByNumber`.
5. In Supabase organization usage, record egress, database size, storage size, and upcoming invoice. Confirm Spend Cap remains enabled.
6. Append the evidence to the table below without API keys, service-role keys, access tokens, endpoint credentials, email addresses, or wallet secrets.

## Seven-day evidence

A9 is not complete merely because the checker and this runbook exist. Record at least seven consecutive post-RPC-diet days before accepting the cost portion.

| UTC date | Indexer check | Alchemy CU used / limit | Alchemy forecast | Top RPC methods | Supabase egress | Spend Cap | Operator / notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Pending | Pending | Pending | Pending | Pending | Pending | Must remain enabled | Start after this runbook is deployed |

Acceptance requires:

- at least seven consecutive days recorded;
- no unexplained automated upward trend;
- the month-end Alchemy forecast remains inside the hard free-tier limit with operational headroom;
- Supabase stays inside the funded plan and Spend Cap remains enabled;
- every failed health check has a linked incident note and resolution;
- optional `failed_events` handling is resolved under backlog item A-15: the table
  is retired, `event_processing_registry` is the single source of truth for
  event-processing failures, and `/health` reports them (see below).

## Incident response

| Signal | First response | Escalation |
| --- | --- | --- |
| `CHAIN_ID` or `CONFIRMATION_DEPTH` | Stop deployment work; compare loaded environment with the production runbook. | Do not reset cursors. Restore the last verified environment and restart only the Base Sepolia PM2 process. |
| `BLOCK_LAG` or `SYNC_STATE` | Check public Base Sepolia RPC health, fallback logs, PM2 status, and database health. | If the cursor stops advancing, preserve logs and the current cursor before restart. |
| `RPC_ERRORS` or Alchemy forecast spike | Look for repeated fallback use and newly introduced polling. | Disable the new consumer or revert its deployment; never raise polling frequency as the first response. |
| Supabase usage spike | Inspect top egress consumers, cache hit behavior, and recent deployments. | Keep Spend Cap enabled; revert the new uncached consumer before considering a plan change. |
| `UNRESOLVED_ERRORS` or database failure | Preserve the health JSON and recent PM2/database logs. Non-zero `unresolvedErrors` with a non-zero `eventFailures` breakdown means at least one event was scanned but never applied, and the cursor is intentionally stalled. | Treat as a production incident; do not mark A9 evidence green for that interval. |
| Cursor stalled with `eventFailures.dead` above zero | A poisoned event exhausted the retry policy. Capture the offending `transaction_hash`/`log_index` and `processing_error` from `event_processing_registry` before any change. | Fix the handler defect and redeploy; the range is retried automatically. Never clear the row or advance the cursor to "unstick" the indexer - that reintroduces the silent-skip defect A-15 fixed. |

## Event-failure model (A-15)

The indexer fails closed on event-processing errors. There is no `failed_events`
table and none is required; creating one is not a remediation step.

- `event_processing_registry` is the single source of truth for event-processing
  failures, scoped by `chain_id` + `transaction_hash` + `log_index`.
- A handler failure rolls its transaction back and is then recorded by an UPSERT
  on a separate connection, so the failure survives the rollback. `retry_count`
  is monotonic and a `completed` record is never downgraded.
- A range containing any unprocessed event does not advance
  `last_indexed_block`, `last_confirmed_block`, `state_hash` or
  `total_events_indexed`. The next poll re-queries the identical range;
  already-completed events are skipped idempotently.
- Confirmation is clamped to `last_indexed_block`, so a stalled range can never
  be marked reorg-safe.
- After the existing policy of five retries the record becomes `dead`. It keeps
  the cursor stalled and `/health` degraded on purpose: a persistently bad event
  must be visible, never silently skipped.
- `/health` `indexer.unresolvedErrors` counts active-chain `failed`/`dead`
  registry rows (plus any legacy `indexer_errors` rows) and forces
  `status: degraded`. The additive `indexer.eventFailures` object breaks it down.
  Both come from one chain-scoped `GROUP BY` aggregate, never a row scan, so a
  large failure backlog cannot inflate the health response or its cost.
- Prometheus exposes `indexer_unresolved_event_failures{status="failed"|"dead"}`
  from the same registry source. The old `indexer_failed_events_queue_size`
  gauge is removed; it reported a constant zero for a table that never existed.
- The gauge is refreshed on events, never polled: once at indexer startup, and
  then only after a range that applied events or failed closed. An idle indexer
  performs zero recurring failure-registry queries, which keeps this feature
  inside the A9 query budget.

Operator check (`jq` is not installed on the server, so read the raw JSON or
parse it with Node). The Prometheus endpoint requires the exact Authorization
header stored in the PM2 process environment; do not print that value:

```bash
curl -s localhost:3001/health
curl -s localhost:3001/health | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const h=JSON.parse(d);console.log(h.status, h.indexer.unresolvedErrors, JSON.stringify(h.indexer.eventFailures), h.indexer.lastIndexedBlock, h.indexer.lastConfirmedBlock);})"

PID=$(pm2 pid artsoul-base-sepolia)
METRICS_AUTH_VALUE=$(tr '\0' '\n' < "/proc/$PID/environ" | sed -n 's/^METRICS_AUTH=//p')
if [ -z "$METRICS_AUTH_VALUE" ]; then
  echo "WARNING: METRICS_AUTH is unset; using the legacy local-only fallback until A-42 is complete." >&2
  METRICS_AUTH_VALUE="Basic $(printf 'admin:changeme' | base64 -w0)"
fi
curl -fsS -H "Authorization: $METRICS_AUTH_VALUE" localhost:3001/metrics | grep indexer_unresolved_event_failures
unset METRICS_AUTH_VALUE
```

### Production acceptance evidence (2026-07-22)

PR #136 was deployed to the Hetzner Base Sepolia indexer at merge commit
`32b2d49`. PM2 remained online and resumed from the existing cursor. The
post-restart `/health` response was `healthy` with confirmation depth 3,
`lastIndexedBlock=44468365`, `currentBlock=44468369`, four blocks of lag, zero
unresolved errors, and `eventFailures={failed:0,dead:0}`. The authenticated
Prometheus endpoint independently exposed both
`indexer_unresolved_event_failures` gauges at zero. This accepts A-15; it does
not by itself complete the separate seven-day A9 cost-observation requirement.

Per-row detail is deliberately NOT in the health response. When the counts are
non-zero, get the offending events with the operator query:

```bash
psql "$DATABASE_URL" -c "SELECT transaction_hash, log_index, event_name, block_number, retry_count, processing_status, processing_error FROM event_processing_registry WHERE chain_id = 84532 AND processing_status IN ('failed','dead') ORDER BY block_number, log_index LIMIT 50;"
```

## In-process alerting decision

Backlog item A-40 removed the dormant `ALERT_WEBHOOK` and `_checkAlerts()` path. It was never invoked, used thresholds that did not match the 15-second Base Sepolia polling policy, and therefore could not serve as production alerting evidence. Do not restore it without a separately approved, funded delivery channel and a tested alert policy.

The local health checker remains the no-cost operational path. Its RPC error value now comes from the event listener's maintained rolling 60-second windows, while RPC latency is the highest observed moving average across configured endpoints. The unused block/event throughput placeholders were removed from `/health` instead of continuing to report false zeroes.

After merging the focused A-40 change, deploy it with the standard indexer pull, install, build, and PM2 restart procedure. Acceptance requires all of the following after restart:

```bash
npm run --silent monitor:indexer
curl -s http://127.0.0.1:3001/health
pm2 status
```

The monitor must return `"ok":true`, PM2 must keep `artsoul-base-sepolia` online, and `/health.metrics` must contain numeric `rpcLatencyMs` and `rpcErrorsLastMinute` values without the removed `blocksPerSecond` or `eventsPerSecond` placeholders. No `ALERT_WEBHOOK` setting is required; a leftover setting is ignored and may be removed from the operator-managed environment after the new process is verified.
