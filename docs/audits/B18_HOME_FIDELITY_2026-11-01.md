# B18: accepted Home composition fidelity

The founder compared the accepted October 31 interactive study with the live
site on November 1. The live implementation retained the previous wide canvas,
centered navigation, boxed secondary action, and metrics before the artwork feed.
The comparison was valid: adopting the illustration alone did not adopt the layout.

## Change

The Future Home now uses the study's 1320px content container, introductory text,
type scale, inset, illustration dimensions and action hierarchy. Discovery appears
immediately after the hero; metrics remain below it. The shared Future header
places navigation beside the stacked wordmark, with an underlined active page.
Its height and overlay offsets agree across breakpoints. Card action controls
are circular on Home, Gallery and Profile. Both original palettes remain intact.

Legacy compact Home rules are scoped to Classic instead of overriding Future
paragraphs and buttons on mobile. Flex layout applies only to the active Home
section, preserving the existing section-switching behavior. Documentation stays
reachable as "How it works" on all eight shared headers. Admin authorization,
notifications, voice, wallet requests, saving and media behavior are unchanged.

Scope: Bible sections 05 and 16 (presentation), roadmap B18. No economic,
contract, lifecycle, permission, fee or network amendment. Shared introductory
copy and the documentation label are deliberately clearer in both themes.
Classic retains its layout and metrics/feed document order. In Future only,
CSS changes the visual order of the two informational sections; keyboard order
of actionable links is unchanged. Native device acceptance is not inferred.

## Validation

- Focused header/theme/navigation tests: 150 passing.
- Source header browser matrix: eight pages, two themes, five widths, 80 layouts.
- Source Home/Gallery/Profile card matrix: 30 layouts, 221 checks; no page errors
  or API mutations. Action menus, full price/status text and reduced motion checked.
- Built Home: ten widths from 320 to 1920px, both themes, 196 assertions across
  20 layouts; no page errors or API mutations. Includes actual header height,
  action destinations, overflow, keyboard focus and inactive-section hiding.
- Final build: 11 HTML routes and 172 Tailwind utilities verified.
- Final saved/menu controls: 44px circles in built Future cards.

Private evidence: `b18-fidelity-{focused,navigation,cards,build-final}`,
`b18-home-fidelity-built.json`; reviewed desktop/mobile screenshots under
`output/playwright/b18-home-final-*`. Fixture checks do not claim real wallet
or OAuth acceptance. Exact commit CI and production verification are recorded
in the PR and the continuation checkpoint. This correction does not close the
remaining Phase B operational/cohort gates.
