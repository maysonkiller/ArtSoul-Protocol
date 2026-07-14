# ArtSoul Engineering Handoff

Updated: 2026-07-15

Repository baseline: `main` at `fdd9518`

Companion state document: `docs/PROJECT_STATE.md`

This handoff is for the next engineering task or a new Codex thread. It contains operational facts, not product marketing. Never expose the internal release codename in UI, investor material, or public campaign copy.

## 1. Start Here

Read these files before changing anything:

1. `AGENTS.md`
2. `docs/canon/ARTSOUL_CANON_BIBLE_FULL.md`
3. The relevant split canon file in `docs/canon/`
4. `docs/canon/12_IMPLEMENTATION_BACKLOG.md`
5. `docs/canon/17_ROADMAP_PHASES.md`
6. `docs/PROJECT_STATE.md`
7. This file

Current phase: **Phase A, Stabilize Public Testnet**.

Do not start Phase C contract work, Genesis implementation, a token, points, airdrops, partner collections, or premium aura work while Phase A acceptance blockers remain.

## 2. Authoritative Links

| Resource | Location |
| --- | --- |
| Production site | `https://artsoul.vercel.app` |
| Repository | `https://github.com/maysonkiller/ArtSoul-Protocol` |
| Protocol docs | `https://artsoul.vercel.app/docs-protocol.html` |
| Gallery | `https://artsoul.vercel.app/gallery.html` |
| Wallet isolation bench | `https://artsoul.vercel.app/wallet-test.html?walletdebug=1` |
| Public indexer status | `https://artsoul.vercel.app/api/public/indexer-status` |
| Public projection API | `https://artsoul.vercel.app/api/public/artworks` |
| Project X account | `https://x.com/ArtSoulProtocol` |
| Community | `https://t.me/ArtSoulCommunity` |

The wallet isolation bench is intentionally excluded from navigation. Keep it until production external-mobile acceptance and post-cleanup regression testing are complete.

## 3. Production Topology

| Component | Current implementation |
| --- | --- |
| Frontend | Vite multi-page build on Vercel, output `dist/` |
| Serverless API | Vercel catch-all `api/[...route].js` |
| Database and storage | Supabase Postgres and Storage |
| Projection source | Hetzner indexer writes chain-scoped projection tables |
| Indexer host | `46.224.202.18` |
| Indexer path | `/opt/artsoul` |
| Process manager | PM2 |
| Active process | `artsoul-base-sepolia` |
| Health endpoint | `http://127.0.0.1:3001/health` on the indexer host |
| Operational chain | Base Sepolia, chain ID 84532 |
| Legacy read chain | Ethereum Sepolia, chain ID 11155111, process stopped |
| Wallet UI | Reown AppKit 1.8.21 plus a dedicated external-mobile WalletConnect core path |
| AI guidance | Gemini 2.5 Flash-Lite through a server-side API route |

## 4. Base Sepolia Contracts

| Contract | Address |
| --- | --- |
| ArtSoul Core | `0x43368f7E2d5f11f4B7E11928D66d3f4A5a4E4ceF` |
| ArtSoul NFT | `0xf061f70503c37Cf2196A28F4785E524D0Fb32538` |
| Project NFT testnet prototype | `0xBd17c875962a3cd34F10405234527a41A90A682B` |

These are public-testnet deployments. Do not represent them as mainnet-ready.

The current Core has canon-incompatible resale splits, the NFT royalty is 7.5%, the Project NFT is a transferable 100-supply prototype, and marketplace approval restrictions are absent. See `docs/PROJECT_STATE.md` before any contract task.

## 5. Immediate Priority Queue

Follow this order. One item equals one task and one PR.

### 1. Verify security and migration state

- Confirm historical service credentials and any deployer key findings from `SECURITY_PUBLIC_READINESS_REPORT.md` were rotated or retired.
- Run a current-tree and history secret scan without printing findings to chat or logs.
- Verify applied Supabase migrations, especially Phase 18 RLS/security and moderation visibility.
- Decide whether repository history remediation is complete.

### 2. Close the mobile wallet acceptance cycle

Use one fresh tab on a real phone:

1. Close every ArtSoul tab.
2. Open production in external Chrome or Safari.
3. Connect through the wallet app and manually return to the same browser tab.
4. Verify the connected identity persists across homepage, gallery, artwork, profile, and upload.
5. Reload each page.
6. Background the browser for five minutes and return.
7. Trigger one protected write such as Like or Bid and confirm the Base Sepolia guard requests at most one network switch.
8. Explicitly Disconnect and verify the session remains clean.

If any step fails, capture `?walletdebug=1` logs and fix the smallest proven state-machine defect. Do not rewrite the wallet stack.

### 3. Remove production visual wallet diagnostics

Only after item 2 is green:

