# Saved interaction and shared card expiry correction

Workspace: `C:\Projects\ArtSoul`, branch `codex/takeover-audit`.
Starting HEAD: `bf290ff`; published baseline: PR #343 / `3cf6b87`.
Released via PR #344, candidate `e575ecb`, merge
`d844349172ae87a7f2caadbf9d4572fbd979ae0f` on October 25, 2026.
Production: READY `dpl_EpGMYxhUvsUtESGb7epuKWeZ5cqQ`.

## Reproduction and cause

The shared performance utility captures button clicks before their target
handlers and disables ordinary buttons for 500 ms. Saved's handler refuses
disabled controls, so on pages using this utility a click never reaches the
Saved store/API. The pressed CSS feedback can look like a save that immediately
reverts. Earlier real HTTP persistence checks did not exercise this DOM path.
The regression runs the actual utility before the actual shared control's
listener: expected one write, received zero before this fix.

The card countdown also ticks independently of its parent. On expiry the pill
changed to Ended while the body/accessibility label retained Live. DOM and React
cards now refresh the status once at expiry, using the same clock. The existing
No bids/Awaiting payment presentation rules are preserved. A timer does not
finalize a contract, mint an NFT or create a floor.

## Patch and boundaries

- Mark the shared Saved control as owning its own pending-request guard. The
  existing store still serializes a key, acknowledges only successful writes,
  binds the wallet/deployment and fences stale responses. No generic button
  protection is removed and no API/schema/authentication change is required.
- Rounded bookmark plus/check glyph with explicit selected state. Classic uses
  a solid theme fill; Future uses an angular outline/glow. Theme variables,
  44 px controls, accessible names/pressed/busy states and reduced motion remain.
- Both shared card renderers keep the timer, body and accessible label aligned
  at expiry; replacement auction rounds get their own countdown.
- Mobile search is aligned immediately before the account control rather than
  centered in the remaining header space; all eight shared header pages inherit
  the same CSS. The mobile breakpoint now matches the header's 768 px breakpoint.

Unfinished B17 notification work and unrelated moderation-authority files are
preserved separately and excluded from this release. No contract, indexer,
database, economic or new network change is part of this correction.

## Verification

- Saved capture-guard regression: failed before patch, passed after patch.
- 30 initial card/Saved checks pass, including failed writes, late reads,
  switched/logout wallets, exact deployment keys and list hydration.
- Countdown regressions failed before patch; 24 focused countdown/status/price/
  settlement checks pass. Actual DOM and mounted React expiry/re-auction
  fixture passes in isolated Chrome.
- Real shared controls and SavedList mounted together with the actual capture
  guard and an isolated in-memory API: preview add -> detail remove -> profile
  add -> Saved-list remove produces exactly `[true,false,true,false]`, leaves
  three unchecked controls and an empty list, without navigation. A subsequent
  detail save checks all four controls and hydrates Saved. This is browser
  integration evidence, not a new real-wallet or physical-iPhone claim.
- Both themes reviewed at 390 px; 320 px has no horizontal overflow and the
  search-to-account gap is 8 px. Screenshots stay under ignored
  `output/playwright/saved-classic-390.png` and `saved-future-390.png`.
- Combined final focused run: 141 tests pass, zero skips/failures, including
  Saved API/state, shared card click isolation, countdowns, cache versions,
  search state and unchanged voice/WebMCP guards. Log:
  `output/audit/saved-regression-focused-2026-10-25.log`.

## Release verification

- Exact-candidate CI `40178674740` passed: Linux 2,356 tests / two platform
  skips; Windows 2,055 tests / 23 Docker-suite skips; zero failures and 46
  passing contract tests per OS. Static checks and hosted preview passed.
- Final local build passed 11 routes / 174 Tailwind utilities. Eight apex route
  asset lists match that exact build. The served v22 card runtime hash is
  `9704fbfff46efb525550d1df331206f67de39f91a7fb77445d4a86a0ea400c8e`.
  Saved remains enabled on Base Sepolia; unauthenticated reads return 401 with
  private/no-store headers. No feature activation or migration was needed.
- Actual apex Chrome at 390 px: no horizontal overflow; search/account gap
  8 px; artwork 36 (the screenshot's Web 3 Rialo test) shows No bids in Gallery
  and global search. Artwork 37 remains Live with its current countdown.
  Clicking Saved as guest reaches the real Connect Wallet dialog without any
  account selection/signature. After cancellation, the existing connection
  timeout releases the control; this is not immediate cancellation UX and is
  retained as a follow-up observation, not concealed as a new successful login.
- Fixture viewport checks at 320/390/768/1024/1440 px found no header overlap
  or horizontal overflow. Local fixture hot reload produced development-only
  createRoot warnings before clean reload; no clean-fixture failure is claimed
  resolved by production code. Test browsers and dev server were closed.
- This release has no new physical-phone/SIWE write acceptance. The cross-surface
  write journey is a real-component, isolated-API browser check; historical
  27 real two-account API checks remain separately dated in the original B13
  report. Phase B's remaining gates and B17 work are not closed by this patch.

Interpretations: Saved remains private and distinct from Watching/Trust. The
bookmark's plus/check are interaction feedback, not verification badges.
Lifecycle labels follow existing rules; no new state or parameter was invented.
