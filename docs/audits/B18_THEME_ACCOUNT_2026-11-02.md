# B18 — Stable theme switching and account identity, November 2, 2026

## Request and scope

The owner requested a straight theme-switch symbol, a connector mark beside
account identity, a separate network/native-balance row, no Home layout jump
when switching themes, and six Home selections without a partially filled row.
This slice touches canon sections 05, 16 and 17 through UI and acceptance only.
No network support, wallet permissions, contract behavior or economics change.

## Changes and interpretation

- The circular theme control has two equal vertical halves using the current
  theme's surface and accent variables. It no longer rotates the dividing line
  or displays a second palette. Both original palettes remain unchanged.
- A known connector mark appears beside the avatar inside the account button.
  The dropdown groups the connector with the copyable wallet address; the next
  section shows one network mark, network name and native balance. Base Sepolia
  retains the explicit test ETH label. Unknown connectors retain an escaped
  name rather than receiving a guessed or remotely loaded logo.
- Same-wallet refresh retains the confirmed connector in memory while the
  network read is pending. Switching or disconnecting clears it immediately;
  generation guards reject late results, including reconnecting the same
  address. Connector identity is not persisted to browser storage.
- Home's primary and secondary actions share border geometry and font metrics
  across themes. The heading above the cards no longer inherits conflicting
  Classic-only margins. The reproduced seven-pixel theme-switch jump is gone.
- Home renders up to six selections: six columns on wide screens, three on
  tablets, two on phones and one below 360px. All six remain available at every
  width; Explore retains the full feed and its independent density. This
  interprets "six" as six total selections, not six columns on a phone.
- Header provider images no longer inherit the avatar's mobile dimensions.
  Shared header/style cache references are updated on every consuming route.

Classic feedback remains static. Future colour feedback respects reduced
motion. No dependency, extra feed request, feature gate or database setting is
introduced. UI decisions above supersede the older Home visible-card caps;
there is no architectural canon amendment.

## Verification

The built Home route was exercised in installed Chrome at 320, 360, 390, 430,
768, 844, 1024, 1199, 1200, 1366, 1536, 1920 and 2560px, including short landscape
and tablet viewports. There are 26 theme/size combinations. The actual theme
button was used, sampling every rendered frame during each switch:

- CTA, hero, heading, header-tool and card bounds have zero measured movement.
- All six cards stay visible and retain their existing DOM nodes; there is no
  horizontal page overflow.
- Connected, unknown-connector and guest account menus fit the viewport; the
  provider mark fits its own badge, and the address copies in full.
- The split is straight; Classic transitions are absent and Future honours
  reduced motion. No page error, remote write or signature occurred.

The matrix passes 575 assertions. Screenshots of the 390px and 1536px layouts in
both themes were inspected. The account and artwork data are isolated fixtures,
not an authenticated wallet-extension session or a physical iPhone test.

All 111 focused header/network/menu/showcase checks pass, including delayed
network responses, unknown connectors, disconnect and same-address reconnect.
The build passes its 11 route contracts and 172 required style utilities.

Private evidence: `docs/private/theme-account-layout-check.mjs`,
`theme-account-layout-results.json`, focused-test/build logs and the
`output/playwright/theme-account-*` screenshots. These measurements cover the
listed layouts, not every possible device or browser configuration.

## Release and remaining work

Release verification will be recorded after exact-candidate CI and deployment.
Revert the UI commit and its HTML cache references together to undo this slice.
The unrelated local checkpoint and recovery material are preserved.

Native iPhone/Phantom acceptance, remaining signed journeys and operational
gates remain tracked in [Phase B status](../PHASE_B_STATUS_2026-11-02.md). This
slice does not declare the entire phase or public beta complete.
