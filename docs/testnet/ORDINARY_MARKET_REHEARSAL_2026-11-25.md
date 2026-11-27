# Ordinary market deployment on Base Sepolia

The reviewed payer created the market in block 63,473,005 of chain 84532. Its constructor created the paired NFT contract. The deployment carried zero ETH and consumed 5,317,922 gas. L2 execution cost 31,907,532,000,000 wei and L1 data cost 8,959,036,829,157 wei, for a total of 0.000040866568829157 test ETH. [Deployment receipt](https://sepolia.basescan.org/tx/0xbbb61082d9140c6c359757250f784f8a2823ef575860bda6725e256de7d1b1d1)

| Contract | Address | Runtime Keccak-256 with immutable values bound |
| --- | --- | --- |
| OrdinaryMarket | `0x7519974E44583D56FcEB36dc63799941CC83B30e` | `0x1ab3054fe9967923903631ff74cec5a6577b308d33b6d8b10ef82fa285fbb1a5` |
| SettledArtworkNFT | `0x15EcEf00b6C32FC3dE26C9185FcDb95C62D8a277` | `0x9ca7ddbe40fb291d91b7c89221e61f44672de45a869ff3c37f68dd97d54e6e4f` |

At 14:42 UTC the Base and PublicNode endpoints both confirmed finality, the
transaction at index 3 in the canonical creation block, both contract
bindings and all three reviewed Safe configurations, each with three owners
and two required signatures.

The deployment input hash was `0xa05bf1b95586bcd755d0abd8b722d93b5a653e33172173a9ccab67d87a86ac30`. The [receipt verifier](../../scripts/prepare-rehearsal-core.mjs) checks the transaction, the two bound runtimes, the Core/NFT references, three distinct two-of-three Safes and the refund limits of eight entries and 30,000 gas per transfer. [Protocol treasury receipt](https://sepolia.basescan.org/tx/0x092494ba2ee96a59755ea23707c0399bae70d1fb04fa48a4fbe4aeb00e23d4e1) · [Ecosystem treasury receipt](https://sepolia.basescan.org/tx/0x8872fba832bd22fa3d98340658923a7d7162bf8cced5d29fc6c911daafdd8756)

## Auction and resale simulation

Direct reads from both nodes at deployment returned the NFT name `ArtSoul NFT`,
symbol `ARTSOUL`, and zero tokens. ERC-165, ERC-721, ERC-721 metadata and
ERC-2981 interface checks returned true. The invalid interface ID returned false.

Both `sepolia.base.org` and `base-sepolia-rpc.publicnode.com` executed the same read-only simulation against the deployed code at the creation block. Only the virtual participants' balances and the virtual block times were supplied. The chain recorded the deployment. The following balances and actions belong to the simulation.

| Scenario | Observed result |
| --- | --- |
| First auction | Publication and bidding left NFT supply at zero. At the deadline the winner paid the balance of 0.10 ETH and received token 1. |
| Resale | After a 0.20 ETH resale the new buyer owned token 1. The creator and First Collector stayed the same. Across both sales the artist accrued 0.1085 ETH, the first collector 0.185 ETH, the protocol 0.0045 ETH and the ecosystem 0.002 ETH. |
| Late bid and default | A 0.11 ETH bid one minute before close extended the end by ten minutes. Closing opened the full 24-hour payment window. After default the runner-up received the 0.01 ETH deposit back and could buy at their own 0.10 ETH price. The 0.011 ETH defaulted deposit split 80/20. |
| No bids | The expired auction disappeared from the work's active auction lookup and closed without minting. |

Repeat the read-only check with the reviewed test register. The two providers must agree. No private key or wallet connection is used.

```sh
node scripts/simulate-rehearsal-auction.mjs <test-pair-register.json> 0xfa3b8d4570232525c37e253d6edc1912dde822d96ce8e0431887348723eb1cd3
```

C13 still requires signed participant journeys, finalized settlement and keeper receipts, refund execution, hosted indexing and visible results on the site. Those observations are separate from the simulated lifecycle.

## Core with creditor-directed withdrawals

The same test payer deployed the [payout candidate](../security/C12_ORDINARY_PAYOUT_MANIFEST.json) in block 63,494,032, transaction index 4, using nonce 17. The transaction carried zero ETH and used 5,409,281 gas. The constructor retained the three reviewed Safe addresses and created a new paired NFT. The preceding deployment still has its own balances and obligations. [Base Sepolia deployment receipt](https://sepolia.basescan.org/tx/0xa796f38256db16ac122577c81b9c7a169858f11703bbfbc27247b91167a6f79f)

| Contract | Deployed address | Runtime Keccak-256 |
| --- | --- | --- |
| OrdinaryPayoutMarket | `0xC4b756B6E3714E4BaB6E7dd4965400F390403CD2` | `0x4d18f0243cff1ef906a07a3517949045c6fe3a9e8b584e60bcbe7ad021bef54e` |
| SettledArtworkNFT | `0x810DD5459c9cC5d82f13F8D52545a654Ec0bbe4c` | `0xcbff8b3bb46c10d150d5812846d5d8c990c0156215d5978b44e238a86d141bac` |

Two RPC providers finalized the creation block `0x8046188d1d848c102718a1d4d24957e4ee580fa5941728ac91bc762c419212df`. They agreed on receipt inclusion, both initialized runtime hashes, reciprocal contract bindings, all three two-of-three Safe configurations, and the eight-entry refund limit with 30,000 gas per attempted delivery. The input hash was `0x6e3ca34d58de3872abfb9d9a49a533f94572e1af3856bc59ec69f519a32a6f44`.

The [read-only rehearsal](../../scripts/simulate-rehearsal-auction.mjs) passed the preceding ordinary lifecycle cases against this pair on both providers. A separate simulation supplied a virtual bidder contract that refused ETH. Processing the outbid refund credited it 0.01 test ETH. Its own call to `withdrawTo` delivered exactly 0.01 test ETH to its chosen recipient, verified by the recipient's balance increase. The credit became zero and the Core retained the winner's 0.011 test ETH deposit. These simulated balances never entered the public ledger.

```sh
node scripts/simulate-rehearsal-auction.mjs <payout-test-pair-register.json> 0x8046188d1d848c102718a1d4d24957e4ee580fa5941728ac91bc762c419212df --payout
```

## Refunds to Safe receivers on two public RPC simulators

At payout deployment block 63,494,032, Base and PublicNode ran the same read-only `eth_simulateV1` rehearsal against the deployed Core. Each virtual losing bidder received the reviewed test treasury's Safe proxy runtime and singleton slot for the payout phase. Both nodes checked the original proxy code hash, singleton address and singleton code hash against the register. This exercises the Safe's ETH receive path. It does not exercise an owner's signature or model L1 data fees.

| Displaced deposits in the batch | Simulated execution gas |
| --- | ---: |
| 1 | 70,820 |
| 4 | 131,072 |
| 8 | 217,065 |

Both nodes recorded each expected recipient and exact amount in the simulated Core and Safe events, the completed queue cursor, and zero events on a second payout attempt. To repeat, run `node scripts/simulate-rehearsal-auction.mjs <payout-register.json> 0x8046188d1d848c102718a1d4d24957e4ee580fa5941728ac91bc762c419212df --safe-refunds`. A mined Safe refund and its actual network fee remain open.

## Public routing observation

At 20:13 UTC the public upload page loaded the published [contract configuration](https://artsoulprotocol.com/contracts-config.js), which selected Core `0x43368f7E2d5f11f4B7E11928D66d3f4A5a4E4ceF` and NFT `0xf061f70503c37Cf2196A28F4785E524D0Fb32538` on Base Sepolia. The [public indexer](https://artsoulprotocol.com/api/public/indexer-status) reported the same Core. Base and PublicNode confirmed the new payout Core and NFT runtime hashes and both directions of their binding at finalized block 63,573,369. The replacement had one registered work, zero auctions and zero minted tokens at that block.

## First registration on the payout Core

The local review page can prepare one call to `registerArtwork(string)` with zero ETH on network 84532. The creator is the test payer in the private payout deployment review. The fixture is titled **ArtSoul Base Sepolia Rehearsal**. Its 281-byte metadata URI embeds the entire JSON document on-chain and points to the existing public ArtSoul favicon for its image. The indexer's ordinary metadata reader decodes the title and image. The image remains hosted on the ArtSoul domain. Registering the work neither creates an auction nor mints a token.

On November 25 both public providers confirmed an empty registry at finalized block 63,511,976 (`0x4eea0a59f0fb6e4fdae84d07335fd2b32613f7e8d434abdc911c336f31a26ae0`). Both simulated work ID 1 for the zero-value call with calldata hash `0x556480cecd493fa790352edfbb659bf12d96c82ed0148272301120df53ff902e`. This observation prepared an unsigned request. The contract assigns the ID at execution.

The payer submitted the registration with nonce 18. Base and PublicNode returned a successful zero-value receipt at transaction index 4 in block 63,521,080 (`0xaa095aa18eed6d600b5aaf47754a098cb2d4c953bcad27d1d81e43186b1c1e34`, 17:01:24 UTC). Both canonical blocks contained the transaction at that index. The receipt used 306,949 gas and emitted one log. At 17:15 UTC both providers had marked this block safe. By 17:24 UTC the two-provider `--verify-receipt` command passed, confirming finality, the event, stored artwork, reciprocal Core/NFT bindings and all three two-of-three Safe configurations at the inclusion block. [Registration receipt](https://sepolia.basescan.org/tx/0xe6e6f19235b714814c40bb1ab20aebd4ff2408f17c9e8bc4f15e1e7ee391eacf)

Both providers returned `workCount = 1`, `auctionCount = 0` and NFT `totalSupply = 0` when queried by that canonical block hash. Work 1 stored the reviewed payer and metadata URI, with zero active auction and zero floor.

The [indexer's event reader](../../src/indexer/event-listener.js) independently decoded a single `ArtworkRegistered` from each provider at block log index 2, with artwork ID 1 and creator `0xE6d6658DD5013B30Ab8cA9CBD667D0b5a5A1b215`. The [metadata reader](../../src/api/safe-artwork-fetch.js) decoded the title **ArtSoul Base Sepolia Rehearsal**, media type `image/jpeg` and image URL `https://artsoulprotocol.com/favicon.jpg`. Hosted indexer persistence and the public artwork card still require separate verification.

The receipt command also runs the [publication recovery reader](../../src/api/upload-registration-evidence.js) with the reviewed payout Core and this specific receipt. Base and PublicNode returned matching evidence for work 1 under that issuer, with a common finalized anchor at block 63,541,026 (`0x5efc7ecdd7e2c78216f7fff866d187dd3368e833d01545944cff234de79759e1`). The report includes the NFT address and runtime hash, the event's block and log position, and the work state **at the registration block**. The Core reported no active auction and zero floor. The paired NFT's `artworkToToken(1)` returned zero. This command reads the ledger and returns the evidence locally.

```sh
node scripts/review-rehearsal-artwork.mjs <payout-core-review.json> <payout-pair-register.json> --plan
node scripts/review-rehearsal-artwork.mjs <payout-core-review.json> <payout-pair-register.json>
node scripts/review-rehearsal-artwork.mjs <payout-core-review.json> <payout-pair-register.json> --verify-receipt <registration-transaction-hash>
```

Open the loopback address printed by the second command. Review the payer, Base Sepolia, the payout Core and the zero-value registration in the wallet. A matching existing registration disables the request. If someone registered a different first work, the page stops and the public transaction hash can be checked independently. The verifier uses the actual ID from the finalized receipt, confirms the single event, its emitter and stored creator/URI, and rechecks the contract pair and its custody at the inclusion block through two providers. Auction, settlement, refunds, hosted indexing and UI acceptance have separate evidence.

## Private indexer replay of the signed registration

The [registration intake](../../scripts/read-ordinary-receipt.mjs) read the signed work 1 receipt at block 63,521,080, log index 2, from Base and PublicNode. Each provider confirmed inclusion at its transaction position, the two bound runtimes, the registration event and its creator and metadata in the Core at that block.

Using a disposable PostgreSQL 18.4 database on loopback, the ordinary read call left the registration table empty. Running the same command with `--persist` inserted one row. A second independent read and replay returned `inserted: false` and left exactly one row. Its 281 metadata URI bytes matched the original registration fixture. The database was stopped and its data directory removed. In a separate fixture, two issuers with the same numeric artwork ID retained separate rows and the prototype catalog cursor stayed unchanged. Hosted intake and public rendering remain open.

```sh
node scripts/read-ordinary-receipt.mjs registration reviewed-pair.json 63521080 0xaa095aa18eed6d600b5aaf47754a098cb2d4c953bcad27d1d81e43186b1c1e34 0xe6e6f19235b714814c40bb1ab20aebd4ff2408f17c9e8bc4f15e1e7ee391eacf 2
```

## Opening the registered work in a read-only simulation

At finalized block 63,558,247 (`0x48c1082c1d07d686d6916ea98a1e2daf2c789d289e84ffb4df62175e6ad98425`), Base and PublicNode agreed on the payout pair, custody, and the creator and metadata of work 1. The work had zero floor, zero token ID and no active auction. Both nodes simulated a 24-hour opening at 0.001 test ETH from the registered creator and returned auction ID 1. The calldata hash was `0x08130d8ab39d1264a70fbf21cfb22dd88f926ba91952124a6e0a782db8ee8a14`. This specific price and duration were simulation inputs. The call produced no auction, deadline or receipt.

```sh
node scripts/review-rehearsal-artwork.mjs review.json register.json --check-opening 1000000000000000 24
```

The command uses ordinary read RPCs at a common finalized block. It checks the reviewed test deployment, rejects a mismatched creator or URI, an active auction or a minted work, and compares the returned ID to the next auction counter. The hosted public indexer still reported the earlier test Core during the same evening's operator check. Use the issuing Core as well as the artwork ID when verifying later hosted journeys.

### Creator's unsigned opening request

The private rehearsal page can now prepare that fixed opening for work 1. The two-provider preflight passed at finalized block 63,588,254 (`0xfa309695fc998af3a48b4630ae474ebfaec6671fd1b0c333757863ab6372394d`). Both providers verified the payout pair and its custody, matched the registered creator and work, and simulated auction ID 1 with a settled creator nonce of 19. The reserve is 0.001 test ETH and the duration is 24 hours. The creator sends **0 ETH** to the Core and pays test gas upon submission.

```sh
node scripts/review-rehearsal-artwork.mjs <payout-core-review.json> <payout-pair-register.json> --opening-plan
node scripts/review-rehearsal-artwork.mjs <payout-core-review.json> <payout-pair-register.json> --serve-opening
```

The first command prints the unsigned plan. The second prints a random URL usable only on the same computer. The page checks the exact origin and refreshes both provider readings when the creator selects **Review in wallet**. The wallet checks its account, chain, current nonce, both runtimes and the pending result of `createAuction(1, 1000000000000000, 86400)`. The request closes once the Core has any auction history, including an expired or completed first auction. A second operation cannot be prepared as a retry. Retain the signed transaction hash to verify the actual auction ID, work, reserve and deadline after inclusion. The unsigned preflight starts no countdown.

**View verified work registration** opens a wallet-free page on this private server. Each visit reads the already signed registration from the two fixed RPC providers, verifies the reviewed pair and the public catalog recovery reader's result, and displays the registered metadata, creator, block, transaction and event index. The auction, mint and floor fields describe the registration block. The URL accepts no alternate deployment, receipt or RPC endpoint.

### Recorded auction opening

The creator opened auction 1 for work 1 on the replacement Core. Both RPCs returned a successful receipt in block 63,601,279 (`0x99a177d8be1681fcbf8138a5ad36a5038b8034e8a3831b0c8d6236f57c65daa5`), transaction index 3, log index 4. The creator sent zero test ETH and used 197,791 gas. The contract emitted an opening reserve of 0.001 test ETH and an initial end of November 26 at 21:28:44 UTC (22:28:44 in Warsaw), exactly 24 hours after the inclusion block. A valid late bid can change the current deadline. [Base Sepolia opening receipt](https://sepolia.basescan.org/tx/0x9c13f650612551c6a13d0be018ce0cdc44036ba43de0e36e7a8b74f29e45d42d)

At 21:49:33 UTC on November 25 the Base public RPC and PublicNode both reported finalized height 63,602,243. By 21:51 UTC the verifier below had independently confirmed the opening on both providers, including wallet nonce 19, the exact `createAuction(1,1000000000000000,86400)` call, the reviewed Core and NFT runtimes, the three Safe configurations and the canonical event position. At the opening block the work had no token or floor and the auction had no bid or deposit. The separate first-bid planner returned `early`.

Use the following read-only verification with the private payout review and pair register.

```sh
node scripts/review-rehearsal-artwork.mjs <payout-core-review.json> <payout-pair-register.json> --verify-opening 0x9c13f650612551c6a13d0be018ce0cdc44036ba43de0e36e7a8b74f29e45d42d
```

At block 63,602,202 both providers reported no bid, an open round, a minimum bid of 0.001 test ETH and a deposit of 0.01 test ETH. A read-only simulation of the first bid by a distinct funded test participant returned successfully on each provider. Subsequent bidders must refresh the minimum bid, deposit and current deadline. The simulation records no bid.

For this auction, `node scripts/review-rehearsal-late-bid.mjs --plan` checks the finalized opening and returns the availability of the first late bid. Use `--serve` to open the private wallet review on the same computer. It becomes available from November 26 at 21:18:44 UTC until 21:28:44 UTC if no other bid has arrived. The request is limited to the reviewed bidder, Core and auction, a bid of 0.001 test ETH and a deposit of 0.01 test ETH. Only the wallet holder submits the transaction. The inclusion block determines whether an extension occurs. After inclusion and finality, `node scripts/review-rehearsal-late-bid.mjs --verify-receipt HASH` checks the submitted bid and the resulting auction deadline.

Use `node scripts/review-rehearsal-late-bid.mjs --status` or **View finalized auction status** on the local bid review page to read the current evidence without a wallet. Both providers must agree on the same finalized block, Core/NFT runtimes and auction state. The page shows the block time and deadlines in Warsaw and UTC, including a winner payment deadline or runner-up offer when applicable. Finality may lag a recent bid. The wallet planner checks fresh heads separately before offering the fixed first-bid request.

On November 26 at the finalized block timestamp 18:33:40 UTC, both providers confirmed the original bidding end of 21:28:44 UTC, the reserve of 0.001 test ETH and no highest bidder. [Observed Base Sepolia block](https://sepolia.basescan.org/block/0x7886e8697029b70c7a2b64083c2230a9cf171dcc58c40b7b69f73ccd12256d35)

## First late bid and settlement

Two Base Sepolia nodes verified the [first late bid](https://sepolia.basescan.org/tx/0xe486f15933f6892b415e4d5c93d174c459f85268e8ee2a56059dbe2e4aee9b89) at finalized block 64,030,831. At 21:20:35 UTC the winner offered 0.001 test ETH and deposited 0.01 test ETH. The Core emitted `BidAccepted` and `AuctionExtended` in sequence, moving the end from 21:28:44 to 21:38:44 UTC.

The winner used the local `--settle` review to [settle auction 1](https://sepolia.basescan.org/tx/0x07cd8c340164096abdf14f3762e0835254023b794ed7e5e2adfd567cf9864dfa). Both nodes verified the finalized sale and token in block 64,039,544 at 21:49:37 UTC. NFT 1 belongs to the winning bidder. The transaction carried zero test ETH and left 0.009 test ETH in withdrawable winner credit. Replaying the verified receipt twice through the settlement indexer in an isolated PostgreSQL database produced one sale and one credit record: 0.000975 test ETH to the creator and 0.000025 to Protocol Treasury. The public catalog still serves the earlier pair.

The same sale was then imported into the private ArtSoul Supabase schema after migrations 018 and 023. The operator command read both independent RPCs before either database run. The first import returned `inserted: true`, the second returned `false`, and an independent database read found one matching sale and the exact two primary allocations. To reproduce the chain check, configure the two RPCs from the [intake runbook](../security/MIGRATION_RUNBOOK.md#ordinary-settlement-intake), then run:

```sh
node scripts/index-ordinary-settlement.mjs docs/testnet/ordinary-auction-1-settlement.json docs/testnet/ordinary-auction-1-settlement.json --read-only
```

### Winner credit after settlement

For a read-only browser view of the replacement pair's first sale, run `node scripts/review-rehearsal-late-bid.mjs --sale` and open the printed loopback URL. On November 27 the view returned HTTP 200. Two nodes verified work 1, auction 1, NFT 1, the settlement at block 64,039,544, and the collector's continued ownership at finalized block 64,111,438. The view separates the creator credit of 0.000975 test ETH from the protocol credit of 0.000025 test ETH. Its home page and sale view load without a wallet or a transaction planner. The public catalog still has a different issuer.

The two-provider plan reads the signed primary sale, both contract runtimes, the current creditor balance and a pending-state simulation of `withdraw()`. The November 27 read returned exactly 0.009 test ETH for the winner. This is the remaining deposit from a paid sale. Testing delivery to a losing bidder needs a different auction with competing bidders.

The [winner's withdrawal](https://sepolia.basescan.org/tx/0x6a6701e0b37ca8a861b442a6bb5affc4b42020eccbd1237303ab81e4ccdb61cb) finalized in Base Sepolia block 64,064,023. Base and PublicNode agreed on log index 0, the Core, the winner's address and a payment of 9,000,000,000,000,000 wei. A second read of the withdrawal plan reported zero remaining credit. The wallet sent 0 test ETH, used 32,426 execution gas and paid 199,243,612,937 wei including the L1 data fee.

From the project directory, `node scripts/review-rehearsal-late-bid.mjs --withdraw-plan` checks eligibility without a wallet. Use `--withdraw` to open the private wallet review. The only destination for this zero-value call is the reviewed Core, and the only recipient of credit is the connected winner. A zero credit closes the request. A changed amount requires a fresh review. After the winner submits, `--verify-withdrawal HASH` verifies the actual payment event and finalized transaction position on both providers.

### Checking a displaced bidder's deposit

For an auction with competing bids, keep the hash of the bid that displaced the participant and the hash of the refund batch. The queued event identifies the auction and its zero-based entry index. With the two independent RPC endpoints configured as above, run:

```sh
node scripts/read-ordinary-outbid-refund.mjs docs/testnet/ordinary-auction-1-settlement.json AUCTION_ID QUEUE_INDEX OUTBIDDING_TX PROCESSING_TX
```

The JSON file supplies the reviewed issuer addresses and runtime hashes. The command reads the specified auction. It matches the creditor, amount and entry number in both finalized receipts, including their block positions and the published queue cursor. A successful ETH payment returns `delivered`. A rejected payment returns `credited-for-withdrawal`, which still requires a creditor withdrawal for delivery. The [isolated EVM rehearsal](../../scripts/rehearse-ordinary-settlement-receipts.cjs) exercised both outcomes in a single batch. Public participant evidence requires the two corresponding Base Sepolia receipts.

For a direct signed `processRefunds` call, one additional read reports the immutable limits at the receipt block, requested count from the signed calldata, emitted entries, distinct creditor addresses, each disposition, whole-transaction execution gas and Base L1 data and total fees.

```sh
node scripts/read-ordinary-outbid-refund.mjs docs/testnet/ordinary-auction-1-settlement.json --batch PROCESSING_TX
```

The approved limits are eight **entries** per call and a 30,000-gas **argument** to each value-carrying EVM call. A creditor can appear more than once. A public receipt measures the whole transaction and records each outcome. It cannot measure gas actually consumed by an individual recipient. In the local EVM the contract received a request for eight, processed two distinct creditors, delivered one payment, recorded one withdrawable credit and consumed 102,432 execution gas for the batch. A full eight-entry signed public batch and measured on-chain fees remain open.

### Second work for the two-collector test

The first work already has a settled NFT. The creator can register a separate work for the two-collector test. On November 27 Base and PublicNode both simulated `registerArtwork(string)` returning ID 2 on the reviewed payout Core. The exact request has calldata SHA-256 `2ff394272a59051ccc4e4b2acc732a80f60efc52b903d552920b83c475c280b2`. It registers the title **ArtSoul Outbid Refund Rehearsal**, sends zero test ETH and opens no auction.

The [signed registration of artwork 2](https://sepolia.basescan.org/tx/0xb2985bf66fefdcd1d32db037c23cfa4d55c99b151d19b4ba238045ace5561ac5) succeeded at block 64,109,904 (`0xba32ad3eb75a99ac97522856e39a7e8d9a2286bc6ca1ff6095fec656cda54183`) on November 27 at 01:44:09 UTC. Both providers confirmed the finalized work, creator, exact metadata, Core and NFT pair. The publication recovery reader returned `verified`. The receipt used 312,767 gas. The next operation for this work is its auction opening.

Use the same release review and custody-register files as for the first registration. The plan checks the finalized first sale, both contract runtimes, the creator, existing registrations, pending nonce and simulated new ID. Only the creator can submit this rehearsal request from the local review page. A matching included or finalized second registration retires the request. Another work at ID 2 stops the review. A competing registration can still change the assigned ID at inclusion. Keep the public receipt if that happens and investigate before another submission.

```sh
node scripts/review-rehearsal-artwork.mjs <payout-review.json> <payout-register.json> --refund-work-plan
node scripts/review-rehearsal-artwork.mjs <payout-review.json> <payout-register.json> --serve-refund-work
node scripts/review-rehearsal-artwork.mjs <payout-review.json> <payout-register.json> --verify-refund-work REGISTRATION_TX
```

On the guided registration page, refresh after work 2 reaches finality. The same page finds the registration on both nodes, verifies its receipt and displays the opening for a separate wallet review. This also works after reopening the page. The explicit commands below remain available for independent checks.

After work 2 is registered, the creator can open its own 24-hour auction at the same 0.001 test ETH reserve. Supply the **second** registration's public transaction hash. Both providers must confirm its sender, exact metadata, event, work ID and canonical position. The wallet review simulates `createAuction(2, 1000000000000000, 86400)` with zero test ETH. Any existing auction at the expected ID closes the request. The receipt check also binds the opening to its earlier registration.

```sh
node scripts/review-rehearsal-artwork.mjs <payout-review.json> <payout-register.json> --refund-opening-plan REGISTRATION_TX
node scripts/review-rehearsal-artwork.mjs <payout-review.json> <payout-register.json> --serve-refund-opening REGISTRATION_TX
node scripts/review-rehearsal-artwork.mjs <payout-review.json> <payout-register.json> --verify-refund-opening REGISTRATION_TX OPENING_TX
```

Two distinct collectors then place bids. Record the outbidding and refund-processing receipts for the queue reader above. The first auction's winner-surplus withdrawal covers another payment path.

Both public providers returned the successful [opening of auction 2](https://sepolia.basescan.org/tx/0x87883da08e3404683f3ae7ed4c7912ba091562d5d11b33152becf1dc25219f8d) for work 2 in block 64,118,482, hash `0xd9ee63c5db8d76122ca46c47a4b93ee958c6eaa528e2ed73e6ccfee38554613d`. The creator submitted the reviewed calldata with zero ETH value and used 180,691 gas. The emitted reserve was 0.001 test ETH. The opening block was November 27 at 02:12:45 UTC and the original deadline was November 28 at 02:12:45 UTC (03:12:45 in Warsaw).

The two-provider finality check subsequently confirmed that opening against the registration, stored auction and NFT state. The [first collector's bid](https://sepolia.basescan.org/tx/0x5585d1f23e7139e5268615f685ceef531f6d614dd9a076c342fae46d09db21c3) was included at 08:58:05 UTC in block 64,240,084 (`0x4c0524dbf6927aa1d5d6fb1d9ea59449de7bdd6c40709ecdd31fef277f734ed3`). Both providers returned the signed calldata, successful receipt and matching `BidAccepted` event with a price of 0.001 test ETH and a deposit of 0.01 test ETH. It used 106,579 gas and left the original deadline in place. Use the separate collector for the next bid. A winner-surplus withdrawal on auction 1 and a displaced deposit on auction 2 have distinct receipts.

### Restoring the first hosted sale

A read-only, data-only PostgreSQL export included just the three private issuer, sale and credit tables. Its archive contained three table-data entries and occupied 2,540 bytes. Restoring into an empty local database with migrations 018 and 023 reproduced every field of the hosted issuer, finalized sale and allocations. The source and restored tables each had one row. The temporary database and local export were removed after comparison. This drill covers that sale. A full catalog and indexer recovery still requires its own release rehearsal.

## First NFT transfer range on the payout pair

Base and PublicNode returned empty code at both payout addresses in block 63,494,031. The creation block 63,494,032 contained the reviewed runtime pair, zero NFT supply and zero NFT `Transfer` events. At finalized block 63,527,445, both providers returned one registered work, zero auctions and zero tokens.

The [ordinary transfer reader](../../scripts/read-ordinary-transfer-range.mjs) checks `Core.nft()`, `NFT.core()`, both runtime hashes and endpoint finality. The first range uses the creation block as its zero-supply predecessor. Both nodes independently returned an empty batch for block 63,494,033. To repeat the read, set `ARTSOUL_ORDINARY_RPC_URL` and `ARTSOUL_ORDINARY_RPC_CHECK_URL` to independent HTTPS endpoints for Base Sepolia and supply the reviewed payout pair register.

```sh
node scripts/read-ordinary-transfer-range.mjs <payout-pair-register.json> bootstrap 63494033 0x8046188d1d848c102718a1d4d24957e4ee580fa5941728ac91bc762c419212df 63494033 0x3868ea2419c15a5bf9ee332628da9776f8828ff3f1fc67033c8b2c204a1f79e4
```

For a contiguous follow-up, use `continuation` with the next block number, the previous report's endpoint hash, and the new endpoint number and hash. The command returns a read-only observation.

### Continuous transfer and primary-sale intake

The [Base Sepolia worker](../../scripts/sync-ordinary-history.mjs) independently indexes an immutable ordinary pair. Its three arguments are the reviewed pair file, first block to cover and canonical hash of the zero-supply predecessor. Both nodes must agree on finality, reciprocal contract bindings, initialized runtime hashes, mint counts, canonical transfers and the associated sale and credit receipts. A direct transfer changes the indexed owner without booking revenue. Multiple historic pairs use separate coverage in the same private store.

```sh
node scripts/sync-ordinary-history.mjs docs/testnet/ordinary-auction-1-settlement.json 63494033 0x8046188d1d848c102718a1d4d24957e4ee580fa5941728ac91bc762c419212df --read-only
```

Set `ARTSOUL_ORDINARY_RPC_URL` and `ARTSOUL_ORDINARY_RPC_CHECK_URL` to separate archive RPC providers. The default reads one window without a database. For an approved private rehearsal store, install indexer migrations 018, 023 and 024 and set `ARTSOUL_ORDINARY_DATABASE_URL`. Use the same arguments with `--once` to persist the next window or `--follow` for continuous processing. Keep the same zero-supply origin on restart. Each window defaults to 1,000 blocks and may be lowered with `ARTSOUL_ORDINARY_RANGE_BLOCKS` for provider limits. The worker polls once per minute after catch-up. It serializes commits by issuer, retries temporary transport failures and stops on contradictory evidence. The prototype catalog has its own cursor.

For an ArtSoul Core resale, the worker matches the purchase and its adjacent NFT delivery to the transaction receipt on both providers. The existing resale reader verifies the four payment shares, including both treasury addresses. Ownership, payouts and the covered range commit together. A wallet gift only updates ownership. Conflicting evidence stops the worker before it advances its cursor. Disposable EVM tests exercised a paid resale followed by a gift on each of two issuers. PostgreSQL tests check rollback when a receipt disagrees with RPC discovery or a payout is inconsistent.

The [isolated restore test](../../test/helpers/ordinary-history-restore.mjs) starts immediately before the first mint with its independently verified zero-supply predecessor. It locates the mint and primary sale in block 64,039,544 without being given a receipt. The backup includes six private tables covering issuers, transfers, ranges, primary settlements, primary credits and Core resales. The drill compares every row after restoring into an empty PostgreSQL database, resumes at 64,039,545 and verifies the same sale and zero resales. Hosted continuous intake, the replacement public catalog and full database and media recovery still need operational evidence.

To reproduce just this drill on a development machine with PostgreSQL binaries, set `ARTSOUL_TEST_POSTGRES_BIN` to the binary directory, `ARTSOUL_TEST_ORDINARY_HISTORY_ONLY=1` and `ARTSOUL_TEST_LIVE_ORDINARY_HISTORY=1`, then run `node --test test/indexer-reorg-atomicity.test.cjs`. It creates its own disposable local databases and uses the two public Base Sepolia nodes.

The [demand report](../../scripts/report-ordinary-demand.mjs) checks coverage in the same database snapshot as its totals. Add `--primary-coverage` after the four normal arguments to check for linked ranges, continuous supply, recorded transfers and matching sale and credit for every mint. Add `--market-coverage` instead to also reconcile each range's Core resale count with the retained purchase and corresponding token delivery. This requires migrations 020 and 024 alongside the ordinary issuer tables. A range imported with missing sale evidence stays incomplete. The real two-block drill counted one primary purchase of 0.001 test ETH and 25,000,000,000,000 wei in protocol credit. External marketplaces and buyer history before the covered interval require separate evidence.

On November 27, hosted ArtSoul Supabase retained exactly two single-block ranges for this pair, 64,039,544 (`0x6c4c76884da84b0af1db729a67e20d55ba6580814f1634e4788d5ee5d062cf90`) and 64,039,545 (`0x01b98f8597bd4ab4c2606e54eb92aa7a7072ee2e68450c112eb52e94629183be`). Independent SQL readback matched the [settlement receipt](https://sepolia.basescan.org/tx/0x07cd8c340164096abdf14f3762e0835254023b794ed7e5e2adfd567cf9864dfa) at credit, mint and settlement log positions 7, 9 and 10. Supply rose from zero to one and held at one. The hosted `--market-coverage` report confirmed one buyer, one primary sale, 0.000975 test ETH credited to the creator, 0.000025 test ETH to Protocol Treasury and zero Core resales across both blocks. The continuous worker stayed off.

At finalized Base Sepolia block 64,111,438 (`0xb309160160243f56ba3f56b4232774d0798830ba170d89e938b4b2bc2a6ad3dc`), two public RPCs agreed that the reviewed NFT had one issued token and its ownership-change counter was zero. The first paid resale on this public pair still requires a seller and a buyer.
# Participant pilot before mainnet

Use Base Sepolia with the replacement Core, NFT contract and matching public indexer. Confirm all three addresses against the candidate release before inviting participants. Keep the existing catalog readable during rehearsal.

| Participant | Test from the normal website | Record |
| --- | --- | --- |
| Creator | Publish an artwork and start a timed auction. | Public work link, registration and auction receipts. |
| Two collectors | Place competing bids, including one late bid. Reopen on a second device. | Updated deadline, deposit, outbid refund and independently observed notification. |
| Winning collector | Settle and inspect the minted NFT, Creator, First Collector and Owner. Transfer it and reopen the work. | Receipt, token ID, current owner and retained provenance. |
| Operator | Exercise default, runner-up, recovery and once-only refund in separate rounds. Repeat after correcting any blocking issue. | Receipts, indexed history and outstanding balances. |

Allow several days for complete auction and payment windows. The release decision follows observed outcomes. Wallet signatures stay with each tester. Mainnet confirmation is a separate, explicitly authorized step after rehearsal and review.
