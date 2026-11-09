# B18: stable profile actions and explicit wallet networks

## Decision and scope

The founder requested stable Edit Profile placement when staff access resolves,
removal of nested hover frames from the account plaque, and a wallet network
chooser while ArtSoul transactions remain restricted to Base Sepolia.

The chooser exposes only the three networks already configured in AppKit:
Base Sepolia, Base mainnet and Ethereum mainnet. This supersedes the older
Base-Sepolia-only account-menu choice, not the single active deployment or
write boundary. It does not add an RPC provider, paid service, write deployment,
token integration or arbitrary EVM network catalogue. Ethereum Sepolia remains
read-only history and is not added to the chooser.

## Changes

- Reserve two equal cells in the existing profile action group. Its right
  alignment previously moved Edit Profile when the async Admin link arrived.
  Admin continues to render only after the existing access check; no cached
  permission or invisible interactive Admin placeholder is introduced.
- Remove pointer-hover/expanded frames from the name, address and avatar.
  Copy feedback and visible keyboard focus remain available.
- Open network choices from the account's network/balance row, show the
  confirmed current selection and explain the Base Sepolia transaction limit.
  Network identity and native-currency text remain distinct.
- Reuse installed AppKit chain definitions and the existing provider switch
  path. Mobile core sessions use their own provider, not an unrelated AppKit
  provider. Concurrent choices are serialized; a cancelled AppKit request
  does not fall through to another wallet prompt. Only provider-confirmed
  chain state is committed. Failed native balance reads remain unknown instead
  of claiming zero.
- Keep `ensureArtSoulWriteNetwork` fixed to Base Sepolia. Its transaction checks
  are not derived from the selected browsing network. Shared consumers use
  account script v67 and stylesheet v85.

The wallet may refuse a network switch; the interface must not manufacture
confirmation. This follows the existing provider model and
[EIP-3326](https://eips.ethereum.org/EIPS/eip-3326).

## Verification

- Unit suite: 3,534 tests, 3,499 passed, 35 existing skips, zero failures.
- Build: all 11 HTML routes and 172 Tailwind utilities verified.
- New provider/chooser cases cover both mainnet browsing targets, mobile-core
  isolation, Base Sepolia confirmation, rejected/unconfirmed/unsupported
  switches, concurrent attempts and the unchanged write guard.
- An isolated browser fixture uses the real shared header, stylesheet and
  account script with fictional identity and provider data. Classic and Future
  pass at 320, 390, 768, 1366 and 1920 CSS pixels: Edit Profile coordinates stay
  identical before/after adding the actual Admin-link class; both actions and
  the three-choice menu fit; no page overflow; no pointer-hover outline; keyboard
  focus remains visible. Screenshots at 390 and 1366 were inspected.
- The fixture makes no wallet transaction or authenticated service request.
  These measurements do not claim real iPhone or wallet-extension acceptance.

## Release and remaining gates

Prepared from main `e8947b77`; CI and production verification are recorded after
release. Unrelated unfinished local audit and authority-policy files are excluded.

This closes the reported implementation defects after release, not Phase B's
remaining real-wallet journeys, native-device acceptance, independent encrypted
recovery or newer-indexer activation. See the maintained Phase B status.
