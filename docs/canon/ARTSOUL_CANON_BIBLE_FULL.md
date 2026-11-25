# ArtSoul Canon Bible

Decision authority clarification (2026-11-02): [Current decisions and document evolution](CHANGELOG_2026-11-02_DECISION_AUTHORITY.md).
This Bible records the current baseline and prior decisions; it is not an
immutable veto on improvement. Current founder instructions supersede outdated
entries. Use verified implementation evidence and current engineering practice,
then reconcile the documents. A proposal does not change deployed behavior or
silently authorize new economics, spending, custody or mainnet activation.

Development amendment (2026-09-20): [Collection Launch](CHANGELOG_2026-09-20_COLLECTION_LAUNCH.md)
authorizes a separate chain-aware collection path for local/testnet development.
It qualifies §§1, 4, 8, 9, 12 and 17 for that path only; the existing Base 1/1
protocol and unapproved Genesis/mainnet economics remain unchanged.

Approved research direction (2026-10-26): [Future contract extensibility](CHANGELOG_2026-10-26_CONTRACT_EXTENSIBILITY.md)
permits C1 design of versioned modules and cross-chain payment interfaces alongside
Phase B. It does not activate additional product networks, approve new economics
or upgrade powers, or close architecture sign-off. See the maintained
[Contract Rework Plan](CONTRACT_REWORK_PLAN.md).

Approved direction (2026-10-07): [Administration and verified collections](CHANGELOG_2026-10-07_ADMIN_AUTHORITY.md)
records mandatory approval by both designated authority wallets for role and
critical changes, authenticator-app or security-key login, and reviewed
collection-origin marks. These extensions to §§11 and 16 are not evidence of
deployment or activation; current capabilities and remaining gates are stated
in canon 07 and the stabilization checkpoint. Ordinary reports remain human
moderator decisions. Auction economics and Trust weights are unchanged.

ArtSoul is an auction-first NFT art protocol on Base. Artists publish work, the community discovers and signals interest, a primary auction establishes the first collector and canonical floor, settlement lazily mints the NFT, and later resale preserves creator royalties and public provenance.

The internal codename is V4.1. Do not expose the version label in user-facing UI, investor materials, or public marketing copy.

## 1. Protocol Truth

- Contracts and transaction receipts are protocol truth.
- The public product reads indexed projections from `/api/public/artworks`.
- Local pending state is only a temporary bridge after a confirmed transaction while the indexer catches up.
- Legacy Supabase artwork rows are compatibility/history only and must not become public canonical truth.
- The canonical chain is Base. Base Sepolia is the only active product testnet. Historical Ethereum Sepolia records may remain readable during migration work, but Ethereum Sepolia is not an active write network or a selectable product network.

## 2. Artwork Lifecycle

1. Creator uploads media and metadata.
2. Creator registers artwork on-chain.
3. Creator starts a primary auction.
4. Community can bid during the selected duration. In a new ordinary auction, an accepted bid with at most 10 minutes remaining adds 10 minutes to the current end, capped at one hour past the original end. A bid arriving at the closing timestamp is too late. The bidding countdown follows the confirmed end throughout.
5. If the auction ends with no bids, no NFT is minted and no floor is created.
6. If the auction ends with a winner, the settlement window opens.
7. Successful settlement lazily mints the NFT to the first collector and creates the canonical floor.
8. If settlement is missed, the auction defaults according to the deposit split rules.
9. Minted NFTs can later be listed on the whitelisted marketplace.
10. Resales update current owner and preserve provenance.

