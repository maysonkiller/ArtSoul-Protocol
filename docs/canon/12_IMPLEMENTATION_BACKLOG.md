# Implementation Backlog

This backlog expands the canonical A–D phase model in `ARTSOUL_CANON_BIBLE_FULL.md` §17. The Bible is the single source of protocol truth. A roadmap or backlog item may schedule work, but it may not create or amend economics, contract mechanics, roles, Genesis grant cadence, treasury triggers, or legal decisions.

Work proceeds one contained task at a time. One backlog item normally equals one focused PR. Contract changes require focused tests and explicit storage-layout review.

## Phase A — Stabilize Public Testnet (active)

Goal: a production testnet trustworthy enough for a controlled beta.

- [ ] **A1 — Security and migration verification.** Verify public-repository secret hygiene, RLS, server-only credentials, deployment configuration, and the documented migration path. Rotate any credential that was ever genuinely exposed; do not rotate masked examples.
- [x] **A2 — Mobile wallet acceptance.** Complete real-phone external-browser, in-app-browser, desktop, navigation, reload, background, write-guard, and explicit-disconnect acceptance. Preserve Base Sepolia as the only operational write chain.
- [x] **A3 — Production diagnostics cleanup.** Remove the visual wallet debug overlay from production pages while retaining the isolated `wallet-test.html` bench.
- [x] **A4 — Green baseline and CI.** PR #109 established deterministic Ubuntu and Windows CI with reproducible install, build, static checks, Node tests, and 19 contract tests. The accepted suite has continued to grow without reopening the resolved historical Hardhat-runner failures; the 2026-07-17 A5 validation completed with 156 Node tests and 19 contract tests.
- [x] **A5 — Indexer status drift.** Completed 2026-07-18. PR #112 reconciled the deployed Base Sepolia confirmation depth from 12 to 3 on startup without resetting the persisted cursor. PR #114 added schema-aware reorg rollback migration 014 with regression and PostgreSQL 17 integration coverage. After a verified backup, migration 014 was applied to production, both legacy-table guards were verified, Hetzner was updated to merge commit `4a10841`, and PM2 resumed from the existing cursor. Production health remained `healthy` with confirmation depth 3, no confirmation-depth sync error, zero unresolved errors, advancing confirmed blocks, and no new missing-legacy-table or reorg-check failure in the observed post-restart cycles.
- [x] **A6 — Projection and provenance verification.** Verify indexed Creator, First Collector, Owner, auction, settlement, resale, moderation, and pending-projection states across every public surface. Completed by PR #120 (surface audit, projection-state fixtures, wallet-fallback fix), PR #122 (exact chain-scoped lookup, indexer-backed provenance timeline, moderation-safe endpoint), and PR #124 (creator-focused compact cards with public-nickname attribution, Owned creator-buyback filter). Per canon doc 05, compact preview cards stay creator-focused; full First Collector / Owner provenance and the timeline are verified on the artwork detail surface. The hidden-artwork unavailable-copy item moved to A8 moderation UX.
- [ ] **A7 — Profile lifecycle and action gating.** Verify that only the correct wallet and lifecycle state expose publish, auction, settlement, mint, resale, moderation, or admin actions. PR #126 merged the full action inventory, legacy-artwork write-action visibility, resale submit re-checks, self-purchase rejection, and dormant profile predicate chain guards with a 28-test role/lifecycle matrix (strict Base-only chain authorization and live submit-time accounts included). PR #127 is merged and its CI, production deployment, bundle, bounded confirmation, and no-resubmit regression are verified. Final acceptance still requires one real post-deploy wallet-signed publish proving exact-artwork redirect without duplicate `createAuction`.
- [ ] **A8 — Moderation and reporting MVP.** Complete the complaint-driven Report flow, notice-and-takedown form, valid-claim hide path, review queue, notifications, and auditable staff actions. The A8a access-security slice may be developed behind a disabled feature flag on the current origin: 15-minute passkey step-up, two founder passkeys, one one-time auditable bootstrap grant, and Safe-only founder recovery. Production activation waits for the final domain/RP ID and a rehearsed recovery path. X/Discord handles are not authentication factors. Do not build Content-ID or self-hosted fingerprinting.
- [ ] **A9 — Infrastructure cost and alerting.** Observe the deployed RPC diet for at least seven days, set Alchemy and Supabase usage alerts, resolve or explicitly waive the optional `failed_events` metric, and document health/restart checks.
- [ ] **A10 — Controlled beta entry.** Publish the tester checklist, support path, issue template, known prototype deviations, and go/no-go review. Exit requires no open P1 issue.
- [ ] **A11 — Base product commitments.** Make the first screen communicate “collector demand comes before minting”; present one simple three-step path per side; and add Artists onboarded, Auctions completed, Unique collectors, and Settled volume. Metrics must come from a precomputed indexer/projection aggregate behind a cache equivalent to the existing #70 projection-cache approach. No page view may trigger chain RPC fan-out, uncached full-table aggregation, or per-card recomputation.
- [ ] **A12 — Remove stale network copy.** Replace footer or marketing references to Ethereum Sepolia and unspecified “future production networks.” Base Sepolia is the active testnet; Base is the canonical production chain. Historical Ethereum Sepolia records remain readable only where migration compatibility requires them.

