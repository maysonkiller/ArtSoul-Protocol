# B-21 global search commands

Status: released in PR #368, candidate `9840a5b`, production merge `276d894`.
Canonical checkout `C:\Projects\ArtSoul`, branch `codex/takeover-audit`, starting
production merge `91b223f`. The preceding Saved release is recorded separately.

## Cause and scope

The assistant's original `search_artworks` filtered only the first 200 recent
cards, while Search ArtSoul already searched the indexed public catalog and
artist profiles. Ordinary text/voice searches now use the same global search
state and API. This is B-21, Bible sections 16/17: no economics, contract, schema,
role, network, provider or dependency changes.

## Implementation and interpretation

- `search_catalog` accepts a query and optional all/artworks/auctions/artists
  category. A fresh `createSearchState` instance isolates each call from the open
  search dialog and other commands; it retains validation, timeout, credential
  omission and public visibility handling. It does not write browsing history.
- Only first-page matches are returned: five per group for All or twenty for a
  specific category. `hasMore` is explicit. Counts mean matches shown, never a
  total; artwork/auction groups can overlap. Full pagination remains in Search
  ArtSoul. No local filtering of incomplete pages is claimed to be global.
- Public names and exact IDs become allowlisted result fields and canonical
  local links. Duplicate artist names retain their distinct wallet identities.
  Titles/names are text, never HTML, navigation instructions or action targets.
- English/Russian commands support general searches and explicit categories;
  a missing query asks what to find without a request. Search content containing
  another command stays query data. No wallet, private account or admin action.
- Legacy `search_artworks` remains for existing WebMCP consumers, explicitly
  documented as a bounded recent-card filter. The ordinary command parser no
  longer uses it. Removing/changing its schema would break existing callers.
- The bridge is available on Home/Gallery/Artwork/Profile, where global search
  already loads. Other assistant pages report availability honestly; no new
  imports are added to documentation or publishing flows.
- Browser reproduction found that disabling Send moves focus to body. Completed
  requests return it to the composer only if it was lost, so Escape and retry
  work without stealing focus from another control or a closed panel.

## Verification

- Focused group: 239 passed, zero failed/skipped. Command:
  `node --test test/search-commands.test.mjs test/search-state.test.mjs test/search-api.test.mjs test/voice-commands.test.cjs test/command-panel.test.cjs test/webmcp-tools.test.cjs test/webmcp-agent-actions.test.cjs test/cache-version-follows-content.test.cjs test/shared-header-navigation-flicker.test.cjs test/saved-commands.test.mjs`.
- Build passes; HTML entries and Tailwind validation remain included.
- Local browser: eight cases, both themes at 320/390/768/1440px. Real parser,
  tools, search state, links and global click guard with synthetic public API
  responses. Mixed groups, distinct artists, literal metadata, category changes,
  missing-query clarification, Russian commands, Escape and panel bounds pass.
- Final cleanup found the fixture loaded the exported performance module as a
  classic script. Corrected its module tag and required `PerformanceUtils`
  readiness; all eight cases pass again on released `276d894`, with zero page
  script errors. `b21-search-real-guard-browser.log` supersedes the original
  fixture claim about the global click guard. Hosted preview/apex evidence is
  unaffected; no application code changed for this correction.
- Initial focused run had one stale stylesheet-pin expectation; updated to the
  new shared CSS version without changing the ordering assertion. Initial
  browser run exposed the focus issue above; rerun passes after its regression fix.
- Initial candidate CI 40321256423 found two additional old stylesheet-pin
  assertions in artwork-layout and guest-avatar tests on both platforms. Updated
  those pins to version 51; application behavior did not change for that repair.
- Repair group: 104 passed. Final exact-candidate CI 40321830522 passes:
  Linux 2,747 passed/two skipped; Windows 2,360 passed/31 skipped; zero failures,
  46 contract tests per platform, builds and static checks pass.
- Final preview and apex verification passes for eight pages and 36 assets.
  Apex evidence: `b21-search-apex-276d894ec466-1793017539204.json`.
- Real preview browser: 16 cases on Home/Gallery/Artwork/Profile, both themes,
  390/1440px. Search is disabled in Preview; it reports unavailability without
  inventing matches, retains clarification/retry and performs zero API writes.
- Five read-only cases run the real helper against the apex public API: exact
  artwork 34, title, artist, auction and no-match searches preserve live groups,
  canonical links and `hasMore`. This does not enable search in Preview.
- Real apex browser: 16 cases on the same four pages, two themes and widths.
  Actual artwork and artist searches return correct links; query clarification
  clears old results, Escape closes, and neither page nor panel overflows.
  Zero API writes. This is desktop-browser viewport coverage, not a new phone test.
- Evidence: `output/audit/b21-search-focused-final.log`,
  `b21-search-build-final.log`, `b21-search-browser.log`, `b21-search-pin-repair.log`,
  `b21-search-final-ci.log`, `b21-search-final-preview-browser.log`,
  `b21-search-live-api.json`, `b21-search-apex-browser.log`,
  `output/playwright/b21-search-*.png`.
- No native microphone, phone, WebMCP-client or wallet acceptance is inferred.

Exactly next implementation after release: B-21 preparation of Donate/Report
through existing dialogs, preserving deliberate review and submission. Publication
draft preparation and the final B-18 visual pass remain separate.
