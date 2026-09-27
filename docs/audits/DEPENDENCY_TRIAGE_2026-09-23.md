# A-38 dependency and frontend warning triage

Status: **local changes; not deployed**. Scope: canon §§15 and 17, operational
security and build tooling. No contract source, storage layout, economics, chain,
wallet connector version or deployment target changed.

Repository: `C:\Projects\ArtSoul`, branch `codex/takeover-audit`, starting commit
`25917f09edaa683b22049989d23600e5ad8d9d1f`. This is the consolidated working copy.

## Current evidence

The 2026-09-23 lockfile audit reports **58 affected package names: 26 high,
13 moderate, 19 low, zero critical**. This supersedes the July count. The count
is unchanged by this bounded patch because vulnerable copies remain in other
dependency branches. It is not a count of exploitable production defects.

The root manifest declares hundreds of transitive/tooling packages as direct
production dependencies. Consequently, `npm audit --omit=dev` is not an accurate
runtime exposure classification. No blanket manifest cleanup or forced upgrade
was performed.

Evidence files are under `output/audit/`:

- `dependencies-2026-09-23-before.json` and `dependencies-2026-09-23-after.json`:
  raw `npm audit --json` results.
- `dependency-reachability.mjs` and `dependency-reachability.json`: reproducible
  static local-import walk plus resolved lockfile dependency/optional/peer graph.
  This over-approximates browser packages and does not prove exploit reachability.
- `dependencies-update.log`, `dependencies-npm-ci.log`, and focused validation
  logs: installation and test evidence. See the validation section for status.

## Minimal changes

