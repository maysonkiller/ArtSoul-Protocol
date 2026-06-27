# ArtSoul

ArtSoul is an auction-first NFT art discovery protocol built on Base.

Artists publish artwork, the community discovers and signals interest, primary auctions establish the first collector and canonical floor, settlement lazily mints the NFT, and later resale preserves creator royalties and public provenance.

## Protocol Lifecycle

1. Creator uploads media and metadata.
2. Creator registers artwork on-chain.
3. Creator creates a primary auction.
4. Collectors bid during the auction window.
5. If the auction ends with no bids, no NFT is minted.
6. If the auction ends with a winner, settlement opens.
7. Successful settlement lazily mints the NFT to the First Collector.
8. The successful settlement creates the canonical floor.
9. Minted NFTs can later be listed for resale.
10. Provenance remains visible as Creator, First Collector, and Owner.

## Canon

The protocol canon lives in `docs/canon/`.

Important rules:

- Contracts and transaction receipts are protocol truth.
- `/api/public/artworks` is the public indexed source.
- Local pending state is only a temporary bridge while the indexer catches up.
- Legacy Supabase rows are compatibility/history only.
- ArtSoul is token-free: no token, no points, and no airdrop logic.
- Hidden anti-sybil implementation details are intentionally not stored in this public repository.

## Tech Stack

- Frontend: static HTML, React inline pages, CSS theme system.
- Wallet: AppKit / injected wallet providers.
- Contracts: Solidity, Hardhat, OpenZeppelin.
- Chain: Base for mainnet scope; Base Sepolia and Ethereum Sepolia may be used during testnet.
- Backend/API: Vercel serverless routes.
- Storage and database: Supabase/Postgres.
- Indexer: Node.js projection worker.

## Local Setup

Install dependencies:

```bash
npm install
```

Copy the environment template:

```bash
cp .env.example .env
```

Fill local values in `.env`. Never commit real secrets.

Run checks:

```bash
node --check src/api/routes/public/artworks.js
node --check src/indexer/production-runner.js
```

Run the indexer locally when needed:

```bash
set -a
source .env
set +a
node src/indexer/production-runner.js
```

On Windows PowerShell, set variables through `.env` tooling or the process manager used for your environment.

## License

No license is granted for reuse at this time. See `LICENSE`.
