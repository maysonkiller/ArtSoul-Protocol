# RG-05 Base Sepolia Multisig Rehearsal - 2026-08-16

Recorded: 2026-08-19
Verified: 2026-08-19 against Base Sepolia chain state, not against a founder report
Scope: `RESOURCE_GATED_WORK.md` RG-05, backlog [`C-01`](../BACKLOG.md)
Chain: Base Sepolia, chain ID `84532`
Status: **partial pass.** The threshold and signer-loss gates of RG-05 are
satisfied and independently verified. The grant and revoke runbook gates are not.

This record contains only on-chain facts. Signer addresses and their role
assignments are deliberately excluded because `RESOURCE_GATED_WORK.md` RG-04
requires wallet addresses and role assignments to stay out of public source. The
founder holds the address/role register outside the repository. Signers are
referred to here as Signer 1, Signer 2 and Signer 3 in a stable but
non-identifying order.

## 1. Rehearsal Safe

| Field | Value |
| --- | --- |
| Safe address | `0x9D83e47aDEb4b8924FF1563d900D10F8FE5c1c59` |
| Chain | Base Sepolia `84532` |
| Safe version | `1.4.1` |
| Singleton | `0x29fcb43b46531bca003ddc8fcb67ffe91900c762` |
| Fallback handler | `0xfd0732dc9e303f09fcef3a7388ad10a83459ec99` |
| Owners | 3, independently held |
| Threshold | 2 of 3 |
| Safe nonce after the rehearsal | 5 |
| Funding | `0.1` testnet ETH, transaction `0x57ac5d1ae20f52c0330225942dd01408b80677944f2ccce7a01071976a46edd3`, executed 2026-08-16T21:05:32Z |

This Safe is a rehearsal instrument. It holds testnet ETH only, carries no
protocol role, no treasury balance and no mainnet authority, and is not a
candidate for the mainnet ProtocolTreasury or EcosystemTreasury Safes.

The version and fallback handler are recorded because A8d requires the recovery
ceremony to be rehearsed against a specific deployed Safe version and fallback
handler. `1.4.1` with the canonical `CompatibilityFallbackHandler` supports the
EIP-1271 `isValidSignature` path that A8d verifies.

## 2. Executed transaction ledger

All five Safe transactions, in nonce order. Confirmations are the owners who
actually signed, not merely the account that submitted the transaction.

| Nonce | Operation | Confirmed by | Executed by | Executed (UTC) | Transaction hash |
| ---: | --- | --- | --- | --- | --- |
| 0 | transfer 0.001 ETH | Signer 1 + Signer 2 | Signer 2 | 2026-08-16T21:37:50Z | `0xd1c93ea935c56e723e4348463f07ef785b96992d97df338f6f3be559ada79854` |
| 1 | transfer 0.01 ETH | Signer 1 + Signer 3 | Signer 3 | 2026-08-16T21:41:08Z | `0xaa6ef5a373de39984dde6ece7dba609e0102a5eaf7cfbef4ce8d4b9bc7726099` |
| 2 | transfer 0.001 ETH | Signer 2 + Signer 3 | Signer 3 | 2026-08-16T21:42:18Z | `0x59439986598480ee865d4524d23361a25e09447a2efa28e08ffb1da12a0178bb` |
| 3 | `swapOwner` - replace Signer 2 with a temporary test address | Signer 1 + Signer 3 | Signer 3 | 2026-08-16T21:56:34Z | `0x2d5ef4dda86a1ce6a619181b49834d9bcbe028e43c817d1e5c88695305fde94b` |
| 4 | `swapOwner` - restore Signer 2 in place of the temporary address | Signer 3 + Signer 1 | Signer 1 | 2026-08-16T21:58:22Z | `0x601b387e8720a54e848a6942de95265c7434a3d03af514ce7daca3848590b8a2` |

Every transaction carries exactly two confirmations and status `Success`. The
Safe nonce is 5, so this ledger is complete: no other Safe transaction exists.

