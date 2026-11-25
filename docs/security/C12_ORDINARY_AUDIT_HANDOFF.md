# Ordinary market and artwork NFT audit handoff

The November 25 [payout Core](../../contracts/replacement/OrdinaryPayoutMarket.sol) adds creditor-directed withdrawal. Its [manifest](C12_ORDINARY_PAYOUT_MANIFEST.json) and [storage and immutable layout](../architecture/C1_ORDINARY_PAYOUT_STORAGE.json) are separate from the historical Base Sepolia pair. Use `--payout` before the manifest command or after the Safe plan in the rehearsal preparation command to select this candidate. Its two events describe a single withdrawal. Account for the amount once from `CreditWithdrawn` and read `CreditRouted` for delivery details. The [Base Sepolia deployment and simulation](../testnet/ORDINARY_MARKET_REHEARSAL_2026-11-25.md#core-with-creditor-directed-withdrawals) matched the local runtime and payout checks. Independent audit acceptance remains pending.

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

Give reviewers the commit, manifest, storage layout, economics, access rules, test files and proposed deployment arguments. The November 25 internal check on the ordinary pair matched all 21 sources and both contracts in the manifest (`bf52e29887d1c0ed394f9f53ce1d8fe720629e144d54514752d7126d757fffaf`). All 20 manifest, storage-layout, deployment-review and accounting-model tests passed. Rerun the check if the candidate changes, including after a dependency update. Record the finalized receipt for each public deployment. The owner retains the production release decision. Record the full independent auditor's scope, findings, fixes and retests at the end of Phase D. Include other contracts if their functionality is in the release. [Release sequence](../canon/CHANGELOG_2026-11-25_RELEASE_SEQUENCE.md)

## Internal review dispositions, November 25

A native solc rebuild reproduced the manifest above from the 21 pinned sources. On an isolated EVM, the treasury-binding, resale, runner-up and keeper suites passed all 28 cases. The scope of these results is the ordinary pair.

| Question | Disposition |
| --- | --- |
| Can an outbid wallet recover a refused ETH payment? | The batch records the unpaid amount once. The original ordinary Core pays withdrawals to the caller. In the payout candidate a funded wallet that rejected ETH claimed the full credit at a second address while entries were paused. A refused destination preserved the credit and the outstanding winner deposit was conserved. [Contract test](../../test/TreasuryBoundOrdinaryArt.test.cjs) · [Recipient policy](../architecture/C1_DECISION_INVARIANTS_2026-11-02.md) |
| Does the entry pause strand amounts already credited or shorten an existing payment window? | Local settlement and resale cases paid accrued balances during the pause. The keeper and runner-up cases exercised the winner's payment deadline, the runner-up's deadline and release for relisting. Hosted execution and monitoring belong to the C13 rehearsal. [Treasury cases](../../test/TreasuryBoundOrdinaryArt.test.cjs) · [Keeper cases](../../test/OrdinaryAuctionKeeper.test.cjs) · [Runner-up cases](../../test/OrdinaryRunnerUp.test.cjs) |
| What establishes the treasury identities? | Construction checks distinct roles and the initial two-of-three quorum. Safe identity, owners, modules, guards and fallback handler require independent comparison with the private custody register. Use the selected production register and its finalized block evidence before authorizing real funds. [Core constructor](../../contracts/replacement/OrdinaryMarket.sol) · [Safe verification](../../scripts/verify-treasury-safes.mjs) |

## Payout pair review

On November 25, native Solidity 0.8.24 reproduced both contracts from the 22 sources in the [payout manifest](C12_ORDINARY_PAYOUT_MANIFEST.json). The independent rebuild and Hardhat artifact comparison returned manifest SHA-256 `93f42cafbcfda500f9282d271e909e328849de208d923b61d2b67bf87e65a7c4`. The [storage checks](../../test/replacement-storage-baseline.test.cjs) cover every slot and nested type in the two Cores and NFTs, including immutable role bindings. The payout Core adds one public function, `withdrawTo(address)`, one event and one error. The historical ABI is preserved.

| Finding | Disposition and evidence |
| --- | --- |
| Most concrete-market invariants previously ran against the historical Core. | The [treasury suite](../../test/TreasuryBoundOrdinaryArt.test.cjs) now exercises the same custody, pause, admission, rounding, outstanding deposit and solvency cases on both exact concrete Cores. A trace verifies that payout calls occur inside the lock. During the pause an artist redirects the combined artist and seller credits to a separate recipient; the recipient's balance increases by the full credit. A funded historical auction can settle and its treasury can withdraw after the replacement pair is active. All 22 concrete-market cases passed, within a 61-case local EVM run covering auctions, resale, keeper, runner-up and NFT behavior. |
| A direct caller of the custody verifier could supply the same RPC reader twice and receive a dual-provider report. | The shared verifier and rehearsal tools now reject a repeated reader and two HTTPS readers on the same origin. A [regression](../../test/treasury-safe-preflight.test.mjs) checks both cases. The corrected command verified the [deployment receipt](https://sepolia.basescan.org/tx/0xa796f38256db16ac122577c81b9c7a169858f11703bbfbc27247b91167a6f79f) at finalized block 63,494,032 using Base and PublicNode. The nodes agreed on both contracts, all three two-of-three Safes and both refund limits. |
| What if a funded contract account cannot call the market or receive its NFT? | Routing ETH requires the credited account to initiate the call. Settlement requires its NFT receiver to accept delivery. A rejected NFT mint rolls back the sale, mint and credits, and the published payment deadline still applies. Reuse the [settlement and rejected-delivery checks](../../test/OrdinaryArtAuctions.test.cjs) when qualifying wallet integrations. |

The reviewed contract scope is the native ordinary-artwork pair on Base Sepolia. The application wallet and privileged integrations need finding dispositions on the final release revision. C13 covers signed participant journeys and hosted results. C0 and D3 cover separately selected production custody. The full independent audit remains at the end of D.
