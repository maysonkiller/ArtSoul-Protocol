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

## Resumed owner session amendment

The owner subsequently excluded Android from this Phase A close-out and replaced
the 15-minute staff verification with a fixed 24-hour maximum. Android is
OWNER-WAIVED / NOT TESTED. No successful Android run is inferred. Canon 07's
October 11 amendment supersedes the earlier session-duration requirement.

The patch binds the signed HttpOnly session to a keyed digest of trusted client
IP and browser User-Agent; missing cookies or a changed context require another
factor verification. It preserves active-role, wallet, authorization-version and
factor-revocation checks. Both passkey and TOTP issuance use the request context.
Logout clears both wallet and staff cookies. Fifteen-minute setup permissions,
five-minute paired approvals and TOTP limits remain unchanged.

Regression evidence: 112 focused backend checks, 52 frontend/document checks,
and the full application suite's 1823 checks passed with zero skips. Build,
11 HTML route checks and 174 compiled style checks passed. Exact expiry, activity
after the old 15-minute limit, trusted-edge selection, spoofed forwarding headers,
IPv6 normalization, context changes, old/tampered cookies, unchanged setup TTL,
TOTP parity and logout are covered. Local files are under output/audit using the
staff-session and admin-session-copy-docs prefixes for October 11.

Interpretation: this is browser-session binding, not hardware attestation. A
copied cookie with the same IP and User-Agent cannot be distinguished. Mobile,
VPN or browser-context changes may prompt again. Simulated time is local test
evidence only; no chain clock or production time was changed. Deployment and
real-context acceptance are recorded separately when observed. The existing
passkey can be reverified after release; setup/reset is unnecessary.

Compiled local Chrome passed 68 assertions in Classic/Future at 1280/390/320px,
including the 24-hour copy, TOTP and both passkey dialog paths, and unchanged
15-minute setup expiry. No page errors or external requests occurred. HTTP,
wallet and WebAuthn are local doubles; this is UI evidence, not a native ceremony.
The initial fixture-only initialization error was corrected and its failed log
retained. Read-only Vercel project/domain/DNS checks confirm system environment
identification is enabled, the domain uses correctly configured A records, and
the API is served by Vercel. The CLI renewed an expired local token normally;
no hosting setting was changed. This supports trusted-edge selection but does
not replace an authenticated production test from another IP.

PR #297 merged as `ba61d5c94c661d1e68615bd8f7c4b95203146e99` at 20:28:13 UTC,
after exact-candidate Linux/Windows/static CI passed in run 38172119770.
Production deployment 7001332984 succeeded at 20:28:36 UTC. Preview and apex
matched all 53 checked assets on six pages. Real anonymous logout clears both
secure cookies; private APIs deny guests. Apex Report/queue/Donate stay enabled,
and the indexer is healthy with zero observed lag. The actual owner Admin tab
now requests normal passkey verification, as intended for the old session.
At that release checkpoint owner verification was pending. The later live block
below supersedes that pending status, not the changed-IP evidence boundary.
No contract, role, data or feature-flag change occurred during the release.

## Renewed live session and remaining complaint edges, 20:49–21:00 UTC

The owner confirmed the existing passkey. The real apex Admin showed active
access with the new 24-hour copy and served the protected queue. This is a native
verification, not a simulated WebAuthn result. No paired reset or enrollment was
repeated. All writes below were bounded technical tests against the project's
existing Base Sepolia artwork 34; their text explicitly alleges no misconduct.

| Scenario | Actual production result |
| --- | --- |
| Reopen a closed report while its reporter/category has a newer pending report | HTTP 409 `REPORT_ALREADY_PENDING`; no transition |
| Reopen an actioned report | HTTP 409 `REPORT_ACTION_NOT_ALLOWED`; no transition |
| Two simultaneous restores of the same report version | One HTTP 200, one 409 `REPORT_REVIEW_CONFLICT`; exactly one committed restoration |
| Hide with the pre-restoration report version | HTTP 409 `REPORT_REVIEW_CONFLICT`; artwork remains visible |
| Sixth new report from the old test creator inside 24 hours | HTTP 429 `REPORT_DAILY_LIMIT_REACHED`; no sixth row |
| Real hidden/restored artwork UI after PR #296 | Neutral unavailable state with no endless indexing spinner; original artwork and provenance return after restore |

The three new technical reports ended resolved/dismissed/dismissed. All three
earlier reports are unchanged. Six report mails have provider acceptance with
one attempt each; this records provider delivery status, not an invented inbox
receipt for the three new messages. The owner's earlier project inbox receipt
remains separately confirmed. The final ledger has 26 events versus 15 before
this block: exactly the expected intake, hide/restore, dismiss and notification
events. Artwork/donation record counts and content hashes are unchanged, and
the artwork is visible. No financial transaction, economy, role or flag changed.

