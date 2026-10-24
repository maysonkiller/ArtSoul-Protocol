# B15 profile organization

Status: implemented and tested locally; not released by this work item.

Workspace: `C:\Projects\ArtSoul`, branch `codex/takeover-audit`. Work began
at `ad960937a9234b694ea9300101219cfd3461d806`; the shared branch advanced to
`c62935685b6591a3e8e5b110ff0fb56c4168558e` during the independent indexer task.
That indexer diff was not changed here.

## Scope and result

Implements the bounded profile organization in
`docs/architecture/POST_PHASE_A_PRODUCT_DIRECTION_2026-10-24.md` section 4:

- Visible sections are Artworks, Auctions, Collected, Activity, then owner-only
  Saved when enabled. Internal `created`, `auction`, `collected`, `sold` keys,
  predicates, caches, loading continuity and wallet/request fences are unchanged.
- Activity contains the existing Sales subset. Its description identifies
  completed sales of works created by the profile, not a full transaction ledger.
- Connected accounts contains Email, X and Discord in one responsive grid with
  shared row geometry and labelled remove controls. Email remains private and
  owner/session/feature-gated. Email handlers and authentication state are unchanged.
- The editor explicitly distinguishes immediate account connections/removals
  from profile detail Save/Cancel. Public profiles and the private notification
  inbox retain their existing boundaries.

Touches frontend presentation only. Bible sections 5 (provenance), 6 (Trust),
11 (moderation/access), 17 (phase order), and the theme rules in
`16_VISUAL_STATUS_AND_THEME_CANON.md` remain unchanged. No contracts, economics,
database schema, new dependencies or authentication mechanism were added.

## Interpretation recorded

Sales is currently the only available Activity category. It is shown as a named
subsection rather than adding empty or fabricated filters. A future real activity
dataset can extend this view independently. Equal connection geometry means a
shared minimum row size and responsive columns; long identities can wrap instead
of being clipped. B16 personalization, cover images and profile layout storage
are deferred.

## Validation

- `node --test --test-concurrency=4` over `test/profile-*.test.cjs`,
  `test/profile-*.test.mjs`, `test/profile-*.test.js`, and the existing
  `test/saved-*.test.mjs` / `test/saved-*.test.cjs`: **202 passed, 0 failed,
  0 skipped**, rerun after the final copy changes. Includes the disposable
  PostgreSQL email schema checks.
- Final `npm run build`: passed, including verification of 11 HTML routes and
  174 Tailwind utilities. Existing dependency PURE-annotation warnings remain.
- `git diff --check` for the edited source/style files: passed.

New rendering regressions cover section order and stable keys, owner-only Saved,
the explicit Sales scope, private Email mount gates, verified/unlinked/unavailable
email states and the unchanged disconnect/open callbacks.

Root review added isolated Chrome layout checks using the actual render fragments
and synthetic identities only: Classic at 390px, Future at 320px and desktop,
long email/Discord names, linked/unlinked email and its form, labelled 44px remove
controls, Activity/Sales and owner-only Saved all pass without horizontal overflow.
Screenshots were inspected under `output/playwright/b15-profile-*`. The fixture's
only console error was its missing favicon; no application exception occurred.
No live user session, OAuth ceremony or physical-device acceptance is claimed.
Exact-candidate full CI, release and apex verification remain pending.
