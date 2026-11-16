# Wallet state freshness after real acceptance — November 9, 2026

## Observed behavior

The owner signed the assistant bid for artwork 14 / auction 75 on Base Sepolia.
Transaction `0x0d92db6bc67f8e726bd87398094d944a6004b0da01f5c5c4f31942c2e285e3e1`
succeeded at block `56674116`, `2026-11-09T20:38:12Z`: bid `0.001 ETH`,
deposit `0.01 ETH`. Two public RPCs agreed. Without reloading, the page showed
the correct bid and bidder, disabled another bid by that wallet, and the
assistant cleared its input and showed the artwork/transaction follow-ups.
The artwork remained unminted with floor zero. This accepted transaction must
not be repeated.

Two secondary stale values were visible in that same page:

- The next-bid quote remained `0.001 ETH` instead of `0.011 ETH`.
- Opening the account menu retained the pre-deposit native balance.

Private receipt evidence is in
`docs/private/b12-assistant-bid14-receipt-2026-11-09.json`; the no-reload capture
is `output/b12-assistant-bid14-confirmed-2026-11-09.png`.

## Corrections

The artwork minimum now takes the greater of the cached RPC quote and the
existing exact-integer calculation from the latest indexed bid. This handles
an indexed bid advancing beyond an old quote without lowering a newer RPC
quote when the indexer is still catching up. The contract's absolute and
percentage increments, integer ceiling and new-round isolation are unchanged.

Opening a connected account menu requests its current native balance through
the existing network reader. Rapid reopening shares an in-flight read;
closing and guest menus do not request balances. The previous rendered value
remains visible during the read. Wallet, render and identity-generation guards
discard obsolete results. There is no new polling loop or dependency.
The shared account runtime cache version advances from 69 to 70 on all eight
entry pages, with the matching content guard updated.

## Phantom follow-up

After Rabby Disconnect, the page showed a guest. Phantom was selected and the
owner confirmed connection in the extension. The website's bounded request
had already failed. After reload, the website remained a guest, while the
standard picker marked Phantom CONNECTED. Selecting it displayed "This
account is already linked" instead of completing the website session.
This was the SDK/application state mismatch observed before the correction.
The later native acceptance is recorded below. Capture:
`output/b18-phantom-late-linked-2026-11-09.png`.

Extension internals were not read or operated after the browser policy rejected
their URL. Only the owner performed the extension approval. No additional
transaction was sent during this connection check.

The installed Reown AppKit 1.8.21 connector view returns early for an already
linked connector. It emits wallet selection without a new connection-success
event, so the website's deliberate fresh-selection gate cannot complete.
The correction uses AppKit's public `disconnect('eip155')` only on an explicit
desktop retry when logout intent remains and the SDK still has a linked account.
Logout stays effective during cleanup. Failure, a no-op or a bounded five-second
timeout leave the page disconnected. A timed-out teardown is shared by the next
retry, preventing its late completion from disconnecting a newer session.
Duplicate Connect clicks and a newer logout cannot open a stale picker.
Successful cleanup still requires fresh wallet selection, connection success,
account revision and provider identity; no arbitrary injected wallet is adopted.
No extension permission is revoked and no SDK storage is broadly wiped.

## Verification and release boundary

The next-bid regression failed before the fix and passes with the shipped live
poll and bid-prefill effect. Coverage includes stale indexer responses, a quote
ahead of the indexer, 18-decimal rounding and a new auction round. The connected
menu regression likewise failed before the fix and now observes exactly one
fresh `eth_getBalance` request on opening, including retry and identity races.
The combined focused run currently passes 104 tests including cache versions.
Seven new explicit-retry scenarios cover the late approval with and without
reload, cancellation, rejected/no-op cleanup, duplicate/newer intent and a timed
out teardown. The explicit-disconnect/mobile recovery/lifecycle runs pass 87
tests. The production build and its 11-route/shared-avatar and Tailwind checks
pass.

[PR #483](https://github.com/maysonkiller/ArtSoul-Protocol/pull/483) merged to
main at `8f409d143444cc5067abd914c0621219eea6915b`.
[CI run 42698582419](https://github.com/maysonkiller/ArtSoul-Protocol/actions/runs/42698582419)
passed: Linux 4,254 tests with 2 skips; Windows 3,554 tests with 35 skips;
55 Hardhat tests and the production build checks passed. Production deployment
`dpl_9n2m4pA6HUkoMjUDtACYRbjQjhTp` is READY at
[the verified deployment](https://artsoul-hxze4921a-maysonkiller-be9112b5.vercel.app).

## Native production acceptance

On production artwork 14 with `walletdebug=1`, explicit Phantom selection and
the owner's extension confirmation connected
`0x974a5ace66095d2ac7e7f3e2e66b481efc7df06e`. Disconnect changed the page to
ArtSoul Guest, and a reload retained the guest state.

The reopened picker showed Phantom as installed without a CONNECTED marker.
Selecting installed Rabby then produced a native accessibility state showing
Rabby connected at `0x5e3167636c5eb7fe143a3c9f40ea2bf1d6888383`, with Ethereum
Mainnet as the wallet-selected network. The existing artwork's highest-bidder
action remained disabled. No additional transaction or signature was made
during this acceptance check.

Native Phantom disconnect followed by another wallet: **PASS**. iPhone
composition remains **UNVERIFIED**. This evidence does not declare Phase B or
public beta closed.
