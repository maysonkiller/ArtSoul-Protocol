# September 30 profile and loading correction

Status: implemented, tested, built and published. TA-09 repair is complete;
real-device RG-01 and dependent operator activation acceptance remain separate.
Workspace: `C:\Projects\ArtSoul`, `codex/takeover-audit`, baseline
`82ab404e4e9b2b0d2949e1017f0aed990739e131`. Historical worktrees remain recovery
copies. No source trees were overlaid.

## Release

- [PR #284](https://github.com/maysonkiller/ArtSoul-Protocol/pull/284) merged
  reviewed candidate `f293733685194ae96102116874204fd8503e1af3` as
  `aacbc5aedd76f7d668f1db3f1f0ca2ed1bdb0531` at 13:05:27 UTC.
- [Candidate CI](https://github.com/maysonkiller/ArtSoul-Protocol/actions/runs/36718205321)
  passed Linux, Windows and static checks. Linux passed 1,378 tests and skipped
  two Windows DPAPI cases. Windows passed 1,323 and skipped eight PostgreSQL
  suites because hosted Windows lacks Docker; Linux executed those suites.
  Both platforms passed 33 unchanged contract tests. The local Windows/Docker
  run executed all 1,380 application tests without skips.
- Production deployment `6760112584` succeeded at 13:06:02 UTC:
  [immutable artifact](https://artsoul-pdcnfoeux-maysonkiller-be9112b5.vercel.app).
  [Post-merge CI](https://github.com/maysonkiller/ArtSoul-Protocol/actions/runs/36719161906)
  also passed Linux, Windows and static checks.
- Preview and apex profile/artwork JS and every linked built stylesheet match
  the locally checked artifact hashes. Real public reads on desktop/mobile
  viewports passed at both origins: the saved profile renders one X link with
  no overflow, and artwork 28 renders current auction 68 as Live. No page
  exceptions or HTTP failures occurred during these four-case smoke runs.
  Earlier preview warm-up saw a WalletConnect telemetry 403; it was not an
  application/profile failure and did not recur in the recorded smoke matrix.
- No application write, wallet action, schema change, contract deployment,
  mainnet action or activation was performed by the release smoke checks.
  Reporting remains disabled. Rollback baseline is `82ab404`; no rollback ran.

Local evidence: `output/audit/rg01-{preview,apex}-artifact-2026-09-30.json`,
`rg01-{preview,apex}-live-browser-2026-09-30.log`. These files remain private
generated evidence rather than public source additions.

## Scope correction

The founder explicitly rejected the initial AI-valuation diagnosis. The existing
valuation behavior is intended. The unsolicited client, artwork-page AI handler
and valuation-test changes were restored to the baseline; the rejected draft is
retained only in private recovery material. No AI authentication/retry interface,
auction ID, publication, contract, pricing or economic change belongs to this fix.

The two September 30 recordings inform RG-01/RG-03 profile and loading acceptance.
Desktop duration is 9:33.60 and iPhone duration is 3:29.73. Machine audio output is
not a verified quotation; the iPhone audio stream contains no audible signal.
The older September 21 report is not being reanalysed.

## Evidence and changes

| Observed symptom | Reproduced cause | Correction and regression coverage |
| --- | --- | --- |
| Desktop 02:59–04:13: returning from Discord/X shows a blank profile; Save reads `null.username`; reload restores it | The OAuth callback captures an empty wallet before restoration, then schedules a profile load that clears the identity. An unchanged stored-wallet signal can suppress the subsequent reload | Resolve the read address after readiness, force a fresh public read, retain ownership checks, guard save before and after asynchronous work; actual React fixture reproduced the baseline exception |
| Desktop around 04:35–04:49: Cancel leaves edits visible | Inputs mutate the committed profile directly | Keep an edit draft; Cancel discards it; successful Save commits the server-normalized result; delayed avatar/save completion cannot repaint a different wallet or cancelled edit |
| Desktop around 04:49 and iPhone 01:21–01:25: repeated X links and overflowing social labels | OAuth and public-link render branches independently display the same account; mobile CSS forces nowrap and unbounded width | Deduplicate the same normalized X account, retain different public links, use consistent badges and wrapping. No stored data is deleted and public links grant no identity verification |
| A failed profile read can look like a new empty profile | Rejected reads and a successful `null` result share the fallback | Distinguish read failure from an absent record, retain existing content on refresh failure and provide Retry; only a successful absent-record result permits the new-profile form |
| Desktop tab switches move the page | Removing a long outgoing list collapses document height before the next tab renders | Reserve the visible gallery area before replacement; reset the reservation when the profile identity changes |
| Targeted reproduction: unlink during the first slow gallery read leaves loading stuck | Unlink invalidates the initial request without starting its replacement or retiring its pending-address marker | Preserve the confirmed identity and draft, then reuse the fresh profile loader for the currently selected tab. Resolve the replacement Sales feed before the stale Created feed in the regression test |
| Desktop around 07:49–08:01: changing loading presentations | Static placeholder cards and React loading branches use different presentations; the published-entry branch additionally changes the hydrated root | Share the existing branded loading mark across static/React profile and artwork entries; keep gallery loading compact. Local built-browser reproduction recorded React hydration errors 418/423 before the correction. No publication/ID behavior changes |

Profile module failure also gets a bounded retry panel rather than an indefinite
loader. Homepage and gallery use the same compact artwork-loading feedback.
Explicit font inheritance prevents a generic mobile span rule shrinking the
wordmark to 14px. Existing theme variables and reduced-motion rules apply to the
shared mark; no dependency was added.

## Interpretation and reversibility

The founder's September 30 direction treats the canon as a reference baseline for
documented improvements, not an excuse to reject requested UX changes. This
patch touches provenance/display (Bible §5 / part 05), loading/theme presentation
(§16 / part 16) and Phase A verification (§17 / part 17). It makes no architecture
amendment. Previous behavior and replacement are paired in the table above.

Different self-reported and connected X handles remain separately visible;
identical handles produce one connected badge. Cancel discards unsaved form
fields, while a completed server disconnect remains effective. These are explicit
UX interpretations, not new provider-verification rules.

Rollback is a reviewed Git revert of this bounded release, followed by rebuild
and deployment of its parent artifact. There is no database migration, contract
deployment, account deletion or irreversible data cleanup to reverse. Existing
local recovery copies are under `output/recovery/` and are not public artifacts.

## Verification boundary

The final local `npm run test:unit` passed **1,380 tests**, zero failures/skips
(`output/audit/rg01-release-unit-2026-09-30.log`). `npm run build` passed **11
routes / 177 Tailwind utilities** (`output/audit/rg01-release-build-2026-09-30.log`).
The focused profile suite passed 171 checks. Additional review caught and repaired
an avatar-completion fence that incorrectly treated a same-wallet unlink as a
cancelled edit; the deferred regression failed before that repair and passed
afterward. The Cancel and wallet-switch fences remain covered.

The loading browser matrix passed twelve combinations of desktop/mobile,
Classic/Future and profile/artwork/published entry, with no React errors, no
synthetic shapes, readable 40px/84px wordmarks and no reduced-motion animation.
The failed-module Retry appeared as expected. Actual React tab layout reproduced
a 380px baseline jump; both fixed viewport sizes retained position while loading
and after the empty result. Mobile social geometry improved from 12 overflow
cases to zero across the checked widths; desktop geometry stayed unchanged.

Seven built edit-journey groups passed: desktop/mobile Cancel, normalized Save,
unlink/Cancel/reload retaining the same profile row, failed initial read/Retry,
failed refresh preserving identity, delayed Save after a wallet change, and module
failure/Retry. There were five intercepted local writes and zero page errors
(`output/audit/profile-edit-built-browser-2026-09-30.log`). Four built homepage/
gallery loading-to-completion cases also passed without synthetic cards or page
errors. Independent final review passed 104 focused checks and the deferred
save/create, unlink/gallery and avatar completion/negative probes.

Four additional built Discord/X restoration cases and two built tab-switch cases
passed with zero page errors. The full profile browser set therefore has 13
case groups, recorded in the edit, OAuth and tab built-browser logs.

Previous
full-suite/build results from before the scope correction are not evidence for
this candidate. Browser fixtures replace wallet/OAuth/API
responses locally and perform no live writes. They do not prove real OAuth
consent, iPhone/Android wallet handoff, passkeys, Safe recovery or staff activation.
Those gates must retain their actual recorded status.
