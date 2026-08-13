# Implementation Backlog

This backlog expands the canonical A–D phase model in `ARTSOUL_CANON_BIBLE_FULL.md` §17. The Bible is the single source of protocol truth. A roadmap or backlog item may schedule work, but it may not create or amend economics, contract mechanics, roles, Genesis grant cadence, treasury triggers, or legal decisions.

Work proceeds one contained task at a time. One backlog item normally equals one focused PR. Contract changes require focused tests and explicit storage-layout review.

## Phase A — Stabilize Public Testnet (active)

Goal: a production testnet trustworthy enough for a controlled beta.

- [x] **A1 — Security and migration verification.** Accepted 2026-08-07 through the public runtime evidence in `docs/testnet/A1_MOBILE_AUTH_UPLOAD_POLICY_ACCEPTANCE_2026-08-04.md` and the redacted private-operation record in `docs/testnet/A1_CREDENTIAL_HISTORY_ACCEPTANCE_2026-08-07.md`. Repository hardening, forced production RLS, the historical testnet migration baseline, bucket guardrails, GitHub Secret Scanning and push protection, preview/production headers, desktop and external-mobile SIWE, signed uploads, authenticated negative upload-policy probes, server-only credential validation, retirement of the exposed secondary development key, and the explicit decision to retain repository history under the active scanning controls are verified. No secret value is stored in either acceptance record.
- [x] **A2 — Mobile wallet acceptance.** Complete real-phone external-browser, in-app-browser, desktop, navigation, reload, background, write-guard, and explicit-disconnect acceptance. Preserve Base Sepolia as the only operational write chain.
- [x] **A3 — Production diagnostics cleanup.** Remove the visual wallet debug overlay from production pages while retaining the isolated `wallet-test.html` bench.
- [x] **A4 — Green baseline and CI.** PR #109 established deterministic Ubuntu and Windows CI with reproducible install, build, static checks, Node tests, and 19 contract tests. The accepted suite has continued to grow without reopening the resolved historical Hardhat-runner failures; the 2026-07-17 A5 validation completed with 156 Node tests and 19 contract tests.
- [x] **A5 — Indexer status drift.** Completed 2026-07-18. PR #112 reconciled the deployed Base Sepolia confirmation depth from 12 to 3 on startup without resetting the persisted cursor. PR #114 added schema-aware reorg rollback migration 014 with regression and PostgreSQL 17 integration coverage. After a verified backup, migration 014 was applied to production, both legacy-table guards were verified, Hetzner was updated to merge commit `4a10841`, and PM2 resumed from the existing cursor. Production health remained `healthy` with confirmation depth 3, no confirmation-depth sync error, zero unresolved errors, advancing confirmed blocks, and no new missing-legacy-table or reorg-check failure in the observed post-restart cycles.
- [x] **A6 — Projection and provenance verification.** Verify indexed Creator, First Collector, Owner, auction, settlement, resale, moderation, and pending-projection states across every public surface. Completed by PR #120 (surface audit, projection-state fixtures, wallet-fallback fix), PR #122 (exact chain-scoped lookup, indexer-backed provenance timeline, moderation-safe endpoint), and PR #124 (creator-focused compact cards with public-nickname attribution, Owned creator-buyback filter). Per canon doc 05, compact preview cards stay creator-focused; full First Collector / Owner provenance and the timeline are verified on the artwork detail surface. The hidden-artwork unavailable-copy item moved to A8 moderation UX.
- [x] **A7 — Profile lifecycle and action gating.** Verify that only the correct wallet and lifecycle state expose publish, auction, settlement, mint, resale, moderation, or admin actions. PR #126 merged the full action inventory, legacy-artwork write-action visibility, resale submit re-checks, self-purchase rejection, and dormant profile predicate chain guards with a 28-test role/lifecycle matrix (strict Base-only chain authorization and live submit-time accounts included). PR #127 merged the bounded publish confirmation and no-resubmit regression. Final production acceptance passed on 2026-08-09 through founder wallet `0x6EC8…989B`: artwork `v41:84532:27` redirected to its exact detail URL, registration transaction `0x77b4895b8db42d4aeb272290f37e809460ed4e162e5eacad27172e43564ee5b6` produced artwork `27`, and one distinct auction transaction `0x5ed747634b4e88898eacf399b7c65d3cd498b5f8209b92642c0e91c25053759d` produced auction `27` for that same artwork. The complete indexer provenance contains exactly one `artwork_registered` event followed by exactly one `auction_started` event.
- [ ] **A8 — Moderation and reporting MVP.** Complete the complaint-driven Report flow, notice-and-takedown form, valid-claim hide path, review queue, notifications, and auditable staff actions. The A8a access-security foundation was merged in PR #129 with its flag disabled and migration unapplied: 15-minute passkey step-up, two founder passkeys, one one-time auditable bootstrap grant, and Safe-only founder recovery. A8d now implements that Safe-only recovery foundation behind the same disabled flag: the exact SIWE staff wallet and configured Safe/chain/RP identity are bound into a short-lived request; threshold-valid EIP-1271 verification must agree through at least two configured RPCs; success atomically creates one hashed, short-lived `additional` enrollment grant and never a moderation session, role or credential. The additive migration remains unapplied and the founder ceremony remains unrehearsed, so this does not activate or complete A8. PR #130 merged the A8b public Report intake with its flag disabled and migration unapplied; the approved controlled-beta intake limit is five new reports per reporter wallet across a rolling 24-hour window. PR #133 merged A-22/A8c: the dedicated Protocol Admin queue, lazy server-confirmed menu discovery, serialized staff decisions with a distinct resolved status and duplicate-pending reopen guard, transition-accurate restore events, append-only decision evidence and notification obligations remain behind a separate disabled flag. A8 remains incomplete until the ordered migrations, two founder passkeys, audited bootstrap grant, rehearsed Safe-only recovery, admin workflow and public intake pass the resource-gated production checklist. X/Discord handles are not authentication factors. Do not build Content-ID or self-hosted fingerprinting.
- [x] **A9 — Infrastructure cost and alerting.** Accepted 2026-07-28. Repository health-check tooling, fail-closed event-failure handling, no-cost plan constraints, thresholds, restart checks, and the Tuesday/Friday manual cadence are defined in `docs/runbooks/A9_INFRA_COST_MONITORING.md`. A-15, A-40, A-41, A-42, and A-43 retain their production acceptance evidence there. The consecutive 2026-07-22 through 2026-07-28 provider-dashboard window recorded 14.1K Alchemy CUs, a 22.9M month-end forecast against the 30M hard limit, ArtSoul-only Supabase uncached egress of 41.0–59.4 MB/day, current-cycle uncached/cached totals of 0.246/0.764 GB, and an enabled Supabase Spend Cap. Native custom Alchemy alerts remain unavailable on the current plan and Supabase has no fine-grained budget-threshold notifications, so hard limits plus the documented manual review are the accepted no-cost controls.
- [ ] **A10 — Controlled beta entry.** Publish the tester checklist, support path, issue template, known prototype deviations, and go/no-go review. Exit requires no open P1 issue. Entry materials are prepared in PR #157 and `docs/testnet/CONTROLLED_BETA_ENTRY.md`; acceptance remains open until every Phase A gate is evidenced and the recorded decision is GO.
- [x] **A11 — Base product commitments.** Accepted 2026-07-28 through PR #160 and the production evidence in `docs/runbooks/A11_PUBLIC_METRICS_ROLLOUT.md`. The first screen states that collector demand comes before minting, presents the compact Publish → build collector demand → settle and mint path, and positions ArtSoul as a curation layer. Artists onboarded, Auctions completed, Unique collectors, and Settled volume come from the idempotent, reorg-safe Base Sepolia projection introduced by migration 015. The public API reads one precomputed chain row inside the existing server/CDN cache; the homepage reuses that response and adds no browser request, chain RPC fan-out, full-table runtime aggregation, or per-card recomputation.
- [x] **A12 — Remove stale network copy.** Accepted 2026-07-28 through PRs #162-#164 and `docs/testnet/A12_NETWORK_COPY_ACCEPTANCE.md`. Active public copy identifies Base Sepolia as the only product testnet and Base as the production chain, the account menu offers only Base Sepolia as a product-network switch, and Protocol Docs use the canonical Genesis trust weight of `1.3x`. Historical Ethereum Sepolia records remain readable only where migration compatibility requires them. PR #163 corrected the async module-entry race discovered during production acceptance and added source/build regression coverage.

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
