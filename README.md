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

- Live application: [artsoulprotocol.com](https://artsoulprotocol.com/)
- Public repository: [maysonkiller/ArtSoul-Protocol](https://github.com/maysonkiller/ArtSoul-Protocol)
- Protocol documentation: [Protocol Docs](https://artsoulprotocol.com/docs-protocol)

The public site can be explored without credentials. Wallet transactions currently target Base Sepolia testnet. A testnet wallet is required only for protected actions such as publishing or bidding; read-only artwork, discovery, protocol documentation, and profile surfaces remain publicly accessible.

## WebMCP Challenge

ArtSoul was entered in the WebMCP Challenge (25 August – 3 September 2026) as a
pre-existing project extended with WebMCP during the submission window. The
boundary is stated here so prior work is never presented as new.

**Existed before 25 August 2026:** the protocol canon and frozen economics, the
Solidity core and NFT contracts deployed on Base Sepolia, the fail-closed event
indexer, the public projection API, and the whole product interface — gallery,
artwork and auction pages, publishing, profiles and provenance.

**Added during the challenge window:** the agent interface. ArtSoul now declares
eight tools with JSON Schema inputs to a WebMCP-capable browser, so an agent
reads auction state, provenance and lifecycle directly instead of inferring them
from the page. Any action that moves value ends at the person's own wallet: the
agent can open it with a prepared bid, and only after the person has granted that
permission in the page, but the wallet always asks them to approve, and no
website can delegate that click. New files: [`webmcp-tools.js`](webmcp-tools.js),
[`test/webmcp-tools.test.cjs`](test/webmcp-tools.test.cjs) and
[`docs/WEBMCP.md`](docs/WEBMCP.md). Changes to existing files are limited to one
build-manifest line and one deferred script tag on three pages. Every commit in
this work is prefixed `webmcp:` and dated inside the submission window.

No contract, economic rule, API route or protocol behavior was changed for the
challenge. How to enable WebMCP and what each tool answers is documented in
[`docs/WEBMCP.md`](docs/WEBMCP.md).

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
- Chain: Base Sepolia is the only active product testnet; Base is the canonical production chain. Historical Ethereum Sepolia records are read-only migration compatibility.
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

ArtSoul uses a split licence.

- **Software** — contracts, indexer, API, frontend, scripts, tests, and operational documentation are licensed under the [Apache License, Version 2.0](LICENSE). You may use, modify, and redistribute them, including commercially, under the terms of that licence.
- **Protocol canon and brand** — `ARTSOUL_CANON_BIBLE_FULL.md`, `docs/canon/`, and the ArtSoul logo and brand assets are licensed separately under [LICENSE-DOCS](LICENSE-DOCS). They may be read and quoted with attribution, but not republished, adapted, or reused commercially.
- **Trademarks** — "ArtSoul" and the ArtSoul logo are not licensed by the Apache License (Section 6).

See [NOTICE](NOTICE) for the attribution summary required on redistribution.
