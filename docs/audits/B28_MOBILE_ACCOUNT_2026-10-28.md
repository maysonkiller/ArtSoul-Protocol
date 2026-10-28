# B28 mobile account label and avatar

Date: October 28, 2026. Workspace: `C:\Projects\ArtSoul`, branch
`codex/takeover-audit`. Start HEAD: `26883c59` (PR #380).
Status: RELEASED in PR #381. Candidate `329f98dc9e83455004207bbb46a9515cec93f9f0`;
production merge `9faffe2d7797b2caec111ad7da2922d49bb33a74`, identical source tree.

## Reproduction and cause

The founder's iPhone screenshot shows `ArtSoul Gu...` after homepage reload.
The shared stylesheet first reserves a 168px mobile account button, then its
last media queries override it with 144px / 84px of identity space below 480px,
and 100px / 48px below 360px. All markup and runtime paths still contain the
complete guest label. The label barely fits the Windows system font at 84px;
the screenshot establishes truncation on iOS. The old 48px column truncates
even the Windows guest label. The avatar itself remains square and contained:
there is no evidence of corrupted image data.

## Change and interpretation

- Replace those conflicting final sizes with 160px and a flexible identity
  region. Compact gutters recover space without reducing tool touch targets.
- At 320–374px, use 120px, a smaller site logo and two available identity lines
  for guests or unnamed wallets. Keep the account avatar at 29px and all three
  tools at 44px. The account button is now 44px high on mobile too.
- Long profile names may still truncate deliberately; the full profile remains
  available through the existing account menu. Guest labels and the ordinary
  shortened unnamed-wallet label fit in full. No new placeholder identity.
- Preserve the notification slot, cached-identity fences, guest/connected state
  and authentication. No delayed JS resizing. Shared stylesheet v59 on all ten
  consumers; same behavior on the eight shared-header product pages.

This is presentation under Bible section 13 and Phase B, not an architecture
amendment. The compact breakpoint includes 361–374px because classic desktop
scrollbars also consume space during narrow-window use. A one-row header and
the existing complete avatar take priority over a single-line guest label on
the narrowest screens. No dependency or palette changes.

## Validation

- 170 affected checks pass: header identity, first paint, navigation, notification
  prepaint, guest avatar, artwork layout and runtime cache versions.
- Build: 11 routes / 173 Tailwind utilities. `git diff --check` passes.
- Built Chromium: 176 layouts (eight pages, both themes, widths 320/360/361/374/
  375/390/430/480/481/768/1366), four presentation states each, 704 total. Guest,
  named wallet, unnamed wallet and long name use real shared DOM/CSS; connected
  labels are presentation fixtures, not wallet authentication. No header control
  overlap, viewport overflow, clipped avatar or truncated guest/unnamed label.
- Four actual guest reload cases at 320/390 in both themes: positions/dimensions
  match before reload, at DOM ready and after hydration/fonts. Account menus
  remain inside the viewport. Theme-initialized static markup (component scripts
  disabled) matches hydrated geometry. Screenshots inspected at 320 and 390.
- One bounded read-only review; intermediate breakpoint and continuous unnamed
  address cases included in the final matrix. No helpers left active.

Local evidence: `output/audit/mobile-header-{tests,build,browser,reload}.txt`
and `output/playwright/header-after-{320,390}.png`. Browser runners are retained
locally in `output/playwright/mobile-header-{account,reload}.js`.
Physical iPhone acceptance is not claimed from Chromium responsive testing.

## Release

Exact-candidate CI 40716480161 passed: Linux 2,845 passed / two skipped; Windows
2,450 passed / 32 skipped; both builds/static and 49 contract checks per platform.
Preview deployment 7389737333 and production deployment 7389878595 succeeded.
Eight HTML routes on each host reference the expected built stylesheet
`unified-styles-CBqoDq7g.css`; its content hash matches the local build exactly.
Preview and apex each passed 32 real guest browser cases without response mocks,
API writes or page exceptions: eight routes, both themes, 320/390px and reload
plus account-menu containment. These are responsive Chromium checks, not a
new physical-iPhone acceptance report. Post-merge CI 40717354429 also passed;
the implementation tree matches the green candidate. Owned local preview4228
and browser session `b21draft` are closed; no helper remains running.
The app could not attach PR #381 because this chat already has 100 attachments;
the source remains https://github.com/maysonkiller/ArtSoul-Protocol/pull/381.

Paid voice setup remains deferred; the previous B21 publication preparation release is recorded
in `B21_PUBLICATION_DRAFT_2026-10-28.md`. Phase B remains open.
