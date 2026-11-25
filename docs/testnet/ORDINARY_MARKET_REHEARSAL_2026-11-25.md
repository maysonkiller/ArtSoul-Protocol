# Ordinary market deployment on Base Sepolia

The reviewed payer created the market in block 63,473,005 of chain 84532. Its constructor created the paired NFT contract. The deployment carried zero ETH and consumed 5,317,922 gas. L2 execution cost 31,907,532,000,000 wei and L1 data cost 8,959,036,829,157 wei, for a total of 0.000040866568829157 test ETH. [Deployment receipt](https://sepolia.basescan.org/tx/0xbbb61082d9140c6c359757250f784f8a2823ef575860bda6725e256de7d1b1d1)

| Contract | Address | Runtime Keccak-256 with immutable values bound |
| --- | --- | --- |
| OrdinaryMarket | `0x7519974E44583D56FcEB36dc63799941CC83B30e` | `0x1ab3054fe9967923903631ff74cec5a6577b308d33b6d8b10ef82fa285fbb1a5` |
| SettledArtworkNFT | `0x15EcEf00b6C32FC3dE26C9185FcDb95C62D8a277` | `0x9ca7ddbe40fb291d91b7c89221e61f44672de45a869ff3c37f68dd97d54e6e4f` |

The deployment input hash was `0xa05bf1b95586bcd755d0abd8b722d93b5a653e33172173a9ccab67d87a86ac30`. The [receipt verifier](../../scripts/prepare-rehearsal-core.mjs) checks the transaction, the two bound runtimes, the Core/NFT references, three distinct two-of-three Safes and the refund limits of eight entries and 30,000 gas per transfer. [Protocol treasury receipt](https://sepolia.basescan.org/tx/0x092494ba2ee96a59755ea23707c0399bae70d1fb04fa48a4fbe4aeb00e23d4e1) · [Ecosystem treasury receipt](https://sepolia.basescan.org/tx/0x8872fba832bd22fa3d98340658923a7d7162bf8cced5d29fc6c911daafdd8756)

## Auction and resale simulation

Both `sepolia.base.org` and `base-sepolia-rpc.publicnode.com` executed the same read-only simulation against the deployed code at the creation block. Only the virtual participants' balances and the virtual block times were supplied. The chain recorded the deployment. The following balances and actions belong to the simulation.

| Scenario | Observed result |
| --- | --- |
| First auction | Publication and bidding left NFT supply at zero. At the deadline the winner paid the balance of 0.10 ETH and received token 1. |
| Resale | After a 0.20 ETH resale the new buyer owned token 1. The creator and First Collector stayed the same. Across both sales the artist accrued 0.1085 ETH, the first collector 0.185 ETH, the protocol 0.0045 ETH and the ecosystem 0.002 ETH. |
| Late bid and default | A 0.11 ETH bid one minute before close extended the end by ten minutes. Closing opened the full 24-hour payment window. After default the runner-up received the 0.01 ETH deposit back and could buy at their own 0.10 ETH price. The 0.011 ETH defaulted deposit split 80/20. |
| No bids | The expired auction disappeared from the work's active auction lookup and closed without minting. |

Repeat the read-only check with the reviewed test register. The two providers must agree. No private key or wallet connection is used.

```sh
node scripts/simulate-rehearsal-auction.mjs <test-pair-register.json> 0xfa3b8d4570232525c37e253d6edc1912dde822d96ce8e0431887348723eb1cd3
```

C13 still requires signed participant journeys, finalized settlement and keeper receipts, refund execution, hosted indexing and visible results on the site. Those observations are separate from the simulated lifecycle.
