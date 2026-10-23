# ArtSoul Controlled Beta Entry

Last reviewed: 2026-10-24

Phase A engineering-readiness decision: **GO — accepted October 24, 2026.**

Beta-window Status: **NO-GO — not scheduled.** Before invitations, assign the
Phase B cohort, dates, operator, private support and pause responsibility and
complete the pre-window checklist for that window.

This is the operating source of truth for entering the invite-only ArtSoul
controlled beta. Engineering readiness closes Phase A; a specific test window
has its own operational decision. Cohort recruitment and continuing operations
belong to canonical B1/B2. This clarification does not waive any pre-window
requirement or open invitations. The Canon Bible and canonical backlog remain
authoritative; no architecture or economic rule is amended.

A8 operating/test evidence and the subsequent UI repair are accepted October 15
after PR #309 / #310, the owner's single-passkey confirmation and actual apex
artwork-tools verification. The owner subsequently accepted native iPhone
publication, X sharing, Donate/Report geometry, profile rendering, browser Back
and the branded publication wait. Do not repeat those ceremonies.
The October 24 native interruption/return and refresh with continuation to the
second transaction accept A-83, corroborated by artwork 37 / auction 71 through
two RPCs and the original immutable server preparation. No captured ethers
TIMEOUT or explicit Check publication use is claimed. A-23 is accepted by the
October 24 engineering decision below, after TA-13's actual release verification.
A-57's classifier repair is accepted on October 23 under
the owner's delegated engineering disposition and already recorded working
network-selection/publication outcomes. Robinhood/Base Sepolia compatibility
remains UNVERIFIED: neither successful support nor the cause of its historical
failure is established. This is an explicit beta compatibility limitation, not
a passed Robinhood device test. Additional
TA-10 exact-file protection is active on the website with 32 verified historical
identities and 13 passing real SIWE/HTTP checks. Works 1-4 remain explicit
unavailable-original exceptions; direct contract calls can bypass the website
guard. Guarded native publication is accepted by the evidence above. TA-12
desktop display repairs are owner-deferred. See [Phase A close-out](../PHASE_A_CLOSE_OUT.md) for scope and
evidence. The October 24 query returns zero open GitHub issues. Repository
follow-ups were reviewed separately, as recorded below; an empty tracker alone
is not acceptance. No invitations or beta window are opened by this review.

## 1. Scope and safety

The controlled beta validates the complete ArtSoul testnet lifecycle with a
small, trusted cohort:

1. publish an unminted artwork;
2. create an auction;
3. place a bid;
4. end the auction;
5. settle and lazily mint the NFT;
6. list and purchase the minted NFT on resale.

Only Base Sepolia (`84532`) is an active product testnet. Historical Ethereum
Sepolia records may remain readable, but writes and network selection are
disabled for them. Base mainnet and Ethereum mainnet may be present in wallet
negotiation for compatibility; they are not active product networks.

Testers must:

- use testnet ETH only;
- use a dedicated test wallet with no valuable mainnet assets;
- never share a seed phrase, private key, session topic, authenticated metrics
  credential, RPC URL containing a key, database URL, or service key;
- use only media they own or are authorized to publish;
- understand that testnet activity, NFTs, rankings, and snapshots have no
  financial value and create no Genesis or mainnet entitlement.

## 2. Entry checklist for testers

Use the detailed [tester guide](TESTER_GUIDE.md) during a test window. A tester
should complete and report one assigned journey rather than performing
uncoordinated transactions.

### Connection and recovery

- [ ] Open the production origin supplied in the invitation.
- [ ] Connect a supported wallet and confirm the displayed address.
- [ ] Complete the wallet signature when a protected action requests it.
- [ ] Confirm an unsupported network can be connected for browsing but that a
      write requires Base Sepolia.
- [ ] Refresh the page and confirm the live session restores without a second
      connection or a header flicker.
- [ ] Background the browser, return from the wallet, and confirm the same tab
      recovers.
- [ ] Disconnect and confirm the session does not reappear after reload.

### Protocol lifecycle

