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

The November 25 candidates permitted all twelve unlisted grants. The release check exited with status 1 and listed all three affected contracts.

A passing run requires a policy-specific rejection on each unlisted grant, successful direct transfers and the owner-authorized forge result. The check verifies the exact operator in the `MarketplaceNotAllowed(address)` error.

Before enabling collection sales on a secondary venue, record the reviewed collection admission authority and operator, wallet consent and revocation behavior, and how the venue pays all required parties. ERC-2981 reports a royalty quote. Its response alone cannot verify proceeds. The [ordinary NFT admission decision](CONTRACT_REWORK_PLAN.md#external-marketplace-admission) and a local fixture hash do not establish a collection's deployed authority or the suitability of a venue.

### November 27 — Shared marketplace admissions

New testnet candidates use a single on-chain operator registry for all authors. Editions and first-work constructors require the reviewed Core address. Forged outputs read that address from their ingredient collection at construction. This changes the constructor ABI and storage layout of these local collection candidates. Release requires a fresh deployment. The Base Sepolia first-work receipt check reads the immutable registry at the same finalized block through both providers and compares it with the reviewed rehearsal Core.

On the disposable chain the release check runs the actual payout Core with local Safe stand-ins. For each template it checks separate per-token and collection-wide consent, immediate disabling, a second 48-hour admission and fresh owner approval before an operator transfer. Direct owner transfers and metadata reads remain available. The registry's built-in approval for its own ordinary market does not authorize it on collection NFTs.

An optional forge uses the owner's revocable burn permission for up to 32 named ingredients per call. Every transfer clears that token's burn permission, including a transfer to the same wallet. The locked recipe and ingredient ownership are checked again during crafting. The forge receives no right to transfer the inputs.

The public testnet launch still needs a reviewed collection deployment, paid opening, first mint and hosted provenance. Mainnet requires a separately reviewed registry and deployment. Admission of a specific external venue requires its transfer operator, order and payout review. [ERC-721 owner approvals](https://eips.ethereum.org/EIPS/eip-721) · [Seaport models](https://docs.opensea.io/docs/seaport-models)

### November 27 — Verifying the auction terms an author published

For a valid Base Sepolia first-work or editions draft, open **Review → Download testnet phase calls**. This export supports a public auction followed by a public mint linked to that auction and no forge. It contains the two ordered `addPhase` calls and `lockConfiguration`, with UTC seconds and exact integer wei. The download has no recipient address or signer. The creator, treasury, marketplace registry, deployed template and metadata must be reviewed separately. A contract can lock these original terms only before the opening start time.

After a Base Sepolia lock, set `ARTSOUL_COLLECTION_RPC_URL` and `ARTSOUL_COLLECTION_RPC_CHECK_URL` to independent HTTPS providers. Use the original builder draft, the reviewed deployment's contract address and initialized runtime Keccak-256, and the lock transaction:

```sh
node scripts/check-collection-phase-lock.mjs draft.json COLLECTION_ADDRESS RUNTIME_KECCAK256 LOCK_TX
```

The read-only checker reconstructs the contract's commitment to the chain, collection address, both phase configurations and the empty forge. It compares the event, transaction position, runtime and finalized block on both providers. A legitimate opening retry or delayed close may move a live schedule after the original lock. The check uses the original event so the author can still prove the agreed launch terms. Separate settlement and issuance receipts establish the sale and token.

On an isolated EVM both collection formats accepted the browser export, finalized a paid auction and minted to the winner's nominated recipient. The candidate now preserves the paying auction winner as First Collector for gifted editions as well as opening works. The recipient is the first owner. This changes fresh collection bytecode without changing storage layout. A public Base Sepolia deployment, lock, settlement and issuance remain to be verified.

The production build served the builder locally in Chromium at 390px and 1280px. Both runs imported a first-work draft, downloaded the expected reserve and allocations from Review, and recorded zero write requests, page exceptions or horizontal overflow. Reproduce the configuration and receipt tests with `node --test test/collection-phase-lock.test.mjs test/collection-metadata-preflight.test.mjs test/collection-capabilities.test.mjs`. Run the two compiled launch suites with `npx hardhat --config hardhat.local.config.cjs --network hardhat test test/CollectionLaunch.test.cjs test/launch/PartnerFirstWorkLaunch.test.cjs`.
