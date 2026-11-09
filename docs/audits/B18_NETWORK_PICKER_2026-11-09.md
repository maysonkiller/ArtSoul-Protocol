# Wallet network picker and AI panel wording

## Request and implementation

The owner reported centered network labels far from their logos and asked for
Reown-style EVM selection while keeping protocol transactions on Base Sepolia.
The compact account menu now aligns the current network and choices on a fixed
20px logo column, left-aligned name and trailing selection column. A local search
matches names or chain IDs. The bounded list scrolls without widening the page.

The existing pinned Reown network definitions configure Base Sepolia plus Base,
Ethereum, Arbitrum One, OP Mainnet, Polygon, BNB Smart Chain, Avalanche, Linea,
Robinhood Chain, Soneium, Unichain, World Chain and Zora. Monad and Abstract
were removed at the owner's explicit request before release; neither is offered
or requested as an optional WalletConnect chain.
These are wallet browsing choices, not activated ArtSoul deployments or a claim
to enumerate every network installed in a wallet. Existing WalletConnect
sessions may need reconnection if their approved optional chains exclude a
selection. The mobile Core path remains supported; provider confirmation is
still required before treating a requested network as selected.

The balance is for the selected chain only. Native symbols include POL, BNB,
and AVAX; no cross-chain balance fan-out is introduced. Existing locally
licensed brand marks retain their colors. No dependency, paid RPC plan,
financial parameter, contract or write-network authorization changed.

The public artwork heading and region label are now **AI insights**. The model
integration, stored data and guidance-only behavior are unchanged.

## Owner follow-up: network removal and legible marks

Monad and Abstract are excluded from both the wallet selector and external NFT
browser/API allowlist. Requests for either removed network are rejected before
any upstream provider request. Historical data and licensed asset files are not
deleted. The owner requested removal; this is not a statement that both chains
have shut down. [Phantom's notice](https://help.phantom.com/articles/ending-support-for-monad-in-phantom-38674346854931)
specifically ends wallet support for Monad and says assets remain on-chain.

A bounded official-source review found no announced closure of the retained
networks on November 9. In particular, [Unichain's upgrade](https://blog.uniswap.org/unichain-is-upgrading-to-op-enterprise)
preserves chain identity and balances, and [Zora Network status](https://status.zora.energy/)
reports operation. Polygon zkEVM, BNB Beacon Chain and Base Goerli shutdowns
do not apply to the configured Polygon PoS, BNB Smart Chain and Base Sepolia.

Transparent black Linea, Soneium and World marks now use the existing neutral
brand background in both themes, without recoloring the source logos. The
header avatar is constrained to a square 28px box; an older 30px minimum height
had distorted that image. The canonical embedded bitmap is preserved, so this
does not add image requests or replace the established guest identity.

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
- Follow-up validation: 294 of 295 combined targeted checks passed; the only
  failure expected the old 16-network count. After updating that expectation,
  the affected wallet suite and adjacent cache/layout suites passed 63/63.
  External NFT removal checks passed 25/25, and the production build passed.
- Browser fixture checks confirm Linea in Classic and Soneium in Future are
  legible with unchanged source colors; the shared header avatar renders at
  28 by 28 pixels. This is local visual evidence, not a native-wallet approval.

## Release evidence

[PR #482](https://github.com/maysonkiller/ArtSoul-Protocol/pull/482) merged at
`2026-11-09T19:21:55Z` as `dfc9f82a36405726bb42ba5b06c6133aa1927d8e`.
Reviewed head `5829374624f6d40f8fe010dacfdaee00409da4b8` passed
[CI 42681754394](https://github.com/maysonkiller/ArtSoul-Protocol/actions/runs/42681754394):
Linux, Windows and static checks all succeeded. Production deployment
`dpl_ArKDP1GHY96YmMt57EBEfgrV7tT4` is READY at the exact merge, with
`artsoulprotocol.com` and `www.artsoulprotocol.com` aliases verified.

The release includes the bounded resale artwork/provenance refresh. Preview
accessibility inspection confirmed AI insights, the updated Taes owner and six
provenance events. It does not prove delayed no-reload convergence after a new
receipt. A subsequent browser screenshot/read was rejected by URL security
policy; no alternate path was used to bypass it. This menu release does not
establish native acceptance of the added browsing networks. Latest native
iPhone composition and real Phantom
Disconnect/reload/choose-another-wallet checks remain open. No signed purchase
or other completed operation was replayed; Phase B is not declared complete.
The local release journal is `output/PR482_RELEASE_2026-11-09.md`.

Reown references: [network actions](https://docs.reown.com/appkit/javascript/core/actions)
and [network configuration](https://docs.reown.com/appkit/javascript/core/options).
The implementation reuses the configured definitions and the existing menu,
preserving the mobile connector path rather than introducing a second selector.