Phase A exit: A1–A12 accepted, the local and CI baselines are green, production health is observed, and no P1 issue remains.

## Phase B — Public Beta

Goal: validate the product with real users without changing frozen economics.

- [ ] **B1 — Tester cohort.** Recruit a controlled artist and collector cohort and track full publish → auction → settlement → mint → resale journeys in GitHub Issues.
- [ ] **B2 — Monitoring and incident runbook.** Operate health, cost, error, moderation, and cached public-metrics monitoring with named response steps.
- [ ] **B3 — Beta defect work.** Fix evidence-backed defects in focused PRs; do not mix protocol redesign into UX fixes.
- [ ] **B4 — Snapshot A.** Announce the final public-testnet cut-off at least two weeks ahead. At the cut-off, create the versioned, machine-readable, hashed export required by Bible §16; store and verify it in at least two independent durable locations. Snapshot A is a community record only and creates no Genesis, token, points, airdrop, or other entitlement.
- [ ] **B5 — Base go-to-market loop.** Onboard the first artist cohort personally, run themed auction drops, build in public through the official project account, and use verified cached metrics when reporting progress.

Phase B exit: stable beta, feedback processed, moderation proven with real cases, durable Snapshot A verified, and mainnet-preparation inputs ready.

## Phase C — Mainnet Preparation

Goal: audited, product-grade contracts and production operations.

