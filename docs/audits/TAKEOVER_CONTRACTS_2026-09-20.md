# Contract takeover audit and additive launch design — 2026-09-20

Status: source inspection complete; new contracts not implemented at the time of this first report. Baseline execution belongs to the coordinating task. No chain transaction, signer, deployment, or existing storage layout is changed.

## Evidence boundary

Inspected `contracts/ArtSoulCore.sol`, `contracts/ArtSoulNFT.sol`, `contracts/ArtSoulProjectNFT.sol`, `contracts/test/ReentrantWithdrawer.sol`, `test/ArtSoulV41.test.cjs`, `hardhat.config.cjs`, installed OpenZeppelin package (5.0.0), root instructions, canon sections 1–17, canonical implementation backlog and founder takeover brief supplied 2026-09-19/20. Contracts history shows initial public release `0a40e1b` and license alignment `acb857b`; source inspection alone does not attribute either author to Claude. The existing suite contains 19 tests. Pass/fail evidence is recorded by the coordinator, not inferred here.

## Preserve

- Existing 1/1 contracts and deployed addresses: preserve current source/deployment correspondence. Do not silently deploy a rewritten Core against existing NFT state.
- Deposit rounding, minimum increment, permitted durations, bounded anti-sniping, lazy minting, exact settlement payment, credits before external transfer, and withdrawal reentrancy guard are concrete implemented safeguards.
- Existing tests intentionally capture prototype behavior; do not rewrite their expected royalty to create a false mainnet conformance claim.

## Ranked concrete risks, separate from documented prototype deviations

| ID | Evidence | Trigger and consequence | Score | Disposition |
| --- | --- | --- | --- | --- |
| CT-01 | `ArtSoulCore.sol:356-367,419-428,579-585` | Pause prevents settlement while the wall-clock settlement deadline continues. A pause spanning the deadline leaves a willing winner unable to settle, then exposes their deposit to default after unpause. The owner cannot directly steal the deposit but can deny the settlement opportunity. | 2 reach × 2 confidence × 4 severity = 16 | Reproduce in local regression tests; remediation must define paused-deadline semantics in the replacement Core. Existing deployed storage cannot be patched by editing this repository. |
| CT-02 | `ArtSoulCore.sol:471-475,488-519`; inherited ERC721 transfer | A resale listing has no ownership epoch. If the seller transfers a listed NFT away and later regains it, an old listing can become executable again when Core has approval, without a new listing transaction. Global operator approval survives token transfers. | 2 × 2 × 4 = 16 | Reproduce return-to-owner sequence. Replacement design must invalidate a listing on every transfer or bind a listing to an ownership nonce. |
| CT-03 | `ArtSoulCore.sol:564-571` | Credits can only be withdrawn to the creditor itself. A contract creditor with a rejecting receive function cannot redirect to a compatible recipient; retrying preserves the credit but never makes it recoverable. Existing reentrancy test proves preserved credit, not recovery. | 2 × 2 × 4 = 16 | Add a payee-authorized `withdrawTo` in replacement/new designs. Do not add an administrator recovery path that can redirect another user's funds. |
| CT-04 | `ArtSoulNFT.sol:71`; `ArtSoulProjectNFT.sol:84`; `ArtSoulCore.sol:519` | `_mint`/`transferFrom` allow transfer to contracts without ERC721 receiver capability. Bidding/buying contracts need an NFT recovery method or assets can be stranded. | 2 × 2 × 4 = 16 | New design uses safe mint with beneficiary-controlled recipient; receiver failure atomically reverts mint without consuming claim/refund rights. |
| CT-05 | `ArtSoulNFT.sol:43-47`; `ArtSoulProjectNFT.sol:60-64` | Owner can change the Core address repeatedly after deployment, replacing mint authority. This is real administrative trust, not a fully immutable protocol. | 2 × 2 × 3 = 12 | Explicitly document privileged trust. New launch wiring is immutable/one-time before configuration lock; no proxy or hidden replacement. |

Scores describe source-confirmed code paths, not exploited production incidents. Tests may raise confidence from 2 to 3 once reproduction is recorded.

## Known prototype deviations (already disclosed by canon)

- Core resale 90% seller / 7.5% creator / 2.5% protocol; ERC2981 royalty 7.5%; no ecosystem split. Canon section 14.2 explicitly acknowledges this. Replacement mainnet design must use the approved 92.5 / 5.5 / 1 / 1 split; do not silently rewrite deployed testnet history.
- NFT approvals are not marketplace restricted (canon section 9).
- ProjectNFT is transferable, 100 supply, named Genesis in source/events. Canon section 7 explicitly identifies it as a retired-at-migration prototype rather than actual Genesis.
- No-bid auctions require explicit `endAuction`; canon section 2 labels lazy permissionless finalization a future-contract requirement.
- Losing deposits are credited during outbid but no bounded automatic payout processor exists; canon section 3.1 defines the future bounded refund architecture.

## Authorized additive architecture

The new founder brief explicitly supersedes the Base-only restriction **for generic collection launch infrastructure**, while preserving existing Base 1/1 behavior. New contracts have separate addresses, state and events. Origin is configuration of generic infrastructure. Nothing here changes existing fees or Genesis status.

Touched canon sections: 1 (additional chain-aware collections), 3/3.1 (new collection auction explicitly separate from existing auction economics), 4 (collection sale minting), 7 (future Genesis proposal remains unapproved), 8 (new generic collections separate from legacy Partner lifecycle), 9 (royalty disclosure and marketplace limitations), 14 (explicit fee routing), 15/17 (testnet preparation only).

