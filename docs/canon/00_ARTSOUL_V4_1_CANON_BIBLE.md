# ArtSoul Canon Bible Overview

This file is the compact overview of the ArtSoul public canon. The full version is `ARTSOUL_CANON_BIBLE_FULL.md`.

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

## Public Security Boundaries

Hidden anti-sybil implementation details are not stored in this repository. Public docs may state that anti-sybil checks exist, but must not publish private scoring logic, abuse heuristics, manual review thresholds, or operational bypass rules.
