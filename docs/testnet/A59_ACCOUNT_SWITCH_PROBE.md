# A-59 — how to find out whether an in-wallet account switch reaches the site

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
