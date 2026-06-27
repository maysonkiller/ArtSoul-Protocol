# ArtSoul Public Testnet Runbook

Last updated: 2026-05-31

## Purpose

This runbook is the operating guide for ArtSoul public testnet preparation. It documents what is live, what has already been tested, what is still experimental, and the rules testers and operators must follow.

ArtSoul testnet is for protocol validation only. Do not use real funds. Do not send mainnet assets. Do not treat testnet activity as a guarantee of mainnet eligibility or rewards.

## Current Deployed Networks

### Base Sepolia

Status: deployed, configured, and core success/resale path tested.

- Chain id: `84532`
- ArtSoulCore: `0x43368f7E2d5f11f4B7E11928D66d3f4A5a4E4ceF`
- ArtSoulNFT: `0xf061f70503c37Cf2196A28F4785E524D0Fb32538`
- ArtSoulProjectNFT: `0xBd17c875962a3cd34F10405234527a41A90A682B`
- Indexer start block: `41976861`

### Ethereum Sepolia

Status: deployed, configured, and basic register/create/bid smoke path tested.

- Chain id: `11155111`
- ArtSoulCore: `0x43368f7E2d5f11f4B7E11928D66d3f4A5a4E4ceF`
- ArtSoulNFT: `0xf061f70503c37Cf2196A28F4785E524D0Fb32538`
- ArtSoulProjectNFT: `0xBd17c875962a3cd34F10405234527a41A90A682B`
- Indexer start block: `10920477`

The contract addresses match on both testnets because the same deployer/order/nonce pattern was used. This is expected for this deployment path.

## Supported Wallets For QA

Primary:

- MetaMask Desktop
- Rabby Desktop
- MetaMask Mobile
- WalletConnect via AppKit

Risk-focused environments:

- Telegram in-app browser
- Discord in-app browser
- X in-app browser

In-app browsers may have injected-provider limitations, modal layering issues, or app-switching state loss. Treat failures there as important QA signals, not as production readiness blockers until reproduced in a primary wallet.

## Tested So Far

Base Sepolia:

- `ArtworkRegistered`
- `AuctionCreated`
- `BidPlaced`
- `AuctionEnded`
- `SettlementCompleted`
- `CanonicalFloorUpdated`
- Lazy NFT mint after successful settlement
- NFT ownership after settlement
- Resale listing
- Resale purchase
- Royalty/platform fee event values
- Chain-scoped DB/indexer projections

Ethereum Sepolia:

- `ArtworkRegistered`
- `AuctionCreated`
- `BidPlaced`
- Read-only event listener initialization
- Chain-scoped DB isolation from Base Sepolia

Infrastructure:

- Base and Ethereum Sepolia runtime config is live.
- Chain-scoped DB projections are verified.
- Base and Ethereum Sepolia can both store `artworkId=1` and `auctionId=1` without overwriting each other.
- Redis is optional for startup.
- `INDEXER_MAX_BLOCK_RANGE=10` is supported for safer replay on limited RPC plans.

## Still Experimental

- Public wallet QA across all supported environments.
- Settlement default path. Base Sepolia `auctionId=2` is still on a live timing path.
- Ethereum Sepolia settlement/default/resale parity.
- Supabase GRANT/RLS implementation after audit.
- OpenGraph and Telegram preview behavior.
- Discovery/social signal persistence under public load.
- Long-running indexer monitoring on both chains.

## Known Limitations

- Testnet contracts are not mainnet contracts.
- Testnet NFTs are not final production NFTs.
- Genesis, roles, and partner collections are deferred.
- Visual overhaul is deferred.
- Public beta must wait for default path confirmation and Supabase access-control hardening.
- In-app browser behavior may vary by mobile OS and wallet app.

## Safety Rules

- Use testnet ETH only.
- Never paste private keys or seed phrases into the site.
- Never use a mainnet wallet holding valuable assets for public testing.
- Do not settle the Base Sepolia default-path auction `auctionId=2`.
- Do not run destructive DB operations.
- Do not expose indexer infrastructure tables publicly.
- Report transaction hashes for failed on-chain actions.

## Operator Checklist Before A Test Window

- Confirm the frontend is serving the latest contract config.
- Confirm Base Sepolia and Ethereum Sepolia addresses are visible in runtime config.
- Confirm indexer DB connection works.
- Confirm one indexer process per chain, not unsafe simultaneous shared state.
- Confirm the bug report destination is active.
- Confirm testers have testnet ETH.
- Confirm default auction status before giving any settlement instructions.
- Confirm Supabase access policy status before broad public opening.

## Go / No-Go Guidance

Go for limited public testnet only when:

- Base default path is completed and indexed.
- Wallet QA has no critical connect/disconnect/network blocker.
- Supabase GRANT/RLS plan is implemented or a safe backend-only workaround is in place.
- Bug intake is ready.
- Operators can pause public actions quickly if runtime behavior regresses.

No-go if:

- Wallet connection traps users in a stuck modal.
- Indexed economic truth can be modified by frontend users.
- Defaulted settlement behavior is unverified.
- Public frontend points at zero-address or stale contracts.
- In-app browser testing reveals a critical reproducible flow blocker.