- Remove visual overlay wiring from production pages.
- Keep flag-gated console diagnostics where useful.
- Keep the full visible diagnostic pane on `/wallet-test.html`.
- Bump cache versions and update tests.

### 4. Restore a green test baseline and add CI

- Repair the 20 current Node-suite failures.
- Replace the failing placeholder `npm test` script with the canonical suite.
- Keep Hardhat tests separate from generic Node tests.
- Add GitHub Actions for build, Node tests, Hardhat tests, and `git diff --check`.

### 5. Fix indexer status configuration drift

`INDEXER_CONFIRMATION_DEPTH=3` is active in runtime, but an existing `indexer_state` row still reports 12. Update the persisted field when configuration changes, add a focused test, and verify `/api/public/indexer-status` matches `/health`.

Do not alter auction confirmation semantics while fixing observability.

### 6. Verify projections and provenance

- Exercise registered, live, no-bid, awaiting-payment, defaulted, sold/minted, listed, and resold states.
- Verify Creator, First Collector, and Owner are derived from indexed on-chain data.
- Verify full timeline order and profile links.
- Verify cards remain creator-focused and do not duplicate ownership rows.

### 7. Complete profile lifecycle and action gating

- Re-test created, auction, sold, and collected tabs.
- Ensure owner-only resale, creator-only re-auction, winner-only settlement, and legacy-chain read-only behavior.
- Confirm disconnected profile renders immediately without background churn.

### 8. Build moderation/reporting MVP

- Add a Report action on each artwork.
- Implement complaint submission and notice-and-takedown review state.
- Add a review queue and audit trail.
- Preserve the existing three-factor moderator access and multisig requirement for irreversible actions.
- Do not build Content-ID or audio fingerprinting; v1.2 canon explicitly removed that requirement.

### 9. Confirm infrastructure cost and health

- Monitor Alchemy for at least seven days after PR #90.
- Confirm usage trends toward less than 30% of the monthly free tier.
- Add indexer lag, fallback-RPC, API error, Supabase egress, and PM2 restart alerts.
- Resolve the optional missing `failed_events` table or explicitly retire that metric.

### 10. Enter controlled public beta

Invite trusted testers only after items 1 through 9 meet their acceptance criteria. Track feedback in GitHub Issues rather than chat-only queues.

## 6. Local Development Commands

Windows PowerShell examples:

```powershell
cd C:\Projects\ArtSoul
git fetch origin
git checkout main
git pull --ff-only origin main
npm ci
npm run build
git diff --check
```

Run focused Node tests explicitly until the aggregate script is repaired:

```powershell
node --test test/mobile-wallet-session-persistence.test.cjs
node --test test/mobile-wallet-connect-recovery.test.cjs
node --test test/egress-public-projection-smoke.test.cjs
node --test test/egress-auction-live-smoke.test.cjs
node --test test/rpc-diet.test.cjs
```

Run contract tests through Hardhat, not the generic Node test runner:

```powershell
npx hardhat test test/ArtSoulV41.test.cjs
```

If Hardhat fails while creating its global config directory on Windows, point `APPDATA` to a writable temporary directory for that command. Do not add machine-specific paths to the repository.

Syntax-check changed non-module JavaScript where applicable:

```powershell
node --check appkit-init.js
node --check wallet-core-connect.js
node --check contracts-integration.js
```

`npm run build` already runs the route verifier. A successful build must report nine HTML routes and no in-browser Babel.

## 7. Vercel Deployment

Vercel configuration:

- Build command: `npm run build`
- Output directory: `dist`
- API rewrites: `vercel.json`
- Legacy redirects: `/docs.html` and `/auction-system.html` to `/docs-protocol.html`

Normal workflow:

1. Push a task branch.
2. Open a draft PR in English.
3. Test the Vercel preview on desktop and mobile.
4. Merge only after acceptance.
5. Verify production after Vercel deploys `main`.

Do not test mobile session persistence only on a preview origin. Final wallet acceptance must run on production because origin-scoped WalletConnect and browser storage differ.

## 8. Hetzner Indexer Operations

The launch scripts and environment files on Hetzner are local operational files and are intentionally not tracked. Preserve them.

Read-only inspection:

```bash
ssh root@46.224.202.18
cd /opt/artsoul
git status --short
git branch --show-current
git log -1 --oneline
pm2 list
curl -fsS http://127.0.0.1:3001/health
pm2 logs artsoul-base-sepolia --lines 100 --nostream
```

Safe deployment after a merged indexer PR:

```bash
ssh root@46.224.202.18
cd /opt/artsoul
git status --short
git pull --ff-only origin main
npm ci --omit=dev
pm2 restart artsoul-base-sepolia --update-env
pm2 save
curl -fsS http://127.0.0.1:3001/health
pm2 logs artsoul-base-sepolia --lines 100 --nostream
```

