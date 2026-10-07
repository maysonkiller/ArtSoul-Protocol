# Phase A activation and donation amount amendment — 2026-10-03

Authority: the founder explicitly selected passkey setup now and specified that
an artist donation may be any non-zero amount, with or without a message. This
amendment records that instruction; it does not assert deployment or acceptance.

## Operator setup

The September 29 deferral of real founder passkeys and Safe recovery to Phase C
is superseded. Prepare and perform the existing two-passkey enrollment and
recovery ceremony now on the approved apex origin. Preserve the existing staff
authorization, one-time audited bootstrap, recovery checks and staged activation
order. A mock or virtual authenticator is not a completed founder enrollment.

Touches Bible §11 and §17, backlog A8/A10, and the A8 rollout runbook. Mainnet
remains outside this authorization.

### First enrollment without manual code transfer

The founder explicitly requested the assigned wallet's first setup to use the
normal browser/device passkey prompt without copying an enrollment code.

Previous rule: A8a runbook section 1a required possession of the raw one-time
bearer code on both registration requests, including the bootstrap. A stolen
wallet/session without that code could not consume an otherwise valid approval.

New rule: explicit `approved-bootstrap` registration may resolve an existing
live, unused, audited bootstrap for the authenticated active staff wallet on
the server. It is allowed only before any own historical credential or globally
established bootstrap. The exact grant and challenge remain bound and consumed
by the existing atomic RPC; WebAuthn origin, RP ID and user verification remain
required. The browser receives no enrollment token or stored hash. This path
does not issue, renew or recover a grant, create a role, or issue a moderation
session. Additional-device and Safe recovery retain the code-possession path.
After verification, "Add another passkey" may explicitly call the existing
step-up-protected self-grant route and pass its one-time token directly to the
existing registration routes in the same browser. It displays or persists no
token and does not weaken server authorization. Manual transfer remains under
the advanced section for separate browsers/recovery. Available native device
choices vary; a second credential alone is not proof of an independent backup.

Trust change: during that preapproved bootstrap window, possession of the
assigned wallet's authenticated session plus native passkey creation is
sufficient; an independently transferred code is no longer another barrier.
The grant window, prior operator approval, audit, two independent founder keys,
Safe-only recovery and staged activation are retained. Generic staff onboarding
after the one-time bootstrap is not authorized by this amendment.

Touches Bible §11, canon 07 Moderator Access, and A8a runbook sections 1a and 4.
Implementation and real-device acceptance remain separate. Reverting this flow
means restoring token-only resolution and its UI from Git; already enrolled
keys and immutable audit records must not be deleted as part of a rollback.

## Donation amounts

Previous rule: an empty-message donation could be any non-zero amount, while a
non-empty message required a Safe-configurable minimum, initially proposed as
0.0005 ETH with deployment-time reconfirmation.

New rule: **every donation may be any non-zero amount, with or without a message**.
Remove the message minimum from the new contract, configuration, interface and
tests. There is no threshold setter. The entire donation still goes immediately
to the canonical artwork creator; no fee, custody, refund or protocol benefit is
introduced. Existing auction economics and deployed Core/NFT storage are unchanged.

The message remains optional plain text, bounded to 140 visible grapheme clusters
in the interface/projection and 560 valid UTF-8 bytes on-chain. These resource and
display bounds are not amount thresholds. Existing complaint-driven message
moderation remains required before activation.

Supersedes the message-floor rule in `SUPPORT_THE_ARTIST_DESIGN.md` and the
September 30 artist-support amendment, decisions 3 and the preserved minimum.
Touches Bible §§11, 14 and 17; donation behavior stays neutral to discovery §6.

## Evidence and reversibility

Implementation, tests, release and activation are recorded in the current
stabilization checkpoint. This decision alone closes no acceptance gate. The
prior design and changes remain in Git history and the dated September 30
amendment. The donations contract is separate and non-upgradeable; after
deployment a rule change requires a reviewed replacement deployment, not a
silent setter or storage change. Pausing the separate contract remains available
to its configured Safe. Successful donations are irreversible.
