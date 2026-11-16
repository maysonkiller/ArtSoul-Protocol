# Early return from the mobile wallet

Date: November 16, 2026

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

Physical iPhone acceptance stays open until the early-return scenario succeeds
or a fresh support reference identifies its remaining failure. A desktop
session opening the editor is not substitute evidence.

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
introduced. Physical acceptance remains distinct from these local checks.
