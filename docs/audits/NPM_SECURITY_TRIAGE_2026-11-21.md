# NPM dependency security triage — 2026-11-21

**Status: SOURCE_ONLY / TEST_ONLY — NOT RELEASED.**

## Ground truth

- Base MAIN: `9f72dbbd972fc29ad8095c0ca549650bbf2af637`.
- npm registry audit: [baseline 71 (workflow run 44918113863)](https://github.com/maysonkiller/ArtSoul-Protocol/actions/runs/44918113863).
- Raw JSON evidence and per-package inventory are downloadable from the Actions artifact named `artsoul-npm-advisories`.
- Same-lockfile candidate: [run 44918414072](https://github.com/maysonkiller/ArtSoul-Protocol/actions/runs/44918414072). It evaluated `npm audit fix --package-lock-only --ignore-scripts` **without `--force`**.
- Candidate changes were independently inspected before committing only `package-lock.json` to this dedicated branch. Root package.json requirements are unchanged.

## Verified audit counts

| npm severity | OLD full | NEW lockfile | OLD omit=dev | NEW omit=dev |
|---|---:|---:|---:|---:|
| Critical | 2 | 0 | 2 | 0 |
| High | 34 | 22 | 26 | 17 |
| Moderate | 16 | 14 | 14 | 14 |
| Low | 19 | 26 | 18 | 21 |
| **Total** | **71** | **62** | **60** | **52** |

These are npm *affected-package* counts, not unique CVEs. A production-scope npm audit does not establish whether browser visitors can reach a vulnerable path.

## Compatible changes in isolated lockfile

- `handlebars` 4.7.9 → 4.7.10 and `proxy-addr` 2.0.7 → 2.0.8 address the two **critical** audit entries.
- Compatible updates also removed the previous audit entries for `@openzeppelin/contracts`, `body-parser`, `brace-expansion`, `fast-uri`, `follow-redirects`, `form-data`, `immutable`, `ip-address`, `js-yaml`, `nanoid`, `pbkdf2`, `postcss`, `postcss-selector-parser`, `qs`, and `source-map-js`.
- `hardhat` 2.28.6 → 2.29.2; `@openzeppelin/contracts` 5.0.0 → 5.6.1. These need exact contract tests, even though their root semver ranges permit the upgrades.
- The candidate changed 32 resolved versions and introduced new nested resolution paths. The remaining audit count is 62, and low-severity findings increased. No zero-vulnerability claim is made.

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