| Change | Reason and primary evidence |
| --- | --- |
| Root `ethers` 6.16.0 → 6.17.0; root `ws` 8.17.1 → 8.21.0, exact pins | Ethers previously pinned vulnerable `ws`; 6.17.0 declares 8.21.0. The Node API and production indexer import this Ethers package. [Ethers release](https://github.com/ethers-io/ethers.js/releases/tag/v6.17.0); [ws maintainer advisory and fixed versions](https://github.com/websockets/ws/security/advisories/GHSA-96hv-2xvq-fx4p). |
| Root `axios` 1.16.0 → 1.18.0, exact pin | Removes the vulnerable root/tooling copy. The optional Coinbase dependency still pins a separate 1.16.0 copy; this is explicitly unresolved below. [Axios release](https://github.com/axios/axios/releases/tag/v1.18.0); [maintainer Node HTTP adapter advisory](https://github.com/axios/axios/security/advisories/GHSA-gcfj-64vw-6mp9). |
| Checkout → SHA-pinned v5.1.0; setup-node → SHA-pinned v5.0.0 | These actions use Node 24 internally; application/test Node stays 22. GitHub-hosted Ubuntu/Windows runners satisfy the documented minimum runner version. The syntax-only job disables setup-node's new automatic npm cache to preserve its prior behavior. No permissions widened. [Checkout v5.1.0](https://github.com/actions/checkout/releases/tag/v5.1.0), [Node 24/minimum runner](https://github.com/actions/checkout/releases/tag/v5.0.0), [setup-node changes](https://github.com/actions/setup-node/releases/tag/v5.0.0). |
| AppKit `--w3m-font-family` uses the site's existing system font stack | Installed AppKit 1.8.21 `ThemeUtil.initializeTheming` otherwise inserts eight external font preload links even when the wallet is not opened. Its supported custom-font path avoids both the links and external font-face rules. A regression test executes the installed SDK initialization with the actual configured theme object. |

The lockfile additionally deduplicates the already-present ENS normalizer,
WalletConnect/Viem copies and compatible WebSocket copies. No package was added
as a new application capability. Ethers' dependency update necessarily changes
ENS normalization from 1.10.1 to 1.11.1. No AlchemyProvider use was found in the
application; the Ethers release's Alchemy-specific behavior therefore does not
change the configured JSON-RPC indexer/provider flow.

## Exposure and residual disposition

| Surface | Evidence and disposition |
| --- | --- |
| Vercel API | `api/[...route].js` and `api/public/artworks.js` resolve 42 local files; external roots are `ethers` and `@simplewebauthn/server`. After the patch, none of the current audit's affected lockfile nodes are in this 46-node dependency graph. Native `fetch` uses the Node runtime implementation, not the root `undici` npm package. This does not certify Node itself or unreported vulnerabilities. |
| Production indexer | `src/indexer/production-runner.js` resolves 14 local files and `ethers`, `dotenv`, `pg`, `prom-client`, `bullmq`, `ioredis`; no current advisory node remains in its 55-node dependency graph. Health/metrics use the native HTTP implementation, not the legacy Express server. Host Node patch level is an operational prerequisite; this local change does not update the host. |
| Browser wallet graph | AppKit → optional `@base-org/account` → `@coinbase/cdp-sdk` 1.55.0 pins Axios 1.16.0. Its manifest also reaches `form-data` 4.0.5. Node adapter findings do not establish browser exploitability; browser conditionals and actual connector paths need separate bundle/runtime review. SDK 1.56.0 relaxes Axios to `^1.18.0`, but upgrading a wallet SDK has been deliberately deferred until connector acceptance. No claim that the browser graph is advisory-free. |
| Browser Ethers CDN | `contracts-integration.js`, `src/core/rpc/rpc-client.js`, and `src/features/auction/auction-service.js` separately import `https://esm.sh/ethers@6.7.0`. The npm upgrade does **not** update these. Browsers use their native WebSocket, so the Node `ws` advisory does not establish a browser vulnerability. Consolidating this separate dependency requires dedicated receipt/signing/provider tests and is not silently included here. |
| Legacy Express server | `src/api/server.js` graph retains `body-parser`, `qs`, and `ip-address` findings; it is not the configured Vercel entry or production indexer runner. It also imports undeclared `express-session`. Do not activate this server as an alternative production API before its dependency/runtime review. |
| Contract development toolchain | Hardhat/toolbox/ignition/typechain/coverage/gas-reporter and Ethers v5 transitively retain `adm-zip`, `undici`, `serialize-javascript`, `tmp`, `cookie`, `elliptic`, `secp256k1`, `ethereum-cryptography`, `ethereumjs-util`, `ethjs-unit`, `number-to-bn`, `bn.js`, `web3-utils`, `uuid`, and older `ws` findings. These are not loaded by the API/indexer entry graphs. Keep untrusted archives, templates and compiler endpoints out of CI inputs. Major Hardhat/toolbox changes and npm's proposed downgrades need a separate toolchain compatibility pass. |
| Build/tooling and over-declared direct packages | `brace-expansion`, `fast-uri`, `form-data`, `immutable`, `js-yaml`, `lodash`, `nanoid`, and `postcss` remain reported; their discovered consumers are build/test/tooling paths, except the optional wallet/legacy-server paths above. They remain installed and are not dismissed as harmless. Review compatible scoped updates and then manifest classification in a dedicated pass; avoid untrusted stylesheets/templates/build inputs. [PostCSS maintainer advisory](https://github.com/postcss/postcss/security/advisories/GHSA-r28c-9q8g-f849). |
| Solidity dependency | OpenZeppelin 5.0.0 remains reported for `Base64`; repository contracts do not import or call that utility. Updating the compiler dependency changes locally compiled contract artifacts, so it is deferred to contract rework with explicit artifact comparison. Existing deployed contracts are not changed by npm. [OpenZeppelin maintainer advisory](https://github.com/OpenZeppelin/openzeppelin-contracts/security/advisories/GHSA-9vx6-7xxf-x967). |

The remaining findings are retained in the JSON evidence, not suppressed with an
audit allowlist. This triage is not blanket risk acceptance or proof of production
safety. Safe runtime-path repairs and warning fixes are implemented; dependency
cleanup, wallet SDK acceptance and contract toolchain modernization remain open.

## Frontend warnings

- Tailwind Play CDN was already removed in the consolidated baseline. HTML uses
  the compiled stylesheet; `verify:tailwind` checks every used utility. Do not
  reintroduce the CDN to hide a build issue.
- Reown external-font preloads are removed by the supported theme option above.
  The test verifies SDK behavior, rather than merely searching for a string.
- CI action Node 20 warnings are addressed in source. Hosted CI has not run this
  unpushed change, so absence of the warning on GitHub is not yet verified.

## Validation

- `npm install --package-lock-only --ignore-scripts --save-exact ethers@6.17.0
  ws@8.21.0 axios@1.18.0`: exit 0; reviewed lockfile diff.
- `npm ci`: first attempt failed with Windows `EPERM` while our Vite preview
  processes held the native Rolldown binding. Only confirmed task-owned servers
  were stopped. A clean retry completed with exit 0, using Node 22.22.2 and
  npm 11.6.2 (`dependencies-npm-ci-retry.log`). No manual dependency-directory
  deletion, administrator escalation or lockfile bypass was used.
- Seven focused test files: **84 passed, zero failed/skipped**
  (`dependencies-focused-tests.log`). They cover the installed SDK's default
  font-preload reproduction and configured fix, profile OAuth, Safe recovery,
  receipt reconciliation, mobile wallet lifecycle and wallet runtime loading.
- CI YAML parsed with the installed parser; action pins were resolved from the
  official GitHub release tags. Hosted CI remains unrun for this local change.
- Post-install `npm audit --json`: **58 findings**, with root Ethers/Axios/ws
  affected nodes removed but the residual branches above retained. Exit 1 is the
  expected audit status for these unresolved findings.
- Final combined validation on September 27: **1227 passed, zero failed/skipped**,
  including real disposable PostgreSQL suites (`continuation-final-2026-09-27.log`).
  The September 23 combined run exposed two stale source guards: one required a
  removed TODO comment, another scanned a generated Vite dependency cache. The
  neutral card-frame assertion now checks behavior and source walkers exclude
  root evidence/hidden historical worktrees. A subsequent sandbox-only run
  exposed the same evidence-directory mistake in the grid guard and skipped
  Docker; it is retained as a failed attempt, not counted as final acceptance.
- The final production-source build passed 11 routes and 178 Tailwind utilities
  after the browser-discovered navigation recursion repair. **33 contract tests
  passed** after the dependency install; contracts and dependencies are unchanged
  since that run. Logs: `continuation-build-final-2026-09-27.log` and
  `continuation-contracts-2026-09-23.log`. `git diff --check` passed.
- Seven built-browser checks passed; the actual guest SDK settled with the
  configured system font and no font preloads. External services were blocked;
  this proves local initialization, not an online connector/signing journey.
- Hosted CI and deployed warning acceptance remain outstanding. Local success
  does not claim the changed actions have already run on GitHub.

## Interpretation and next action

This task treats A-38 as **triage plus bounded compatible fixes**, not permission
to replace the wallet/contract toolchains or to declare all 58 findings resolved.
The distinction between an installed package and an executed production path is
an evidence classification, not a new canon mechanic. No canon amendment needed.

Next bounded action: review the optional Coinbase SDK update and exercise the
Base Account connector before removing its pinned old Axios branch.
