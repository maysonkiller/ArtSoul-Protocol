# B18 Classic media controls and contextual guide links

## Scope and evidence

The owner reported that media-overlay controls blend into dark artwork in
Classic and requested that contextual help links open the relevant explanation.
This slice touches canon 05 (shared artwork surfaces) and 16 (theme/interface).
It does not amend economics, contract behavior, roles or the mint lifecycle.

Rendered baseline: menu and Saved controls used a 90% opaque near-black fill
and a 30% opaque border. Hovering the menu replaced that fill with a 5% opaque
tint. Classic now uses an opaque tint of its existing accent/surface variables,
a stronger border and a dark outer edge. This covers the shared Home, Gallery
and Profile cards, playback/mute and detail fullscreen. Saved retains its
selected fill/check; Future colors and states are unchanged. Classic remains
static, including hover and focus feedback.

The browser pass also reproduced Saved overlapping mute in the six-column
Home row at 1366px. The existing desktop media minimum is now 168px instead of
124px, keeping the two action buttons separate from playback and preserving
equal media heights across a row. Column counts are unchanged.

All existing contextual links already pointed to valid guide anchors. The
navigation defect was ordering: scrolling could run before React committed
the expanded accordion. One shared reveal action now opens the target, closes
mobile contents, then focuses and scrolls after commit. The target heading
remains visible below the header. This also handles repeated links to the same
hash and rapid navigation. Guide content is unchanged.

## Interpretation

- Improve contrast with the owner's existing Classic palette rather than
  introducing a new color or animated glow.
- "Go to that section" means an expanded, focused and visible explanation,
  not merely loading the guide's top-level page.
- Preserve browser Back and native modified links. Near the bottom of a short
  document, use the available scroll range rather than adding artificial blank
  space solely to align the heading at the top.

## Verification

- Production build, HTML verification and Tailwind verification passed.
- 53 focused unit checks passed: documentation, contextual help, gallery
  guidance, card controls/actions and artwork image controls.
- The delayed-commit navigation regression fails against the previous source
  and passes with the fix.
- Isolated built-browser checks: 450 assertions at 320, 390, 768, 1366 and
  1920px in Classic and Future. Home, Gallery, Profile, artwork fullscreen and
  actual help-link navigation were exercised without signing or remote writes.
- Checks cover opaque Classic control backgrounds, contrast, hover/focus,
  selected Saved appearance, menu actions, viewport fit, fullscreen close,
  expanded guide targets below the header, reload and Back. Minimum sampled
  normal Classic icon contrast was 11.03:1; border-to-fill contrast was 6.33:1.
- Screenshots reviewed at 390 and 1366px, including dark/light media fixtures
  and the opened guide section. Local evidence is under `output/playwright/`.
- This is browser viewport evidence, not a new physical-iPhone acceptance run.

## Release boundary

These bounded B18 fixes do not close unrelated Phase B device, signed-journey,
capacity or independent-backup gates. Release follows the exact PR checks and
verification of the published assets.
