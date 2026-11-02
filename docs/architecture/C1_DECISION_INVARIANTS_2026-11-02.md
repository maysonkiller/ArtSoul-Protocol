# C1 — Decision records and accounting invariants

Status: **DRAFT; no architecture approval or implementation authorization.**
Source reviewed: `0ccb0597159b0cf09ad028d00979892c16257da2`, November 2, 2026.
This annex turns the existing rework direction into specific decisions and
acceptance cases; it does not replace the rework roadmap.

Authority: [October 26 research direction](../canon/CHANGELOG_2026-10-26_CONTRACT_EXTENSIBILITY.md).
Baseline: [Bible §§1–5, 9, 11, 14, 17](../canon/ARTSOUL_CANON_BIBLE_FULL.md).
Use alongside [Rework Plan §§2, 5, 6](../canon/CONTRACT_REWORK_PLAN.md), which already
contains topology alternatives, the threat list and the stale-listing reproduction.
Existing [A1 security evidence](../security/A1_SECURITY_AND_MIGRATION_AUDIT.md)
covers application/data boundaries; it is not replacement-contract acceptance.

## 1. Review contract

- **FACT** means current source behavior, not a mainnet guarantee.
- **REQUIREMENT** means already recorded canon or approved rework direction.
- **RECOMMENDATION** is a reviewable design preference, not an adopted rule.
- **UNDECIDED** requires an explicit decision before replacement Solidity.

The six records below connect a decision to protected state, money, authority,
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
The [current-source storage baseline](../audits/C1_STORAGE_BASELINE_2026-11-02.md)
now records six existing layouts and immutable bindings with reproducible compiler
evidence. It does not select the replacement topology or establish compatibility.
Once topology is chosen, export inherited and declared layouts and specify every
permitted state transition; do not infer compatibility from matching field names.

