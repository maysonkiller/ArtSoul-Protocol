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

## First NFT transfer range on the payout pair

Base and PublicNode returned empty code at both payout addresses in block 63,494,031. The creation block 63,494,032 contained the reviewed runtime pair, zero NFT supply and zero NFT `Transfer` events. At finalized block 63,527,445, both providers returned one registered work, zero auctions and zero tokens.

The [ordinary transfer reader](../../scripts/read-ordinary-transfer-range.mjs) checks `Core.nft()`, `NFT.core()`, both runtime hashes and endpoint finality. The first range uses the creation block as its zero-supply predecessor. Both nodes independently returned an empty batch for block 63,494,033. To repeat the read, set `ARTSOUL_ORDINARY_RPC_URL` and `ARTSOUL_ORDINARY_RPC_CHECK_URL` to independent HTTPS endpoints for Base Sepolia and supply the reviewed payout pair register.

```sh
node scripts/read-ordinary-transfer-range.mjs <payout-pair-register.json> bootstrap 63494033 0x8046188d1d848c102718a1d4d24957e4ee580fa5941728ac91bc762c419212df 63494033 0x3868ea2419c15a5bf9ee332628da9776f8828ff3f1fc67033c8b2c204a1f79e4
```

For a contiguous follow-up, use `continuation` with the next block number, the previous report's endpoint hash, and the new endpoint number and hash. The command returns a read-only observation. Hosted transfer persistence and the first minted token still need independent acceptance.
