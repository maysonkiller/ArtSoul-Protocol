# Stabilization checkpoint

Updated: 2026-10-08. Continue only in `C:\Projects\ArtSoul`, branch
`codex/takeover-audit`. Read `git status` and `git log -1` before editing.

October 8 continuation (UX published; Donate indexed; mail worker active):

- Recovery started at `838f54b71881c4e5199dd0828793c2053aeb48eb`; remote main matched
  at that read. Production is `154d16f2fe18734a6766330c3aa7021eecf00702`;
  the challenge-binding continuation started at committed HEAD
  `a611d424b8cd8441aa1f3eed9821c31b939b83f9` on the same branch
  (draft PR #294, not merged). Use `git log -1` for the saved continuation commit.
  Existing October 3 source and checkpoint changes were
  preserved in `output/recovery/phase-a-resume-2026-10-07/before.patch`, with
  separate copies of seven untracked implementation/test files. No worktree,
  overlay, reset or cleanup was performed.
- Local changes unify X/Discord/private email management in Edit Profile,
  move preview actions onto media, preserve one status/price row, expose full
  metadata and remove the redundant View artwork menu action. Card runtime
  uses v18 on all four consuming pages. Report/Donate still respect server
  rollout gates and open the existing targeted dialogs when enabled.
- Native first-passkey setup uses an existing audited bootstrap approval
  without manual code transfer. Additional setup reuses the existing protected
  grant. No approval is issued by ordinary wallet login. The narrower admin
  wallet/logout fix was explicitly confirmed by the founder and applied;
  it clears browser memory only and rejects stale responses. It does not delete
  complaints. The formerly rejected broad candidate remains a recovery artifact,
  not a copied implementation. Seventeen regressions reproduced 13 failures
  against HEAD and passed on the repaired source.
- Built-browser testing found and fixed a real first-render temporal-dead-zone
  error introduced by the email-editor effect. Whole-component React rendering
  now covers guest, restoring, connected and public-profile cases. Do not
  substitute the earlier function-slice tests for this evidence.
- Full local suite after that correction: **1,613 passed, zero failed/skipped**,
  including real disposable PostgreSQL tests. Log:
  `output/audit/phase-a-ux-full-unit-v2-2026-10-07.log`. Build passes 11 routes /
  175 CSS utilities. Final v5 build passed after card-only sizing refinements;
  their focused Node checks passed 46/46 and built-browser checks passed 629/629
  across 24 viewport/theme/surface combinations. At 320/360px the shared grids
  use one column so ordinary prices remain fully readable; 390px is unchanged.
- Native-UI fixtures passed 187 assertions across 1280/390/320px and both
  themes; profile passed 21 scenario groups and staff notices 26 cases. There
  were zero uncaught page errors and zero external writes. These use synthetic
  credentials and local HTTP fixtures, not physical authenticator acceptance.
  Source/artifact hashes and screenshots are in the corresponding October 7
  `output/audit/` and `output/playwright/` records, including
  `card-overlay-built-browser-2026-10-07-v5-final.json`. These fixtures do not
  establish physical iOS/Android authenticator or wallet acceptance.
- [PR #292](https://github.com/maysonkiller/ArtSoul-Protocol/pull/292) merged as
  `5529973e41b29ca6ed62662c2e8fae17242bda2f` after Linux, Windows and static CI
  passed (run `37592870318`). Preview and apex each matched all 51 JS/CSS
  assets across five pages. Production deployment `6905182667` succeeded.
  Evidence: `phase-a-ux-{preview,apex}-artifact-2026-10-07.json`. The connected
  apex browser loaded v18 and 26 real gallery cards; checked cards had media
  overlays and one-row status/prices. Screenshot:
  `output/audit/phase-a-ux-apex-gallery-2026-10-07.png`.
- Complaint email delivery code is published with a separate worker flag,
  service-only claims, idempotent bounded retries and no complaint content in
  email. Its migration, protected configuration and scheduler were verified on
  October 8, including actual transport delivery to the project inbox (see below).
  Full complaint-flow acceptance remains open. See `docs/runbooks/MODERATION_REPORT_EMAIL.md`.
  Staff profile notices use existing protected APIs, store only reference/count
  information and never turn ordinary users into staff. Email runs only in the
  scheduled worker; report intake never waits for the provider. The actual
  intake/email focused regressions passed 31/31 after that correction.
- Read-only live check at October 7 07:52 UTC found one active administrator,
  zero passkeys, one unused expired bootstrap approval and no recovery ceremony.
  No role/credential mutation or transaction was performed by that check.
  The original bootstrap/auction/Donate journals must never be replayed.
- Founder approved mandatory BOTH-wallet authority for roles/critical changes,
  normal moderator report decisions, an authenticator-app alternative, and
  reviewed collection-origin badges without a sales threshold or Trust effect.
  See `CHANGELOG_2026-10-07_ADMIN_AUTHORITY.md`; these are approved direction,
  not completed implementations. The existing 2-of-3 Safe does not satisfy the
  new mandatory-pair rule. Exact 0.002 test ETH funding to the new founder wallet
  in Base Sepolia completed in transaction
  `0xafbbfe605ad1ed0efd229d29430962d3d853da99eadb4a3c2c94c38a5f75eca9`.
  The recipient remains excluded as an automated signer. A transient initial
  receipt verification failure was reconciled without resending; both RPCs
  confirmed the transaction and exact recipient balance. Fourteen legacy, one
  Donate deployment and one funding record reconcile to 0.025315172029030397
  test ETH total campaign cost. A write-once recovered receipt is recorded;
  funding is now included in the reviewed future runner's budget and nonce
  checks (115 offline checks passed). The founder then explicitly authorized
  release for exactly two 1-wei Donate checks. Both completed without replay:
  message transaction `0x91f63b0d5796ee1c2f7248113210851ee8d558623d6947e5fb21fa18354c0c17`
  and empty anonymous transaction `0x178309ae89d156c574f08bb10e456143bc72ea1e4706f7134bbd9e35f4e3cc7d`.
  Each canonical receipt, block, creator transfer and unchanged Core/NFT state
  was independently verified after an initial receipt-check mismatch. Neither
  transaction was resent. Completed locks were released by receipt-only
  finalizers. All 18 campaign operations total 0.025316087413030749 test ETH.
  Do not rerun those completed plans or finalizers.
- October 8 read-only acceptance found exactly one indexed row per donation,
  completed processing records, healthy advancing Base cursor 47837333 and zero
  failed/dead events. The actual public API handler against live data passed
  exact amount/message and anonymous-address suppression checks using a
  process-local enabled flag. Apex Donate remains disabled. Evidence:
  `docs/private/donation-projection-acceptance-2026-10-08T07-02-51-151Z.json`.
- After the owner reset the forgotten Linux password, SSH access succeeded.
  Read-only inspection found `/opt/artsoul`, main
  `93ad98a9b9dee9863a9e1828e096444abfbec615`, clean tracked files and two untracked
  launcher scripts to preserve. Base Sepolia is healthy with zero event errors;
  legacy Ethereum Sepolia is stopped. That older revision lacked Donate.
- The host now runs the same reviewed `5529973` revision via a checked Git
  fast-forward. A restricted source/runtime/configuration backup is retained
  at `/var/backups/artsoul-phase-a-2026-10-07`; both archives were validated.
  Base stopped at cursor 47796924. Two-RPC log coverage from deployment block
  47607186 through that cursor found zero Donation events, so no backfill,
  cursor reset or migration was performed. The shared launchers were preserved.
  `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`, runtime imports,
  message-codec smoke and all 25 host event regressions passed. Only the
  verified Donate address was appended to the Base configuration. Restarted
  Base is healthy, depth 3, cursor advancing 47797013 -> 47797035, with zero
  failed/dead/unresolved events. Seven source/package hashes match the reviewed
  commit. PM2 state was saved; Ethereum remains stopped. Private evidence:
  `hetzner-donation-runtime-2026-10-07.json` and the host backup's acceptance log.
- October 8: a fresh restricted database backup was created and its archive
  read-validated (not a restore rehearsal). The single published complaint
  delivery migration `67435e2b396131bc5bffbccd54b22ff89fb8258ad73c58ec4488463835cab46e`
  was applied in one transaction after fresh catalog preflight. Table shape,
  forced RLS, browser privilege denial, service access, exact RPC bodies,
  signatures and search paths passed before commit. Report counts stayed zero;
  no email, scheduler or feature flag was enabled. Private journal:
  `docs/private/report-email-schema-apply-2026-10-08.json`.
- October 8 recovery snapshot is in `output/recovery/phase-a-resume-2026-10-08/`.
  No other agents are running; continue solo per founder request. The approved
  role authority uses BOTH designated wallets' gasless signatures; no new Safe
  is wanted for application roles. Contract/fund authority remains separate.
  Ordinary complaint decisions remain human moderator-confirmed; AI does not
  autonomously grant roles. This clarification supersedes any proposed Safe
  deployment for application authority, not historical recovery evidence.
- Local TOTP crypto (38 checks), Safe observation helper (29 checks) and TOTP
  persistence (22 real PostgreSQL checks) are preserved but not wired or live.
  Role epochs, dual-signature issuing/rotation, factor session integration and
  real setup/recovery ceremonies remain open. Native key/app setup is unverified.
- Current requested card amendment is published: Donate, Report, Creation transaction
  only, in that order; no management/details actions. Valid indexed registration
  hashes only; owner auction management remains on artwork detail. Shared cache
  v19 covers all four consumers. All 32 card regressions and the 11-route build pass. Built-browser acceptance
  passed 629 checks across 24 viewport/theme/surface combinations; Donate
  rendering with the real sanitized API read response passed 27 checks. Both
  suites performed zero writes and had zero page exceptions. Evidence is in
  `output/audit/{shared-card-menu,donation-real-read}-built-2026-10-08.json`.
  PR #293 merged as `154d16f2fe18734a6766330c3aa7021eecf00702` after Linux,
  Windows, static and Vercel checks passed (CI run `37743580044`). Initial CI
  `37743100607` found an outdated card cache pin and obsolete upload guidance;
  both were corrected and their 43 focused checks passed before the green run.
  Production deployment `6929874943` succeeded. Preview and apex matched all
  53 JS/CSS assets across six pages; Base indexer was healthy with zero lag.
  The actual connected Chrome gallery loaded v19, rendered 25 cards, kept the
  menu over media and exposed only the correctly labelled creation transaction
  while public Donate/Report remain off. Screenshot:
  `output/audit/phase-a-menu-apex-gallery-2026-10-08.png`. Artifact evidence:
  `output/audit/phase-a-menu-{preview,apex}-artifact-2026-10-08.json`.
  Browser fixtures do not prove public feature activation or physical phones.
- October 8 dual-wallet message verification is local and unwired (29/29 checks):
  both current EOAs sign the exact domain/action/target/role/version/nonce/expiry;
  one signer, duplicates, changed fields, expired requests and replacement-pair
  approval are denied. A8f now adds local-only durable proposals, atomic role
  grants/revocation/rotation and immutable runtime audit evidence. Its unregistered
  API handler loads the stored proposal and recovers both signatures itself.
  SQL rechecks authority and target versions after locks, consumes the request
  once and commits the role change with its audit. Direct runtime role writes
  are denied. The final focused run passed 47 checks, including real disposable
  PostgreSQL, real ephemeral EOA signatures and the actual handler/session code
  over a fixture PostgREST transport. Evidence:
  `output/audit/a8f-authority-handler-2026-10-08.log`. No project keys or external
  transactions were used. The migration is unapplied, the policy registry is
  unseeded, the handler is not routed, and no role-management UI is wired.
  Factor/session integration and real approvals remain unfinished.
- A real disposable PostgreSQL regression reproduced two TOTP role-regrant gaps:
  an old matched login and an old enrollment approval could both return OK after
  revocation/recreation. The local unapplied migration now binds grants/attempts
  to a monotonic role authorization version. All 28 PostgreSQL checks passed,
  including concurrent revoke/regrant, deletion/recreation, fresh replacement
  setup and denial of sequence rewinds. Evidence:
  `output/audit/a8e-role-regrant-after-2026-10-08.log`. No live schema or staff
  authorization has changed. Retained failing evidence:
  `output/audit/a8e-role-regrant-before-real-2026-10-08.log` (22 passing checks,
  two failed subtests plus their parent, no skips). Docker startup caused an
  earlier skipped run, which is not verification evidence.
- Final October 8 working-tree regression: **1,756 passed, zero failed/skipped**.
  Command: `npm run test:unit`; log:
  `output/audit/phase-a-authority-full-unit-final-2026-10-08.log`. The first run
  passed 1,753 and failed three integration guards: a missing migration-ledger
  row, missing private-table classification and a CRLF/LF-only header comparison.
  Those guards were corrected; 93 focused checks and the full rerun passed.
  The table scanner now recognizes CREATE TABLE with or without IF NOT EXISTS.
  No historical applied migration was rewritten. The retained unselected Safe
  observer and its 29 tests remain outside the new authority change; no new Safe
  is selected by their presence. Recovery snapshot:
  `output/recovery/phase-a-authority-2026-10-08/`. Only this root agent is active;
  the completed isolated browser and preview server were closed.
- The tested source is preserved in [draft PR #294](https://github.com/maysonkiller/ArtSoul-Protocol/pull/294)
  at `917d084da74a93f747777b2c21c3f3516288b772`. CI run `37747560963` passed
  Linux, Windows and static checks; the Vercel preview also passed. No draft
  migration or route is activated by publishing it.
  Remaining untracked files are `.codex/`, `output/`, the previously preserved
  `src/api/moderation-authority-policy.js` Safe observer and its test. They were
  deliberately not folded into the selected gasless application authority.
  The subsequent session-binding changes were pushed as `a611d42`; CI run
  `37765791029` passed Linux, Windows, static and Vercel checks for that exact
  commit. The newer challenge-binding diff below is not covered by that old CI.
- October 8 factor policy is now explicitly approved: both current authority
  wallets approve initial setup and replacement setup/recovery, with one-time
  15-minute permission. TOTP allows five reservations per rolling five minutes,
  counting abandoned attempts; each lasts two minutes. Sessions remain 15
  minutes. Canon 07, its dated amendment and the migration/runbook notes record
  the replacement of historical bootstrap/Safe application recovery. No live
  policy or factor configuration was changed.
- A reproduced API regression allowed an old step-up cookie to become valid
  after role revocation/regrant. The local repair signs the current role version,
  rechecks it for every protected session, rejects legacy cookies when the new
  authority flag is on, and rejects authorization changes during passkey
  verification before issuing a cookie. Mixed dual-wallet/no-factor flags now
  fail closed instead of falling back to social profiles. Complaints are never
  deleted. Snapshot: `output/recovery/phase-a-session-binding-2026-10-08/`.
  Failing evidence: `output/audit/passkey-session-regrant-before-2026-10-08.log`.
  Focused regressions passed 139/139; the full working-tree suite passed
  **1,776/1,776, zero failures/skips**, including isolated PostgreSQL. Logs:
  `output/audit/passkey-session-binding-{focused-final,full-unit}-2026-10-08.log`.
  Build passed 11 routes / 175 utilities, recorded in the matching `build` log.
  A subsequent real SQL grant -> cookie -> revoke -> regrant regression and
  policy guards passed **74/74, no skips** in
  `output/audit/passkey-session-binding-real-2026-10-08.log`. Its credential is
  synthetic; this does not prove physical passkey acceptance. Earlier sandbox
  Docker skips and missing-process fixture failures are not acceptance evidence.
  Enrollment grants and factors still need full role-version integration;
  current checks alone do not authorize feature activation.
- Resend transfer: the owner explicitly approved temporary inspection through
  the personal account and then an Admin invitation to the project mailbox.
  The invitation was sent and accepted on October 8. A fresh project-mailbox
  login shows active Admin membership in the existing team and both existing
  verified domains. The existing four API keys were retained; no DNS/domain
  transfer, subscription or key rotation occurred. After separate explicit
  confirmation, the personal membership was removed; the project mailbox is
  now the sole Admin. Both domains and all five current keys were retained.
  Removal evidence: `output/audit/resend-personal-access-removed-2026-10-08.png`.
  Initial acceptance evidence:
  `output/audit/resend-project-admin-accepted-2026-10-08.png`.
  After separate owner authorization, the sending-only key
  `ArtSoul Protocol moderation mail`, restricted to `notify.artsoulprotocol.com`,
  was created and installed through encrypted transport. The existing website
  key was retained. The owner also explicitly approved placing the existing
  Supabase service-role key on the host for the delivery worker.
- October 8 mail worker is live: `/etc/artsoul/report-email.env` is root-owned
  mode 0600; only `artsoulprotocol@gmail.com` receives these alerts. The separate
  systemd oneshot/timer runs at most three records per invocation, 60 seconds
  after completion, with a 120-second timeout. Three observed runs exited zero
  with an empty queue. The real transport test reached the project Gmail inbox;
  one exact-key retry produced no second delivered message in Resend. The owner
  explicitly approved this permanent schedule; the prior automatic-review
  blocks on secret placement/scheduling are resolved, not outstanding gates.
  Private evidence: `docs/private/moderation-mail-worker-acceptance-2026-10-08.json`;
  screenshot: `output/audit/moderation-mail-real-inbox-2026-10-08.png`.
  Host source remains `5529973`, Base healthy (observed lag five, failed/dead zero),
  legacy Ethereum stopped. No indexer restart or synthetic complaint was made.
  Actual complaint submission, moderator decision and notification acceptance
  remain open; transport evidence does not close those gates.
- The challenge-binding continuation reproduced a separate gap: a WebAuthn
  response created before role regrant could obtain a new version-bound cookie
  if the verify request itself started after regrant. The candidate now stores
  the role version on authentication challenges and includes it in the atomic
  consume predicate. Missing/old versions fail closed under the dual-wallet
  flag, without rewriting old rows. The A8e migration is still unapplied.
  Snapshot: `output/recovery/passkey-challenge-binding-2026-10-08/`;
  failing evidence: `output/audit/passkey-challenge-binding-before-2026-10-08.log`.
  API and actual disposable PostgreSQL checks passed **128/128, no skips**,
  including signed revoke/regrant and concurrent one-time consumption:
  `output/audit/passkey-challenge-binding-real-final-2026-10-08.log`.
  An earlier TOTP fixture aged out its previous-step setup code at a 30-second
  boundary. Fixture preparation now uses database execution time; production
  code/window rules were not relaxed. Initial failure and sandbox Docker skips
  are retained and are not passing evidence. The build passed 11 routes and
  175 utilities: `output/audit/passkey-challenge-binding-build-2026-10-08.log`.
  The final complete working-tree Node run passed **1,787/1,787, no failures or
  skips**, including actual disposable PostgreSQL. Command:
  `node scripts/run-unit-tests.mjs`; log:
  `output/audit/passkey-challenge-binding-full-unit-2026-10-08.log`.
  The count includes 29 preserved unselected Safe-observer tests outside PR #294.
  Registration/factor setup and real device acceptance remain incomplete; these
  checks do not establish those flows or change any live authority flag.
- Report, Protocol Admin and public Donate flags remain disabled. Phase A is open.
- Exactly next step: complete the approved two-wallet factor-setup permission
  consumer and bind passkey enrollment grants/factors to its role version before wiring
  the role route. The policy decision is resolved; real integration is not.
  Public Donate activation also requires working donation-message moderation
  under the October 3 amendment; successful test payments do not waive it.

October 3 admin-access placement correction (published and browser-verified):

- Workspace remains `C:\Projects\ArtSoul`, `codex/takeover-audit`, based on
  `a47d57847c047a30ca68ace077433ef9599dd4ea`. The previous checkpoint diff is
  preserved in `output/recovery/admin-passkey-modal-2026-10-03/before.patch`.
- Placement [PR #290](https://github.com/maysonkiller/ArtSoul-Protocol/pull/290)
  merged as `a17af5313c3706895328dc647353a09cb6d3be10`; candidate CI
  `37083385789` and post-merge CI `37083886999` passed all jobs. Production
  deployment `6821279027` succeeded at 00:53:21 UTC. Both preview and apex
  matched all 51 JS/CSS assets across five pages to candidate `5f61e0e`.
  Evidence: `output/audit/admin-modal-{preview,apex}-artifact-2026-10-03.json`.
  The actual connected Chrome session confirmed artwork has no passkey panel,
  the account menu exposes Admin panel after server discovery, and `/admin`
  opens the verification dialog with its dark backdrop. No native ceremony ran.
- Live visual inspection also found browser-default serif typography and an
  8px body margin on the admin page. Layout-only candidate `0290132` in
  [PR #291](https://github.com/maysonkiller/ArtSoul-Protocol/pull/291) adds a
  scoped body font/reset, border-box sizing and inherited input font; it does
  not change authentication handlers. The new build passed 11 routes/177 CSS
  utilities and **145/145** browser assertions at 1280/390/320px in both themes,
  including page/dialog overflow and input font size. Evidence:
  `output/audit/admin-passkey-relocation-ui-only-browser-summary-layout-2026-10-03.json`.
  Preview deployment `6821336060` matched all 51 assets; the production CSS is
  content-hashed, so the new file cannot reuse the previous browser cache key.
- PR #291 passed all hosted checks in `37084301402` and merged as
  `838f54b71881c4e5199dd0828793c2053aeb48eb` (current workspace HEAD).
  Production deployment `6821378071` succeeded at 01:03:17 UTC; immutable host
  `artsoul-fmmldt6sn-maysonkiller-be9112b5.vercel.app`. Final apex verification
  matched all 51 assets; evidence is
  `output/audit/admin-modal-apex-artifact-2026-10-03-layout.json`.
  Actual connected Chrome on `/admin` now confirms zero body margin, the shared
  sans-serif font, 560px border-box dialog, and equal document/client widths
  (1521px). Screenshot: `output/audit/admin-modal-apex-final-2026-10-03.png`.
  Enrollment input remained empty and no native ceremony or grant issuance was
  triggered. The `/admin` and existing Hetzner login tabs are retained for handoff.
  Only this post-release checkpoint is a new tracked local change; `.codex/`,
  `output/` and private journals remain unstaged. Feature gates are unchanged.
- Founder correction: remove the Staff passkey panel from artwork pages and
  put enrollment/verification in an Admin panel dialog with clear steps and
  a dark backdrop. Scope is UI/access continuity (canon 05/07/16), with no
  economic, contract, AI valuation or live-moderation activation changes.
- Discovery now distinguishes passkey setup from enabled moderation queues.
  Only server-confirmed staff may receive the menu link. Expected-wallet
  comparison and menu session-generation guards prevent old SIWE/wallet
  responses from restoring stale menu eligibility. Protected queue/action
  gates stay intact.
- The broader admin-page stale-response correction is an inert reviewed
  candidate in `output/audit/admin-passkey-host-candidate.jsx` (11 passing
  candidate regressions). Automatic approval review rejected applying it as
  broader than the latest UI placement request. A precise human authorization
  question is pending; do not apply that candidate without the answer. The
  independently reviewed UI-only relocation is now applied; existing admin
  authentication, queue and decision handlers are preserved.
- Local verification: **1,548/1,548 Node checks passed, zero skips**, including
  disposable PostgreSQL integration; **11 built routes / 176 CSS utilities**.
  Logs: `output/audit/admin-modal-unit-verified-2026-10-03.log` and
  `output/audit/admin-modal-build-verified-2026-10-03.log`. The first restricted
  run exposed outdated source-extraction/cache assertions and could not access
  Docker/private-directory enumeration; those results are retained, not reused
  as passing evidence. Build used the installed npm CLI with a process-local
  prefix because the ordinary npm shim selected an inaccessible global path.
- The new dialog reuses the existing registration/authentication/grant routes,
  with labelled code input, explicit native-device actions and transient codes.
  Artwork no longer imports or renders passkey setup. Native dialog presentation
  opens only when verification is needed; active sessions retain Manage passkeys.
  Interpretation: setup is independent of review-queue activation, not a bypass
  of that flag or a new staff role. Real native ceremonies remain outstanding.
- Built-browser acceptance: **81/81 assertions passed**, desktop/mobile in
  Classic/Future, zero uncaught page errors, zero queue requests or external
  writes. Eight POST requests used intercepted local fixtures and synthetic
  native-credential responses, not real credentials. The pending broad host
  race cases are explicitly excluded in
  `output/audit/admin-passkey-relocation-ui-only-browser-summary-2026-10-03.json`.
  Screenshots are in `output/playwright/admin-passkey-{classic,future}-{1280,390}.png`.
- The existing renewal process is still waiting for human READY; no renewal
  journal was present at the placement correction's initial check. Do not
  restart that process merely to replace its old artwork-page instructions.
  After release, direct the human to `/admin`; the same wallet/RP/grant rules
  apply. The helper's future display text now names that route.
- Exactly next step: have the founder complete the native passkey ceremony in
  the retained `/admin` dialog using the existing audited renewal handoff, then
  read the credential/grant audit state before the second independent device.
  Do not replay bootstrap/renewal operations. The separate admin host-session
  candidate still awaits the explicit authorization answer; Phase A remains open.

October 3 card release and native handoff (completed):

- Canonical path/branch: `C:\Projects\ArtSoul`, `codex/takeover-audit`; current
  HEAD and published application: `a47d57847c047a30ca68ace077433ef9599dd4ea`,
  [PR #289](https://github.com/maysonkiller/ArtSoul-Protocol/pull/289).
  Corrected candidate `98a7a7c7f42d1d303f526fdd7de91472bd6601fc` passed all
  Linux, Windows and static jobs in CI `37080015592`. The earlier Windows
  failure was a test-only LF/CRLF assumption; its log remains retained.
  Post-merge CI `37080283906` also passed all three jobs.
- Production deployment `6820742214` succeeded at October 3, 00:02:17 UTC,
  immutable host `artsoul-gwbb386xv-maysonkiller-be9112b5.vercel.app`. Apex
  verification matches 49 JS/CSS assets across four pages to the tested build.
  The final test/document-only commit did not change application artifacts.
  Evidence: `output/audit/card-menu-{preview,apex}-artifact-2026-10-03.json`.
  Email remains enabled; Report/Admin/Donate remain gated. The Base indexer is
  healthy with zero observed lag; legacy Ethereum Sepolia stays stopped by design.
- Shared preview metadata and ellipsis actions are published. Local evidence:
  1,528 Node checks, 76 built-browser checks, 11 built routes/177 CSS utilities,
  and 29 independent focused checks passed. Real profile data loaded correctly
  on the preview host, then the wallet extension redirected it to a security
  warning. Browser interaction was stopped, not bypassed. The extension now
  blocks automation until the user closes its warning. No final connected-browser
  or physical-device acceptance is claimed from asset equality.
- The October 2, 23:57 UTC operator read still found one role, zero passkeys,
  one unused grant and zero available grants: the first code expired. A separate
  reviewed renewal window (28 offline checks) is waiting for human READY.
  Its journal was still absent in the latest process check; no renewed grant is
  claimed. Initial bootstrap and completed auction 66 transactions must not be
  replayed. Enroll/Verify on native authenticators remain human actions.
- Resend delivery and Donate deployment are complete as recorded below. Mailbox
  link confirmation, indexer host access/source registration and real Donate
  payment/projection tests remain outstanding. Phase A is not closed; the
  retained device/OAuth/moderation/recovery and A10 gates are unchanged.
- Application source is committed and published. The only new local tracked
  change after release is this checkpoint; `.codex/`, `output/` and private
  journals are preserved and excluded from staging.
- Exactly next step: after the user closes the extension warning and completes
  Enroll/Verify, read the credential/grant audit state and continue the second
  independent passkey. Resume Donate host inspection when Hetzner login is ready.

October 3 activation and card alignment (completed preparation; retained evidence):

- Workspace remains `C:\Projects\ArtSoul`, `codex/takeover-audit`; base HEAD for
  this follow-up is `1c55599bfabf848b41321a7452507dfec419c443` (PR #288).
  PR #287 released the second-device passkey interface. PR #288 repaired a
  missing Vercel rewrite for `/api/profile/email`; candidate CI `37077626390`
  and post-merge CI `37077971791` passed. Production deployment `6820404323`
  succeeded at `artsoul-ipoondbg2-maysonkiller-be9112b5.vercel.app`.
- Email and passkey routes are active on the apex. Reporting, Protocol Admin
  and Donate remain off. One real verification email was accepted and reported
  Delivered by Resend; screenshot: `output/audit/profile-email-delivered-2026-10-03.png`.
  The request did not mark email ownership verified, and the signed-in test
  session was logged out. The mailbox-link confirmation is still outstanding.
  Preserve the initial zero-send failure and the one-send retry evidence; do
  not blindly send again.
- The founder-authorized test wallet now has one active staff role and one
  audited bootstrap grant. A read-only check at October 2, 23:40 UTC found zero
  passkeys and the grant unused. Native registration, a second independent
  authenticator and Safe recovery remain human/operational acceptance steps.
  Never replay the initial role/bootstrap helper. An expired unused grant can
  only be superseded through the existing audited grant procedure.
- The isolated Donate contract is deployed on Base Sepolia at
  `0xA36bD0Da05fA5Aa113834aD355363C66cd42a22b`, block `47607186`, transaction
  `0xa4e943175ecf2b0641b869436277fc9c79a5ff734a2cd099a1a9c5771fbfd7ae`.
  Both RPCs verified canonical inclusion, runtime code, Core and Safe owner.
  The initial runner stopped on a receipt disagreement; read-only recovery
  finalized that exact transaction without re-signing or rebroadcasting.
  No donation payment has been sent. Indexer source registration still needs
  authenticated host access; the current SSH identities were rejected.
  Preserve the existing cursor and prove the deployment-to-registration gap
  before payment tests or public activation.
- The founder requested matching preview metadata and an ellipsis menu on
  home/gallery/profile. The pending patch reuses the shared card, removes the
  profile-only body/action layout, and exposes available actions through that
  menu. Donate/Report links open the existing checked forms only; feature gates
  remain authoritative. AI valuation, auction economics and contracts are
  outside this patch. Existing source differences were preserved under
  `output/recovery/card-menu-2026-10-03/` before release preparation.
- Unfinished public diff: shared card/menu, profile/gallery integration, narrow
  artwork action links, matching CSS/cache references, regressions and status
  documentation. `.codex/`, `output/` and ignored private material must not be
  bulk-staged. Phase A remains open; device, OAuth and native key ceremonies are
  not inferred from fixtures or an enabled flag.
- Final card candidate checks: **1,528/1,528 Node tests passed, zero skips**;
  build **11 routes / 177 utilities**; **76/76 built-browser checks** across
  home/gallery/profile, both themes and 1280/390px widths, zero page exceptions
  or write/auth/transaction calls. Native links, menu keyboard/focus behavior,
  delayed wallet restoration, checked forms and disabled gates were covered.
  Wallet/data/config were fixtures, not physical-device or real payment proof.
  Independent review passed 29 checks with no remaining P1/P2 finding in scope.
  The first full run found one obsolete profile-wrapper assertion; its failure
  is retained. Current logs: `output/audit/card-menu-unit-verified-2026-10-03.log`,
  `card-menu-build-final-2026-10-03.log` and
  `shared-card-actions-built-browser-2026-10-03.log` in that same directory.
  Hosted Windows then exposed a test-only LF/CRLF assumption in callback
  extraction; the test now normalizes line endings before parsing. Application
  source and the verified build are unchanged; require the corrected CI run.
- Interpretation recorded: each menu shows available View/Donate/Report actions
  and creator/owner controls. Existing checked artwork forms own submission;
  moving an entry into the menu never grants permission or submits a transaction.
  No architecture amendment was needed. The moderator canon's stale September
  29 scheduling sentence now references the already approved October 3 amendment.
- Exactly next step: publish this verified card candidate, require its hosted CI
  and preview acceptance, then verify the apex artifact before resuming the
  pending native-passkey and indexer-access steps.

October 3 initial release candidate (completed; retained evidence):

- PR #286 is merged as `aaf24cd5b03241f380a20efa2ca1e407a9d519a4`, now the
  working HEAD. Candidate and post-merge CI passed. Production deployment
  `6820025852` succeeded; its immutable host is
  `artsoul-otar63kt2-maysonkiller-be9112b5.vercel.app`. Preview and apex checks
  matched 48 assets across four pages to the tested candidate build. Evidence:
  `output/audit/phase-a-{preview,apex}-artifact-2026-10-03.json`.
  All work remains in the canonical checkout; recovery archives are preserved.
- The founder authorizes real passkey/recovery setup now and removes the Donate
  message amount threshold. Any non-zero donation may include a message; 100%
  goes to the creator. The separate contract has no minimum/setter. Exact prior
  rules and the amendment are recorded in
  `../canon/CHANGELOG_2026-10-03_PHASE_A_ACTIVATION.md`.
- Profile email now clears immediately on same-wallet sign-out and fences old
  reads/writes without cancelling initial sign-in. Donate rejects obsolete
  receipt-check completions and keeps changed-calldata replacements locked for
  verification. Three real local HTTP reproductions also exposed an A8d
  wrong-chain check that trusted static provider configuration; it now explicitly
  queries each RPC's chain ID before accepting Safe code/signatures.
- Current complete Node regression: **1,512/1,512 passed, zero skips** in
  `output/audit/phase-a-unit-final-2026-10-03.log`. The initial run's only failure
  was an obsolete test requiring the now-superseded passkey deferral; its log is
  retained. Final build passed **11 routes / 177 utilities** in
  `output/audit/phase-a-build-final-2026-10-03.log`.
- Current full contract suite passed **46/46**, including the amended any-positive-
  amount donation cases, in `output/audit/phase-a-contracts-final-2026-10-03.log`.
- Actual built browser checks passed: profile **13 groups**, Donate UI **26**,
  Donate recovery **22**, Report **3**; zero uncaught page exceptions. Wallet,
  mail and transaction transport were local fixtures in these runs. They do not
  prove real delivery, signatures, OAuth, physical phones or passkey enrollment.
- Resend verified the mail domain; Cloudflare contains the three authorized
  records and the original seven are preserved. A domain-restricted sending key
  and sender/origin configuration were saved to Vercel Production under explicit
  founder approval. No value is in Git or this document. Email activation and a
  real verification roundtrip still require the reviewed schema and release.
- Four feature schema stages are now committed and verified: shared quotas,
  private email, donations, and typed donation-message reports. A fresh protected
  backup was read and validated before application; eight isolated runner checks
  include actual transaction rollback. The private application journal records
  every stage. Existing A8 migrations were reconciled and were not rerun.
- The founder selected the existing testnet wallet ending `6989B` for moderation.
  No role or bootstrap grant has been issued yet. The separate second-passkey UI
  is being tested. Email/passkey flags are saved for the next deployment; that
  is not proof of runtime activation, delivery or authenticator enrollment.
  Reporting, Protocol Admin and Donate remain inactive. Auction 66 is complete
  and must never be replayed.
- Exactly next step: publish and verify the bounded second-passkey interface,
  then complete the authorized email, operator and Donate activation using their
  separate journals; native authenticator confirmations remain human actions.

October 2 auction 66 continuation (completed):

- HEAD remains `4e67451617be3bf96dc814026d45243f82f1b2b7`. The September 30
  uncommitted implementation remains intact, with a tracked patch and new-source
  recovery archive in `output/recovery/auction66-20261002`. No release, migration,
  contract deployment, moderation activation or mainnet operation occurred here.
- Both Base Sepolia RPCs reconciled all eleven previous journal records and the
  pinned Core/NFT hashes. Auction 66 still mapped to artwork 34, remained Active
  after its unchanged deadline, and retained the authorized buyer at 0.011 test
  ETH with a 0.01 deposit. The new real `before-end` verification passed.
- Exactly three new authorized transactions completed: end auction 66, settle
  with the exact 0.001 test ETH remainder, then withdraw the creator's own
  0.010725 test ETH credit. Token 6 was minted to the buyer, floor became 0.011,
  active auction mapping cleared, and treasury credit increased by 0.000275.
  Treasury credit was not withdrawn; the earlier losing-bidder refund was not
  repeated. [Receipt and verification evidence](PHASE_A_TESTNET_2026-09-29.md#october-2-auction-66-completion).
- All three real settlement verifier stages passed against one explicit
  before-end basis. The separate withdrawal verifier passed exact wallet/Core
  balance deltas including execution and L1 fees, zero creator credit, unchanged
  NFT state and `NothingToWithdraw` for a repeat simulation. Offline verifier
  checks: 31 settlement and 20 withdrawal, all passed.
- Public projection/provenance/indexer reads converged. Eleven actual apex
  browser checks passed: desktop/mobile artwork, token/floor/timeline, creator
  Created and Sales, buyer Owned NFTs and gallery. Zero page exceptions; no
  connected wallet or physical-device acceptance is inferred. The scheduled
  `finish-artsoul-auction-66-rehearsal` automation was deleted after completion.
- Phase A remains open for retained phone/OAuth, connected wallet UI, reviewed
  moderation/operator activation and go/no-go evidence. The separate September
  30 social/email/Donate implementation still needs its final changed-tree
  checks/release and outstanding activation inputs; this heartbeat did not resume
  its DNS/browser setup or merge that diff.
- Exactly next step: resume the existing September 30 candidate's final
  email-session/Donate-recovery browser regression and current-tree release checks;
  never replay auction 66's now-completed operations.

September 30 17:31 desktop follow-up (active):

- Canonical workspace/branch: `C:\Projects\ArtSoul`, `codex/takeover-audit`,
  starting HEAD `4e67451617be3bf96dc814026d45243f82f1b2b7`; tracked tree was clean.
  No new checkout, source overlay or historical worktree integration occurred.
- New recording: 252.90 seconds, 1920x1080, SHA-256
  `91902a2fa6d51624a6960235168d41d3299bf825dd3f8a8267170a53dd7ff370`.
  All 126 two-second samples were visually reviewed. Local chunked speech
  recognition is approximate and is not a verified quotation. Evidence stays in
  ignored `output/audit/video-review-2026-09-30-173100`.
- Confirmed request: remove visible connected qualifiers and manual X editor;
  link verified Discord profile; add private verified email after wallet sign-in;
  reduce measured loading delay; deliver Report/moderation and artist support.
  AI valuation remains excluded. The recording shows an X unlink/relink roundtrip
  and profile cancel/navigation, not every RG-01 mobile or wallet-signature step.
- Existing Report/review/notifications are implemented but disabled. Their schema
  is already applied. Operator passkey/recovery activation conflicts with the
  retained deferral; a narrow decision is pending, not a reason to stop other work.
- Local social changes remove redundant qualifiers and the manual X editor;
  verified Discord links are derived from the server-held provider identity.
  Private email uses existing wallet sign-in, single-use expiring tokens, revision
  fencing and isolated storage. Email/quota schema is unapplied; mail delivery is
  not configured locally. A catalog-only read confirms the quota prerequisite is
  absent, so a separate quota-only migration avoids applying unrelated launch work.
- Loading work adds gallery head prefetch and prioritizes the three public page
  entries before legacy wallet/contract modules. Controlled 390px runs reduced
  gallery first-card mean from 2188.95 to 1273.40 ms with one feed request per run.
  Built connected-wallet readiness and confirmed-auction propagation checks pass;
  this is controlled local evidence, not a production timing percentile.
- Artist support has a separate local contract, bounded indexer projection/API,
  optional artwork UI and wallet adapter. The dated canon amendment records the
  earlier implementation request and unchanged full-creator/no-benefit economics.
  Combined contract checks: 46/46; unit-runner checks: 6/6. Donation API, projection
  and adapter checks: 20/20; event-source checks: 7/7; isolated real PostgreSQL
  indexing/reorg/RLS checks: 9/9. Raw NUL message bytes are retained as hex before
  PostgreSQL ingestion. No new contract is deployed and feature flags remain off.
- Profile-focused verification passes 192/192; the fresh built social/email matrix
  passes 11/11, including the disabled/missing feature flag and wallet race cases.
  Moderation API/compatibility checks pass 46/46, combined real PostgreSQL review
  journeys 32/32, and ten built admin checks pass at desktop/mobile widths. Three
  normal-click report groups pass with two intercepted writes and no external write.
- The full changed-tree run passes 1,487/1,487 with zero failures/skips in
  `output/audit/desktop-followup-unit-final-2026-09-30.log`. Subsequent independent
  review found Donation signer, receipt recovery and event-time edges; their final
  source and regression completion must precede a fresh release result. Do not
  present that earlier full run as verification of those last changes.
- All current work is local and uncommitted. Existing AI valuation files remain
  excluded. No database migration, external mail or chain write was performed in
  this follow-up. Local builds pass 11 routes and 177 CSS utilities. Resend login
  confirmed only the separate ArtSoul OS domain was verified; Protocol sending
  configuration is still being prepared, not asserted active.
- Exactly next step: finish the bounded Donation recovery/timestamp regression,
  rerun the current suite/build, then release the reviewed inactive-feature candidate.

September 30 prior release (retained evidence):

- Published application revision: `aacbc5aedd76f7d668f1db3f1f0ca2ed1bdb0531` via [PR #284](https://github.com/maysonkiller/ArtSoul-Protocol/pull/284). The single checkout fast-forwarded to the exact merge. Subsequent evidence-only commits do not change this application artifact. Candidate CI `36718205321` passed Linux, Windows and static jobs; post-merge run is `36719161906`. Production deployment `6760112584` succeeded at 13:06:02 UTC, immutable host `artsoul-pdcnfoeux-maysonkiller-be9112b5.vercel.app`. Preview and apex JS/CSS hashes match the checked local build.
- TA-09 repair is published and read-only apex acceptance passed: real saved profile, one X link/no overflow, artwork 28/current auction 68 Live at 1280px and 390px; no page exceptions, no failed HTTP requests in the recorded smoke matrix. All 13 built profile fixture groups passed (edit/recovery 7, Discord/X restoration 4, tab continuity 2). No fixture is being promoted to real OAuth or physical-device evidence. [Release evidence](RG01_PROFILE_VIDEO_2026-09-30.md) contains exact tests, limits and rollback baseline.
- Current RG-01/RG-03 video correction: canonical checkout `C:\Projects\ArtSoul`, branch `codex/takeover-audit`, base HEAD `82ab404e4e9b2b0d2949e1017f0aed990739e131`. PR #283 is merged and its CI/post-merge CI passed. All historical worktrees remain recovery copies. No consolidation, overlay or new checkout is needed.
- Founder-corrected scope: AI valuation is intended, not a video defect. The unsolicited AI client/handler/tests were reverted; exact rejected drafts survive privately under `output/recovery/rejected-ai-changes-2026-09-30/`. Current artwork changes affect only the loading tree. Auction IDs, publication, prices, contracts and provider authentication semantics are unchanged.
- Local TA-09 diff covers profile OAuth return, committed profile versus edit draft, normalized saves, delayed-response guards, read-error Retry, deduplicated/wrapping social links, tab viewport continuity and shared static/React loading feedback. Cache references and generated Tailwind CSS follow these edits. New and adjusted tests plus `RG01_PROFILE_VIDEO_2026-09-30.md` record the bounded scope. Do not stage `.codex/`, `output/` or private evidence.
- Final local verification: 1,380 Node tests passed without failure/skip (`output/audit/rg01-release-unit-2026-09-30.log`), build passed 11 routes / 177 utilities (`rg01-release-build-2026-09-30.log`). An earlier run found one outdated CSS-version assertion; its failure log remains retained. Twelve built-browser loading combinations and module Retry passed; mobile wordmarks compute to 40px and desktop to 84px with reduced-motion animation disabled correctly. Four additional homepage/gallery loading-to-completion cases passed. Baseline published-entry React errors 418/423 are absent. Tab layout reproduced the original 380px jump and retained position after repair.
- Independent final review: 104 focused checks passed. Deferred probes verify old save/create responses cannot repaint a changed wallet; unlink replaces the pending initial gallery with the latest tab; an avatar upload survives same-edit unlink; failed uploads restore the draft correctly; Cancel and wallet changes do not revive stale drafts. The implementation-focused profile suite passed 171 checks.
- Built profile journey: seven groups passed on desktop/mobile, covering Cancel, normalized Save, unlink/Cancel/reload, failed read/Retry, failed refresh preserving identity, delayed Save after wallet change and module failure/Retry. Five local intercepted writes, zero page errors (`output/audit/profile-edit-built-browser-2026-09-30.log`); four built callback cases and two built tab cases also passed.
- Remaining gate: physical-device OAuth/wallet return/reload/lock and the separately deferred A8 operator activation ceremony are not completed by these fixes. Reporting/admin flags remain off. No database duplicate-profile conclusion is claimed from the apparent blank-profile symptom. The original Phase A acceptance status is not silently changed.
- Exactly next step: record the real iPhone RG-01 return/reload/lock and OAuth acceptance on the published apex revision; keep the existing auction-66 settlement handoff scheduled for its actual deadline and do not replay prior transactions.

Earlier September 30 baseline (retained evidence, superseded status where stated above):

- Application HEAD: `9dcf82bda0619e1009dcdadc0268f63b78f7a6f8`, PR #282 merged and deployed. Candidate CI 36636435784 and post-merge CI 36636763773 passed Linux, Windows and static jobs. Production deployment 6746439656 succeeded; apex artifact hashes and actual profile behavior match. PR #281 newsletter durability merged separately; its route remains unwired.
- One canonical working tree: `C:\Projects\ArtSoul`, branch `codex/takeover-audit`. Historical worktrees are recovery copies; no overlays or divergent active implementation. The schema/release records and read-only SQL verifier checks are tracked in [PR #283](https://github.com/maysonkiller/ArtSoul-Protocol/pull/283); inspect its actual CI/merge state when resuming. No new app or contract patch is pending. Preserve untracked `.codex/`, `output/` and ignored private evidence; stage only named public files.
- Eleven real Base Sepolia transactions are confirmed by two RPCs: resale purchase/approval/listing/second purchase/withdrawal, no-bid ending for artwork 28, and artwork 34 registration/auction 66/two bids/full losing-bidder refund. Never replay journalled operations. The three old authorized accounts are already DPAPI-encrypted locally; the clean founder wallet remains excluded. No key reimport or transcript search is needed.
- The real apex SIWE/Gemini/storage journey passed all 13 checks. Artwork 34 remains unminted/no floor, auction 66 leads at 0.011 test ETH. Current recorded end: September 30 21:25:20 UTC (23:25:20 Warsaw); re-read the actual deadline, winner and payment before fresh plans. Existing token 4 verifies three distinct provenance roles. See [testnet evidence](PHASE_A_TESTNET_2026-09-29.md).
- Published fixes include portrait containment, Base Sepolia profile explorer, truthful Genesis boundary, current-bid card price, zero-token classification, v16 cache references/guard and recipient notification history. Final local application suite passed 1341 checks, no failures/skips; build passed 11 routes / 178 utilities. Log: `output/audit/phase-a-release-unit-final-2026-09-29.log`. Both hosted platforms passed 33 unchanged contract tests. Windows CI initially exposed the child-pipe UTF-8 BOM issue; the corrected candidate passed genuine Windows DPAPI/BOM regressions before release.
- Live notification read initially returned 503 because all A8 tables were absent. Four unchanged reviewed A8 SQL migrations now committed under advisory lock, backup/hash checks and pre-COMMIT assertions. Eight tables, seven RPCs and five sequences pass isolation checks; all feature tables remain empty. No role, credential, grant, report or decision was inserted; all activation flags remain off. Fresh real SIWE notification reads now return 200, wrong wallet 401, bad cursor 400, logout 200. [Schema report](PHASE_A_A8_SCHEMA_2026-09-30.md) records exact hashes and limitations.
- Full and schema-only backups are private and readable; no restore drill is claimed. The database remains historically pre-ledger; no baseline entries were invented. General verification found no RLS/grant/classification violations and unchanged existing policies/Storage. The read-only verifier now includes all eight A8 and three existing A11 metric tables. Focused doc/security tests: 32 passed, zero skips.
- Local complaint/review/notification engineering: 52 focused checks, 11 real PostgreSQL journeys and 10 built-browser scenarios passed. Two newsletter requests were captured locally; no external email delivery or real staff decision is claimed. Empty live history proves availability, not recipient delivery after moderation.
- Founder deferred real passkey/recovery ceremony to Phase C before dependent activation. Phase A remains NO-GO pending actual device/OAuth and connected UI feedback, live moderation acceptance and A10. TA-08 is now done with deployed evidence; the historical 83-row register remains 64 done / 19 in progress. No mainnet, DNS, deployed-contract or economics change.
- One-time follow-up `finish-artsoul-auction-66-rehearsal` remains scheduled for September 30, 23:35 Warsaw in this chat. The app/computer must be running. Re-read chain state and immutable journals first; future settlement is not claimed.
- **Exactly next step:** at the existing September 30 23:35 Warsaw continuation, re-read auction 66 through both RPCs and prepare its authorized ending/settlement only if the actual deadline, winner and payment still satisfy the recorded testnet policy.

September 29 initial preparation — historical, superseded by the current block above:

- HEAD remains `1d8877a6579bd57c3aa504a141540ae356c5e081`. Prior documentation edits are preserved. Added `scripts/testnet-wallets.ps1`, `scripts/testnet-wallets.mjs`, `test/testnet-wallet-import.test.mjs`, and `docs/runbooks/TESTNET_WALLET_IMPORT.md`; these are local and uncommitted.
- The founder requested autonomous testnet verification and local wallet import. The importer accepts individual keys through hidden interactive input, validates the expected address and private exclusion policy, uses DPAPI plus restricted ACLs, and atomically preserves existing records. It has no signing/broadcast operation. The newly designated founder address is excluded privately; no role or Genesis assignment was made.
- A visible import window was started but later found closed; public status showed zero imported accounts. `Prepare` successfully initialized the vault without keys. User-submitted recovery material in chat was not copied into commands, source or custody files. Do not solicit or repeat it. The operator must complete the local hidden import; a process ID or a chat message is not custody evidence.
- Fresh existing checks: 1212 Node checks passed in the initial managed run, followed by all 46 PostgreSQL checks from the seven initially skipped suites under permitted Docker access: 1258 existing checks passed in total, no unresolved skips. All 33 contract tests and the build (11 routes / 178 utilities) passed. Evidence: `output/audit/phase-a-local-verification-2026-09-29.json`. Existing historical Docker material was preserved.
- New importer checks: 6/6 passed, zero skips, including an actual Windows DPAPI/child-pipe/file roundtrip. Log: `output/audit/phase-a-wallet-import-tests-2026-09-29.log`. Initial failures exposed an inherited PowerShell module-path issue; explicit built-in imports corrected it. Independent security review found partial-write and unchecked-existing-record risks; atomic rename, record/policy checks and decryption/address revalidation fixed both. Final review found no blocker for interactive import. `git diff --check` passed.
- Safe/config read-only revalidation: two independent RPC snapshots agree at Base Sepolia block 47448680; version 1.4.1, threshold 2 of 3, nonce 5, unchanged handler/singleton, balance 0.088 test ETH. Active Core/NFT wiring is consistent and Core is not paused. The Safe is not the owner/pending owner of these contracts or Core treasury. Apex contract config matches the local file. Full addresses and evidence remain in ignored `docs/private/safe-revalidation-2026-09-29T07-07-35-704Z.json`; human custody and A8d are not proven by read-only checks.
- Limits: no signing, broadcast, OAuth, mobile ceremony, passkey enrollment, production migration, moderation activation, mainnet or DNS change. Phase A remains 64 done / 19 open. Do not mark resource/device gates complete from automated tests. The existing application build does not publish these new local operator scripts.
- Exactly next step: complete the hidden local import of the existing three test accounts, read their public metadata, then prepare a bounded testnet plan against their actual assets. Resume final-origin device acceptance alongside that work; do not silently substitute script transactions for phone/wallet UI evidence.

September 28 owner-instructions update (documentation only):

- Current HEAD: `1d8877a6579bd57c3aa504a141540ae356c5e081`. Published stabilization remains `81627ab`; PR #281 is a separate draft. No new deployment, signing, enrollment, migration or activation was performed.
- The owner requested a complete Russian Phase A procedure and an explanation of optional local test-wallet automation. The private guide is `docs/private/PHASE_A_FOUNDER_ACTION_RU.md`, excluded by the existing Git ignore rule; it contains no credentials. All 19 remaining rows and TA-01/02/06 are mapped. Redesign remains future work.
- Corrected the device sheet's stale count, test-funding claim, post-mint Owner rule, insufficient A-83 criterion and incomplete A-78 coverage. The close-out now follows the dated RG-01 form: one person may perform all real-device blocks using distinct wallets/profiles. Independent Safe custodians remain required.
- Corrected migration instructions to match the existing route and rollout: passkey-only flag, audited bootstrap, enrollment, Safe recovery, then admin and reporting. Clarified staging versus final-origin enrollment and the actual A8 verification queries (no embedded transaction wrapper); the recovery gate's final RP/origin evidence requirement remains in force. Independent review also corrected post-resale provenance timing, retained the nested RPC error acceptance in A-33, and accounted for prior report usage in the quota scenario.
- Validation: `node --test test/phase-a-close-out.test.cjs test/migration-ledger-coverage.test.cjs test/security-migration.test.cjs` passed 30/30, zero skips; `git diff --check` passed. This verifies the documentation/security checks, not new connected-device or production acceptance. No new application build was needed for these Markdown-only edits.
- Pending tracked diff: this checkpoint, `docs/PHASE_A_CLOSE_OUT.md`, `docs/testnet/PHASE_A_DEVICE_ACCEPTANCE_SHEET.md`, `docs/security/MIGRATION_RUNBOOK.md`, and `docs/runbooks/A8A_PASSKEY_FOUNDATION.md`. Pre-edit copies are retained in `output/recovery/phase-a-instructions-2026-09-28`. Existing `.codex/` and `output/` remain untracked and must not be bulk-staged.
- Risks/interpretations: a private key is not intrinsically testnet-only; an independently reviewed restricted local signer is an optional future implementation, not an existing capability or a Phase A requirement. Real phones, OAuth consent, passkey user presence and independent Safe signatures cannot be replaced with fixture evidence. Fault-injection rehearsal topology must be concretely reviewed before activation. No architecture or economics amendment was made.

- Published stabilization: `81627ab5d5d5f17ed190aad352e56af701f724c5`, merged via PR #280 after exact-candidate Linux/Windows CI and preview acceptance. The canonical workspace fast-forwarded to this merge. Subsequent commits on this branch contain the separate inactive newsletter correction and acceptance records, not another production rollout.
- Production: successful deployment `6691460363`, Vercel `7GkotETLCoSRM8gKwsAMur2VCWua`, at 11:13:22 UTC. Apex and immutable deployment match the reviewed artifact. Rollback reference is `6470347826` / `607f213`. See `STABILIZATION_RELEASE_2026-09-27.md` for URLs and evidence.
- Workspace recovery: original checkout was an ancestor 47 commits behind, with three line-ending-only dirty files. Byte backups/patches were preserved; 77 implementation files and 86 evidence files were reconciled without collisions. The old Codex worktree remains detached and locked as an archive. No overlay, hard reset, clean, blind merge or unknown-file removal occurred. Recovery snapshots and historical worktrees are not active implementations; see `../WORKSPACE.md`.
- Completed profile/AI/auction patches are included in the published build: OAuth-owned provider identities versus public links; bounded AI media reads and honest valuation/upload states; confirmed-receipt reconciliation, current-round/request guards, shared auction form, exact decimals/deposit explanation and wallet-address checks. Existing Base economics and deployed contracts/storage are unchanged. Full reproduction/patch evidence: `STABILIZATION_EVIDENCE_2026-09-21.md`.
- Hosted stabilization verification: runs `36314685277`, `36314843935` and post-merge `36315006251` passed Linux, Windows and static checks. Linux passed 1,227 Node tests with no skips; Windows passed 1,181 and skipped seven PostgreSQL suites that Linux executed. Both passed 33 contract tests. Build: 11 routes / 178 Tailwind utilities.
- Clean-install correction: npm 11.6.2 selected optional CDP 1.57 against the locked 1.55. A fresh-metadata reproduction failed before the scoped override and passed afterward, with no lockfile change. Actual clean install, 184 wallet/navigation checks and build passed. Source fingerprints: `output/audit/release-source-manifest-2026-09-27.json`.
- Apex acceptance passed: guest SDK, gallery/profile/artwork 28 and auction 63 consistency, decoded media, provenance, desktop/mobile viewport layout, disabled Collection Publish, four Back-button theme switches and reduced motion. Base Sepolia indexer healthy / zero lag; legacy Ethereum Sepolia stopped by design; reporting flag false. No application writes, wallet signatures or OAuth were performed. Only ordinary SDK telemetry ran during the uninterrupted Back-cache probe. All task browsers are closed.
- A-79 closed with a real desktop profile load: first request limit 24, identity before cards/full corpus, no settled-content reset. TA-07 closed on deployed Back-button behavior. A-48 desktop portion passed in ordinary headed Chrome with a surviving marker and `pageshow.persisted=true`; phones remain open. A-33 still lacks real transaction-feedback acceptance and a three-distinct-address provenance example: five of 34 public records were minted, none satisfied that latter case.
- A-38 bounded triage/rollout accepted. Current conservative audit count: 64 package findings (26 high / 19 moderate / 19 low). The six extra parent-package warnings inherit existing CDP/Axios findings; repeated unchanged-tree audits and the installed npm calculator reproduce the cache-dependent 58-to-64 difference. All six are in the browser wallet graph, not API/indexer entry graphs. Residual risks are documented, not waived. See `DEPENDENCY_TRIAGE_2026-09-23.md` and `output/audit/release-audit-disposition-2026-09-27.md`.
- Next Collection Launch slice implemented locally: newsletter consent/token hash persist before provider calls; duplicates keep active tokens; explicit resubscription uses conditional writes; unsubscribe fences stale snapshots; send completion never rewrites opt-out. Independent review found and reproduced a daily-quota trap, then verified the correction. The handler is still unwired, SQL unchanged/unapplied, flags unactivated, and no real email was sent. See `NEWSLETTER_DURABILITY_2026-09-27.md`.
- Newsletter evidence: original handler failed 11 checks; the additional quota-flow regression failed before repair; final focused command `node --test test/newsletter-durability.test.mjs test/security-migration.test.cjs` passed 50 checks. A preceding combined run passed 1,257 with no skips; the final 1,258-check run exposed only a documentation wording assertion, corrected and followed by eight passing documentation checks. Failed logs remain retained. Consult the follow-up PR checks and `output/audit/newsletter-publication-2026-09-27.json` for subsequent hosted verification.
- Phase A remains NO-GO: 64 done / 19 in progress / 0 planned across the historical 83 rows. Remaining gates include real iPhone/Android and connected-wallet/SIWE/OAuth acceptance, separately approved ordered moderation migrations/activation, two founder passkeys, audited bootstrap and Safe recovery success/denials. RG-02 mailbox is deferred to C14. `../PHASE_A_CLOSE_OUT.md` and the device sheet hold the specific criteria.
- Collection builder/capability review, isolated contracts and service drafts are preserved. Publish remains disabled; full service wiring, durable delivery, verified email ownership, unsubscribe availability while sending is paused, real providers, final launch terms and deployment remain unfinished. No Genesis rights, fees or proposed supply became approved economics.
- Authorization: only PR publication and the reviewed existing application rollout were approved. No moderation activation, production migration, indexer-host change, contract deployment, mainnet, DNS or irreversible operation occurred. Private keys, passkeys and operator ceremonies cannot be substituted with test fixtures.
- Current diff discipline: save only named source/tests/docs; `.codex/` and generated `output/` remain untracked evidence/recovery material. Do not stage the entire workspace. No foreign uncommitted code was overwritten.
- September 27 next step (retained history): complete the apex RG-01 acceptance trip on a real iPhone with its owner-controlled wallet, recording results in `docs/testnet/PHASE_A_DEVICE_ACCEPTANCE_SHEET.md`; keep the inactive Collection service follow-up separate from production activation.
