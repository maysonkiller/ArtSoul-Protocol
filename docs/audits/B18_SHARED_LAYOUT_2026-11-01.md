# B18 shared interface layout

Founder request: remove the decorative Home ribbon/caption, keep Create selected
inside the collection draft builder, and use the accepted layout in Classic as
well as Future while preserving both original palettes.

Scope: interface presentation (Bible visual section / part 16, provenance
presentation / part 05), Phase B defect work. No economics, contract, authority,
network, database or deployment-target changes.

## Decisions and interpretation

- Both themes share navigation, responsive sizing, content order, disclosures and
  native controls. Theme variables stay unchanged. Future-only colored card glow
  and the Home primary-action gradient remain scoped to Future.
- Home contains no replacement decorative illustration. Real artwork follows the
  introduction before protocol statistics, including in document/keyboard order.
  Above 900px the introduction is centered instead of leaving an empty artwork
  column; narrower screens keep left-aligned reading order.
- Create is the parent location for the collection draft page; the link still
  returns to single-artwork creation. The active state exists in static HTML.
- Download/open/save draft labels describe local file/browser operations. They do
  not imply that collection publication or deployment is available.
- Classic uses the same Artwork panel order and native expandable details as
  Future. Creator, First Collector, Owner and provenance data remain intact.

This supersedes the earlier B18 presentation-only decision to retain Classic's
old layout. It does not amend the architecture or original theme palettes.

## Validation inventory

- Home: no decorative art/caption; artwork precedes statistics; native actions,
  inactive legacy section state, narrow screens and keyboard focus.
- Header: eight routes, both themes, narrow/mobile/tablet/desktop widths; all
  navigation/tool targets fit without overlap; sticky offsets match height.
- Create: upload -> collection -> all three draft steps -> refresh; Create stays
  selected; local save/restore, import/export and error feedback remain usable.
- Gallery/Profile/cards: both themes, long names/prices, action menus and Saved.
- Artwork: all identity roles, panel order/no overlap, provenance/details,
  Donate/Report/full-size dialogs and restored page scrolling.
- Docs/Admin/overlays: native disclosures, hidden access gates, mobile scrolling,
  focus/close and theme switch; no real wallet operation or API mutation.

## Verified candidate

- Focused Node checks: 126 passed (first paint/navigation, Gallery default,
  Artwork layout/presentation, profile connections, collection drafts).
- Production build: 11 HTML routes; 172 generated Tailwind utilities verified.
- Isolated Chromium checks against built output: Home 249 assertions / 20
  layouts; Artwork 566 / 14; collection 266 / 24 step-layouts; Docs 70 / 8;
  Profile 50 / 8; cards 251 / 30; Publish 90 / 8; Admin 58 / 8.
- Header check: 80 route/theme/viewport combinations, minimum 44px targets,
  no overlapping controls; native notification open/close checked separately.
- Profile editor stays within viewport, retains 16px fields, does not resize the
  summary, and Cancel preserves the displayed identity. Collection Create
  indicator remains visible on all three draft steps.
- Reviewed screenshots at phone and desktop sizes. No live wallet request or
  real API mutation was made by these isolated checks. Browser emulation is not
  a new native iPhone acceptance result.

The first Publish fixture run incorrectly loaded a missing demo video from the
built server (the fixture lives outside public assets). The corrected check uses
the existing local media files and awaits validation. The first Admin assertion
ran before asynchronous queue rendering; waiting for the report content resolved
it, and access-removal checks passed. Failed outputs were retained privately.

Independent review found one genuine Classic hover conflict: the transparent
secondary Home action inherited a page-colored foreground from the old hover
style. An explicit theme-variable foreground fixes it; both themes' hover states
were checked. The reviewer reported no remaining material findings.

The first full CI run found two presentation tests still requiring Classic's old
non-collapsible markup and different panel order. Updated those expectations to
the founder-approved shared layout, checking both themes' disclosure defaults,
always-visible ownership identities, and single-instance actions/media. No
economic or authorization check was removed.

Private evidence: `b18-shared-*-result.json`,
`b18-shared-focused-final.log`, `b18-shared-build.log` in `docs/private/`;
screenshots in `output/playwright/b18-shared-*`.

Exact commit CI, preview and production evidence is recorded in the pull request
and continuation checkpoint after deployment. This closes this presentation
defect, not the remaining Phase B operational acceptance gates.
