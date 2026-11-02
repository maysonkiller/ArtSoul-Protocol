# C1 — Current-source storage baseline

Status: reproducible source layout for six existing constructor-based contracts.
This is an input to C1 review, **not a replacement storage plan, proxy-compatibility
approval, deployed-state export or completed migration**.

Scope: Bible lifecycle/provenance/administration and C1 D1. No Solidity, contract
configuration, live storage, signer, network or dependency changed. The existing
compiler was used locally; no install or download was required.

## Captured boundary

[Machine-readable baseline](../architecture/C1_CURRENT_STORAGE_2026-11-02.json)
retains every compiler-reported storage entry and nested type for the six targets,
including inherited ownership, pause, reentrancy, ERC-721 and royalty state. It
also identifies immutable declarations and their deployed-bytecode reference
offsets. Those offsets do not contain actual deployed constructor values.

| Current contract | Storage declarations including inherited fields | Immutable declarations |
| --- | ---: | ---: |
| ArtSoulCore | 15 | 2 |
| ArtSoulNFT | 16 | 0 |
| ArtSoulProjectNFT | 17 | 0 |
| ArtSoulDonations | 4 | 1 |
| CollectionLaunch | 25 | 3 |
| CollectionForge | 15 | 4 |

Counts describe declarations, not occupied slots or total state size. For example,
Core's `_pendingOwner` and `_paused` share slot 1 at offsets 0 and 20. Its credit
mapping has a root at slot 11; that root does not enumerate recipients or balances.
NFT artwork identity roots occupy slots 13–15. Core's NFT/ProjectNFT and Donations'
Core bindings are immutables, not writable storage pointers. ProjectNFT remains
the retired-at-migration transferable prototype, not canonical ArtSoulGenesis.

Solidity's [storage rules](https://docs.soliditylang.org/en/v0.8.24/internals/layout_in_storage.html)
explain inherited packing and hashed mapping/array locations. The extractor uses
the compiler's [standard JSON output selection](https://docs.soliditylang.org/en/v0.8.24/using-the-compiler.html#input-description),
not inferred slot numbering. Matching a layout alone cannot prove preserved
authorization, economics, initialization or outstanding claims.

## Reproduction and evidence

[Extractor](../../scripts/export-contract-storage.cjs) consumes an existing
Hardhat build-info file and an explicitly supplied trusted native solc binary.
It checks all 34 embedded sources against the current local contracts/dependencies,
normalizing only CRLF to LF and sorting source names. Other source changes fail.
It checks the exact compiler version, preserves compiler settings and requests
storage/AST/immutable references. It neither loads Hardhat configuration/dotenv
nor deploys contracts. There is no remote import callback or RPC operation.

```text
node scripts/export-contract-storage.cjs <build-info.json> <trusted-solc-executable> <output.json>
node scripts/export-contract-storage.cjs <build-info.json> <trusted-solc-executable> <output.json> --check
```

Export uses exclusive creation and refuses overwrite; `--check` compares the
regenerated artifact without changing it, accepting Git's CRLF checkout endings.
Reported artifact hashes use LF serialization. The native compiler must already be
available. This is a manual C1 evidence tool, not an automatic upgrade safety gate.

- Compiler: `0.8.24+commit.e11b9ed9`; optimizer enabled, 200 runs; EVM `paris`.
- OpenZeppelin Contracts: `5.0.0`, with every compiled source hash retained.
- Artifact SHA-256: `4c174732917fb98c6bcfd6ee0ce9cc57099dba5b1b11906e92d578367c1d2fbf`.
- Normalized compiler input SHA-256: `4a85181d73f4f8b8ab89e11ec1df1718ff3f797ecc130f5814083361beb775ff`.
- Local native Windows compiler SHA-256: `580ee56b61bbcaad953117e1e4a0874d90e6af5cb4ce4359571d7da25f6620e9`, matching its existing Hardhat compiler-list entry. This is not a new independent supply-chain audit.
- Export and repeated check match. LF-only sources with reversed input order also
  regenerate the same artifact; the normalized and original raw-source layouts
  and immutable offsets are identical. All storage/nested type references resolve.
  A CRLF-formatted artifact also passes without being rewritten.
- Six rejection checks pass: stale source, wrong build version, unsafe source
  path, wrong compiler, existing output and changed baseline. The saved artifact
  remains unchanged. These checks use disposable local inputs; no source was edited.

Compiler AST/type IDs and immutable offsets are build-specific. Regenerate and
review a new baseline after changing sources/settings/dependencies; do not treat
arbitrary JSON differences as proof of an incompatible upgrade, or identical
storage entries as permission to upgrade. This baseline does not alter existing
Hardhat build artifacts or runtime configuration.

## Remaining C1 work

Select and approve the identity/custody/authority topology and pause/deadline
policy first. Then produce replacement layouts and test initialization, authority
handover, preserved obligations and permitted evolution. Existing constructor
contracts do not become proxy-compatible by copying this layout. External review
and fresh testnet deployment remain separate gates.

Interpretation: capture current source as a comparison baseline while the future
topology is undecided. No proxy choice, migration policy, fee, parameter or
permission is inferred from the artifact.
