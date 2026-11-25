# Local verification of Genesis grant documents

Before signing a prepared batch, a reviewer can compare the retained policy and individual decision packets with the hashes in an independently obtained copy of the reviewed grant JSON. Use the byte-for-byte originals, including any private salt already incorporated in a packet. Signers review eligibility and the proposed Safe transaction separately.

Place copies on a reviewer-controlled local disk outside the repository. Use `policy.bin` for the policy and `evidence-<serial>.bin` for each decision. For example, the file for serial 201 is `evidence-201.bin`. These names identify exact input bytes. Renaming a copy is sufficient. Re-encoding JSON, changing line endings, or adding a new salt changes its digest. Keep the files stable throughout the check.

From the repository root, replace the two example paths with the paths to the trusted review and the private folder. Select the hash algorithm used when the commitments were recorded.

```sh
node scripts/check-genesis-grant-documents.mjs keccak256 "../private/reviewed-grants.json" "../private/decision-packets"
```

The optional checker supports `keccak256` and `sha256` for batches that used one of these algorithms on all the file bytes. Earlier opaque commitments and different commitment formats retain their original review procedure. The existing encoder and the contract accept the same batches as before.

A successful run prints only the number of checked decisions. Exit status 1 means the comparison could not be completed. The command reads one local file at a time, with limits of 256 KiB for the batch and 1 MiB for each policy or evidence file. The encoder's existing limit of 32 decisions applies. The check establishes byte integrity relative to the independently retained review. It supplies no approval, wallet signature or evidence of a grant on-chain.

[Grant policy and operator responsibilities](../canon/CONTRACT_REWORK_PLAN.md#separate-genesis-grant-pilot)
