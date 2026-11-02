# C1 — Decision records and accounting invariants

Status: **DRAFT; no architecture approval or implementation authorization.**
Source reviewed: `0ccb0597159b0cf09ad028d00979892c16257da2`, November 2, 2026.
This annex turns the existing rework direction into specific decisions and
acceptance cases; it does not replace the rework roadmap.

Authority: [October 26 research direction](../canon/CHANGELOG_2026-10-26_CONTRACT_EXTENSIBILITY.md).
Baseline: [Bible §§1–5, 9, 14, 17](../canon/ARTSOUL_CANON_BIBLE_FULL.md).
Use alongside [Rework Plan §§2, 5, 6](../canon/CONTRACT_REWORK_PLAN.md), which already
contains topology alternatives, the threat list and the stale-listing reproduction.
Existing [A1 security evidence](../security/A1_SECURITY_AND_MIGRATION_AUDIT.md)
covers application/data boundaries; it is not replacement-contract acceptance.

## 1. Review contract

- **FACT** means current source behavior, not a mainnet guarantee.
- **REQUIREMENT** means already recorded canon or approved rework direction.
- **RECOMMENDATION** is a reviewable design preference, not an adopted rule.
- **UNDECIDED** requires an explicit decision before replacement Solidity.

The four records below connect a decision to protected state, money, authority,
events and falsifiable acceptance cases. They do not select signer addresses,
thresholds, delays, proxy topology, new fees, currencies or collection parameters.
All examples are native-ETH arithmetic in wei, not new product price parameters.
Generic Launch behavior remains distinct from ordinary 1/1 and Partner Collections.

## 2. D1 — Deployment identity, state ownership and mint authority