- [ ] Creator publishes an original test artwork.
- [ ] Creator starts a 24, 36, or 48 hour auction.
- [ ] A different wallet places a valid bid.
- [ ] The auction is ended after its deadline.
- [ ] The winning wallet settles within 24 hours.
- [ ] The NFT exists only after successful settlement.
- [ ] Creator, First Collector, Owner, and the indexed timeline are correct.
- [ ] Current owner lists the NFT at or above its canonical floor.
- [ ] A different wallet purchases the resale listing.
- [ ] Ownership and the indexed timeline update after resale.

### Read-only and failure behavior

- [ ] Legacy Ethereum Sepolia artwork remains readable with every write action
      disabled.
- [ ] A disconnected visitor can browse without repeated wallet prompts.
- [ ] A rejected signature or transaction returns the UI to a usable state.
- [ ] Navigation, refresh, back navigation, and mobile app switching do not
      duplicate transactions or lose confirmed state.
- [ ] Report any stale, contradictory, or mainnet-ready wording.

## 3. Support and issue intake

Use the following path during a controlled-beta window:

1. **Operational help:** reply in the private channel through which the tester
   received the invitation. The operator may move a reproducible defect to
   GitHub after removing personal or sensitive details.
2. **Reproducible product defect:** open a
   [controlled-beta bug report](https://github.com/maysonkiller/ArtSoul-Protocol/issues/new?template=controlled-beta-bug.yml).
3. **Security, privacy, copyright, or suspected credential exposure:** stop the
   affected flow and contact the operator privately through the invitation
   channel. Do not create a public issue or attach secrets.
4. **P1 incident:** stop the affected test journey immediately. The operator
   pauses the window until the issue is triaged and an explicit resume decision
   is recorded.

The public [community channel](https://t.me/ArtSoulCommunity) may be used for
general testnet discussion, but it is not the incident or security-reporting
channel.

## 4. Severity

| Priority | Meaning | Examples | Required response |
| --- | --- | --- | --- |
| P1 | Safety, authorization, economic truth, or core-lifecycle blocker | wrong-chain write, unauthorized action, incorrect ownership or money flow, stuck test funds with no recovery, reproducible inability to connect/publish/bid/settle in a supported environment | Stop the affected journey; no beta GO while open |
| P2 | Important defect with a safe workaround | one supported browser fails while another works, stale projection that recovers, degraded moderation workflow | Triage before the next window and record the workaround |
| P3 | Non-blocking polish or clarity problem | copy, spacing, minor visual inconsistency | Track for the relevant UI backlog item |

Priority is confirmed during triage; a reporter's initial choice is evidence,
not the final classification.

## 5. Known prototype deviations

The controlled beta validates behavior and usability of a public-testnet
prototype. It is not acceptance of these deviations for mainnet:

| Area | Deployed testnet prototype | Required before mainnet |
| --- | --- | --- |
| Resale split | 90% seller / 7.5% creator / 2.5% protocol; no Ecosystem Pool split | Frozen 92.5% / 5.5% / 1% / 1% split |
| NFT royalty | 7.5% | 5.5%, aligned with frozen resale economics |
| Marketplace approvals | Standard ERC-721 approvals | Restricted to approved marketplaces |
| Project NFT | Transferable 100-supply prototype | Retired; it is not Genesis and is never migrated |
| No-bid lifecycle | Automatic no-bid transition is not implemented | Permissionless, automation-compatible mainnet transition |
| Moderation step-up | Paired application authority, owner passkey setup/replacement, protected queue and complaint/notification journeys are accepted; remaining live edge cases are tracked separately | Retain both-wallet application setup/recovery policy and independent contract custody; complete remaining acceptance rather than replaying historical Safe-only application recovery |
| Domain and support email | Permanent apex is live. Project complaint mail delivery and receipt in artsoulprotocol@gmail.com are confirmed; this does not establish every general/security/copyright receive/reply and retention obligation | Verified monitored copyright/security contact and retention procedure before mainnet readiness |
| Historical chain | Ethereum Sepolia data can remain readable | No active writes, selection, or migration of testnet ownership into mainnet |

Frozen primary and resale economics are not changed by this document.

## 6. Operator pre-window checklist

Record evidence links or command output in the decision record; do not mark an
item complete from memory.

- [ ] Target production commit is recorded and all required GitHub checks are
      green on that commit.
- [ ] Vercel production serves the target commit.
- [ ] Phase A security and migration acceptance is complete.
- [ ] Supported desktop and external-mobile wallet acceptance is complete,
      including SIWE, restore, disconnect, wrong-network recovery, and no stale
      session resurrection.
- [ ] A real wallet-signed publish-to-index projection smoke is complete.
- [ ] Indexer health is healthy at confirmation depth 3 with zero unresolved,
      failed, and dead event-processing records.
- [ ] Projection and provenance state coverage is complete.
- [ ] Lifecycle action gating is complete.
- [ ] Moderation/reporting has an operationally safe controlled-beta path or
      the window remains NO-GO.
- [ ] Infrastructure cost evidence and alerting acceptance is complete.
- [ ] Base commitment surfaces and stale-copy cleanup required by Phase A are
      accepted.
- [ ] The bug intake form opens and the operator can triage new reports.
- [ ] Every open issue was reviewed and there is no open P1.
- [ ] The tester cohort, assigned journeys, start time, stop time, and private
      support channel are recorded.
- [ ] Pause and rollback responsibilities are assigned.

## 7. Pause conditions

Pause the controlled-beta window when any of the following occurs:

- an unauthorized or wrong-chain write is observed;
- ownership, settlement, floor, royalty, or fee evidence disagrees with indexed
  on-chain truth;
- a supported wallet repeatedly cannot authenticate or recover its session;
- the indexer is unhealthy, loses leadership safety, or reports unresolved
  event failures;
- private data or a credential may have been exposed;
- a new P1 issue is opened;
- the operator cannot monitor or support the active window.

Pausing does not require a destructive database or contract action. Disable the
invitation window, communicate the stop to testers, preserve evidence, and use
the relevant runbook for the affected service.

## 8. Go / no-go decision record

### October 24 engineering-readiness decision — GO

- Recorded at 2026-10-23T23:01:49.862Z (October 24 in Warsaw), under the owner's existing
  direction to complete Phase A. Scope: readiness to enter Phase B planning,
  not a mainnet launch or an active invitation window.
- Released code: `b0d722b11119e17c81adec6e0dee457b6f75c823`, PR #334.
  Production deployment: `dpl_2YQ5eFmFs4FSNAFXhBXZ7dRAUKYV`.
  Nine apex upload assets match the tested build; all eight media configuration
  entries are unchanged. Local baseline: 2252 passed, zero failed/skipped
  (includes preserved untracked local authority tests); 46 contract tests pass.
  Clean candidate CI [40036245476](https://github.com/maysonkiller/ArtSoul-Protocol/actions/runs/40036245476)
  and merge CI [40036657013](https://github.com/maysonkiller/ArtSoul-Protocol/actions/runs/40036657013)
  both pass: Linux 2221 / Windows 1957 unit checks, zero failures, 2 / 18 skips;
  46 contract tests on each OS, build and static checks green.
- Current health at 2026-10-23T22:52:28Z: Base Sepolia, depth 3, synced,
  8 blocks behind, zero unresolved errors and zero rolling RPC errors. This is
  an observed healthy state; ongoing monitoring remains an operator duty.
- Evidence mapping (retain original dates and limits):

| Gate | Acceptance basis |
| --- | --- |
| A1 | Existing security/RLS/credential acceptance in canonical A1; October 24 private schema/grants and actual authenticated/denied media HTTP checks in the checkpoint |
| A2 / A3 | Completed real desktop/iPhone wallet, restore, logout, switching and OAuth evidence in RG-01/device sheet; production debug cleanup accepted; Android waived / not tested |
| A4 | Exact released build, local tests and clean Linux/Windows CI above |
| A5 / A6 | Accepted projection/provenance and reorg behavior; 37 real worker/PostgreSQL checks, native 37/71 convergence and current health |
| A7 | Existing lifecycle/action matrix, real settlement/resales, native re-auction 28/68 and publication 36/70 and 37/71; A-83 interruption outcome plus timeout/no-replay regressions |
| A8 | [October 11/15 moderation acceptance](../audits/PHASE_A_MODERATION_ACCEPTANCE_2026-10-11.md): real reports, decisions, notifications, project-mail receipt, paired recovery and device factors |
| A9 | Accepted no-cost monitoring/alerting controls and [October 23 host maintenance](../audits/HOST_SECURITY_2026-10-23.md); ongoing monitoring is not silently discontinued |
| A10 | This decision, tester checklist/guide, support path, issue form, prototype deviations and pause criteria |
| A11 / A12 | Previously accepted Base commitments, cached metrics and active-network copy; no conflicting lifecycle/economic change in this release |

- Open-defect triage: zero open GitHub issues at this review, plus a separate
  durable-backlog review. TA-02/TA-06 were stale acceptance statuses and are now
  reconciled to actual prior OAuth/re-auction evidence. TA-13 is released and
  verified; its original uncaptured phone exception is not claimed diagnosed.
  B-10's creator-buyback Owner display now passes actual Chrome plus two RPCs.
  No open P1 is identified by the evidence reviewed.
- Explicit remaining scope: owner-deferred TA-12 desktop loading/flicker/timer
  polish (P3); B-11's page-driven default-close/re-auction acceptance (P2 until
  exercised, not a demonstrated current blocker). Current artwork 14 correctly
  hides payment and offers Close Expired Settlement; no default transaction was
  performed here. Existing B-12 agent/native acceptance also stays open.
  Robinhood/Base Sepolia remains unverified; Android is not claimed tested.
  The website's exact-byte duplicate guard excludes unavailable legacy originals
  1-4 and cannot enforce direct contract calls or detect re-encoding. Mainnet
  contract/custody/economic deviations in section 5 remain Phase C work.
- Evidence: `output/audit/preparation-feedback-{focused,unit,contracts,build}-2026-10-24.log`,
  both `preparation-feedback-ci-full-*-2026-10-24.log` files,
  `media-release-b0d722b-2026-10-24.json`,
  `publication-apex-b0d722b-2026-10-24.json`,
  `phase-a-final-health-2026-10-24.json`, `phase-a-open-issues-2026-10-24.json`
  and the native 37/71 evidence linked in the checkpoint. No secrets are included.
- Window decision: NOT SCHEDULED / NO-GO. Operator, cohort, dates and private
  support/pause coverage have not been assigned for a new window. Do not mark
  those boxes checked, send invitations or infer a mainnet/reset authorization.

### October 11 preparation record — NO-GO (historical)

- Production main: `c7dcef6a511046ed94a406377b6093f8851b30f7` (PR #296),
  deployment 6993341447. Candidate `38c9e71` passed Linux/Windows/static CI;
  production matched all 53 checked assets on six pages. [Acceptance](../audits/PHASE_A_MODERATION_ACCEPTANCE_2026-10-11.md).
- At 09:10 UTC the GitHub open-issue query returned zero. This is issue-tracker
  evidence, not acceptance of all backlog rows. The indexer was healthy with zero
  observed lag. No new payment or report was submitted during the independent
  continuation; all rehearsal restrictions remain restored.
- Independent verification is saved: 67 scoped moderation checks with real
  isolated PostgreSQL and nine real deployed HTTP boundary checks; current
  production RPC/table privacy checks passed. Remaining live moderator cases
  require the owner's native factor. Phone/OAuth outcomes remain separate.
- Operator, cohort, window start/end, support availability and pause ownership:
  **not assigned for a beta window**. The owner is away and asked to stop after
  independent work. No invitations or background acceptance run are authorized
  by this record. Return to the remaining checklist when the owner is available.

Copy this section for each proposed window:

```text
Decision: GO / NO-GO
Decision timestamp (UTC):
Production commit:
Vercel deployment:
Operator:
Tester cohort:
Window start/end (UTC):
Phase A evidence:
Open P1 query/result:
Known P2 issues and workarounds:
Monitoring evidence:
Support channel confirmed:
Rollback/pause owner:
Decision notes:
```

A beta-window GO is permitted only when every operator checklist item is evidenced and no P1
issue is open. Any missing evidence means NO-GO.
