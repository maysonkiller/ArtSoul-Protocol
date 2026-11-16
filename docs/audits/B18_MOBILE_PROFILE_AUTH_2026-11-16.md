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
attempt succeeded. The subsequent screenshots show the exact generic Notice
"Authentication was not completed" followed by the profile's inline "Verify
your wallet to edit your profile." This proves the authentication catch path,
followed by duplicate feedback in its caller. It does not reveal the underlying
provider/backend error or prove that returning early caused it. Do not count
the first-attempt authentication path as accepted.

After PR #491 was released, the owner repeatedly reproduced the failure by
returning from MetaMask before completion; waiting in the wallet succeeded.
The new message is `AUTH_UNAVAILABLE`. The [early-return follow-up](B18_EARLY_WALLET_RETURN_2026-11-16.md)
records that stronger trigger evidence, bounded server checks and the remaining
operation-level ambiguity. The first-attempt issue is still open.

## Investigation boundary

The current client awaits the wallet's `personal_sign` response and server
verification before opening the private editor. The mobile wallet-opening delay
does not complete or reject authentication. A pending editor tolerates empty
authentication-cache events but still cancels on an actual wallet change.

No signature, nonce, account-match or private-profile authorization check is
weakened. A passing delayed-response simulation would establish local behavior,
not reproduce the owner's mobile MetaMask incident. No automatic retry should
request a second signature or treat a failed signature as success.

The underlying provider/backend error remains needed for incident attribution. Physical
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
This is not a real iOS relay test. That first regression slice did not change
the implementation; it does not justify speculative transport delays or
signature retries.

## Feedback correction implemented

Profile now consumes a scoped, fixed-message failure result from the existing
shared authentication operation. A failed Edit attempt presents one inline
message instead of the generic Notice followed by another error. A recognized
wallet cancellation uses neutral status feedback; an expired request,
verification failure or unavailable connection has an actionable message.
Provider/backend response bodies are not displayed. Existing callers retain
boolean results and at most one legacy alert per shared sign-in attempt.
Saving retains the draft and no longer adds a second authentication alert.

The runtime loader and wallet diagnostic both use wrapper revision 55. There
are no new dependencies, automatic signature retries, transport delays or
changes to nonce, account-match, private-profile or server verification rules.
The current request/account guards still prevent a late result opening the
wrong profile.

Validation: 111 focused authentication, profile, mobile-resume and runtime-loader
tests passed across six files. Syntax checks, the production build and an
independent review passed. This verifies the feedback correction and controlled
pending/rejection behavior; the original physical-device failure remains
unattributed and its first-attempt acceptance stays open.

## Related release completed

[PR #489](https://github.com/maysonkiller/ArtSoul-Protocol/pull/489) merged as
`0946288ae528938ff88ac8de46df9f23e706064a` after Linux, Windows, static and Vercel
checks passed. Production deployment `dpl_BXHdzSq3SYhBFvNTdpH9TD2iSeUE` is READY
and assigned to `artsoulprotocol.com`. All nine public-reader/private-access
probes passed at `2026-11-16T12:05:42.670Z`. This releases the completed B20
notification correction; it does not claim to fix this newly reported mobile
authentication issue.
