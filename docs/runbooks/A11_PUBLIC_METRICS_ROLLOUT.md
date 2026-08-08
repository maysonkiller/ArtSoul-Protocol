# A11 Public Metrics Rollout

This runbook activates the Base Sepolia public-metrics projection introduced by
indexer migration `015_public_metrics_projection.sql`. It does not change
contracts, economics, auction behavior, or the publish-to-mint lifecycle.

## What the metrics mean

- **Artists onboarded:** distinct creator addresses from indexed
  `ArtworkRegistered` events on Base Sepolia.
- **Auctions completed:** terminal auction outcomes: successful settlement,
  settlement default, or an ended auction with no bids. An auction waiting for
  settlement is not complete.
- **Unique collectors:** distinct winners of successful primary settlements
  plus buyers in completed resales. Bidders are not counted as collectors.
- **Settled volume:** successful primary settlement value plus completed resale
  value. Bids, default penalties, uncompleted auctions, and listing prices are
  excluded.

The indexer records one idempotent metric row per contributing contract event.
Database triggers update one aggregate row per chain. Metric events reference
`contract_events` with `ON DELETE CASCADE`, so the existing chain-scoped reorg
rollback also reverses the aggregate. The public API reads only the Base Sepolia
aggregate row inside the existing 30-second projection cache and CDN cache.

## Safe rollout order

1. Confirm the PR CI is green and merge it.
2. Confirm a current Supabase backup exists. Migration 015 creates new tables
   and backfills them from existing V4.1 projections; it does not alter existing
   lifecycle rows.
3. Keep the existing Hetzner indexer running while the repository is pulled.
   The old process does not call the new database function.
4. Apply **only**
   `src/indexer/migrations/015_public_metrics_projection.sql` to production
   Supabase. Use the exact merged file. Do not edit migrations 001-014 and do
   not run `npm audit fix --force`.
5. Run the read-only database acceptance queries below.
6. Update `/opt/artsoul` to the accepted merge commit, install/build, restart
   only `artsoul-base-sepolia`, and verify health.
7. Verify the public API and homepage. Save the PM2 state only after all
   acceptance checks pass.

The API degrades to unavailable metrics if the table is absent, but the updated
indexer intentionally fails closed if its metric-recording function is absent.
For that reason, migration 015 must be applied before the Hetzner restart.

## Read-only database acceptance

Run in Supabase SQL Editor after migration 015:

```sql
SELECT
    chain_id,
    artists_onboarded,
    auctions_completed,
    unique_collectors,
    settled_volume_wei,
    last_updated_block,
    updated_at
FROM public.v41_public_metrics
WHERE chain_id = 84532;
```

Cross-check the precomputed row once with this operator-only query. This query
must never be moved into a runtime page or API path:

```sql
WITH expected AS (
    SELECT
        (
            SELECT COUNT(DISTINCT LOWER(creator))
            FROM public.v41_artworks
            WHERE chain_id = 84532
        ) AS artists_onboarded,
        (
            SELECT COUNT(*)
            FROM public.v41_settlements
            WHERE chain_id = 84532
              AND settlement_status IN ('completed', 'defaulted')
        ) + (
            SELECT COUNT(*)
            FROM public.v41_auction_endings
            WHERE chain_id = 84532
              AND (
                  winner IS NULL
                  OR LOWER(winner) = '0x0000000000000000000000000000000000000000'
              )
        ) AS auctions_completed,
        (
            SELECT COUNT(DISTINCT collector)
            FROM (
                SELECT LOWER(winner) AS collector
                FROM public.v41_settlements
                WHERE chain_id = 84532
                  AND settlement_status = 'completed'
                  AND winner IS NOT NULL
                UNION
                SELECT LOWER(buyer) AS collector
                FROM public.v41_resale_history
                WHERE chain_id = 84532
            ) collectors
        ) AS unique_collectors,
        (
            SELECT COALESCE(SUM(final_price), 0)
            FROM public.v41_settlements
            WHERE chain_id = 84532
              AND settlement_status = 'completed'
        ) + (
            SELECT COALESCE(SUM(price), 0)
            FROM public.v41_resale_history
            WHERE chain_id = 84532
        ) AS settled_volume_wei
)
SELECT
    metrics.artists_onboarded = expected.artists_onboarded AS artists_match,
    metrics.auctions_completed = expected.auctions_completed AS auctions_match,
    metrics.unique_collectors = expected.unique_collectors AS collectors_match,
    metrics.settled_volume_wei = expected.settled_volume_wei AS volume_matches
FROM public.v41_public_metrics metrics
CROSS JOIN expected
WHERE metrics.chain_id = 84532;
```