### Minimal proposed interfaces

`CollectionLaunch` (ERC721 + ERC2981 + Ownable2Step + Pausable + ReentrancyGuard): immutable maximum lifetime issuance, creator/treasury addresses, fee schedule and metadata prefix. Before `lockConfiguration`, configure a bounded variable number of chronological phases. Each phase declares kind, start/end, allocation, wallet limit, eligibility root, price/reserve, unused allocation rule, and optional earlier-auction price reference with locked fallback. Lock validates totals and every reference; no administration changes economics, allocation, root or times afterward. Emit configuration commitment and chain ID.

- `addPhase(PhaseConfig)`, `lockConfiguration()`, `phaseCount()`, `phase(id)`.
- `mintPhase(id, quantity, allowance, proof, recipient)` for free/public/fixed-price/Merkle distribution. Exact payment; effects before safe mint; bounded quantity. A Merkle leaf binds chain, collection, phase, claimant and allowance and uses double hashing.
- `bid(id)` with full bid escrow; one indivisible NFT per bid and one bid per wallet per auction in the first audited mechanism. Explicitly reject duplicate participation; do not pretend the first version supports arbitrary multi-unit demands.
- Keep a min-heap of the best `allocation` bids, worst first; compare price, then earlier transaction sequence. Bidding cost is O(log allocation), finalization O(1), no bidder-wide sorting or payout loop.
- `finalizeAuction(id)`: permissionless after deadline, including during pause; store immutable outcome, clearing price, accepted count and exact proceeds obligation. Undersubscribed rounds use predeclared reserve; at/above capacity use marginal winning bid. Empty round establishes no market price. Public-mint price sources must use a precommitted fallback when the required subscribed price was not established.
- `claimAuction(id, recipient)`: self-directed claim of settled NFT plus overpayment credit. Already-earned claim/refund rights remain exercisable during entry pause. Rejected bids receive full pull credit as soon as displaced; no user must process all bidders.
- `withdrawTo(recipient)` pays only caller's credit and remains available while paused. No owner sweep of liabilities, no admin reassignment of bidder balances.
- `closePhase(id)` releases unused allocation only as configured, once, after its deadline. Auction winners reserve their supply at finalization even if not yet minted. Burned NFT IDs never restore lifetime sale capacity.

`CollectionForge` (separate ERC721 output collection + ERC2981 + ReentrancyGuard): immutable ingredient collection, recipe ID, ingredient count and maximum lifetime outputs. `craft(uint256[] ingredients, address recipient)` validates exact count, strictly increasing IDs (therefore uniqueness), ownership and approvals; atomically burns all inputs and safe-mints one distinct output. Permanent ancestry event contains every consumed ID. Contract cannot burn unrelated holders' tokens. Input collection enables this forge exactly once before launch lock. Genesis is not deployed or minted by this contract.

A future Genesis eligibility consumer must key consumption by `(chainId, forgedContract, tokenId)`, query current ownership at consumption, record before minting, and leave the Forged token unburned. Implementing permanent 1101 supply or the proposed 300/800 split is outside this authorization because the brief explicitly calls those proposed and requires a later founder decision.

### Explicit interpretation candidates, not silent mainnet economics

1. First mechanism is one unit/one bid per wallet; ties prefer earlier accepted transaction sequence. This is deterministic but block ordering is proposer/sequencer dependent and is not a randomness claim.
2. Full escrow removes settlement default debt in this separate collection mechanism; it does not alter 1/1's 10% deposit.
3. Under-subscription charges the precommitted reserve; it does not qualify as a sold-out market-clearing price for a linked public phase. Empty auction creates no price.
4. Technical caps on phase count, mint batch, split recipients and ingredient count must be recorded as safety limits rather than arbitrary Origin economics.
5. Configuration immutability begins at explicit lock before first participation, stronger than merely blocking edits after first bid.
6. Burn capacity counts lifetime issuance, not current live supply, preventing free supply regeneration.
7. Pause blocks new exposure, not already-earned refund/claim finalization. Final mainnet incident policy requires separate review.
8. Unused supply behavior is predeclared; no admin chooses after seeing demand.
9. Fee/royalty/support configuration needs exact integration with founder-approved economics. Do not infer new default primary fees from a voluntary secondary-support field.

## Sources reviewed

- TreasuryDirect, [About Auctions](https://www.treasurydirect.gov/auctions/) and [Glossary](https://treasurydirect.gov/help-center/glossary/glossary-for-marketable-securities/), checked 2026-09-20: uniform-price awards share the marginal accepted price. The proposed NFT tie/under-subscription rules above are explicit design choices, not claims that Treasury rules are identical.
- OpenZeppelin, [5.x Utilities](https://docs.openzeppelin.com/contracts/5.x/api/utils) and [Cryptography](https://docs.openzeppelin.com/contracts/5.x/api/utils/cryptography), checked 2026-09-20. Implementation must compile against the locally installed **5.0.0**, not copy APIs introduced in newer 5.x versions.

## Next verification

Await coordinator's baseline completion, then implement only additive launch/forge files and a dedicated contract test suite. Reproduce old-contract risks locally without changing those contracts. Test monetary conservation, heap selection against an independent sorted model, deterministic ties, boundaries, partial subscription, pause/refund/reentrancy, malformed proofs, caps, locks, failed recipients and atomic crafting. No deployment or real wallet is part of local execution.
