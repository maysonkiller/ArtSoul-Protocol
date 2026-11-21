# Implementation Backlog

This backlog tracks the A–D phase model in `ARTSOUL_CANON_BIBLE_FULL.md` §17. Apply the [November 2 decision-authority clarification](CHANGELOG_2026-11-02_DECISION_AUTHORITY.md): current founder requests, risk and actual dependencies take priority over obsolete ordering. The Bible records design decisions; deployed contracts, receipts and verified configuration establish current behavior. A backlog entry alone does not approve new financial parameters, custody or critical authority, or establish release acceptance.

Work proceeds one contained task at a time. One backlog item normally equals one focused PR. Contract changes require focused tests and explicit storage-layout review.

**November 21 acceptance count.** Of the 40 numbered items, 17 are accepted (42.5%) and 23 remain (57.5%). Phase A has 12 of 12 accepted, B has 1 of 5 (B4), C has 4 of 17 (C2, C3, C6 and C11), and D has 0 of 6. Each item carries equal weight. The founder closed the B engineering workstream on November 18. Open public-beta journeys carry into C13.

The five fixes from the November 19 recording reached artsoulprotocol.com in [PR #500](https://github.com/maysonkiller/ArtSoul-Protocol/pull/500), main commit `32511226`. On November 20, guest Chromium checks on the public domain covered the Favorites entry, gallery refresh with delayed scripts, collection draft save/undo/load, and artworks 7 and 12 in Classic and Future. Artwork 12 showed its original creator value of 0.00001 test ETH separately from its auction start of 0.0005 test ETH. The real-wallet sign-in and saving a private favorite still need a connected-wallet check.

The November 20 recording fixes shipped in [PR #501](https://github.com/maysonkiller/ArtSoul-Protocol/pull/501) and [PR #502](https://github.com/maysonkiller/ArtSoul-Protocol/pull/502). The production domain served main commit `805543cc`. Browser checks covered guest navigation, playback using touch, pointer and keyboard, Guide history, and the Classic and Future layouts. The audio cover dropped from 1,485,791 to 44,106 bytes. In 12 controlled mobile-network navigations the existing artwork request started about 0.2 seconds earlier, once per page. On the production domain three cold runs per page and layout put the homepage and gallery request starts 97 to 185 ms earlier. Median first-image completion improved in three of the four samples. In the 390px gallery it changed from 942 to 1,038 ms. A separate image wait timed out after 17 seconds before the repeat series. The regression suite covers signed-out, authenticated and expired Favorites sessions and retained rows when media is unavailable. Real-account private Favorites and the physical iPhone wallet round trip on this build remain open under C13. These checks contribute to C15 while preserving the acceptance count above.

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

**November 18 decision.** The founder closed active B engineering and moved to
local Phase C development. The unchecked B1/B5 cohort and B2/B3 operational
observations below carry forward to C13 or operations. Review optional voice
and WebMCP separately when work on those features resumes. The
[engineering closeout](../PHASE_B_STATUS_2026-11-02.md) records the outstanding
hosted reminder observations, provider correction and reported assistant
fallback. Public beta acceptance and mainnet approval remain outstanding.

November 16 B20 release checkpoint: [profile-content notices](../audits/B20_PROFILE_CONTENT_REPORTS_2026-11-09.md)
have deployed intake, versioned review, reversible public masking and private
owner editing (PR #484). CI, fresh full-data restoration, live migration and
production reader/access checks passed; intake is enabled under the existing
quota and staff policy. PR #485 corrected native-dialog centering; production
desktop/mobile geometry and static Classic feedback passed. The owner-authorized
lys TEST cycle passed actual staff review, public masking, exact restoration and
both participants' notification viewing/read state. The live cycle exposed an
omitted profile-notice allowlist; the [bounded correction](../audits/B20_PROFILE_NOTIFICATION_READ_STATE_2026-11-16.md)
passed isolated PostgreSQL regressions, preserved live data/permissions and fixed
both owner reads. Historical unused-cover files are preserved pending a
retention decision. Reporting acceptance is complete.

- [ ] **B1 — Tester cohort.** Recruit a controlled artist and collector cohort and track full publish → auction → settlement → mint → resale journeys in GitHub Issues.
- [ ] **B2 — Monitoring and incident runbook.** Operate health, cost, error, moderation, and cached public-metrics monitoring with named response steps.
  Local checks now reject missing or malformed progress counters. A missing API value previously appeared as zero and could mask a degraded worker. See the [monitor runbook](../runbooks/A9_INFRA_COST_MONITORING.md) and [monitor tests](../../test/indexer-health-monitor.test.mjs).
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
  The [November 16 operational recheck](../audits/B30_B35_OPERATIONAL_RECHECK_2026-11-16.md)
  confirms a healthy database/indexer, fresh displayed current/projected costs
  of USD 25, enabled Spend Cap and usage within the displayed allowances. The
  November 17 human reply confirmed the managed collector issue. The November
  18 counters and the support workaround are in the same recheck. Provider
  correction and representative IO acceptance remain pending.
  The [reminder recheck](../audits/B17_REMINDERS_ACCEPTANCE_RECHECK_2026-11-16.md)
  passes 66 tests. The owner's new ending of existing auction 75 subsequently
  opened its real payment window and produced one winner-only payment reminder.
  The owner confirmed iPhone viewing and independently settled it; NFT 8,
  zero additional payment, 0.009 test ETH withdrawable credit and restored
  one-hour preferences are verified. The payment reminder was not marked read,
  and live-extension acceptance remains open. On November 18 a local EVM and
  disposable PostgreSQL test verified extension, read acknowledgement and
  settlement retirement through the actual worker and authenticated API.
  The stale ownership/history UI
  observed after settlement has a [released bounded correction](../audits/B17_REMINDERS_ACCEPTANCE_RECHECK_2026-11-16.md#released-receipt-refresh-correction)
  in PR #497. Reloaded production ownership/history pass; a new settlement's
  no-reload convergence was not re-exercised. Previously accepted signed
  journeys are not replay prerequisites.
- [ ] **B3 — Beta defect work.** Fix evidence-backed defects in focused PRs; do not mix protocol redesign into UX fixes.
  November 16: the auction receipt handler performed one indexed read, then
  Sold stopped ordinary polling while ownership/history could remain stale.
  The [released correction](../audits/B17_REMINDERS_ACCEPTANCE_RECHECK_2026-11-16.md#released-receipt-refresh-correction)
  shares seven serial visible-only refresh attempts across auction/resale, waits
  separately for matching indexed history, cancels replaced receipt/account
  work and unmount, and exposes explicit Retry after the bounded window. The
  history-only Retry target and duplicate-event gaps found in review are fixed.
  Independent review, 101 focused checks and the local build pass. PR #497 merged
  as `f02595bf888fc9baa44e4ca9cd4057d93686fd19`; hosted run `43926281894`
  passed Linux, Windows, static and contract checks. Production is READY and its
  apex bundle matched the local build at `2026-11-16T18:16:51.793Z`. Reloaded
  artwork 14 shows the indexed First Collector/current owner, seven history
  events including the exact settlement and no updating notice. A new
  transaction's no-reload convergence remains unobserved; no completed
  transaction is replayed.
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
  showed a live Keeef card. This closes B11's original default-to-re-auction
  gate; in-place modal closure was not observed and is not claimed. Remaining
  signed assistant scenarios stay open; no successful transaction is replayed.
  PR #479 released the native new-auction dialog correction. Assistant withdrawal
  is accepted on artwork 38: `0.0609875 ETH`, block `56622288`, zero pending
  credit afterward, cleared command without reload. PR #480 released the
  separate Gallery initialization correction with passive selected-provider
  preparation and race checks. Linux/Windows/static CI passed and production
  is READY; the actual Gallery zero-funds command returned "There is nothing
  to withdraw." without a wallet prompt or transaction. Evidence is in the
  [readiness audit](../audits/B11_GALLERY_WALLET_READINESS_2026-11-09.md).
  Assistant creation of artwork 14's auction 75 is accepted: `0.001 ETH`,
  24 hours, block `56631239` at `2026-11-09T18:15:16Z`, verified on both RPCs.
  Without reload, the live auction appeared and the assistant cleared its
  input, disabled Send and showed the next-action prompt plus artwork/tx links.
  The same audit records PR #481's READY exact-merge deployment and green merge
  CI, preserving the separate earlier PR-run aggregate failure limitation.
  Assistant initial listing of artwork 38/token 7 is also accepted at
  `0.001 ETH`, block `56633575` at `2026-11-09T18:23:03Z`, verified on both RPCs.
  Without reload, the sale price and Change price / Remove from sale actions
  appeared, and the assistant cleared its input and showed completion links.
  Assistant purchase of artwork 38/token 7 succeeded at block `56637436` for
  `0.001 ETH`; Buy retired and the command cleared without reload, but ownership
  and provenance remained stale. The same audit records the bounded receipt
  reconciliation correction, released in PR #482. Its later complete resale UI
  acceptance is recorded in the [November 16 Music 2 follow-up](../audits/B12_RESALE_UI_ACCEPTANCE_2026-11-16.md):
  owner, action and the exact tenth provenance event updated without reload.
  This accepted resale does not substitute for a new primary-settlement
  convergence observation after PR #497.
  Assistant bid for artwork 14 / auction 75 is accepted without reload:
  `0.001 ETH` bid, `0.01 ETH` deposit, block `56674116` at
  `2026-11-09T20:38:12Z`, successful on both RPCs. Transaction:
  `0x0d92db6bc67f8e726bd87398094d944a6004b0da01f5c5c4f31942c2e285e3e1`.
  The page showed the exact current bid and one correct-bidder activity entry,
  disabled the bid input and explained that this wallet is already highest;
  the assistant cleared the command and showed success follow-ups. The artwork
  remains unminted with floor zero. Evidence is retained in
  `docs/private/b12-assistant-bid14-receipt-2026-11-09.json`.
  November 16 closes the complete resale UI outcome: Music 2/artwork 32/token 5,
  block `59568267`, `0.0001 ETH`, changed owner to lys, retired Buy, added the
  exact tenth provenance event and cleared the assistant without reload.
  [The acceptance record](../audits/B12_RESALE_UI_ACCEPTANCE_2026-11-16.md) keeps
  unobserved initial-stale/retry timing separate from controlled delay tests.
  Completed bid, purchase,
  repricing/removal, withdrawal, auction creation and initial listing must not
  become replay gates.
  The [network picker follow-up](../audits/B18_NETWORK_PICKER_2026-11-09.md)
  aligns logo/label spacing, adds searchable configured EVM browsing networks,
  retains the Base Sepolia write boundary and renames the public AI panel.
  PR #482 also removes Monad/Abstract from wallet and external NFT/token
  selection, adds neutral backgrounds behind dark network marks and restores
  the square 28px guest avatar. Exact-head CI `42681754394` passed Linux,
  Windows and static checks; merge `dfc9f82a36405726bb42ba5b06c6133aa1927d8e`
  is READY in production deployment `dpl_ArKDP1GHY96YmMt57EBEfgrV7tT4`.
  The November 9 [native wallet acceptance](../audits/B18_WALLET_STATE_FRESHNESS_2026-11-09.md#native-production-acceptance)
  passed Phantom connection, Disconnect, reload remaining guest and Rabby
  connection. On November 16 the owner reported satisfactory iPhone layout
  overall, but a first-attempt profile authentication error after a MetaMask
  confirmation; retry succeeded. The [mobile follow-up](../audits/B18_MOBILE_PROFILE_AUTH_2026-11-16.md)
  keeps that incident and separately unconfirmed voice behavior open. No completed
  wallet transaction is repeated for this release.
  The November 16 [recorded voice release](../audits/B18_RECORDED_VOICE_PROTOTYPE_2026-11-16.md)
  shipped in PR #496, merge `2ddb7e0fff32af918b6f7ef45dda35d4cb938f0d`.
  CI `43921630762` passed Linux, Windows, static and contract checks; production
  is READY. The apex `v14` script and all 18 audio hashes were verified at
  17:50:25 UTC. Chrome manual playback changed Listen to Stop and back without
  an error. After an initially silent physical-iPhone report, the owner confirmed
  sound from the direct WAV and the assistant's Russian help reply on November 16,
  with the playback button changing on press. No code changed between attempts;
  the first failure's cause remains unknown in the linked audit. This accepts
  the fixed help reply, not every dynamic native-voice response or full Phase B.
  The November 18 [local dialogue walkthrough](../audits/VOICE_ASSISTANT_HANDOFF_2026-11-18.md#navigation-and-spoken-follow-ups)
  verifies NFT clarification and same-tab navigation with a simulated microphone.
  This expanded flow still needs physical-device acceptance.
  Replays make no model request. API credits remain reserved for development; live
  conversation and user-supplied keys are optional assessments, not new Phase B
  exit gates. No paid public voice endpoint is active.
  After PR #491, the owner repeatedly reproduced `AUTH_UNAVAILABLE` when
  returning before MetaMask finishes; waiting in MetaMask succeeds. The
  [early-return investigation](../audits/B18_EARLY_WALLET_RETURN_2026-11-16.md)
  separates this unresolved operation failure from the confirmed delayed-wallet
  handoff and incorrect HTTP 401 fallback defects. After PR #492, the owner
  confirmed the iPhone editor opened on the early-return test. Authentication
  acceptance is recorded. The owner identified the remaining window as the
  browser's native app-opening confirmation. The follow-up removes timed
  navigation and keeps the existing explicit Open Wallet action. It does not
  bypass browser confirmation or repeat accepted signatures.
  The November 16 [card network placement correction](../audits/B18_CARD_NETWORK_TITLE_2026-11-16.md)
  moves network identity beside the title across DOM/React cards and wallet NFT inventories.
  Focused tests, build and local desktop/320/375 px layout checks pass; this does not close remaining B18 device/voice gates.
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

Public-beta acceptance requires a stable real cohort, processed feedback, moderation evidence, snapshot tooling and mainnet-preparation inputs. The November 18 transition carries the unobserved public-cohort acceptance into C13. Actual Snapshot A capture remains a late-C gate.

## Phase C — Mainnet Preparation

Local engineering is active as of November 18. Deployment, custody changes and mainnet activation retain their own decisions.

Goal: audited, product-grade contracts and production operations.

The October 3 founder amendment moves the previously deferred passkey/recovery
ceremony back into current A8 activation. Final mainnet custody and configuration
still require C0/C8/C13 acceptance; testnet credentials are not mainnet custody.

- [ ] **C0 — Founder inputs.** Provide ProtocolTreasury and EcosystemTreasury Safe addresses (plus Base Sepolia rehearsal Safes), project domain, and required contract-design answers. These inputs are resource-gated as detailed in `docs/RESOURCE_GATED_WORK.md`: they do not block zero-incremental-spend Phase A engineering, but they remain mandatory before their activation and mainnet gates. Legal entity type and jurisdiction remain founder/counsel decisions; the roadmap must not assume a specific form such as a Polish `sp. z o.o.`.
  **Mainnet Safe addresses and signer rotation complete, November 19.** The two treasury accounts and the entry-pause account each require two of the three intended owners. All three current addresses signed executed transactions during the rotation. The [custody procedure](../RESOURCE_GATED_WORK.md#signing-devices-and-the-completed-recovery-rehearsal) covers the private register and receipts. Backup recovery, the release rehearsal and the eventual Core bindings retain their own acceptance steps.
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
  November 16: [minimal replacement boundaries](../architecture/C1_REPLACEMENT_BOUNDARIES_2026-11-16.md)
  propose immutable engine/NFT pairs, deployment-scoped identity, settlement-bound
  minting, isolated liabilities and bounded refunds. Existing source hashes match
  the characterization baseline. That proposal left topology, retirement authority,
  pause/deadline, rounding, treasuries and governance open.
  The [executable accounting model](../audits/C1_EXECUTABLE_ACCOUNTING_MODEL_2026-11-16.md)
  checks 1,024 abstract states and 28,672 transitions plus replays for scoped
  issuance, full refunds, failed-payment credits and per-deployment solvency.
  On November 18 the seven-test model added exact native-ETH winner funding
  before issuance. Four focused prototype EVM tests passed, including three
  simultaneous auctions at the deposit boundary. The recorded credit from one
  purchase and the locked deposit on another remain independent. Replacement
  bytecode and deadline rules were still open at that checkpoint.
  November 19: the [ordinary-artwork design](../architecture/C1_REPLACEMENT_BOUNDARIES_2026-11-16.md#ordinary-artworks-after-mainnet-launch)
  selects permanently paired Core and NFT contracts. Future mainnet upgrades preserve existing tokens, their history and their claims in the issuing deployment.
  The [entry pause](../architecture/C1_REPLACEMENT_BOUNDARIES_2026-11-16.md#selected-entry-pause-and-payment-window) blocks new exposure and keeps existing obligations payable. Anyone can close an expired auction. A funded winner gets 24 hours from the closing block, including the last second. The local compiler [storage and immutable record](../architecture/C1_REPLACEMENT_STORAGE_2026-11-19.json) covers the fresh candidate. [Payout rounding](14_PROTOCOL_REVENUE_AND_TEAM.md#whole-wei-payouts-on-the-new-ordinary-market) is approved. The Admin Security Safe and the 48-hour external admission delay are selected. Refund execution limits, final treasury binding and independent review remain open.
- [x] **C2 — Core rework.** Implement the frozen economics, deterministic lazy/creator/keeper finalization, default handling, and the Bible §3.1 refund obligations with bounded batches and withdrawable-credit fallback. No unbounded bidder loop.
  Accepted November 21 for the [ordinary-market implementation](../../contracts/replacement/OrdinaryMarket.sol). The [concrete-market test](../../test/TreasuryBoundOrdinaryArt.test.cjs) follows one bidder in two concurrent auctions. The bidder withdrew a refused 0.02 ETH refund exactly once while its 0.05 ETH winning deposit stayed locked in the second auction. After default, only that second deposit was split, 0.04 to its creator and 0.01 to the protocol. One sale minted one NFT, and the market held zero after withdrawals. The lifecycle, runner-up, keeper and refund tests below cover the other C2 criteria. Independent review belongs to C12, public rehearsal to C13, and production activation to D3.
  The new [ordinary Core](../../contracts/replacement/OrdinaryArtAuctions.sol) fixes the late-bid window and increment at ten minutes with a one-hour total cap. [Local EVM cases](../../test/OrdinaryArtAuctions.test.cjs) exercise the window boundary, cap and delayed close. The hosted C13 rehearsal still needs a late bid observed by a second participant.
  In local Chromium, the open artwork's single countdown changed from 28 seconds to 10 minutes 28 seconds on a confirmed deadline in a 390 px Future fixture. It also recovered when the tab became visible after the old deadline and the first indexer reply was stale. A 320 px Classic homepage card showed the extended deadline without horizontal overflow. Cards use the existing list refresh. Watching an individual auction uses the live artwork page. [Clock reconciliation tests](../../test/artwork-auction-reconciliation.test.cjs).
  The [local lifecycle specification](../audits/C1_EXECUTABLE_ACCOUNTING_MODEL_2026-11-16.md#november-18--closing-and-reopening-ordinary-auctions)
  covers creator relisting after no bids and a separate permissionless close. The [ordinary auction engine](../../contracts/replacement/OrdinaryArtAuctions.sol) implements both, exact winner payments, default and minting on settlement. [Outbid refunds](../../contracts/replacement/OutbidRefunds.sol) run in bounded batches with self-withdrawable credit on delivery failure. The concrete market binds three Safe roles at construction. A [local refund benchmark](../architecture/C1_REPLACEMENT_BOUNDARIES_2026-11-16.md) covers 1, 4, 8 and 16 recipients. Final network-specific refund settings and a fresh public rehearsal remain open.
  The candidate reports a bidless work available at the deadline from a read alone. Its next creator relist finalizes and reopens in one transaction. A ready winner may close and settle together. [Exact-boundary and transaction coverage](../../test/OrdinaryArtAuctions.test.cjs).
  After a funded default, the new engine grants the highest distinct losing bidder 24 hours from the default transaction to buy at their own price. Their refund remains available independently. Decline or expiry releases the work for the creator. The [runner-up tests](../../test/OrdinaryRunnerUp.test.cjs) cover pause, expiry, payment and rollback. The [reconciliation command](../../scripts/read-ordinary-runner-up.mjs) verifies the finalized deployment and offer. Its optional private database projection was exercised under C7. Public rehearsal, continuous observation, notification delivery and the keeper gas budget remain open.
  The [self-hosted keeper](../runbooks/ORDINARY_AUCTION_KEEPER.md) discovers funded deadlines from the new engine, skips empty auctions and checks current state before a zero-value lifecycle call. The [local EVM rehearsal](../../test/OrdinaryAuctionKeeper.test.cjs) covers late bids, payment races, pause, default and expiry. Testnet activation needs a fresh engine, a dedicated test gas account and operating limits. Mainnet signing remains disabled.
  Locally verified on the client: open cards retire the bidding timer at expiry. The artwork page refreshes its available actions at that boundary. A separate payment timer requires a recorded settlement deadline and stops at that deadline. [Detail boundary tests](../../test/artwork-presentation.test.cjs) and [card clock tests](../../test/live-auction-card-countdown.test.cjs).
- [x] **C3 — ArtworkNFT rework.** Implement the canonical 5.5% royalty, marketplace whitelist, provenance, and migration-safe interfaces.
  Accepted November 21 for the ordinary-artwork contract implementation. The [NFT tests](../../test/SettledArtworkNFT.test.cjs) check a paid token 1 linked to work 2 before and after transfer. The [migration report](../security/MIGRATION_RUNBOOK.md#verify-the-token-seen-by-wallets) rejects a missing or contradictory reverse lookup. Two local issuers with overlapping IDs kept their own First Collector, metadata and 5.5% royalty recipient when the original token moved. The independent contract review remains in C12, the public rehearsal in C13 and the data migration in D2.
  The local [paired NFT](../../contracts/replacement/SettledArtworkNFT.sol) records the creator and first collector at settlement and enforces approved marketplace operators. [Secondary sales](../../contracts/replacement/OrdinaryArtResales.sol) bind purchases to a listing version, ownership history and uninterrupted seller approval. Fresh deployment and migration evidence remain open.
  The [token verification command](../../scripts/check-ordinary-token.mjs) checks the standard NFT interfaces, current owner, original creator, first collector, metadata URI and 5.5% creator royalty at one finalized block. Supply a reviewed metadata SHA-256 to check the published bytes too. An isolated EVM rehearsal checked absence before mint and provenance after a transfer. Rendering in external wallets still requires a published token on the new deployment.
  The founder selected [future external sales with a common syndicated ask](CONTRACT_REWORK_PLAN.md#same-asking-price-across-marketplaces). Verify external metadata display independently. A sellable OpenSea listing also needs venue support, seller authorization and verified order availability. The [external operator admission policy](CONTRACT_REWORK_PLAN.md#external-marketplace-admission) is implemented locally. External fee treatment, compatibility and live sale acceptance remain open.
  All three signer pairs exercised the [official Safe 1.4.1 implementation on a local chain](../testnet/RG05_SAFE_MULTISIG_REHEARSAL_2026-08-16.md#7-local-follow-up-for-delayed-marketplace-admission-2026-11-19-utc). The test rejected a single signature and early activation, and confirmed cancellation, activation at the deadline and immediate disabling.
- [ ] **C4 — ArtSoulGenesis.** Build the dedicated soulbound contract and audited grant path. The numeric grant cadence is tunable operational policy, not canon or an immutable roadmap value. Grants require published categories, durable grant records, an audit log, and multisig-authorized administration.
  The [dedicated contract and grant rehearsal](CONTRACT_REWORK_PLAN.md#separate-genesis-grant-pilot) cover mainnet chain identity, non-transferability, unique serials and decisions, bounded grants, and two signatures on an official Safe in an isolated EVM. The [public Guide](https://artsoulprotocol.com/docs-protocol#genesis-grants) explains the four approved categories, founder and team reserves, and separate mainnet pilot. Profile help and search link directly to it. The [Genesis media preflight](../../scripts/check-genesis-metadata.mjs) compares each pilot serial's reviewed metadata, poster and animation. Specific eligibility evidence for each grant, real media, independent review and pilot remain outstanding.
- [ ] **C5 — Partner Collections.** Implement the canonical first-auction, floor, attempt, cooldown, and buy-now behavior without creating separate floor economics.
  The [collection launch plan](CONTRACT_REWORK_PLAN.md#collection-launches-on-artsoul) opens the first-work and editions formats to all authors. First-work settlement and editions clearing each have a local contract rehearsal. The [first-work template](../../contracts/launch/PartnerFirstWorkLaunch.sol) limits a launch to three attempts, preserves the public sale window on late settlement and opens reapplication after 30 days. [Local EVM coverage](../../test/launch/PartnerFirstWorkLaunch.test.cjs) verifies the settled price and payer. New first-work drafts select this template and preview the attempt and pricing rules. Older drafts preserve their stored format. Marketplace policy and a published collection with indexed provenance still need acceptance.
  The [auction of mint reservations](CONTRACT_REWORK_PLAN.md#auction-of-mint-reservations) has a draft with disclosed prices and a local [escrow rehearsal](../../test/MintReservationEscrow.test.cjs) covering funded bids, reserved inventory, one resale, redemption, expiry and separate refunds. The pilot applies the 2.5% rate to retained creator proceeds and credits the full place resale price to its seller. Public sales still require objective failure evidence, event indexing, independent review and testnet acceptance. Free allowlist membership and origin verification remain independent of paid reservations.
  The builder previews the exact metadata URI for token 1 on entry and review. Local Chromium covered 375-pixel Classic and 1440-pixel Future layouts. The [draft preflight](../../scripts/check-collection-metadata.mjs) fetches the named JSON with a byte limit, validates the display name and media URLs and compares the received bytes with a previously recorded digest. [Preflight tests](../../test/collection-metadata-preflight.test.mjs). The actual collection and its deployed token URI still need release verification.
- [x] **C6 — Ecosystem Pool implementation.** Route the frozen 1% resale allocation and implement safe accounting. The trigger for pool-funded contests remains undecided until explicitly approved; no date, distribution count, or percentage is implied by this backlog.
  The [resale suite](../../test/OrdinaryArtResales.test.cjs) checks the pool's separate withdrawable share against the other three recipients. This accepts implementation and tested accounting. Production custody remains a D3 responsibility.
  The [Safe binding](../../contracts/replacement/TreasuryBoundOrdinaryArt.sol) fixes both recipients and a separate pause authority at construction. [Routing tests](../../test/TreasuryBoundOrdinaryArt.test.cjs) exercise proceeds and withdrawals. All three mainnet accounts were verified before binding. C13 still needs the complete new-contract rehearsal and D3 the final on-chain binding and custody handover.
  An isolated [Safe 1.4.1 rehearsal](../testnet/RG05_SAFE_MULTISIG_REHEARSAL_2026-08-16.md) covered a 1 ETH resale, the Ecosystem Safe's exact 0.01 ETH withdrawal and a two-owner allocation to a synthetic recipient. The Protocol Safe's separate claim was preserved.
- [ ] **C7 — Indexer and database rework.** Project the new contracts, lifecycle, grants, pool accounting, provenance, moderation, and migration evidence.
  A [private runner-up projection](../../src/indexer/ordinary-runner-up-intake.js) records the latest verified offer per deployment and auction. The reconciliation command writes only with `--persist`. Local PostgreSQL tests cover identical concurrent observations, stale or conflicting evidence, and auction IDs reused by different deployments. Hosted intake and notification delivery still need public rehearsal. [Operator instructions](../security/MIGRATION_RUNBOOK.md)
  The indexer can read a finalized receipt for the reviewed replacement pair and verify the [actual First Collector and price](../../src/indexer/ordinary-settlement.js) for both the original winner and a buyer accepting a runner-up offer. The [receipt intake](../../scripts/index-ordinary-settlement.mjs) stores the verified amount in wei and keys auctions by chain, Core address and auction ID. An isolated PostgreSQL 18.4 rehearsal persisted auction 1 for two different Cores, replayed concurrent receipts without duplicates and rejected conflicting evidence without a partial write. The [migration and intake](../security/MIGRATION_RUNBOOK.md) still need a deployed replacement pair and a finalized public testnet receipt.
  The [finalized resale reader](../../src/indexer/nft-deployment-proof.js) returns the seller, exact wei price and version from the reviewed pair at a specific block. An inactive quote and an RPC error are distinct. Recheck the current version and terms when a buyer proceeds. External order availability requires its own venue read.
  A November 19 isolated Hardhat HTTP rehearsal used chain ID 84532 with no fork. A real fixture settlement and approval produced an active listing at exactly 1 ETH in block 8, version 1. After cancellation, block 9 returned an inactive quote at version 2. Reading block 8 again returned the original seller, price and version. Public Base Sepolia still needs the release build and receipt.
  First mainnet creator support uses the existing Creator profile and copy-address action for a direct ETH transfer. C7 and C13 require no donation forwarder or per-artwork projection for that release. Preserve the existing Base Sepolia history. If demand justifies an artwork-linked release, rehearse a separate forwarder and verify a persisted event in the site history. The replacement candidate has already passed local pre-mint and post-mint payment and event parsing tests. [Support decision](SUPPORT_THE_ARTIST_DESIGN.md) · [Local tests](../../test/OrdinaryArtDonations.test.cjs)
  [Public history tests](../../test/artwork-provenance-timeline.test.cjs) now cover issuer-chain scope, long sale histories, capped history pages and preserved owner/First Collector identity.
  The current [artwork and auction APIs](../../test/public-auction-eth-precision.test.cjs) and [donation history](../../test/donation-api.test.mjs) read wei as decimal strings before JavaScript parses the database response. Tests cover a one-wei difference above the safe integer range.
  Standalone and production scanners reject an existing cursor belonging to a different Core. A fresh database includes the configured deployment block on its first scan and resumes from its saved cursor. The [PostgreSQL regression](../../test/indexer-reorg-atomicity.test.cjs) covers a registration in that first block. Simultaneous same-chain deployments and replacement-event projections remain open.
- [ ] **C8 — Admin and eligibility controls.** Build least-privilege roles, multisig gates, grant records, audit logs, and private anti-abuse operations without publishing hidden scoring.
- [ ] **C9 — Auras and badges.** Implement the canonical aura priority on cards and artwork pages plus separate Genesis and Top-100k profile status, with responsive Classic/Future behavior.
  Prototype mints and legacy profile flags cannot add a Genesis bonus to the current profile or indexer's discovery calculation. A [regression test](../../test/profile-testnet-boundary.test.mjs) compares the same activity with and without those flags on both test networks. A real Genesis status still requires evidence from the dedicated mainnet deployment.
  For Platform, the local [artwork projection](../../src/api/platform-artwork-aura.js) requires a verified minted NFT and its original confirmed registration from the explicitly designated Base Sepolia Core and publisher. The shared cards and artwork detail consume the same frame status. The publisher designation still awaits an actual project decision. [Projection tests](../../test/public-nft-ownership.test.mjs) and [shared frame](../../src/ui/components/aura-frame.js).
  Collection origin verification follows a separate manual review. A [local registry](../../sql/migrations/20261119150000_collection_origin_reviews.sql) records revisions and revocations for the chain, collection contract and named creator. The [Guide](../../src/content/protocol-docs.js) illustrates the blue check. Live reviewer authorization, collection publication, the public cover's projection and a real reviewed decision remain open. [PostgreSQL coverage](../../test/fixtures/collection-origin-reviews.sql).
  Genesis needs a verified grant from its dedicated Base mainnet deployment and a verified link to the artwork. Partner needs approved partner status and indexed collection membership. The [server resolver](../../src/api/verified-artwork-aura.js) checks priority, finality and mint identity. Real local receipts exercised both new kinds. Only the existing Platform input is wired into the deployed projection. The dedicated grant and Partner membership indexes, independent Top-100k profile eligibility and an admin toggle for Future running border text remain open.
- [ ] **C10 — Promoted banners.** Consolidation is complete in [Bible §6.1](ARTSOUL_CANON_BIBLE_FULL.md#61-promoted-homepage-banners). Implementation awaits a decision on the reserve policy. Preserve organic discovery, Trust, floor and settlement.
- [x] **C11 — Test and invariant suites.** Cover economics, refunds, finalization, failed recipients, reentrancy, idempotency, roles, upgrade/storage layout, and migration.
  The [concrete-market regression](../../test/TreasuryBoundOrdinaryArt.test.cjs) conserves a queued refund, unpaid credits and both artist shares when a creator reacquires and resells their NFT. Local EVM traces verify that the lock covers outbound calls during settlement, resale, refund and withdrawal. All credits can be paid during the entry pause. The final balance is zero. The same suite exercises separate issuing pairs with overlapping local IDs and independent old claims. [Compiler layout tests](../../test/replacement-storage-baseline.test.cjs) check the immutable roles and storage slots. [Settlement intake](../security/MIGRATION_RUNBOOK.md#ordinary-settlement-intake) covers replay and rollback in PostgreSQL. The contract command passed 131 EVM tests plus four dedicated Genesis cases. Independent audit (C12), public-chain rehearsal (C13) and the production migration (D2) retain separate acceptance.
  Ten [model tests](../audits/C1_EXECUTABLE_ACCOUNTING_MODEL_2026-11-16.md) cover settlement funding, refund obligations, ordinary relisting after no bids and runner-up settlement. Six focused settlement tests on the local prototype EVM cover funding and exact auction and payment deadlines. The [replacement tests](../../test/OrdinaryArtAuctions.test.cjs) exercise payment at the deadline, default one second later, rollback on refused NFT delivery, independent deployments and equal closing gas for one and sixteen accepted bids.
  The [returning-bidder acceptance case](../audits/C1_EXECUTABLE_ACCOUNTING_MODEL_2026-11-16.md#november-19--losing-deposits-when-an-earlier-bidder-wins) follows four accepted bids through sale and default. The primary Solidity suite covers a returning winner who previously lost a bid, a rejected refund, partial processing and default. The [resale suite](../../test/OrdinaryArtResales.test.cjs) exercises the original mint, subsequent sale and all four credits. Independent review remains open.
- [ ] **C12 — Independent security review.** Resolve findings before deployment approval.
  The [review scope](CONTRACT_REWORK_PLAN.md#independent-review-scope-for-the-first-base-release) prices the Core and its NFT together and requests an optional incremental quote for artwork-linked support. The [review handoff](../security/C12_ORDINARY_AUDIT_HANDOFF.md) pins all 21 transitive sources, compiler settings, ABI and bytecode for the concrete pair. A separate local build reproduced both contracts from those sources. External review, finding resolution and final acceptance are outstanding.
- [ ] **C13 — Fresh Base Sepolia rehearsal.** Deploy the final topology, hand roles to rehearsal Safes, exercise pool operations and the full lifecycle, and prove recovery/runbooks. Run the deferred controlled artist/collector cohort with assigned support, issue triage and verified journey results. At eligible auctions, capture hosted extension, timely payment reminder acknowledgement and same-page settlement refresh as recorded in the [B handoff](../PHASE_B_STATUS_2026-11-02.md).
  A [local Safe bidder rehearsal](../architecture/C1_REPLACEMENT_BOUNDARIES_2026-11-16.md#november-20-ordinary-refund-measurements) measured exact refunds to 1, 4 and 8 distinct Safe proxies and verified that retrying a fully processed queue paid nobody twice. Public Base data fees and finalized testnet receipts still need a target-network run.
  The [fee command](../runbooks/ORDINARY_AUCTION_KEEPER.md#checking-a-finalized-fee) reproduced execution, L1 data and total network fees for three finalized prototype calls using two public Base Sepolia providers. Repeat it on the new Core's keeper and Safe refund transactions during C13.
  The [post-deployment verifier](../RESOURCE_GATED_WORK.md#verifying-a-deployed-account) compares the immutable refund batch size and per-transfer gas with the deployment review through both providers, and checks the required two-of-three threshold on each Safe. [Regression tests](../../test/treasury-safe-preflight.test.mjs) cover an inconsistent second reading, missing review values and legacy custody-only registers. Target-network gas measurements and the public deployment receipt are still required.
  The current prototype CLI pins the signer to Base Sepolia, checks the RPC before its first transaction and preloads all three artifacts. One signer manages the nonces for the entire run. A local chain rehearsal verified five consecutive transaction receipts, both Core bindings and the treasury. This covers the existing CLI only. [Boundary tests](../../test/prototype-deployment-target.test.mjs) and [local EVM rehearsal](../../test/ArtSoulV41.test.cjs).
  The [joint session checklist](../PHASE_B_STATUS_2026-11-02.md#next-joint-testnet-session) and [read-only candidate query](../../sql/verification/auction_windows.sql) cover the outstanding hosted observations. The current prototype has a finalizable round with a bid. Recheck the live window and the winner's availability at the session.
- [ ] **C14 — Legal and operational readiness.** Complete counsel-approved entity, ToS, Privacy/GDPR, IP assignment, domain/email, audit, and operating procedures. Exact legal form remains undecided until counsel/founder approval.
- [ ] **C15 — Final visual pass.** Apply premium homepage, cards, artwork, aura, accessibility, and responsive polish after functionality is stable.
  November 20 recording at 10:22: English site controls replace the browser-localized artwork media menu. Tested playback and sound on the actual artwork 7 MP4, including playback from zero, volume, replay, seeking, speed, fullscreen and picture in picture in Chromium. Its video stage and loading frame occupy the same bounds before and after the first frame. English product labels, replies and dates work with a Russian browser locale; names, artwork text and voice input preserve the visitor's chosen language. UTC collection schedules retain their time and precision across editing and reload. The physical iPhone playback controls still require device confirmation.
  November 20: the full auction status now shares the heading row in normal flow and wraps when necessary. [PR #500](https://github.com/maysonkiller/ArtSoul-Protocol/pull/500) resolved the overlap reported in PR #278. The deployed artwork view passed at 320, 390 and 1440 pixels. Both themes and enlarged text were also checked locally.
  November 19: the [auction opening summary](../../src/features/auction/auction-creation.js) shows the exact starting price in test ETH and the duration beside the wallet action on Publish and Create New Auction. The assistant's confirmation uses the same terms. Local Chromium exercised a price change from 0.00001 to 0.001 and a duration change from 24 to 48 hours in both themes, including a 320px phone. The wallet call used a stub.
  On the current prototype, the winner's page and confirmation show the payment remaining after the locked deposit. Built-route Chromium checks used a 0.001 test ETH bid and a 0.01 test ETH deposit at 390px in Classic and 1366px in Future. Both showed zero remaining payment and a separate gas charge. Cancelling returned control to the page. The [joint session](../PHASE_B_STATUS_2026-11-02.md#next-joint-testnet-session) covers the signed transaction and subsequent refresh.
- [ ] **C16 — Final public-testnet Snapshot A.** After the final contracts complete full public-testnet validation, capture the versioned machine-readable hashed export at a final cut-off announced at least two weeks ahead. Store and verify at least two independent durable copies before any Phase D reset or mainnet launch. It is a community record only and creates no Genesis, token, points, airdrop, or other entitlement. Earlier beta rehearsals do not count as this capture.
  The [synthetic PostgreSQL 17 rehearsal](../SNAPSHOT_A.md) includes the exact microsecond cut-off across all seven exported tables and verifies the archive offline.

Phase C exit: audit passed, fresh rehearsal green, treasuries/domain/legal ready, Snapshot A independently readable, and a signed launch decision recorded.

## Phase D — Staged Mainnet Launch

Goal: launch Base mainnet without a single-day Core-plus-Genesis big bang.

- [ ] **D1 — Preserve and re-verify Snapshot A.** Validate its manifest and independent copies immediately before the destructive reset.
  The [offline verifier kit](../SNAPSHOT_A.md#verifying-a-copy-years-later) verifies both downloaded copies against the trusted capture root and detects aliases and unlisted files. New exports validate the Base Sepolia chain and exact calendar cut-off before connecting. A disposable PostgreSQL rehearsal preserved the boundary to one microsecond. The independent-copy verifier also checks the announced cut-off to the microsecond. The final check compares the publication and cutoff times against the full 14-day notice period. The announcement, actual capture, independent storage providers and retrieval evidence are still required.
- [ ] **D2 — Execute Bible §16 migration.** Reset live product data, remove legacy addresses and networks, re-point the indexer, and prove zero stale product state.
  The prepublication database check also rejects a retained private runner-up observation for the reviewed Core. Registering the issuer before the first publication is valid. The [isolated database rehearsal](../../test/indexer-reorg-atomicity.test.cjs) checks both cases without altering the inspected records.
  The [launch presentation decision](ARTSOUL_CANON_BIBLE_FULL.md#16-pre-mainnet-migration-and-data-reset) keeps testnet works and activity out of the public mainnet catalog. Preserve the agreed testnet snapshot before retiring the old application data.
  Before the first real publication, run `node scripts/verify-mainnet-catalog.mjs <candidate-origin> <reviewed-mainnet-core-address> <deployment-block>` against the release candidate. The [check](../../scripts/verify-mainnet-catalog.mjs) requires the expected live indexer, an empty public catalog without a chain filter and zero mainnet activity. It has [local HTTP coverage](../../test/mainnet-catalog.test.mjs). Later real publications and sales belong in the feed. Its read-only database pass also detects stale rows omitted by the web API. Actual production database, browser and snapshot verification and the mainnet cutover remain open.
- [ ] **D3 — Deploy and open Core operations.** Deploy audited contracts to Base, hand roles to Safes, run smoke tests, and open writes only after the checklist passes.
  The [release verifier](../RESOURCE_GATED_WORK.md#verifying-a-deployed-account) supports a strict `--require-pair` check. Compare both reviewed runtime hashes, both directions of the Core/NFT binding and all three Safe roles on one common finalized block through two independent providers. [Regression coverage](../../test/treasury-safe-preflight.test.mjs) uses simulated providers. The public rehearsal and mainnet still require receipts and verification against actual release code.
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