**Acceptance cases to specify:** two versions both using local artwork ID 1;
old funded auction during authority rotation; malicious/removed module mint;
duplicate successful-path delivery; creator/First Collector preservation;
old credit withdrawal after deploying a new engine. Reuse
[current authorization checks](../../test/ArtSoulV41.test.cjs#L1077), but those
do not prove safe rotation or mixed-version operation.

November 2 characterization now reproduces both old-settlement authority denial
and cross-Core local-ID collision, with an authority-restoration positive control
and atomic rollback checks. See [the executed evidence](../audits/C1_PAUSE_AUTHORITY_CHARACTERIZATION_2026-11-02.md).
This confirms current hazards; it does not choose a replacement topology.

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
[Core pause test](../../test/ArtSoulV41.test.cjs#L1098) covers registration denial
and invalid transitions, not the funded pause-expiry case.
[Launch pause test:162](../../test/CollectionLaunch.test.cjs#L162) already verifies
its distinct settlement/claim/withdrawal policy; retain it without generalizing it.

The new [funded pause characterization](../../test/ArtSoulV41.test.cjs#L901)
reproduces payment denial during pause, the unchanged deadline, subsequent payment
expiry and default after unpause. No payment or mint-side state survives a failed
transaction. This is current-source evidence, not approval of that deadline policy.

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

## 6. D5 — Automatic execution, optional gas reserves and payment funding

Direction: the founder's November 2 request is to minimize manual lifecycle steps,
evaluate prepaid execution with unused-reserve refunds, and preserve future
cross-network payment compatibility. This section records a design recommendation,
not approval of a reserve amount, fee, funding mandate or new execution authority.
Source rechecked at `d794aecfe836aa9db776fad0468a2c1bfc7e9bfc`.

**FACT.** A timer does not send an EVM transaction. An external transaction invokes
contract execution ([Ethereum documentation](https://ethereum.org/developers/docs/smart-contracts/)).
Current [endAuction:328](../../contracts/ArtSoulCore.sol#L328) needs that transaction;
its no-bid branch clears the active slot without minting. Current
[settleAuction:356](../../contracts/ArtSoulCore.sol#L356) requires the winner as
caller and the exact remaining payment. A relayer cannot simply call it for the
winner. Current [deposit:606](../../contracts/ArtSoulCore.sol#L606) is generally
partial security, not a fully funded purchase: a 1 ETH bid locks 0.1 ETH and leaves
0.9 ETH payable. A gas reserve would not pay that missing purchase amount.

**REQUIREMENT.** Bible §2 already requires future no-bid finalization without a
separate user-facing End step; §§3.1/4 preserve full losing-deposit obligations
and mint/floor only after successful settlement. Automation cannot select a winner,
change price, extend a deadline, mint on expiry alone or penalize a losing bidder.
Partner Collection attempts/cooldowns still apply; automatic eligibility is not
permission to start a new auction or spend funds without the creator's consent.

**RECOMMENDATION — remove unnecessary transactions before precharging for them.**

| Situation | Target user experience | Necessary execution and boundary |
| --- | --- | --- |
| Expired with no bids | Work returns to Discovery as unminted; no separate End button | Derive effective expiry from canonical end time and bids. Atomically finalize/revalidate the previous auction in the next authorized creation; a permissionless executor can also finalize. Record the closure once, before a new auction event |
| Expired with a winner | Show winner payment status and remaining amount | Executor can trigger deterministic finalization. D2 must decide the settlement-window anchor; do not shorten the payment opportunity because a worker was late |
| Winner enables automatic payment | Settle and mint once when eligible and sufficiently funded | Separate, explicit payment authorization and a reliable source of the remaining price; gas sponsorship alone is insufficient |
| Winner has not enabled/funded automatic payment | Show the normal payment action and reminders | Retain the agreed settlement path; no silent wallet debit. Actual missed settlement follows approved default rules, not a worker's guess |
| Settlement deadline passed without successful payment | Work remains unminted; show default and re-auction eligibility under the applicable rules | Deterministic default execution accounts for the defaulted winner's deposit once. Gas reserve and extra purchase prefunding are separate obligations; D2 must resolve pauses before automating this path |
| Refund or unused reserve becomes payable | Show paid refund or available credit, with a receipt | Bounded transfer attempt/batch, then individually withdrawable credit on failure; no recipient can block everyone else |

Derived expiry is a view, not a fabricated `AuctionEnded` event. UI, contract
eligibility checks and indexer projections must agree on the actual extended
deadline and terminal state. A stale UI timer is never sufficient authorization.
No-bid lazy cleanup removes a standalone transaction, not all computation cost.
The next action must estimate its combined cost honestly.
An already minted NFT remains an NFT when its resale listing expires or is
cancelled; returning to unminted Discovery describes an unsuccessful primary
auction, not a burn or reversal of successful settlement.

### Execution service and funding choices

Use the same permissionless, contract-validated transition for a user or an
executor; the worker has no custody/admin ability to choose outcomes. An existing
server may host a bounded worker, but an independent trigger/manual fallback must
remain possible if that worker stops. There is no guarantee of execution at an
exact wall-clock second. Compare infrastructure reuse after reviewing signer
isolation, operating budget, confirmation/reorg handling and retry limits; no
new server, provider or spending is authorized by this design.

Recommend enabling deterministic finalization/refunds before optional automatic
winner payment. Compare separately funded payment escrow with a narrowly scoped
smart-account authorization. Escrow improves funding certainty but locks more
capital; authorization can fail if funds disappear or permission is revoked.
A signature is not an irrevocable funding guarantee. Native ETH in an ordinary
wallet cannot be pulled by an ERC-20 allowance. Do not require unlimited approvals,
collect private keys, replace the existing deposit with full escrow by implication,
or give a general session key unrestricted spending power.

[ERC-4337](https://eips.ethereum.org/EIPS/eip-4337) supports account operations and
paymaster gas funding; it does not itself provide auction scheduling or purchase
funds. Account/paymaster compatibility and failure accounting need review for any
selected implementation. It is an option, not a dependency added to this project.

### Optional reserve model and cost disclosure

A prepaid execution reserve, if selected, is a separate refundable liability, not
an extra sale commission, bid deposit or treasury balance. Bind it to payer/refund
owner, chain/engine, auction/action, terms version, nonce, expiry and approved cost
cap. Each action and the entire authorization need bounded spending; no recharge,
currency substitution or cap increase without fresh owner authorization.

For each asset and custody boundary, extend D3 to `C + D + F + R <= B`:
`C` = all credited obligations (including earned executor reimbursement if unpaid),
`D` = locked bid deposits, `F` = separate unconsumed purchase prefunding excluding
`D`, `R` = execution reserves not yet charged or credited, `B` = available balance.
Moving a reserve into refund/executor credit removes it from `R` exactly once.
For one reserve: `funded = charged + paidBack + refundCredit + remainingReserve`.
`charged` includes authorized executor reimbursement already paid or still owed
as executor credit in `C`; it does not mean only cash already transferred.
These are model sums, not permission for an unbounded on-chain accounting loop.

Do not reimburse caller-supplied gas figures or assume `gasleft * gasprice` measures
the full cost. [Base fees](https://docs.base.org/specifications/transactions/network-fees)
include L2 execution and L1 publication costs that vary. The capped reimbursement
rule, evidence source and any provider charge must be specified and tested before
implementation. Proposed default: failed, duplicate and no-op executor attempts
must not consume the user's reserve; the executor bears those attempts unless an
explicitly approved, disclosed alternative is adopted. An executed reverting
transaction still costs its sender gas; the reserve cannot promise to undo that.

On settlement/manual completion or other terminal outcome, release the unused
reserve exactly once to its designated owner. Refund the unused part, not gas
already spent. A separate transfer has its own execution cost; combine it with
completion where safe and retain credit fallback. Do not promise an unconditional
free transfer back to any wallet or source chain. Define cancellation, refund
availability and reserve exhaustion before accepting reserves; expiry or a failed
worker must not lock unused funds indefinitely. Extra purchase funding `F` needs
its own release/default treatment; it must not silently enter the deposit penalty.

Proposed review UI separates **purchase price / bid deposit / optional execution
reserve / gas for the current transaction**. Show what each future action may
spend, who pays, the maximum additional cost, reserve refund destination and
whether automatic payment is actually funded. After completion show final receipt,
actual authorized charge, unused amount paid or available, and a next action;
remove the consumed confirmation. Never present an estimate as a fixed future fee.

### Future cross-network funding and acceptance

Keep asset ownership and canonical settlement on the destination chain; treat
source-chain payment as a separately authorized transport/conversion operation.
Reuse [Rework Plan §4](../canon/CONTRACT_REWORK_PLAN.md#4-pay-from-another-chain-keep-the-nft-on-its-home-chain)
for route and intent boundaries. Source payment alone cannot create a bid, NFT or
floor. Arrival after a deadline, duplicate delivery, slippage, wrong asset or a
paused destination needs attributable recovery; transport failure is not an
automatic refund on the source chain. Preserve signer, beneficiary and refund
owner across the router instead of assigning ownership to `msg.sender` blindly.
No extra product network or direct stablecoin auction denomination is activated.

**Acceptance cases to add after decisions:** no-bid expiry/re-auction with the
worker absent; soft-close extension racing execution; duplicate/manual/worker
completion races; malicious or inflated reimbursement; reserve exhaustion and
gas spikes; failed/refused refund and credit retry; winning prefund shortfall or
revoked permission; pause spanning expiry (D2); forged/late/duplicate cross-chain
delivery; native/contract wallets; conserved obligations across every terminal
state. Do not let a failing refund or optional automation hook block an otherwise
valid settlement. No failing external optional service may become the sole exit.

**UNDECIDED before Solidity:** settlement anchor and pause policy (D2), executor
funding/source of operating gas, reserve opt-in/payer/caps/reimbursement and refund
rules, optional prefunding/authorization/revocation terms, treatment of extra
prefunding on default, supported payment routes/assets and recovery payer. The
direction is accepted for design; none of these blank values is a new fee/default.
Interpretation: propose fewer mandatory transactions first, with optional scoped
payment automation afterward. This qualifies the idea of precharging every stage;
it does not amend Bible §§2–4, 14 or activate future cross-chain capabilities.

## 7. D6 — Transaction authorization and compromised-wallet recovery

Status: **research proposal**, requested November 2; not approval to introduce
mandatory customer MFA, a custodial co-signer, new recovery powers or a new wallet.
Source review for this addition: `83e3827e9e3c91f7cadd2428a7278cc33962ed58`.
It extends D1–D5 rather than replacing their accounting or governance decisions.

### Evidence and current boundaries

[Binance's October 30 incident update](https://www.binance.com/en-TR/support/announcement/detail/d3306d9dca5243548c813b605e1d1751)
([official announcement mirror](https://www.binance.com/en/square/post/382966610455230))
reports approximately $6.3 billion lost from compromised hot wallets on October
29. Its preliminary investigation mentions multiple breach points and does not
establish a final technical cause. This is motivation for a threat review, not
evidence that ArtSoul shares that vulnerability or that one specific factor would
have prevented the incident.

**FACT — current prototype, not replacement acceptance:**

| Boundary | Source behavior | What it does not establish |
| --- | --- | --- |
| Primary payment | [Core settlement](../../contracts/ArtSoulCore.sol#L356) requires the winning sender and exactly the recorded price minus credited deposit | Identity of the human controlling that sender; website approval |
| Resale payment | [Core resale](../../contracts/ArtSoulCore.sol#L487) requires the stored price, active listing and current seller ownership | Safety of signing a malicious purchase or approval; D4's ownership-cycle hazard remains |
| Credit withdrawal | [Core withdrawal](../../contracts/ArtSoulCore.sol#L564) clears the caller's full credit before paying only that caller, with a reentrancy guard; failed payment reverts | A partial-withdrawal API or protection when that caller's key is stolen |
| Administrator | [Treasury setter](../../contracts/ArtSoulCore.sol#L574) changes future fee recipients; [NFT authority setter](../../contracts/ArtSoulNFT.sol#L43) changes the address allowed to mint | Immutable mint policy: the NFT trusts the configured authority rather than independently proving settlement. It can be an EOA. This is not a power to seize existing NFTs |
| Customer website session | [SIWE verification](../../src/api/routes/auth/verify.js) and [cookie issuance](../../src/api/backend.js#L145) authenticate a wallet with a signed session cookie | Customer MFA, physical-device identity or on-chain enforcement of a website session |
| Staff step-up | [Staff factor/session code](../../src/api/moderation-passkey.js) supports passkey/TOTP, a 24-hour session and trusted-IP/User-Agent context binding, subject to its flags | Per-payment approval or ordinary-user protection. Runtime flag state was not reverified for this review |

Existing Core economic constants are prototype behavior; this review does not
adopt its resale split for the replacement. D3 and the Bible remain authoritative.
No generic owner credit-sweep endpoint was found in Core; that narrow source fact
is not a claim that the entire protocol is immune to administrative compromise.

### Threats and proposed controls

| Threat | Proposed enforceable boundary | Residual risk / required proof |
| --- | --- | --- |
| Compromised website or API changes amount/recipient | The contract derives payment from a valid stored obligation and verifies authority, recipient, asset and lifecycle | A malicious UI can still solicit a separately valid harmful signature; independent wallet confirmation and readable transaction details remain necessary |
| Repeated small transfers drain escrow | Each claim is consumed once; aggregate paid amount never exceeds that claim; unrelated liabilities cannot fund it | A per-transaction cap alone permits repeated drains and is insufficient |
| Stolen ordinary wallet key | An optional protected contract account requires an independent cryptographic authorization for its protected operations | Website MFA cannot stop direct transactions from an ordinary EOA. Funds/NFTs outside the protected boundary remain exposed |
| Stolen staff cookie, server key or database | Application authority never grants arbitrary escrow spend, signature custody or unilateral financial recovery | TOTP seeds and sessions remain sensitive; staff powers must be scoped and revoked independently of fund authority |
| Compromised owner, module or upgrade authority | D1 specifies who can change minting, executors, treasury recipients and validation; configuration cannot silently bypass the promised user policy | A guard is ineffective if the compromised key can remove it. Review initialization, upgrades, modules and recovery together |
| Lost factor, changed mobile IP or provider outage | Documented recovery preserving obligations and an independent exit path, with the same security strength as normal authorization | A service that can block every withdrawal becomes a fund-availability dependency; a weaker reset path defeats MFA |
| Executor, callback or retry interference | D3/D5 atomic state changes, replay protection, bounded execution and failed-transfer credits | Test partial batches and repeated claims across entry points, not only one happy-path function |

**RECOMMENDATION — exact authorization, not website-only spending permission.**
For a recorded obligation of 1 ETH, only its legitimate beneficiary may receive
at most the remaining 1 ETH across all executions. No second call creates another
1 ETH entitlement. The amount and recipient cannot come from an unrestricted
server-supplied transfer instruction. Existing Core withdrawals pay the whole
caller credit; this example does not assert an existing partial-withdrawal feature.

Any future signed authorization must bind the account, chain, verifying contract
and deployment, action/selector, calldata or its hash, asset, amount, beneficiary,
obligation identity, nonce, expiry and applicable funding/refund terms. Automation
must additionally bind the approved spending/gas-reserve scope from D5. Structured
signatures alone are insufficient: [EIP-712](https://eips.ethereum.org/EIPS/eip-712)
explicitly leaves replay prevention to the application. Consumers must reject
reuse and substituted intent, including across contracts, versions and chains.
No arbitrary target, approval or `delegatecall` may be hidden inside an auction
payment authorization. Limited session permissions must not enable installing
modules, changing owners or disabling the factor policy.

### Separate website security from protected custody

1. **Protocol protection for everyone:** exact obligations, authenticated
   beneficiaries, once-only accounting and bounded execution apply even when the
   website is bypassed. An attacker controlling an unrelated wallet must never
   spend another person's credit. These are not an optional MFA subscription.
2. **Optional website account protection:** prefer passkeys, with an explicitly
   described authenticator-app alternative. Reading public art and merely
   connecting a wallet need not force enrollment. Protect sensitive account
   changes with fresh verification and session revocation; do not call this
   protection against direct blockchain use of a stolen key. Do not reuse the
   founder's staff-recovery quorum as a reset service for every customer.
3. **Optional protected contract account:** evaluate a reviewed account whose
   financial authorization actually requires independent proof on-chain. Assets
   and credits must belong to that account, and every relevant execution path
   must enforce the policy. A single compromised key must not remove the factor,
   change its validator, recover ownership or execute through another module.
   Existing users require an explicit migration/activation flow; no silent wallet
   conversion or new token approval during connection.

These are proposed layers, not implemented customer features. A central server
co-signature would add custody/control, availability and recovery dependencies;
it is not the default recommendation. Standard smart-account interfaces may help
integration, but [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271) defines contract
signature validation and [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337) defines
account-operation infrastructure, not a complete factor or recovery policy.

**Delegation caveat.** [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702) allows
the EOA authority to replace or clear its delegation and originate transactions.
Therefore, delegating a stolen-key EOA to a validator does not by itself remove
that key's bypass powers. This is an inference from the specification, not a claim
about Binance's cause. Do not market delegated-wallet UX as protection against
compromise of the original key without proving all bypass paths are closed.

### Factors, device changes and recovery

[NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html) distinguishes
phishing-resistant cryptographic authentication from manually entered OTPs and
discusses IP/device signals as risk inputs. [FIDO passkeys](https://fidoalliance.org/passkeys/)
use asymmetric credentials bound to the relying party. Accordingly:

- Prefer passkeys for website authentication. TOTP is a shared-secret code and
  can be phished; do not treat it as equivalent on-chain transaction protection.
  Never put TOTP seeds, codes or recovery secrets in public calldata or logs.
- New IP/browser signals may trigger re-verification, not irreversible fund
  freezing. Mobile networks change addresses; User-Agent strings are spoofable.
  Same IP is not proof of safety. Minimize stored risk data and define retention.
  Do not silently change the currently approved staff-session binding.
- A successful website login is not approval for every future transfer. A
  protected financial action must bind the exact reviewed operation to the
  required proofs. Factor reuse, cancellation and replay must be tested.
- Wallet and passkey on one compromised device or cloud account are correlated
  risks. Enrollment from an already-compromised wallet cannot retrospectively
  prove the rightful owner. A legitimate-site compromise can also present harmful
  requests despite phishing-resistant login.
- Email/social accounts can receive alerts or support a reviewed recovery flow;
  they must not alone reset financial authorization. Recovery, factor replacement,
  upgrade and emergency paths must preserve the promised independent approvals.
  Recovery quorum/delay and loss handling remain undecided; invent no defaults.
- Treasury signers need independent trusted review of the actual target, asset,
  amount and calldata. Multiple signatures on the same compromised UI are not
  independent verification. Application administrators must not inherit escrow
  sweep, mint-policy or treasury ownership powers from their website roles.

### Acceptance cases before claiming protected payments

The following are **proposed replacement acceptance**, not passed customer MFA tests:

| Case | Required evidence |
| --- | --- |
| Underpayment, overpayment and non-winner settlement | Executed rejection preserves auction, floor, NFT supply, credits and escrow balances |
| Duplicate settlement/claim, including another entry point | At most one mint/payout; no recreated credit; unrelated obligations unchanged |
| Stolen key calls a protected account directly, outside ArtSoul | Missing independent authorization fails for transfers, NFT approvals, withdrawals and delegated execution |
| Changed recipient, amount, calldata, deployment, chain, expiry or nonce | Either proof cannot be reused for the substituted operation |
| Module installation, owner/validator replacement and recovery bypass | The compromised key alone cannot weaken or bypass the promised authorization |
| A weak fallback, email reset or old factor after replacement | Cannot substitute for a required independent proof; old permissions are revoked |
| Compromised website/backend and forged device headers | No arbitrary escrow spend; untrusted headers do not grant privileged API access |
| Browser network change and lost factors | Documented re-verification/recovery works without silent loss, double payment or permanent provider lock-in |
| Treasury or mint-authority rotation with pending liabilities | D1 obligations still complete under the approved policy; no arbitrary new mint authority |
| Failed recipient, partial batch and executor retry | D3/D5 conservation and once-only obligations hold through recovery |

**UNDECIDED before implementation:** customer opt-in versus mandatory scope;
account/validator implementation and Base support; proof independence; enrollment
and migration; recovery quorum/delay and availability; supported wallets; limited
session permissions; custody/privacy implications; funding and operational cost.
The user requested investigation, not a particular answer to those questions.
No paid provider, schema change, new secret or current fund restriction is needed
for this research. There is no claim that any design makes theft impossible.

Interpretations to review: use IP as an application risk signal rather than a
fund owner; prioritize passkeys over manually entered codes; propose optional
protected accounts rather than requiring them at first connection; reject a
website-only gate as the financial security boundary. None is a canon amendment.

## 8. Decision and verification limits

The annex is ready for policy comparison, not C1 sign-off. Populate decisions and
their canon impacts explicitly; no unanswered cell becomes a constructor default.
No Solidity, schema, signing, deployment or live protocol operation was changed.
The initial document review checked references and integer vectors without running
contracts. The subsequent [D1/D2 characterization](../audits/C1_PAUSE_AUTHORITY_CHARACTERIZATION_2026-11-02.md)
added three local executed cases and passed 52 tests at that point.

The D6 follow-up adds [exact settlement/replay](../../test/ArtSoulV41.test.cjs#L1004)
and [credit ownership/once-only withdrawal](../../test/ArtSoulV41.test.cjs#L1040)
cases. Under/overpayment by one wei, a non-winner with the correct payment, a
repeated settlement, owner/outsider withdrawal and a repeated beneficiary claim
all execute mined reverts on chain 31337. The full settlement snapshot remains
unchanged after rejection. Positive controls confirm one NFT/settlement, total
credits equal to the funded price and payment only to the creditor with gas
accounted for; the treasury's credit and ETH balance remain intact.

`npm run test:contracts -- --network hardhat` now passes **54 tests**, including
Core, Collection Launch/Forge and Donations. The initial focused run expected
`AuctionAlreadyFinalized` for a repeated settlement; current Core reports
`AuctionNotEnded` for any status other than SettlementPending. The test oracle
was corrected to current behavior before the passing full run; Solidity was not
changed. Core/NFT source hashes still match the prior characterization baseline.
No browser factor ceremony, protected-account implementation, live-bytecode
verification or independent security audit is claimed by these local tests.
