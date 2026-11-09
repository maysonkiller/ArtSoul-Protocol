# B11: relayed wallet confirmation recovery

## Observed failure

During owner-assisted acceptance on November 9, closing expired settlement for
artwork/auction 25 succeeded on Base Sepolia in block 56,605,866. The successful
receipt contains SettlementDefaulted; the artwork remains unminted with no active
auction. The page nevertheless remained on Processing without a reload.

Transaction: `0xbfcba3da1f64504825c2eb2f9111a3c5173977c0248907bbeea42ab0d5e08875`.
No repeat transaction was sent. The failure is in displaying confirmation, not
in contract execution or the approved deposit distribution.

Rabby returned a synthetic inner-call transaction for the outer relay hash,
without signature fields. Browser ethers 6.7.0 cannot format it (`missing r`),
and its signer polling path leaves the send promise unresolved before receipt
handling starts. The existing receipt reconciliation therefore never ran.

## Bounded correction

The existing provider wrapper recovers only an unsigned transaction lookup on
Base Sepolia, using the existing public RPC transport. A canonical result must
match hash and chain, have signature fields, and represent the same approved
call. Ordinary signed wallet results and approval routing remain unchanged.

Direct calls must match sender, recipient, value and calldata. The observed
MetaMask DelegationManager 1.3.0 relay is accepted only for one root delegation,
one exact execution and SINGLE/DEFAULT mode, which propagates inner failure.
Sender/delegate authority, target, amount and calldata must match the wallet
call. The account must also use the supported MetaMask stateless delegator
implementation at the mined transaction block, checked read-only. Pending
relay envelopes cannot establish this historical execution proof yet.
TRY, batch, unknown manager/implementation and mismatched envelopes are not treated as
proof of completion. Canonical outer sender, nonce and calldata stay intact;
the implementation never fabricates signature fields or resends a transaction.

Unavailable or unsupported recovery data remains pending. This is deliberately
narrow compatibility, not a general relay/AA adapter or a new spending policy.
It does not upgrade ethers, change contracts, fees, authority or write networks.

## Evidence and verification

- The real transaction was checked read-only against the new envelope validator;
  it matches the exact call and deployed manager.
- Local transport fixtures exercise the actual ethers signer, contract and
  receipt flow, including delayed lookup, genuine revert and rejected envelopes.
- Existing auction reconciliation, current-wallet, mobile handoff, creation and
  donation regressions are retained.
- The adapter cache version is increased on all five consuming pages together
  with its normalized content-hash guard.

Local tests, hosted release and the next owner-signed acceptance are recorded
separately below. A successful past receipt does not prove the fixed live UI.

Local verification: 91 existing wallet/auction/donation regressions and 18
relay/cache-version tests passed with no skips. The 12 relay cases also passed
against the exact browser ethers 6.7.0 UMD build. The production build passed
11 route checks and all 172 required CSS utilities. No dependency was upgraded.

## Primary implementation references

- [ethers 6.7 signer polling](https://github.com/ethers-io/ethers.js/blob/v6.7.0/src.ts/providers/provider-jsonrpc.ts)
- [Rabby provider transaction/receipt routing](https://github.com/RabbyHub/Rabby/blob/develop/src/background/controller/provider/controller.ts)
- [MetaMask delegation deployments](https://github.com/MetaMask/delegation-framework/blob/main/documents/Deployments.md)
- [DelegationManager validation](https://github.com/MetaMask/delegation-framework/blob/main/src/DelegationManager.sol)
- [DeleGator DEFAULT and TRY execution](https://github.com/MetaMask/delegation-framework/blob/main/src/DeleGatorCore.sol)
