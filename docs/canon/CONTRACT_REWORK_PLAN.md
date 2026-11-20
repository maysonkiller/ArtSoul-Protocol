# Contract Rework Plan

Status: **C1 research/design in progress; architecture sign-off pending.**
Reviewed: 2026-10-26 against repository `b4ca2523e18c8837ec79174a83c2fb8b1a3b639e`.
This replaces the July 13 proposal in this maintained file; history remains in Git.
The November 19 [ordinary-artwork decision](../architecture/C1_REPLACEMENT_BOUNDARIES_2026-11-16.md#ordinary-artworks-after-mainnet-launch)
sets the lifetime of the mainnet auction and NFT contracts for the design.
Deployment and architecture sign-off are still pending.

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
November 18 inventory closed C-19. The current Hardhat build contains 12
first-party Solidity source files and 18 first-party and fixture artifacts.
Each artifact resolves to a source in the checkout. Git tracks no Hardhat
artifacts, and the active build contains no retired Marketplace or Token contract.

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
The selected ordinary-pair entry pause keeps fulfillment and exits available throughout the payment window. Other product families retain their own decision records. [Ordinary-pair policy](../architecture/C1_REPLACEMENT_BOUNDARIES_2026-11-16.md#selected-entry-pause-and-payment-window)

## 3. Canon coverage

| Area | Preserve / extend only within stated scope |
| --- | --- |
| Ordinary 1/1 | Publish → auction → successful settlement → mint; no-bid/default creates neither NFT nor floor |
| Economics | Primary 97.5/2.5; resale 92.5/5.5/1/1; default deposit 80/20; current deposit max(0.01 ETH, ceiling(10% of bid)); increment max(+0.01 ETH, +2.5%) with exact integer rounding; auctions 24/36/48h, settlement 24h |
| Deadline semantics | In the new ordinary-work pair, an accepted bid in the final 10 minutes extends the current end by 10 minutes, up to one hour past the original end. Bidding closes at the exact end. Permissionless close starts a full 24 hours for payment. Settlement is inclusive at the payment deadline and default strictly later. Entry pause preserves both paths. |
| Ordinary runner-up after default | One voluntary 24-hour offer at the distinct runner-up's own bid, with full separate refund and exact new payment. Decline or expiry releases the work. Record the actual buyer and sale price. [Decision](../architecture/C1_REPLACEMENT_BOUNDARIES_2026-11-16.md#voluntary-purchase-by-the-second-highest-bidder) |
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

### Collection launches on ArtSoul

The November 19 product direction places the collection announcement, live auction, settlement history and primary mint on ArtSoul. A compatible external marketplace can display an issued NFT and its link back to ArtSoul. When a stable public collection URL is available, use it for the collection's external link. External listing distribution is optional and can follow the primary launch.

| Creator's goal | Proposed launch experience | Price shown to collectors |
| --- | --- | --- |
| Launch a series from one distinctive work | Any author can draft the first-artwork auction. One paid winning bid fixes the price for later primary mints. The collection reserves token 1 and its metadata for this buyer even if another collector claims a later NFT first. | If the first work settles for 10 ETH, each remaining primary mint costs 10 ETH. A round with no sale sets no price. |
| Launch comparable editions as an individual or a project | Allocate multiple NFTs to an opening auction, one funded bid for one NFT per wallet. Link the public mint to the opening round's clearing price. | With 100 places filled, all winners pay the 100th-ranked accepted bid. If that bid is 1 ETH and the highest is 10 ETH, the public mint price is 1 ETH. The high bidder can withdraw the 9 ETH excess. |

In the generic prototype, equal bids are ordered by their on-chain sequence. With fewer qualifying bids than places, winners pay the preset reserve. With no bids, no NFT is allocated by the auction. The linked public phase requires a full round or a fallback disclosed before bidding. The template leaves the public phase unavailable when the round does not fill. Only unused allocation can roll over under its published rule. A winning allocation remains claimable. The author still sets supply, allocations, reserve and dates. [Local collection contract](../../contracts/launch/CollectionLaunch.sol) · [Launch tests](../../test/CollectionLaunch.test.cjs)

**Free community allowlist.** Membership is free. The published mint price and network gas can still be payable. Disclose the allocation, wallet limits and dates before anyone participates. Any creator can choose a launch model. The blue origin mark records a separate review, and Partner status identifies a curated relationship. The partner model retains its first-auction retry limit and 30-day cooldown. [Partner rules](ARTSOUL_CANON_BIBLE_FULL.md#8-partner-collections)

The edition auction allocates actual NFTs. The reservation auction below allocates the right to buy one later. Keep reservation turnover out of artwork sale prices. Publish allocations, unit prices and completed mints separately.

#### First-work attempts for Partner launches

The [Partner first-work template](../../contracts/launch/PartnerFirstWorkLaunch.sol) locks one fully funded opening auction and a flat-price public phase for the entire remaining supply. Creation stays open to authors and projects. Partner designation requires its own curated record.

The collection controller can retry after an opening expires with zero bids, up to three attempts. The chain moves both phase windows together and keeps the published reserve, durations, allocation and per-wallet terms. Each attempt emits the actual dates. A funded bid commits the opening to settlement. A late permissionless close starts the public mint window if its advertised start has passed. The existing first-auction record supplies the exact paid price for every public mint. The stored winner identifies the collection's First Collector, including when the winner directs token 1 to another recipient.

After three empty attempts, cancellation is dated from the third on-chain deadline. At that deadline plus 30 days the controller can submit one on-chain request for a new Partner review. The cancelled auction history stays final. Classifying a new application under the same curated identity requires the Partner review service. [Local lifecycle and cooldown tests](../../test/launch/PartnerFirstWorkLaunch.test.cjs) cover the exact boundary and the absence of a mint, floor or payouts after cancellation. This is an additive, fresh-deployment contract. The shared collection helper introduces no storage slots. Public testnet deployment and independent review remain open.

#### Checking the published metadata for token 1

Export the collection from **Manage drafts → Download draft** and run the read-only check against the prepared metadata.

```sh
node scripts/check-collection-metadata.mjs draft.json
```

The check fetches the builder's exact token 1 URI from the public IPFS gateway or the configured public ArtSoul artwork store. It requires a display name and image URL, checks the optional animation URL, and prints the SHA-256 of the original response bytes. A later run can pass that digest as the second argument to detect changes. The check reads only the JSON document. Media availability, the rest of the edition, and a deployed contract's actual `tokenURI(1)` each require separate evidence. Other HTTPS hosts require an independent read.

#### Auction of mint reservations

**Local prototype, open for drafting by individual creators and projects.** The builder previews both prices before bidding. The [reservation escrow](../../contracts/launch/MintReservationEscrow.sol) reuses the funded auction and holds the price of each place through its own redemption window. The [local fixture](../../contracts/test/MintReservationFixture.sol) exercises custody and NFT issuance on a disposable EVM. The builder has no payment or publishing entry point for this format.

**Terms visible before bidding.** Publish the collection, currency, reserved supply, public mint price, exact additional mint payment for a holder, minimum bid for a place and the full timetable. Lock the inventory against public sales. Use a reserve expressed in ETH. Choose the highest funded bids up to the number of places. All winners pay the lowest winning bid when full, or the published reserve when undersubscribed. Break ties by confirmed bid sequence. Losing bids and excess funding become withdrawable in full. The winning payment buys a time-limited right and is separate from the mint payment. Show the bidder's maximum total before signing.

| Illustrative public mint at 1 ETH | Paid for the place | Paid to mint | Total outlay before gas |
| --- | ---: | ---: | ---: |
| Winner keeps the place | 0.10 ETH | 0.80 ETH | 0.90 ETH |
| Another collector buys the place from the winner | 0.15 ETH | 0.80 ETH | 0.95 ETH |
| Another collector pays a higher asking price | 0.30 ETH | 0.80 ETH | 1.10 ETH |

**Transfer and redemption.** For a pilot, allow one fixed-price resale per place on ArtSoul within 24 hours, then give every final holder a separate full redemption window. Publish its duration before bidding. The first owner can simply keep the place. The contract updates ownership and accepts the resale payment atomically. A cancelled or filled listing cannot be reused. Only the current holder can redeem once. Mint the artwork and collect the exact additional payment together. The UI shows the seller's asking price, the additional payment, the total and when sale proceeds become withdrawable.

| Outcome | Reservation settlement |
| --- | --- |
| Mint succeeds | Credit the creator 97.5% and the protocol 2.5% of the original clearing premium plus the actual mint payment, rounded once. Credit the full resale payment to the selling holder. |
| Holder lets a fully available mint window expire | The place expires, the reserved unit is released, and the place payments settle as above. There is no mint payment or NFT. |
| Launch fails before delivery and before the holder has had the full usable window | Credit the original place payment to the original payer and any resale payment to its buyer. Keep both payments escrowed until success or normal expiry. Each payer can withdraw independently. Network gas is separate. |

The local contract locks the holder price and reserved inventory before bidding. Finalization opens the windows at its mined timestamp. An entry pause can interrupt the 24-hour resale period. Holders can redeem throughout the following mint window during that pause, and anyone with a credit can withdraw. Resolving an expired place releases at most one unit to the public phase while it is still available. Unsold places stay unminted. The [escrow tests](../../test/MintReservationEscrow.test.cjs) cover exact deadlines, unfilled rounds, separate payer withdrawals, rejected mint recipients, public supply limits, and settlement during a pause.

Before accepting funds, specify how the contract independently establishes a failed launch and its timestamp. The fixture uses a synthetic failure to exercise the refund path. A production implementation and independent review remain open. An indexer must count fulfilled NFT mints for provenance and sale prices, and record place purchases and resales separately. Track the number of redeemed places and unique wallets that minted alongside the published supply.

In local receipts, awarding and reselling a place produced neither a mint nor an NFT transfer. Exercising it emitted one mint at the additional mint price and recorded the NFT recipient as First Collector, including when the holder paid for a gift. The public indexer does not yet ingest these launch events.

**Fee basis selected under the founder's November 19 pricing delegation for the first reservation release.** Apply the existing 2.5% primary rate once to the amount earned by the creator for each resolved place. Redemption earns the original clearing premium plus the actual additional mint payment. Normal expiry earns only the premium. Delivery failure earns zero and both payers recover their full payments. Exclude losing bids, excess deposits, gas and the separate resale payment from the basis. The pilot credits the entire optional resale payment to the selling holder. Ordinary secondary sales of issued NFTs follow the [existing resale split](14_PROTOCOL_REVENUE_AND_TEAM.md#resale). A fee on the mint payment alone would yield zero revenue for a fully prepaid place. A fee-free resale also leaves a project-affiliated holder able to earn resale proceeds. Compare primary proceeds, place resale turnover and redeemed units before expanding the pilot.

For a winning premium of 0.10 ETH, resale at 0.15 ETH and mint payment of 0.80 ETH, redemption credits 0.0225 ETH to ProtocolTreasury, 0.8775 ETH to the creator and 0.15 ETH to the first holder. On normal expiry those credits are 0.0025, 0.0975 and 0.15 ETH respectively. The on-chain mint event records the additional 0.80 ETH on redemption. The launch draft previews the split at the minimum bid. If the final clearing premium is higher, settlement uses the actual funded premium.

The public mint price and the holder's additional mint payment are visible from the start. This mode has no price-reveal step.

OpenSea Studio documents public and allowlisted sale stages. QQL documents separately issued passes traded on OpenSea and redeemable for one work, without expiry. These are precedents for individual features. Their documentation does not establish a Studio template for an auction of reserved places with one 24-hour resale window. [OpenSea Studio and SeaDrop](https://docs.opensea.io/docs/seadrop) · [QQL Mint Pass](https://www.qql.art/docs/how-to-qql/what-is-a-qql-mint-pass)

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

### Same asking price across marketplaces

The primary launch and its price history belong on ArtSoul. External display and links back to the project take priority over cross-listing. For any future opt-in distribution of an already minted NFT's fixed-price listing, the goal is a common gross asking price wherever ArtSoul shows the same order. Sellers should see the proceeds for each available venue before signing. The wallet-facing identity is the Base chain ID, issuing NFT contract and token ID. Token metadata can be indexed before a seller lists a token.

| Path | Source of the price | What the collector can buy |
| --- | --- | --- |
| A partner displays an ArtSoul listing | The executable quote from the issuing Core, including the listing version, exact price in wei and current seller | The buyer's wallet can call the same Core directly. A filled, revoked, paused or superseded listing must stop presenting an executable price. The regular ArtSoul split applies once. |
| OpenSea accepts an external listing | An active seller-authorized order on the supported network. Match the token, seller, payment asset and exact gross consideration for one NFT, including required fee recipients. | For the first integration, prefer showing one external order on both sites with its settlement venue identified. Enable a purchase link only after the venue confirms the order. Its fees, creator earnings, seller proceeds and network gas must be distinguishable. An independent order can have a different price. |
| Partner collection | ArtSoul's first successful settlement establishes the mint price of its remaining supply. | Each already owned item can have its own resale listing. An external collection floor reflects the available asks indexed by that venue and can differ from the ArtSoul mint price. |

For a buyer-facing ask of 1 ETH, compare exact wei in native ETH on Base. A 1 WETH offer, a converted fiat estimate, the seller's net proceeds, a prior sale and a collection floor each represent different things. A preview that cannot verify a live order can still link to the work. It must not promise that it can be bought at a cached price. [OpenSea listing actions](https://docs.opensea.io/reference/create_listing_actions) · [Best listing by NFT](https://docs.opensea.io/reference/get_best_listing_nft) · [Marketplace fees](https://docs.opensea.io/docs/opensea-fees)

Keep the initial ArtSoul auction on the issuing Core. It accepts bids before the ordinary NFT exists and mints at successful settlement. OpenSea documents fixed-price listings and offers on existing NFTs. Revisit an external bidding integration if it can reflect the same bids, extensions, deposits, settlement and mint on that Core. [OpenSea selling](https://support.opensea.io/en/articles/8867002-how-do-i-sell-an-nft)

Future venue admission must identify the actual transfer operator and its execution paths on Base. A shared conduit alone cannot establish which website initiated a trade, which price the owner signed or which fees were paid. Keep entrant approvals separate from public reads. Before activating a specific operator, verify treatment of creator and treasury amounts for that execution route, and test explicit wallet consent, cancellation, partial outages and price changes. When an existing independent order can still fill, retain its true status until its cancellation or expiry is verified. Expose a synchronized ask only while both references represent the same executable terms. No venue has been activated by this decision. [Seaport order model](https://docs.opensea.io/docs/seaport-models) · [Order cancellation and status](https://docs.opensea.io/docs/seaport-interface)

#### External marketplace admission

For new ordinary NFTs, the founder selected the existing ArtSoul Admin Security Safe. It publicly schedules the exact operator address with a fixed 48-hour delay. Scheduling and activation require the bound Safe to have three owners and threshold two. After the delay, anyone can submit the activation transaction for that address. The Safe can cancel a pending admission or immediately disable an active external operator. Both defensive actions still work if the Safe strengthens its quorum. Base chain identity, reviewed Safe code, owner custody and enabled modules remain part of the release preflight.

An NFT owner can grant permission for one NFT or a collection-wide operator permission. Within the scope of that grant, the operator can transfer without asking for a further signature on every transfer. Disabling the operator makes both types of grant ineffective immediately. Readmission starts a new 48-hour review and requires fresh owner consent. Separately cancel unwanted orders at the venue before granting permission again. Public metadata and direct transfers by owners stay available. [ERC-721 owner and operator permissions](https://eips.ethereum.org/EIPS/eip-721)

Admission is per deployment and per transfer contract. Review any proxy upgrade rights, conduit controllers, sale terms and fee routing before scheduling a real address. Monitoring the on-chain announcement gives collectors time to inspect it. The security Safe receives no authority through admission to set prices, move an owner's NFT or withdraw funds. The local candidate starts with its own market and no admitted external market. [Safe-bound candidate](../../contracts/replacement/TreasuryBoundOrdinaryArt.sol) · [Local governance tests](../../test/TreasuryBoundOrdinaryArt.test.cjs)

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

### Separate Genesis grant pilot

The [Genesis candidate](../../contracts/genesis/ArtSoulGenesis.sol) is a fresh, immutable ERC-721 deployment. It implements [ERC-5192](https://eips.ethereum.org/EIPS/eip-5192) so wallets can identify locked art. Approval and transfer calls revert. It cannot receive payments or perform an ordinary artwork sale. Its constructor and grants require chain ID 8453. The isolated Hardhat simulation of that chain exercises the same bytecode; it creates no public awards.

The grant categories are Founder (number 0 for the reviewed founder recipient), Team (numbers 1–200 for contributors, developers and team), MainnetActivity (documented activity on Base 8453), and Community (published contest or reward decisions). Activity and Community share the remaining supply according to reviewed allocations. The batch ceiling of 32 limits transaction work. It does not determine how many grants the team should award in a period. Snapshot A and testnet activity are never eligibility evidence.

Before proposing grants, publish the applicable criteria and preserve their byte hash. Record the reviewed evidence for each recipient, including the actual Base chain and finalized activity for activity awards. Use opaque or salted evidence commitments for private adjudication details. Both the retained decision and the Safe review must bind the recipient, serial, category, deployment and policy. The [offline encoder](../../scripts/prepare-genesis-grants.mjs) takes these fields and produces a zero-value CALL for the named Safe. It has no signer or network connection. The chain enforces the designated authority, multi-party threshold, available serial and category. The signers verify the real-world evidence behind the commitment.

The constructor accepts a single IPFS directory root in the form `ipfs://<CID>/`. It validates a lowercase base32 CIDv1 with DAG-PB and a 32-byte SHA-256 digest, including its final padding bits. The directory must contain the decimal serial as a filename (`0`, for example). File availability and media content are verified separately. [IPFS CID specification](https://specs.ipfs.tech/cid/)

Before D5, review the actual Safe implementation, modules and owners, pin and independently verify every referenced IPFS metadata file and its image/animation, agree the founder recipient and first pilot batch, and obtain independent review. Use the [Genesis metadata checker](../../scripts/check-genesis-metadata.mjs) with the immutable directory, the serial and the three locally reviewed files. Its default run reads local files and reports their hashes. Repeat with `--published` to retrieve the exact metadata URI, image and animation from IPFS and compare all three with the reviewed bytes. Keep the results for serial 0 and each pilot serial and independently confirm the pin and playback. Match the mined grant and lock events against the reviewed decision before displaying benefits. The pilot remains closed.

### Independent review scope for the first Base release

Request separate prices for the following scopes once the production candidate is frozen. Record the Git commit, compiler and optimizer settings, dependency lockfile, constructor inputs and build hashes on the quote. Ask each reviewer to list exclusions, cost and coverage of a fix review, and which later changes would require another review. An estimate has yet to be obtained. [Audit preparation guidance](https://www.openzeppelin.com/readiness-guide)

| Scope to price | Code and boundaries | Review outcome |
| --- | --- | --- |
| Ordinary market, required for launch | Concrete Core and its [auction](../../contracts/replacement/OrdinaryArtAuctions.sol), [refund](../../contracts/replacement/OutbidRefunds.sol), [resale](../../contracts/replacement/OrdinaryArtResales.sol) and [Safe binding](../../contracts/replacement/TreasuryBoundOrdinaryArt.sol) code, the paired [NFT](../../contracts/replacement/SettledArtworkNFT.sol), relevant inherited libraries and the release wiring. | Trace a deposit through every terminal outcome and withdrawal. Verify conservation and rounding, who can mint or move an NFT, marketplace approvals and their revocation, pause authority, callbacks, and both permanent pair bindings. Verify the deployment payer receives no administrative or treasury role. |
| Artwork-linked creator support, optional incremental quote | [CreatorDonations](../../contracts/ArtSoulDonations.sol), [registry adapter](../../contracts/replacement/OrdinaryArtDonations.sol) and their inherited code. Include the original creator lookup, recipient callbacks and failure behavior, message bounds, pause and two-step ownership transfer. | Verify the creator receives the exact payment, a failed transfer rolls back its event, and the forwarder has no special authority over deposits or minting. Review ownership renunciation while paused and preflight the actual admin Safe. Identify the configuration and receipt checks needed to attribute support to the correct work and deployment. |

The first release supports direct ETH transfers to the original creator. Its Core and NFT have no dependency on the donation forwarder. An incremental quote lets the project weigh verified per-artwork history and messages against independent review and ongoing maintenance. Later changes to either side of the registry interface need an impact review. [Creator support decision](SUPPORT_THE_ARTIST_DESIGN.md)

## 6. Delivery and decisions

The [November 2 decision/invariant annex](../architecture/C1_DECISION_INVARIANTS_2026-11-02.md)
adds a source-linked deployment/mint-authority map, current pause/deadline matrix,
liability equations and integer vectors, and listing transition/event requirements.
Its D5 follow-up evaluates deterministic automation, optional execution reserves,
unused-reserve recovery and separately authorized purchase funding. No-bid lazy
finalization does not require mandatory gas prepayment; full automatic settlement
and cross-network funding still need their own authorization/accounting decisions.
It distinguishes present prototype facts, approved requirements, recommendations
and undecided policy. It is not architecture sign-off or replacement Solidity.

The November 16 [minimal replacement boundaries](../architecture/C1_REPLACEMENT_BOUNDARIES_2026-11-16.md)
narrow this into a proposed immutable engine/NFT pair, deployment-scoped identity,
settlement-bound mint capability and isolated liabilities with bounded refunds.
The November 19 decisions select the ordinary-market entry pause, whole-wei payout rounding, three Safe addresses and delayed external operator admission. The concrete OrdinaryMarket candidate compiles with constructor-bound Safe roles. Contract sign-off still needs reviewed target-network refund settings, an independently reviewed release build and verification of the deployed pair. Each external operator requires its own compatibility evidence.

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

November 19 delegated design decision for ordinary artworks: keep each Core and
its NFT contract permanently paired. Future mainnet publications can use a new
pair while old tokens, ongoing auctions, resale history and payable claims
remain accessible on the same site under their original addresses. The
[deployment lifetime decision](../architecture/C1_REPLACEMENT_BOUNDARIES_2026-11-16.md#ordinary-artworks-after-mainnet-launch)
includes the ERC-721 identity rule and the operational trade-off. Repair of
immutable code requires a new deployment. This choice does not authorize a launch.

Pending decisions: other components' upgrade boundaries and emergency policies, retirement authority,
multisig/delay/recovery, metadata permanence, first
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
