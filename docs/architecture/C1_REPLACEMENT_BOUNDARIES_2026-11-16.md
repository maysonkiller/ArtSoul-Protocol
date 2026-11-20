# C1 — Minimal replacement boundaries

Status: **The immutable ordinary-work pair and its native auction pause/deadline policy were selected on November 19. A local Solidity candidate implements primary auctions, settlement-bound minting and bounded refunds. C1 remains open.**
Reviewed November 16, 2026 at `0f9d7fbb`, using the current source and the
[D1–D6 decision annex](C1_DECISION_INVARIANTS_2026-11-02.md). This narrows the
[rework plan](../canon/CONTRACT_REWORK_PLAN.md), rather than adding another
framework. Affected layers: contracts/custody, deployment identity, indexer
provenance and future execution/payment interfaces.

## Approved baseline and verified evidence

**APPROVED direction:** October 26 permits replacement-contract and payment-route
design; November 2 permits independent work alongside unfinished earlier phases.
Neither selects critical powers, new spending or mainnet activation. Preserve
[Bible §§2–5, 8–9, 14, 16](../canon/ARTSOUL_CANON_BIBLE_FULL.md): settlement before
mint/floor; full losing-deposit refunds with bounded execution and credit fallback;
the existing economic values; deployment-scoped provenance; separate protocol and
ecosystem destinations. Automatic no-bid finalization is required. Automatic winner
payment, execution reserves and cross-chain routes still need their own decisions.

**CONFIRMED CURRENT source:** the mutable issuer and unscoped artwork mappings in
[ArtSoulNFT](../../contracts/ArtSoulNFT.sol), and the independent counters and
settlement/credit state in [ArtSoulCore](../../contracts/ArtSoulCore.sol), remain
unchanged. Their SHA-256 hashes match the
[characterization baseline](../audits/C1_PAUSE_AUTHORITY_CHARACTERIZATION_2026-11-02.md).
The annex records **55 passing local contract tests**, including these hazards:

| Executed observation | Required replacement outcome |
| --- | --- |
| Pause consumes the winner's payment window; default becomes executable after unpause | Administration cannot cause a missed payment opportunity and silently impose the normal winner penalty |
| Replacing the NFT issuer blocks the old funded Core auction | New deployment activation leaves old fulfillment and claims reachable |
| Two Cores use artwork ID 1 against one NFT mapping and collide | Identity and mint uniqueness include the issuing deployment |
| NFT owner authorizes an EOA, which mints without registration/payment; revocation leaves that token intact | No owner-accessible issuer replacement or alternate mint route bypasses the settled obligation |

These are local source reproductions, not evidence of a deployed compromise or
replacement acceptance. The six-contract
[storage export](C1_CURRENT_STORAGE_2026-11-02.json) captures existing constructor
layouts and immutable bindings. It is neither a replacement layout nor permission
to reuse live storage. This document does not rerun the contract suite.

## Ordinary artworks after mainnet launch

Under the founder's delegated technical decision on November 19, design one
**immutable auction engine permanently paired with its NFT contract** for each
ordinary-artwork deployment. Keep primary auctions, resale and their ETH ledger
in that engine; do not split its custody into a universal module vault. Shared
arithmetic can remain internal code. Separate NFT addresses are the deliberate
cost: indexer/UI must resolve multiple deployments and old works keep their
original token addresses. No automatic asset migration or remint is implied.

| Component | Owns | Does not receive |
| --- | --- | --- |
| Engine for deployment A | Registered works, fixed auction obligations, settlement/default, canonical floors, resale authorizations, deposits and payable balances | Access to deployment B's assets or liabilities; arbitrary external-call/delegate authority |
| NFT paired with A | Token identity, creator/First Collector, ownership, transfer epoch, approved royalty and marketplace constraints | Mutable issuer, owner mint, arbitrary burn/seizure, or a generic module mint permission |
| Off-chain deployment manifest/indexer | Chain, engine/NFT addresses, deploy blocks, source/build identity and event history | Authority to mint, settle, change creditors or declare an unpaid sale successful |

Use `(chainId, engineAddress, artworkId)` for a work and
`(chainId, nftAddress, tokenId)` for its NFT. Auctions, listings, obligations and
future intents also bind their engine and local ID/version. A display version
label or a restarted counter is never the identity. A transfer epoch plus listing
version must invalidate transfer-away/return, cancellation and replacement;
returning ownership cannot revive an old listing (annex D4).

