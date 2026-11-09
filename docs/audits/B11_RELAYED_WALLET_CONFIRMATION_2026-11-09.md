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

Local tests, hosted release and owner-signed acceptance are recorded
separately below. A successful past receipt does not prove the fixed live UI.

Local verification: 91 existing wallet/auction/donation regressions and 18
relay/cache-version tests passed with no skips. The 12 relay cases also passed
against the exact browser ethers 6.7.0 UMD build. The production build passed
11 route checks and all 172 required CSS utilities. No dependency was upgraded.

## Hosted release — November 9

[PR #478](https://github.com/maysonkiller/ArtSoul-Protocol/pull/478), reviewed
head `4edd7e8f`, merged at `2026-11-09T17:19:12Z` as
`d9a6175a6c3fc2be1802485e9cd8a5808e0d819d`.
[CI run 42662678753](https://github.com/maysonkiller/ArtSoul-Protocol/actions/runs/42662678753)
passed Linux, Windows and static checks. The initial run exposed an obsolete
adapter-version assertion for `v18`; it was corrected to the released `v19`
before the successful run.

Deployment `dpl_5aHr5DHtrP5Vpa9ZVdevUUpPJUCB` is READY with the
`artsoulprotocol.com` alias. The production probe verified five routes and ten
assets with all expected-content matches true.

The correction is deployed. The first post-release signed acceptance is recorded
below. Artwork 25 was reloaded after release: indexed default history and Create
New Auction appeared, but that is not evidence of confirmation without reload
for its earlier `v18` transaction. Do not repeat default 25.

## Owner-signed assistant acceptance — 17:20 UTC

On production adapter `v19`, the assistant received the Russian-language request
to close settlement for artwork 14. The owner signed transaction
`0x95b45ef985719c8dd09ee82965245b994b3ba836c182522fc1144f8bef3bfb92`.
Both public RPCs confirmed status 1 in block `56614941` at
`2026-11-09T17:20:57Z`, with `SettlementDefaulted` for auction 14: `0.008 ETH`
to artist credit and `0.002 ETH` to the platform. Post-confirmation reads showed
auction status 4, artwork unminted, active auction 0 and owner pending credit
`0.0609875 ETH`.

Without reloading after submission, the page removed the expired-settlement
action and showed Create New Auction. The assistant cleared the input and
displayed its next-action prompt, artwork link and transaction link. This accepts
the observed assistant default and current-page confirmation flow on `v19`.

Private receipt evidence: `docs/private/b11-assistant-default-receipt-2026-11-09.json`.
Screenshot: `output/b11-assistant-default14-confirmed-2026-11-09.png`.
No completed operation was replayed. The remaining signed assistant journeys
and Phase B are open.

## Owner-signed page re-auction — 17:24 UTC

The owner confirmed signing a new auction for Keeef, artwork 25, at `0.001 ETH`
for 24 hours. Both public RPCs verified transaction
`0x195a74c967dc7c25d14e698ab43c0c1ffd4bbb496985671f75a05db1150528c0`,
status 1, block `56615876` at `2026-11-09T17:24:04Z`. Its exact
`AuctionCreated` event creates auction 74 for artwork 25 and the existing
creator, ending `2026-11-10T17:24:04Z`.

The read-only check used bounded logs from block `56615266` through `56617074`.
At that common observation block, both RPCs agreed that artwork 25 is unminted,
floor remains zero, active auction is 74, auction status is 1 and no bid or
deposit is locked. Core bytecode matches the existing deployment pin.
Private evidence:
`docs/private/b11-artwork25-reauction-receipt-2026-11-09T17-28-04-660Z.json`.

The resulting `gallery#auctions` view showed one live Keeef card with 23h59m
remaining. This accepts the signed page re-auction and resulting gallery state;
in-place modal closure was not observed or claimed. Preserve this transaction
alongside the two completed defaults. Assistant start/bid and the remaining
signed assistant scenarios remain open.

## New-auction dialog follow-up

The signed creation exposed a separate presentation problem: the custom modal
could sit behind the sticky header. New-auction setup now reuses the native
top-layer dialog approach already used by Report and resale. It stays inside
the dynamic viewport without changing the page's scroll root. Initial focus
lands on Close rather than opening the mobile keyboard. Cancel and Escape
abort optional guidance and return focus to the creation button without
scrolling; they cannot close setup while a transaction is pending.
After confirmation, the native dialog is synchronously closed before the
existing shared success notice opens, keeping its OK button accessible.

Local validation passed 64 focused action/dialog/creation tests and the full
production build (11 routes and 172 CSS utilities). A local fixture extracted
the actual form and shared styles for Classic and Future at 320x568, 844x390
and 1440x900. All six cases fit the viewport without horizontal overflow; the
field remained 16 px, pending Escape stayed open and cancellation restored
focus without changing scroll position. Screenshots are retained under
`output/b11-auction-dialog-*`; measurements are in
`docs/private/b11-auction-dialog-render-2026-11-09.json`.
The actual confirmation handler was also exercised with a local mocked wallet
and the real shared notice: form pending, form closed, notice acknowledged,
then the gallery-navigation branch completed. No network or wallet operation
was used in that fixture. A regression asserts this presentation order and
that failures leave the form editable.

These are desktop-browser viewport checks, not native iPhone acceptance or a
second signed creation. No completed auction was replayed.

PR #479 passed Linux, Windows, static checks and its hosted preview in
[CI run 42667336887](https://github.com/maysonkiller/ArtSoul-Protocol/actions/runs/42667336887).
It merged at `2026-11-09T17:49:06Z` as
`9e5a7b2216b7d761ff2976e41b6cec0da79e67c0`. Production deployment
`dpl_AG2hSFiCujJCmTCmb8RmZWtUy3yY` is READY with the normal site alias.

The subsequent accepted assistant withdrawal and the separately discovered
Gallery preparation defect are recorded in
[the wallet readiness audit](B11_GALLERY_WALLET_READINESS_2026-11-09.md).

## Primary implementation references

- [ethers 6.7 signer polling](https://github.com/ethers-io/ethers.js/blob/v6.7.0/src.ts/providers/provider-jsonrpc.ts)
- [Rabby provider transaction/receipt routing](https://github.com/RabbyHub/Rabby/blob/develop/src/background/controller/provider/controller.ts)
- [MetaMask delegation deployments](https://github.com/MetaMask/delegation-framework/blob/main/documents/Deployments.md)
- [DelegationManager validation](https://github.com/MetaMask/delegation-framework/blob/main/src/DelegationManager.sol)
- [DeleGator DEFAULT and TRY execution](https://github.com/MetaMask/delegation-framework/blob/main/src/DeleGatorCore.sol)
