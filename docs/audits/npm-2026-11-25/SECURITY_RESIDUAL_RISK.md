# Residual dependency risk, November 25, 2026

The latest candidate reports 18 affected package names in the full audit and nine with dev dependencies omitted. The nine production entries all follow the Reown wallet dependency on Zod. The detailed inventory and compatibility checks are in the [residual follow-up](RESIDUAL_FOLLOWUP.md).

The [follow-up check](TOOLCHAIN_FOLLOWUP.md) removed the serializer, temporary-file and inherited solc entries. The nine high-rated records still in the lock are Zod and eight Reown packages. The sections below describe the preceding 53-entry candidate.

The revised candidate has 53 open affected package records. The remaining high-severity records are `@reown/appkit`, `@reown/appkit-adapter-wagmi`, `@reown/appkit-controllers`, `@reown/appkit-pay`, `@reown/appkit-scaffold-ui`, `@reown/appkit-ui`, `@reown/appkit-utils`, `@reown/appkit-wallet`, `serialize-javascript`, `tmp`, `zod`. Records for multiple parents can originate from one nested advisory. Each severity and package path is available in the [inventory](SECURITY_FINDINGS.csv).

## Wallet and authorization

ArtSoul directly imports AppKit and the Wagmi adapter in appkit-init.js:6–7. At the reviewed lock, @reown/appkit-wallet 1.8.21 pins Zod 3.22.4. Its distributed W3mFrameSchema.js imports Zod and W3mFrame.js calls safeParse. npm traces multiple high entries to this branch. The published patched Zod major requires an adapter-compatible migration. The remaining risk must stay open pending an upstream fix or a reviewed migration and wallet regression tests. Include reconnect, rejection, session restoration and account or network changes across desktop and real mobile wallets. The npm scan did not test live wallets. [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).

At the November 25 review, the wallet package in AppKit 1.8.24 and 2.0.0 still pinned Zod 3.22.4. ArtSoul sets email and social options locally. Reown also reads project configuration when deciding whether to initialize embedded login. Five offline feature-resolution checks confirmed that an enabled project setting can override local options. The actual hosted setting and device behavior remain unverified. Switching to the basic client also changes the wallet modal, identity and balance behavior and requires separate acceptance.

[Offline wallet configuration check](../../../scripts/security/check-wallet-feature-precedence.mjs)

## Compiler, tools and audit scope

The C12 manifest lists the 21 Solidity sources used to compile OrdinaryMarket and SettledArtworkNFT. It excludes Base64.sol, the implementation identified in the OpenZeppelin advisory. The installed OpenZeppelin 5.0.0 package remains within npm's affected range. This source-level exclusion applies to that pinned pair only. Preserve source, ABI, runtime bytecode and compiler verification during toolchain changes. A full independent contract review remains outstanding. [OpenZeppelin advisory](https://github.com/advisories/GHSA-9vx6-7xxf-x967).

Retain separate build and runtime acceptance for outstanding serialization, temp-file and crypto tooling. Production-scope npm output includes project-root packages used by tools. Its classification alone cannot establish server or wallet exposure. For any follow-up major upgrade, first map affected consumers and run the normal build and contract tests on the resulting lock. Confirm fresh exact-head CI and retain documented rollback boundaries before release.

## Verification boundaries

Each row records package-level evidence rather than a demonstrated exploit. Source-level usage can be proven for some components, while execution of the advisory-specific operation remains unknown in most rows. The two November 21 critical entries disappear from the security candidate and remained absent in the subsequent scan. Static and hardware-dependent acceptance, independent review and mainnet approval have their own gates.

## Wallet compatibility on the candidate

On November 25 all 1,017 published versions of `@reown/appkit-wallet` in the npm registry specified Zod `3.22.4`, including 86 stable versions and the current canary. The upstream main branch retained the same pin. [Reown package metadata](https://registry.npmjs.org/@reown%2Fappkit-wallet) · [Reown source](https://github.com/reown-com/appkit/blob/main/packages/wallet/package.json)

A comparison of the actual distributed Reown schema used 27 ordinary frame and application events. Zod `4.6.6` and `4.6.7` each agreed with `3.22.4` on 25. Reown declares the payload of a successful RPC response optional. Both newer versions rejected a response with the field omitted. The SDK drops it before notifying the caller. Explicit `undefined`, `null` and a normal chain ID passed in all three versions. The other difference was acceptance of an apostrophe in an email address. The security fix changed v4 core. Importing the v3 compatibility entry from a v4 package does not demonstrate remediation. In this SDK's compiled frame schema the 42 array declarations have no size constraints of the kind described in the advisory. This observation only covers this schema. [Zod fix](https://github.com/colinhacks/zod/pull/6652/files) · [Advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)

On desktop and inside wallet browsers the ArtSoul connection dialog provides extension selection through EIP-6963, a Coinbase connector, a wallet catalogue and WalletConnect QR pairing. The application requires an acknowledgement from the selected wallet and a fresh account before accepting it. The header reads its own balance and the write guard separately checks Base Sepolia. The existing external-mobile flow loads EthereumProvider `2.23.10` with its built-in QR disabled. That package and `2.26.0` both declare AppKit as a dependency. The mobile modal package `2.7.0` is deprecated. [EthereumProvider 2.23.10](https://registry.npmjs.org/@walletconnect/ethereum-provider/2.23.10) · [EthereumProvider 2.26.0](https://registry.npmjs.org/@walletconnect/ethereum-provider/2.26.0) · [Modal migration guide](https://docs.reown.com/appkit/upgrade/wcm)

A transport migration could evaluate the already locked UniversalProvider. Its 91 resolved dependency and optional-dependency entries on the reviewed installation have no Reown wallet or Zod entry. It exposes sessions and RPC requests. The app would still need wallet discovery and selection, Coinbase, QR and deep links, account switching, cancellation and session restoration on mobile. Eight existing wallet test files passed 169 tests against the current wallet implementation. Those tests used fixtures and covered approval handoff, session persistence, account switching, explicit disconnect, relay handling, network selection, deferred loading and the connection lifecycle. A replacement has yet to pass those cases and real-device acceptance. [Extension discovery standard](https://eips.ethereum.org/EIPS/eip-6963)

## Contract evidence on the new lock

A native solc `0.8.24+commit.e11b9ed9` rebuild compared the two contracts in the pinned historical C12 manifest against both locks. The compiler executable had SHA-256 `580ee56b61bbcaad953117e1e4a0874d90e6af5cb4ce4359571d7da25f6620e9`. Seven source files came from the parent commit and 14 OpenZeppelin source files came from the candidate installation. All 21 source fingerprints, compiler settings, ABI hashes, metadata hashes, creation bytecode, runtime templates and immutable offsets matched. Only the lock fingerprint in the historical manifest changed. Its updated SHA-256 is `95dbba83c4ca14536cef6f89d72fbd008e8d4ffc80bbe6ab0fa52a392ba2bdd7`.

On integration with a branch that adds the separate ordinary payout pair, rebuild and verify both manifests against the final merged lock. The checks above cover OrdinaryMarket and SettledArtworkNFT in this PR. [Historical C12 manifest](../../security/C12_ORDINARY_AUDIT_MANIFEST.json)