**FACT.** [NFT:15](../../contracts/ArtSoulNFT.sol#L15) maps integer artwork IDs to
tokens without a Core/deployment namespace. [NFT:43](../../contracts/ArtSoulNFT.sol#L43)
lets the owner replace the single Core authority; only that address may mint.
[NFT:65](../../contracts/ArtSoulNFT.sol#L65) rejects an already-used artwork ID.
[Core:74](../../contracts/ArtSoulCore.sol#L74) owns its own artwork counter;
[Core:398](../../contracts/ArtSoulCore.sol#L398) calls the configured NFT at settlement.
Thus switching authority to a new Core can prevent old pending settlements from
minting; reusing an existing NFT with restarted IDs can collide. This is a future
rotation hazard, not evidence of a rotation performed on the current deployment.

**REQUIREMENT.** Identity includes deployment; old rights and accrued claims must
survive new versions. Creator/First Collector cannot be reassigned by a new module.
Application Team/moderator permissions confer no contract upgrade or custody power.

| Protected record | Present owner | Required decision in the replacement |
| --- | --- | --- |
| Artwork ID, creator, metadata reference | Core artwork mapping | Stable registry identity versus engine-scoped records |
| Token/artwork identity and mint authority | NFT mappings and mutable `core` | Separate NFT per version versus a version-aware shared registry/NFT |
| Auction terms, deposits, credits | Core mappings | Which immutable/versioned engine retains each outstanding obligation |
| Mint authorization consumed once | NFT artwork mapping | Bind authorized source, artwork and successful settlement without ID collision |

**RECOMMENDATION.** Specify the identity and custody graph before deciding whether
any component needs a proxy. Preserve old liabilities in their original ledger;
do not give a newly registered module arbitrary access to them.
For shared identity, compare scoped authorization with an immutable registry;
for separate deployments, document how provenance resolves both versions.

**UNDECIDED.** Actual boundaries; mint-authority rotation/removal and drain policy;
ultimate upgrade powers; governance/delay/emergency policy; migration consent.
This ownership map is not a Solidity storage-slot layout or proxy safety proof.
Once topology is chosen, export inherited and declared layouts and specify every
permitted state transition; do not infer compatibility from matching field names.

**Acceptance cases to specify:** two versions both using local artwork ID 1;
old funded auction during authority rotation; malicious/removed module mint;
duplicate successful-path delivery; creator/First Collector preservation;
old credit withdrawal after deploying a new engine. Reuse
[current authorization checks](../../test/ArtSoulV41.test.cjs#L853), but those
do not prove safe rotation or mixed-version operation.

## 3. D2 — Pause, deadlines and reachable exit paths

**FACT.** The following matrix describes current modifiers and checks only.
“Available” still requires all normal authorization, time and state conditions.

| Action | Core while Core paused | Generic Launch while Launch paused |
| --- | --- | --- |
| Register artwork / create auction | Blocked | Not the same lifecycle |
| New funded entry | `placeBid` blocked | `mintPhase` and `bid` blocked |
| End/finalize expired auction | `endAuction` blocked | `finalizeAuction` available |
| Winner settlement / settled NFT claim | `settleAuction` blocked | `claimAuction` available |
| Default a missed settlement | `claimSettlementDefault` blocked | No equivalent deferred-payment default |
| Claim refund / withdraw existing credit | `withdraw` available | `claimAuctionRefund` and `withdrawTo` available |
| List / cancel / buy resale | All blocked | No resale engine here |
| NFT approval / wallet transfer | NFT has no Core-pause check | Inherited token transfers are not pause-gated |
| Administrative configuration | `setTreasury` available to owner | Pre-lock configuration remains subject to lock/owner checks |

Sources: [Core:223–328](../../contracts/ArtSoulCore.sol#L223),
[Core:356–574](../../contracts/ArtSoulCore.sol#L356),
[Launch:169–255](../../contracts/launch/CollectionLaunch.sol#L169).
Forge is separate: [craft:54](../../contracts/launch/CollectionForge.sol#L54)
requires its own unpaused state and an unpaused, locked ingredient Launch.

**FACT.** Core accepts bids only at `t < endTime`; ending requires `t >= endTime`.
Ending with a winner assigns `settlementDeadline = executionTime + 24 hours`.
Settlement permits `t == settlementDeadline`; default requires `t > deadline`.
Pause does not stop either clock. A pause spanning settlement expiry can therefore
remove the winner's settlement opportunity while later allowing default.
Current anti-sniping extends from the previous end, capped by the original end
plus its configured constant; these prototype constants are not selected anew here.

**REQUIREMENT.** Preserve approved durations/outcomes and deterministic permissionless
no-bid finalization. No NFT or floor arises from no-bid/default. An administrator
must not silently obtain power to extend economic deadlines or trap accrued claims.

**RECOMMENDATION.** Review entry pause separately from fulfillment/exit controls.
Compare leaving validated fulfillment open with any expressly approved alternative;
state the exploit-containment tradeoff rather than assuming every action can remain open.
Keep already-created credits independently reachable subject to their authorization.

**UNDECIDED.** Which fulfillment paths can pause; expiry during emergency;
settlement-window anchor; no-bid lazy trigger; exit guarantees and emergency powers.
No clock compensation, grace period or delay value is proposed as approved policy.

**Acceptance cases:** `endTime - 1`, equality and `+1`; delayed end transaction;
`deadline - 1`, equality and `+1`; pause before/after funding and across expiry;
withdrawal during pause; no-bid repeated finalization; unaffected parallel auctions.
[Core pause test:874](../../test/ArtSoulV41.test.cjs#L874) covers registration denial
and invalid transitions, not the funded pause-expiry case.
[Launch pause test:162](../../test/CollectionLaunch.test.cjs#L162) already verifies
its distinct settlement/claim/withdrawal policy; retain it without generalizing it.

## 4. D3 — Exact liabilities, rounding and failed-recipient recovery

**FACT.** Core immediately credits the previous bidder's full deposit when outbid
([311](../../contracts/ArtSoulCore.sol#L311)). Its event `BidDepositWithdrawn` describes
that credit creation, not an ETH transfer. Actual [withdraw:564](../../contracts/ArtSoulCore.sol#L564)
pays only `msg.sender`; failure reverts the credit debit. Launch's
[withdrawTo:238](../../contracts/launch/CollectionLaunch.sol#L238) allows the creditor
to choose a recipient. Neither fact proves canonical bounded automatic refund execution.

Let `C = sum(credits)`, `D = sum(live locked deposits)` and `B = contract ETH balance`.
For present Core, require `C + D <= B`; unsolicited ETH can make this an inequality.
Do not assign surplus ETH to an owner or sweep policy by inference.
For current Launch, separately define `L = C + O + R <= B`, where `O` is held
winning bid value in open phases and `R` is closed winners' uncredited excess
over clearing price. Losers already credited are excluded from `O` and `R`.
These are model sums for verification, not proposed unbounded on-chain loops.

For a Core winning price `P` and locked deposit `d`, existing settlement computes:
`credited = min(d,P)`, `requiredPayment = P-credited`, `excess = d-credited`.
Conservation is `d + requiredPayment = P + excess`; clearing `d` and crediting
proceeds/excess must be atomic. On default, distribute only the defaulted winner's
`d`; other bidders' refundable obligations remain untouched.

**REQUIREMENT.** Every deposit is accounted once. Future bounded refund execution
must transition each obligation exactly once to paid or withdrawable credit;
retry, reentrancy and a failing recipient cannot duplicate or block unrelated payment.
Conservation spans every selected settlement boundary without counting one credit twice.

Use `W=10000` and integer floor `q_i=floor(P*w_i/W)` for explicit arithmetic review.
Canonical weight vectors are primary `(9750,250)`, resale `(9250,550,100,100)`
and default `(8000,2000)`, in their canonical recipient order.
Define unassigned remainder `r=P-sum(q_i)`; for `n` recipients, `0 <= r < n`.
The final design must assign exactly `r` once under an approved rule; this draft
does **not** assign it to any recipient or create a new dust/treasury entitlement.

| Arithmetic vector | Independent floor quotas, in canonical order | Unassigned wei |
| --- | --- | ---: |
| Primary, `P=10001` | `9750, 250` | 1 |
| Resale, `P=10001` | `9250, 550, 100, 100` | 1 |
| Resale, `P=9999` | `9249, 549, 99, 99` | 3 |
| Default, `d=10000000000000001` | `8000000000000000, 2000000000000000` | 1 |

Current Core primary/default instead floor the protocol share and give the remainder
to the creator. Current resale floors prototype 2.5%/7.5% shares and gives the
remainder to the seller; it has no separate ecosystem share. These source facts
([380](../../contracts/ArtSoulCore.sol#L380), [431](../../contracts/ArtSoulCore.sol#L431),
[507](../../contracts/ArtSoulCore.sol#L507)) are not the future rounding decision.

Current deposit/increment arithmetic, retained by the rework baseline:
`M=10000000000000000`, `deposit(b)=max(M,ceil(b/10))`,
`nextBid(b)=b+max(M,ceil(b/40))` when a highest bid exists; first bid uses start price.
The ceiling vectors below characterize [Core:587–616](../../contracts/ArtSoulCore.sol#L587).
They introduce no new deposit, increment or admissible-value parameter.

| Existing highest bid `b` | Required deposit for `b` | Next minimum bid |
| ---: | ---: | ---: |
| 1 | 10000000000000000 | 10000000000000001 |
| 100000000000000000 | 10000000000000000 | 110000000000000000 |
| 100000000000000001 | 10000000000000001 | 110000000000000001 |
| 400000000000000001 | 40000000000000001 | 410000000000000002 |

Excess-deposit vector: `P=5000000000000000`, `d=10000000000000000` gives required
payment `0`, excess `5000000000000000`; price plus excess equals the original deposit.
Its exact primary split is creator `4875000000000000`, protocol `125000000000000`.

**RECOMMENDATION.** Specify one obligation state transition model before selecting
push/batch/credit mechanics. Evaluate creditor-authorized alternate recipients for
rejecting wallets; prohibit operator-chosen diversion. Use overflow-safe arithmetic
equivalent to the equations and test upper representable bounds without inventing caps.

**UNDECIDED.** Remainder assignment; refund-recipient authorization; bounded executor
limits and operational gas payer; when treasury destinations become fixed for funded
sales. [Core:574](../../contracts/ArtSoulCore.sol#L574) currently changes the treasury
used by later settlement/default/resale; it does not move already-recorded credits.

**Acceptance cases:** all vectors; zero/double obligations; over-deposit; multiple
auctions sharing recipients; partial batch/retry; recipient revert/reentry; withdrawal
after failed push; treasury change while funded; forced ETH surplus; old/new ledgers.
Reuse [outbid/withdrawal tests](../../test/ArtSoulV41.test.cjs#L414) and
[Launch rejecting-payee tests](../../test/CollectionLaunch.test.cjs#L175).
Their current coverage is not acceptance of the future refund architecture.

## 5. D4 — Listing authorization lifetime and reconstructible events

**FACT.** [Listing:44](../../contracts/ArtSoulCore.sol#L44) stores seller, price and
active only. [List:451](../../contracts/ArtSoulCore.sol#L451) replaces that record;
[cancel:480](../../contracts/ArtSoulCore.sol#L480) clears active without an event.
[Buy:488](../../contracts/ArtSoulCore.sol#L488) checks current owner/price/floor,
then transfers through the NFT. NFT has no transfer epoch in current source.
The main plan already retains the successful transfer-away/return stale purchase.

**REQUIREMENT.** Transfer, cancellation and replacement invalidate old authorization;
ownership returning must not revive it. Enforce this on chain, not solely in an indexer.

**RECOMMENDATION.** Define authorization identity as deployment/item plus a consumed
listing version and NFT transfer state. Specify transition observability, including
old/new version and reason where needed, before selecting event names or ABI fields.
Do not claim an epoch for external NFTs that cannot enforce the chosen policy.

| Transition | Required acceptance observation | Unresolved policy |
| --- | --- | --- |
| List / replace | New terms invalidate prior authorization | Expiry and external order scope |
| Cancel | Old authorization remains unusable; reconstructible cancellation | Permission to cancel while paused |
| Transfer away / return | Old listing never becomes executable again | External NFT compatibility |
| Approval revoke / restore | Unapproved execution fails | Whether revocation permanently cancels the listing |
| Buy / competing buy | Exactly one execution at the accepted item/terms | Future signed-intent interface |

**Acceptance cases:** preserve the existing round-trip reproduction; add same-price
replacement, cancel/relist, approval races, two competing buyers, cross-engine replay
and indexer rebuild from events. Extend [resale tests:643–791](../../test/ArtSoulV41.test.cjs#L643)
after the interface/policy decision, rather than rewriting prototype behavior now.

## 6. Decision and verification limits

The annex is ready for policy comparison, not C1 sign-off. Populate decisions and
their canon impacts explicitly; no unanswered cell becomes a constructor default.
No Solidity, schema, signing, deployment or remote operation was performed.
Integer vectors were checked locally with JavaScript BigInt; no contract tests ran.
This is source-level evidence, not a renewed live-bytecode or external security audit.
