# Mobile profile authentication follow-up

Date: November 16, 2026

## Owner observation

The owner reviewed the current interface on a real iPhone and reported no
obvious layout problems overall. The requested review covered Home, Discovery,
both appearances, Profile, editing and the network menu. This is an informal
owner report, not a measured device matrix. Browser, iPhone model and iOS version
were not supplied; speech recognition was not confirmed separately.

One issue remains: the first attempt to open profile editing displayed a red
error after a MetaMask confirmation and an early return to the browser. A second
attempt succeeded. The exact error and whether the first confirmation approved
connection or signed SIWE are not yet known. Do not infer that returning early
caused the error, or count the first-attempt authentication path as accepted.

## Investigation boundary

The current client awaits the wallet's `personal_sign` response and server
verification before opening the private editor. The mobile wallet-opening delay
does not complete or reject authentication. A pending editor tolerates empty
authentication-cache events but still cancels on an actual wallet change.

No signature, nonce, account-match or private-profile authorization check is
weakened. A passing delayed-response simulation would establish local behavior,
not reproduce the owner's mobile MetaMask incident. No automatic retry should
request a second signature or treat a failed signature as success.

The exact first-attempt error remains needed for incident attribution. Physical
device confirmation of the first attempt remains open; repeated successful
sign-in is not equivalent evidence.

## Local regression evidence

`node --test test/profile-content-report-ui.test.cjs` passes 14 tests, including
four new cases that execute the current `supabase-auth.js`,
`ensureAuthenticated`, profile-editor handlers and `processWalletResume` code:

- With `personal_sign` unresolved across browser resume, the editor remains
  pending without error; verification and private-profile reads remain zero.
  Repeated Edit does not request another signature. Resolving the original
  signature produces one verification and one private read, then opens editing.
- A rejected signature never opens private content; an explicit later retry can
  succeed.
- A real account change cancels editing and prevents a late signature from
  opening the old account's private profile.
- The intentional one-turn mobile connection deferral returns without signing;
  the current profile caller displays its verification message, and an explicit
  retry can sign. The connection path clears that flag on the next timer turn,
  so this forced state does not establish the owner's later Edit click reached
  it.

Wallet transport, backend replies and browser events are controlled test inputs.
This is not a real iOS relay test. The production implementation is unchanged;
the evidence does not justify speculative transport delays or signature retries.

## Related release completed

[PR #489](https://github.com/maysonkiller/ArtSoul-Protocol/pull/489) merged as
`0946288ae528938ff88ac8de46df9f23e706064a` after Linux, Windows, static and Vercel
checks passed. Production deployment `dpl_BXHdzSq3SYhBFvNTdpH9TD2iSeUE` is READY
and assigned to `artsoulprotocol.com`. All nine public-reader/private-access
probes passed at `2026-11-16T12:05:42.670Z`. This releases the completed B20
notification correction; it does not claim to fix this newly reported mobile
authentication issue.
