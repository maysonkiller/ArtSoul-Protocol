# Early return from the mobile wallet

Date: November 16, 2026

## Owner acceptance after PR #492

The owner repeated the requested early-return test on the iPhone after production
deployment `dpl_5UaKVTs5UrYQtmgqYSEfPp6ByZnv` (merge
`c84746d1b1715b8af7aa195d557e6a80c686c285`). The editor opened successfully.
This is physical-device acceptance of the previously failing sign-in scenario;
the earlier failure's exact provider/backend cause was not captured.

The owner also reported an Open MetaMask window remaining until manually closed.
They then identified the white browser confirmation asking to open this page in
the MetaMask app, with Cancel and Open actions. It is neither ArtSoul's dark
Waiting for your wallet hint nor the SDK connection dialog. Do not ask for
another signature merely to repeat the accepted authentication result.

## Native app-opening confirmation follow-up

`openCoreWalletForApproval` navigates to the wallet's peer-advertised URL. A
350ms timer invoked that navigation automatically while a wallet request was
pending. The browser can keep its native confirmation visible even if the
request meanwhile completes and the profile editor opens. Website DOM cleanup
cannot dismiss that browser-owned dialog.

The timer now only shows the existing non-blocking, themed waiting hint. Its
explicit Open MetaMask button remains the handoff to the wallet and reuses the
same pending request. Fast responses never show the hint; response/rejection
removes it. This applies consistently to core signatures, transactions and
network requests. Initial wallet connection and SDK session behavior are
unchanged. Runtime imports advance to revision 57.

The intentional UX tradeoff is one explicit Open action when an already connected
mobile wallet needs attention, instead of an unsolicited timer navigation. A
browser may still ask for confirmation after that deliberate click; no website
code attempts to bypass or dismiss the browser's protection. See Apple's
[custom URL scheme documentation](https://developer.apple.com/documentation/xcode/defining-a-custom-url-scheme-for-your-app)
for the system-controlled app-launch mechanism. Attribution of the exact native
dialog comes from the owner's description, not desktop emulation.

Validation: 131 focused wallet, authentication, profile and runtime-loading tests
pass. The handoff tests execute the real URL-opening function and verify zero
timer-driven app launches, one launch from an explicit Open action, no duplicate
wallet request and hint cleanup after success or rejection. The production build
and independent review pass. These tests do not emulate iOS's native dialog.

## Current evidence

After PR #491, the owner reproduced the profile sign-in failure repeatedly on
an iPhone with MetaMask: returning to the browser before MetaMask completes
produces `Wallet sign-in is temporarily unavailable. Check your connection and
try again.` Waiting for MetaMask to finish allows sign-in. This establishes the
owner-observed trigger; it does not identify the failing SDK or HTTP operation.
The previous duplicate-feedback correction remains valid but is not a fix for
this first-attempt failure.

A bounded read-only check found two founder-wallet nonce records issued during
13:56 UTC, both unused. Supabase edge logs for 13:54–14:00 UTC show two nonce
inserts returning HTTP 201 and no nonce-consumption request. No nonce values,
signatures, session cookies or private profile fields were read or exported.
Vercel application-output logs returned no auth messages for the recent window;
the handlers do not log every HTTP rejection, so this does not establish that no
verification request reached Vercel.

The real authentication source, with controlled transport inputs, demonstrates:

- Pending `personal_sign` makes no verification POST until it resolves.
- A provider `TypeError` and a verification-fetch `TypeError` both become
  `AUTH_UNAVAILABLE`; the existing public message cannot distinguish them.
- Neither failure grants authentication or private-profile access.
- A semantic verification HTTP 401 incorrectly tries the legacy `/auth/verify`
  route and loses the original error when that route returns 404. That normally
  becomes `AUTH_FAILED`, so it is a separate confirmed defect.

The exact mobile WalletConnect 2.23.10 implementation retains its pending
SignClient response listener across a normal relay restart. The unconditional
resume restart is therefore not proven as this failure's cause. Dead-relay
recovery must not be removed speculatively.

## Bounded follow-up

Keep one signature request, the existing signature verification, atomic nonce
consumption and wallet-match checks. Do not retry signing or verification
automatically, extend nonce lifetime or treat a missing response as success.

Use the existing opt-in wallet debug buffer to identify the failed operation
with fixed stage and error metadata only. A diagnostic profile URL may expose
that short support reference in the existing inline message; ordinary browsing
does not expose diagnostics. No remote telemetry collector is introduced.

Also correct the demonstrated delayed handoff: a wallet-opening timer suspended
while the browser is hidden must not automatically reopen the wallet when the
user returns. The explicit Open Wallet action and the pending request remain.

At that investigation stage, physical iPhone acceptance still required either a
successful early-return check or a fresh support reference identifying the
remaining failure. A desktop editor opening was not substitute evidence.

## Implemented changes

- The mobile approval timer remembers whether the page was hidden. A delayed
  timer cannot send the user back to the wallet after returning; an explicit
  Open Wallet action still works without creating another signing request.
  Completion and rejection remove the timer and visibility listener.
- Authentication fallback now applies only to a missing HTTP 404 route, not a
  semantic HTTP 401 rejection. Known backend error codes remain available;
  signature verification is not retried after rejection or a network error.
- The existing opt-in debug buffer records fixed operation stages and bounded
  error metadata. TypeError messages are classified locally into fixed kinds;
  their text is never copied into the diagnostic event. The original rejection
  is preserved even when frozen, primitive, or the diagnostic logger fails.
- With `walletdebug=1`, the existing inline profile error includes a safe
  reference for the current attempt only. Wrapper failures before or after the
  auth operation have fixed stage-only references. No previous attempt's event
  is reused. `walletdebug=0` disables this existing opt-in mode.
- Runtime imports and their test expectations advance together to revision 56.

The integrated authentication/profile/handoff regression slice passes 34 tests.
These cover pending requests, rejection, unchanged signature/verification counts,
account changes, hidden-page handoff, fallback routing and diagnostic redaction.
Production build checks pass for all 11 HTML routes. Independent code review
found and corrected a diagnostic getter-snapshot issue. No SDK upgrade, new
dependency, remote telemetry, nonce-lifetime change or relay-recovery change was
introduced. The subsequent owner acceptance is recorded above.