Stop if `git status` shows unexpected tracked changes. Do not delete the untracked `start-base-indexer.sh`, `start-eth-indexer.sh`, `.env.shared`, `.env.base-sepolia`, or `.env.eth-sepolia` files.

Current intended Base settings:

```text
ARTSOUL_INDEXER_CHAINS=base-sepolia
INDEXER_POLL_INTERVAL=15000
INDEXER_MAX_BLOCK_RANGE=10
INDEXER_REORG_CHECK_INTERVAL=60000
INDEXER_REORG_SAMPLE_SIZE=12
ARTSOUL_SKIP_EMPTY_BLOCK_HASH_BACKFILL=1
INDEXER_HEALTH_PORT=3001
```

`INDEXER_REORG_CHECK_INTERVAL=60000` means one reorg audit every 60 seconds.

RPC configuration must list the public Base Sepolia endpoint and at least one fallback through environment variables. Never print provider URLs containing credentials.

## 9. Database Operations

Migration locations:

- `migrations/`
- `sql/migrations/`
- `src/indexer/migrations/`

Before applying anything:

1. Compare the target database schema with every relevant migration.
2. Record an applied-migration ledger.
3. Back up affected tables.
4. Run in a transaction where supported.
5. Verify RLS, grants, functions, and API behavior after the change.

Never assume a file is unapplied merely because it exists in the repository. Never run all migration directories as one batch.

Minimum production checks should confirm the presence and policies of:

- Chain-scoped projection tables
- `indexer_state`
- Event processing and distributed-lock tables
- Discovery signal tables
- Wallet auth nonce/session support
- AI valuation tables
- Artwork moderation visibility and log tables
- Phase 18 security functions and RLS policies
- Optional `failed_events` queue, if retained

## 10. Wallet Invariants

Preserve these invariants:

1. Wallet connection is the only sign-in model.
2. External-mobile core WalletConnect sessions are the source of truth on that path.
3. Only explicit Disconnect tears down a confirmed session.
4. Closing a modal is never destructive to a live session.
5. Manual return must be to the same browser tab.
6. Connect does not silently execute a transaction.
7. Operational writes require Base Sepolia chain ID 84532.
8. Legacy Ethereum Sepolia content remains readable but write-disabled.
9. Retry may clear only an unfinished connection when no confirmed address exists.
10. No infinite spinner, network-switch loop, or repeated wallet prompt is acceptable.

Production pinned versions must stay aligned unless a dedicated upgrade task proves a new matrix:

```text
@reown/appkit 1.8.21
@reown/appkit-adapter-wagmi 1.8.21
@walletconnect/ethereum-provider 2.23.10
@walletconnect/modal 2.7.0
```

## 11. Ten Non-Negotiable Engineering Rules

1. Read the canon before coding and name the touched sections in the task report.
2. Never change frozen economics, lifecycle, roles, states, or parameters silently.
3. Keep the product single-chain on Base; testnet legacy data is not a multichain product promise.
4. Never add token, points, airdrop, or unapproved reward mechanics.
5. Contracts and indexed events are authoritative; browser-local state is temporary only.
6. Never expose private keys, service-role keys, OAuth secrets, server credentials, or private anti-sybil logic.
7. Every write path must enforce Base Sepolia on testnet and must never submit on a legacy or unsupported chain.
8. Use `--c-*` theme variables, preserve strict Classic/Future separation, and keep mobile free of idle animation.
9. One backlog item equals one branch and one PR; preserve unrelated user changes.
10. Contract changes require focused tests, security review, and an explicit storage-layout warning.

## 12. Known Traps

- `npm test` is not configured and currently fails by design.
- The generic Node suite launches the Hardhat test incorrectly; run Hardhat separately.
- The build succeeds but warns about many global scripts that remain outside the Vite module graph.
- `src/api/server.js` contains Express-era services that are not the Vercel production entrypoint.
- Public AppKit negotiation includes Base and Ethereum mainnet for wallet compatibility, but this does not authorize writes or change the Base-only product scope.
- Public `indexer_status.confirmation_depth` is stale after an env-only depth change.
- The optional `failed_events` production table is missing.
- The local `.queue-wal/` directory is runtime state and is ignored by Git.
- Do not delete or overwrite local Hetzner launch scripts and environment files during pull/deploy.
- Do not describe the Project NFT testnet prototype as canonical Genesis.

## 13. PR and Reporting Standard

Repository-facing text must be English:

- Branch names
- Commit messages
- PR title and body
- Code comments
- Tests
- Documentation

The founder-facing chat report may be Russian.

Every PR report should include:

- What was observed before the change
- Root cause
- Files changed
- Canon sections touched and any conflict
- Exact validation commands and results
- Desktop/mobile and Classic/Future verification where relevant
- Deployment or founder actions
- Rollback path

Do not merge on behalf of the founder unless explicitly asked for that specific PR.
