# Phase A Close-Out

Updated: 2026-10-20. Local work is in `C:\Projects\ArtSoul`; see
[workspace reconciliation](WORKSPACE.md) and the [current checkpoint](audits/STABILIZATION_CHECKPOINT.md).

One page answering one question: what is left before Phase A can close, and who
can do each piece. It is a view of [`BACKLOG.md`](BACKLOG.md) and
[`RESOURCE_GATED_WORK.md`](RESOURCE_GATED_WORK.md), never a second opinion; if
they disagree with this file, they win and this file is stale.

Phase A stands at **69 done, 14 in progress, 0 planned** across A-01 to A-83.

October 20 owner follow-up accepts the scoped iPhone Ownership appearance.
The subsequent native recording shows the guest-header reload flash persists
after PR #314 (`56b17ef`): its redundant-source repair did not remove the
initial bitmap request. Cold-load Chromium/WebKit probes reproduce a visible
guest label before its image is ready, including the optimizer marking it lazy.
Published PR #317 (`f183b78`) embeds the same bitmap in all eight headers, preserves its
logical identity during prepaint and declares eager synchronous decoding.
Logout and failed-image fallbacks reuse the embedded bitmap as well.
The focused suite passes 166 checks, the full local suite passes 1924/1924,
and build plus Linux/Windows CI pass. Twelve actual apex first-frame traces
pass on Chromium/WebKit across mobile/desktop layouts and both themes.
Zero neutral-avatar requests occur; recorded WebKit frames retain the bitmap.
The owner subsequently accepts the guest-avatar repair on iPhone, while reporting
a separate whole-page flash. Published PR #318 (`1a836d9`) applies the selected
body theme before content paints and initializes React in that theme. Corrected
apex evidence covers 64 route openings, 30 reload/link/Back traces and 12
delayed-theme traces across Chromium/WebKit. PR #319 (`6a255e3`) removes late
font swaps on all nine Inter-loading pages; eight delayed-font open/reload
traces retain identical text widths. Both candidates pass build and full
Linux/Windows CI. These desktop-engine checks do not replace native iPhone
acceptance, which remains pending. No wallet, OAuth or factor ceremony is
reopened. Other device and connected publishing criteria remain open.

**October 20 Ownership repair published:** PR #312 (`bf6604d`) removes the
separate ownership-profile round trips and reveals each decoded avatar with its
public name. Confirmed absent profiles retain wallet labels and the standard
avatar. Final local checks pass 1903/1903, candidate Linux/Windows CI is green,
and preview/apex artifacts match. Actual apex Chrome verifies both named and
missing-profile cases and a 390px layout; the latter is not native iPhone proof.
The owner is currently away from the laptop and has since reported the repaired
Ownership display looks good, while identifying the separate guest-header flash
above. Existing connected publishing/receipt and remaining device
criteria stay open; do not restart already accepted sign-in, OAuth, moderation
or account-switch ceremonies.

**October 15 A-22 / A8 accepted, including the UI follow-up:** the [dated evidence reconciliation](audits/PHASE_A_MODERATION_ACCEPTANCE_2026-10-11.md)
maps every required moderation property to existing real journeys, exact-boundary
session tests, compiled client checks and deployed artifacts. Waiting through a
natural 24-hour session was an extra restriction introduced by earlier audit
notes, not an approved ceremony. That observation remains unperformed; it is
not falsely marked passed. Fixed expiry, non-renewal, re-verification and actual
device/network acceptance are evidenced. No policy, role or data changed.
The subsequent successful-verification dialog and inline artwork controls are
repaired in published PR #309 / #310 (`9a2965f`). The owner confirms one passkey
closes the dialog; actual apex first-click tools, close/focus return and 390px
layout pass. No factor reset, repeated complaint or payment was needed.
The remaining device/publishing criteria and A-23's beta review also stay open.

The dated progress notes below preserve earlier observations. Their remaining
A8/natural-wait statements are superseded by the acceptance above.

