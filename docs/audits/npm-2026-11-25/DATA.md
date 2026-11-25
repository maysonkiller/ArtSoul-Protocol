# Dependency audit evidence, November 25, 2026

The [latest runtime and toolchain follow-up](RESIDUAL_FOLLOWUP.md) reduced the full report from 50 to 18 package names and the omit-dev report from 41 to nine. The confirmed comparisons and the [wallet compatibility and contract evidence](SECURITY_RESIDUAL_RISK.md) apply to the lock identified in that follow-up.

The [Mocha and solc follow-up](TOOLCHAIN_FOLLOWUP.md) records the next lock with 50 affected packages, including nine high and zero critical. The table below preserves the earlier snapshots.

The historical baseline workflow ran at `42dd819be00f0cd6d83a8a34c8cf226cd97fd215`. Its package lock is byte-identical to `ef17eeabe21255b2be41008e74b5f9044b8e187e` on main. The historical security candidate is `023faed9e4ffe4ea7263efce535044522f49e98e`. The revised candidate is identified by the lock SHA-256 below.

| Lock and registry snapshot | Full: total / critical / high / moderate / low | Omit dev: same order | Lock SHA-256 |
|---|---|---|---|
| Main, Nov 21 | 71 / 2 / 34 / 16 / 19 | 60 / 2 / 26 / 14 / 18 | `3cc70a68bed3dfeea23497fa208b5cebd8cd51141bb783ac47df9a480e0482d1` |
| Draft #520, Nov 21 | 62 / 0 / 22 / 14 / 26 | 52 / 0 / 17 / 14 / 21 | `b054987d92637634d057508e60a9dbdf1d12d5872fac2b0dc08ad58c9d2d9c8d` |
| Main, Nov 25 | 72 / 2 / 34 / 17 / 19 | 60 / 2 / 26 / 14 / 18 | `3cc70a68bed3dfeea23497fa208b5cebd8cd51141bb783ac47df9a480e0482d1` |
| Draft #520, Nov 25 | 63 / 0 / 22 / 15 / 26 | 52 / 0 / 17 / 14 / 21 | `b054987d92637634d057508e60a9dbdf1d12d5872fac2b0dc08ad58c9d2d9c8d` |
| Revised candidate, Nov 25 | 53 / 0 / 11 / 11 / 31 | 44 / 0 / 11 / 10 / 23 | `11230780d39bc3d090175bbff565621c6b868f4ae3409f518f21bb0e9db1c8d4` |

The [original run](https://github.com/maysonkiller/ArtSoul-Protocol/actions/runs/44918113863) and [candidate run](https://github.com/maysonkiller/ArtSoul-Protocol/actions/runs/44919599309) published the unedited raw reports. Both downloaded ZIP files matched the SHA-256 digests supplied by the GitHub artifact API. Their workflow discarded the audit process exit code. Each fresh registry query on November 25 returned exit 1 and a complete report with findings. The fresh runs used Node v22.22.2 and npm 11.6.2 against registry.npmjs.org.

The November 21 snapshots contain 16 records that disappear and 7 that appear. The November 25 main scan adds `@base-org/account` through `@coinbase/cdp-sdk`. Compared at the same registry snapshot, the revised lock removes 10 more records from draft #520: `@fastify/busboy`, `@nomicfoundation/ignition-core`, `adm-zip`, `axios`, `lodash`, `undici`, `vite`, `ws`, `@coinbase/cdp-sdk`, `@base-org/account`. Added records at this step: none.

[Package inventory](SECURITY_FINDINGS.md) · [Machine-readable detail](SECURITY_FINDINGS.csv) · [Raw reports and hashes](npm-audit-evidence.zip) · [Residual risk](SECURITY_RESIDUAL_RISK.md). The raw archive SHA-256 is `888efe68272247491ee6346d3549fbce10fdd390379ab39410f8bcf2c86843c0`. It preserves the official workflow ZIP files and all ten JSON reports, plus raw-evidence hashes, npm process results and the GitHub advisory metadata used for affected and patched ranges.

## Rechecking a lock without installing packages

Copy the matching Git versions of package.json and package-lock.json to an empty directory. Use npm 11.6.2 and record both commands' exit codes.

```sh
npm audit --registry=https://registry.npmjs.org --ignore-scripts --package-lock-only --json > npm-audit-full.json
npm audit --registry=https://registry.npmjs.org --ignore-scripts --package-lock-only --omit=dev --json > npm-audit-prod.json
```

Compare the response metadata with the number of affected package names in vulnerabilities and retain the raw files before comparing counts. The registry changes over time. GitHub advisories use the affected package's own version range, while a package with a transitive advisory has separate affected-node and upstream-advisory fields in the CSV. A node may occur at more than one path. The CSV reports full location and version for each affected instance.

The inventory uses the virtual tree of npm's bundled Arborist to record immediate incoming edges by type, as npm explain does for installed packages. The sampled import chains run from literal imports in ArtSoul source at the stated main SHA through production, optional and peer dependency edges in that virtual tree. Browser bundling, optional feature activation and advisory-specific input reachability need separate evidence. GitHub CVEs and first patched versions were queried for 123 unique advisory IDs. This exercise required no installations, production requests, signatures, wallets or spending.
