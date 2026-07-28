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
curl -fsS 'https://artsoul.vercel.app/api/public/artworks?limit=1'
```

The response must contain a non-null `public_metrics` object with chain ID
`84532`. Open the homepage in desktop and mobile widths and confirm the four
values render without horizontal overflow. Only then run:

```bash
pm2 save
```

## Rollback

If the database acceptance fails, do not restart the updated indexer. Preserve
the SQL result and stop the rollout for diagnosis.

If code acceptance fails after restart, redeploy the last accepted code commit
and restart only `artsoul-base-sepolia`. The new metric tables may remain
dormant; do not drop them during an incident. Dropping them would destroy
diagnostic evidence and is not required to restore the prior application.
