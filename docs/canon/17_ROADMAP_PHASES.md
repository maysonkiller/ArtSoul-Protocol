# Roadmap Phases

This roadmap tracks the four-phase model in `ARTSOUL_CANON_BIBLE_FULL.md` §17. Apply the [November 2 decision-authority clarification](CHANGELOG_2026-11-02_DECISION_AUTHORITY.md): current founder decisions supersede outdated scheduling and scope descriptions. Authorized independent preparation may run alongside unresolved gates, whose status stays explicit. A schedule does not itself approve financial parameters, custody or critical authority, or establish deployed behavior or release acceptance.

## Canonical Phase Mapping

The active canonical model is A–D:

| Canon phase | Purpose | Historical work absorbed |
| --- | --- | --- |
| A — Stabilize Public Testnet | Close production-testnet blockers | Repository/security cleanup, wallet stabilization, diagnostics cleanup, testnet/indexer verification, moderation MVP, Base commitments |
| B — Public Beta | Validate with real users | Tester onboarding, monitoring, defect correction, snapshot tooling readiness, build-in-public |
| C — Mainnet Preparation | Build and audit the final system | Contract rework, Genesis, Collections, pool, admin controls, auras, legal/domain/treasury readiness, fresh Base Sepolia rehearsal |
| D — Staged Mainnet Launch | Migrate and activate safely | Recovery verification before destructive changes, clean mainnet catalog, Base deployment, Core stability window, separate Genesis pilot, controlled growth |

Earlier informal A–G plans are historical, not parallel active roadmaps. Token mechanics remain unapproved. The founder-authorized future contract and cross-chain payment research belongs to C, may proceed alongside B, and does not activate new networks. Stabilization/testnet items belong to A; beta/growth validation to B; contract, security, Genesis, Collections, legal, and final visual work to C; migration/deployment/activation to D. Current founder priorities may revise this scheduling.

## Phase A — Stabilize Public Testnet (accepted October 24, 2026)

Goal: a production testnet trustworthy enough for a controlled beta.

Close security and RLS verification, CI, indexer drift, projection/provenance, profile gating, complaint-driven moderation, infrastructure alerts, and controlled-beta entry. Preserve the completed mobile-wallet and production-debug cleanup work.

Deliver the Base product commitments before beta: collector demand before minting, a simple three-step explanation, and cached public on-chain metrics. Remove stale Ethereum Sepolia and unspecified-network copy from active product marketing.

Exit: all Phase A backlog items accepted, no P1 open, green local/CI baselines, monitored infrastructure, and frozen economics unchanged.

## Phase B — Public Beta

On November 18 the founder closed the active B engineering workstream.
Controlled owner journeys and snapshot-tooling checks are recorded in the
[closeout](../PHASE_B_STATUS_2026-11-02.md). Public cohort validation moves
to the final-contract testnet in C13. Optional voice and WebMCP acceptance
will resume on a separate schedule.

Goal: validate the complete user journey on testnet with a controlled real cohort.

Run publish → auction → settlement → mint → resale journeys; operate monitoring and incident response; process moderation cases and beta defects; report progress through verified cached metrics; and keep snapshot tooling ready.

The historical archive format remains readable. Testnet participation creates no mainnet entitlements.

Public-beta acceptance requires a stable cohort, processed feedback, moderation evidence, snapshot tooling and Phase C inputs. The cohort and its feedback remain outstanding.

## Phase C — Mainnet Preparation

Local engineering is active. The launch and deployment gates remain in force.

Goal: build, test, and audit the product-grade contract and operations topology.

The September 29 deferral of founder passkey setup was superseded by
`CHANGELOG_2026-10-03_PHASE_A_ACTIVATION.md` and canon 07's October 8 paired-wallet
setup/recovery amendment. Real owner setup, replacement and entry are accepted
in Phase A; contract custody remains separate. See the October 11 moderation
acceptance record. Isolated checks never count as native enrollment or phone
acceptance. This status correction does not introduce a new recovery policy.

