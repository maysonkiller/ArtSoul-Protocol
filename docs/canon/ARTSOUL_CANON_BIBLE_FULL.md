# ArtSoul Canon Bible

ArtSoul is an auction-first NFT art protocol on Base. Artists publish work, the community discovers and signals interest, a primary auction establishes the first collector and canonical floor, settlement lazily mints the NFT, and later resale preserves creator royalties and public provenance.

The internal codename is V4.1. Do not expose the version label in user-facing UI, investor materials, or public marketing copy.

## 1. Protocol Truth

- Contracts and transaction receipts are protocol truth.
- The public product reads indexed projections from `/api/public/artworks`.
- Local pending state is only a temporary bridge after a confirmed transaction while the indexer catches up.
- Legacy Supabase artwork rows are compatibility/history only and must not become public canonical truth.
- The canonical chain is Base. Testnets may use Base Sepolia and Ethereum Sepolia during development, but mainnet scope is single-chain Base.

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

Expired auctions that received NO bids should auto-finalize on-chain - the protocol should NOT require a separate manual "End Expired Auction" transaction before the work can be re-auctioned. After an auction's time expires with no bids, the work should automatically return to a re-auctionable state. (The current testnet contract requires a manual finalize step; this is to be removed in the next contract version.)

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
- Genesis: 2x
- 100+ settlements: 3x
- Partner: 5x

Use the highest applicable weight, capped at 5x.

Hidden anti-sybil implementation details, private scoring, operational review rules, and abuse heuristics are intentionally excluded from this public repository.

## 7. Genesis And Top-100k

- Genesis supply: 10,000.
- #0000 is founder reserved.
- #0001 through #9999 are public.
- Genesis is soulbound and mainnet-only.
- Genesis is a real art NFT with image and animation metadata.
- Public eligibility uses the approved Discord role and public activity path.
- Private anti-sybil implementation details stay outside this repository.
- Top-100k is a separate soulbound numbered profile badge, not a transferable NFT and not an artwork aura.

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
- Ecosystem Pool funds emerging-artist grants, community growth, and future token liquidity reserve if ever approved.
- Ecosystem Pool is never used for team salaries, investor distributions, or passive income.

## 15. Public Beta And Mainnet

Public beta may use testnet infrastructure and local or hosted indexers. Mainnet requires persistent indexer operations, monitored infrastructure, RLS-secured data access, and completed legal/founder tasks.

Follow `17_ROADMAP_PHASES.md` and `12_IMPLEMENTATION_BACKLOG.md` in order.
