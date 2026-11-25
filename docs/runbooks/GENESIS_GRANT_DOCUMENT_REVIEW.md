# Local verification of Genesis grant documents

Before signing a prepared batch, a reviewer can compare the retained policy and individual decision packets with the hashes in an independently obtained copy of the reviewed grant JSON. Use the byte-for-byte originals, including any private salt already incorporated in a packet. Signers review eligibility and the proposed Safe transaction separately.

Place copies on a reviewer-controlled local disk outside the repository. Use `policy.bin` for the policy and `evidence-<serial>.bin` for each decision. For example, the file for serial 201 is `evidence-201.bin`. These names identify exact input bytes. Renaming a copy is sufficient. Re-encoding JSON, changing line endings, or adding a new salt changes its digest. Keep the files stable throughout the check.

From the repository root, replace the two example paths with the paths to the trusted review and the private folder. Select the hash algorithm used when the commitments were recorded.

```sh
node scripts/check-genesis-grant-documents.mjs keccak256 "../private/reviewed-grants.json" "../private/decision-packets"
```

The optional checker supports `keccak256` and `sha256` for batches that used one of these algorithms on all the file bytes. Earlier opaque commitments and different commitment formats retain their original review procedure. The existing encoder and the contract accept the same batches as before.

A successful run prints only the number of checked decisions. Exit status 1 means the comparison could not be completed. The command reads one local file at a time, with limits of 256 KiB for the batch and 1 MiB for each policy or evidence file. The encoder's existing limit of 32 decisions applies. The check establishes byte integrity relative to the independently retained review. It supplies no approval, wallet signature or evidence of a grant on-chain.

## Verify a signed Safe proposal before submission

After checking the packets, a reviewer can verify the confirmations on the precise transaction prepared for execution. Keep its signed calldata private. A complete set of confirmations can authorize execution by someone else.

Use three local JSON files in this order:

1. The independently reviewed grant batch used above, including the reviewed initialized `genesisCodeHash`.
2. The trusted custody entry for the designated Genesis Safe. Use the [Safe register fields](../../scripts/verify-treasury-safes.mjs) for its address, owners, threshold, proxy and singleton hashes, singleton, enabled modules, guard, module guard and fallback handler. Obtain this entry independently of the proposal.
3. The actual unsigned **outer** Ethereum transaction envelope containing the owners' already-signed Safe `execTransaction` calldata. Supply `{"chainId":8453,"to":"<Safe address>","value":"0","data":"0x<hex>"}`. Safe transaction hashes alone do not contain this calldata.

Set `ARTSOUL_CUSTODY_RPC_URL` and `ARTSOUL_CUSTODY_RPC_CHECK_URL` privately to two independent Base mainnet endpoints. Run:

```sh
node scripts/check-genesis-safe-proposal.mjs "../private/reviewed-grants.json" "../private/genesis-safe.json" "../private/signed-proposal.json"
```

Both providers must agree on the Safe's nonce at a common finalized block. The checker verifies the deployed Genesis binding and Safe custody at that block. Its RPC requests contain only public contract and custody reads. It compares the complete grant call and verifies the owner signatures on the reviewer's machine. Its output identifies the block, nonce, Safe transaction hash, grant count and number of confirmations. A different transaction at the same nonce can still be pending or awaiting finality. The checker never submits the transaction.

This check supports the rehearsed Safe 1.4.1 zero-value call with zero gas and reimbursement fields, and ordered ECDSA typed-data or Safe-tagged personal signatures. A different signing scheme, fee configuration or queued future nonce needs separate review. A later change of owners, nonce or threshold can invalidate an earlier result. Grant execution, finalized receipts and recorded eligibility decisions have their own checks. [Safe transaction hash](https://docs.safe.global/reference-smart-account/transactions/getTransactionHash) · [Safe signature encodings](https://docs.safe.global/advanced/smart-account-signatures)

[Grant policy and operator responsibilities](../canon/CONTRACT_REWORK_PLAN.md#separate-genesis-grant-pilot)