October 15 network follow-up: the owner confirms real changed-network access
required verification. This closes that acceptance gap. The separate feedback
about unclear guidance until refresh and misplaced sign-in controls is addressed
under A-22 in published PR #308. Top controls and Staff access navigation
are verified on the actual apex, including a 390-pixel desktop breakpoint.
Natural 24-hour expiry, remaining connected-phone criteria
and the beta decision remain open; do not ask for the same network ceremony
again merely to demonstrate the navigation update.

October 15 factor acceptance update: the owner completed renewed setup. Current
read-only records confirm an activated authenticator on the second authority and
a newly enrolled/authenticated passkey on the primary authority, bound to their
current Team versions. This closes the reported factor-setup failure, not the
separate natural 24-hour/session-context or beta-entry gates. The requested local
QR setup UI is published through PR #307 / `f84557be`; no repeat enrollment is
required to preserve the completed acceptance. See the current checkpoint for
the exact artifact and regression evidence.

Earlier October 15 follow-up, superseded by factor acceptance above: the primary
staff wallet had no current factor and its setup permission expired; no replacement
request had been created that morning. A separate founder-wallet passkey prompt covered the authority workflow.
The bounded UI fix keeps paired wallet approvals accessible without automatically
opening complaint verification, while preserving its enforcement. The supplied
desktop video also confirms a support-history button displacement, corrected
by keeping both actions before the asynchronously loaded summary. Both fixes are
published through PR #306 / `0032e94f`, with 1861 passing local checks, green
candidate/post-merge CI and matching preview/apex artifacts. Actual apex Chrome
confirms accessible authority controls with the queue locked, and the support
buttons together above the summary. Real renewed factor enrollment was still open at that checkpoint.
The owner chose to omit the blocked local-browser fixture. The
[checkpoint](audits/STABILIZATION_CHECKPOINT.md) records the exact evidence limits.

October 15 continuation: the avatar correction is published through PR #304 /
`0de0fda`, with green candidate/post-merge CI and preview/apex verification.
The newly reproduced authenticator setup failure is a pgcrypto schema-resolution
defect, not evidence of an incorrect user code. The bounded a8h SQL repair is
applied and independently verified; roles, factor records and access restrictions
are unchanged. The associated native-request cancellation UI is published in
PR #305 / `90bf7cc`, with passing exact-candidate and post-merge CI on Linux and
Windows, build, and preview/apex artifact checks. Real factor setup after the
owner's role change was still unaccepted at that checkpoint; the October 15
completion above now supersedes that status. See the
[checkpoint](audits/STABILIZATION_CHECKPOINT.md) for exact evidence and next step.
The bounded desktop observation retained the correct profile and decoded avatar
through all four tabs, with matching lists and immediate cached Created return.
It does not replace a first-frame recording or the remaining iPhone criteria.

October 14 continuation: the profile session-cookie isolation fix is published
through PR #301 / `12f3e38`, with green candidate CI, build, 49 compiled browser
assertions and preview/apex artifact verification. Two old test wallets completed
real SIWE, wrong-wallet/missing-intent save denials and scoped email/notification
reads without changing their empty public profiles. This does not substitute for
native account switching or successful production profile edits. The checkpoint
retains the initial local PostgreSQL startup failure and its passing rerun.

After the owner finished Admin setup, actual desktop Chrome also passed RG-01
A7/A8 on `12f3e38`: explicit Disconnect removed the connected identity and staff
directory; Admin and Profile stayed guest after reload. This closes the deferred
desktop logout check, not native wallet switching or the remaining iOS criteria.
The dated RG-01 record preserves the exact UI-only evidence boundary.

The owner's subsequent Rabby desktop account switch also passed with captured
`accountsChanged` events and the new wallet's correct profile before/after reload.
This supplies distinct-wallet desktop UI continuity. The owner then confirmed
that no other currently used wallet retains the stale-address problem; A-59 is
accepted with that scope reconciliation and the recorded Rabby evidence, without
claiming universal wallet or native-mobile coverage. A-53's successful iPhone reload/navigation and reconnect
results are retained; only its unrecorded visual restoration transition remains
unaccepted, not the already-passed sign-in outcomes.

