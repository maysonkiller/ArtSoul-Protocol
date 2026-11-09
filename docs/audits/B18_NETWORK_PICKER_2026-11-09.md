# Wallet network picker and AI panel wording

## Request and implementation

The owner reported centered network labels far from their logos and asked for
Reown-style EVM selection while keeping protocol transactions on Base Sepolia.
The compact account menu now aligns the current network and choices on a fixed
20px logo column, left-aligned name and trailing selection column. A local search
matches names or chain IDs. The bounded list scrolls without widening the page.

The existing pinned Reown network definitions configure Base Sepolia plus Base,
Ethereum, Arbitrum One, OP Mainnet, Polygon, BNB Smart Chain, Avalanche, Linea,
Robinhood Chain, Soneium, Unichain, World Chain, Monad, Abstract and Zora.
These are wallet browsing choices, not activated ArtSoul deployments or a claim
to enumerate every network installed in a wallet. Existing WalletConnect
sessions may need reconnection if their approved optional chains exclude a
selection. The mobile Core path remains supported; provider confirmation is
still required before treating a requested network as selected.

The balance is for the selected chain only. Native symbols include POL, BNB,
AVAX and MON; no cross-chain balance fan-out is introduced. Existing locally
licensed brand marks retain their colors. No dependency, paid RPC plan,
financial parameter, contract or write-network authorization changed.

The public artwork heading and region label are now **AI insights**. The model
integration, stored data and guidance-only behavior are unchanged.

## Evidence and limits

- 140 focused wallet/menu/layout checks passed before cache version updates.
- Local browser fixture renders the real menu markup and shared CSS; search by
  Polygon and chain ID 84532 works. At 320px and 390px, the menu stays in the
  viewport without horizontal overflow; selectable rows retain 44px targets.
  This fixture does not connect a wallet or access the database.
- Production CSS and runtime cache references are bumped together, including
  the content-hash guard. The production build passes.
- Native approval and availability of each added network are not claimed as
  tested. Protocol operations still pass through the 84532 write guard.

Reown references: [network actions](https://docs.reown.com/appkit/javascript/core/actions)
and [network configuration](https://docs.reown.com/appkit/javascript/core/options).
The implementation reuses the configured definitions and the existing menu,
preserving the mobile connector path rather than introducing a second selector.