Deploying B does not change A's issuer, balances, provenance or accepted terms.
On a future upgrade the site directs new publications to the new pair. Existing
works still open in the same site, with their original addresses, history and
action routes. An existing NFT holder needs no exchange or new signature just
to keep the NFT. After new publication entry closes, existing fulfillment
and withdrawals remain supported and indexed. Do not require every creditor to withdraw before a
new deployment can exist, or erase old claims after an arbitrary deadline.
Closing old entry and any exceptional recovery/migration need the authority and
exit policy below. Existing prototype contracts cannot acquire these guarantees
through configuration; their historical liabilities require their own inventory.

The alternative of a shared NFT registry would retain a single collection address but needs
permanent issuer namespaces, scoped mint consumption and an admission/removal
policy that cannot strand old obligations. It adds a shared trust boundary without
an established requirement for this first slice. The selected ordinary-artwork
pair has no in-place proxy upgrade or replaceable issuer. The lifetime decision
covers that pair only. OpenSea's move to Seaport 1.6 illustrates that a single
site can route new orders to new contracts; Seaport does not prescribe ArtSoul's
handling of auction deposits. ERC-721 identifies each existing token by its
contract and token ID on its chain. [OpenSea migration](https://opensea.io/blog/articles/introducing-seaport-1-6)
and [ERC-721](https://eips.ethereum.org/EIPS/eip-721#nft-identifiers).

Base Sepolia and Base mainnet have separate ledgers. The testnet catalog
retirement at initial launch follows the [snapshot and clean-catalog decision](../canon/ARTSOUL_CANON_BIBLE_FULL.md#16-pre-mainnet-migration-and-data-reset).
This future same-mainnet upgrade policy starts with the first genuine mainnet
publication. [Base network details](https://docs.base.org/get-started/connect-to-base).

Genesis, Partner Collections, generic Launch/Forge and Donations retain their
separate reviewed lifecycles. They are not granted this engine's mint or ledger
authority. Their future deployment bindings need explicit review; the current
Donations contract's immutable Core resolver cannot silently follow a new Core.

## Proposed mint capability

1. Pair engine and NFT atomically during construction: the engine creates its
   NFT, the NFT fixes that engine as issuer, and the engine retains its NFT
   binding. No public initialization interval, `setCore`, issuer grant/revoke or
   owner mint remains. Verify both bindings before admitting funds. A deployment
   manifest identifies reviewed code; an arbitrary contract with the same ABI is
   not an accepted issuer.
2. The only issuing path is the engine's validated settlement transition. It
   checks the registered work, selected bidder, exact remaining payment, approved
   time/state policy and unconsumed obligation. Record the successful obligation
   before the external mint call, under the reentrancy guard.
3. NFT issuance takes a typed obligation reference, reads its fixed engine's
   settled record, and consumes that work's issuance once. Creator, First
   Collector, recipient and metadata reference come from that record, not an
   administrator's substitute payload. First Collector persists across transfers.
   No-bid/default records are ineligible. This check still trusts the immutable
   engine's reviewed validation; a getter is not proof against malicious engine
   code or a hidden bypass.
4. Payment accounting, consumed obligation, mint and floor creation commit in one
   transaction or all revert. Repeated delivery cannot mint, pay or create credit
   again. NFT callbacks must not expose a second settlement/default/withdrawal
   route. A newly deployed engine cannot issue into the previous NFT.

This removes the reproduced owner-controlled mint switch by construction. It
does not make engine bugs repairable in place or settle the emergency policy.
There is no administrative "repair mint" exception hidden in this proposal.

## Liabilities, execution and adapter boundaries

Each engine owns its debts for its lifetime. For verification, require
`D + O + C + F + R <= B` at each custody boundary: locked deposits `D`, payable
refunds awaiting an attempt `O`, withdrawable/proceeds credits `C`, optional
unconsumed purchase prefunding `F`, optional execution reserves `R`, and available
ETH `B`. These are disjoint model sums, not on-chain enumeration. Initially
`F = R = 0`; the equation does not authorize collecting either. Unsolicited excess
ETH creates no inferred owner sweep entitlement.

Record deposit ownership as bids arrive; finalization determines the terminal
obligations without scanning every bidder or requiring losing-bidder action.
Earlier credited/refunded deposits are not recreated. A payable refund moves
exactly once from `O` to payment or `C`; a credit becomes payment once. Batch
execution and individual withdrawal consume the same entitlement before the
external call. A failing recipient receives credit without blocking other
recipients; bounded batch size and per-attempt execution prevent unbounded work.
Only the defaulted winner's deposit enters the approved 80/20 split.

The engine credits the seller, creator and two treasuries using the approved
splits and largest-remainder rule. The constructor fixes the treasury addresses.
The release preflight checks both against the reviewed register. New engines, staff, keepers and payment adapters cannot debit
unrelated credits. Alternate refund recipients require creditor authorization,
not operator discretion. Events must distinguish obligation/credit creation from
an actual payment and identify the deployment, obligation, creditor and outcome.

Execution remains permissionless and contract-validated: no-bid cleanup may occur
on the next authorized interaction; a worker may finalize or process refunds
without selecting outcomes. A stopped worker cannot be the sole exit path.
Gas sponsorship does not fund the winner's remaining purchase price. Optional
prefunding/reserves require separate ownership, caps, once-only consumption and
unused-fund recovery before acceptance; no new worker service or signer is needed
to specify these boundaries.

Future payment adapters submit only a bounded purchase/funding action. They never
become NFT issuers, ledger administrators or the buyer merely because they are
`msg.sender`. Bind authorization to signer/payer, beneficiary, refund owner,
chains/assets, destination engine/action/item/terms, amount/cap, nonce and expiry.
No arbitrary target/calldata capability. Only successful destination settlement
creates the Base NFT/floor; source payment is not a bid or completed purchase.
Duplicate, late, wrong-asset or failed arrivals retain an attributable recovery
path, with refund chain/asset and gas responsibility decided before activation.
Start any later integration with destination funding, then bounded buy-now;
auction transport follows only after those recovery paths are proven.

## Selected entry pause and payment window

The November 19 decision fixes the ordinary trading clock in the Core. An accepted bid with up to ten minutes left adds ten minutes to the current end. Six extensions reach the one-hour cap measured from the originally scheduled end. Subsequent valid bids can still win before that cap. At the exact end, bidding is closed. Only a changed deadline produces an `AuctionExtended` event. The site's trading countdown uses that deadline. The winner's separate payment clock starts on confirmed close. [Contract and timestamp boundary tests](../../test/OrdinaryArtAuctions.test.cjs).

The new native ordinary-work pair pauses artwork registration, auction creation, bidding, new resale listings and resale purchases. Anyone can close an expired auction during a pause. A bidless close creates neither an NFT nor a floor. With a winner, the closing transaction opens the full 24-hour payment window. The winner can pay through the exact deadline. Anyone can finalize a default strictly afterward if payment is still outstanding. Existing listing cancellation, refund processing and credit withdrawal remain available under their normal rules. An entry pause does not change the clock. These rules apply to the new pair only. [Maintained lifecycle](../canon/ARTSOUL_CANON_BIBLE_FULL.md#2-artwork-lifecycle)

The auction candidate gates registration, auction creation and bidding. Closing, settling, mint, default, refunds and withdrawals remain reachable. Local primary-auction tests exercise a pause across expiry and through the winner's payment deadline. [Auction candidate](../../contracts/replacement/OrdinaryArtAuctions.sol) and [primary auction tests](../../test/OrdinaryArtAuctions.test.cjs)

The local resale candidate gates listing, repricing and buying during an entry pause. The current seller can still cancel, and recipients can withdraw existing credit. Use `getActiveResale(tokenId)` for a buyer-facing quote. It returns the current seller, exact gross wei amount and listing version. Paused, sold, transferred, cancelled and revoked listings return an inactive quote with zero seller and price. The raw record can retain terms from an earlier owner. A purchase checks the version, exact price and uninterrupted owner approval again in its own transaction. An otherwise current Core listing resumes when an entry pause ends. [Resale candidate](../../contracts/replacement/OrdinaryArtResales.sol) · [Quote and purchase tests](../../test/OrdinaryArtResales.test.cjs)

The paired NFT checks the current admission of the operator for both single-token and wallet-wide approvals. Removing and later readmitting an external operator starts a new approval generation. Each owner chooses which grants to give again. Direct wallet transfers and public metadata reads remain available. The Safe-bound candidate adds a public 48-hour admission queue, immediate cancellation and immediate removal. The activation transaction can be submitted by anyone after the delay for the announced address. Rehearse the exact release and operator on Base Sepolia before public activation. [Admission logic](../../contracts/replacement/MarketplaceAdmissions.sol) · [Paired NFT](../../contracts/replacement/SettledArtworkNFT.sol) · [External sale requirements](../canon/CONTRACT_REWORK_PLAN.md#same-asking-price-across-marketplaces)

Local EVM cases cover the four resale shares, cancellation during a pause, simultaneous approval routes, a transfer away and back, rejected NFT delivery, repeat purchases and indivisible prices. Tests compare largest-remainder payouts with an independent integer calculation across all 200 price residues and four large amounts, including the largest uint256. The fresh pair's storage layout now includes external operator admissions in the engine and two approval-generation mappings in the NFT. The compiler record is for new deployments only. [Compiler layout](C1_REPLACEMENT_STORAGE_2026-11-19.json) · [Whole-wei payouts](../canon/14_PROTOCOL_REVENUE_AND_TEAM.md#whole-wei-payouts-on-the-new-ordinary-market) · [Payment tests](../../test/TreasuryBoundOrdinaryArt.test.cjs)

### Voluntary purchase by the second-highest bidder

On November 19 the founder delegated the choice for new ordinary auctions. Recording the original winner's unpaid default opens one 24-hour offer to the highest distinct losing bidder. Bids are strictly increasing, and the current highest bidder cannot outbid themselves. The displaced leader is therefore the runner-up whenever a new bid succeeds, even if an earlier bidder returns. Recording this during bidding keeps default processing independent of the number of bids.

| Event | Contract and customer outcome |
| --- | --- |
| Default with one bidder | Credit the original winning deposit 80/20 and release the work for a new auction. |
| Default with a runner-up | Credit the same 80/20 split once. Reserve the work for that bidder through 24 hours from the default block. Existing losing deposits remain refundable through the normal path. |
| Runner-up accepts | Their own wallet supplies the exact full amount of their last accepted bid. Mint once to that buyer, apply the primary sale split to the paid price, and establish that price as the floor. Preserve the original winning bid in history. |
| Runner-up declines or the offer expires | Release the work for the creator. No secondary penalty or further offer. Acceptance remains available through the exact deadline; expiry is valid strictly afterward. |

The permissionless automation interface reports an action for one known auction ID; the contract validates it again at inclusion. An automation service can close bidding, finalize default or expire an offer, while acceptance always belongs to the eligible buyer. Indexers must distinguish the original high bidder, the default, the offer and the actual settlement before showing a sale or naming a First Collector. Extend the new deployment's indexer and UI using these events in the fresh rehearsal. A paid/background executor requires an operational gas budget before activation.

During C13, configure a separate Base Sepolia [indexer listener](../../src/indexer/event-listener.js) with the reviewed replacement Core and NFT addresses. Call `readOrdinarySettlement` with the pair's expected runtime hashes, chain ID, canonical block number and hash, transaction hash, decimal auction ID and the existing authority-lifetime callback used by [deployment reads](../../src/indexer/nft-deployment-proof.js). The reader checks both immutable links at that block and waits for RPC finality by rejecting earlier observations. The [receipt projection](../../src/indexer/ordinary-settlement.js) takes the First Collector from issuance and the matching mint transfer, and the paid price from the settlement. It checks any accepted runner-up offer against both. A later transfer in the same transaction does not change the First Collector.

The read-only ordinary settlement reader accepts an explicitly selected Base Sepolia or Base mainnet chain and pins both contracts to reviewed runtime hashes. A local fixture verifies the same auction identity on each chain and rejects a mismatched RPC or paired Core. Live mainnet verification needs a released pair and its settlement receipt. The reader writes no journal or database rows. The prototype settlement table uses `(chain_id, auction_id)` as its unique key. Adding the deployment identity to storage, replay, notifications and public reads is necessary before simultaneously indexing two contracts on the same chain.

The [ArtSoul keeper](../runbooks/ORDINARY_AUCTION_KEEPER.md) now builds its own bounded deadline schedule from confirmed contract events and checks each action against current state. The existing indexer host can run it as a separate process with isolated state. A public observer uses no signing credentials. A dedicated test gas wallet and spending limits belong to the subsequent Base Sepolia rehearsal. Mainnet signing remains a separate launch decision.

## Treasury custody and remaining owner choices

The [treasury-bound candidate](../../contracts/replacement/TreasuryBoundOrdinaryArt.sol) fixes separate protocol and ecosystem recipients and a third account for the entry pause and external marketplace admissions at construction. The security account has no claim on either treasury's credit. Local tests cover primary sales, default and the four resale shares with separate treasury withdrawals, including during a pause. An isolated local rehearsal with Safe 1.4.1 accepted two owner approvals for a 2-of-3 pause and rejected a single approval. Before deployment, check all three roles against the current private custody register. The [read-only verification procedure](../RESOURCE_GATED_WORK.md#checking-the-three-contract-custody-roles) compares intended ownership, threshold, contract code, extensions and role bindings.

A November 19 rehearsal used three separate Safe L2 1.5.0 accounts on Hardhat chain 31337, synthetic owners, two confirmations and the treasury-bound test fixture. The release bytecode for the proxy, singleton, factory and compatibility handler matched the published artifacts. One approval could not pause entry. Two approvals paused entry, withdrew the full 0.025 ETH protocol credit from a 1 ETH local primary sale during the pause, and resumed entry. The protocol Safe balance increase matched its cleared credit. The three successful executions consumed respectively 109,730, 97,357 and 70,707 gas on the local chain. [Safe release registry](https://github.com/safe-global/safe-deployments/tree/ca9cb0d2d5f5175fc8e41d579f356748d2bc1c62/src/assets/v1.5.0)

| Choice | Concrete recommendation to review; not approval |
| --- | --- |
| Retirement and critical powers | Specify who may close new publication entry, change permitted configuration and authorize any exceptional, consented migration. The selected deployment lifetime preserves original NFT identity and obligations. No general mint/escrow override |
| Accounting configuration | The Safe addresses and largest-remainder payout rule are selected. Verify their release binding and determine the bounded refund execution limits and alternate recipient policy. |
| Governance and sold rights | Verify the selected Safe and admission policy in the release. Decide any remaining recovery and metadata-change policy. Website Team/moderator approval does not grant contract custody. Construction-time pairing cannot hide a later upgrade bypass |
| Optional payment automation/routes | Choose whether to add payment prefunding, protected-account delegation or execution reserves, and their costs/recovery. Choose a concrete route/refund policy before activation. These choices can remain deferred for the native-ETH replacement slice |

Permissionless default requires an on-chain call. Funding an automatic executor remains a separate decision.

## Next two bounded steps

1. **Executable specification, without Solidity:** the November 16
   [bounded accounting model](../audits/C1_EXECUTABLE_ACCOUNTING_MODEL_2026-11-16.md)
   now verifies deployment-scoped issuance and disjoint refund/credit obligations
   with 1,024 states and 28,672 transitions plus replays. On November 18,
   separate direct-payment cases checked exact winner funding, excess credit and
   once-only issuance. A local EVM check exercised three simultaneous prototype
   auctions at the deposit boundary. Extend model coverage using the selected
   payment window and entry pause. Represent unselected policy
   as explicit input, not a default. Exercise two deployments both using ID 1,
   new deployment activation during an old funded auction, unauthorized/repeated
   mint requests, full/failed/duplicate refunds, reserve accounting with reserves
   disabled, and pause across expiry. Assert isolation, conservation, once-only
   issuance and the absence of a penalty caused solely by an administrative block.
   Keep the existing 55 characterization tests as historical behavior evidence;
   model tests cannot prove replacement bytecode or close C1.
2. **Complete the candidate:** finish the exact capability
   graph, action/deadline table, replacement state inventory and event/interface
   specification for just native-ETH publish → auction → settle → resale →
   withdraw. Review it against the current storage export without proposing an
   in-place conversion. Review the local primary-auction, NFT, refund and resale code
   alongside its [compiler record](C1_REPLACEMENT_STORAGE_2026-11-19.json). Its regression suite must reject the
   reproduced hazards, preserve old liabilities and prove initialization and
   atomicity before independent review or any fresh testnet rehearsal.

This proposal is linked under canonical backlog C1 and the rework plan's delivery
section. Source/hash/reference review validates the proposal; the linked model
records its separate executable evidence. No live funds, role, storage, network,
dependency or contract behavior changed.
### November 20 ordinary refund measurements

Run `node scripts/measure-ordinary-refunds.cjs` after compiling the [concrete candidate](../../contracts/replacement/OrdinaryMarket.sol). The script creates distinct creditors and measures each batch from the same closed-auction state in a disposable Hardhat network. It checks the cursor and every paid-versus-credited result. The receiver gas allowance was 30,000 for all runs.

| Batch count | Wallet payments, gas used | Accepting contract payments | Payments deferred to creditor balances |
| ---: | ---: | ---: | ---: |
| 1 | 64,481 | 66,659 | 88,978 |
| 4 | 116,811 | 123,780 | 202,801 |
| 8 | 190,552 | 204,491 | 354,565 |
| 16 | 338,043 | 365,921 | 658,105 |

Use a cap of 8 and a receiver allowance of 30,000 as the starting configuration for the Base Sepolia rehearsal. A caller can request a smaller batch. These numbers are measured execution gas for the stated receivers, not a worst case or a fee quote. Include a Safe recipient, Base data fees and actual gas estimates in the public rehearsal. Mainnet constructor inputs require explicit review against that concrete build. A failed delivery keeps the recipient's full claim withdrawable.