- [ ] **C0 — Founder inputs.** Provide ProtocolTreasury and EcosystemTreasury Safe addresses (plus Base Sepolia rehearsal Safes), project domain, and required contract-design answers. These inputs are resource-gated as detailed in `docs/RESOURCE_GATED_WORK.md`: they do not block zero-incremental-spend Phase A engineering, but they remain mandatory before their activation and mainnet gates. Legal entity type and jurisdiction remain founder/counsel decisions; the roadmap must not assume a specific form such as a Polish `sp. z o.o.`.
- [ ] **C1 — Contract architecture sign-off.** Complete the required research, threat model, storage-layout plan, upgrade-pattern decision, and invariants before Solidity changes.
- [ ] **C2 — Core rework.** Implement the frozen economics, deterministic lazy/creator/keeper finalization, default handling, and the Bible §3.1 refund obligations with bounded batches and withdrawable-credit fallback. No unbounded bidder loop.
- [ ] **C3 — ArtworkNFT rework.** Implement the canonical 5.5% royalty, marketplace whitelist, provenance, and migration-safe interfaces.
- [ ] **C4 — ArtSoulGenesis.** Build the dedicated soulbound contract and audited grant path. The numeric grant cadence is tunable operational policy, not canon or an immutable roadmap value. Grants require published categories, durable grant records, an audit log, and multisig-authorized administration.
- [ ] **C5 — Partner Collections.** Implement the canonical first-auction, floor, attempt, cooldown, and buy-now behavior without creating separate floor economics.
- [ ] **C6 — Ecosystem Pool implementation.** Route the frozen 1% resale allocation and implement safe accounting. The trigger for pool-funded contests remains undecided until explicitly approved; no date, distribution count, or percentage is implied by this backlog.
- [ ] **C7 — Indexer and database rework.** Project the new contracts, lifecycle, grants, pool accounting, provenance, moderation, and migration evidence.
- [ ] **C8 — Admin and eligibility controls.** Build least-privilege roles, multisig gates, grant records, audit logs, and private anti-abuse operations without publishing hidden scoring.
- [ ] **C9 — Auras and badges.** Implement the canonical aura priority on cards and artwork pages plus separate Genesis and Top-100k profile status, with responsive Classic/Future behavior.
- [ ] **C10 — Promoted banners canon consolidation and implementation.** First consolidate the existing v1.2 planning delta into the full Bible and explicitly decide whether any slot-auction reserve is fixed or tunable. Only then implement clearly labeled promoted slots without changing organic discovery, Trust, floor, or settlement.
- [ ] **C11 — Test and invariant suites.** Cover economics, refunds, finalization, failed recipients, reentrancy, idempotency, roles, upgrade/storage layout, and migration.
- [ ] **C12 — Independent security review.** Resolve findings before deployment approval.
- [ ] **C13 — Fresh Base Sepolia rehearsal.** Deploy the final topology, hand roles to rehearsal Safes, exercise pool operations and the full lifecycle, and prove recovery/runbooks.
- [ ] **C14 — Legal and operational readiness.** Complete counsel-approved entity, ToS, Privacy/GDPR, IP assignment, domain/email, audit, and operating procedures. Exact legal form remains undecided until counsel/founder approval.
- [ ] **C15 — Final visual pass.** Apply premium homepage, cards, artwork, aura, accessibility, and responsive polish after functionality is stable.

Phase C exit: audit passed, fresh rehearsal green, treasuries/domain/legal ready, Snapshot A independently readable, and a signed launch decision recorded.

## Phase D — Staged Mainnet Launch

Goal: launch Base mainnet without a single-day Core-plus-Genesis big bang.

- [ ] **D1 — Preserve and re-verify Snapshot A.** Validate its manifest and independent copies immediately before the destructive reset.
- [ ] **D2 — Execute Bible §16 migration.** Reset live product data, remove legacy addresses and networks, re-point the indexer, and prove zero stale product state.
- [ ] **D3 — Deploy and open Core operations.** Deploy audited contracts to Base, hand roles to Safes, run smoke tests, and open writes only after the checklist passes.
- [ ] **D4 — Core stability window.** Observe production through a launch-readiness window approved at the go/no-go review. The duration is operational and is not frozen canon.
- [ ] **D5 — Separate Genesis pilot.** Activate a bounded pilot only after Core stability is demonstrated. Expand grants through the audited path; cadence remains tunable and recorded.
- [ ] **D6 — Controlled growth.** Scale onboarding, Collections, contests, partner work, and marketing only from verified production evidence.

Phase D exit: stable Base mainnet protocol, verified treasury operations, controlled Genesis rollout, and monitored public metrics.

## Out Of Scope Until An Explicit Canon Amendment

- Any non-Base product chain.
- Token, points, airdrop, or passive-income mechanics.
- Fee waivers or discounts.
- Unapproved economic changes.
- Public disclosure of hidden anti-abuse scoring.

## Frozen Economic Guardrail

This backlog does not amend economics: primary `97.5 / 2.5`; resale `92.5 / 5.5 / 1 / 1`; defaulted-winner deposit split `80 / 20`; minimum deposit, increment, duration, and settlement rules remain exactly as stated in Bible §3.
