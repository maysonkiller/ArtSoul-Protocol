# Local test-wallet import

This operator tool imports three existing, dedicated test accounts into a
Windows DPAPI-protected local vault. It does not sign messages, send
transactions, deploy contracts, grant roles or establish Phase A acceptance.
All source remains in the canonical project checkout.

## Prepare

The operator supplies an ignored `docs/private/phase-a-wallet-policy.json`:

```json
{
  "version": 1,
  "chainId": 84532,
  "excludedAddresses": ["<public address reserved for mainnet>"]
}
```

Use valid public addresses in the exclusion list. Never include private keys
or recovery phrases in this file. Excluding an address is an import guard;
the chain label cannot restrict a private key cryptographically to one chain.

Run the existing built-in self-test before first use:

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\scripts\testnet-wallets.ps1 -Action SelfTest
```

It uses disposable/public vectors to check DPAPI, the anonymous child-process
pipe, ACLs, atomic file creation, overwrite protection and corrupt-record
rejection. It does not access the real wallet vault or the network.

## Import in the operator's interactive terminal

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File C:\Projects\ArtSoul\scripts\testnet-wallets.ps1 -Action Import
```

For `creator`, `collector` and `buyer`, enter the public address followed by the
individual test account's private key in the hidden prompt. Do not paste keys
into chat, shell commands or arguments. Recovery phrases are rejected. No key
is sent to a provider or placed in a process argument.

The importer verifies that the key derives the expected address. It rejects
duplicates and protected addresses. Existing entries are validated and
preserved, not overwritten. Encrypted entries are written atomically under
`%LOCALAPPDATA%\ArtSoul\testnet-wallets` with access limited to the current
Windows user and SYSTEM. This directory is custody data, not another checkout.
DPAPI does not protect against malicious processes already running as that user.

## Status and limitations

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File C:\Projects\ArtSoul\scripts\testnet-wallets.ps1 -Action Status
```

Status reads only public metadata and checks the envelope shape. It explicitly
returns `custodyVerified: false`; it does not decrypt or prove continued access.
`Prepare` creates/checks the restricted vault without requesting keys.

Any later signing tool requires an independently checked chain, exact contract
and method allowlists, explicit asset identifiers, spending bounds, a durable
transaction journal and confirmation reconciliation. This importer supplies none
of those execution capabilities. Import is not evidence of a successful wallet
UI flow, independent Safe custody, a passkey ceremony or a completed Phase A gate.

## Bounded transaction runner

`run-testnet-transaction.ps1` is separate from the importer. It decrypts one
role's account locally and passes the key through an anonymous pipe to
`testnet-transaction.mjs`. The key is never an argument, log or environment value.
The runner accepts only chain 84532 and two fixed RPCs, approved exact plan-file
hashes, known contract bytecode hashes and specific protocol methods. NFT approval
is per token and only to the configured Core; broad approvals, Safe administration
and arbitrary transfers are excluded. Plans name artwork and auction/token IDs
explicitly and expire before signing and broadcast.

The private policy includes `contracts.core` / `contracts.nft` addresses and
code hashes, `approvedPlanHashes`, and decimal-string limits `maxValueWei`,
`maxGasLimit`, `maxGasPriceWei`, `maxTotalReservedWei`, `l1ReserveWei`. Review the
concrete plan before adding its SHA-256. Never put keys or sessions in either file.

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\scripts\run-testnet-transaction.ps1 -PlanPath .\docs\private\reviewed-plan.json
```

A durable exclusive journal records the signed hash and nonce before sending.
An existing operation ID is never resent. If a call times out or reports receipt
disagreement, read the saved hash through both RPCs; do not create another plan
to bypass it or blindly remove a lock. Later operations reconcile every prior
role's receipt and actual value/gas/L1 cost before signing. An unresolved receipt
or reservation overrun stops the campaign. L1 reserve is an estimate, not a hard
network fee cap, and the runner is not a mainnet custody system.

`ImportPipe` is available only for an already-authorized local operator process
to supply the same three individual account records over anonymous stdin. It
does not accept recovery phrases or change the account validation rules. Do not
send secrets through chat or command strings.
