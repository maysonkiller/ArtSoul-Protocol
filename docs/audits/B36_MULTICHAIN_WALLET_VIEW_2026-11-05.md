# B36 — read-only multichain wallet asset viewer

Date: 2026-11-05. Release: NO_GO / SOURCE_ONLY. No production flags, credentials, subscriptions, contracts, indexers, SQL or host settings changed.

## Existing baseline
The previously merged PRs #461, #463 and #464 provide authenticated Base Mainnet NFT inventory from Alchemy v3, with exact 12-item pagination and cached previews. The new B36 route extends this display layer, NOT ArtSoul auction authority, minting, settlement, NFT historical ownership proof, chain deployment or a production indexer.

## Intended UX
- One Collected-tab wallet gallery inspired by MetaMask: clearly labeled NFT/Token modes, network selector (Base, Ethereum, Arbitrum, Optimism, Polygon, Linea, BNB, Avalanche), chain chip, clean raster thumbnail, title, collection, exact token ID, ERC721/1155 standard, quantity, contract address and bounded traits.
- Native ETH/ERC20 balances use integer/decimals math, not unsafe floats. Optional API prices are per-unit reference quotes, never verified sales, listings, ownership costs or financial advice.
- Safe external explorer and OpenSea asset links only. View on OpenSea is not a claim of an available marketplace listing or a transaction supported by ArtSoul. No sale, transfer or signature button.
- The All choice queries only five documented primary networks. Additional networks are individually selectable but require endpoint-by-endpoint provider verification before activation. Partial network errors remain visible while successful items are retained.
- Desktop/responsive cards; two columns for phones >=360px, one for narrower. Both Classic and Future themes. Native iPhone and wallet-extension testing remain outstanding.

## Provider, quota and security
- New ARTSOUL_MULTICHAIN_ASSETS_ENABLED flag is OFF by default. Also requires existing Base inventory feature and its dedicated server-only Alchemy key; existing protocol RPC credentials must never substitute.
- No data loads until the signed-in wallet owner presses Load assets. No background polling, retries, bulk traversal, new worker, local/storage persistence or database writes.
- Same existing authenticated /api/wallet-nfts route, with strict view/network selector. No arbitrary account, URL, chain list or user-controlled page size.
- NFT requests are explicitly capped to 12 items via pageSize; Alchemy Tokens By Wallet does not expose pageSize, so accept at most 100 token results within the 768 KiB response cap. 768 KiB response cap; 10-second abort; 2 concurrent upstream requests; 5-minute process cache and 30-second negative cache; HMAC-signed, time-limited, wallet/view/network/key-bound cursors.
- Process-local budget: six upstream calls per wallet per 10 min, three globally per minute, sixty globally per day. Important: these are NOT account-wide cost ceilings on distributed Vercel functions. Do not activate until a shared durable budget or explicitly accepted provider/account no-spend controls are verified independently.
- Only known Alchemy cached raster CDNs. SVG, arbitrary metadata image URLs, scriptable content and provider error text never reach the rendered UI. Treat names and traits as untrusted strings.
- Source network, contract and 256-bit token ID define identity. Neither token balance nor indexed NFT presence is a transaction proof. Keep ArtSoul verified provenance isolated.

## Release gates
1. Full Linux/Windows CI, static checks, build, existing Base inventory/session regression and synthetic malicious responses.
2. Browser layout acceptance at 320/375/390/768/1024/1440px and native iPhone, in both themes; check full content, links, media fallbacks, keyboard/touch targets and no horizontal clipping.
3. One controlled no-spend provider eligibility / network support verification. Confirm realistic Portfolio CU cost, partial errors, pagination and cached media. Keep the Alchemy account Free, no card or paid upgrade.
4. Independent real CU budget & concurrency acceptance (process-local quota is not hard-spend protection). Preserve the older B30 indexer until B35 release gates close.
5. Owner-approved feature flag release and readback; otherwise leave off. The product is not a multichain NFT marketplace and the new feature does not deploy contracts.
