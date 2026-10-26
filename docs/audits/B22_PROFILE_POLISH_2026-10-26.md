# Profile form and social preview follow-up

Status: released in [PR #370](https://github.com/maysonkiller/ArtSoul-Protocol/pull/370).
Candidate `2e1540834c3e1381863ee6c42b43dca301d056b3`; production merge
`f7d9fa2744d672dbf4ceef43e73f38fad7e79a01`.

Workspace: `C:\Projects\ArtSoul`, `codex/takeover-audit`, started at `a7abe68`.
Scope: October 26 owner screenshot and request; canon section 16 (presentation).

## Reproduction and changes

- The name editor used heading-sized 24px text and the bio reserved three rows.
  Existing placeholder hints had no persistent explicit field labels. The
  profile editor inherited the strong whole-card Future glow.
- Name and bio now have associated labels and short native placeholders. The
  form uses readable 16px input text, a two-line vertically resizable bio,
  bounded desktop width and existing theme tokens. The editing card has a
  restrained Future glow; Classic has none. Public name/bio typography is
  compact and preserves line breaks and long content. Draft handlers,
  save/cancel, OAuth and email behavior are unchanged.
- All six generic public routes already returned the approved v2 banner to
  ordinary and Telegram requests. Artwork links already returned the specific
  artwork preview. The legacy `/artsoul-social-preview.png` still returned the
  old image (JPEG bytes under a PNG MIME type). An exact permanent redirect
  now targets the approved v2 PNG, including requests with the old query string.
  No artwork image or generic metadata is replaced.

## Local verification

- 125 focused tests pass: profile editor/provider placement, social wrapping,
  loading/races, organization, avatars, domain routing and shared asset pins.
  The independent social-preview subset also passed 23 tests.
- `npm run build` passes: 11 built HTML routes, 173 Tailwind utilities.
- Browser comparison uses the actual before/after JSX editor and CSS, with
  synthetic state and no server mutations: Classic/Future at 320, 390, 768 and
  1440px. Eight cases pass labels/focus, disappearing/returning placeholders,
  Unicode typing, long bio scrolling/resizing, no horizontal overflow and
  reduced motion. Name field height changed from about 58 to 46px; bio from
  about 98 to 70px. No page script errors. The fixture's initial favicon 404
  is unrelated to application code; this is not native iPhone acceptance or
  a live profile-save test.
- Screenshots reviewed in `output/playwright/profile-polish-*.png`.
- Evidence: `output/audit/profile-polish-{focused,build,browser}.log` and
  `output/audit/telegram-preview-public-probe-2026-10-26.json`.

## Interpretation and limits

- "Smaller" means less empty space and heading-sized input text, not smaller
  mobile text or clipped biographies. No global palette or behavior change.
- Hints complement labels, following [Apple field guidance](https://developer.apple.com/design/human-interface-guidelines/text-fields)
  and [W3C form instructions](https://www.w3.org/WAI/tutorials/forms/instructions/).
  A reusable local ArtSoul interface-design skill records the design/QA rules.
- The image redirect fixes future old-URL fetches. It cannot evict a social
  platform's stored preview or rewrite already sent messages. No Telegram
  cache-refresh message was sent; the exact cached URL in the user's message
  was not independently observed.
- No contract, economics, schema, authentication or authorization changes.
- Next step: resume B21 Donate/Report preparation through existing dialogs,
  keeping deliberate review and submission. Phase B is not declared complete.

## Release verification

- CI run `40332708745` passed: Linux 2,748 unit tests/two skips, Windows
  2,361/31 skips, zero failures; 46 contract tests on each platform.
  First Windows attempt hit two 20-second PowerShell self-test timeouts in
  unchanged wallet-import tests. A local focused rerun passed all eight tests;
  the failed CI job then passed unchanged on attempt two. No skip, timeout or
  assertion was weakened.
- Preview and apex match the exact candidate: eight routes, 36 assets, expected
  guest access denials. Main-site release is verified, not just the local build.
- Each deployment passed ten metadata requests (five generic routes, browser
  and Telegram user agents) and four old-image redirect checks (plain and
  `?v=1` URLs, both agents). Each returned 308 to the approved v2 PNG; fetched
  bytes match local SHA-256
  `e9b79a3f14cfdd417a0bcd3765264ca2629644620b7764293b27cc2839787fc2`.
- Real public-profile browser checks passed eight theme/width cases on preview
  and eight on apex: no page overflow, header overlap, page script errors or
  API writes. These are public read checks, not a fresh authenticated save or
  native iPhone test. Existing WalletConnect telemetry returned an unrelated
  403; no application exception resulted.
- Evidence: `docs/private/b22-profile-polish-preview-2e1540834c3e-1793022070101.json`,
  `docs/private/b22-profile-polish-apex-f7d9fa2744d6-1793022637973.json`,
  `docs/private/profile-social-preview-1793022152833.json`,
  `docs/private/profile-social-apex-1793022651639.json`,
  `output/audit/profile-polish-public-{preview,apex}.log` and
  `output/audit/profile-polish-ci-final.log`.

## Homepage banner follow-up

The founder's later Telegram screenshot identifies the exact stale URL `/`;
`/artwork/32` already shows the approved glass-sculpture image. Before this
patch, 32 live page requests (eight paths, browser/Telegram/X/Facebook agents),
12 image requests and three HTTP/www aliases all returned the approved v2
metadata or matching PNG bytes. Evidence:
`output/audit/social-banner-apex-1793025555032.json`.

One obsolete artifact remained: Vite copied the old JPEG bytes from
`artsoul-social-preview.png` behind the hosting redirect. The source is now
removed; the build derives that compatibility filename from the single v2
source, so static hosting also returns the approved picture. The exact Vercel
redirect remains. Logos and artwork-specific media are unchanged. Scope is
Bible section 16 display/metadata only, with no architecture amendment.

The new build assertion failed on the previous dist with `Obsolete social
preview in dist: artsoul-social-preview.png`, then passed after the change.
Local domain/artwork-sharing tests: 13 passed; full build: 11 routes and 173
Tailwind utilities passed. Both output image files match the approved SHA-256
above. Logs: `output/audit/social-banner-{regression-before,tests,build}.log`.

Interpretation: removing the old banner means removing its bytes while keeping
old URLs compatible. It does not mean replacing actual artwork media. Telegram
can retain previously generated page previews independently of our HTTP
responses. No Telegram message or cache-refresh bot action has been performed;
refresh of the user's stored preview is not claimed.

Released as PR #372, candidate `d4bc3f6`, production merge `5ba1901`.
CI `40342569351` passed: Linux 2,771/two skips, Windows 2,384/31 skips,
zero failures, 46 contracts on each. Exact preview and apex eight-route/
36-asset verification passed; Vercel's apex alias independently points to the
ready deployment of this merge. Each deployment also passed 32 metadata and
12 image checks, with three HTTP/www aliases checked on apex.
Evidence: `output/audit/social-banner-ci.log`,
`output/audit/social-banner-preview-1793025949376.json`,
`output/audit/social-banner-apex-1793026243584.json`,
`output/audit/social-banner-production-binding.json`,
`docs/private/b22-search-video-preview-d4bc3f610449-1793025930193.json`,
`docs/private/b22-search-video-apex-5ba1901860f5-1793026229186.json`.
No implementation diff remains. Resume B21 Donate/Report preparation next;
this follow-up does not declare Phase B complete.
