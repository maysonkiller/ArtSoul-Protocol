# ArtSoul Testnet Tester Guide

Last updated: 2026-07-28

Use this guide only during an operator-approved controlled-beta window. The
entry gates, support path, severity definitions, and current go/no-go status
live in [`CONTROLLED_BETA_ENTRY.md`](CONTROLLED_BETA_ENTRY.md).

## Before You Start

ArtSoul testnet uses test networks only. Do not use real funds. Do not bridge mainnet assets. Do not share private keys or seed phrases.

Recommended wallets:

- MetaMask Desktop
- Rabby Desktop
- MetaMask Mobile
- WalletConnect-compatible wallet

Active test network:

- Base Sepolia

Historical Ethereum Sepolia artwork may remain readable, but it is not an
active write or selectable product network. Base mainnet and Ethereum mainnet
may appear in wallet negotiation for compatibility; they are not active product
networks. You will need Base Sepolia test ETH.

## What You Are Testing

ArtSoul is a discovery-first auction protocol for digital art.

The testnet flow is:

1. Publish artwork.
2. Create an auction.
3. Bid with a deposit.
4. End the auction after the duration.
5. Complete settlement.
6. Mint the NFT lazily only after settlement.
7. List and buy resale after minting.

Discovery signals such as Like, Would Buy, and Watching affect discovery only. They do not affect settlement, floor price, royalties, mint rights, or auction winners.

## Connect Wallet

1. Open the ArtSoul testnet site.
2. Click the profile/wallet button.
3. Click `Connect Wallet`.
4. Approve the wallet connection.
5. Confirm the site shows your connected wallet/profile state.
6. When a protected action asks you to sign in, approve the wallet signature.

Expected result:

- The wallet button changes from guest state to connected state.
- You can open the dropdown.
- Disconnect remains visible in the dropdown.
- A protected action is unavailable until the wallet signature succeeds.

## Network behavior

Connecting a wallet is not itself a protocol write. The site may allow a wallet
on another EVM network to connect for browsing. Every protocol write must still
require Base Sepolia.

Test:

- connect while the wallet is already on Base Sepolia;
- connect while the wallet is on another EVM network, then attempt a write;
- approve a Base Sepolia switch when the wallet supports it;
- reject the switch and confirm no write is submitted;
- open a historical Ethereum Sepolia artwork and confirm it is read-only.

Expected result:

- Browsing does not silently submit a transaction.
- The write path asks for Base Sepolia when needed.
- Missing Base Sepolia configuration is added only with wallet approval when
  the wallet supports that method.
- The UI updates only after the provider confirms the chain.
- Rejecting or failing the switch leaves the page usable and submits no write.
- A network prompt does not remain stuck.

If the wallet refuses the switch, record:

- Wallet app
- Browser/device
- Network active before the attempted write
- Console error if available

## Publish Artwork

1. Connect wallet.
2. Go to `Publish Artwork`.
3. Add safe test metadata and a test media file.
4. Submit the publish/register action.
5. Capture the transaction hash if prompted by your wallet.

Expected result:

- Artwork is registered as unminted.
- NFT is not minted at publish time.
- Artwork can appear in discovery/gallery views after indexing.

Use test content only. Do not upload sensitive, private, or copyrighted material you do not have permission to use.

## Create Auction

1. Use an artwork you created.
2. Choose an allowed duration:
   - 24h
   - 36h
   - 48h
3. Choose a small test starting price.
4. Create the auction.
5. Capture the transaction hash.

Expected result:

- Auction is created for the unminted artwork.
- Duration outside 24h/36h/48h should not be accepted.
- NFT is still not minted.

## Bid

Use a wallet that is not the artwork creator.

1. Open an active auction.
2. Confirm you are not the creator.
3. Place a valid bid.
4. Approve the transaction.
5. Capture the transaction hash.

Expected result:

- Bid deposit is paid, not the full bid amount.
- Required deposit is `max(10% of bid, 0.01 ETH)`.
- Creator self-bid should fail.
- Bidder self-outbid should fail.

## Settlement

Settlement can only happen after an auction has ended.

For success-path testing:

1. Wait until auction end time.
2. End the auction if the protocol requires it.
3. Winner completes settlement within the 24h window.
4. Confirm NFT is minted to the winner.
5. Confirm canonical floor is created from final price.

Do not attempt settlement before the auction is ended.

## Resale Testing

Only test resale after a successful settlement and lazy mint.

1. Confirm the token exists and you are the owner.
2. List the token at or above canonical floor.
3. Use a different wallet to buy the resale.
4. Capture listing and purchase transaction hashes.

Expected result:

- Listing below canonical floor should fail.
- Listing at or above floor should succeed.
- Resale purchase transfers ownership.
- Royalty and platform fee events are emitted.

## Assigned test records

Use only the artwork and auction IDs assigned by the operator for the current
window. Do not rely on historical instructions that reserve a hard-coded
auction ID; those records can change between test windows.

## Discovery Signals

You may test:

- Like
- Would Buy
- Watching

Expected result:

- These interactions should not crash the page.
- They may persist or gracefully fall back depending on database access settings.
- They must not alter auction settlement, floor price, royalties, mint rights, or winner selection.

## What Not To Do

- Do not use real funds.
- Do not use mainnet assets.
- Do not share seed phrases or private keys.
- Do not self-bid.
- Do not interact with an unassigned auction.
- Do not spam transactions.
- Do not assume testnet NFT ownership has mainnet value.
- Do not treat testnet activity as final Genesis eligibility.

## Reporting Bugs

Open a
[controlled-beta bug report](https://github.com/maysonkiller/ArtSoul-Protocol/issues/new?template=controlled-beta-bug.yml).
If GitHub is unavailable, use
[`BUG_REPORT_TEMPLATE.md`](BUG_REPORT_TEMPLATE.md) and send the completed copy
through the invitation channel.

Include:

- Page URL
- Wallet used
- Network
- Browser/device
- Wallet app
- Steps to reproduce
- Expected behavior
- Actual behavior
- Screenshot/video
- Transaction hash if any
- Console error if any

Security, privacy, copyright, and suspected credential exposure must not be
reported in a public issue. Stop the affected flow and use the private
invitation channel.
