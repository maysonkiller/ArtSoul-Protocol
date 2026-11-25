# Dependency audit follow-up, November 25, 2026

The source-only candidate starts at `e6f74294`. Four fresh npm registry reports are in [the evidence archive](./residual-npm-audit.zip). Counts are affected package records. Several records can originate from the same advisory.

| Installation | Before | After | Critical | High | Moderate | Low |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Full | 50 | 18 | 0 | 9 | 1 | 8 |
| Omit development dependencies | 41 | 9 | 0 | 9 | 0 | 0 |

## Changes

The three Hardhat configurations, project scripts, tests, CI and operating instructions use plain Hardhat, EDR and ethers. The candidate removes unused direct declarations for the Hardhat toolbox, both gas reporters, solidity-coverage, web3-utils, ethjs-unit, number-to-bn, ethereumjs-util, ethereum-cryptography, elliptic, secp256k1 and uuid. It retains Hardhat, the contract test commands, the gas measurement scripts and the application's ethers v6. npm removed the unused plugin and legacy ethers v5 reporter branches. The full lock decreased from 1,077 to 982 package entries including the root.

Cookie 0.7.2 is shared by Express and Sentry. Hardhat's Mocha 11 now resolves diff 8.0.4, glob 14.0.6 and minimatch 11.0.9 through version-scoped overrides. The project scripts and the existing Mocha serialization and solc temporary-file fixes are preserved. The wallet stack retains Reown 1.8.21, wagmi 3.6.4, viem 2.55.19 and ethers 6.17.0. The contract toolchain retains Hardhat 2.29.2, OpenZeppelin 5.0.0 and npm solc 0.8.26. Hardhat's configured Solidity compiler remains 0.8.24.

## Three outstanding advisories

| Affected root | Count | Evidence and next step |
| --- | ---: | --- |
| Reown wallet and Zod | 9 high, full and omit-dev | Reown pins Zod 3.22.4. A direct override to Zod 4 changes wallet message validation for an omitted optional payload. Gate any override or upstream migration on the wallet protocol tests. [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) |
| Hardhat 2 and ethers v5 ABI | 8 low, full only | Hardhat requires `@ethersproject/abi`, which reaches `@ethersproject/signing-key` and elliptic. The latest published elliptic is 6.6.1 and the advisory includes that version. Hardhat 2.30.0 still depends on the ethers v5 ABI. Revisit with upstream changes or a tested Hardhat major migration. [elliptic advisory](https://github.com/advisories/GHSA-848j-6mx2-7j84) |
| OpenZeppelin contracts | 1 moderate, full only | The pinned ordinary-pair source closure excludes the affected Base64 library. Patching OpenZeppelin requires a separately reproduced Solidity candidate and bytecode review. [OpenZeppelin advisory](https://github.com/advisories/GHSA-9vx6-7xxf-x967) |

## Reproduction

Windows, Node 22.22.2, npm 11.6.2. A clean `npm ci --ignore-scripts --no-audit --no-fund` installed 948 packages. [The smoke test](./residual-compatibility.cjs) passed with the clean candidate. It checks Sentry and Express cookie handling, inline and unified Mocha diffs, real file discovery and exclusion in a parallel worker, and Hardhat's test runner with two read-only calls to its disposable network.

```sh
npm audit --package-lock-only --ignore-scripts --json
npm audit --package-lock-only --ignore-scripts --omit=dev --json
node path/to/residual-compatibility.cjs .
```

The lock SHA-256, normalized to LF, is `9713e1039595cff81a40021b2663b0d0bb53b8469dd2aa1f5e95719e25ce8046`. The evidence archive SHA-256 is `676b1ffa450f88b58ccae03ba477c48d98d7be055c65d4a8d966ec08cbd91549`.
