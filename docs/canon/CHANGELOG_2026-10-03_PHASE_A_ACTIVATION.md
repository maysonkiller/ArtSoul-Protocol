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
