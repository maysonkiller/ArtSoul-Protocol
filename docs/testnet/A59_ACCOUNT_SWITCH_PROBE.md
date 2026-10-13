# A-59 — how to find out whether an in-wallet account switch reaches the site

## Recorded desktop result — October 14, 2026

**A-59 accepted.** After the captured pass below, the owner confirmed that no
other currently used wallet still shows the reported stale-address behavior.
That resolves the earlier unnamed-other-wallet scope. This closes the reported
issue with the stated evidence limits; it does not certify every wallet or
claim an unobserved native-mobile flow. Keep the historical probe for a future
specific reproduction, not as an outstanding request to repeat this pass.

PASS for the owner's actual Rabby Wallet in ordinary desktop Chrome on the apex,
release `12f3e38`. The owner switched from personal wallet suffix 989b to founder
wallet suffix 1ccd inside the wallet. The same page's existing diagnostic buffer
retained both accounts; no reload was needed for the transition:

- 23:00:45.291 UTC October 13: injected `accountsChanged` announced 989b;
  runtime accepted that account at 23:00:46.202.
- 23:01:01.072 / .073: AppKit and injected providers announced 1ccd through
  `accountsChanged`; runtime accepted it at .315 / .640. The connector was
  `io.rabby` / Rabby Wallet on chain 84532.
- At 23:01:04.340, provider, AppKit and runtime all held 1ccd. The observed
  header showed the new account and a numeric Base Sepolia balance. Opening
  Profile showed 1ccd, no avatar/bio and no created artworks, without the former
  account's identity or works. A subsequent profile reload retained this result.

Evidence: `output/audit/a59-rabby-native-events-2026-10-14.json` (allowlisted,
suffix-only event record) and `a59-rabby-founder-profile-2026-10-14.png`.
The owner performed the switch. The agent made no signature, transaction,
profile save or factor change. Do not repeat this passed Rabby desktop flow.
This is the injected-provider path, not a WalletConnect session namespace update
or native phone capture. The historical issue below is not reproduced on this
tested path. The older scope sentence below refers to other reported wallets,
but the backlog did not name them. The owner's subsequent no-remaining-problem
confirmation reconciles that scope; do not invent a native-mobile or all-wallet gate.
No polling or handler rewrite is justified by this result. Protected server-session isolation is covered separately by the
profile isolation acceptance; no new SIWE or verified staff session is claimed.

## Historical report and remaining WalletConnect probe

Switching to a different account inside the wallet application is not noticed:
the site keeps browsing as the previously approved address, and asks for no
reconnect, re-approval or fresh signature. Each account is a separate identity,
so this is an identity question rather than a cosmetic one.

The handler that would act on it is correct. `handleProviderAccountsChanged`
compares against the last processed address and signs out a mismatched session.
So the open question is not what to do about the signal. It is whether the
signal arrives at all.

## Why this needed a change before it could be measured

A WalletConnect session's approved account list is fixed at approval time. It
changes through exactly one event, `session_update`. That event was already
bound in `wallet-core-connect.js` — and summarised as topic, code and message,
which drops the accounts it carries. The log could not answer the question it
was the only witness to.

As of 2026-09-14 the summary records the accounts from the update, the accounts
the provider still holds, and whether they differ. Every address is masked to
first six and last four. The visibility-return branch in `appkit-init.js` now
snapshots the provider the same way the visibility-hidden branch already did,
so there is a before and an after to compare.

**Nothing was rewired.** No handler acts on `session_update` yet, because the
row says to decide between a reconciliation read and a documented wallet
limitation only from real evidence.

## The run

A wallet holding at least two accounts, on a real device, in an ordinary
browser. About three minutes.

**1.** Open `https://artsoulprotocol.com/?walletdebug=1` and connect the wallet.
Note which account you approved.

**2.** Open the wallet application and switch to a different account. Do not
disconnect, and do not change the network.

**3.** Return to the browser tab. Wait five seconds. Do not reload.

**4.** In the address bar, run:

```js
javascript:(()=>{const s=JSON.stringify(ArtSoulWalletDebug.snapshot());prompt('copy',s)})()
```

On a phone, the simpler route is to open the same page on desktop with the
wallet connected there, or to use remote inspection. What matters is the
buffer, not how it is copied.

## What the answer looks like

Look for these lines, in this order:

| Line | What it means |
| --- | --- |
| `core provider session_update` with `differs: true` | The wallet told us. The site is discarding a signal it receives, and the repair is a reconciliation read into the existing handler. |
| `core provider session_update` with `differs: false` | The wallet announced namespaces that did not change. Keep looking. |
| `accountsChanged` with a different masked address | The signal arrives on the other path and the handler should already have run. That would be a different defect. |
| No `session_update` and no `accountsChanged`, and `visibility changed` `state: visible` showing the **old** address | The wallet never told us. This is a wallet limitation, gets documented as one, and no dapp-side change can find it. |

## What not to do with the answer

Do not add polling of the provider account on a timer. Do not reopen A-03, A-05
or A-45 acceptance. Reported on wallets other than MetaMask, so one wallet
answering does not close the row for the others — record which wallet produced
which line.