A8's combined email-failure isolation is now verified locally: real handlers,
worker and PostgreSQL preserve the moderation ledger and recipient inbox across
HTTP 503, lost response and due retry; recorded acceptance prevents another
send. The focused suites pass 28/28 without skips. This adds no production outage
or delivery claim and does not close A-22's other operational boundaries.

A-21 is accepted from the existing October 11 intake evidence: actual Report
submission, independent reporters, deduplication, the sixth-report denial, no
submission-triggered hiding and an operational review/notification path. No
complaint was replayed to close this stale row. A-22/A8 still retain the separate
session-expiry, changed-context, provider-failure and flag-preservation boundaries.

October 13 staff privacy: the owner-approved Team/current-authority visibility
rule is published through PR #300 / `0ae7c31`. Other administrators/moderators
cannot enumerate staff or read foreign staff attribution from moderation APIs;
complete audit identities remain in storage. Team gets read-only access after
factor verification, while the current authority pair retains its existing
directory exception. Final local checks passed 1838/1838, compiled UI 127, build,
candidate CI and preview/apex artifact/guest-boundary verification. Actual owner
Chrome retained the authority directory while complaints stayed factor-locked.
The [checkpoint](audits/STABILIZATION_CHECKPOINT.md) records exact evidence and
remaining limits. No role or factor changed; this bounded release does not mark
the remaining Phase A operating/device gates complete.

October 12 continuation: native Safari/iPhone staff verification now passed with
the existing Chrome/Google passkey, corroborated by server last-use metadata.
The owner also passed site logout/reconnect/sign-in and Discord apex return,
retaining the correct profile. These specific phone flows are complete; reuse
the dated device/RG-01 supplements rather than asking for the whole trip again.
The locked Admin heading clarification is published through PR #299 / `acf9e01`,
with 1827 local application checks, build, 158 compiled UI assertions, green
candidate/post-merge CI and preview/apex asset verification. Closing the verification window
never grants complaint access. Desktop unlink/relink through both real providers
also passed and restored the original profile; RG-01 block C is now complete.
The desktop account menu showed a numeric Base Sepolia balance. These results
do not establish distinct-wallet isolation, full 24-hour wall-clock expiry,
unasked mobile/transaction criteria or the founder's beta operating decision.

**Founder scheduling decision, October 3:** perform real passkey enrollment and
its operator recovery ceremony now. This supersedes the September 29 deferral;
the activation gates below remain required and are not represented as completed.
Real phone and OAuth evidence remain separate. See the
[exact amendment](canon/CHANGELOG_2026-10-03_PHASE_A_ACTIVATION.md).

September 29 execution evidence: eleven real Base Sepolia transactions now cover
resale purchase/listing/withdrawal and artwork 28's no-bid ending; three distinct
provenance roles were verified on the apex. Final application regression passed
1341 checks with no skips and the build passed. Portrait containment, card price,
profile network / Genesis and recipient notification corrections were published
through PR #282 at `9dcf82b`, with green candidate/post-merge CI and apex artifact
and profile acceptance. Separately authorized live
SIWE/Gemini/media/metadata verification passed all 13 steps. New artwork 34 /
auction 66 has two bids, and the losing bidder received its full deposit back.
The October 2 continuation ended and settled auction 66, minted token 6 with
floor 0.011 test ETH, and verified the creator's 0.010725 test ETH withdrawal.
Both-RPC accounting and eleven public apex browser checks passed. This closes
the bounded settlement rehearsal, not the remaining device/operator gates. See
[the evidence and limits](audits/PHASE_A_TESTNET_2026-09-29.md).

## The shape of what is left

