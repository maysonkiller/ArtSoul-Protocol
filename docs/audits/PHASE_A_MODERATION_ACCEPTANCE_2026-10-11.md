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

## Found and corrected locally

A moderated artwork was incorrectly classified as not yet indexed. The public
API already supplied exact suppression metadata; the client discarded it.
The narrow client/page fix uses a neutral unavailable state, clears previous
artwork/auction content and stops indexer retries. Three failing reproductions
became 64 passing targeted checks. Build and the full 1,814-check application
suite passed with zero failures/skips. An initial sandboxed run could not access
local HTTP/Docker fixtures; the unrestricted local rerun supplied that evidence.
Publication and actual post-release UI verification are still pending.

## Remaining boundaries

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
