# ArtSoul Engineering Handoff

Updated: 2026-08-19

Production code baseline: `main` includes `f4297ce` and currently heads at `f904d90` (merged PR #196)

Companion state document: `docs/PROJECT_STATE.md`. That file is a dated audit
snapshot, not a live status source. Where it disagrees with
[`BACKLOG.md`](BACKLOG.md), the backlog is correct.

This handoff is for the next engineering task or a new Codex thread. It contains operational facts, not product marketing. Never expose the internal release codename in UI, investor material, or public campaign copy.

## 1. Start Here

Read these files before changing anything:

1. `AGENTS.md`
2. `docs/canon/ARTSOUL_CANON_BIBLE_FULL.md`
3. `docs/BACKLOG.md`
4. `docs/RESOURCE_GATED_WORK.md`
5. The relevant split canon file in `docs/canon/`
6. `docs/canon/12_IMPLEMENTATION_BACKLOG.md`
7. `docs/canon/17_ROADMAP_PHASES.md`
8. `docs/PROJECT_STATE.md`
9. This file

`docs/BACKLOG.md` is the durable cross-phase work register. Put every new chat, report, review, or partner idea there before implementation; the Canon Bible remains authoritative for architecture.

`docs/RESOURCE_GATED_WORK.md` records requirements that remain mandatory but are deferred until their external funding, domain, signer, audit, legal, or operating prerequisites exist. Do not silently drop those items or bypass their security gates to reduce cost.

Current phase: **Phase A, Stabilize Public Testnet**.

Do not start Phase C contract work, Genesis implementation, a token, points, airdrops, partner collections, or premium aura work while Phase A acceptance blockers remain.

## 2. Authoritative Links

| Resource | Location |
| --- | --- |
| Production site | `https://artsoulprotocol.com` |
| Legacy Vercel alias | `https://artsoul.vercel.app` (temporary rollback/cutover origin) |
| Repository | `https://github.com/maysonkiller/ArtSoul-Protocol` |
| Protocol docs | `https://artsoulprotocol.com/docs-protocol` |
| Gallery | `https://artsoulprotocol.com/gallery` |
| Wallet isolation bench | `https://artsoulprotocol.com/wallet-test?walletdebug=1` |
| Public indexer status | `https://artsoulprotocol.com/api/public/indexer-status` |
| Public projection API | `https://artsoulprotocol.com/api/public/artworks` |
| Controlled-beta entry | [`testnet/CONTROLLED_BETA_ENTRY.md`](testnet/CONTROLLED_BETA_ENTRY.md) |
| Controlled-beta issue form | `https://github.com/maysonkiller/ArtSoul-Protocol/issues/new?template=controlled-beta-bug.yml` |
| Project X account | `https://x.com/ArtSoulProtocol` |
| Community | `https://t.me/ArtSoulCommunity` |

The wallet isolation bench is intentionally excluded from navigation. The external-mobile runtime and wrong-network recovery path passed production acceptance on 2026-07-30 through PR #156. A fresh production mobile SIWE signature and both authenticated negative upload-policy probes passed on 2026-08-04; see `testnet/A1_MOBILE_AUTH_UPLOAD_POLICY_ACCEPTANCE_2026-08-04.md`. Remove the bench only through a separate post-acceptance cleanup task after that evidence merges.

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
| Health endpoint | `http://127.0.0.1:3001/health` on the indexer host (loopback-only bind; `/metrics` requires `METRICS_AUTH`) |
| Operational chain | Base Sepolia, chain ID 84532 |
| Legacy read chain | Ethereum Sepolia, chain ID 11155111, process stopped |
| Wallet UI | Reown AppKit 1.8.21 plus a dedicated external-mobile WalletConnect core path; production runtime and Base Sepolia recovery accepted 2026-07-30 |
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

[`BACKLOG.md`](BACKLOG.md) is the status source and this section is a view of it,
never a second opinion. If the two disagree, the backlog wins and this section is
stale. One backlog item equals one task and one pull request.

Phase A stands at **56 done, 11 in progress, 7 planned** across A-01 to A-74. A-58 was reopened on 2026-08-23 by new founder iOS evidence that contradicted browser-only acceptance: first visits to profile tabs flashed synthetic cards. A-50, A-53, A-56 and A-61 await a run on a device with a connected wallet; A-51, A-52, A-54, A-55 and A-60 were closed on 2026-08-21 by measurement in a browser. Do not re-open a `done` row without new
contradicting evidence; every one of them carries dated production acceptance.

Accepted and closed - do not redo:

| Area | Backlog rows | Evidence |
| --- | --- | --- |
| Secrets, RLS, migration ledger | A-01, A-02 | `testnet/A1_CREDENTIAL_HISTORY_ACCEPTANCE_2026-08-07.md`, `testnet/A1_MOBILE_AUTH_UPLOAD_POLICY_ACCEPTANCE_2026-08-04.md` |
| External-mobile wallet and diagnostics removal | A-03, A-04 | `testnet/MOBILE_WALLET_PRODUCTION_ACCEPTANCE_2026-07-30.md` |
| Shared header identity and first paint | A-05, A-45, A-46 | `testnet/SHARED_HEADER_PRODUCTION_REACCEPTANCE_2026-08-13.md` |
| Indexer depth, failure integrity, heartbeat, metrics auth | A-14, A-15, A-40 to A-43 | PRs #112, #114, #136, #138, #140, #142, #144, #145 |
| CI and the canonical test runner | A-16, A-17 | `.github/workflows/ci.yml`, `scripts/run-unit-tests.mjs`, `npm test` |
| Projections, provenance, profile gating | A-18, A-19 | PRs #120, #122, #124, #126, #127 |
| Base commitments, homepage, network copy | A-24 to A-28, A-44 | `runbooks/A11_PUBLIC_METRICS_ROLLOUT.md`, `testnet/A12_NETWORK_COPY_ACCEPTANCE.md` |
| Infrastructure cost observation | A-13 | `runbooks/A9_INFRA_COST_MONITORING.md` |

Dated acceptance statements, kept verbatim because they are the evidence that
these rows are closed:

- A1-A6, A9, A11, and A12 are accepted. A1 security and migration operational acceptance is complete.
  The 2026-08-04 iOS run captured a fresh SIWE
  signature and exact authenticated rejection of unsupported MIME and an
  artwork-size request greater than 50 MB, and the 2026-08-07 redacted record
  confirmed server-credential separation, retirement of the exposed secondary
  development key, forced production RLS, and zero open GitHub secret alerts.
- A9 was accepted on 2026-07-28 after the 2026-07-22 through 2026-07-28
  Alchemy and Supabase observation window. Alchemy forecast 22.9M of the 30M
  hard limit; ArtSoul-only Supabase uncached egress stayed at 41.0-59.4 MB/day
  and Spend Cap remained enabled. Continue the Tuesday/Friday checks in
  [`runbooks/A9_INFRA_COST_MONITORING.md`](runbooks/A9_INFRA_COST_MONITORING.md).
- A11, A12, and backlog A-24 through A-28 were accepted on production on 2026-07-28 through PRs #160, #162 and #163.
  Migration 015, the cached
  aggregate, the public API, the responsive homepage, active-network copy, the
  canonical Genesis trust copy, React entry scheduling, Hetzner health, an
  advancing cursor and saved PM2 state all passed.

### 1. The moderation chain is the founder-gated Phase A dependency

A-21, A-22 and A-39 are one dependency chain and they are the reason
[`testnet/CONTROLLED_BETA_ENTRY.md`](testnet/CONTROLLED_BETA_ENTRY.md) is still
**NO-GO** under A-23.

It is not the only open Phase A work. A-50 through A-52 have merged fixes and
still require production acceptance; A-53 and A-54 are measured-defect work;
and the planned engineering rows in the next section also remain open.

- **A-39** (PR #129, PR #196): A8a step-up and the A8d Safe-only recovery
  foundation are merged with the flag disabled and the migrations unapplied.
- **A-22** (PR #133): the Protocol Admin review queue, notifications and audit
  log are implemented and reviewed; they cannot be activated before A-39.
- **A-21** (PR #130): complaint intake exists behind a disabled flag and must
  stay disabled until A-22 has an operational review path.

The remaining work here is **not code**. It is a single ordered activation
sequence owned by the founder, defined in
[`runbooks/A8_MODERATION_ROLLOUT.md`](runbooks/A8_MODERATION_ROLLOUT.md) section 3:
a verified Supabase backup; the four migrations `a8a`, `a8b`, `a8c`, `a8d`
applied **in that order** with their read-only verification output archived;
final RP ID, origin, moderation-session secret, Safe, chain and two independent
recovery RPCs configured; two enrolled founder passkeys; the one-time audited
bootstrap grant; and the full A8d recovery ceremony including every mandatory
denial in [`runbooks/A8D_SAFE_RECOVERY.md`](runbooks/A8D_SAFE_RECOVERY.md)
section 6. See RG-03 in [`RESOURCE_GATED_WORK.md`](RESOURCE_GATED_WORK.md).

RG-01 gates that sequence and is the cheapest open item in the project. Its
fill-in evidence form is
[`testnet/RG01_APEX_ORIGIN_SMOKE_CHECKLIST.md`](testnet/RG01_APEX_ORIGIN_SMOKE_CHECKLIST.md).

The 2026-08-16 Base Sepolia multisig rehearsal
([`testnet/RG05_SAFE_MULTISIG_REHEARSAL_2026-08-16.md`](testnet/RG05_SAFE_MULTISIG_REHEARSAL_2026-08-16.md))
proved threshold enforcement and signer-loss replacement. It does **not** satisfy
A-39: A8d verifies a server-issued recovery message through EIP-1271 and two RPC
endpoints, which that rehearsal never exercised.

### 2. Unblocked engineering available now

These eight rows need no founder decision and no new spend:

| Row | Work | First step |
| --- | --- | --- |
| A-47 | Reduce head asset weight | Split `avatar-dropdown.js` and attack the exact-artwork cold path. Lazy-loading `appkit-init.js` was investigated on 2026-08-11 and **rejected**: it is the sole writer of `window.artsoulWalletStateSettled`. |
| A-58 | Remove first-visit profile-tab card flashes | Draw no synthetic card grid for an uncached tab; keep the selected tab and heading aligned and retain only the compact loading status. |
| A-48 | Full-document repaint on browser Back | PR #203 fixes the measured `NetworkExceedsBufferLimit` cause by deferring offscreen card images; close only after production desktop and iOS/Android Back acceptance. |
| A-53 | Header/profile settle gap | Measure which wallet event gates each surface before changing either lifecycle. Preserve A-03, A-05 and A-45 acceptance. |
| A-54 | Cross-page perceived load | Reproduce on a cold profile and identify the resource that gates interactivity. Do not assume the API is responsible. |
| A-33 | Artwork-page acceptance sweep | Open concrete defects only; do not redesign or touch auction mechanics. |
| A-34 | Reusable aura frame shell | Presentation-only API. Real status binding stays C-14. |
| A-35 | Migration trees and legacy runtime | Reconcile what is applied before deleting anything. |
| A-38 | Dependency and warning triage | Classify runtime versus dev-only. Never `npm audit fix --force`. |

### 3. Standing operational duties

- Continue the Tuesday/Friday Alchemy and Supabase review in
  [`runbooks/A9_INFRA_COST_MONITORING.md`](runbooks/A9_INFRA_COST_MONITORING.md).
- Keep `npm run monitor:indexer` green and PM2 saved only after acceptance.
- Track tester feedback in GitHub Issues, never in chat-only queues.
- Do not start Phase C contract work, Genesis, Collections, promoted banners or
  premium aura work while any Phase A row above is open.

## 6. Local Development Commands

Windows PowerShell examples:

```powershell
cd C:\Projects\ArtSoul
git fetch origin
git checkout main
git pull --ff-only origin main
npx --yes npm@11.6.2 ci
npm run build
git diff --check
```

The aggregate command is repaired and is the default. `npm test` runs
`test:unit` through `scripts/run-unit-tests.mjs` and then `test:contracts`
through Hardhat, which is the same thing CI runs on Ubuntu and Windows:

```powershell
npm test
```

Run individual suites only when narrowing a specific failure:

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

`npm run build` already runs the route verifier. A successful build must report ten HTML routes and no in-browser Babel or async module-entry mount races.

## 7. Vercel Deployment

Vercel configuration:

- Build command: `npm run build`
- Output directory: `dist`
- API rewrites: `vercel.json`
- Clean public URLs: Vercel permanently redirects historical `.html` URLs to extensionless routes; `/docs` and `/auction-system` redirect to `/docs-protocol`

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

For the accepted fail-closed health thresholds and the no-cost Alchemy/Supabase review cadence, use [`runbooks/A9_INFRA_COST_MONITORING.md`](runbooks/A9_INFRA_COST_MONITORING.md). After its deployment, `npm run --silent monitor:indexer` is the operator check; do not poll it more often than every five minutes because `/health` observes the current block.

Safe deployment after a merged indexer PR:

```bash
ssh root@46.224.202.18
cd /opt/artsoul
git status --short
git pull --ff-only origin main
npx --yes npm@11.6.2 ci --omit=dev
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

The indexer HTTP server binds to `127.0.0.1` only; port 3001 is never exposed
publicly. `METRICS_AUTH` is a required secret in `/opt/artsoul/.env.shared`
(single-quoted, the full Authorization header for `/metrics`); the indexer fails
closed and will not start without it. See `runbooks/A9_INFRA_COST_MONITORING.md`
for setup, rotation, and rollback.

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
- Event processing registry failure states (`failed`, `dead`) - the A-15 source of truth

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
- The `failed_events` table does not exist and is not required; A-15 retired that dead subsystem in favour of fail-closed `event_processing_registry` retries.
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
