# Collection Launch development amendment — 2026-09-20

Authority: founder's takeover brief supplied on 2026-09-19 and continued on
2026-09-20. Source SHA-256:
`6EF13FA99406CFBE58D18368E781AFC2516CEC5C72E84EBF4632C517D94AB5CD`.
This records explicit authorization; it is not mainnet or sale-opening approval.

## Approved development scope

- Bible §1 and root agent rule 13: Base remains the existing 1/1 protocol.
  A separate, reusable Collection Launch path may support multiple chains, with
  Robinhood Chain **testnet** as its first new target. Existing Base records,
  ownership, contracts, wallet behavior and active network defaults stay intact.
- Bible §§2, 4 and 8 and root rules 4/8: generic collections may use explicit
  free/allowlist, fixed-price and uniform-price auction phases, and atomic
  burn/craft mechanics. They do not replace the existing 1/1 lazy-mint lifecycle
  or the existing partner-collection first-auction model. Collection mint prices
  must not be presented as a guaranteed resale floor.
- Bible §9: new collections may declare ERC-2981 creator earnings and voluntary
  support separately. ERC-2981 is advisory on external marketplaces. No claim of
  universal royalty enforcement is permitted. Existing ArtSoul marketplace fees
  and treasury separation remain unchanged. New support destinations require
  actual configured receivers, never invented addresses.
- Bible §12: collection AI reviews explain structured launch configuration and
  disclosed utility. Deterministic validation is labelled as validation, not an
  AI result. Neither can influence settlement, price, ranking or verification.
- Bible §17 and root rule 14: the founder authorizes this takeover audit and
  reversible implementation/rehearsal alongside the current Phase A work. Work
  is recorded as separate, ordered intake items. This does not close Phase A,
  waive independent review or authorize production migration.

## Proposals that are not final protocol rules

- Origin's 3,000 supply, 500/500/500/1,500 allocation and Auction B-linked public
  price are a draft template. Reserve prices, dates, receivers, under-subscription
  fallback, unclaimed allocation behavior and final launch economics require
  an explicit reviewed configuration before sale opening.
- Ten Origin inputs producing one separate Forged NFT is authorized for a local
  and testnet rehearsal. Burns must be atomic, owner-authorized, duplicate-safe,
  and permanently attributable through events.
- Genesis 1,101 supply and 300 Forged-linked claim positions remain proposals.
  Bible §7's live eligibility is not silently replaced. Tests may exercise a
  clearly labelled eligibility harness, never issue real Genesis or imply that
  testnet participation earns it. The remaining distribution is undecided.
- No mainnet deployment, final Origin sale, destructive reset, external account
  change, final supply lock or permanent economic change is authorized here.

## Interpretation register

1. Explicit implementation instructions authorize local code and test fixtures;
   numbers called "proposed" do not authorize irreversible launch settings.
2. Unsupported/offchain eligibility is represented honestly and blocks an
   onchain publish until a reviewed proof path exists; it cannot become a fake
   verified badge or successful claim.
3. Existing prototype deviations remain documented deviations. Verified contract
   behavior is the description of today's testnet, not an automatic amendment
   making it mainnet-ready.

These interpretations and all remaining decisions are carried into the takeover
evidence report. No new token, points or volume-based entitlement is introduced.

## Marketplace operator release check

From the repository root with the locked dependencies installed, run:

```sh
node scripts/check-collection-operator-policy.cjs
```

The command compiles the current collection contracts and creates disposable editions, first-work and forged tokens on Hardhat chain 31337. The report includes each fixture's runtime hash. For each token it simulates an owner's single-token and collection-wide approval for an unlisted wallet and an unlisted contract. It also transfers each token directly as its owner and checks the recipient. For the optional forge recipe, it attempts crafting with zero, one and two individual ingredient approvals. Only the fully authorized pair may burn and produce an output. No collection-wide grant is needed for that recipe.

The November 25 candidates permitted all twelve unlisted grants. The command exits with status 1 and lists all three affected contracts. Keep collection marketplace release blocked. The ordinary NFT contract and the metadata and primary-launch checks have their own acceptance paths.

A passing run requires a policy-specific rejection on each unlisted grant, successful direct transfers and the owner-authorized forge result. Unrelated reverts and incomplete runs are inconclusive and exit nonzero. The check currently recognizes the ordinary NFT's `MarketplaceNotAllowed(address)` error with the attempted operator. Update that decoder and the characterization test when a reviewed collection policy implements a different denial or a dedicated burn authorization.

Before enabling collection sales on a secondary venue, record the reviewed collection admission authority and operator, wallet consent and revocation behavior, and how the venue pays all required parties. ERC-2981 reports a royalty quote. Its response alone cannot verify proceeds. The [ordinary NFT admission decision](CONTRACT_REWORK_PLAN.md#external-marketplace-admission) and a local fixture hash do not establish a collection's deployed authority or the suitability of a venue.