**New native ordinary-work pair, selected November 19, 2026.** Once bidding expires, anyone can close the auction. If it has a winner, the closing block starts a full 24-hour payment window. The winner can pay through the exact deadline. Only afterward may anyone finalize an unpaid default. A pause blocks new registration, auction creation, bids, resale listings and purchases. Closing, settlement and mint, default, cancellation of existing listings, processing refunds and withdrawing credit remain available under their usual conditions. The clock continues during a pause. The current Base Sepolia prototype retains its deployed behavior. [Decision, implementation scope and tests](../architecture/C1_REPLACEMENT_BOUNDARIES_2026-11-16.md#selected-entry-pause-and-payment-window)

**Second-highest bidder after default.** For new ordinary auctions, recording the original winner's default automatically opens one voluntary offer to the highest distinct losing bidder, if one exists. That bidder has 24 hours from the default block to pay their own last accepted bid in full, through the exact deadline. Their displaced deposit remains independently refundable in full. The defaulted winner's deposit still credits 80% to the creator and 20% to the protocol. The offer carries no bonus, acceptance charge beyond the purchase price, or penalty for declining. Network gas applies to transactions. The work becomes available for a new auction on decline or expiry, or immediately at default if there was no second bidder. There is no third offer. Only a successful purchase mints the NFT and establishes the floor at the amount actually paid. This decision covers ordinary auctions and leaves Partner Collection first-auction rules separate.

### Future Contract Requirement: Automatic No-Bid Finalization

> **FUTURE / MAINNET REDEPLOY ONLY - NOT CURRENT TESTNET BEHAVIOR**

Expired auctions that received NO bids must become re-auctionable without a user-facing "End Expired Auction" step. A contract cannot execute itself on a timer, so the next contract version must expose deterministic, permissionless finalization that can be triggered lazily by the next interaction, by a motivated creator, or by keeper infrastructure. The caller can trigger the transition but cannot choose its outcome. The current testnet contract's manual user workflow is not the target behavior.

This requirement does not change the no-bid economic outcome: no NFT is minted and no floor is created. It is a contract-state transition requirement for the next mainnet contract version, not a description of the deployed testnet contract.

In the local ordinary-work replacement, `currentAuctionForWork` returns zero at the bidless deadline using a read. The creator's next auction records the old close and opens the new round in one signed transaction. A winner who is ready to pay may also close and settle together. Anyone can still open the full payment window separately. A standalone close costs the submitting wallet network gas. No keeper subsidy or additional creator charge is configured.

## 3. Frozen Economics

These values are frozen unless the canon is formally amended before deployment:

- Primary sale: 97.5% creator, 2.5% protocol.
- Resale: 92.5% seller, 5.5% creator royalty, 1% protocol, 1% Ecosystem Pool.
- Defaulted settlement deposit split: 80% creator, 20% protocol.
- Minimum deposit: 0.01 ETH.
- Bid increment: max(+0.01 ETH, +2.5%).
- Auction durations: 24h, 36h, or 48h.
- Settlement window: 24h.

### 3.1 Losing-bidder refund architecture

- Losing bidders receive their refundable deposit obligation in full. The default penalty applies only to the defaulted winner.
- Finalization records deterministic refund obligations; it must not depend on every losing bidder sending a transaction.
- Refund execution is bounded and batchable so an auction with many bidders cannot create an unbounded-gas finalization loop.
- Keeper or protocol automation may process bounded refund batches. A failed transfer becomes an individually withdrawable credit so one recipient cannot block finalization for everyone else.
- Every terminal auction state must account for each deposit exactly once. Contract tests must cover batching, failed-recipient fallback, idempotency, and double-payment prevention.

## 4. Lazy Minting And Floor

- An NFT exists only after successful settlement.
- The floor is created only by a successful settlement or a collection buy-now mint.
- Discovery signals and trust never set price, floor, ownership, or settlement state.

## 5. Public Roles And Provenance

Every NFT surface must show:

- Creator
- First Collector
- Owner, only when different from the First Collector

Use the label "First Collector". Do not use "winner" or "auctioner" in provenance UI. Preview cards remain creator-focused; full NFT pages show the complete timeline from indexer data.

## 6. Trust And Discovery

Artist-support consolidation (2026-09-30): voluntary donations never affect Trust
or discovery. See [the bounded support amendment](CHANGELOG_2026-09-30_ARTIST_SUPPORT.md).

Trust affects discovery ordering only. It never changes price, floor, ownership, settlement, royalties, or treasury rules.

Public trust weights:

- Verified: 1x
- Genesis: 1.3x *(Amended 2026-07-13 by founder decision. Superseded value: 2x.)*
- 100+ settlements: 3x
- Partner: 5x

Use the highest applicable weight, capped at 5x.

**Genesis trust weight — Amended 2026-07-13 by founder decision.** The Genesis attribute contributes a bounded ×1.3 multiplier and never more. It is a status signal, not control. Other weights (100+ settlements 3x, Partner 5x) still apply through the highest-applicable rule, so a Genesis holder who also earns those keeps the higher weight; but Genesis status **by itself** confers at most ×1.3. Genesis aggregate influence must never be able to decide a contest or ranking alone: discovery rankings and contest outcomes must remain winnable by non-Genesis works on organic community demand. Rationale for lowering 2x → 1.3x: with 10,000 holders forming the early active majority, a 2x Genesis weight would let the Genesis cohort effectively decide "best of week" outcomes, corrupting the very public metrics ArtSoul reports. ×1.3 is a felt privilege without capture.

> **Superseded (kept for history):** The prior canon set Genesis trust weight to 2x with no Genesis-specific ceiling beyond the global 5x cap.

Hidden anti-sybil implementation details, private scoring, operational review rules, and abuse heuristics are intentionally excluded from this public repository.

### 6.1 Promoted homepage banners

Of 12 homepage banner positions, community signals rank at least nine on merit.
Up to three **Promoted** positions may be allocated by public slot auction, free partner
placement or individually negotiated sponsorship. Free and in-kind placements use
the same allocation. Cash proceeds belong to ProtocolTreasury. Publish the sponsor,
relationship and consideration. Placement affects only the designated banner.
Organic discovery, Trust, verification, artwork price, canonical floor and settlement
remain independent.

The November 25 decision allows the operator to set a public reserve for each new
banner-slot auction. Publish it before bidding opens and keep it fixed for that
auction. Artwork and collection starting prices are separate. Publish agreed direct
terms before delivery. Each placement has a finite period and an independent reviewer.
Related sponsors share a one-position limit during overlapping periods. The offline
[schedule preflight](../runbooks/PROMOTED_BANNER_SCHEDULE.md) checks those rules.
Live allocation, payments and delivery remain pending.

## 7. Genesis And Top-100k

*Section rewritten — Amended 2026-07-13 by founder decision (final Genesis spec). The prior text is preserved as "Superseded" at the end of this section.*

### 7.1 Contract

- Genesis is a **new, dedicated contract, working name `ArtSoulGenesis`**, designed from scratch as part of the contract rework (see `CONTRACT_REWORK_PLAN.md`).
- The existing testnet `ProjectNFT` (`0xBd17c875962a3cd34F10405234527a41A90A682B`) is a **transferable 100-supply prototype only**. It is **not** Genesis, is **not** extended into Genesis, and is **not** migrated. It is retired at the mainnet migration.

### 7.2 Supply and nature

- Genesis supply: **10,000** total.
- **Soulbound (non-transferable). Final.**
- Mainnet-only. Testnet actions never grant Genesis.
- Genesis is a real art NFT with image and animation metadata (IPFS).
- **Never sold.** There is no purchase path.

### 7.3 Allocation boundaries (confirmed 2026-07-13)

- **#0 (index 0):** founder.
- **RESERVED_TEAM = 200:** team, contributors, developers.
- **~1,000:** awarded for on-chain activity, **on Base mainnet only** (Base gas is cheap enough that real activity starts on mainnet; testnet activity does not qualify).
- **~8,799 (remainder):** distributed via contests/rewards in **admin-granted batches**.

Distribution is driven by the eligibility engine and the admin console, not by open self-claim.

The numeric grant cadence is an operational policy, not frozen canon. It remains tunable and must not be hard-coded from a roadmap placeholder. Grants must use published eligibility categories, durable grant records, an audit log, and multisig-authorized administration. No single operator receives undocumented discretion to redirect reserved supply.

### 7.4 Utilities — non-economic only

Genesis confers status and belonging, never an economic edge:

- Signature glow/aura site-wide and on the artwork page (visual tier per §13 / doc 16).
- Increased weight in the trust system: bounded **×1.3** with a hard cap (see §6).
- Discord role.
- Contest eligibility and priority.
- One undisclosed future utility (exists by design; details withheld).

### 7.5 No fee privileges — Final

- **No fee waiver and no fee discount for Genesis holders. Final.**
- Rationale (recorded): zero or reduced fees enable wash trading — cycling artworks between a holder's own wallets to inflate volume and traction for free. That corrupts public on-chain metrics, the trust ranking, and starves the Ecosystem/Reward Pool that fees fund. Genesis privileges are therefore visual, social, and discovery-weighted only.

### 7.6 Top-100k

- Top-100k is a separate soulbound numbered profile badge, not a transferable NFT and not an artwork aura.

> **Superseded (kept for history):** The prior canon described Genesis only as "supply 10,000; #0000 founder reserved; #0001–#9999 public; soulbound; mainnet-only; real art NFT; public eligibility via the approved Discord role and public activity path." It implied an open public claim (merkle-style self-mint) and did not define the team reserve, the mainnet-activity/contest split, the admin-console batch distribution, the explicit no-fee-privilege rule, or that Genesis is a new dedicated `ArtSoulGenesis` contract distinct from the `ProjectNFT` prototype.

## 8. Partner Collections

Any individual author or project may create an ordinary artwork or design a collection. Authors may base the sale on a distinctive first work or a uniform-price auction of comparable editions. Free allowlist membership and a separate auction of mint reservations with public terms serve different purposes. Identity review and curated Partner status are independent of authoring eligibility. [Collection launch scope and implementation status](CONTRACT_REWORK_PLAN.md#collection-launches-on-artsoul)

Partner collections use the same per-artwork floor system as normal artworks.

- One genesis auction at a time for the first item.
- The collection floor is fixed only after that first auction settles.
- The first auction can be attempted at most three times.
- If all three attempts fail, the collection is cancelled and enters a 30-day cooldown.
- The three-attempt rule applies only to a collection's first auction, not to normal user artworks.
- After the first settlement, remaining items become available through buy-now mint at the collection floor.

## 9. Marketplace Enforcement

- NFT approvals are restricted to whitelisted marketplaces.
- For the new ordinary-artwork pair, the ArtSoul Admin Security Safe (2 of 3) publicly schedules the specific Base operator. Admission and readmission require a 48-hour delay. The Safe may cancel a pending admission or disable an active operator immediately. Each NFT owner decides whether to grant operator approval. Readmission requires fresh consent. [Operator admission](CONTRACT_REWORK_PLAN.md#external-marketplace-admission)
- Wallet-to-wallet movement is a non-sale event.
- Resale economics apply only to marketplace sales.
- Initial auctions, primary mint and the launch price history belong on ArtSoul. External display should direct collectors to the ArtSoul work or collection page when available. A compatible external marketplace may later be admitted for optional resale. If ArtSoul distributes the same fixed-price order, both venues should show the same gross asking price and identify fees and seller proceeds. [Collection launch plan](CONTRACT_REWORK_PLAN.md#collection-launches-on-artsoul) · [External sale conditions](CONTRACT_REWORK_PLAN.md#same-asking-price-across-marketplaces)

## 10. Token Policy

ArtSoul is token-free.

- No token.
- No points.
- No airdrop logic.
- No passive-income promise.
- No token reward accounting in code or docs.

Any future token decision requires a new explicit canon amendment and is out of scope for the current product.

## 11. Moderation And Copyright

Donation messages use this same complaint-driven review system. Staff may hide a
message on ArtSoul; they cannot reverse a donation or alter its immutable event,
recipient, amount or anonymity flag.

Moderation is complaint-driven and reviewable:

- Report button on artwork surfaces.
- Notice-and-takedown flow.
- Valid copyright claim can auto-hide content pending review.
- Review queue, notifications, and audit log.
- Critical or irreversible actions are gated by multisig.
- Social logins alone are not sufficient for critical moderator actions.

Current application authority (founder amendments October 8, 11 and 13, 2026;
full rules in `07_ADMIN_MODERATION_CANON.md`): role changes, authority rotation
and factor setup/recovery require gasless signatures from BOTH current authority
wallets. The current pair approves its replacement. This application authority
does not use a new Safe or change on-chain contract custody. Staff sign in with
a passkey or authenticator app; wallet login alone does not grant complaint
access. Verified access has a fixed maximum of 24 hours without sliding renewal,
and a different browser session or trusted network context requires verification
again. Setup permission remains 15 minutes. The verified Team role and either
current authority may see the staff directory; other admins/moderators may not
enumerate colleagues. Ordinary complaint decisions remain with assigned staff;
AI may recommend a decision but does not autonomously grant roles.

The October 3 paragraphs below retain the earlier policy history. Their
two-passkey/separate-bootstrap/Safe-only application-recovery requirements are
superseded by the explicit October 8 amendment above. A8's implementation and
acceptance are recorded separately in the implementation backlog and dated
moderation evidence; this consolidation introduces no new authority mechanism.

Founder scheduling amendment, 2026-10-03: perform real founder passkey enrollment
and the associated operator recovery ceremony now, superseding the September 29
deferral. Preserve the two independent passkeys, audited bootstrap and ordered
activation checks; authorization to prepare is not evidence of enrollment or
permission to bypass staff authorization. See
`CHANGELOG_2026-10-03_PHASE_A_ACTIVATION.md` for the exact boundary.

First-enrollment amendment, 2026-10-03: an authenticated, actively assigned staff
wallet may explicitly create its first passkey without entering a code when its
live, unused and audited bootstrap approval already exists. The server binds and
atomically consumes that exact approval and challenge; it cannot create or renew
approval through registration. Historical keys or an established bootstrap deny
this path. Additional-device and Safe recovery enrollment keep their one-time
tokens and authorization; a verified user's explicit native add-key flow may
transfer its self-grant internally without displaying a code. The first approved
bootstrap no longer requires separate code possession;
the two independent founder passkeys, native user verification and Safe-only
recovery requirements remain. See canon 07 and the A8a runbook for the boundary.

## 12. AI Valuation

AI valuation is guidance-only.

- It never affects settlement, floor, royalties, ownership, or ranking guarantees.
- API keys are server-side only.
- Browser localStorage must never contain AI provider keys.
- Features and outcomes may be logged for a future in-house model.

## 13. Visual Canon

Classic and Future themes are strictly separated.

- Theme colors live in `unified-styles.css` variables.
- Future colors never appear in Classic.
- Classic colors never appear in Future.
- Classic interface feedback is static: no animated transitions, loading effects or smooth scrolling (founder amendment, 2026-11-01; supersedes the August 10 allowance). Keep the original Classic palette. Artwork video/audio remains user-controlled content, not interface animation. Verification marks and any separately approved static frame treatment remain available.
- Future can use motion and glow.
- Mobile and desktop may differ in layout only, not color semantics.

## 14. Treasury Rules

Artist donations route 100% to the canonical creator and bypass both protocol
treasuries and company capital. They are not protocol revenue or artwork payments.
For the first Base mainnet release, supporters copy the original creator’s address and send ETH directly from their wallet. Per-artwork history and optional messages belong to the Base Sepolia forwarder, which accepts any non-zero amount with or without a message. [Creator support decision, November 19](SUPPORT_THE_ARTIST_DESIGN.md)

ProtocolTreasury and EcosystemTreasury are separate from company operating capital.

- ProtocolTreasury receives protocol fees.
- Ecosystem Pool receives the 1% resale allocation.
- **Ecosystem Pool funds emerging-artist grants, community growth, and the community reward/contest loop** *(Amended 2026-07-13 by founder decision)*.
- Ecosystem Pool is never used for team salaries, investor distributions, or passive income.

### 14.1 Ecosystem / Reward Pool as a closed loop — Amended 2026-07-13 by founder decision

The 1% ecosystem allocation accrues from sales and resales and funds community rewards and contests once Genesis distribution matures. This forms a closed loop with **no token involved**: fees → pool → contests → activity → fees.

The activation threshold for pool-funded contests is not frozen canon. A numeric date, distribution count, or percentage may be proposed during Phase C, but it remains an undecided operational and treasury-governance input until explicitly approved and recorded. Roadmap estimates must not silently become protocol mechanics.

- Architecture (to be finalized in `CONTRACT_REWORK_PLAN.md`): the pool may be a **module inside Core** rather than a separate contract; the decision is made on security and simplicity grounds and recorded there.
- The token-liquidity-reserve purpose is **removed** from Ecosystem Pool usage because ArtSoul is token-free (§10). A token remains a possible future phase only and must not be referenced in pool mechanics now.

> **Superseded (kept for history):** The prior canon listed "future token liquidity reserve if ever approved" as an Ecosystem Pool use. That contradicts §10 (token out of canon) and is removed.

### 14.2 Known deployed-contract deviation (to fix in the rework, not a canon change)

The deployed Base Sepolia testnet contracts implement resale as **90% seller / 7.5% creator / 2.5% protocol with no Ecosystem Pool split**, and the NFT stores a **7.5%** royalty. This is a **known prototype deviation** from frozen canon (92.5 / 5.5 / 1 / 1, creator royalty 5.5%), to be corrected in the mainnet contract rework. The deployed testnet contracts are non-canonical prototypes and must not be promoted to mainnet.

The new ordinary market allocates indivisible wei by largest fractional remainder. Ties favor the creator before the protocol for primary sales and defaults. Resale ties follow seller, creator, protocol, ecosystem order. The paired NFT quotes the 5.5% creator royalty. The final deployment and independent review remain open. [Approved payout rule and examples](14_PROTOCOL_REVENUE_AND_TEAM.md#whole-wei-payouts-on-the-new-ordinary-market)

## 15. Public Beta And Mainnet

Public beta may use testnet infrastructure and local or hosted indexers. Mainnet requires persistent indexer operations, monitored infrastructure, RLS-secured data access, and completed legal/founder tasks.

The [roadmap](17_ROADMAP_PHASES.md) and [implementation backlog](12_IMPLEMENTATION_BACKLOG.md)
record the dependencies and acceptance criteria for each phase.

## 16. Pre-Mainnet Migration And Data Reset

*New section — Amended 2026-07-13 by founder decision.*

When the reworked contracts are deployed and testnet validation is complete, a **full migration is performed once, before public launch** (start of Phase D). It is mandatory:

1. Keep the current testnet application data, media and backups. Prepare the mainnet catalog in a separate, clean environment.
2. Before any separately approved destructive change, record the affected scope, verify a recoverable backup and successfully restore the affected database and media into an isolated environment. Retain the recovery evidence privately.
3. Start the mainnet catalog without testnet artworks, auctions, bids, signals, or derived profile stats. Existing testnet records and public-chain history create no mainnet allocation or eligibility.
4. Remove all old contract addresses from config and UI.
5. Keep testnet media separate from mainnet Storage. Creators may publish the same titles afresh.
6. The indexer resets to the new contracts from their deploy block; no legacy chain is indexed for writes (Ethereum Sepolia stays fully retired).
7. Verification pass: no leftover connections, endpoints, env vars, or UI references to old contracts or networks remain.
8. Exercise a full publish → auction → settle → mint → resale cycle on the fresh deployment.
9. Only after all of the above does the public/marketing phase proceed.

This is the mandatory pre-mainnet migration checklist. It runs after the reworked contracts pass a fresh public-testnet cycle and before any mainnet marketing.

*Founder decision, November 25, 2026.* The public-testnet Snapshot A and its two-week announcement were retired. C16 and D1 remain historical identifiers. A public archive or notice period is no longer a condition for any phase, cutover or launch. The existing read-only archive tools remain available for historical files. Operational backups and tested restoration still precede any destructive action.

*Launch presentation clarification — November 19, 2026.* ArtSoul opens its
Base mainnet catalog with works published on that deployment. Before the first
publication, the gallery can show its empty state and publishing action. The
homepage, gallery, ArtSoul profile collections, artwork histories and protocol
metrics use mainnet records from launch, including genuine early activity.
Testnet examples, owners, prices, sales and volume stay out of those surfaces.
A creator may publish their own work afresh on mainnet with the ordinary
publication flow. Testnet ownership and floor history do not transfer with it.
The application cutover cannot erase transactions or NFTs already recorded on a test blockchain.
Retiring this testnet is a separate decision from upgrading a future mainnet
deployment with outstanding payouts and NFTs.

## 17. Phase Status And Canonical Phase Model

The [November 25 release decision](CHANGELOG_2026-11-25_RELEASE_SEQUENCE.md) governs testnet custody, production wallet selection, audit timing, operating readiness and the use of actual demand when deciding whether to expand.

September 30 scheduling amendment: the founder requests implementation of the
previously approved artist-support feature now, as an isolated, tested addition.
See `CHANGELOG_2026-09-30_ARTIST_SUPPORT.md`; this does not itself close Phase A
or authorize mainnet deployment.

*Aligned 2026-07-16 by founder decision.* The canonical roadmap has four phases:

- **Phase A: Stabilize Public Testnet** (engineering readiness accepted October 24, 2026; see [the acceptance decision](../testnet/CONTROLLED_BETA_ENTRY.md)).
- **Phase B: Public Beta**.
- **Phase C: Mainnet Preparation**.
- **Phase D: Staged Mainnet Launch**.

On November 18 the founder closed active Phase B engineering and started local
Phase C development. The [engineering closeout](../PHASE_B_STATUS_2026-11-02.md)
records the controlled journeys and the hosted observations that carry forward.
The public cohort, operator and support coverage, and feedback triage move to
the C13 rehearsal with the replacement contracts. The invitation window remains
closed until the entry checklist is complete. Mainnet has its own approval.

The 2026-10-03 founder amendment brings real passkey setup and its operator
ceremony into current Phase A activation, superseding the September 29 deferral
to Phase C. Existing acceptance gates remain required; mainnet is not authorized.

`17_ROADMAP_PHASES.md` and `12_IMPLEMENTATION_BACKLOG.md` expand this model but remain subordinate to this Bible. They may schedule work; they may not create economics, contract mechanics, Genesis grant cadence, treasury triggers, legal-entity decisions, or product scope that the Bible has not approved.

Earlier informal A–G plans are retired. Their stabilization and testnet work maps to Phase A; beta and cohort work maps to Phase B; contract rework, Genesis, Collections, security review, legal readiness, and final visual work map to Phase C; deployment and staged activation map to Phase D. Historical token or multichain phases have no current mapping and remain out of scope.