Complete the Core, ArtworkNFT, ArtSoulGenesis, Partner Collections, Ecosystem Pool, indexer/database, admin/eligibility, and aura/badge work defined in the backlog and `CONTRACT_REWORK_PLAN.md`. [Bible §6.1](ARTSOUL_CANON_BIBLE_FULL.md#61-promoted-homepage-banners) records the per-auction banner reserve and shared promotional capacity. The offline schedule check is available. Live acceptance still requires protected publication, settlement and labeled delivery. Rehearse the final topology on fresh Base Sepolia contracts and hand privileged roles to rehearsal Safes.

The following remain explicit planning inputs rather than frozen canon:

- Genesis numeric grant cadence is tunable operational policy.
- The trigger for pool-funded contests is undecided until approved through treasury and contract design review.
- Legal entity type and jurisdiction are founder/counsel decisions; no particular form is assumed.
- The exact production stability window before Genesis activation is a launch-readiness decision.

Genesis administration must use public eligibility categories, durable grant records, an audit log, and multisig-authorized controls. Losing-bidder refunds use deterministic obligations, bounded batch execution, and withdrawable-credit fallback; no unbounded loop or unmotivated bidder may be required to finalize an auction.

The November 25 decision retired the public-testnet archive and its two-week announcement. Keep testnet records and backups.

Phase C exit requires reviewed internal security evidence, a fresh successful Base Sepolia rehearsal, verified treasury and authority roles, and founder review.

## Phase D — Staged Mainnet Launch

Goal: launch on Base without combining every risk into one event.

Prepare a clean mainnet catalog under Bible §16, verify the recovery procedure before any destructive change, deploy the reviewed Core topology, transfer roles, and pass production smoke tests. Observe Core through the approved stability window. Run Genesis as a separate bounded pilot only after Core stability is demonstrated, then expand through the audited grant path.

Phase D exit requires stable Base mainnet operations, verified treasury activity, controlled Genesis rollout, monitored public metrics and an independent full audit with disposition of its findings.

## Delivery sequence for the first Base release (November 19, 2026)

The public marketplace uses the earlier Base Sepolia deployment. A walkthrough can show publication, bidding, a settled NFT with its creator, First Collector and owner, and resale using the [recorded journeys](../PHASE_B_STATUS_2026-11-02.md). Identify the network and test ETH throughout. On November 25 the replacement Core and NFT were also live on Base Sepolia. Two RPC providers verified one registered artwork, zero auctions and zero minted tokens on that pair at finalized block 63,573,369. The website and its indexer still selected the earlier Core. Use the [rehearsal register](../testnet/ORDINARY_MARKET_REHEARSAL_2026-11-25.md) to distinguish the deployments when demonstrating either one.

For a short demo that requires no wallet signature:

1. Open the [gallery](https://artsoulprotocol.com/gallery) and select a registered work still awaiting its first sale. Show the bidding terms and where a collector can see the network.
2. Open [Taes](https://artsoulprotocol.com/artwork/38). Trace its first successful settlement to the mint of token 7, then distinguish the artist, the First Collector and the current owner. [Base Sepolia settlement receipt](https://sepolia.basescan.org/tx/0x9276c36e2d3df54fa13b6c3e8efdadda2b6c38b5c368027dd2dee9d6125d457f).
3. Open [Music 2](https://artsoulprotocol.com/artwork/32). Find token 5's secondary sale at 0.0001 test ETH in its history and compare it with the confirmed transfer. Ask the viewer how they would tell who owns the work now. [Base Sepolia resale receipt](https://sepolia.basescan.org/tx/0x86ae0bd17970acdd3dfda92ced13896e4a69099853435ce72604dd676ce5aab5).

### What needs an address

| Scope | Addresses and implementation | Release dependency |
| --- | --- | --- |
| Ordinary artworks, primary auctions and resale | Two new application contracts. The engine creates its permanently paired [NFT](../../contracts/replacement/OrdinaryArtAuctions.sol) in its constructor. It also owns the shared ETH ledger, including the ecosystem resale allocation. | Release and verify the exact pair together. [Safe binding](../../contracts/replacement/TreasuryBoundOrdinaryArt.sol) currently supplies abstract policy hooks. Only reviewed production policy and bytecode qualify for deployment. |
| Custody and emergency pause | The release assigns distinct Safes for protocol fees, ecosystem allocations and administration of the entry pause and external marketplace admission. | Select and verify fresh Base mainnet wallets before binding the three roles. Keep rehearsal wallets and the gas-only keeper separate. [Custody register](../RESOURCE_GATED_WORK.md#checking-the-three-contract-custody-roles) |
| Voluntary creator support | At first mainnet launch, supporters copy the original creator’s address and send ETH from their own wallet on Base. This requires no additional deployment. | Preserve the Base Sepolia donation history. Revisit artwork-linked support if users need public attribution or messages. A later activation requires its own review and rehearsal. [Support decision and gas measurements](SUPPORT_THE_ARTIST_DESIGN.md) |
| Genesis | One dedicated soulbound contract for the bounded post-stability pilot. The transferable testnet ProjectNFT is retired at migration. | C4 grant controls, public eligibility categories and an audited register precede D5 activation. |
| Partner Collections | C5 needs a reviewed template with the single first auction, attempt and cooldown rules, and flat remaining mint price. Factory and per-collection address counts follow the selected design. | Rehearse its first successful and failed auction paths before opening a collection. Generic [Launch](../../contracts/launch/CollectionLaunch.sol) and [Forge](../../contracts/launch/CollectionForge.sol) are separate local scaffolds with their own product and audit decisions. |

The ordinary market therefore involves **two new application addresses and three existing Safe addresses**. Other modules extend that inventory as they qualify. This count describes the smallest ordinary-market deployment. Full Phase C acceptance still uses the backlog scope above. Record any founder-approved change to that scope before using a narrower release checklist.

### Order of work and evidence to advance

For external NFT display, the release check starts after the first successful mint. Read the token's `ownerOf` and `tokenURI` through a public RPC, fetch the JSON and image, and open the media referenced by `animation_url` for an audio or video work. Compare the artwork and owner in a Base-compatible wallet and on OpenSea when indexed. Record the network, issuing NFT address and token ID. A collector can use the same identity for manual import in wallets that support it. An unminted work remains discoverable on ArtSoul. External trading permissions require a separate operator policy. [ERC-721 metadata](https://eips.ethereum.org/EIPS/eip-721) · [OpenSea metadata](https://docs.opensea.io/docs/metadata-standards) · [MetaMask NFT display and import](https://support.metamask.io/manage-crypto/nfts/nft-tokens-in-your-metamask-wallet/)

On November 19, a Base Sepolia read of [Music 2, token 5](https://sepolia.basescan.org/token/0xf061f70503c37cf2196a28f4785e524d0fb32538?a=5) confirmed that its existing JSON supplies an audio URL but omits a still image. New audio and video publications carry a static ArtSoul cover for image-only clients. The original media remains in `animation_url`. ArtSoul still prefers the work's own poster or video frame on its site. Registration stops before requesting the wallet if the metadata upload fails. [Metadata builder](../../ipfs-client.js) · [Publication checks](../../test/upload-publication.test.mjs)

| Step | Accountable role | Evidence needed to advance |
| --- | --- | --- |
| 1. Prepare and demonstrate the testnet product | Product and support | Assemble the walkthrough above, give visitors a testnet entry point, record feedback by journey, and distinguish testnet volume from revenue. Keep the currently available voice helper. Broader voice and WebMCP parity stays on its separate track. |
| 2. Freeze the release candidate | Contract and application maintainers | Resolve remaining [policy decisions](../architecture/C1_REPLACEMENT_BOUNDARIES_2026-11-16.md), compile the concrete engine, and pin constructor inputs, build identity, paired NFT, and event ABI. Indexer and UI must distinguish deployments even when artwork IDs repeat. Evidence covers no-bid close, winner payment and default, runner-up expiry or purchase, refunds and credits, resale and provenance. |
| 3. Rehearse on fresh Base Sepolia and review the exact build | Release operator, internal security reviewer and cohort lead | Use rehearsal Safes and the exact candidate. Run C13 with artists and collectors, save receipts and support outcomes, and verify the page updates without a reload. Exercise [keeper restart and gas limits](../runbooks/ORDINARY_AUCTION_KEEPER.md), a manual close during an outage, pause, withdrawals, event replay and recovery. Record costs and alarms. Resolve C12 findings and rerun affected journeys on the final build. |
| 4. Complete the launch decision | Founder, finance and operations | Confirm independently recoverable signer custody, lawful operator and contracting authority for the actual service, terms and privacy, IP and complaint handling, audit and recurring operating budget, domain ownership and incident coverage. Keep company fundraising outside the [protocol and ecosystem treasuries](14_PROTOCOL_REVENUE_AND_TEAM.md). Preserve testnet data and verify recovery from operational backups before any destructive action. Record scope and go/no-go against C0–C15. |
| 5. Open ordinary trading on Base in stages | Release operator and authorized Safe signers | Publish chain, deployment blocks, addresses and verified source. Check the immutable pair, all three Safe bindings, indexer reconciliation and recovery access before enabling writes. Keep testnet history separately identified. Observe real settlements, withdrawals and service costs through the agreed Core stability window before Genesis grants or further public activation. |

The [public roadmap](https://artsoulprotocol.com/docs-protocol#roadmap) shares its content with Guide search and the table of contents. It directs visitors to the Base Sepolia gallery and the browser-based collection draft. The next milestones are the replacement-contract rehearsal, internal security review, staged Base mainnet opening, separate Genesis pilot and independent full audit before Phase D closes. Publish confirmed public deployment addresses as those milestones are reached.

## Founder-Owned Inputs

- Safes and signer policy.
- Domain and project email.
- Lawful basis to operate and collect fees, applicable terms, privacy, IP and accounting. Revisit company formation at first revenue or sooner if legally required.
- External audit procurement.
- Go/no-go and public-role decisions.

These are surfaced when their phase needs them. Roadmap placeholders do not decide them.

## Out Of Scope

- Activating additional write networks. [Future Robinhood and Arc work](../architecture/ROBINHOOD_AND_ARC_LAUNCH_READINESS.md) has separate acceptance criteria.
- Token, points, airdrop, or passive-income mechanics.
- Fee waivers or fee discounts.
- Unapproved economic changes.
- Public disclosure of hidden anti-abuse scoring.

Frozen economics remain unchanged: primary `97.5 / 2.5`; resale `92.5 / 5.5 / 1 / 1`; all other deposit, bid, duration, and settlement values remain exactly as specified in Bible §3.
