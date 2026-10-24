# TA-12: card countdown first paint

Date: October 24, 2026. Baseline: `6321977`, canonical workspace
`C:\Projects\ArtSoul`, branch `codex/takeover-audit`.

Status: **deployed and verified in PR #336**, merge `aac0db3`. This closes only
the timer-initialization cause within TA-12, not Ownership, Provenance or
Protocol activity latency. Phase A acceptance stays unchanged.

## Reproduction and cause

The retained October 23 recording's frames 49.7-50.1 seconds show an empty timer
pill; text appears at 50.2. Reviewing those saved frames does not establish a
layout overlap. On current apex Chrome, creating a detached card with the shared
runtime and public media returned `isConnected: false`, empty text and no
accessible label. No artwork, transaction or stored profile was created.

`createCountdownElement` calls `update()` while its new span is disconnected.
The cleanup guard returns before writing text. The next shared one-second tick
fills it after insertion. The existing test double lacked `isConnected`, so the
test did not represent this browser condition.

## Repair and regression

Initialize text and its accessible label from the already-computed countdown
before subscribing. Keep disconnection cleanup for subsequent ticks. No layout,
auction time, API, RPC, fee, status or theme change. The shared DOM card path gets
the repair everywhere it is used; the React path already initializes its state
synchronously and is retained.

Regression: realistic detached state fails on the original code, then passes
after the repair. Check initial text/label, ticking after insertion, terminal
state, detached cleanup and the one shared interval.

Validation:

- 21 focused countdown/card-control/image tests pass, zero failure/skip.
- The expanded shared-card regression selection passes 64 tests; 23 existing
  documentation checks pass and the Phase A count remains 83/0/0.
- `npm run build` passes: 11 routes and 174 Tailwind utilities verified.
- Local Chrome fixture using the real card source and real DOM passes five
  checks: detached initial text/label, first connected frame, advancing count
  and stopping after removal. Its first run had a wrong fixture-avatar path;
  that caused card removal, was corrected, and was not a product defect.
- Evidence: `output/audit/countdown-first-paint-browser-2026-10-24.{json,png}`,
  `output/audit/phase-b-countdown-build-2026-10-24.log`,
  `output/audit/phase-b-card-regressions-2026-10-24.log` and retained video frames.

Limits: the fixture is not a production-release or native-iPhone acceptance.
No additional privileges, wallet operations, data writes or deployment occurred.
No canon ambiguity was resolved: this is display readiness only (sections 5/16/17).
Next: measure remaining Ownership/provenance/activity paths separately and avoid
attributing their delays to this timer bug or weakening auction freshness.

Release follow-up (PR #336): full Linux CI caught an omitted cache-version bump
for the changed classic card runtime. The four HTML consumers (home, gallery,
profile, artwork) now load `artwork-card.js?v=20`; the normalized-content guard
records `22c0bb98360c89cc`. The earlier focused tests did not cover this release
requirement. Seventeen cache/version, entry-priority and countdown checks now
pass, and the build passes again. Candidate CI must pass on the corrected head
before production authorization; the initial failing run is not accepted.

Release accepted: corrected candidate `3117def` and source-identical merge
`aac0db3` passed Linux/Windows CI and were published with owner authorization.
The apex serves v20 on all four consumers; actual homepage cards show four
populated live timers. See [release evidence](TA12_ARTWORK_LOADING_2026-10-24.md#production-acceptance).
