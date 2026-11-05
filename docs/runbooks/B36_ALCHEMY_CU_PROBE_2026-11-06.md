# B36 — Alchemy free-tier CU live-probe runbook (November 6, 2026)

**Scope:** Source-only. This document and the one-shot script do not enable Portfolio for all users, set Vercel environment flags, send secrets, change contracts/worker/database, subscribe to paid services, or perform live requests on merge.

## Confirmed public method weights

- Portfolio NFTs By Wallet: **1000 CU** per documented method entry.
- Portfolio Tokens By Wallet with metadata/prices: **360 CU**.
- Original Alchemy NFT v3 getNFTsForOwner: **480 CU**.
- Portfolio token balances only: **200 CU**.
- Free account: **30,000,000 CU/month shared between applications**. Account throughput also aggregates across apps.
- The multi-network charge/fan-out and whether additional settings are needed for Robinhood/Soneium must be checked using an actual per-network read and the account's method breakdown; Chain RPC support is not Portfolio eligibility.

Pricing / API docs:
- https://www.alchemy.com/docs/reference/compute-unit-costs
- https://www.alchemy.com/docs/data/portfolio-apis/portfolio-api-endpoints/portfolio-api-endpoints/get-nfts-by-address
- https://www.alchemy.com/docs/reference/admin-api/overview
- https://www.alchemy.com/docs/admin-api/usage/get-usage-summary

## Before executing

1. Verify Alchemy Dashboard **Free** and no payment method / paid plan. Never submit a card or upgrade to satisfy a request.
2. Verify which **team/account** owns the existing ArtSoul NFT API key; legacy protocol RPC app usage in a separate team is *not* measured by this key's admin account summary. Do not assume new apps or keys expand an account quota.
3. Under Alchemy Dashboard **Settings → Usage**, inspect usage and per-app CU limit options. Set a small enforceable limit if supported for the actual Free team. Record the current consumed/remaining CU before sending any probe.
4. Obtain a *read-only* Alchemy Admin API **Usage read** access key, stored locally as `ALCHEMY_ADMIN_USAGE_READ_KEY`. This is **not** the Portfolio/NFT application API key. The latter stays in the existing protected server secret `ARTSOUL_EXTERNAL_BASE_NFTS_ALCHEMY_API_KEY`.
5. Never paste API keys, session tokens, access keys, payment data, Vercel secrets or .env files into GitHub/chat/logs.

## Exact one-shot probe

The CLI defaults to no requests. Each `--probe` invocation makes one and only one Portfolio call (plus at most two read-only Admin usage queries). No loop/retry, "all networks", auto-refresh or pagination.

Use the local protected environment, not command-line secret flags.

```bash
node scripts/b36-alchemy-usage-probe.mjs --dry-run --network=base-mainnet --nfts
# If read-only Admin Usage key is configured:
node scripts/b36-alchemy-usage-probe.mjs --usage
# Only after verifying Free/no-card, >100K remaining, and setting:
# ARTSOUL_PROBE_FREE_NO_BILLING_CONFIRMED=YES
# ARTSOUL_PROBE_ONE_REQUEST_ACK=YES
# ARTSOUL_PROBE_WALLET=(current verified wallet 0x...)
# ARTSOUL_EXTERNAL_BASE_NFTS_ALCHEMY_API_KEY=(existing dedicated protected key)
node scripts/b36-alchemy-usage-probe.mjs --probe --network=base-mainnet --nfts
# For separate token test (optional second controlled invocation):
node scripts/b36-alchemy-usage-probe.mjs --probe --network=base-mainnet --tokens
# After dashboard usage freshness advances, check again with no Portfolio calls:
node scripts/b36-alchemy-usage-probe.mjs --usage
```

- Only **one network** per probe; make the initial request on Base Mainnet, then Ethereum individually. Robinhood / Soneium only after verifying Portfolio endpoint availability for that specific Alchemy app.
- The script logs only network/method, response status, number of items, partial network codes, expected method CU, account headroom and usage freshness; never logs the full wallet or API keys. Actual account CU delta can include ongoing indexer/RPC traffic and cannot be attributed to one call unless usage timing/method isolation confirms it.
- Admin usage has minute-level update cadence. If the before/after values show the same `freshness.dataThrough`, the script intentionally reports an **unverified** delta and tells you to repeat `--usage` later.
- Production B36 remains **disabled** (`ARTSOUL_MULTICHAIN_ASSETS_ENABLED=false`) until these results, account-wide consumption and current hosted feature-gate control are reviewed.
- To activate later, a connected **Vercel** environment-control integration or authorized account operator must change the *server-only* feature flag and deploy it, then verify public config and signed-in reads on the real production domain. Do not modify source to bypass the feature flag. Do not enable all 15 networks at once without per-network support and cumulative cost evidence.

## Rollback

The first rollback lever is `ARTSOUL_MULTICHAIN_ASSETS_ENABLED=false` on the active Vercel environment, with a normal deployment and verification that Base-only inventory remains functional. Source-only changes can be reverted with a single GitHub revert if needed. Neither route touches auction signing, payout economics or new mainnet deployments.
