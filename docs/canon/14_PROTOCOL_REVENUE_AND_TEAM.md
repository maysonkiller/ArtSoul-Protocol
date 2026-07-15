# Protocol Revenue, Treasury, And Team Canon

## Primary Sale

- 97.5% creator.
- 2.5% ProtocolTreasury.

## Resale

- 92.5% seller.
- 5.5% creator royalty.
- 1% ProtocolTreasury.
- 1% Ecosystem Pool.

## Defaulted Settlement

If the winning bidder misses settlement, the 10% deposit is split:

- 80% creator.
- 20% protocol.

## Treasury Separation

ProtocolTreasury and EcosystemTreasury are on-chain protocol treasuries. They are separate from company operating capital, bank funds, grants, and investments.

Ecosystem Pool usage *(Amended 2026-07-13 by founder decision)*:

- Emerging-artist grants.
- Community growth.
- Community reward/contest loop: the 1% accrues from sales and resales and funds contests once Genesis distribution matures — fees → pool → contests → activity → fees. No token is involved.

> **Superseded (kept for history):** "Future token liquidity reserve only if a future token is formally approved" is removed as an Ecosystem Pool use — it contradicts the token-free canon. A token remains a possible future phase only and is not referenced in pool mechanics.

Not allowed:

- Team salaries.
- Investor distributions.
- Passive income.
- Any token or airdrop accounting.

## Deployed Contract Deviation (prototype, to fix in the rework)

The deployed Base Sepolia testnet contracts currently implement resale as 90% seller / 7.5% creator / 2.5% protocol with **no** Ecosystem Pool split, and the NFT stores a 7.5% royalty. This is a known prototype deviation from the frozen 92.5 / 5.5 / 1 / 1 split and 5.5% creator royalty. It is corrected in the mainnet contract rework, not by mutating the live testnet. See `CONTRACT_REWORK_PLAN.md`.

## Founder And Business Work

Company operations, fundraising, legal setup, and CEO responsibilities belong to the founder side of the roadmap. Agents may surface blockers but must not invent legal or fundraising mechanics.
