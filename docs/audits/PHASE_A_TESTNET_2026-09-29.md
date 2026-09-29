# Phase A testnet execution — 2026-09-29

Canonical checkout: `C:\Projects\ArtSoul`, branch `codex/takeover-audit`,
HEAD `1d8877a6579bd57c3aa504a141540ae356c5e081` plus the recorded working diff.
The session began with published application `81627ab`. The previously reviewed
PR #281 was subsequently merged independently at `3d1f989`; its post-merge
Linux/Windows/static CI run `36634233062` passed. Its newsletter route remains
unwired and no email/SQL/flag activation was performed. New Phase A changes
remain in the working diff until their separate release checks complete.
These are controlled operator tests, not user adoption or trading traction.

## Live publish and bid continuation

The founder supplied separate live-service authorization after the initial
automatic-review rejection. The reviewed helper then passed 13 real apex API
steps: SIWE, nonce replay denial, matching session, unauthenticated/invalid upload
denials, Gemini 2.5 Flash-Lite with the actual project-owned image and a persisted
guidance-only valuation, signed media and metadata uploads with byte readback,
and logout cookie clearing. This proves cookie clearing, not revocation of an
otherwise stateless token. The live estimate is ordered: 0.0001–0.0005 ETH.

Five additional successful Base Sepolia transactions extend the total to eleven:

| Operation | Evidence |
| --- | --- |
| Register artwork 34 with the verified uploaded metadata | [Transaction](https://sepolia.basescan.org/tx/0x66a10bf5854a7f00c04068e43bf39ab0897884c528819c9aa3c0695e4a779125) |
| Create auction 66 for artwork 34, 24 hours, 0.001 test ETH start | [Transaction](https://sepolia.basescan.org/tx/0xb589790eddfc97e240b1757b67e513c2fda4f76aa5accf4b1e2c37bf7a2bd957) |
| First collector bids 0.001 test ETH with the required 0.01 deposit | [Transaction](https://sepolia.basescan.org/tx/0xae506e90b109702de909e89830ff1c7fc76326c4c1254e1609309b7d614c0426) |
| Second collector bids 0.011 test ETH with a 0.01 deposit | [Transaction](https://sepolia.basescan.org/tx/0xdfb37aa11ce6a731aa136a857e05f4beef36c52afe6b9507c162f8b7d44df9e7) |
| First collector withdraws the full 0.01 test ETH refundable deposit | [Transaction](https://sepolia.basescan.org/tx/0x1e91ab550d7bef85aa076f22c3c81c5c8c1b37426eca2209ca6b3c4e1b448433) |

Two independent RPCs verify the same confirmed receipts and state. Registration
initially stopped at `RECEIPT_DISAGREEMENT_FIELDS`, then reconciled without replay.
The initial differing values were not retained, so their cause is not asserted.
The full deposit receipt was measured from account balances and actual execution
plus L1 fees, not inferred only from a zero pending credit. A second withdrawal
simulation rejects with `NothingToWithdraw`. Ten pre-bid simulations across the
two RPCs reject creator bidding, a low bid, incorrect deposit, an early ending,
and auction creation by a different wallet with the exact contract errors.

Artwork 34 is still unminted, has no token or canonical floor, and maps to auction
66. The projection, apex artwork page and read-only WebMCP show the two actual
bids and the same leading bidder. The apex correctly explains
`max(10% of your bid, 0.01 ETH)` and the next bid of 0.021 ETH. The visible Gemini
range matches the real response. Evidence: private `phase-a-primary-*-2026-09-29.json`
and `phase-a-api-rehearsal-2026-09-29.json`; public-page capture under
`output/audit/phase-a-primary-live-2026-09-29.png` and `.txt`.

The current end time is **2026-09-30 21:25:20 UTC** (23:25:20 Warsaw).
Settlement/mint for this new artwork is not yet tested. A later continuation
must re-read the current end time, winner and remaining payment before signing;
do not assume this snapshot still controls after another bid or time extension.
The public chain clock was not accelerated and contract economics were unchanged.

## Real Base Sepolia transactions

All six transactions have successful receipts reconciled across
`sepolia.base.org` and `base-sepolia-rpc.publicnode.com`, with canonical block
hashes and 42–276 confirmations at the final observation. No transaction was
resent after an uncertain confirmation.

| Operation | Evidence |
| --- | --- |
| Buy existing token 4 / artwork 19 for 0.0011 test ETH | [Transaction](https://sepolia.basescan.org/tx/0x769596af82a4edaf8ea600a4dbe95a598a40c8c2308af35253ff6fca81c9d2e3) |
| End expired no-bid auction 63 / artwork 28 | [Transaction](https://sepolia.basescan.org/tx/0x62ea60d47ad7993d1e96efe8dbd938fa22eb6ee70769c5e59670621f10bb9c34) |
| Approve Core for token 4 only | [Transaction](https://sepolia.basescan.org/tx/0x1efff26ac4c8cf2c327e96e7d79713a20a17ca34dc62b572ea8d9e0d25a2f34f) |
| List token 4 for 0.0012 test ETH | [Transaction](https://sepolia.basescan.org/tx/0x6f249bae4e861c60aee9599daf7a8d9ed21b9eafd91d1094e1f128edfcfc8de2) |
| Buy that listing with another test account | [Transaction](https://sepolia.basescan.org/tx/0xb1acbff3f3d55d4ecf0692b922e6f46a0e422a76c3f3add08161ca5d9b208cfb) |
| Withdraw the seller's credited proceeds | [Transaction](https://sepolia.basescan.org/tx/0xe89bfa4057dd440748cab2627a20af6579669ac8c7c64bd5f6c50e025f14d98c) |

Final reads agree: token owner is the final test buyer; the single-token approval
is cleared; the listing is inactive; seller pending credit is zero; the seller's
balance increased by exactly 0.00108 test ETH after accounting for transaction
fees. That amount follows the existing prototype's documented resale split; no
economic change was made. Artwork 19's canonical floor remains 0.001 test ETH.
Total execution plus L1 fees for the six transactions: 0.000002466873063402 test ETH.

The apex UI, public projection and read-only WebMCP showed three distinct Creator,
First Collector and Owner addresses and the actual resale hashes. The first
buyer's Owned tab showed the acquired NFT. The later buyer's Owned tab was also
checked in the built local UI against live public GET data. Artwork 28 displays
`No bids` and its latest ending in the timeline. This does not prove a connected
browser's receipt-to-refresh transition or phone wallet behavior. Re-auctioning
artwork 28 requires its actual creator; none of the imported accounts is that
creator. The current Sales tab is creator-focused, not a complete reseller ledger.

The approval and listing initially stopped at receipt disagreement; later
read-only reconciliation and the subsequent runner preflight verified both.
No initial disagreement payload was retained, so its exact cause is unproven.
The runner now separately tests receipt-before-block propagation as pending and
reports more specific disagreement codes without resending a signed operation.

## Local corrections and verification

- Portrait artwork media: responsive CSS overrode containment with `cover`.
  Four values now use `contain`. Existing media/layout tests: 28 passed. Actual
  built-browser regression: 12 cases across two videos, one image, two themes
  and 1440/390 px; no page exceptions. This is viewport testing, not real phones.
- Profile network link: an observed Base Sepolia account linked to mainnet
  BaseScan. The active product profile now links to the testnet explorer.
- Card price: the live profile showed artwork 34's 0.001 starting price while
  its detail/indexer reported the actual 0.011 bid. The profile now reuses one
  shared card price resolver across gallery/home/profile, skips zero bids and
  preserves tiny positive prices. Three regression checks failed before the
  repair; 16 focused checks pass afterward. All four classic-script consumers
  use the updated cache version and content hash.
- Genesis boundary: a fresh test account displayed `In Progress 1/5`; a
  ProjectNFT prototype read could also label it a Genesis holder. The profile
  no longer reads that prototype as Genesis, the unsupported activity thresholds
  cannot return eligibility, and the card states that testnet does not qualify.
  This implements existing Bible §7; no grant, role or economic term changed.
- Operator tools: encrypted local custody, fixed testnet/method/contract scopes,
  exact plan hashes, expiry checks, immutable pre-broadcast journal, two-RPC
  reconciliation, and actual fee accounting. Failure-path tests cover expiry,
  disk errors, uncertain broadcasts, nonce fencing, receipt disagreement and
  budget failures. L1 reserve is an estimate, not an on-chain fee cap.
- Complaint/email engineering: eleven route-to-PostgreSQL journey tests passed,
  including quotas, duplicates, authorization/revocation, decision races,
  hide/restore and atomic notification obligations. Two newsletter email
  requests reached a local capture sink. No external email was sent; the
  moderation implementation now exposes a recipient-scoped in-app inbox with
  safe artwork references, precise pagination and session-change clearing.
  Fifty-two focused checks, eleven real PostgreSQL checks and ten built-browser
  scenarios pass. This is user-visible history, not external email or a read
  receipt. Root review required distinguishable artwork references before
  acceptance; the final patch and tests include them. Live write flags and
  migrations remain unchanged. Full local handoff: `output/audit/A8C_INBOX_HANDOFF_2026-09-29.md`.

Latest command `node scripts/run-unit-tests.mjs`: **1338 passed, zero failed or
skipped**, including real disposable PostgreSQL suites. The preceding 1316-pass
run predates the inbox and card-price changes. The first final run
exposed three avatar tests extracting code by an obsolete comment; their stable
function boundary was corrected and the full suite rerun. Both logs are retained.
Build: **11 routes / 178 utilities**, passed. The unchanged contract source retains
the same day's **33 passing contract tests**; no deployed storage was changed.
New Phase A source has not yet run hosted CI or been published.

Evidence is retained under `output/audit/`: `phase-a-final-unit-2026-09-29-v2.log`,
`phase-a-final-build-2026-09-29.log`, `phase-a-media-containment-regression-2026-09-29.json`,
`phase-a-profile-boundary-built-2026-09-29.png` and the moderation journey record.
Private journals and complete RPC snapshots remain ignored under `docs/private/`;
keys remain encrypted outside the checkout, never in evidence or source.
Latest complete logs: `phase-a-release-unit-2026-09-29.log` and
`phase-a-release-build-2026-09-29.log`. Final review also reproduced and repaired
the zero-token card sentinel and the stale-version cache-test guard. Fourteen
focused card/cache/classification checks passed. Earlier inbox logs are retained. The failed build attempt before that
was a sandbox access failure to the installed npm CLI; the authorized run passed.
The obsolete close-out wording assertion was corrected to retain activation
gates without claiming recipient delivery was already complete; 12 doc checks pass.

A one-time continuation is scheduled in this chat for September 30, 23:35
Warsaw, to re-read and finish auction 66 after its actual deadline. It requires
the computer and desktop app to remain running; it does not pre-approve any
changed winner/payment or claim that future settlement has already succeeded.

## Deferred and blocked

The [founder amendment](../canon/CHANGELOG_2026-09-29_TESTNET_ACCEPTANCE.md)
defers real passkey setup to mainnet preparation, before dependent activation.
It does not waive phone/OAuth evidence or enable live moderation.

The earlier live-service approval block is resolved by the founder's separate
authorization and the successful rehearsal above. No substitute-origin workaround
was used. Unavailable real phones, OAuth sessions and operator ceremonies are
evidence requirements, not an outstanding general permission request.

Phase A is not declared complete. Open evidence includes actual iOS/Android and
OAuth flows, connected-browser publish/auction feedback, the actual settlement
and mint of artwork 34 after auction 66 ends, reviewed moderation activation and the beta go/no-go record. No mainnet, DNS,
production migration, contract deployment or real passkey ceremony occurred.