Private evidence: `moderation-edges-{before,first-pending,first-hidden,first-restored,second-dismissed,third-dismissed,final}-2026-10-11.json`,
the `moderation-edge-intake-*`, `moderation-edge-reopen-*`,
`moderation-edge-restore-race-*` and `moderation-edge-stale-*` intent/results.
`node docs/private/verify-moderation-edges-2026-10-11.mjs` passed 26 saved-evidence
assertions; it makes no external writes. Completed operations must not replay.
Screenshots: `output/audit/staff-session-active-live-2026-10-11.png` and
`moderation-{hidden,restored}-live-2026-10-11.png`.

Two real UI defects were reproduced during these checks. A legitimate state
refusal incorrectly replaced the entire Admin with an unavailable screen, even
though the verified session was still valid. Separately, the mounted decision
dialog retained its reason after cancellation or success and inserted it into
the next report. The narrow patch treats the existing four state-conflict codes
as queue-refresh outcomes and mounts the dialog only while a decision is open.
Denied refresh and wallet/logout changes still clear protected data. It does
not change server authorization, report states, allowed actions or mail rules.

Before the patch, the focused unit reproduction failed twice and the compiled
browser reproduction showed the copied reason. After it: 51 focused checks,
1826 full application checks (zero skips), build and 65 compiled Chrome
assertions passed. The browser fixture covers both themes at 1280/390/320px,
fresh reasons after cancellation/success, all four recoverable refusals,
denied access and no horizontal overflow; it produced six screenshots, no page
errors and no external requests. Logs and JSON use
`output/audit/moderation-decision-*` for October 11. This proves the compiled
patch with local HTTP doubles; a subsequent release entry records live rollout.

These results supersede the earlier pending live rate-limit/concurrency/reopen
and hidden-state checks. Exact new 24-hour wall-clock expiry, another-IP native
entry, provider failure isolation and production flag-toggle evidence retain
their own limits; local tests or disabled preview are not relabeled as those
ceremonies. No new canon mechanics or interpretation was introduced: this is
the existing complaint/review UX under Bible §11 / canon 07.

## Decision UI release and native recheck, 21:08 UTC

PR #298 merged at 21:05:52 UTC as `a51c16ff907c1b192df989aec984d0c9a3b72fe7`.
Production deployment 7001780457 succeeded at 21:06:18 UTC. Exact candidate
`798e6f4ddda584b087da5a9fa238add9385800f5` passed Linux/Windows/static CI in run
38174677863; its tree equals tested commit d2d0a2c. The history reconciliation
preserved the patch and documentation rather than copying another worktree.
Preview and apex matched all 53 checked assets on six pages. Guest private
routes remained protected, feature flags stayed enabled and indexer lag was zero.

The actual owner browser retained its verified session across the release.
Cancelling a filled reason, then opening another report, produced an empty field
and disabled confirmation. After a successful decision and after an expected
refusal the next reason was also empty. A bounded saved plan reopened only the
third new technical report, attempted an older closed duplicate and dismissed
the reopened report. Real responses were 200/409 `REPORT_ALREADY_PENDING`/200;
the refusal left the protected queue available, without the previous unavailable
screen or another passkey prompt. This is real UI/API evidence, not a fixture.

The final read-only check passed: all six reports closed, exactly four additional
reopen/dismiss/notification events (30 total), exactly two corresponding recipient
notifications, and no change to other reports, visibility, delivery records,
artwork/donation hashes or the rolling intake count of five. No new report or
payment was created. Evidence: private `moderation-decision-live-*` plan,
before/after and response journals; public-output screenshots
`moderation-decision-{empty-reason,conflict,complete}-live-2026-10-11.png`.

The active passkey's last-use timestamp was 20:46:35 UTC. A protected queue
request at 21:03:17 UTC returned 200 after the previous 15-minute threshold;
the read-only timestamp check itself measured 981 elapsed seconds. No session
cookie or credential was exported. This confirms the old timeout no longer
interrupts this actual session; it does not claim observation of full 24-hour
wall-clock expiry or native verification on a different IP.

Release evidence: `output/audit/moderation-decision-ci-2026-10-11.json` and
`moderation-decision-{preview,apex}-artifact-2026-10-11.json`. No active child
agent or new unattended follow-up was left running. The owner has no pending
action for these completed complaint tests. Remaining RG-01 and beta-entry
evidence must be reconciled separately; this release does not declare Phase A
complete or reopen the owner's Android waiver.

Post-merge Linux/Windows/static CI passed in run 38174943182 for exact main
`a51c16f`; saved evidence is `moderation-decision-main-ci-2026-10-11.json`.
The documentation-only release follow-up passed 18 checks with zero skips.

## October 14 isolated email-failure continuation

