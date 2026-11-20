# Protocol Revenue, Treasury, And Team Canon

## Primary Sale

- 97.5% creator.
- 2.5% ProtocolTreasury.

### Paid mint reservations

In the first local reservation candidate the 2.5% primary rate applies to the gross amount a creator earns on each place. Combine the original clearing premium and the additional mint payment on redemption. On normal expiry count only the premium. Round once to the nearest wei and assign an exact half to the creator. On delivery failure, credit each payer their full payment and charge zero. The initial pilot allows one resale of the place and credits its gross price to the selling holder. Free allowlist membership remains free. [Settlement examples and release status](CONTRACT_REWORK_PLAN.md#auction-of-mint-reservations)

## Resale

- 92.5% seller.
- 5.5% creator royalty.
- 1% ProtocolTreasury.
- 1% Ecosystem Pool.

## Defaulted Settlement

If the winning bidder misses settlement, the posted deposit is split as follows.

- 80% creator.
- 20% protocol.

## Whole-wei payouts on the new ordinary market

The founder approved largest-remainder rounding on November 19, 2026. For a primary sale, resale or defaulted winner's deposit, first round each percentage share down to whole wei. Assign the remaining wei one at a time to the roles with the largest fractional remainders, with at most one extra wei per role. Break ties in the order printed above. The creator precedes the protocol on a primary sale or default. A resale uses seller, creator, ProtocolTreasury and EcosystemTreasury in that order, including when two roles have the same wallet.

For a primary sale of 10,020 wei, the two shares end in exactly half a wei. The creator receives 9,770 wei and the protocol receives 250. For a resale of 50 wei, the final credits are 46 to the seller, 3 to the creator, 1 to the protocol and 0 to the ecosystem. All payouts sum to the amount paid. This rule applies to settlement credits in the new Core. The ERC-2981 royalty quote remains a distinct read.

## Treasury Separation

ProtocolTreasury and EcosystemTreasury are on-chain protocol treasuries. They are separate from company operating capital, bank funds, grants, and investments.

Ecosystem Pool usage *(Amended 2026-07-13 by founder decision)*:

- Emerging-artist grants.
- Community growth.
- Community rewards and contests funded from the 1% resale allocation. Quarterly multisig decisions allocate the pool within its approved purposes. The trigger for the first pool-funded contest is still open.

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
