# Roadmap Phases

This roadmap expands the four-phase model in `ARTSOUL_CANON_BIBLE_FULL.md` §17. The Bible is the single source of protocol truth. This document schedules work; it does not create economics, contract mechanics, grant cadence, treasury triggers, legal decisions, or product scope.

## Canonical Phase Mapping

The active canonical model is A–D:

| Canon phase | Purpose | Historical work absorbed |
| --- | --- | --- |
| A — Stabilize Public Testnet | Close production-testnet blockers | Repository/security cleanup, wallet stabilization, diagnostics cleanup, testnet/indexer verification, moderation MVP, Base commitments |
| B — Public Beta | Validate with real users | Tester onboarding, monitoring, defect correction, durable Snapshot A, build-in-public |
| C — Mainnet Preparation | Build and audit the final system | Contract rework, Genesis, Collections, pool, admin controls, auras, legal/domain/treasury readiness, fresh Base Sepolia rehearsal |
| D — Staged Mainnet Launch | Migrate and activate safely | Snapshot verification, data reset, Base deployment, Core stability window, separate Genesis pilot, controlled growth |

Earlier informal A–G plans are retired and are not parallel authority. Token or multichain phases from historical planning have no A–D destination and remain out of scope. Any old stabilization/testnet item belongs to A; beta/growth validation belongs to B; contract, security, Genesis, Collections, legal, and final visual work belongs to C; migration/deployment/activation belongs to D.

## Phase A — Stabilize Public Testnet (active)

Goal: a production testnet trustworthy enough for a controlled beta.

Close security and RLS verification, CI, indexer drift, projection/provenance, profile gating, complaint-driven moderation, infrastructure alerts, and controlled-beta entry. Preserve the completed mobile-wallet and production-debug cleanup work.

Deliver the Base product commitments before beta: collector demand before minting, a simple three-step explanation, and cached public on-chain metrics. Remove stale Ethereum Sepolia and unspecified-network copy from active product marketing.

Exit: all Phase A backlog items accepted, no P1 open, green local/CI baselines, monitored infrastructure, and frozen economics unchanged.

## Phase B — Public Beta

Goal: validate the complete user journey on testnet with a controlled real cohort.

Run publish → auction → settlement → mint → resale journeys; operate monitoring and incident response; process moderation cases and beta defects; report progress through verified cached metrics; and capture Snapshot A at the announced cut-off as a durable, reproducible export.

Snapshot A is a community record only. It survives later database reset through versioned machine-readable data, a cryptographic manifest, independent durable copies, and a documented verification procedure. It creates no Genesis, token, points, airdrop, or other entitlement.

Exit: stable beta, feedback processed, moderation proven, Snapshot A verified, and Phase C inputs ready.

## Phase C — Mainnet Preparation

Goal: build, test, and audit the product-grade contract and operations topology.

Complete the Core, ArtworkNFT, ArtSoulGenesis, Partner Collections, Ecosystem Pool, indexer/database, admin/eligibility, aura/badge, and promoted-banner work defined in the backlog and `CONTRACT_REWORK_PLAN.md`. Rehearse the final topology on fresh Base Sepolia contracts and hand privileged roles to rehearsal Safes.

The following remain explicit planning inputs rather than frozen canon:

- Genesis numeric grant cadence is tunable operational policy.
- The trigger for pool-funded contests is undecided until approved through treasury and contract design review.
- Legal entity type and jurisdiction are founder/counsel decisions; no particular form is assumed.
- The exact production stability window before Genesis activation is a launch-readiness decision.

Genesis administration must use public eligibility categories, durable grant records, an audit log, and multisig-authorized controls. Losing-bidder refunds use deterministic obligations, bounded batch execution, and withdrawable-credit fallback; no unbounded loop or unmotivated bidder may be required to finalize an auction.

Exit: independent audit passed, fresh rehearsal green, treasuries/domain/legal ready, migration evidence verified, and launch approval recorded.

## Phase D — Staged Mainnet Launch

Goal: launch on Base without combining every risk into one event.

Re-verify Snapshot A, execute the Bible §16 reset, deploy the audited Core topology, transfer roles, and pass production smoke tests. Observe Core through the approved stability window. Run Genesis as a separate bounded pilot only after Core stability is demonstrated, then expand through the audited grant path.

Exit: stable Base mainnet operations, verified treasuries, monitored public metrics, and controlled Genesis rollout.

## Founder-Owned Inputs

- Safes and signer policy.
- Domain and project email.
- Counsel-approved entity, jurisdiction, ToS, Privacy/GDPR, and IP assignment.
- External audit procurement.
- Go/no-go and public-role decisions.

These are surfaced when their phase needs them. Roadmap placeholders do not decide them.

## Out Of Scope

- Any non-Base product chain.
- Token, points, airdrop, or passive-income mechanics.
- Fee waivers or fee discounts.
- Unapproved economic changes.
- Public disclosure of hidden anti-abuse scoring.

Frozen economics remain unchanged: primary `97.5 / 2.5`; resale `92.5 / 5.5 / 1 / 1`; all other deposit, bid, duration, and settlement values remain exactly as specified in Bible §3.