**October 11 founder scope amendment:** Android acceptance is **OWNER-WAIVED /
NOT TESTED** for this Phase A close-out. Do not request another Android run or
treat desktop emulation or iPhone evidence as an Android PASS. This supersedes
the Android portions of older device requirements only; the remaining iOS,
desktop, OAuth and moderation criteria keep their own evidence requirements.
The new 24-hour, browser/network-bound admin session policy is approved in
[canon 07](canon/07_ADMIN_MODERATION_CANON.md#october-11-verified-session-duration-amendment);
earlier 15-minute expiry acceptance does not prove the changed policy.

The replacement is now published through PR #297 at `ba61d5c` (October 11,
20:28 UTC), with 1823 passing local checks, build, 68 compiled UI assertions,
green exact-candidate CI and preview/apex asset verification. The owner Admin
tab subsequently accepted the owner's existing passkey and served the protected
queue. No reset or paired approvals were repeated. Exact 24-hour wall-clock
expiry and changed-IP native acceptance remain separate from automated tests.

Phase A remains **NO-GO** until the remaining A10 and connected-device
acceptance is evidenced. A-39 is now accepted: real paired setup/replacement,
passkey entry, expiry/reverification and protected queue access passed. Both
designated wallets approve staff setup; automated fixtures are not that ceremony.
The historical two-passkey/bootstrap/Safe-only application policy is superseded
by canon 07's October 8 amendment. Contract custody is unchanged.

PR #295 is published at `2ba480bed7328ff01ce43995e1f107f6f0e93399` with green
Linux/Windows/static CI and exact apex asset verification. Its private roster
shows the current authority pair and staff roles. Report and the protected queue
are now enabled. Actual browser/API acceptance passed independent complaints,
deduplication, partial/final restoration, project inbox receipt and recipient-facing
notification delivery. Donate is also enabled after real message-only moderation
and before/after contract/projection verification; both original payments were
reused, not repeated. All test restrictions were restored.

The October 11 evening live checks passed the sixth-report limit, stale and
concurrent decisions, both prohibited reopen cases and the actual hidden/restored
artwork UI. All three new technical reports are closed; earlier reports and
artwork/payment records are preserved. Expected refusal handling and retained
decision text exposed two small Admin UI defects; the correction passed
1826 full tests, build and 65 compiled browser assertions. PR #298 is published
at `a51c16f`; exact-candidate CI and preview/apex asset verification passed.
Actual post-release Admin checks confirmed empty reasons and recovery from a
duplicate-refusal without losing access. All six test reports are closed and
the bounded reopen/dismiss audit is retained. Native access also continued beyond
the old 15-minute threshold. Flag-off preservation has SQL/API and disabled-preview evidence; this
is not a production flag-toggle ceremony. The hidden-artwork loading defect
was released through PR #296 at `c7dcef6`. See [October 11 acceptance](audits/PHASE_A_MODERATION_ACCEPTANCE_2026-10-11.md)
and the [checkpoint](audits/STABILIZATION_CHECKPOINT.md).

October 11 independent continuation: the six scoped moderation suites passed
67 checks, including strengthened full-ledger preservation when Admin or second
factor verification is disabled. Nine deployed HTTP checks confirmed disabled
preview and guest boundaries without changing production flags or data. Read-only
checks matched 16 production RPC bodies and verified 13 protected tables; the
three reports remain resolved, due mail backlog is zero and indexer lag is zero.
The owner is away; remaining real passkey/device steps are deferred, not failed
or waived. No further confirmation is requested until the owner returns.

The initial September 29 PostgreSQL baseline passed 46 checks across seven
integration suites. The final application run includes the additional 11-check
moderation journey: 57 checks across eight groups, with no Docker skips.
They validate SQL/RPC behavior, not production
activation, real passkey ceremonies or Safe signatures. The Base Sepolia indexer
also returned healthy with zero lag in that dated read-only snapshot. Neither
observation by itself proves deployment. The profile, AI and auction patches
were subsequently published through PR #280 at `81627ab`, after green CI and
preview checks; [apex acceptance](audits/STABILIZATION_RELEASE_2026-09-27.md) passed.

A-34's presentation shell and A-35's runtime boundary map are complete locally.
They do not activate aura eligibility or the dormant Express server. Remaining
work separates into residual dependency cleanup, production/operator steps and connected
device acceptance, as listed below.

