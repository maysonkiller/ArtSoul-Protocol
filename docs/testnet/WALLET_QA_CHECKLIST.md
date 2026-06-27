# ArtSoul Wallet QA Checklist

Last updated: 2026-05-31

## Purpose

This checklist verifies wallet/runtime readiness before public testnet expansion. Run it on Base Sepolia and Ethereum Sepolia where applicable.

Do not use real funds. Use testnet-only wallets and testnet ETH.

## Wallet Matrix

### MetaMask Desktop

- [ ] Guest browsing works without wallet prompt.
- [ ] Connect wallet from profile dropdown.
- [ ] Disconnect wallet from dropdown.
- [ ] Reconnect after disconnect.
- [ ] Refresh with wallet connected.
- [ ] Switch to Base Sepolia from site.
- [ ] Switch to Ethereum Sepolia from site.
- [ ] Wrong-network flow shows a clear recovery path.
- [ ] Account change updates UI state.
- [ ] Chain change updates UI state.
- [ ] Network modal closes after provider-confirmed chain change.

### Rabby Desktop

- [ ] Guest browsing works without wallet prompt.
- [ ] Connect wallet from profile dropdown.
- [ ] Disconnect wallet from dropdown.
- [ ] Reconnect after disconnect.
- [ ] Refresh with wallet connected.
- [ ] Switch to Base Sepolia from site.
- [ ] Switch to Ethereum Sepolia from site.
- [ ] Wrong-network flow shows a clear recovery path.
- [ ] Account change updates UI state.
- [ ] Chain change updates UI state.
- [ ] Network modal closes after provider-confirmed chain change.

### MetaMask Mobile

- [ ] Guest browsing works without wallet prompt.
- [ ] Connect wallet from mobile browser.
- [ ] Connect wallet from MetaMask in-app browser.
- [ ] Disconnect clears connected state.
- [ ] Reconnect after app switch.
- [ ] Refresh with wallet connected.
- [ ] Switch to Base Sepolia from site.
- [ ] Switch to Ethereum Sepolia from site.
- [ ] Wallet app receives network approval prompt.
- [ ] Returning from wallet app restores page state.
- [ ] No stuck AppKit/network modal.
- [ ] No hidden connect/disconnect action.

### WalletConnect

- [ ] QR/deep-link connection works.
- [ ] Disconnect from site clears session.
- [ ] Disconnect from wallet clears site state.
- [ ] Reconnect after page refresh.
- [ ] Switch to Base Sepolia from site.
- [ ] Switch to Ethereum Sepolia from site.
- [ ] Wrong-network flow does not loop.
- [ ] Modal closes after provider-confirmed chain change.
- [ ] Returning from wallet app does not leave stale overlay.

### Telegram In-App Browser

- [ ] Page loads as guest.
- [ ] Wallet button is visible.
- [ ] Connect attempt gives expected supported/unsupported behavior.
- [ ] External wallet handoff works or fails clearly.
- [ ] No permanent overlay after failed wallet handoff.
- [ ] Refresh returns to guest or connected state correctly.

### Discord In-App Browser

- [ ] Page loads as guest.
- [ ] Wallet button is visible.
- [ ] Connect attempt gives expected supported/unsupported behavior.
- [ ] External wallet handoff works or fails clearly.
- [ ] No permanent overlay after failed wallet handoff.
- [ ] Refresh returns to guest or connected state correctly.

### X In-App Browser

- [ ] Page loads as guest.
- [ ] Wallet button is visible.
- [ ] Connect attempt gives expected supported/unsupported behavior.
- [ ] External wallet handoff works or fails clearly.
- [ ] No permanent overlay after failed wallet handoff.
- [ ] Refresh returns to guest or connected state correctly.

## Core Runtime Flows

### Guest Browsing

- [ ] Homepage loads without wallet prompt.
- [ ] Gallery loads without wallet prompt.
- [ ] Artwork page loads without wallet prompt.
- [ ] Docs page loads without wallet prompt.
- [ ] Upload page can show connect requirement without forcing modal on load.

### Connect / Disconnect / Reconnect

- [ ] Connect button is visible when disconnected.
- [ ] Connected profile/dropdown appears after connection.
- [ ] Disconnect button is visible inside dropdown.
- [ ] Disconnect clears stale wallet state.
- [ ] Reconnect restores wallet state.
- [ ] Page navigation keeps consistent wallet state.
- [ ] Refresh keeps or clears state according to wallet session truth.

### Network Switching

- [ ] Site-driven switch to Base Sepolia works.
- [ ] Site-driven switch to Ethereum Sepolia works.
- [ ] Missing chain add flow works where wallet supports it.
- [ ] User rejection leaves modal usable.
- [ ] Wrong-network state does not block guest browsing.
- [ ] Chain switch while dropdown is open does not break dropdown.
- [ ] Chain switch while network modal is open closes after provider confirmation.

### Account Change

- [ ] Switching accounts updates displayed wallet.
- [ ] Profile dropdown updates.
- [ ] Old user state does not remain visible.
- [ ] Social signals do not write under the wrong wallet.
- [ ] Auction/bid actions use the active wallet only.

### Mobile App Return State

- [ ] Returning from wallet app resumes pending connection.
- [ ] Returning after rejecting request leaves site usable.
- [ ] Returning after network switch updates chain display.
- [ ] Browser back/forward does not reopen stale modal.
- [ ] Closing and reopening mobile tab does not force network modal for guest users.

## Protocol Action Smoke Checks

Run only with test wallets and testnet ETH.

- [ ] Publish/register artwork.
- [ ] Create auction with 24h duration.
- [ ] Bid from a non-creator wallet.
- [ ] Confirm self-bid is rejected.
- [ ] Confirm self-outbid is rejected.
- [ ] End auction after end time.
- [ ] Complete settlement from winner.
- [ ] Confirm NFT lazy mint.
- [ ] Confirm canonical floor.
- [ ] List resale at or above floor.
- [ ] Buy resale from a different wallet.
- [ ] Confirm ownership transfer.

Do not settle Base Sepolia `auctionId=2`; it is reserved for default-path testing.

## Failure Evidence To Capture

For every failure, capture:

- Page URL
- Network
- Wallet app
- Browser/device
- Screenshot or video
- Transaction hash if any
- Console error if any
- Whether refresh fixed it
- Whether disconnect/reconnect fixed it
- Whether switching account or network was involved

## Pass Criteria

Wallet QA can pass for limited public testnet when:

- Desktop MetaMask and Rabby can complete connect, switch, publish, auction, bid, settlement, and resale paths.
- MetaMask Mobile can connect, switch network, and recover after wallet app return.
- WalletConnect does not leave stuck modal/session state.
- Guest browsing never opens wallet/network modals on page load.
- Wrong-network state is recoverable.
- Disconnect clears stale state.

## Known Watch Items

- Mobile wallet app switching can delay provider events.
- In-app browsers may block injected providers or deep links.
- Supabase social signal persistence may fall back until GRANT/RLS policies are finalized.
- Ethereum Sepolia has not yet completed settlement/default/resale parity.
- Base default path is still pending timer completion.
