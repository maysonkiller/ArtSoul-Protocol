# Self-hosted ordinary auction keeper

ArtSoul can run this process on its existing indexer host under a separate OS account. The confirmed-event schedule lives in its own SQLite file on that host. The process requires Node 22.13 or later, the project's existing dependencies, and a Base RPC with historical code and log access. Public observation requires no wallet. The service is opt-in and works with the new immutable ordinary-auction engine.

| Chain and mode | Behavior |
| --- | --- |
| Base mainnet or Base Sepolia, default | Reads confirmed events, checks the current on-chain action and returns unsigned zero-value calls. |
| Local Hardhat, `--local-execute` | Rehearses actual calls with a designated disposable local signer on an unforked chain. |
| Base Sepolia, `--testnet-execute` | Uses a separately funded test operator, an encrypted keystore and a durable transaction journal. Requires the new treasury-bound engine. |

## What the keeper pays for

| Recorded state | Service action |
| --- | --- |
| Auction expires without a bid | No transaction. The contract immediately shows the work as available and the creator can close the old round when relisting. |
| Bidding ends with a winner | Send `closeAuction` to open a full 24 hours from the closing block. |
| Winner misses the payment deadline | Send `finalizeDefault` strictly after the deadline. The contract applies the deposit split and determines whether a runner-up receives an offer. |
| Runner-up neither accepts nor declines | Send `expireRunnerUpOffer` after the full offer window. A creator's simultaneous relist can perform this step itself. |

The process replays events from the creation block and checks `dueAuctionAction` at the current head before acting. Settlements, timely payments and accepted extensions take precedence. Each turn submits at most one new transaction. During an outage users can still use the permissionless contract paths. After restart the worker resumes from its checkpoint. A bid first seen close to expiry can be picked up after its block finalizes. A busy or fee-limited operator can also delay a close. The payment window still begins at the actual closing block.

## Start in observation mode

Prepare a private deployment JSON with numeric `chainId`, the reviewed engine address in `engine`, the Keccak-256 of the deployed runtime including immutable addresses in `codeHash`, and its exact creation block number in `startBlock`. The CLI checks the code at that block and the preceding block. Keep the SQLite file on persistent local storage with one service instance per deployment. Set `ARTSOUL_KEEPER_RPC_URL` in the process environment. The public RPC must use HTTPS.

```sh
npm run keeper:auctions -- --config /private/engine.json --state /private/keeper.sqlite --once
```

Omit `--once` for continuous operation. An idle cycle runs once a minute. If an RPC limits the size of a log query, set `logBlockRange` in the manifest (1–5000 blocks, default 1000). `rangesPerCycle` controls the catch-up batch (1–10 ranges, default 2). A changed checkpoint hash stops action selection. Verify the RPC and deployment first. If a rebuild is required, start a new discovery file at the reviewed origin and preserve the transaction journal.

## Execution rehearsal

For the isolated local chain, set `chainId` to 31337, supply a loopback IP endpoint and set `operator` to an unlocked disposable Hardhat account. Append `--local-execute`. The normal contract tests also run a full expiry, default and offer lifecycle with two bidders.

For a separately authorized Base Sepolia rehearsal, the manifest also needs the dedicated operator address, `gasLimit`, `maxFeePerGasWei` and `maxDailyAttempts`. Use decimal strings for wei amounts. Fund only that separate test account with the agreed test ETH. Supply a current copy of the mainnet public custody fields using `--custody`. It needs only `chainId` 8453 and the `address` and `owners` of each of the three roles listed in the [custody register](../RESOURCE_GATED_WORK.md#verifying-a-deployed-account). The startup check rejects a listed owner or Safe as the test operator. Provide paths to the dedicated operator's encrypted keystore and protected password file via `ARTSOUL_KEEPER_KEYSTORE_FILE` and `ARTSOUL_KEEPER_PASSWORD_FILE`. Restrict access to the service account. Keep the journal across restarts and discovery rebuilds. Treat signed journal contents as sensitive until confirmed.

```sh
npm run keeper:auctions -- --config /private/engine.json --state /private/keeper.sqlite --outbox /private/keeper-outbox.sqlite --custody /private/mainnet-safe-owners.json --testnet-execute
```

The operator has no reason to hold user assets, control Safe signers, or replenish itself from a treasury. Ethereum execution gas limits do not cap the complete Base network fee, which includes L1 data costs. Monitor actual receipt costs and the gas wallet balance. Mainnet execution still requires a reviewed release, a testnet rehearsal and a separately approved operating budget. [Base network fees](https://docs.base.org/specifications/transactions/network-fees)

## Verification

The [Hardhat lifecycle tests](../../test/OrdinaryAuctionKeeper.test.cjs) exercise deadline extensions, ordinary winner settlement during a preview, pause and runner-up expiry. The [discovery tests](../../test/auction-keeper-discovery.test.mjs) cover restart and checkpoint integrity. The [test signer tests](../../test/auction-keeper-testnet.test.mjs) cover irreversible state changes, account separation, fee limits, daily reservations and ambiguous submissions.

On November 19 the normal npm testnet command was also exercised on a local chain configured with ID 84532, a treasury-bound fixture, three synthetic custody accounts, local HTTPS and a throwaway encrypted keystore. Across five process launches two funded auctions closed with exactly two zero-value transactions. The RPC response for the second send was deliberately withheld after acceptance. A fresh process found that receipt from its journal and the next cycle produced no further call. This rehearsal used local ETH. C13 still needs public Base Sepolia receipt and operating-cost evidence.