## 1. Activation and acceptance requirements

Passkey/recovery setup is authorized now as recorded above. Code and regression
work continues; these ceremonies are not prerequisites for publishing independent
fixes. They still gate dependent live activation, and A10 requires a demonstrated
operationally safe reporting/moderation path before a beta GO.

| Gate | What is missing | Why it cannot be delegated |
| --- | --- | --- |
| **RG-01** apex-origin acceptance | Desktop and real iOS runs with distinct wallets/profiles, including SIWE and OAuth. The [dated acceptance form](testnet/RG01_APEX_ORIGIN_ACCEPTANCE_2026-09-04.md) permits one person to complete all blocks and record that honestly | Wallet sessions and SIWE are origin-scoped and need real devices and real wallets; Android is owner-waived / not tested under the October 11 amendment |
| **RG-03** access acceptance | Accepted for A-39 under the October 8 amendment; A-22/A8 operational acceptance completed October 15 | Both designated wallets approved staff setup and replacement; the staff member completed native verification. Do not repeat completed ceremonies |
| **Replacement recovery acceptance** | Owner reset, replacement enrollment and entry observed October 8; old-factor/version rejection verified in SQL/API tests. Historical Safe evidence is retained, not replayed | The actual owner approval and replacement are recorded separately; automated fixtures are not that ceremony |

**RG-02 is not on this list, and was.** `RESOURCE_GATED_WORK.md` blocks RG-02
against **C14**, and RG-03's own completion clause does not mention it, so a
project mailbox gates Phase C rather than the moderation activation or Phase A
exit. It was listed here as a founder-owned item and read as a gate it is not.
It stays deferred, with private operational channels in use and no unmonitored
mailbox published.

The sequence is already written down and must not be improvised: the ordered
migration steps and their backup discipline are in
[`security/MIGRATION_RUNBOOK.md`](security/MIGRATION_RUNBOOK.md) under **A8
Moderation Activation**, and the surrounding rollout in
[`runbooks/A8_MODERATION_ROLLOUT.md`](runbooks/A8_MODERATION_ROLLOUT.md).

**A-21 and A-22 are accepted from implementation and operating evidence.**
A-23 still needs the recorded beta review and remains NO-GO while a required
device/publishing criterion lacks evidence or a P1 issue remains open. Existing
operator and controlled-clock tests are labelled as such, not phone ceremonies.

## 2. Implementation and acceptance still open

Ordered by what the founder can feel, not by row number.

| Row | What it is | Note |
| --- | --- | --- |
| **A-64** | Accept deferred wallet runtime on connected devices | The deferred loader and hidden-tab timer fallback are implemented. iPhone reconnect/sign-in and wallet return passed on October 12; the owner confirmed working network switching on October 14. Do not repeat those flows. Connected iPhone publishing and usability before the deferred SDK is ready remain unrecorded. The old static-SDK diagnosis is historical; Android is owner-waived / not tested |
| **A-47** | Keep artwork loading continuous and shorten the exact-artwork path | The dedicated public function and parallel projection reads are published. PR #312 now batches all displayed public ownership identities into the exact response, without caching live auction state. Exact-candidate preview/apex artifact and public-read checks pass; actual apex Chrome verifies named and absent profiles without redundant Ownership requests. The owner accepted the scoped iPhone Ownership appearance on October 20; broader cold-load/continuity criteria remain open. The separate guest-header flash is tracked in the current checkpoint. Android is owner-waived / not tested. Do not repeat historical video analysis |
| **A-58** | Remove synthetic cards from the first uncached profile-tab load | Reopened by iOS evidence: `display: contents` bypassed the skeleton wrapper's opacity. The repair keeps the panel mounted and uses only the existing compact status |
| **A-61** | Commit the large profile avatar only after its frame is decoded | Reopened by contradictory iOS evidence: unlike the already-protected header avatar, the profile hero inserted the original multi-megabyte upload directly into visible DOM and exposed a partially decoded strip |
| **A-54** | Release profile identity before gallery data | The static shell removed empty frames but remained visible for 3-4 seconds because profile identity, Genesis state and up to 200 artworks shared one completion gate. The revised repair head-prefetches a narrow public profile read and commits identity first; the gallery retains the compact A-58 loading status instead of synthetic cards |
| **A-48** | The single full-document repaint on browser Back | Ordinary headed desktop Chrome passed the apex [probe](testnet/A48_BACK_NAVIGATION_PROBE.md) on September 27: the marker survived and `pageshow.persisted` was true. iOS acceptance remains open; navigation timing or desktop viewport emulation cannot replace it. Android is owner-waived / not tested |
| **A-53** | The identity settle gap between header and profile | Correct-profile iPhone reload/navigation and reconnect outcomes are accepted. The transient restoration menu and header-to-profile visual timing remain unrecorded; do not repeat the whole sign-in flow. Android is owner-waived / not tested |
| **A-33** | Artwork-page acceptance sweep | Composition and the three-distinct-address provenance example are accepted. The remaining criterion is real-phone transaction feedback; desktop layout checks do not replace it |
| **A-57** | Wallet capability limits | Current iPhone network switching is owner-confirmed working. The old Robinhood failure stage and masked provider error remain unknown; neither a confirmed ArtSoul defect nor a proven wallet limitation is established. Do not manufacture a failure or repeat the accepted Rabby account-switch flow |

