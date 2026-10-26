# Profile form and social preview follow-up

Status: implemented and locally checked; candidate release verification pending.

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
- Next step: exact candidate CI/preview, authorized release and public asset /
  legacy redirect verification; then resume B21 Donate/Report preparation.
