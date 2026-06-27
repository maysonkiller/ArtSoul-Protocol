# ArtSoul Testnet Tester Guide

Last updated: 2026-05-31

## Before You Start

ArtSoul testnet uses test networks only. Do not use real funds. Do not bridge mainnet assets. Do not share private keys or seed phrases.

Recommended wallets:

- MetaMask Desktop
- Rabby Desktop
- MetaMask Mobile
- WalletConnect-compatible wallet

Supported test networks:

- Base Sepolia
- Ethereum Sepolia

You will need testnet ETH on the network you are testing.

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

Expected result:

- The wallet button changes from guest state to connected state.
- You can open the dropdown.
- Disconnect remains visible in the dropdown.

## Switch Networks

Use the site network switcher when possible.

Test both:

- Base Sepolia
- Ethereum Sepolia

Expected result:

- Wallet asks for approval if needed.
- Missing chain is added if the wallet supports it.
- Site updates after provider-confirmed chain change.
- Network modal should not remain stuck.

If the wallet refuses the switch, record:

- Wallet app
- Browser/device
- Network you tried to switch to
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

## Important Default Auction Warning

Do not settle Base Sepolia `auctionId=2`.

That auction is reserved for the settlement-default test path. It must remain unsettled after it ends so operators can test `SettlementDefaulted`.

If you accidentally interact with that auction, report it immediately with the transaction hash.

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
- Do not try to settle the default test auction.
- Do not spam transactions.
- Do not assume testnet NFT ownership has mainnet value.
- Do not treat testnet activity as final Genesis eligibility.

## Reporting Bugs

Use the bug report template in:

`docs/testnet/BUG_REPORT_TEMPLATE.md`

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
