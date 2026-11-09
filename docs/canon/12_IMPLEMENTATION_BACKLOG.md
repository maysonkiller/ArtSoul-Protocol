# Implementation Backlog

This backlog tracks the A–D phase model in `ARTSOUL_CANON_BIBLE_FULL.md` §17. Apply the [November 2 decision-authority clarification](CHANGELOG_2026-11-02_DECISION_AUTHORITY.md): current founder requests, risk and actual dependencies take priority over obsolete ordering. The Bible records design decisions; deployed contracts, receipts and verified configuration establish current behavior. A backlog entry alone does not approve new financial parameters, custody or critical authority, or establish release acceptance.

Work proceeds one contained task at a time. One backlog item normally equals one focused PR. Contract changes require focused tests and explicit storage-layout review.

## Founder-authorized takeover sequence — 2026-09-20

The [development amendment](CHANGELOG_2026-09-20_COLLECTION_LAUNCH.md) permits
this ordered sequence without marking the outstanding Phase A gates complete:

1. **TA-01** — Audit current history/deployment and close AI media-fetch SSRF with regression evidence.
2. **TA-02** — Keep provider identity fields under OAuth control, with authenticated negative tests.
3. **TA-06** — Founder priority clarification 2026-09-21: stabilize the text-reported auction lifecycle, cross-page freshness, shared creation form, decimal entry, deposit explanation and wallet action guards before further Collection Launch implementation. Reuse existing audit evidence; do not repeat video analysis. Checkpoint: `docs/audits/STABILIZATION_CHECKPOINT.md`.
4. **TA-03** — Implement and validate generic collection configuration and authoring, with explicit draft/launch boundaries.
5. **TA-04** — Implement new isolated testnet collection/auction/craft contracts; test security and local lifecycle without modifying deployed storage.
6. **TA-05** — Integrate verified projections, verification/newsletter/campaign services and reviewed wallet actions; rehearse testnet only after configuration and credentials exist.

**September 30 continuation — TA-09, founder-corrected scope:** repair verified profile/OAuth, save/cancel/reload, duplicate-link, mobile layout and loading-feedback regressions from the two new recordings. AI valuation is intended behavior and is explicitly excluded; its unsolicited patch was rejected and reverted. Auction publication, IDs and economics are not defects in this report. The September 21 old-video restriction still applies to that old source. Preserve Phase A evidence requirements; see `docs/BACKLOG.md`.

