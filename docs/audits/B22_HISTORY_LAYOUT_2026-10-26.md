# History layout follow-up

## Scope and reproduction

Continued in `C:\Projects\ArtSoul`, branch `codex/takeover-audit`, starting
at `890af55`. Production application code was `276d894` (PR #368).
The two preceding branch commits record that release and its corrected fixture
evidence. Unrelated untracked authority-policy files, `.codex/` and `output/`
are preserved.

On the live artwork 34 page, Donate -> History still inherited the old inline
history limit: client height 180px for 309px of content. The obsolete ancestor
`:has(.artist-support-history)` rule also changed the underlying Donate wrapper
to full width. These rules predated moving history into Donate in PR #365.
Long history could therefore require its own small scrollbar inside the modal
and change Community layout behind it.

## Change

- Remove the inline-history height/overflow and ancestor-width rules.
- Keep one scroll region for the active Donate/History content. Title, close
  control and tabs sit outside that region, so they cannot cover focused links.
- Bound the modal to the dynamic viewport. Wrap long donor names/messages and
  keep the full text available. Preserve theme variables and readable inputs.
- Use explicit Previous / Page / Next controls. Reset content position only on
  opening, tab changes, sorting or pagination; ordinary updates and return from
  Report message retain the reading position.
- Bump the shared stylesheet to v52 on every root shell, with matching guards.

This is a B-22 UX follow-up, touching canon 05/16 presentation and preserving
07 complaint handling. No economics, contract, schema, role, notification
delivery or authentication changes. Full provenance remains indexer-backed.
No new dependency. Interpretation: necessary scrolling for long history stays;
the unnecessary nested scroll region and background relayout are removed.

## Local verification

- Final targeted suite: 187 passed, zero failures/skips. Includes donation
  operation state, message reporting, lazy history reads, stale response
  cancellation, tab navigation, position preservation, report dialogs,
  provenance, notification rendering, shell and cache guards.
- `npm run build` passed; 11 HTML routes and 174 Tailwind utilities verified.
- Actual Donate component with synthetic 20-entry history: ten browser cases,
  Classic/Future at 320x740, 390x844, 768x900, 1440x900 and 740x320. One content
  scroller, no horizontal overflow or background button movement, reachable
  pagination, correct page/tab reset, Report return position, Shift+Tab focus,
  and close return focus. Zero page script errors; no API writes.
- Other surfaces: four live read-only artwork 34 checks (Classic/Future,
  390/1440px), plus eight synthetic inbox checks (20 activity messages and one
  report update). Provenance has no nested scrollbar; Report and notification
  settings stay within the viewport. Inbox uses one scroll region only when
  content needs it. Zero page script errors.
- The initial inbox fixture incorrectly returned 30 rows, exceeding the real
  API's 20-row validation bound. Corrected the fixture and repeated the checks;
  this was a fixture failure, not a product defect.
- A sticky-heading draft was replaced with a separate fixed header/content
  layout after review identified possible keyboard-focus occlusion. All final
  Donate browser cases and the final targeted suite use the revised layout.

Evidence (local, untracked): `output/audit/history-layout-final-tests.log`,
`history-layout-build-final.log`, `history-layout-browser.log`,
`history-other-surfaces.log`; screenshots `output/playwright/history-*.png`.
No new physical iPhone/Android, authenticated Admin, wallet-signature or
financial acceptance is claimed by this layout check.

## Release and continuation

Local implementation and build complete. Exact-candidate CI, preview and
production verification pending. Phase B is not complete. After release,
resume B-21 Donate/Report preparation through existing dialogs with deliberate
human review and submission.
