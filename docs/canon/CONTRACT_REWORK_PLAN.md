# Contract Rework Plan

Status: **C1 research/design in progress; architecture sign-off pending.**
Reviewed: 2026-10-26 against repository `b4ca2523e18c8837ec79174a83c2fb8b1a3b639e`.
This replaces the July 13 proposal in this maintained file; history remains in Git.
No contract, network activation, economics or upgrade topology changes here.

Authority: [October 26 direction](CHANGELOG_2026-10-26_CONTRACT_EXTENSIBILITY.md).
Baseline: [Bible](ARTSOUL_CANON_BIBLE_FULL.md),
[Collection Launch amendment](CHANGELOG_2026-09-20_COLLECTION_LAUNCH.md),
[artist support](CHANGELOG_2026-09-30_ARTIST_SUPPORT.md) and
[donation amount amendment](CHANGELOG_2026-10-03_PHASE_A_ACTIVATION.md).
Companions: [product direction](../architecture/POST_PHASE_A_PRODUCT_DIRECTION_2026-10-24.md)
§§8/15 and [payment research](../VOICE_AND_NETWORK_FOLLOWUP_2026-10-25.md).
Recommendations below are not claims of implemented capability or completion of Phase B.

## 1. Current evidence and corrections

Source inspection is against the revision above. Retained deployment evidence is
[B23 / PR #373](../audits/B23_RESALE_CONTROLS_2026-10-26.md); this review did not
repeat a live deployment audit.

| Component | Current source / retained evidence | Rework implication |
| --- | --- | --- |
| [Core](../../contracts/ArtSoulCore.sol) | Constructor-based, no proxy; publish, auctions, lazy mint, credits and resale in one engine | Cannot convert existing storage into a proxy with a website update |
| [Artwork NFT](../../contracts/ArtSoulNFT.sol) | ERC-721, 7.5% ERC-2981; owner can replace its Core mint authority; ordinary approvals | Immutable bytecode alone does not make mint authority immutable |
| [ProjectNFT](../../contracts/ArtSoulProjectNFT.sol) | Transferable 100-supply prototype; Core owner controls eligibility and prototype mint path | Not canonical Genesis or a collection engine; retire at migration |
| [Donations](../../contracts/ArtSoulDonations.sol) | Separate immutable Core resolver; non-zero ETH forwarded fully to creator, optional message, no fee; testnet implementation exists | Preserve separately; do not reintroduce a message amount threshold |
| [Launch](../../contracts/launch/CollectionLaunch.sol) / [Forge](../../contracts/launch/CollectionForge.sol) | Local phased-sale and atomic crafting scaffolds, bounded operations and locked terms | Preserve useful work; local tests/draft UI do not prove an activated launch product |
| Indexer / UI | Deployed resale controls and bounded reconciliation compensate for missing cancellation events | Future contracts need complete event coverage |

Prototype deviations remain mainnet blockers: resale 90/7.5/2.5 rather than
92.5/5.5/1/1; NFT royalty 7.5% rather than 5.5%; absent separate ecosystem routing
and approval enforcement. No deployed-contract repair is claimed here.

Corrections to July's proposal: the function is `listResale`, not `listForResale`;
ProjectNFT is not automatically awarded by auction settlement; collections now
exist in source; UUPS was proposed, not approved; pull credits do not guarantee
gas-free refunds. Permissionless/lazy/keeper finalization requires a transaction.
Orphan artifact cleanup remains C-19 after inventory, never a reason to revive token code.

### Reproduced resale invalidation gap

Disposable Hardhat chain, same source: list NFT at 2 ETH, transfer away, return
to seller, then buy through the original listing. Buying while away reverts;
buying after return succeeds. Exactly one `ResaleListed` and one original
`ApprovalForAll` event exist. Operator approval persists although per-token
approval is cleared. Floor remains 1 ETH.

Local characterization: **1 passing**, exit 0, chain 31337:
`npx hardhat test --network hardhat docs/private/stale-resale-roundtrip-proof-20261026.cjs`.
The ignored proof and output log are local evidence, not shipped regression tests
or live transactions. Source SHA-256:
Core `97ef6feae0d8ede75e4f926228749e049428777ff85784cbdfe56cdf7348a377`;
NFT `98ae45eaac9198b616094352f606806760483d0d32b81ce8ce98e14ca9688822`.
Reproduce with existing `deployProtocol` / `settlePrimaryAuction` helpers in
`test/ArtSoulV41.test.cjs`, followed by `setApprovalForAll`, `listResale`,
two `transferFrom` calls and `buyResale`. This is **not a passing fix**.
Current-chain mitigation is explicit cancellation; transfer away is not permanent cancellation.

New-contract requirement: listing nonce plus a transfer epoch enforced by NFT
transfer state. Transfer, cancellation and replacement invalidate old authorization;
returning ownership must not revive it. An indexer-only epoch cannot enforce this.
External NFTs without such an epoch require a separate order/custody policy.

## 2. Recommended boundaries, not a fixed contract count

Split where ownership, custody, deployment lifetime or trust differs. Use internal
libraries for shared arithmetic; more external calls/contracts are not inherently
safer. The old mandatory four-contract/UUPS topology is superseded as a proposal.

| Boundary | Responsibility | Prohibited power |
| --- | --- | --- |
| Asset identity / NFT | Creator, token/artwork identity, supply/mint caps, ownership/transfer epoch, metadata policy | Unlimited mint/burn/transfer merely because a module was registered |
| Auction / settlement engine | Locked terms, deposits, finalization, mint settlement, default, accountable credits | Rewriting funded sales, debiting unrelated users, keeper-chosen winners |
| Resale execution | List/change/cancel/buy with price, ownership, nonce/epoch, expiry policy and splits | Stale-order resurrection or floor bypass |
| Collection factory / templates | Reviewed versions, bounded allocation/supply, locked campaign terms | Changing all existing collections when a new template is registered |
| Optional utilities | Explicit holder access/redemption or approved burn-to-craft recipe | Burning/locking assets without scoped consent or silently changing sold rights |
| Payment adapters | Authorized conversion/transport and bounded destination execution | Becoming unintended buyer/refund owner or accessing unrelated credits |
| Governance / treasuries | Separate policy approval, emergencies and accounting destinations | Treating application staff roles as contract custody/upgrade authority |

Auction and resale may share one audited ledger within an engine/version; a separate
resale deployment requires a concrete reason. Avoid a universal vault accepting
arbitrary modules' debit/credit instructions. Each settlement boundary must prove
solvency/conservation without double counting across ledgers.

Identity includes deployment: artwork = (chain, registry/Core, ID);
NFT = (chain, NFT contract, token ID); auction/listing includes its engine/version.
An ABI or address containing code is not sufficient trust. Specify capabilities,
terms, events and version compatibility. Pinning a proxy address/code hash alone
does not pin its future behavior.

### Upgrade comparison

| Option | Benefit | Limitation / decision |
| --- | --- | --- |
| Versioned immutable engines/templates | Existing sales retain deployed rules; new campaigns adopt new versions | Repairs may require new deployments; preserve old claims and plan consented migration |
| Fixed-implementation clones per collection | Isolated instances with version-pinned terms | Initialization/factory permissions remain critical; do not clone a moving trust target |
| Narrow proxy-upgradeable component | Repair while retaining state/address | Upgrade authority can change behavior/access to funds; requires explicit governance and exit policy |
| Shared beacon / universal plugin kernel | Broad changes from one control point | Large blast radius; not the default for locked sales or minted rights |

**Recommendation:** begin with versioned immutable engines/factories; use a proxy
only where a specific recovery need justifies its power. This is not C1 sign-off.
A proxy upgrade can defeat fee constants, pinned terms and access checks inside
that proxy. Storage compatibility does not guarantee preserved economic rights.
An unrestricted upgrade key cannot honestly be described as unable to seize funds.
Rolling back implementation is not automatically safe after state changes.

[OpenZeppelin proxy documentation](https://docs.openzeppelin.com/contracts/5.x/api/proxy)
distinguishes fixed clones, UUPS and beacons; a beacon changes all following instances.
If proxies are selected, require locked initializers, storage-layout review and
compatibility checks from the [upgrade guide](https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable).
Document the complete authority graph.

Proposed critical-change governance: multisig plus a reviewed delay, separate from
operational pause. Signer thresholds, delay, recovery and emergency exceptions
require approval. A [timelock](https://docs.openzeppelin.com/contracts/5.x/api/governance)
provides review time, not proof of harmlessness. Test lost/revoked signers and deadlock.
Pause policy must specify pending claims, withdrawals and deadlines; do not silently
trap funds indefinitely or extend economic deadlines.

## 3. Canon coverage

| Area | Preserve / extend only within stated scope |
| --- | --- |
| Ordinary 1/1 | Publish → auction → successful settlement → mint; no-bid/default creates neither NFT nor floor |
| Economics | Primary 97.5/2.5; resale 92.5/5.5/1/1; default deposit 80/20; current deposit max(0.01 ETH, ceiling(10% of bid)); increment max(+0.01 ETH, +2.5%) with exact integer rounding; auctions 24/36/48h, settlement 24h |
| Deadline semantics | Specify anti-sniping and boundaries. Current settlement window starts when endAuction executes; changing that anchor needs an explicit decision |
| Refunds | Full losing-deposit obligations, bounded execution, failed-transfer credits, no required losing-bidder participation, no double payment. Keeper/relayer gas has an operating cost |
| Floor | Only successful canonical settlement or collection buyNowMint establishes it; never Trust, AI or donations |
| Partner Collections | One first auction, three attempts then Cancelled/30-day cooldown; remaining supply flat buyNowMint at settled collection price, reusing per-artwork floor semantics |
| Generic Launch | Distinct free/allowlist/fixed/uniform-auction templates under September 20 amendment; explicit allocation, caps, schedule, refunds, unused supply and locked metadata/terms |
| Forge / utilities | Scoped recipe/input/output, atomic consented burns/mint, consumed-supply accounting. Local recipe/cap constants are not universal approved settings |
| Genesis | Dedicated soulbound 10,000 supply, #0 founder, reserved team 200 and approved allocation boundaries; mainnet activity only; audited multisig-authorized grants, no fee privileges |
| Trust / status | Discovery-only, approved weights/marks/aura priority; no financial privileges |
| Royalties / marketplace | 5.5% creator royalty and approved enforcement; do not claim unavoidable payment on every external/OTC transfer |
| Donations | Separate; any non-zero amount with/without message; 100% creator; no protocol revenue or Trust benefit |
| Moderation / AI | Complaint-driven site visibility and human review; no reversal of chain ownership/seizure; AI does not set settlement/floor |
| Treasury / growth | Protocol/1% ecosystem accounts separate; pool is not salaries/investor income; promoted-banner rules separately gated; no token/points/airdrop |
| Migration | Announced Snapshot A, versioned hashed export and two independently verified durable copies before destructive reset; no testnet entitlement |

Generic phase prices, supply, fallback prices and draft Genesis ideas remain
proposed where not approved. Do not turn a generic clearing price into a 1/1 floor
rule or treat unminted supply as owned NFTs. File uniqueness must distinguish
original artworks from legitimate editions/collection inputs; the current website
guard is neither contract enforcement nor proof of copyright originality.

Creator experience: a few complete tested templates with advanced settings collapsed,
not an arbitrary contract assembler. Collector review: exact work/edition, creator,
home chain, total cost, recipient, conditions and failure/refund path. Utility terms
must distinguish contract-enforced rights, integrations and creator obligations;
ownership checks alone cannot guarantee an external service.

### Resale completeness

List, choose price/use floor, replace price, cancel and relist. Emit every transition,
including cancellation/invalidation and configuration/authority changes. Revalidate
owner, approval, nonce and terms at execution; a stale screen must not authorize a
different item/price.

Study [Seaport cancellation/counters/status](https://docs.opensea.io/docs/seaport-interface)
as reference, not an automatic integration. Signed orders, offers, expiry and
ERC-1155 editions need separately approved mechanics and tests.
[ERC-2981](https://eips.ethereum.org/EIPS/eip-2981) communicates royalties, not universal
enforcement. Evaluate approval whitelists against smart wallets, wrappers and
external marketplaces; a wallet transfer cannot reliably reveal a paid OTC sale.
Do not promise unrestricted composability and unavoidable fees without an enforceable design.

## 4. Pay from another chain; keep the NFT on its home chain

Example target: NFT stays on Base; buyer chooses an available payment asset/network,
sees the full quote and receives that Base NFT. This is payment routing, not an
NFT bridge or new floor pricing.

Recommended sequence, consistent with [existing research](../VOICE_AND_NETWORK_FOLLOWUP_2026-10-25.md):

1. **Destination funding:** transfer/convert into the buyer's own destination
   wallet, then use the existing sale. Show gas and finality requirements.
2. **Bounded buy-now checkout:** reviewed destination interface accepts a signed
   intent and pays/transfers atomically there. Source transport plus destination
   purchase are not one atomic cross-chain transaction.
3. **Auction bidding/settlement:** only after buy-now recovery works. Source payment
   is not an accepted bid; late arrival never silently extends auction deadlines.

Current Core and Launch use `msg.sender` for buyer/bidder/wallet limits. A generic
router would become buyer, refund owner or a shared allowlist participant. Adding
its address is not a safe integration.

Future signed intents bind payer/signer, beneficiary, refund recipient, source and
destination chains/assets, engine/collection/action, item/round/phase, listing/terms
version, amount/max spend, minimum received, fee ceiling, nonce and expiry.
No arbitrary target/calldata execution. Validate transport, signatures (including
approved contract-wallet support), replay domain and actual destination completion.
Quotes disclose gas/provider cost, slippage, route and expiry; no silent asset substitution.

Recovery states distinguish source pending, transport pending, destination funded,
purchase complete and refund/credit available. Sold/expired/paused/underfunded
destinations retain attributable funds and a defined recovery route; no blind
resubmission, admin-directed refund or unproven automatic source-chain refund.
Decide refund chain/asset and recovery gas payer before activation.

Direct stablecoin-denominated auctions are a separate economic design. Do not
silently oracle-convert ETH deposits, increments or floors. Initially evaluate
conversion into the existing destination sale asset. Multi-asset ledgers require
asset-keyed liabilities and decimal/rounding tests; fee-on-transfer, rebasing and
callback tokens are not safe merely because they expose an ERC-20 interface.

### Network/provider facts, checked October 26

| Candidate | Evidence / consequence |
| --- | --- |
| Base / Ethereum | EVM candidates; Base Sepolia remains the only active product write network. Each deployment needs independent bindings, finality, indexer and wallet acceptance |
| Robinhood | [Official docs](https://robinhood.com/us/en/support/articles/robinhood-chain-testnet/) describe an EVM L2 with mainnet/testnet; compatibility is not an ArtSoul deployment |
| Rialo | [Official VM description](https://rialo.io/for-devs) states RISC-V/SVM with EVM planned; verify support or plan a separate port, not a Solidity RPC switch |
| CCTP / Gateway / Arc | [CCTP](https://developers.circle.com/cctp) transports supported assets with hooks; [Gateway](https://developers.circle.com/gateway) manages deposited balances. Candidates, not a mandatory hub or arbitrary native-token swap service |
| Routes | [Gateway matrix](https://developers.circle.com/gateway/references/supported-blockchains) includes Base/Ethereum/Arc USDC, does not list Robinhood/Rialo. Both endpoints must support the asset; provider domains are not chain IDs |

Do not advertise any token on any chain. Swaps, liquidity, gas, attestation, finality
and failure recovery require route-specific verification. No network config changes here.

## 5. Threat model and acceptance gates

| Failure / attacker | Required design and adversarial tests |
| --- | --- |
| Compromised module | Scoped capabilities, supply/value caps and terms binding; no unrelated mint/burn/debit |
| Upgrade/admin compromise | Actual ultimate powers documented; approval/delay/pause/exit, role rotation and malicious-upgrade tests if proxies selected |
| Reentrancy / failed recipient | Checks-effects-interactions, guards, settlement credit fallback, donation atomic revert, conservation across callbacks |
| Stale listing | Transfer away/back, approval revocation, cancellation/replacement races; invalidated authorization never executes |
| Many bidders / malicious winner | Bounded gas/refunds, keeper independence, scoped default, no starvation/double payment |
| Supply / phases | No overmint or allocation reuse after burns; proof replay, shared-router limits, overlaps, locked-config mutation |
| Adapter / transport compromise | Domain/value/recipient/nonce/expiry checks; forged and duplicate delivery rejected |
| Delay / reorg / lost response | Sold/expired/paused destination, underfunding, retries; recover without double sale or wrong refund owner |
| Unsupported asset | Explicit decimals/assets, dust ownership, no transfer-tax/rebase assumptions |
| Indexer disagreement | Chain/contract/block/transaction/log identity, idempotent rebuild and reorg rollback; write actions revalidate chain state |
| Upgrade / migration failure | Initialization attacks, storage diff, old/new liabilities, outstanding claims, version isolation and verified snapshot readability |

Invariants: liabilities never exceed corresponding available funds; splits plus
assigned rounding dust equal proceeds; no double-counted deposits; one authorized
mint per successful path; immutable creator/First Collector; canonical floor origins;
no stale listing revival; bounded utility inputs/output supply. Test native and
contract wallets, rejected signatures, relayer identity and partial completion.
Prototype tests do not prove these future guarantees.

## 6. Delivery and decisions

1. C1: state/rounding/deadline specification, identity/capability graph, upgrade
   selection, threats and invariants. Approve changed rules before Solidity.
2. C2/C3/C6: smallest complete publish → auction → settlement → resale → withdrawal
   path with canonical fees/NFT constraints. Turn the round-trip case into a failing
   regression, then prove the replacement rejects it.
3. C4/C5 and TA-04/05: dedicated Genesis and one full collection template; reuse
   reviewed local Launch/Forge where compatible. Deployment, indexing, creator
   journey and recovery first; additional templates/utilities follow.
4. Selected payment route after destination correctness and policy approval:
   funding first, bounded buy-now next, auction intents last.
5. C7–C13: complete event projections, invariant/upgrade/migration suites,
   independent review covering privileged integrations, fresh Base Sepolia rehearsal.
6. B4/C14/D: approved cut-off, Snapshot A, operating/legal readiness, deployment
   approval and controlled mainnet release. Prefer an isolated new mainnet database;
   never destroy old history before required copies/verification.

Pending decisions: immutable/proxy boundaries and powers; multisig/delay/emergency
policy; pause/deadline/exit; mint authority rotation; metadata permanence; first
collection template/terms; payment asset/route/refund policy; external marketplace
compatibility; editions/offers scope. Do not select these through constructor defaults.

Application Team/admin/moderator permissions and two-wallet gasless approvals remain
separate from contract custody/upgrades. Ordinary text/voice actions retain visible
review and wallet confirmation. Agent signing remains C-27 research.

## 7. Economics, interpretations and verification limits

Profitability is a product hypothesis, not a contract feature or guarantee.
Measure completed sales, repeat participants, conversion/settlement failure and
gas/RPC/storage/moderation/support cost against net protocol revenue.
Canon: primary protocol revenue 2.5%; resale protocol revenue 1%; separate 1%
ecosystem funds are not company income; donations have no protocol fee.
More routes help only when incremental completed sales justify their costs.
No fee increase, yield or investor entitlement is approved.

Interpretations recorded:
- Extensibility means reviewed versions/capabilities, not arbitrary plugins.
- Cross-chain direction authorizes specification, not activation or implicit
  stablecoin conversion of ETH economics.
- Immutable/versioned templates are recommended; July's UUPS proposal was not binding.
- Round-trip invalidation is a locally evidenced rework requirement, not a live fix.
- Existing local collections and testnet Donate must not be described as absent,
  nor promoted to finished mainnet products.
- No fixed contract count, new fee, governance delay/threshold, Genesis allocation
  or universal network support is invented.

Validation: source/canon comparison, primary references and one local prototype
reproduction. No external audit, end-to-end collection acceptance, upgrade safety
proof or production deployment is claimed by this design update.
