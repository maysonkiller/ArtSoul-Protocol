# Mocha and solc dependency update, November 25, 2026

The updated lock pins `serialize-javascript` 7.1.4 and `tmp` 0.2.7. The Mocha and solc overrides point their consumers at the corresponding direct dependencies. Both Mocha installations and the Solidity compilers retain their original versions. Comparing the package maps with candidate `c25314e4` found changes only to the root dependency declarations and the two package records. The package path sets are identical.

## Matched npm audits

The same registry, Node 22.22.2 and npm 11.6.2 were used for all six reports. Each audit returned exit 1 and complete JSON. For each row, the number of keys in `vulnerabilities` equals the reported total. Entries count package names. A parent package may inherit an advisory from a child.

| Lock | Full total | Critical | High | Moderate | Low | Omit-dev total | Critical | High | Moderate | Low |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Main | 72 | 2 | 34 | 17 | 19 | 60 | 2 | 26 | 14 | 18 |
| Previous candidate, `c25314e4` | 53 | 0 | 11 | 11 | 31 | 44 | 0 | 11 | 10 | 23 |
| Tooling update | 50 | 0 | 9 | 11 | 30 | 41 | 0 | 9 | 9 | 23 |

Against the previous candidate, the full and omit-dev reports each lose the records for `serialize-javascript`, `tmp` and the inherited `solc` entry. No new package names appear. The full report reclassifies `@nomicfoundation/hardhat-toolbox` from low to moderate and `eth-gas-reporter` from moderate to low. Against main, 29 names disappear and seven appear in the full report. The nine remaining high-rated entries are Zod and eight Reown packages. Wallet compatibility and advisory-specific reachability remain open. [Wallet risk assessment](SECURITY_RESIDUAL_RISK.md)

An intermediate lock selected `tmp` 0.2.6. The registry also listed a high advisory affecting that specific version. Version 0.2.7 removed the entry in both final reports. [Maintainer advisory](https://github.com/advisories/GHSA-7c78-jf6q-g5cm)

| Lock | SHA-256, LF |
| --- | --- |
| Main | `3cc70a68bed3dfeea23497fa208b5cebd8cd51141bb783ac47df9a480e0482d1` |
| Previous candidate | `11230780d39bc3d090175bbff565621c6b868f4ae3409f518f21bb0e9db1c8d4` |
| Tooling update | `ee017fe2799cff27199d2f5de1db24a6790122bbfac9cb1d94ff2652efc644dd` |

[Six raw npm reports](toolchain-npm-audit.zip) · Archive SHA-256 `4731e0d1b5bbee14d064ab8b45fce5261ddff6c724bf23527b65f0be2b45e743`. The `main/`, `before/` and `after/` directories correspond to these three locks. Each contains the full and omit-dev reports. To repeat, run `npm audit --package-lock-only --ignore-scripts --json --registry=https://registry.npmjs.org` once per lock and again with `--omit=dev`.

## Consumer verification

On Windows, four cases passed in two isolated installations using the lock's Mocha versions and reviewed parent overrides. Real CLI workers for Mocha 10.8.2 and 11.8.0 round-tripped ordinary options, a regular expression, an array and a skipped function. The solc 0.8.26 SMT adapter created a query file with the patched `tmp`, passed it to a local reader and removed the file. The reader stood in for the external solver. A separate solc case compiled a small contract and returned bytecode.

To repeat on a clean installation of the full candidate, run the [compatibility check](toolchain-compatibility.cjs) from the repository root.

```sh
node docs/audits/npm-2026-11-25/toolchain-compatibility.cjs
```

The final lock also passed `npm ci --dry-run --ignore-scripts --no-audit --no-fund` with an `isows` / `ws` peer-resolution warning. These checks cover the two upgraded tooling libraries. Exact-head CI, C12 bytecode verification and release acceptance have separate evidence.
