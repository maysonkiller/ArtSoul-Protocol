# Provenance And UI Canon

## Required Roles

Every full NFT detail surface must show:

- Creator
- First Collector
- Owner, only when the current owner differs from the First Collector

Use "First Collector" as the label. Do not use "winner" or "auctioner" in provenance UI.

## Data Source

Role data comes from V4.1 indexer projections:

- Creator: artwork registration.
- First Collector: successful settlement winner.
- Owner: settlement winner unless a later resale or transfer projection changes ownership.

Do not use legacy Supabase artwork ownership as protocol truth.

## Preview Cards

Gallery, homepage, and profile preview cards remain creator-focused. They may show creator identity, status, price/floor, media, and signals, but do not need to show the full role stack.

## Detail Pages

Artwork detail pages must show:

- Contained media, OpenSea-style, not full-bleed.
- Full timeline from indexer data.
- Creator, First Collector, and Owner role cards as profile links.
- No duplicate Owner row when Owner equals First Collector.

## Collection First Collector Badge

"First Collector of the Collection" is rendered by the frontend from collection state. It is not a stored badge image. The contract stores the first collector address; metadata may optionally include it as a trait.