## 2a. All the device acceptance, in five trips

Thirteen rows remain for device and connected-flow acceptance after A-79, A-59 and A-73 closed.
The underlying repairs, including the September 29 portrait/profile
corrections, are published. A failed acceptance may require another fix.
[`testnet/PHASE_A_DEVICE_ACCEPTANCE_SHEET.md`](testnet/PHASE_A_DEVICE_ACCEPTANCE_SHEET.md)
organises them by trip instead - arrive cold, connect, publish, settle, and the
two wallet questions - because most of these rows are watching the same screens
for different things. It is five sessions per device, and it carries the result
table.

## 3. Waiting only on a look

**A-38 accepted on September 27:** the bounded fixes passed candidate and
post-merge Linux/Windows CI and apex guest warning/font checks. The current audit
retains 64 affected package names, including six inherited parent-package findings
that explain the earlier 58-count report. This closes triage/rollout acceptance;
it does not close residual dependency cleanup or certify the protocol as secure.

**A-79 accepted on September 27:** the actual apex profile opened with 24 works,
committed identity first and loaded the remaining corpus without clearing settled
cards. This closes its one-device criterion; the separate mobile rows stay open.

Merged and measured, needing the device coverage specified in each backlog row:

- **A-71** the ArtSoul mark, not a skeleton, after publishing
- **A-72** quick loads showing no placeholder at all

**A-73 accepted October 14:** the owner explicitly confirms the actual iPhone
account menu shows a numeric Base Sepolia balance. The recorded desktop check
already passed. Android remains owner-waived / not tested.

**A-78 reopened on 2026-09-06.** The active-first heuristic can target another
artwork's auction when two counters collide. The same ambiguity affects token
versus artwork resale inputs. Explicit identifier namespaces replace guessing;
connected-flow acceptance remains outstanding. See the backlog for current scope.

A-82 closed on 2026-09-14. The graceful-shutdown module no longer registers
a leave-site confirmation in the browser. The current explicit allowlist covers
unfinished artwork upload and unsaved collection authoring only; the latter was
added with the locally tested draft builder.

**A-77 closed on 2026-08-28.** The fix shipped to production and to the Hetzner
indexer, the backfill released all ten affected artworks, and artwork 31 was
auctioned again from the profile with the new auction confirmed on chain.

## What Phase A does not need

Recorded because it keeps coming up. Phase A does not need a mainnet deployment,
a token, verified user metrics, or Genesis. Canon rules 4, 5 and 10 stand
unchanged, and no claim of any of those may appear in progress reports or grant
material.
