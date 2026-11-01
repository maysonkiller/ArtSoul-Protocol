# B18 mobile controls and explicit wallet disconnect

Scope: Phase B defect follow-up, visual/theme part 16 and wallet session UX.
No economics, contract lifecycle, signing authority or supported write network
changes. Base Sepolia remains the only active product testnet.

## Evidence and corrections

- The mobile select used a fixed bottom offset instead of its trigger. The
  shared select now fits beside the trigger, flips upward when necessary and
  follows the visible viewport. Keyboard movement scrolls only the option list.
- The profile summary placed biography/social controls in the narrow name
  column. Mobile uses a compact avatar/name row and full-width biography and
  social links; three metrics remain aligned. Desktop Edit stays on the right.
- The account menu repeated the header destinations. It retains Profile,
  authorized Admin, theme, network and disconnect; older shells without primary
  navigation retain their links. Its full wallet address copies on one click or
  keyboard activation, with success or failure feedback.
- The Ethereum network mark was repeated in its balance. Ethereum now renders
  one mark; Base keeps its distinct network mark and ETH currency mark.
- Classic interface animations/transitions and smooth scrolling are disabled
  under the explicit November 1 founder direction. Both palettes are unchanged.
  Delayed loading feedback now uses a cancellable 320ms visibility timer so a
  quick response does not flash and a long wait still appears in static Classic.
- The November 1 09:24:35 recording visibly returns from guest after disconnect
  to a connected account (approximately 17-19s and 37-39s). The Phantom testnet
  warning at approximately 29-31s is separate from the site's logout failure.
  Local offline speech recognition was used as a supplementary guide; uncertain
  words are not treated as verbatim user statements or proof of a cause.
- Code investigation found that logout's suppression flag was temporary, while
  background provider reads and extension events could still adopt authorized
  accounts. Explicit logout must remain authoritative across reload/new tabs,
  reject late results, and allow a deliberate choice of a different wallet.
- A new desktop choice is adopted only after the SDK's selected-wallet and
  connection-success events plus matching provider accounts. Disconnect cleanup
  is bounded and serialized before a new chooser; a delayed old cleanup cannot
  close that chooser. Mobile injected and external sessions retain their own
  confirmation paths. Header prepaint respects the persistent logout choice.

## Decisions and rollback boundaries

- Keep Search, voice and notifications beside My profile, as explicitly clarified
  by the founder. No feature is removed to obtain the smaller menu.
- Update part 16's Theme Separation rule: static Classic supersedes its earlier
  permission for functional animations. The full Bible theme section and AGENTS.md/CLAUDE.md rule 16 carry the same
  amendment; no architectural amendment is needed.
- Logout is a site session choice, not revocation of an extension's permission.
  Existing provider authorization must not override that choice.
- No claim is made that Phantom supports Base Sepolia. Its network capabilities
  and a real extension acceptance run remain separate from the regression suite.

## Verification

- Final focused UI/header suite: 200 passed. Wallet suite: 146 passed, including
  18 executable disconnect/chooser races. Build verified 11 routes and 172
  Tailwind utilities; syntax and whitespace checks passed.
- Built browser controls: 163 assertions, 16 layouts, no page errors; profile:
  50 assertions across eight layouts; header: 80 layouts. Both palettes and
  widths 320, 390, 768 and 1366 were covered. Classic motion review covered eight
  routes with no active interface animation/transition.
- A final horizontal desktop run exposed a popup extending below the viewport.
  All shared select menus now use the same bounded anchored placement, including
  short desktop windows. The final browser rerun and 36 affected unit checks
  passed. Earlier failed logs are retained.
- Private evidence uses the `b18-candidate-*`, `b18-mobile-*`,
  `b18-logout-header-*`, `b18-wallet-final` and `b18-phantom-*` prefixes. Browser
  fixtures are not native iPhone or real Phantom acceptance. CI and deployed
  asset verification are recorded in the release checkpoint after publication.

## Reversible cache move

Seven untracked regenerable build/cache directories were moved to
`D:\ArtSoul-recovery\2026-11-01-build-caches`, retaining original relative paths.
The manifest verifies each source is absent and destination file count/size
matches: 740,743,539 bytes total. Retain through at least December 1; no automatic
deletion was scheduled. Source, Git, active dependencies/build output, private
evidence and credentials were excluded. An earlier deletion request was blocked
by automatic approval review; no deletion occurred. The later reversible move
was separately authorized by the founder and completed successfully.

This closes a bounded defect block only when released. It does not close the
remaining Phase B indexer activation/independent restore and acceptance gates.
