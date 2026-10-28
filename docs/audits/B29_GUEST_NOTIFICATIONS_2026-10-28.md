# B29: stable guest notification entry

Workspace: `C:\Projects\ArtSoul`, branch `codex/takeover-audit`.
Started at `aad01970` (release evidence after production `9faffe2d`).

## Reproduction and cause

The October 28 iPhone screenshot shows a gap between voice and the guest
account. All eight product headers reserved 44px for notifications, but both
prepaint and the deferred entry hid the bell without a confirmed/cached wallet.
This was an intentional earlier display rule, not missing notification data.

## Change and boundaries

Keep search, voice, notifications and account in the existing order. The bell
is visible from static HTML for guests too. A small native popover explains the
feature and offers an explicit Connect wallet action through `safeConnectWallet`.
Opening the explanation never connects, authenticates, imports the private
inbox or reads notification APIs. Cached identity remains a presentation hint.
Confirmed wallet, generation and pagehide fences still control private roots.
Closing a pending explanation cancels the queued same-wallet open intent.

The shared notification surfaces and theme variables are reused. Native popover
provides keyboard activation, light dismissal, focus return and implicit
expanded semantics. It works before deferred application scripts load. Header
geometry stays unchanged. No dependency, role, economics, contract or schema
change. Cache pins advance together: prepaint v9, stylesheet v60.

Browser validation found that the gallery click guard treats an empty
`data-allow-rapid` value as false and disables a button before native activation.
The three new controls use the existing truthy convention; regression coverage
asserts it on every header. A failed inbox import is also cleared on disconnect,
and late connection completion releases the current guest action correctly.

## Validation

- Build: 11 routes and 173 generated Tailwind utilities verified.
- Header controller/prepaint: 29 tests pass, including guest zero reads/imports,
  explicit connection, cancellation, delayed completion, retry, same-wallet
  intent, account changes and BFCache cleanup.
- Broader notification/header regression selection: 336 tests pass.
- Existing layout/cache/URL selection: 125 tests pass (overlaps the selection
  above; these counts are not additive).
- Actual local Chromium: 48 combinations (eight routes, Classic/Future,
  320/390/1366px). All pass layout containment, unchanged header/page width,
  open/close/reopen, outside press and Escape/focus. Eight explicit Connect
  cases use a controlled wallet helper, never a real wallet or signature.
  Public GETs are proxied to apex; no private reads, API writes or page errors.
- Four first-paint keyboard cases block external scripts entirely. Native
  open/close and actual browser accessibility-tree expanded state pass at
  320/390px in both themes. Playwright's DOM-based aria snapshot omits native
  implicit state; the Chromium accessibility tree confirms it.
- Screenshots inspected: `output/playwright/guest-bell-{future390,classic320}.png`.
  Local runners and logs are in `output/playwright/guest-bell*.js` and
  `output/guest-bell-*.log`. This is not new physical-iPhone acceptance.

## UX interpretation and sources

The founder requested a professional choice between reordering and a permanent
bell. Chosen: permanent active disclosure, explicit connection, no dead click.
This supersedes the guest-hidden display rule only; canon visual section 13 and
theme document 16 apply, while notification authorization is unchanged.

- GOV.UK's button guidance warns that disabled buttons can confuse users:
  https://design-system.service.gov.uk/components/button/
- Native auto-popover behavior and compatibility:
  https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/popover
- Button/popover accessibility relationships:
  https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/button#popovertarget

## Release

Local implementation verified; candidate CI, preview and production verification
are pending. Phase B remains open. Exactly next: publish this bounded change,
verify the deployed guest entry, then resume the existing B12/B21 integrated
public assistant journey. Paid voice provider activation stays deferred.

Initial candidate `3e203e4a` passed preview deployment 7390768630, eight-route
and four exact-content asset checks, and 48 hosted browser cases without mocks,
API writes, notification reads or page errors. CI40723410468 found an older
profile organization assertion requiring the now-superseded hidden guest bell.
Updated it to require one generic public shell and no embedded private inbox or
badge. Final candidate CI remains required before release.
