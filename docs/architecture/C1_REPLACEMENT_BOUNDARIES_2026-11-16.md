# C1 — Minimal replacement boundaries

Status: **DRAFTED proposal; C1 remains open. No replacement Solidity or deployment.**
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

## Proposed smallest deployment unit

Recommend one **immutable engine plus its permanently paired NFT** for each
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
Proposed retirement stops new entry only; existing fulfillment and withdrawals
remain supported and indexed. Do not require every creditor to withdraw before a
new deployment can exist, or erase old claims after an arbitrary deadline.
Closing old entry and any exceptional recovery/migration need the authority and
exit policy below. Existing prototype contracts cannot acquire these guarantees
through configuration; their historical liabilities require their own inventory.

A shared NFT/registry could preserve a single collection address, but would need
permanent issuer namespaces, scoped mint consumption and an admission/removal
policy that cannot strand old obligations. It adds a shared trust boundary without
an established requirement for this first slice. Retain it as an alternative only
if keeping one NFT address is a founder requirement. Proxy powers are likewise
unselected; this candidate uses no upgradeable custody or issuer component.

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

The engine creates protocol/creator/seller/ecosystem credits using the approved
splits; the remainder rule and when treasury destinations become fixed still
need resolution. New engines, staff, keepers and payment adapters cannot debit
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

## Owner choices still required

| Choice | Concrete recommendation to review; not approval |
| --- | --- |
| Deployment lifetime and critical powers | Adopt immutable engine/NFT pairs; accept separate NFT addresses and repair through reviewed new deployments. Specify who can close new entry, change permitted configuration and authorize exceptional migration. No general mint/escrow override |
| Pause and payment opportunity | Prefer an entry pause with existing settlement, deterministic finalization/default, cancellation and credit withdrawal still reachable. Include transitive NFT dependencies. If fulfillment must also pause for exploit containment, explicitly define clock/exit treatment before normal default can resume. Keep the approved 24-hour window; decide its anchor and emergency handling without inventing a grace period |
| Accounting configuration | Decide rounding remainder ownership, treasury binding time, authorized alternate refund recipients and bounded execution limits; preserve all approved percentages and deposit rules |
| Governance and sold rights | Select actual multisig authority, thresholds/delays/recovery where applicable, marketplace administration and metadata-change policy. Website Team/moderator approval does not grant contract custody. Construction-time pairing cannot hide a later upgrade bypass |
| Optional payment automation/routes | Choose whether to add payment prefunding, protected-account delegation or execution reserves, and their costs/recovery. Choose a concrete route/refund policy before activation. These choices can remain deferred for the native-ETH replacement slice |

No paused-fulfillment design or automatic default is accepted until the payment
opportunity case is resolved. No new financial value, role address, delay, reserve
fee, provider or enabled network is selected here.

## Next two bounded steps

1. **Executable specification, without Solidity:** add a small local state-model
   fixture/test using the existing Node test tooling. Represent unselected policy
   as explicit input, not a default. Exercise two deployments both using ID 1,
   new deployment activation during an old funded auction, unauthorized/repeated
   mint requests, full/failed/duplicate refunds, reserve accounting with reserves
   disabled, and pause across expiry. Assert isolation, conservation, once-only
   issuance and the absence of a penalty caused solely by an administrative block.
   Keep the existing 55 characterization tests as historical behavior evidence;
   model tests cannot prove replacement bytecode or close C1.
2. **After the consequential choices are recorded:** complete the exact capability
   graph, action/deadline table, replacement state inventory and event/interface
   specification for just native-ETH publish → auction → settle → resale →
   withdraw. Review it against the current storage export without proposing an
   in-place conversion. Record C1 sign-off, then implement the smallest C2/C3 slice
   and export its actual compiler layout. Its regression suite must reject the
   reproduced hazards, preserve old liabilities and prove initialization and
   atomicity before independent review or any fresh testnet rehearsal.

Documentation follow-up: link this proposal under canonical backlog C1 and the
rework plan's delivery section in the integrating change. Existing staged release
documents were intentionally not edited by this slice. Source/hash/reference
review is the validation for this document; no live RPC, funds, role, storage,
network, dependency or contract behavior changed.
