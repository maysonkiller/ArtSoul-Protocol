# B-19: artwork actions in Community

Date: October 24, 2026. Starting HEAD: `a818f2e`. Workspace:
`C:\Projects\ArtSoul`, branch `codex/takeover-audit`.

Status: **deployed and verified through PR #336**, merge `aac0db3`. Phase A engineering
acceptance is unchanged. This is the founder's explicitly requested Phase B UI
slice; beta admission remains separate, and TA-12 has its own acceptance record.

## Request, baseline and change

Ownership previously contained participant identities followed by Share, Back,
Report, staff tools and ArtistSupport. Community held only Trust and the three
existing discovery signals. On desktop, Community and its grid row were fixed
at 160px and the left rail hid overflow; simply moving the controls would clip
them.

Move the existing action handlers, notices and single ArtistSupport instance to
Community. Keep all four conditional participant roles and their profile links
in Ownership. The action row begins with Donate and Donation history, followed
by Share on X, Report, staff-only tools and Back. Trust is a compact, separately
labelled score; Like, Would Buy and Watching keep their existing meaning.

Replace the fixed desktop row with automatic sizing, bounded Community scrolling
and a left-rail scroll fallback for short windows. Controls wrap and retain 44px
touch targets. The opened donation history scrolls within 180px; it cannot push
twenty entries into the primary composition. No history request runs before the
user opens it. Native dialogs remain in the top layer. The moderation close
handler now restores focus without scrolling, matching Report and Donate.

## Scope and interpretations

- Canon §§5/6/16/17: provenance display, community signals, themes and Phase B.
  This is an authorized display amendment; no architectural rule changes.
- “All buttons” includes Back, Donation history and the existing staff-only
  entry, not auction bidding/settlement controls or participant profile links.
- Trust visibility, calculation and permissions are unchanged. The explanatory
  tooltip describes its existing discovery-only role, not a new reputation rule.
- Keep history collapsed by default. Expanded history may scroll; controls are
  not duplicated, and no new component, dependency, API or background read exists.

## Evidence

- `node --test test/artwork-layout-v3.test.cjs test/artwork-action-dialogs.test.cjs
  test/artwork-secondary-panels.test.cjs test/artwork-provenance-labels.test.cjs
  test/card-creator-attribution.test.cjs test/artwork-card-actions.test.cjs
  test/artwork-owner-after-buyback.test.cjs test/page-theme-first-paint.test.cjs
  test/phase-a-close-out.test.cjs`: **70 pass, zero failure or skip**.
- Updated the two provenance test boundaries that previously used the Ownership
  action block as their terminator. Added assertions that actions occur only in
  Community, identities remain in Ownership, one support instance exists and
  Report/staff permission checks remain present.
- `npm run build`: 11 HTML routes and 174 Tailwind utilities verified.
- Local Chrome: Classic/Future at 1440×900, narrow desktop override 901×600
  (reported inner width 902), and mobile layouts at 390×844 and 320×640.
  No page/Community horizontal overflow, action overlap or buttons in Ownership;
  action touch targets are at least 44px. Staff controls checked both ways.
- Actual ArtistSupport plus extracted Community/Ownership/Report JSX with
  synthetic local state: Donate and Report fit the viewport, open as native
  modals, and restore the trigger on close/Escape. Twenty synthetic donations
  stay bounded; the fixture recorded zero history reads before opening and one
  after the first opening. No wallet transaction or report was submitted.
- Independent bounded diff review: no blocker; its focus-restoration suggestion
  was applied. Reviewer is complete, not running in the background.

Local evidence: `output/audit/community-regressions-2026-10-24.log`,
`community-build-2026-10-24.log`, `community-browser-checks-2026-10-24.json`,
and `community-{desktop,mobile}-{classic,future}-2026-10-24.png`.
The JSON retains intermediate layout measurements as well as the final bounded
history result. The local fixture uses real styles and changed JSX, synthetic
neighboring content and read responses; it does not prove live auth, transaction
handling or real iPhone Safari. Those flows were not changed or re-certified.

## Release and next step

The owner authorized PR #336 candidate `3117def`; merge `aac0db3` has the identical
tree and was deployed to the apex on October 24. Post-merge Linux/Windows CI and
actual apex desktop/390px dialog checks pass. Donate, Report and real history
work in Community; Ownership contains identities only. No new transaction or
complaint was submitted. See the [production acceptance](TA12_ARTWORK_LOADING_2026-10-24.md#production-acceptance)
for exact deployment, checks and limitations. No database migration or contract
change. B-19 is done; B-13 Saved is next after this completed TA-12 release.