## 3. Threshold and pair coverage

Nonces 0, 1 and 2 cover all three two-signer combinations:

- Signer 1 + Signer 2
- Signer 1 + Signer 3
- Signer 2 + Signer 3

Nonce 2 is the material result. It was proposed by Signer 2, confirmed by Signer
2 and Signer 3, and executed by Signer 3. The founder's own signer neither
proposed, confirmed nor executed it. The Safe is therefore not dependent on one
person.

No transaction executed on a single confirmation. Enforcement is in the Safe
contract, not in operator discipline.

## 4. Signer-loss recovery

Nonce 3 removed Signer 2 and installed a temporary test address. Its two
confirmations came from Signer 1 and Signer 3. **The removed owner did not sign
its own removal.** That is the property that makes this a real signer-loss
rehearsal rather than a cooperative rotation: a lost or compromised key cannot
block its own replacement, and does not need to be available.

Nonce 4 restored Signer 2 and removed the temporary address, again without any
signature from the address being removed.

Post-restore state, read from chain on 2026-08-19:

- owner count 3, matching the original composition exactly;
- threshold 2;
- the temporary test address is no longer an owner.

## 5. What this rehearsal does and does not prove

Proven and independently verified:

- a 2-of-3 Safe with three independently held signers is deployed on Base
  Sepolia at version 1.4.1;
- one signer alone cannot execute;
- all three signer pairs can execute, including the pair that excludes the
  founder;
- a lost signer can be replaced by the two remaining signers without any
  signature from the lost key, and the original composition can be restored.

Not proven, and still open:

- **RG-05 grant and revoke runbooks.** RG-05 also requires role grant and revoke
  runbooks to pass on Base Sepolia. Those depend on the A8 role data model and
  have not been exercised. RG-05 stays open until they are.
- **RG-03 / A8d recovery ceremony.** The A8d Safe-only passkey recovery path is a
  different mechanism: EIP-1271 verification of a server-issued recovery message
  through two configured RPC endpoints, not a value transfer or an owner change.
  Neither the successful ceremony nor any of the eleven mandatory denial cases in
  [`../runbooks/A8D_SAFE_RECOVERY.md`](../runbooks/A8D_SAFE_RECOVERY.md) section 6
  has been rehearsed. This rehearsal moves none of those gates.
- **Backlog C-01.** Mainnet ProtocolTreasury and EcosystemTreasury Safe addresses
  and their signer policy remain founder-owned and undecided. C-01 stays
  `blocked-on-founder`.
- **Migration and activation.** The A8a and A8d migrations remain unapplied and
  every A8 feature flag remains disabled. Nothing in this record authorizes
  activation.

## 6. How this was verified, and how to re-verify

Verification on 2026-08-19 used two independent read paths:

1. the public Base Sepolia JSON-RPC endpoint `https://sepolia.base.org`, for
   `eth_getTransactionByHash`, `eth_getTransactionReceipt`, decoded
   `execTransaction` calldata, emitted `AddedOwner`/`RemovedOwner`/
   `ExecutionSuccess` events, and live `getOwners()`, `getThreshold()` and
   `nonce()` reads;
2. the Safe Transaction Service for Base Sepolia, for the per-transaction
   confirmation owner lists that identify who actually signed.

To re-verify:

1. Read `getOwners()`, `getThreshold()` and `nonce()` on the Safe address and
   confirm 3 owners, threshold 2, nonce 5.
2. Resolve each hash in section 2, confirm `Success`, and confirm the `to`
   address is the Safe.
3. For nonces 3 and 4, decode the inner `swapOwner` call and confirm the removed
   owner is absent from that transaction's confirmation list.
4. Confirm the three distinct confirmation pairs in nonces 0 to 2.

Do not restate this rehearsal as mainnet readiness, as a completed A8 recovery
ceremony, or as a funded treasury topology in any public post, progress report,
or grant material.
