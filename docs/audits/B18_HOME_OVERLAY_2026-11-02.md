# B18 — Home showcase and shared-card follow-up, November 2, 2026

## Request and scope

The owner reviewed the PR443 preview and requested a larger artwork area in the
Home banner, caption over a darkened lower edge, and a more compact desktop card
row. They also reported missing actions in the card menu. This slice touches
canon sections 05, 16 and 17 through presentation and acceptance only.

The latest explicit request supersedes the separate, contained-media banner in
the earlier [video audit](B18_VIDEO_HELP_HERO_2026-11-02.md). The banner now fills
its area with the image, so its edges may crop to fit. The full artwork viewer
is unchanged. This is a UI interpretation, not a change to artwork ownership,
metadata, provenance, economics or the protocol lifecycle.

## Changes

- Fill the banner with artwork and overlay its attribution on a lower gradient
  using the existing theme variables. Keep carousel controls below the text and
  retain the removal of hover movement. Desktop height is bounded at 240–280px;
  phone dimensions remain responsive.
- Reduce the gap before the first card row. Make shared desktop card media and
  metadata more compact across Home, Gallery and Profile; six columns begin at
  1440px. Phone controls retain their existing usable target sizes.
- Explain pending or failed action-configuration reads inside the existing
  card menu. Preserve indexed transaction links and retry by reopening. Do not
  start requests when rendering each card or enable unavailable features.
- Open the menu upward when a downward panel would leave the visible viewport
  and there is enough space above. Recalculate after action loading and on each
  opening; Escape still restores focus to the trigger.
- Update stylesheet and shared-card cache versions on all consuming routes.

The reported preview had Donate, Report and Saved disabled in its public
configuration. Production had those features enabled. That explains the
Creation-transaction-only preview menu; the release does not silently change
feature gates. With enabled flags the order remains Donate, Report, Creation
transaction. Saved remains its separate card control.

## Verification

- Build passed: 11 route contracts and 172 required style utilities.
- 163 focused checks passed before the viewport correction; after that
  correction and its regression test, all 32 action/control/cache checks passed.
- Actual built Home, Gallery and Profile routes with isolated fixtures passed
  694 browser assertions over 12 surface/theme/viewport combinations. Coverage
  includes action order, Escape/focus, no accidental navigation, video/audio
  playback, status/price layout and reduced motion. No writes or page errors.
- Ten additional layout cases cover both themes at 320, 390, 1366, 1536 and
  1920px. No horizontal overflow; banner hover transform is absent and caption
  text stays above the carousel controls. The entire first card row fits the
  tested desktop viewports (1366×768, 1536×720 and 1920×900). Phones retain normal
  document scrolling; no claim is made that a whole gallery fits one screen.
- At 390×844 the bottom-edge menu occupies y=531.47 through 693.47 after opening
  upward, with all three links visible. Pending, failure, disabled and recovered
  configuration states were exercised separately.

Media interaction verification used installed Chrome after bundled Chromium
reported unsupported media codecs. Assertions were retained; the fixture was
not changed to hide the playback failure. These are controlled local browser
checks, not real iPhone or wallet-extension acceptance.

Private results: `b18-overlay-layout.json`, `b18-overlay-cards.json`,
`b18-overlay-menu.json`, build/test logs under `docs/private`, and reviewed
screenshots under `output/playwright`.

## Release and remaining gates

PR444 merged as `5876eb5e096b0d5f1b90f224e1e71e68f1ed9c23` at
01:34:25 UTC. Candidate `a176a94d45458e9635f6a642b80675f8d0668763`
passed CI run `41372825109`: Linux 4,078 unit tests with two environment skips,
Windows 3,381 with 35 environment skips, both builds, static checks and 49
contract tests per platform. Independent read-only review found no blockers.

Production deployment `7482199645` succeeded through the normal Vercel release
flow; the earlier PR443 daily-limit failure is historical. No paid upgrade or
limit bypass was used. At 01:41 UTC all eight checked public route shells
returned HTTP 200. The served card v28 and WebMCP v16 content hashes matched the
merged commit; all seven homepage stylesheets matched the validated build.
Private evidence: `docs/private/pr444-production-assets.json`.

The actual production homepage rendered its populated cards and metrics, with
the image filling the showcase and the first desktop card row visible. Its
Taes menu exposed Donate, Report and Creation transaction. This was read-only
inspection, without signing or submitting any of those actions. The preview
address was intercepted by the user's wallet-extension site warning and was
not bypassed; hosted verification used the normal production domain instead.

No dependencies, database settings, server services, feature flags or contract
state changed in this slice. Revert its UI commit and cache references together
to undo it. Native-device, signed-journey and operational acceptance remain in
[Phase B status](../PHASE_B_STATUS_2026-11-02.md); Phase B is not declared complete.