The existing `test/phase-a-moderation-journey.test.mjs` now runs the unchanged
report-email worker and delivery migration against its disposable PostgreSQL 17
database and loopback HTTP sink. After a real local handler commits a hide
decision, the sink returns HTTP 503 or loses its response. Both cases retain the
complete report, visibility, event, audit and recipient-notification ledger.
The creator's actual notification route returns the same inbox before/after.
The delivery row records a pending, delayed retry; an immediate retry sends
nothing. Once due in this isolated database, the retry uses the identical
payload and provider key, records acceptance, and suppresses any further send.

These are initial staff alerts sourced from `REPORT_SUBMITTED`, deliberately
delayed until after review. They are not emails carrying moderation decisions;
recipient decision notifications remain durable in-app rows. The test advances
only a disposable delivery schedule, never protocol time or an operating worker.

Focused worker/adversarial/SQL/journey checks: 28 passed, zero failed/skipped.
Evidence: `output/audit/report-email-journey-2026-10-14.log`. Independent bounded
review found no actionable issue. No runtime/dependency/schema change, external
email or production operation occurred. This closes the combined automated
decision-to-worker failure-isolation coverage gap. It does not claim observation
of a real Resend outage, scheduled host recovery or another actual inbox message;
reuse the separately recorded live delivery evidence. The distinct 24-hour,
changed-context, flag and device evidence boundaries remain as recorded.

## October 14 acceptance reconciliation and open-view expiry repair

The rollout checklist requires notification-failure isolation and fail-closed
feature flags with evidence preservation. The real local handler/worker/SQL
journey above establishes those failure properties; the earlier actual mail
receipt establishes delivery. The existing flag-denial journey preserves the
complete ledger across all three flags, and the deployed disabled preview
separately proves route gating. These complementary checks satisfy those two
properties without intentionally disrupting the operating site or Resend.
No real provider outage or production flag toggle is claimed or newly required.

The owner's recorded iPhone entry already establishes a different browser/device
starting locked and requiring its own native factor verification. Do not repeat
that ceremony. Natural 24-hour expiry and an actual changed trusted-IP request
remain unobserved and separate from controlled-clock tests.

Investigation found a narrower real defect: the server rejected expired access,
but cached complaint data could remain in an idle open Admin. Four client
regressions reproduced missing deadline/foreground enforcement. The access API
now returns the existing validated expiry and server time; the client hides
protected content at the deadline and before foreground/online revalidation.
An independent review also caught a verification dialog remount during a pending
passkey result. The built-page reproduction failed before a stable section key
and succeeded afterward. No authentication policy, roles or stored records change.

Focused checks pass (101 backend and 29 client); build passes. Compiled Chrome
with loopback HTTP and credential doubles confirms timer expiry, context denial,
passkey-result survival, Team directory removal and the authority exception.
The fixture uses eight seconds, not a natural 24-hour session. No native passkey,
IP transition or new production acceptance is inferred. Release/full-suite
results belong to the current stabilization checkpoint. A-22 remains open.

## October 15 renewed real factor setup

After the a8h pgcrypto repair and the PR #306 authority-navigation release,
the owner completed paired approvals and reported successful Google Authenticator
setup on the second/founder authority. Independent read-only metadata confirms
the current TOTP factor is activated and its setup permission was consumed at
11:06:08 UTC. The primary authority separately has a current passkey enrolled
at 11:07:05 UTC and successfully used at 11:07:15 UTC. Both are active Team roles,
with authorization versions 9 and 8 respectively. Actual Admin displays the
administration panel after authentication. No setup key, six-digit code, session
cookie or credential material was inspected or captured.

This accepts real renewed enrollment/authentication under the existing paired
policy and resolves the reported authenticator HTTP 500 journey. It does not
claim native scanning of the newly requested QR presentation, a natural 24-hour
expiry or an actual trusted-IP transition. The already-working methods must not
be reset merely to test a presentation improvement. Private timestamped
`staff-setup-progress-*` evidence contains only role/request/factor metadata.

## October 15 network-change acceptance and navigation feedback

The owner confirms the requested real desktop network-change check worked.
The agent's read-only observation at 11:27:18 UTC found no queue section,
report cards or protected tabs, with verification open and no active-verification
copy. No IP address, session cookie, complaint content or factor value was read.
Evidence: `output/audit/staff-network-observation-2026-10-15.json`, supplemented
by the owner's subsequent confirmation. This accepts the required verification
after a changed network; it does not claim a measured edge-IP value or natural
24-hour expiry.

The owner separately reports unclear in-place navigation until refresh and
verification controls below the main content. Those UX findings were addressed
in PR #308 without repeating the accepted factor or network ceremony. A bounded
regression also reproduces the same-wallet notification clearing Staff access
without reloading it. Source, release and navigation checks belong to the
current stabilization checkpoint. Production deployment 7091669545 and actual
apex navigation/breakpoint checks passed on October 15; this does not close
natural 24-hour expiry or every Phase A gate.