Acceptance requires one row with all four comparison values `true`.

## Hetzner deployment and acceptance

Run after the database checks pass:

```bash
cd /opt/artsoul
set -e

git status --short
git pull --ff-only origin main
npm ci
npm run build

pm2 restart artsoul-base-sepolia --update-env

npm run --silent monitor:indexer
curl -fsS http://127.0.0.1:3001/health
pm2 status
```

Confirm:

- the Base Sepolia process is online and Ethereum Sepolia remains stopped;
- health is `healthy`, chain ID is `84532`, confirmation depth is `3`, and
  unresolved errors are zero;
- the cursor continues advancing after at least one poll interval;
- no `record_v41_public_metric_event` or migration error appears in recent PM2
  logs.

Then check the public list response without copying credentials:

```bash
curl -fsS 'https://artsoulprotocol.com/api/public/artworks?limit=1'
```

The response must contain a non-null `public_metrics` object with chain ID
`84532`. Open the homepage in desktop and mobile widths and confirm the four
values render without horizontal overflow. Only then run:

```bash
pm2 save
```

## Production acceptance evidence — 2026-07-28

A11 was accepted against the production Base Sepolia stack after PR #160 merged
as commit `8f7a9d232d86a4f5d50f595aecba88e684f5d6c3`.

### Repository, backup, and migration

- The post-merge GitHub Actions run `30383058540` passed.
- Supabase physical backup `2026-07-28T02:49:50.202Z` was `COMPLETED`
  before the production change.
- The exact merged
  `src/indexer/migrations/015_public_metrics_projection.sql` file was applied
  with SHA-256
  `fc5f2157bce250679ea5bf69213a6e7caa110326e05406bd56a7359b0730c5a8`.
- Production does not currently contain
  `public.artsoul_schema_migrations`. No partial or invented migration-ledger
  entry was created; full baseline reconciliation remains a separate migration
  operations task.
- RLS and FORCE RLS were enabled on all three migration-015 tables.

The installed aggregate row for chain `84532` contained:

| Metric | Accepted value |
| --- | ---: |
| Artists onboarded | 3 |
| Auctions completed | 13 |
| Unique collectors | 3 |
| Settled volume | 13,100,000,000,000,000 wei |
| Last updated block | 44,387,549 |

The operator-only source cross-check returned `true` for artists, auctions,
collectors, and volume.

### Public API and homepage

- Vercel production deployment `5644476281` completed successfully.
- `/api/public/artworks?limit=1` returned chain `84532`, 3 artists, 13
  completed auctions, 3 unique collectors, `0.0131 ETH` settled volume, block
  `44387549`, and no projection warning.
- The production homepage rendered the same values with no console error.
- At `1280x900`, the metrics rendered in four columns and the steps in three
  columns. At `390x844`, metrics rendered as a `2x2` grid and steps as one
  column. Neither viewport had horizontal overflow.
- The production browser also reported the existing Tailwind CDN and unused
  Reown font-preload warnings. They do not invalidate A11 and are retained in
  backlog A-38 for a focused dependency/performance pass.
- The evidence PR CI passed on Windows and Ubuntu. Its only annotation was the
  existing GitHub Actions Node 20 deprecation warning for
  `actions/checkout@v4` and `actions/setup-node@v4`; A-38 retains that upgrade
  task.

### Hetzner indexer

- `/opt/artsoul` fast-forwarded to the accepted merge commit.
- `npm ci` completed and `npm run build` verified 10 HTML routes.
- `artsoul-base-sepolia` restarted online while `artsoul-eth-sepolia` remained
  stopped.
- `monitor:indexer` returned `ok=true`; `/health` reported chain `84532`,
  confirmation depth `3`, zero unresolved failures, and zero failed/dead event
  records.
- The indexed cursor advanced from block `44746178` to `44746185` during the
  acceptance interval.
- Recent logs contained no `record_v41_public_metric_event` or migration error.
- The public API returned the accepted aggregate, and the PM2 process list was
  saved only after every check passed.

This evidence closes canonical A11 and durable backlog A-24 through A-27. It
does not close A10 controlled-beta entry or A12 stale network copy.

## Rollback

If the database acceptance fails, do not restart the updated indexer. Preserve
the SQL result and stop the rollout for diagnosis.

If code acceptance fails after restart, redeploy the last accepted code commit
and restart only `artsoul-base-sepolia`. The new metric tables may remain
dormant; do not drop them during an incident. Dropping them would destroy
diagnostic evidence and is not required to restore the prior application.
