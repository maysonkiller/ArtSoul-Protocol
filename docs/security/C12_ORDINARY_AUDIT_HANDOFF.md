# Ordinary market and artwork NFT audit handoff

[Review manifest](C12_ORDINARY_AUDIT_MANIFEST.json) · [Storage layout and immutable bindings](../architecture/C1_ORDINARY_PAIR_STORAGE_2026-11-20.json) · [Deployment request verification](../../scripts/prepare-ordinary-deployment.mjs) · [Safe rehearsal](../testnet/RG05_SAFE_MULTISIG_REHEARSAL_2026-08-16.md)

The scope covers the concrete `OrdinaryMarket` and the `SettledArtworkNFT` created in its constructor. The manifest records exact source-byte SHA-256 hashes, the Solidity compiler version and settings, the package lock, compiler metadata, ABI, creation bytecode and runtime templates. Dependency-lock and local Hardhat configuration hashes use LF line endings. Source hashes preserve the original bytes because Solidity embeds source hashes in its metadata.

## Verify a handoff

Check out the proposed release commit with dependencies from its lockfile. With the exact native Solidity compiler already available, rebuild from the 21 local sources listed in the manifest. This path needs no Hardhat artifacts or compiler downloads.

```text
node scripts/ordinary-audit-manifest.cjs --rebuild docs/security/C12_ORDINARY_AUDIT_MANIFEST.json <path-to-trusted-solc-0.8.24>
```

With existing artifacts from the local Hardhat configuration, compare the concrete artifacts and compiler build-info with the checked-in manifest. The script rejects a changed dependency, stale artifact or different compiler output.

```text
node scripts/ordinary-audit-manifest.cjs --check docs/security/C12_ORDINARY_AUDIT_MANIFEST.json
node --test test/ordinary-audit-manifest.test.cjs
```

For a revised candidate, compile with `hardhat.local.config.cjs`, then use `--write <new-file.json>` and review the diff. The command requires an unused output path. All three manifest commands run locally without accessing a wallet, RPC or environment credentials.

## Deployment and sign-off

Creation hashes cover compiler bytecode before constructor arguments. The deployment review separately verifies the hash of the full transaction input with the three Safe addresses, two refund limits and predicted pair addresses. Runtime hashes describe compiler templates. Compare chain runtime with the reviewed template after accounting for each recorded immutable range and verifying its actual constructor-bound value. Preserve the deployment receipt and exact initialized runtime hash for each address.

Give the independent reviewer the commit, manifest, storage layout, the economics and access rules, the relevant test files and proposed deployment arguments. Record the auditor's scope, findings, remediation, retest and any resulting new manifest before mainnet. Collections, Genesis and donations require their own review scope if included in a release. This handoff establishes source and build provenance. Independent security review and actual network deployment remain separate milestones.
