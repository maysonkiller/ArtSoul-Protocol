# C1 — Funded pause and mint-authority characterization

Status: three current-source hazards reproduced on a disposable Hardhat chain;
**not a fix, replacement-design acceptance or Phase C sign-off**.

Scope: Bible auction/settlement/mint lifecycle, provenance and administration;
[C1 records D1/D2](../architecture/C1_DECISION_INVARIANTS_2026-11-02.md).
Only tests and evidence changed. No Solidity, storage layout, deployed authority,
economic rule, live time, wallet or network was changed.

## Reproductions

The cases reuse the existing protocol fixtures in
[ArtSoulV41.test.cjs](../../test/ArtSoulV41.test.cjs#L854). Each pending auction has
a 1 ETH winning price and its existing required deposit. Failed payable calls
have an explicit gas limit and advance the local block number, proving executed
reverts rather than only estimation failures.

| Case | Observed current behavior | Replacement implication |
| --- | --- | --- |
| Pause spans the payment deadline | Correct payment reverts while paused. After expiry and unpause, it reverts `SettlementExpired`; permissionless default then allocates the locked deposit 80/20. Pause/unpause did not change the deadline. No NFT or floor was created | Decide emergency fulfillment and deadline policy before automated default; a winner must not silently lose the agreed opportunity because administration paused execution |
| Mint authority changes while an old auction awaits payment | Old Core settlement reverts `UnauthorizedCore`. Restoring its authority before expiry allows settlement, one mint and the normal proceeds credits | New version activation must preserve outstanding old mint obligations; a mutable single-authority pointer does not establish that guarantee |
| Two Cores reuse local artwork ID 1 with one NFT contract | Both auctions are funded before advancing time. Core B settles its distinct work first. Restoring authority to Core A does not help: its still-timely settlement reverts `ArtworkAlreadyMinted`. B's owner, creator and metadata remain intact | Identity must include deployment/version or use a reviewed stable registry; resetting local counters while sharing this NFT mapping is unsafe |

Every failed settlement compares the complete auction/artwork tuples, Core ETH
balance, creator/winner/treasury credits, settlement count, token mappings, NFT
supply, and any existing token's creator/owner/URI. The submitted remaining price
does not stay in the Core on revert; the bidder can still pay transaction gas.
The collision test also verifies that Core B's completed state remains unchanged.
It does not assert that a blocked old auction has a satisfactory recovery path.

The positive authority-restoration control confirms the original settlement
works when its dependency is restored before expiry. This avoids mistaking a
bad fixture or an expired deadline for the authority hazard. The pause test
separately confirms default is also blocked during pause, then succeeds after
unpause; this records current behavior rather than endorsing it.

## Validation and provenance

Local command, explicitly restricted to the disposable network:

```text
npm run test:contracts -- --network hardhat
```

Result: **52 passing**, including all three new cases, existing Core tests,
Collection Launch/Forge and Donations. Focused characterization: **3 passing**.
The block asserts chain ID 31337. No real wallet signing or RPC transaction was
used. The initial focused run exposed two unsupported Chai BigInt-ordering
assertions; those test assertions were corrected before the passing focused/full
runs. It did not identify an additional contract failure.

The reviewed contract source is unchanged from the C1 baseline:

| Source | SHA-256 |
| --- | --- |
| `contracts/ArtSoulCore.sol` | `97ef6feae0d8ede75e4f926228749e049428777ff85784cbdfe56cdf7348a377` |
| `contracts/ArtSoulNFT.sol` | `98ae45eaac9198b616094352f606806760483d0d32b81ce8ce98e14ca9688822` |

This is source characterization, not fresh verification of deployed bytecode or
an independent audit. It does not test the proposed replacement contracts.

Interpretation: keep these explicitly named prototype behaviors as reproducible
C1 evidence. Replacement acceptance must test the approved safe outcome instead
of preserving the hazards. Topology, authority/drain policy and pause/deadline
decisions remain open; no constructor default or policy is selected by these tests.
