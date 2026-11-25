# Robinhood NFT launches and Arc payment readiness

Reviewed November 25, 2026. Ordinary ArtSoul publications use Base Sepolia. A connected wallet can browse Robinhood Chain mainnet. Authors can save and review collection drafts for Robinhood Chain testnet. Neither route publishes an ArtSoul NFT on Robinhood.

| Surface | Network available today | Evidence |
| --- | --- | --- |
| Wallet network selector | Robinhood Chain mainnet, EVM chain ID 4663 | [Wallet switching tests](../../test/wallet-browsing-networks.test.cjs) |
| Ordinary registration and auction | Base Sepolia, EVM chain ID 84532 | [Registration receipt checks](../../src/api/upload-registration-evidence.js) and [publication completion](../../test/upload-publish-finalization.test.cjs) |
| Collection builder | Drafts on Base Sepolia or Robinhood Chain testnet, EVM chain ID 46630, with publishing disabled | [Draft registry](../../src/config/collection-networks.js) and [draft review](../../src/features/collections/launch-config.js) |
| External payment from Arc | Research only. Arc mainnet is 5042 and its testnet is 5042002 | [Arc network settings](https://docs.arc.io/arc/references/connect-to-arc) |

## Before enabling publication on Robinhood

The network uses ETH for gas. A candidate deployment needs its own chain-specific contract identities, custody and indexing evidence. Robinhood distinguishes sequencer inclusion, publication of the batch to Ethereum, and Ethereum finality. A fast receipt can update pending UI. Final ownership, the settled price and accounting need a reviewed finality rule that both independent RPC sources can establish. [Official network settings](https://docs.robinhood.com/chain/connecting/) · [Robinhood finality](https://docs.robinhood.com/chain/transaction-finality/)

1. For ordinary works, bind the Robinhood testnet chain ID, reviewed Core/NFT pair, code hashes, deploy block and Safe roles. Rehearse publication, a fully settled sale and a return to artwork status with no mint. Verify ownership and balances against receipts.
2. For collections, bind the launch mechanism and immutable collection configuration to a reviewed deployment on the same testnet. Rehearse the opening sale, public mint and refunds. Verify supply and First Collector from the indexed destination events.
3. Show the issuing network before approval. Reconnect or a later wallet network change must preserve the confirmed work's link and pending record. Existing collection and wallet NFT keys use the issuing EVM chain ID, contract address and token ID. A provider domain or the network used to fund a purchase cannot replace that chain ID.
4. Check the website, API and indexer together on the testnet before adding a public write route. The replacement ordinary deployment tool accepts reviewed Base inputs today. Changing a wallet list or draft option cannot activate a deployment.

## Paying from Arc for an NFT issued elsewhere

Circle lists Arc as domain 26 and Base as domain 6 for USDC transport. These identifiers differ from EVM wallet chain IDs. Both Circle matrices omit Robinhood at this review date. An Arc-to-Base USDC transfer is a potential funding step. The existing auction still requires native ETH on its destination. Circle lists no direct USDC route to Robinhood in either matrix. [Gateway network and asset matrix](https://developers.circle.com/gateway/references/supported-blockchains) · [CCTP domains](https://developers.circle.com/cctp/concepts/supported-chains-and-domains)

Before offering a quote, bind the source and destination chain, native or token contract identity, decimals, exact destination obligation, maximum total spend, minimum output, recipient and expiry. Arc's native and ERC-20 USDC interfaces represent the same balance at 18 and 6 decimals respectively. Convert exact integer units for the chosen interface. Distinct receipts must establish source payment, transport completion and destination auction settlement. Only successful destination settlement can mint the NFT or set its price. [Arc USDC interfaces](https://docs.arc.io/arc/concepts/stablecoin-native-model)

Separate authorization is needed for any conversion, spending limits, recovery payer and refund destination. A bridge receipt alone cannot complete a purchase. If the listing expires, or the destination price or owner changes during transport, preserve the credit attributable to the payer and expose the reviewed recovery path. Launch requires successful recovery rehearsals as well as a successful purchase.

Run `node --test test/network-launch-boundaries.test.mjs test/upload-publish-finalization.test.cjs` to verify the current publication boundaries, asset identities and registration redirects offline. These tests operate on local fixtures and do not verify a Robinhood deployment or a live payment provider.
