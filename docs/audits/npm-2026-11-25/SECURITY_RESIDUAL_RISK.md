# Residual dependency risk, November 25, 2026

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
