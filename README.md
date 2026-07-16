# ArtSoul

ArtSoul is an auction-first NFT art discovery protocol built on Base.

Artists publish artwork, the community discovers and signals interest, primary auctions establish the first collector and canonical floor, settlement lazily mints the NFT, and later resale preserves creator royalties and public provenance.

## OpenAI Build Week

ArtSoul is an existing protocol codebase that was extended during OpenAI Build Week. Work completed during the event is intentionally separated from earlier project history and can be reviewed through timestamped commits and pull requests.

### How Codex and GPT-5.6 were used

Codex with GPT-5.6 was used as the engineering agent for evidence-led debugging, implementation, regression-test design, validation, and pull-request preparation. The founder supplied real-device reproduction steps and on-screen production logs; Codex reconstructed event timelines, compared them with the wallet state machine, implemented narrowly scoped fixes, and verified the result against the repository canon.

The first confirmed Build Week change is the July 13, 2026 mobile-session reconciliation work in commit [`3d7fe3f`](https://github.com/maysonkiller/ArtSoul-Protocol/commit/3d7fe3fb40607e49585552e02f68230e9ec47ce9), merged through [PR #85](https://github.com/maysonkiller/ArtSoul-Protocol/pull/85). That work:

- reconciles delayed persisted WalletConnect sessions before final UI state is applied;
- preserves an already confirmed mobile session across page navigation and restore races;
- adds focused mobile wallet persistence and recovery regression coverage;
- separates bid error classification so wallet and auction errors produce accurate diagnostics;
- preserves the existing Base Sepolia write guard, auction lifecycle, settlement rules, and economics.

The implementation was validated with the production Vite build, Node syntax checks, focused Node test suites, and `git diff --check`. GPT-5.6 was used through Codex for the engineering workflow; it is not an auction pricing authority. ArtSoul's optional in-product AI value guidance remains guidance-only and cannot change settlement, floor, ownership, or royalties.

### Judge links and testing

- Live application: [artsoul.vercel.app](https://artsoul.vercel.app/)
- Public repository: [maysonkiller/ArtSoul-Protocol](https://github.com/maysonkiller/ArtSoul-Protocol)
- Protocol documentation: [Protocol Docs](https://artsoul.vercel.app/docs-protocol.html)

The public site can be explored without credentials. Wallet transactions currently target Base Sepolia testnet. A testnet wallet is required only for protected actions such as publishing or bidding; read-only artwork, discovery, protocol documentation, and profile surfaces remain publicly accessible.

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

Current and completed work is tracked in the [durable project backlog](docs/BACKLOG.md). New ideas must be recorded there before implementation so chat threads do not become a parallel source of truth.

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
