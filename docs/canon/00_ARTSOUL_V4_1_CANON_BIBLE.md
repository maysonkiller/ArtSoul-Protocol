# ArtSoul Canon Bible Overview

This file is the compact overview of the ArtSoul public canon. The full version is `ARTSOUL_CANON_BIBLE_FULL.md`.

The [November 2 decision-authority clarification](CHANGELOG_2026-11-02_DECISION_AUTHORITY.md)
establishes that current founder instructions supersede obsolete documentation.
The canon is a maintained baseline, not a veto on authorized improvements.
Verify deployed behavior separately, use evidence-led current practices and
reconcile changed decisions without inventing economics or acceptance results.

The [October 26 extensibility direction](CHANGELOG_2026-10-26_CONTRACT_EXTENSIBILITY.md)
permits future contract/payment research alongside Phase B; it does not enable
new product networks or alter existing economics or deployment authority.

## Product

ArtSoul is a Base NFT art protocol built around discovery, primary auctions, lazy minting, settlement, provenance, and resale.

The public UI must describe the product as ArtSoul, not by the internal V4.1 codename.

## Canonical Sources

- Contracts and receipts define protocol truth.
- The V4.1 indexer projects that truth into public read APIs.
- `/api/public/artworks` is the canonical public artwork source.
- Local pending state is temporary and clearly marked.
- Legacy Supabase rows are not public canonical truth.

## Frozen Economics

- Primary: 97.5% creator, 2.5% protocol.
- Resale: 92.5% seller, 5.5% creator royalty, 1% protocol, 1% Ecosystem Pool.
- Default deposit split: 80% creator, 20% protocol.
- Deposit: 0.01 ETH.
- Bid increment: max(+0.01 ETH, +2.5%).
- Durations: 24h, 36h, 48h.
- Settlement: 24h.

## Lifecycle

Publish media and metadata, register artwork, create auction, bid, settle, lazy-mint, show provenance, support marketplace resale.

No NFT exists before successful settlement.

For the new native ordinary-work pair, anyone can close an expired auction, which opens the winner's full 24-hour payment window. An expired round without bids returns to Discovery without a wallet action. Relisting closes the old round in the same transaction. A ready winner can close and pay in one transaction. Entry can pause while settlement, default and exits remain available. [Exact timing and scope](ARTSOUL_CANON_BIBLE_FULL.md#2-artwork-lifecycle)

Recording a winning bidder's default opens a single voluntary 24-hour offer to the second-highest distinct bidder at their own bid. All losing deposits remain fully refundable. Decline or expiry releases the work for relisting. A paid offer mints to its actual buyer at the actual sale price.

The local replacement candidate exercises the full path from primary settlement through resale and withdrawal. It enforces the canonical four resale shares and invalidates an advertised sale when ownership changes or the seller cancels, replaces the listing or revokes Core approval. The deployed Base Sepolia prototype retains its existing behavior. [Resale evidence and remaining policies](../architecture/C1_REPLACEMENT_BOUNDARIES_2026-11-16.md#selected-entry-pause-and-payment-window)

### Future Contract Requirement: Automatic No-Bid Finalization

> **FUTURE / MAINNET REDEPLOY ONLY - NOT CURRENT TESTNET BEHAVIOR**

Expired auctions that received NO bids should auto-finalize on-chain - the protocol should NOT require a separate manual "End Expired Auction" transaction before the work can be re-auctioned. After an auction's time expires with no bids, the work should automatically return to a re-auctionable state. (The current testnet contract requires a manual finalize step; this is to be removed in the next contract version.)

## Public Security Boundaries

Hidden anti-sybil implementation details are not stored in this repository. Public docs may state that anti-sybil checks exist, but must not publish private scoring logic, abuse heuristics, manual review thresholds, or operational bypass rules.
