# Future contract extensibility direction — 2026-10-26

Status: **approved research direction; proposed architecture; no activation**.

The founder requests that the replacement contracts account for current resale
limitations, support carefully bounded future modules, complete collections and
auctions, and evaluate purchases funded from other networks/tokens while the NFT
remains on its home chain. This records that direction without approving unspecified
economic parameters, upgrade powers or deployment targets.

## Previous rule and precise qualification

- Bible §1 and root rule 13 limit the active product to Base / Base Sepolia.
  The September 20 Collection Launch amendment already permits its separately
  bounded development path. The new direction additionally permits C1 research
  into future cross-chain payment and contract interfaces. It does **not** enable
  multichain 1/1 writes, bridge NFTs, or approve mainnet deployment.
- Bible §§2–4, 8–9 and 14 remain the lifecycle, economics, floor, collection,
  royalty/marketplace and treasury baseline. New currencies cannot silently
  translate ETH amounts or introduce fees. Exact architectural departures need
  their own approved specification before implementation.
- Bible §17 and canonical C1 still require architecture/threat/storage sign-off
  before replacement Solidity. Planning can proceed alongside Phase B; this
  does not mark the public beta or Phase C complete.
- The July 13 `CONTRACT_REWORK_PLAN.md` recommendation of UUPS Core and a fixed
  four-contract topology was not an approved invariant. Its updated comparison
  recommends versioned immutable engines/templates as the starting baseline,
  with proxy components considered only for a demonstrated need. Final choice
  remains pending.

## Concrete design record

The maintained [Contract Rework Plan](CONTRACT_REWORK_PLAN.md) now maps existing
code to the canon, separates current facts from local scaffolds and proposals,
defines module/custody boundaries, records the reproduced ownership-round-trip
listing gap, and specifies payment failure/recovery and acceptance requirements.
It also corrects outdated claims that collections are absent or that current
pull credits guarantee refunds without bidder gas.

No deployed source, storage, authorities, funds, data, addresses or feature flags
change. Local characterization proves the prototype listing issue, not its repair.
Collection/Forge end-to-end activation, final economic settings, direct stablecoin
auctions, new payment routes, offers and agent signing are not accepted here.

## Reversibility and remaining approval

Previous planning text is recoverable from repository revision `b4ca252`.
Reverting this documentation restores that proposal, not any chain state.
The newly observed prototype limitation remains evidence even if the recommended
architecture changes. Preserve it in future regression requirements.

Before C1 sign-off: select actual contract boundaries, upgrade/mint powers,
governance and emergency policy, pause/deadline/withdrawal semantics, collection
terms and supported payment/refund routes. Exact implementation, independent
review and a fresh testnet rehearsal remain separate gates. Snapshot A and its
two verified durable copies remain mandatory before destructive reset (§16).
