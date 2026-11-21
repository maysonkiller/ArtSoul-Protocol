# NPM dependency security triage — 2026-11-21

**Status: SOURCE_ONLY / TEST_ONLY — NOT RELEASED.**

## Ground truth

- Base MAIN: `9f72dbbd972fc29ad8095c0ca549650bbf2af637`.
- npm registry audit: [baseline 71 (workflow run 44918113863)](https://github.com/maysonkiller/ArtSoul-Protocol/actions/runs/44918113863).
- Raw JSON evidence and per-package inventory are downloadable from the Actions artifact named `artsoul-npm-advisories`.
- Same-lockfile candidate: [run 44918414072](https://github.com/maysonkiller/ArtSoul-Protocol/actions/runs/44918414072). It evaluated `npm audit fix --package-lock-only --ignore-scripts` **without `--force`**.
- Candidate changes were independently inspected before committing only `package-lock.json` to this dedicated branch. Root package.json requirements are unchanged.

## Verified audit counts for the initial compatible trial (before restoring the C12 OpenZeppelin pin)

| npm severity | OLD full | NEW lockfile | OLD omit=dev | NEW omit=dev |
|---|---:|---:|---:|---:|
| Critical | 2 | 0 | 2 | 0 |
| High | 34 | 22 | 26 | 17 |
| Moderate | 16 | 14 | 14 | 14 |
| Low | 19 | 26 | 18 | 21 |
| **Total** | **71** | **62** | **60** | **52** |

The initial trial moved OpenZeppelin 5.0.0 to 5.6.1. That is **not acceptable for the existing C12 contract-source and storage-layout pins**. The submitted PR candidate restores the exact OpenZeppelin 5.0.0 dependency record and updates only the C12 toolchain version and lockfile SHA256 in the candidate manifest; all compiler-source/ABI/bytecode hashes and settings are kept unchanged. The currently submitted branch requires a new audit and exact-head CI. Do not treat the trial's 62 as the submitted branch's final count.

These are npm *affected-package* counts, not unique CVEs. A production-scope npm audit does not establish whether browser visitors can reach a vulnerable path.

## Compatible changes in isolated lockfile

- `handlebars` 4.7.9 → 4.7.10 and `proxy-addr` 2.0.7 → 2.0.8 address the two **critical** audit entries.
- The temporary trial removed `@openzeppelin/contracts` but the PR intentionally restores its original pinned version to maintain immutable compiler evidence. Compatible updates removed previous audit entries for `body-parser`, `brace-expansion`, `fast-uri`, `follow-redirects`, `form-data`, `immutable`, `ip-address`, `js-yaml`, `nanoid`, `pbkdf2`, `postcss`, `postcss-selector-parser`, `qs`, and `source-map-js`.
- `hardhat` 2.28.6 → 2.29.2; `@openzeppelin/contracts` stays at 5.0.0 in the submitted candidate. The C12 source hashes, ABI and bytecode pins stay unchanged. Exact contract tests are still required.
- The initial npm proposal changed 32 resolved versions and introduced new nested resolution paths. Its count was 62 (including the OpenZeppelin update); the submitted PR preserves C12 OpenZeppelin 5.0.0, so the final audit count must be recalculated. No zero-vulnerability claim is made.

## Remaining blockers

- **Wallet / authentication risk:** `@reown/appkit`, `@reown/appkit-adapter-wagmi` and their internal packages; `zod` under `@reown/appkit-wallet`. Some paths have `fixAvailable: false`. Do not force-upgrade the wallet stack.
- **Major / ABI compatibility risk:** `undici` / `@fastify/busboy`, `adm-zip`, `serialize-javascript`, `@nomicfoundation/hardhat-toolbox` and its plugins, `lodash`, `tmp` and other inherited alerts. npm recommends major upgrades for several.
- **Direct and subdependency review:** `vite`, `axios`, `ws` and legacy `@ethersproject` graph remain or require targeted compatible package updates. An npm 'direct dependency' flag does not prove actual use by the website.
- **Classification debt:** `package.json` has 381 regular dependencies and just 6 explicit devDependencies. Some test/build tooling is among regular dependencies, causing it to appear in `--omit=dev`. Do not game the count by relabeling without testing deployment requirements.

## Gate before merge

1. Exact PR-head `npm ci` on Windows and Linux; audit OLD versus NEW with raw JSON.
2. `npm run build`, `npm run test:unit`, `npm run test:contracts` on both platforms (including all Hardhat / OpenZeppelin security tests).
3. Negative wallet/AppKit/Reown and WebMCP checks; no real signatures or production RPC writes.
4. Independent audit of unresolved critical/high advisories and any nontrivial major upgrades.
5. Final explicit owner acceptance before merging or deploying. This change never authorizes a mainnet or production release.

No OpenAI credits or paid API calls are required to run this security audit. Do not use `npm audit fix --force`.
