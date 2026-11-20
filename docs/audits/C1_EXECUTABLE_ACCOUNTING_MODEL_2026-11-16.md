# C1 — Executable issuance and refund model

Status: **Locally verified abstract specification. C1 remains open.**
This report records model and prototype evidence. The later [ordinary-work
candidate and selected entry pause](../architecture/C1_REPLACEMENT_BOUNDARIES_2026-11-16.md#selected-entry-pause-and-payment-window)
have separate Solidity tests.

The [Node test](../../test/c1-replacement-accounting-model.test.mjs) makes a bounded
part of [D1/D3](../architecture/C1_DECISION_INVARIANTS_2026-11-02.md) and the
[replacement boundaries](../architecture/C1_REPLACEMENT_BOUNDARIES_2026-11-16.md)
executable. It uses only built-in Node modules and is collected by the existing
unit-test runner. It does not duplicate the current-contract characterization or
claim to repair its demonstrated hazards.

## Modeled boundary

- Identity is `(chain, engine, local ID)`. An unconsumed issuance obligation or
  credit survives adding another deployment; identical local IDs do not collide.
  Issuance uses recorded Creator/First Collector/metadata and is consumed once.
  Missing, pending, no-bid, defaulted and wrong-source requests cannot issue.
- **The generated refund and issuance graph takes settled works and losing-deposit
  eligibility as inputs.** The direct settlement cases below start one step earlier,
  with a recorded winner and a pending payment. Both fixtures assume the auction
  lifecycle has established eligibility. Caller identity is an input to the model.
- Each funded obligation occupies exactly one of locked deposit `D`, payable
  refund `O`, withdrawable credit `C`, or paid. Refund failure moves the full
  obligation into credit; failed withdrawal preserves it. Payment retains the
  original amount and creditor. Another deposit belonging to the same creditor
  remains independent. Refund execution does not require losing-bidder action.
- For every deployment, `D + O + C + paid = funded` and
  `balance + paid = funded + unsolicitedSurplus`; therefore `D + O + C <= balance`.
  Optional purchase prefunding and execution reserves are absent (`F = R = 0`).
  Surplus is not silently allocated to users or an operator.
- Batch limits and transfer success/failure are explicit test inputs. A rejecting
  recipient does not prevent the next bounded transfer; duplicate batch entries
  cannot pay twice. A credit cannot also be spent through the old refund path.
  Rejected/replayed commands preserve abstract state without selecting whether a
  future ABI must revert or return a no-op result.

Integral amounts, namespace labels and batch bounds are fixtures, not new
economic values, activated chains, governance roles or operational limits.
The November 19 round-history case also covers the exact 80/20 allocation for a
divisible defaulted deposit. Fee rounding, alternate refund recipients
and paid automation remain open.

## Executed evidence

```text
node --test test/c1-replacement-accounting-model.test.mjs
```

November 16 result: **6 tests passed**, exit 0, approximately 3.6 seconds locally.
The generated case exhausts its finite abstraction: two deployments, two eligible
deposits per deployment, four locations per obligation and two independent
issuance flags. It visits **1,024 states**, checks **28,672 outgoing transitions**
and their immediate replays, and checks conservation/provenance and unchanged
unrelated-deployment state at every transition. The maximum shortest path to a
state is ten commands. Equivalent receipt orderings share a state; this is not
an enumeration of all transaction histories or possible protocol inputs.

Focused cases additionally cover the same engine/local ID in another logical
chain namespace, new deployment creation while old credits/issuance remain,
mixed success/failure batches, repeated batch IDs and non-refundable deposits.
Controlled corruptions prove the invariant checker rejects duplicate or missing
obligations, changed creditors/amounts, per-deployment insolvency hidden by another
deployment's balance, duplicate payout records and unscoped issuance identity.

The generated checks operate on atomic JavaScript transitions. Solidity storage,
external-call rollback, gas bounds, signatures and live migration require
independent evidence.

## November 18 — Exact native payment before issuance

For a winning bid of `P` and its locked deposit `d`, the amount due is
`P − min(P, d)`. Any excess `d − min(P, d)` belongs to the winner. The direct
settlement model tests a deposit of 7 units against prices of 3, 7, 8 and 19.
Only the recorded winner can settle with the exact additional amount. A successful
transition sets the floor, records the First Collector and issues once. Repeating
the request leaves the state intact. The model reconciles total sale proceeds,
winner credit and remaining escrow within each deployment.

The [prototype contract test](../../test/ArtSoulV41.test.cjs) places one bidder
in three simultaneous auctions at the minimum deposit and one wei on either side.
The first settlement leaves one wei in withdrawable credit. With that credit
and the third deposit still present, the higher-priced work remains unminted
until the bidder supplies its own one wei. The three receipts, token owners,
floors, winner credit and final contract balance reconcile on the local EVM.

```text
node --test test/c1-replacement-accounting-model.test.mjs
npx --no-install hardhat test --network hardhat test/ArtSoulV41.test.cjs --grep "auction ending and settlement"
```

At the first November 18 checkpoint all seven model tests and four focused prototype contract tests passed.
The 1,024-state count above describes the original refund and issuance graph.
The four new funding vectors are separate deterministic cases. Replacement
bytecode, governance and pause/deadline behavior were outside that November 18 run.

## November 18 — Closing and reopening ordinary auctions

The eighth model test follows an unminted work with an expired auction and
zero bids. Closing it permissionlessly and then relisting as its creator yields
the same old and new auction records and ordered events as one authorized relist
that performs the cleanup. Neither path issues an NFT, establishes a floor or
changes a funded auction for another work. A stale close still addresses its
original auction. This specifies the intended replacement behavior.

On the current Core, two local EVM tests compare the actions available at the
same block timestamp one second before, exactly at and one second after each
boundary. Bids stop when closing becomes available. Payment remains available
at the precise deadline, and default becomes available one second later.
The delayed-finalization case confirms the prototype starts its 24-hour payment
window when finalization executes. Both tests run in the six-case
`auction ending and settlement` suite. The November 19 decision retains that
clock anchor and permits payment throughout an entry pause. The [replacement
suite](../../test/OrdinaryArtAuctions.test.cjs) exercises this separately.

## November 19 — Losing deposits when an earlier bidder wins

The ninth [model test](../../test/c1-replacement-accounting-model.test.mjs)
uses four accepted bids on one work. Each displaced bid identifies a distinct
deposit and creditor. In one schedule all losing deposits remain outstanding
through the terminal outcome. In another, one refund succeeds and one becomes
credit before the final bid. The second schedule covers earlier refunds where
supported. It does not require the replacement to pay a refund before close.

| Bid in order | Bidder | Bid (ETH) | Deposited (ETH) | Expected disposition |
| --- | --- | ---: | ---: | --- |
| 1 | Alice | 0.10 | 0.01 | Transfer fails. Alice can withdraw this credit even after winning or defaulting on bid 4. |
| 2 | Bob | 0.20 | 0.02 | Paid once in the first batch. Repeating finalization or the batch preserves the payment. |
| 3 | Carol | 0.30 | 0.03 | Full refund remains payable after either terminal outcome. |
| 4 | Alice | 0.40 | 0.04 | Winning deposit. Settlement requires another 0.36 ETH and establishes the 0.40 ETH floor. On default the creator is owed 0.032 ETH and the protocol 0.008 ETH. |

Each refund schedule is run through settlement and default. Sending 0.35 ETH
would spend Alice's earlier 0.01 ETH losing deposit again, while 0.40 ETH
would ignore her locked 0.04 ETH winning deposit. Both amounts leave the
model state unchanged. Default leaves the work unminted with no floor.
All four paths preserve the three earlier obligations, pay each exactly once
and reconcile the custody balance. Valid bids and expiry are fixture inputs.
The eventual Solidity design still needs to prove its transaction behavior,
gas bound and error recovery. No rounding rule is needed for these amounts.

Running the Node command above on November 19 passed all nine tests. The
generated graph still checks 1,024 states and 28,672 transitions plus replay.
The four-bid trace runs separately.

The deployment-isolation case now starts with an already-issued NFT, an open
funded auction and an unpaid refund credit. Adding a second engine on the same
chain preserves the first token's issue record. The original auction can settle
and its creditor can withdraw the older refund. ERC-721 ownership reads and
transfer behavior must still be checked against the eventual contracts.

## November 19 — Purchase by the second bidder after default

The tenth [model test](../../test/c1-replacement-accounting-model.test.mjs) derives the eligible buyer from the bid history and exercises the 24-hour offer after a winner defaults. It reconciles the full purchase price with each possible disposition of the losing deposit: pending refund, completed refund or withdrawable credit. It also checks the buyer, the floor, the original winner's penalty and the absence of a third offer. The 1,024-state count above describes the original ledger exploration.

The six [local contract cases](../../test/OrdinaryRunnerUp.test.cjs) independently exercise actual minting, failed delivery and retry, decline, expiration, relisting and a single-bidder default. Consumer tests for the new events and a fresh Base Sepolia rehearsal remain open.

## Next bounded action

Use the [selected ordinary-artwork pairing](../architecture/C1_REPLACEMENT_BOUNDARIES_2026-11-16.md#ordinary-artworks-after-mainnet-launch),
record the remaining authority and accounting decisions, and specify the
replacement events and interfaces for C1 sign-off. In C11, run the funding
and issuance assertions against the replacement implementation, measure
refund batch gas and verify atomic rollback.
