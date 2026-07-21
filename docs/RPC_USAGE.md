# RPC Usage and Compute Budget

## Scope

This document records the Base Sepolia RPC inventory and the July 2026 compute-unit reduction. The change is infrastructure-only. It does not alter transaction submission, contract behavior, auction state, settlement, minting, or Supabase projection ownership.

ArtSoul uses the Base public endpoint for high-volume indexer reads and keeps the configured provider endpoint as a fallback. Browser writes still use the connected wallet and the shared Base Sepolia write guard.

## Compute-unit assumptions

The estimates below use Alchemy's published Ethereum JSON-RPC weights:

| Method | Compute units per request |
| --- | ---: |
| `eth_chainId` | 0 |
| `eth_blockNumber` | 10 |
| `eth_getBlockByNumber` | 20 |
| `eth_getLogs` | 60 |
| `eth_call` | 26 |

References:

- [Alchemy compute units](https://www.alchemy.com/docs/reference/compute-units)
- [Alchemy compute-unit costs](https://www.alchemy.com/docs/reference/compute-unit-costs)

Daily estimates assume the production defaults of a 15-second indexer poll, a roughly 2-second Base block time, and a 10-block log range. Actual consumption varies with RPC availability, catch-up distance, health checks, and event volume.

## RPC inventory before the diet

| Caller | RPC method | Trigger and frequency | Estimated Alchemy CU/day before |
| --- | --- | --- | ---: |
| `src/indexer/production-runner.js` metrics loop | `eth_blockNumber` | Every 5 seconds, including while the process was not the elected leader | 172,800 |
| Indexer catch-up and confirmation | `eth_blockNumber` | Two or three reads per 15-second poll because the same observed height was not reused | 115,200 to 172,800 |
| `src/indexer/event-listener.js` incremental ingestion | `eth_getLogs` | One request per 15-second poll in steady state; more only during catch-up | About 345,600 |
| `src/indexer/sync-engine.js` block-hash storage | `eth_getBlockByNumber` | One read for every newly indexed block, about seven or eight reads per poll | About 864,000 |
| Two independent reorg scanners | `eth_getBlockByNumber` | One scanner could read up to 256 stored blocks and another up to 100 on every poll | Highly data-dependent; theoretical maximum was far above the free-tier budget |
| Health endpoint | `eth_blockNumber` | Only when `/health` is requested | Negligible unless externally polled too often |
| Startup and manual recovery | `eth_blockNumber`, `eth_getLogs`, `eth_getBlockByNumber` | Process start, rebuild, or catch-up only | Variable |
| Public API routes | None | Public artwork and auction reads use Supabase projections and the existing 30-second cache | 0 |
| Homepage, gallery, and guest profile | None | Projection APIs only | 0 |
| Connected artwork/profile reads | `eth_call`, `eth_chainId`, balance reads | Through the user's wallet provider, only on connected pages or explicit actions | 0 ArtSoul Alchemy CU |
| Dormant legacy RPC client | None in production | No configured provider and no production entry point | 0 |

The Alchemy dashboard showed about 19.9 million CUs over 13 days, or about 1.53 million CUs per day. That observed rate closely matches the steady automated indexer reads above and would project to roughly 46 million CUs per 30-day month without intervention.

`eth_getLogs` was already incremental: the indexer starts at `last_indexed_block + 1` and never intentionally rescans the full chain during normal polling. No receipt-refetch loop exists in the production indexer.

## Diet changes

| Caller | Before | Now | Estimated Alchemy saving in normal operation |
| --- | --- | --- | ---: |
| Event ingestion | Configured paid RPC handled every `eth_getLogs` request | `https://sepolia.base.org` is primary; configured endpoints are ordered fallbacks | About 345,600 CU/day |
| Block height and block hashes | Paid RPC handled all high-volume reads | Public Base RPC is primary with a 60-second endpoint cooldown and paid fallback | About 1.0 million CU/day |
| Metrics loop | Independent `eth_blockNumber` every 5 seconds | Reuses the most recent 15-second polling observation and performs no RPC call | 172,800 CU/day |
| Poll confirmation | Re-read the current height during catch-up, sync confirmation, and confirmation processing | One observed height is passed through the full poll | 57,600 to 115,200 CU/day |
| Reorg detection | Two scanners, one up to 256 blocks and one up to 100 blocks, every 15 seconds | One sync-engine scanner, last 12 stored blocks, once per 60 seconds | Large and data-dependent |
| RPC failover | Failed endpoint could stay selected after recovery | Public primary is re-probed after fallback cooldown | Prevents paid fallback from becoming permanent |

With a healthy public Base endpoint, normal Alchemy compute should be close to zero and limited to fallback periods, manual recovery, and explicitly configured monitoring. A conservative operational target is below 3 million CUs per month, under 10% of the 30 million free tier and well below the requested 30% ceiling.

## Configuration

The indexer remains Base Sepolia-only. Use an ordered comma-separated fallback list without committing credentials:

```dotenv
ARTSOUL_INDEXER_CHAINS=base-sepolia
ARTSOUL_INDEXER_CHAIN=base-sepolia
ARTSOUL_INDEXER_CHAIN_ID=84532

# The code always prepends https://sepolia.base.org.
# Keep the current private Alchemy URL as the fallback value.
BASE_SEPOLIA_RPC_URLS=<CURRENT_PRIVATE_ALCHEMY_URL>

INDEXER_POLL_INTERVAL=15000
INDEXER_CONFIRMATION_DEPTH=3
INDEXER_MAX_BLOCK_RANGE=10
INDEXER_REORG_CHECK_INTERVAL=60000
INDEXER_REORG_SAMPLE_SIZE=12
ARTSOUL_SKIP_EMPTY_BLOCK_HASH_BACKFILL=true
INDEXER_HEALTH_PORT=3001
```

`BASE_SEPOLIA_RPC_URL` remains supported for compatibility. `BASE_SEPOLIA_RPC_URLS` is preferred because it documents that the configured values form a fallback list. Ethereum Sepolia configuration remains available for legacy read-only data, but it is not part of the active production indexer process.

## Failure and safety behavior

- A public-RPC read has a five-second timeout. Failure cools that endpoint for 60 seconds and immediately tries the next configured endpoint.
- Event-log ingestion uses health-scored failover. After paid fallback is selected, the public primary is re-probed every five minutes.
- The last processed block remains the incremental checkpoint. An RPC failure cannot reset it or cause a normal full-chain rescan.
- Log range remains capped at 10 blocks for free-provider compatibility.
- Reorg verification remains active, but it is bounded to recent stored hashes and has one owner.
- No write transaction is routed through this RPC list.

## Hetzner rollout

The pull request prepares the indexer changes but does not deploy them. After merge, the founder should run the following on the indexer host. The repository does not contain the server's systemd unit name, so the first commands discover and verify it rather than guessing.

```bash
ssh <HETZNER_USER>@<HETZNER_HOST>
cd <ARTSOUL_REPOSITORY_PATH>

git fetch origin
git checkout main
git pull --ff-only origin main

systemctl list-unit-files --type=service | grep -Ei 'artsoul|indexer'
systemctl cat <INDEXER_SERVICE_NAME>

sudoedit <ARTSOUL_ENV_FILE>
```

Apply the environment values from the configuration section. Keep the existing private fallback URL in the server environment and never paste it into Git, chat, shell history, or logs. Then validate and restart:

```bash
npm ci
npm run build
node --check src/indexer/chain-config.js
node --check src/indexer/event-listener.js
node --check src/indexer/sync-engine.js
node --check src/indexer/production-runner.js
node --test test/rpc-diet.test.cjs

sudo systemctl restart <INDEXER_SERVICE_NAME>
sudo systemctl status <INDEXER_SERVICE_NAME> --no-pager
sudo journalctl -u <INDEXER_SERVICE_NAME> -n 200 --no-pager
curl -fsS http://127.0.0.1:3001/health
```

Do not restart any service until `systemctl cat` confirms that it is the ArtSoul Base Sepolia indexer and identifies the environment file it actually reads.

## Post-deploy monitoring

1. Confirm logs list `https://sepolia.base.org/...` as RPC endpoint `[0]` and the private fallback only as a redacted host.
2. Confirm indexer lag remains below the normal confirmation window and new events appear in projections.
3. Check Alchemy after one hour and after 24 hours. `eth_getLogs`, `eth_blockNumber`, and `eth_getBlockByNumber` should drop sharply.
4. Investigate repeated `trying fallback` or `Re-probing primary RPC` logs before raising the poll frequency.
5. Follow [`runbooks/A9_INFRA_COST_MONITORING.md`](runbooks/A9_INFRA_COST_MONITORING.md). Alchemy dashboard alerts are unavailable on the Free tier, so keep the hard usage control in place and record the twice-weekly manual review until funded/native alerting is available. A renewed steady climb indicates another automated consumer or a public-RPC outage.
