# October 11 moderation and artist-support acceptance

Workspace: `C:\Projects\ArtSoul`, branch `codex/takeover-audit`.
Published roster: [PR #295](https://github.com/maysonkiller/ArtSoul-Protocol/pull/295),
main `2ba480bed7328ff01ce43995e1f107f6f0e93399`.
Candidate Linux, Windows and static CI passed (run 38124785727); the apex matched
53 checked assets on six pages. No contract, economics or mainnet change.

## Real acceptance completed

- Paired owner setup, replacement and native passkey entry were observed on
  October 8. October 11 actual expiry/reverification and protected queue access
  were observed; real guest/nonstaff SIWE denials passed. Old-factor version
  rejection is integration evidence, not replay of an old production cookie.
- The private team roster is published and observed in the owner's browser.
  Both current authorities retain joint management after staff-role removal;
  actual isolated PostgreSQL/signature regressions passed 37 checks. The live
  authority pair was not rotated or stripped of roles for this test.
- Report is enabled with the approved five-new-reports/24-hour limit. One
  technical report was submitted through the actual artwork form; another old
  test wallet created an independent report. Exact duplicate submission returned
  the same reference. Submission itself did not hide the work.
- Both scheduled complaint mails were accepted once. The owner confirmed the
  first arrived in `artsoulprotocol@gmail.com`. The real profile shows the staff
  queue notice and the reporter's decision notifications.
- Owner Admin hid both test reports, resolved the first while the work stayed
  hidden, then resolved the second and restored visibility at 08:47:33 UTC.
  Immutable events, decision reasons and recipient rows agree. The author was
  also the second reporter, so the existing notification deduplication emitted
  one REPORT_RESOLVED notice for that wallet, not two notices for one decision.
- Real creator SIWE reads returned only its safe notification projection;
  mismatched-wallet requests returned 401. No complaint text leaked through it.
- Donate was enabled on the same source after both Base Sepolia RPCs agreed on
  the pinned existing deployment code. Configuration-only deployment:
  `dpl_5sxAyDwpgLtUofbjcadC4WGYezdm`, READY on the apex.
- Reused the October 7 message donation, transaction
  `0x91f63b0d5796ee1c2f7248113210851ee8d558623d6947e5fb21fa18354c0c17`, log 15.
  Its technical complaint deduplicated, reached Admin with the exact indexed
  message, hid only that text and restored it at 08:54:58 UTC. Public newest and
  amount lists, the top entry, both 1-wei payment rows and both RPC contract
  snapshots matched the baseline apart from the temporary text mask. The actual
  browser confirmed hide/restoration and Donate's full creator address.
- The donor's real SIWE inbox received DONATION_MESSAGE_HIDDEN and
  DONATION_MESSAGE_RESTORED; wrong-wallet reads were rejected. All three reports
  are resolved. Artwork 34 and its original message are visible. No payments,
  deployments, ownership changes or indexer replay were repeated.

Private operation evidence remains under `docs/private/`: dated moderation
snapshots at 08:46:38, 08:47:04 and 08:47:58; recipient/donor notification records;
`donation-message-acceptance-{before,hidden,restored}-2026-10-11*.json`; and the
activation journals. The first message verifier compared PostgreSQL Date objects
to saved ISO strings; serialization was corrected and the read-only recheck
passed. No external write was repeated to repair that verifier.

Screenshots: `output/audit/staff-roster-live-2026-10-11.png`,
`profile-report-notifications-2026-10-11.png`,
`moderation-partial-restore-2026-10-11.png`,
`donation-message-{hidden,restored}-live-2026-10-11.png`,
`donate-live-form-2026-10-11.png`.

## Hidden-artwork correction and release

A moderated artwork was incorrectly classified as not yet indexed. The public
API already supplied exact suppression metadata; the client discarded it.
The narrow client/page fix uses a neutral unavailable state, clears previous
artwork/auction content and stops indexer retries. Three failing reproductions
became 64 passing targeted checks. Build and the full 1,814-check application
suite passed with zero failures/skips. An initial sandboxed run could not access
local HTTP/Docker fixtures; the unrestricted local rerun supplied that evidence.
Compiled Chrome added 68 passing assertions across both themes at 1280/390/320px,
including 35 seconds without retries and recovery after restoration. PR #296
merged at 09:02:31 UTC as `c7dcef6a511046ed94a406377b6093f8851b30f7` after
Linux/Windows/static CI passed (run 38126729232). Production deployment 6993341447
succeeded. Both preview and apex matched all 53 checked assets across six pages.
Apex evidence: `output/audit/hidden-artwork-apex-artifact-2026-10-11.json`.
Report/Donate remain enabled, private API denials passed and the indexer was healthy. The actual production hidden-state recheck still needs
an owner-verified session; compiled-fixture evidence is not that live ceremony.

The owner's profile-email screenshot and a read-only server check confirm
email ownership verification at October 3, 06:56:12 UTC. No address/token was
disclosed. TA-10 social-link presentation and TA-11 email delivery are accepted;
separate cross-device OAuth return evidence is not implied.

## Remaining boundaries

### Owner-unavailable continuation, 09:10 UTC

The owner requested all independent work followed by a stop, with no further
device or signature participation in this session. No new report, payment,
role/factor change, deployment or feature-flag change was performed.

- The scoped moderation suite passed **67/67, zero skips**. The strengthened
  existing route-to-PostgreSQL test denies a valid review request when Admin is
  disabled and separately when its second-factor gate is disabled. It compares
  all report, visibility, audit and notification contents before/after. Pausing
  intake still permits existing reviews and recipient history. Existing tests
  also passed the sixth-report limit, shared artwork/message quota, concurrent
  stale decisions, prohibited reopen and atomic audit/notification rollback.
  Command: `node --test --test-concurrency=1 test/phase-a-moderation-journey.test.mjs test/protocol-admin-rpc-integration.test.cjs test/donation-moderation-rpc-integration.test.cjs test/protocol-admin-review.test.cjs test/artwork-report-intake.test.cjs test/donation-moderation-api.test.mjs`.
  Log: `output/audit/moderation-edges-2026-10-11.log`.
- Nine real HTTP checks covered the already-disabled preview and apex guest
  denials. The preview returned explicit disabled errors for intake/review and
  passkey routes; it uses the same public database as the apex. The three
  rehearsal reports, events, notifications, mail delivery and visibility hashes
  were unchanged. This proves that deployed disabled-preview requests preserve
  those records; it is not an authenticated production flag-toggle ceremony.
- Read-only production catalog checks matched **16 RPC bodies** to current
  migration sources and verified **13 protected tables** retain forced RLS and
  no anonymous/authenticated direct access. Runtime service-role direct staff
  writes remain denied. All three reports remain resolved, mail backlog is zero,
  and the Base Sepolia indexer reports healthy with zero observed lag.
  Private evidence: `phase-a-unattended-2026-10-11T09-10-07-529Z.json`.
  A preceding read-only checker used artwork_id on the message-visibility table;
  it failed without writes and was corrected to the transaction/log identity.
- GitHub returned no open issues at 09:10 UTC; candidate CI remains successful
  on `38c9e71` and main remains `c7dcef6`. Evidence:
  `output/audit/phase-a-unattended-github-2026-10-11.json`. An empty issue query
  does not close unaccepted backlog rows or certify that no latent defect exists.
- The previous full **1,814-check** application baseline and compiled **68-check**
  UI evidence remain applicable: this continuation changes tests/documentation,
  not application source. They were not rerun or relabeled as new results.
  No new canon mechanics or dependency was introduced.
- Close-out, backlog counts, beta-entry and issue-intake documentation checks
  passed **19/19**, zero skips. Updated the roadmap/device/beta instructions to
  stop presenting the superseded Phase C deferral or Safe-only application
  recovery as a current prerequisite. The approved policy itself is unchanged.

Direct SSH service inspection was unavailable with the installed key. No password
was requested and no key/access setting was changed. Current database delivery
evidence is valid; a fresh systemd-process observation is not claimed.

Exactly next owner-assisted step: renew the existing Admin passkey session, then
run the bounded remaining moderation cases and post-release hidden-state browser
check. Do not repeat paired reset, enrollment, funding, settlement or donations.
No follow-up or background test run is scheduled by this continuation.

This closes A-39's real access setup/replacement gate and the bounded Donate
activation journey. It does not declare all of A8 or Phase A complete. The A8
runbook additionally calls for production evidence of the sixth-report limit,
stale/concurrent decisions, prohibited reopen and flag-off preservation. Their
SQL/API regressions pass; they were not manufactured as live outcomes here.
No provider failure was injected into the operating mail worker.

Real Android and separately recorded OAuth outcomes remain distinct from the
owner's satisfactory iPhone report. Authenticator-app entry is not claimed by a
passkey ceremony. The controlled-beta GO record still needs its remaining gates,
reviewed P1 result, named operator/support/pause ownership and cohort/window.
No new economics or canon ambiguity was introduced by these tests or UI fix.
