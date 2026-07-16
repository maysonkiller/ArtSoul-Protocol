# ArtSoul Canon Bible

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
4. Community can bid during the selected duration.
5. If the auction ends with no bids, no NFT is minted and no floor is created.
6. If the auction ends with a winner, the settlement window opens.
7. Successful settlement lazily mints the NFT to the first collector and creates the canonical floor.
8. If settlement is missed, the auction defaults according to the deposit split rules.
9. Minted NFTs can later be listed on the whitelisted marketplace.
10. Resales update current owner and preserve provenance.

### Future Contract Requirement: Automatic No-Bid Finalization

> **FUTURE / MAINNET REDEPLOY ONLY - NOT CURRENT TESTNET BEHAVIOR**

Expired auctions that received NO bids must become re-auctionable without a user-facing "End Expired Auction" step. A contract cannot execute itself on a timer, so the next contract version must expose deterministic, permissionless finalization that can be triggered lazily by the next interaction, by a motivated creator, or by keeper infrastructure. The caller can trigger the transition but cannot choose its outcome. The current testnet contract's manual user workflow is not the target behavior.

This requirement does not change the no-bid economic outcome: no NFT is minted and no floor is created. It is a contract-state transition requirement for the next mainnet contract version, not a description of the deployed testnet contract.

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

Partner collections use the same per-artwork floor system as normal artworks.

- One genesis auction at a time for the first item.
- The collection floor is fixed only after that first auction settles.
- The first auction can be attempted at most three times.
- If all three attempts fail, the collection is cancelled and enters a 30-day cooldown.
- The three-attempt rule applies only to a collection's first auction, not to normal user artworks.
- After the first settlement, remaining items become available through buy-now mint at the collection floor.

## 9. Marketplace Enforcement

- NFT approvals are restricted to whitelisted marketplaces.
- Wallet-to-wallet movement is a non-sale event.
- Resale economics apply only to marketplace sales.

## 10. Token Policy

ArtSoul is token-free.

- No token.
- No points.
- No airdrop logic.
- No passive-income promise.
- No token reward accounting in code or docs.

Any future token decision requires a new explicit canon amendment and is out of scope for the current product.

## 11. Moderation And Copyright

Moderation is complaint-driven and reviewable:

- Report button on artwork surfaces.
- Notice-and-takedown flow.
- Valid copyright claim can auto-hide content pending review.
- Review queue, notifications, and audit log.
- Critical or irreversible actions are gated by multisig.
- Social logins alone are not sufficient for critical moderator actions.

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
- Classic is static.
- Future can use motion and glow.
- Mobile and desktop may differ in layout only, not color semantics.

## 14. Treasury Rules

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

## 15. Public Beta And Mainnet

Public beta may use testnet infrastructure and local or hosted indexers. Mainnet requires persistent indexer operations, monitored infrastructure, RLS-secured data access, and completed legal/founder tasks.

Follow `17_ROADMAP_PHASES.md` and `12_IMPLEMENTATION_BACKLOG.md` in order.

## 16. Pre-Mainnet Migration And Data Reset

*New section — Amended 2026-07-13 by founder decision.*

When the reworked contracts are deployed and testnet validation is complete, a **full migration is performed once, before public launch** (start of Phase D). It is mandatory:

1. Freeze and export **Snapshot A** before any destructive reset. The export must be versioned, reproducible, machine-readable, and durable; include the source cut-off, participating addresses, qualifying public events with timestamps, aggregate counts, and a cryptographic manifest/hash; and be verified from at least two independent durable storage locations. Snapshot A is a community record only and creates no Genesis, token, points, airdrop, or other entitlement.
2. Prove that the Snapshot A export can be read and independently validated after the application database is reset. Record the verification result and export schema in the migration runbook.
3. Purge all legacy testnet product data from the live database — artworks, auctions, bids, signals, and derived profile stats — so no stale records remain. The separately preserved Snapshot A export is not re-imported as live product state.
4. Remove all old contract addresses from config and UI.
5. Storage: legacy testnet media is removed or archived; freed names may be reused (the same artwork titles can be created fresh on the new contracts).
6. The indexer resets to the new contracts from their deploy block; no legacy chain is indexed for writes (Ethereum Sepolia stays fully retired).
7. Verification pass: no leftover connections, endpoints, env vars, or UI references to old contracts or networks remain.
8. Exercise a full publish → auction → settle → mint → resale cycle on the fresh deployment.
9. Only after all of the above does the public/marketing phase proceed.

This is the mandatory pre-mainnet migration checklist. It runs after the reworked contracts pass a fresh public-testnet cycle and before any mainnet marketing.

## 17. Phase Status And Canonical Phase Model

*Aligned 2026-07-16 by founder decision.* The canonical roadmap has four phases:

- **Phase A: Stabilize Public Testnet** (active).
- **Phase B: Public Beta**.
- **Phase C: Mainnet Preparation**.
- **Phase D: Staged Mainnet Launch**.

`17_ROADMAP_PHASES.md` and `12_IMPLEMENTATION_BACKLOG.md` expand this model but remain subordinate to this Bible. They may schedule work; they may not create economics, contract mechanics, Genesis grant cadence, treasury triggers, legal-entity decisions, or product scope that the Bible has not approved.

Earlier informal A–G plans are retired. Their stabilization and testnet work maps to Phase A; beta and cohort work maps to Phase B; contract rework, Genesis, Collections, security review, legal readiness, and final visual work map to Phase C; deployment and staged activation map to Phase D. Historical token or multichain phases have no current mapping and remain out of scope.
