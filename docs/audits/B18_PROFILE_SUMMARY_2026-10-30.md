# Profile summary and Discovery entry

Status: implemented and verified locally; release evidence is recorded in the
stabilization checkpoint. This bounded B-18 slice does not close Phase B.

## Scope and cause

The founder requested compact, aligned profile metrics, a centered avatar on
its existing side, an editor that does not grow the summary, and Discovery as
the first/default gallery category. The previous desktop metrics spanned four
implicit grid rows. Mobile used negative margins to pull controls underneath
the avatar. Editing replaced the summary in place and expanded its frame.

The summary now has a real identity group and three aligned metric cards.
Mobile uses full-width grid rows without negative margins. Editing uses a native
dialog outside the summary flow, with one bounded scroller, Escape/Close/Cancel
and focus restoration. Existing draft, save, account connection and wallet
guards are retained. No dependency was added.

Gallery order is Discovery, Auctions, NFTs, Marketplace, Collections. Empty or
unrecognized fragments select Discovery; explicit category links and the older
`#auctions` alias keep their meaning. Clearing filters retains the current tab.

## Interpretation and boundaries

- Bible sections 5, 16 and 17: display, theme and Phase B work only. No economics,
  contract, Genesis eligibility, authorization or Trust calculation changed.
- The numeric Trust value is labelled "Trust score", rather than "Trust Weight".
  Genesis retains "Mainnet only" and the testnet exclusion. Discovery keeps its
  multiplier and explains that it affects ranking, not price.
- "Do not enlarge the frame" is implemented as a separate editor, not a fixed
  height that could clip form content. Long content remains scrollable.
- The requested project-wide wording/help/documentation-link review is still
  pending. It must support keyboard and touch, not depend on hover alone.

## Verification

- Focused gallery/profile checks: 16 pass, no skips or failures.
- Final local unit suite: 2,601 pass, 35 environment-dependent skips, no failures.
- Exact candidate `0afa71b4` passed Linux/Windows CI, static checks and Vercel
  preview. PR409 merged October31 as `517b3d40`; its production deployment is
  successful. The apex browser confirms the default avatar and gallery order.
- Final local build passes, including 11 HTML-route and Tailwind checks.
- Chromium fixture uses the actual summary/editor markup, shared CSS and real
  dialog component, with synthetic profile data and local persistence handlers.
  Both themes at 320, 390 and 1280 CSS pixels pass: equal metric boundaries, no
  horizontal page/dialog overflow, unchanged summary dimensions while editing,
  Escape/focus return, draft cancellation and save presentation.
- Both themes at 844 x 390 pass bounded dialog geometry, focus containment and
  reachable Cancel/Close with a long biography.
- Screenshots were inspected. This is browser layout/interaction evidence,
  not a new real-iPhone, wallet-signature, OAuth or database persistence test.

Local logs and screenshots remain in ignored `docs/private/profile-summary-*`
and `output/playwright/profile-summary-*`. Unrelated B35, infrastructure and
moderation-authority work is preserved and excluded from this slice.

## October 31 avatar consistency follow-up

Live read-only verification of artwork 13: the creator's custom image loads
at 384px both in Ownership and the public creator profile. The First Collector
uses `/default-avatar.png` in Ownership but displayed `No Avatar` in the profile.
The profile now uses that same neutral image when no upload exists. An actual
load failure still reports unavailability; an uploaded custom image is preserved.
A rendering regression covers all three cases. No profile data was modified.
The reported intermittent loss of the creator's custom image was not reproduced.