**Delivered:** [PR #284](https://github.com/maysonkiller/ArtSoul-Protocol/pull/284), application revision `aacbc5a`, passed local/hosted checks and apex artifact/public-read verification. TA-09 is complete; real-device RG-01 and dependent operational gates retain their actual status. See [the evidence record](../audits/RG01_PROFILE_VIDEO_2026-09-30.md).

Durable findings, evidence and status live in `docs/BACKLOG.md`. Separate items
remain reviewable; a successful local test never means a production rollout.

## Phase A — Stabilize Public Testnet (accepted October 24, 2026)

Goal: a production testnet trustworthy enough for a controlled beta.

Scheduling amendment, 2026-10-03: the founder authorizes real passkey enrollment
and its operator recovery ceremony now, superseding the September 29 deferral.
The activation requirements below remain mandatory before live moderation is
enabled; they are not marked complete or replaced by a test-only bypass. See
`CHANGELOG_2026-10-03_PHASE_A_ACTIVATION.md`.

- [x] **A1 — Security and migration verification.** Accepted 2026-08-07 through the public runtime evidence in `docs/testnet/A1_MOBILE_AUTH_UPLOAD_POLICY_ACCEPTANCE_2026-08-04.md` and the redacted private-operation record in `docs/testnet/A1_CREDENTIAL_HISTORY_ACCEPTANCE_2026-08-07.md`. Repository hardening, forced production RLS, the historical testnet migration baseline, bucket guardrails, GitHub Secret Scanning and push protection, preview/production headers, desktop and external-mobile SIWE, signed uploads, authenticated negative upload-policy probes, server-only credential validation, retirement of the exposed secondary development key, and the explicit decision to retain repository history under the active scanning controls are verified. No secret value is stored in either acceptance record.
- [x] **A2 — Mobile wallet acceptance.** Complete real-phone external-browser, in-app-browser, desktop, navigation, reload, background, write-guard, and explicit-disconnect acceptance. Preserve Base Sepolia as the only operational write chain.
- [x] **A3 — Production diagnostics cleanup.** Remove the visual wallet debug overlay from production pages while retaining the isolated `wallet-test.html` bench.
- [x] **A4 — Green baseline and CI.** PR #109 established deterministic Ubuntu and Windows CI with reproducible install, build, static checks, Node tests, and 19 contract tests. The accepted suite has continued to grow without reopening the resolved historical Hardhat-runner failures; the 2026-07-17 A5 validation completed with 156 Node tests and 19 contract tests.
- [x] **A5 — Indexer status drift.** Completed 2026-07-18. PR #112 reconciled the deployed Base Sepolia confirmation depth from 12 to 3 on startup without resetting the persisted cursor. PR #114 added schema-aware reorg rollback migration 014 with regression and PostgreSQL 17 integration coverage. After a verified backup, migration 014 was applied to production, both legacy-table guards were verified, Hetzner was updated to merge commit `4a10841`, and PM2 resumed from the existing cursor. Production health remained `healthy` with confirmation depth 3, no confirmation-depth sync error, zero unresolved errors, advancing confirmed blocks, and no new missing-legacy-table or reorg-check failure in the observed post-restart cycles.
- [x] **A6 — Projection and provenance verification.** Verify indexed Creator, First Collector, Owner, auction, settlement, resale, moderation, and pending-projection states across every public surface. Completed by PR #120 (surface audit, projection-state fixtures, wallet-fallback fix), PR #122 (exact chain-scoped lookup, indexer-backed provenance timeline, moderation-safe endpoint), and PR #124 (creator-focused compact cards with public-nickname attribution, Owned creator-buyback filter). Per canon doc 05, compact preview cards stay creator-focused; full First Collector / Owner provenance and the timeline are verified on the artwork detail surface. The hidden-artwork unavailable-copy item moved to A8 moderation UX.
- [x] **A7 — Profile lifecycle and action gating.** Verify that only the correct wallet and lifecycle state expose publish, auction, settlement, mint, resale, moderation, or admin actions. PR #126 merged the full action inventory, legacy-artwork write-action visibility, resale submit re-checks, self-purchase rejection, and dormant profile predicate chain guards with a 28-test role/lifecycle matrix (strict Base-only chain authorization and live submit-time accounts included). PR #127 merged the bounded publish confirmation and no-resubmit regression. Final production acceptance passed on 2026-08-09 through founder wallet `0x6EC8…989B`: artwork `v41:84532:27` redirected to its exact detail URL, registration transaction `0x77b4895b8db42d4aeb272290f37e809460ed4e162e5eacad27172e43564ee5b6` produced artwork `27`, and one distinct auction transaction `0x5ed747634b4e88898eacf399b7c65d3cd498b5f8209b92642c0e91c25053759d` produced auction `27` for that same artwork. The complete indexer provenance contains exactly one `artwork_registered` event followed by exactly one `auction_started` event.
- [x] **A8 — Moderation and reporting MVP.** Accepted 2026-10-15, including the subsequent UI repair in published PR #309 / #310 (`9a2965f`). The owner confirms one passkey closes the login dialog; actual apex tools open on the first click, close with focus return and fit a 390px viewport. Candidate Linux/Windows/static CI, focused checks, build and apex artifacts pass. Preserve completed ceremonies. The actual Report form, independent intake/deduplication/rate limit, staff review, multi-report visibility, concurrent/stale decisions, immutable audit, recipient inboxes and project-mail receipt are recorded in [dated acceptance](../audits/PHASE_A_MODERATION_ACCEPTANCE_2026-10-11.md). Real paired setup/replacement and passkey/authenticator entry plus device/network checks are accepted. Fixed 24-hour non-sliding expiry is proven by exact-boundary backend tests and compiled-client deadline checks; no natural 24-hour observation is claimed or independently required. Real disposable PostgreSQL/handler/worker tests cover failure isolation and flag-preserving denial, without staging a production outage. PR #308 is published with passing CI and apex verification. Both current authority wallets govern application role/setup/recovery changes under the approved amendments below; earlier Safe-only/bootstrap and disabled-feature statements are historical. Contract custody, economics and mainnet authorization are unchanged. X/Discord handles are not staff factors. Do not build Content-ID or self-hosted fingerprinting. This October 15 acceptance did not itself accept A10; its later decision is recorded below.

  **Schema addendum, 2026-09-30:** the four exact reviewed A8 migrations committed
  in order, one transaction each, with eight tables, seven RPCs and five identity
  sequences verified. All new feature tables held zero rows; passkey, Protocol
  Admin and reporting flags stayed disabled. No role, bootstrap or ceremony was
  performed. Full and schema-only backup hashes were verified and the custom
  archive was readable; no database restore drill was performed. The historical
  migration ledger remains absent and was not fabricated. See
  [the A8 schema evidence record](../audits/PHASE_A_A8_SCHEMA_2026-09-30.md).
  This closes the missing-schema preparation step, not live moderation,
  notification delivery, RG-03 activation or the real passkey/recovery
  gates. A8 and A10 are not marked accepted by this addendum.

  **Authority amendment, 2026-10-08:** the founder selected both current authority
  wallets' gasless approvals for role changes and initial-factor/recovery setup,
  replacing the previous separate bootstrap and Safe-only staff recovery gate.
  Setup lasts 15 minutes; login accepts a passkey or authenticator app. TOTP limits
  are five reserved attempts per rolling five minutes and a two-minute reservation.
  Canon 07 records the exact approved scope. Draft implementation, local tests and
  historical Safe ceremonies do not close A8's real replacement-flow acceptance.

  **Session and device-scope amendment, 2026-10-11:** verified staff access now
  has an approved fixed maximum of 24 hours, with another factor verification
  when the browser session or trusted client IP changes. Setup permission stays
  15 minutes and critical changes still require both authority signatures.
  Android acceptance is owner-waived / not tested for this Phase A close-out;
  no Android compatibility PASS is inferred. See canon 07 and the device sheet.
  The changed policy requires its own test/release evidence.

  **Staff privacy clarification, 2026-10-13:** the founder permits the verified
  Team role and either current authority wallet to read the staff directory.
  Ordinary administrators/moderators outside that pair cannot enumerate staff
  or receive other staff attribution wallets through moderation APIs. Complete
  audit identities remain in storage; Team visibility grants no approval power.
  Canon 07 records the scope; the stabilization checkpoint records implementation
  and release evidence. This does not itself close A8 or A10.

- [x] **A9 — Infrastructure cost and alerting.** Accepted 2026-07-28. Repository health-check tooling, fail-closed event-failure handling, no-cost plan constraints, thresholds, restart checks, and the Tuesday/Friday manual cadence are defined in `docs/runbooks/A9_INFRA_COST_MONITORING.md`. A-15, A-40, A-41, A-42, and A-43 retain their production acceptance evidence there. The consecutive 2026-07-22 through 2026-07-28 provider-dashboard window recorded 14.1K Alchemy CUs, a 22.9M month-end forecast against the 30M hard limit, ArtSoul-only Supabase uncached egress of 41.0–59.4 MB/day, current-cycle uncached/cached totals of 0.246/0.764 GB, and an enabled Supabase Spend Cap. Native custom Alchemy alerts remain unavailable on the current plan and Supabase has no fine-grained budget-threshold notifications, so hard limits plus the documented manual review are the accepted no-cost controls.
- [x] **A10 — Controlled beta entry.** Accepted 2026-10-24 by the dated engineering-readiness GO in `docs/testnet/CONTROLLED_BETA_ENTRY.md`. Tester checklist, support path, issue form, prototype deviations and pause rules are published. A1-A12 evidence, exact PR #334 release/CI, production health and a separate tracker/backlog review are recorded; no open P1 is identified. This accepts Phase A engineering readiness, not an invitation window: canonical B1/B2 still require a cohort, dates, available operator and support/pause coverage before invitations. Deferred display polish and unperformed Phase B acceptance remain explicitly listed. No architecture/economic requirement or mainnet gate changes.
- [x] **A11 — Base product commitments.** Accepted 2026-07-28 through PR #160 and the production evidence in `docs/runbooks/A11_PUBLIC_METRICS_ROLLOUT.md`. The first screen states that collector demand comes before minting, presents the compact Publish → build collector demand → settle and mint path, and positions ArtSoul as a curation layer. Artists onboarded, Auctions completed, Unique collectors, and Settled volume come from the idempotent, reorg-safe Base Sepolia projection introduced by migration 015. The public API reads one precomputed chain row inside the existing server/CDN cache; the homepage reuses that response and adds no browser request, chain RPC fan-out, full-table runtime aggregation, or per-card recomputation.
- [x] **A12 — Remove stale network copy.** Accepted 2026-07-28 through PRs #162-#164 and `docs/testnet/A12_NETWORK_COPY_ACCEPTANCE.md`. Active public copy identifies Base Sepolia as the only product testnet and Base as the production chain, the account menu offers only Base Sepolia as a product-network switch, and Protocol Docs use the canonical Genesis trust weight of `1.3x`. Historical Ethereum Sepolia records remain readable only where migration compatibility requires them. PR #163 corrected the async module-entry race discovered during production acceptance and added source/build regression coverage.

  **Account-network amendment, 2026-11-09:** the founder now permits choosing
  existing configured wallet networks. The account menu offers Base Sepolia,
  Base mainnet and Ethereum mainnet for wallet browsing; the write guard and
  active ArtSoul deployment remain Base Sepolia-only. This supersedes A12's
  account-menu restriction, not its operational testnet or historical-data rules.
  See [the bounded follow-up](../audits/B18_PROFILE_NETWORK_MENU_2026-11-09.md).

Phase A exit: A1–A12 accepted, the local and CI baselines are green, production health is observed, and no P1 issue remains.

## Phase B — Public Beta

Goal: validate the product with real users without changing frozen economics.

- [ ] **B1 — Tester cohort.** Recruit a controlled artist and collector cohort and track full publish → auction → settlement → mint → resale journeys in GitHub Issues.
- [ ] **B2 — Monitoring and incident runbook.** Operate health, cost, error, moderation, and cached public-metrics monitoring with named response steps.
  The November 9 [independent recovery and Core cutover](../audits/B35_INDEPENDENT_RECOVERY_AND_CORE_CUTOVER_2026-11-09.md)
  verifies off-PC encrypted storage, owner key access from iPhone, fresh isolated
  restoration, five atomic migrations and the newer worker on the existing host.
  The [November 9 exporter trace](../audits/B30_EXPORTER_TEMP_FILES_2026-11-09.md)
  attributes six temporary files totaling 20,277,852 bytes in five minutes to
  the managed `postgres_exporter`. Each exact query reproduced 413 temporary
  blocks read/written at session-local `work_mem=3500kB` and zero at `16MB`.
  Attribution is complete for that window; the provider's collector-only
  correction remains pending. The [combined PostgreSQL/Redis follow-up](../audits/B35_COMBINED_POLL_CACHE_ACCEPTANCE_2026-11-02.md#november-9-follow-up-actual-redis-in-the-combined-scenario)
  passes locally, including purge failure, later token acknowledgement and
  rejection of a delayed stale refill. NFT writer/ownership flags remain off;
  hosted-cache activation, representative IO/egress and operator/cohort
  coverage remain distinct gates. No additional paid infrastructure was enabled.
- [ ] **B3 — Beta defect work.** Fix evidence-backed defects in focused PRs; do not mix protocol redesign into UX fixes.
  The November 9 [confirmed purchase fix](../audits/B11_CONFIRMED_PURCHASE_FEEDBACK_2026-11-09.md)
  prevents optional read failures from misreporting confirmed settlement/resale
  transactions and uses the receipt bridge to suppress stale purchase actions.
  Its follow-up synchronizes confirmed end/default auction state without waiting
  for API refresh, preserving indexed ownership/floor and receipt scope. Delayed
  refresh and late-poll regressions pass; actual signed journeys remain separate.
  Owner acceptance then confirmed artwork 25 default on-chain but found an
  unsigned wallet relay response blocking the send promise. The
  [relay confirmation follow-up](../audits/B11_RELAYED_WALLET_CONFIRMATION_2026-11-09.md)
  validates the original call before recovering its canonical transaction;
  PR #478 is released. Owner-signed assistant default for artwork 14 passed on
  production `v19`, block `56614941` at `2026-11-09T17:20:57Z`, with matching
  receipts from both public RPCs. Without reload, the page removed the default
  action and showed Create New Auction; assistant input cleared and completion
  links appeared. Artwork 25's later reload verifies indexed history, not its
  earlier no-reload confirmation. Its owner-signed page re-auction then created
  auction 74 at `0.001 ETH` for 24 hours, block `56615876` at
  `2026-11-09T17:24:04Z`, verified by both public RPCs. The resulting gallery
  showed a live Keeef card; in-place modal closure was not observed. Remaining
  signed assistant scenarios stay open; no successful transaction is replayed.
  PR #479 released the native new-auction dialog correction. Assistant withdrawal
  is accepted on artwork 38: `0.0609875 ETH`, block `56622288`, zero pending
  credit afterward, cleared command without reload. The separate Gallery
  initialization defect is corrected locally with passive selected-provider
  preparation and race checks; hosted verification is tracked in the
  [readiness audit](../audits/B11_GALLERY_WALLET_READINESS_2026-11-09.md).
  The November 9 [profile/network follow-up](../audits/B18_PROFILE_NETWORK_MENU_2026-11-09.md)
  stabilizes late staff actions, removes account hover frames and adds explicit
  choices for configured wallet networks without enabling mainnet writes.
  The November 9 [resume audit](../audits/B18_RESUME_ACCOUNT_SEO_2026-11-09.md)
  reconciles the accepted account-plaque A and private inventory details with
  incoming B36–B39 changes, and fixes distinct author profiles canonicalizing
  to the generic profile route. HTTP-to-HTTPS redirection remains intentional.
  The November 2 [NFT record display](../audits/B18_NFT_RECORD_DETAILS_2026-11-02.md)
  adds exact indexed ArtSoul sale evidence and contract identity without inferring
  the current owner's acquisition price. The separately requested
  [external Base inventory](../audits/B18_EXTERNAL_BASE_INVENTORY_2026-11-02.md)
  is implemented behind a default-off provider gate; it introduces no mainnet
  trading, automatic inventory polling or claim of verified external sale price.
- [x] **B4 — Snapshot tooling readiness.** PR #386 (`cc7db8dc`) verifies the current schema, offline archive verification, no-overwrite output and concurrent PostgreSQL read consistency; two live read-only rehearsals agree. Maintain and rehearse the versioned exporter and independent verifier. The October 28 founder amendment moves actual Snapshot A capture to C16, after the full final-contract testnet. No final cut-off or export is required to close the current beta.
- [ ] **B5 — Base go-to-market loop.** Onboard the first artist cohort personally, run themed auction drops, build in public through the official project account, and use verified cached metrics when reporting progress.

Phase B exit: stable beta, feedback processed, moderation proven with real cases, snapshot tooling ready, and mainnet-preparation inputs ready. Actual Snapshot A capture is a late-C gate.

## Phase C — Mainnet Preparation

Goal: audited, product-grade contracts and production operations.

The October 3 founder amendment moves the previously deferred passkey/recovery
ceremony back into current A8 activation. Final mainnet custody and configuration
still require C0/C8/C13 acceptance; testnet credentials are not mainnet custody.

- [ ] **C0 — Founder inputs.** Provide ProtocolTreasury and EcosystemTreasury Safe addresses (plus Base Sepolia rehearsal Safes), project domain, and required contract-design answers. These inputs are resource-gated as detailed in `docs/RESOURCE_GATED_WORK.md`: they do not block zero-incremental-spend Phase A engineering, but they remain mandatory before their activation and mainnet gates. Legal entity type and jurisdiction remain founder/counsel decisions; the roadmap must not assume a specific form such as a Polish `sp. z o.o.`.
- [ ] **C1 — Contract architecture sign-off.** Complete the required research, threat model, storage-layout plan, upgrade-pattern decision, and invariants before Solidity changes.

  October 26: [updated research and boundaries](CONTRACT_REWORK_PLAN.md) and
  [founder direction](CHANGELOG_2026-10-26_CONTRACT_EXTENSIBILITY.md) recorded.
  Includes the locally reproduced stale resale after ownership returns, versioned
  collections/utilities and payment-origin separation. Final architecture and
  storage-layout sign-off remain pending; no current contract/network change.

  November 2: [decision/invariant annex](../architecture/C1_DECISION_INVARIANTS_2026-11-02.md)
  specifies the deployment/mint-authority questions, current pause/exit matrix,
  liability and rounding vectors, and listing invalidation acceptance cases.
  These are review inputs, not approved emergency powers, rounding policy or
  storage topology. C1 remains open before replacement Solidity.
  The D5 follow-up records the founder's automatic-lifecycle direction, distinguishing
  no-bid lazy finalization, executor gas reserves and separately funded winner
  payment. Reserve fees/caps, funding and recovery remain design decisions; no
  current contract or payment network changes.
  The [local characterization follow-up](../audits/C1_PAUSE_AUTHORITY_CHARACTERIZATION_2026-11-02.md)
  reproduces funded pause expiry, old-Core mint-authority denial and shared-NFT
  artwork-ID collision. All 52 current contract tests pass; these cases document
  prototype hazards, not approved replacement behavior or completed C1 acceptance.
  The [current-source storage baseline](../audits/C1_STORAGE_BASELINE_2026-11-02.md)
  captures six constructor-based layouts plus immutable bindings from the matching
  compiler. Reproduction and refusal checks pass; replacement layout/topology and
  upgrade compatibility remain undecided and are not inferred from this export.
  D6 adds the requested compromised-wallet threat review: exact once-only payouts,
  customer website factors versus independently enforced account authorization,
  device/IP risk signals, delegation bypass and recovery/upgrade authority.
  Optional protected accounts and recovery policy are proposals, not an activated
  customer MFA requirement or a custody decision. Current staff policy is unchanged.
  Two additional local cases prove exact settlement/replay and credit-owner/once-only
  withdrawal behavior; all 54 contract tests pass. These are prototype accounting
  checks, not proof of wallet-key compromise protection or C1 sign-off.
  The D1 privileged-authority follow-up proves an owner-authorized EOA can mint
  an unregistered artwork without settlement; revocation blocks future mints but
  leaves the issued token intact. The funded Core auction/escrow is unchanged and
  settles after authority restoration. All 55 local contract tests pass; this is
  a governance/lifecycle hazard to address in C1/C3, not a live exploit or a fix.
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
- [ ] **C16 — Final public-testnet Snapshot A.** After the final contracts complete full public-testnet validation, capture the versioned machine-readable hashed export at a final cut-off announced at least two weeks ahead. Store and verify at least two independent durable copies before any Phase D reset or mainnet launch. It is a community record only and creates no Genesis, token, points, airdrop, or other entitlement. Earlier beta rehearsals do not count as this capture.

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
