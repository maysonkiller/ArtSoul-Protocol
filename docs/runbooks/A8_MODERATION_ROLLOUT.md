# A8 Moderation Rollout Order

Status: implementation and activation plan. This runbook coordinates the
already-merged A8a and A8b foundations with the remaining A-22 staff workflow.
It does not amend protocol architecture or economics.

## 1. Build now, behind disabled flags

Complete A-22 without exposing production authority:

1. Add a dedicated Protocol Admin page for the reports queue, hidden-content
   review, notifications and append-only action history.
2. Add a `Protocol Admin` item to the shared account dropdown only after the
   server confirms an active staff role for the current SIWE wallet.
3. Require the A8a passkey step-up before the page returns protected data or
   accepts a moderation action. The step-up session remains 15 minutes.
4. Re-check SIWE, active staff role and passkey step-up on every protected API
   request. A hidden link, route name or client-side flag is never an
   authorization boundary.
5. Group related complaints only for queue presentation. Preserve every
   reporter's independent report and event record.
6. Keep critical or irreversible actions behind the approved multisig path.
7. Add deterministic concurrent status transitions, stable client errors,
   untrusted-text rendering, keyboard focus trapping and integration tests.

The public Report button and all staff authority remain disabled throughout
this stage.

## 2. Satisfy the resource gates

Before production activation:

1. Connect and verify the final project domain and WebAuthn RP ID.
2. Configure and rehearse the Safe-only founder recovery path.
3. Prepare the reviewed A8a, A8b and A8c migrations. Passkey enrollment and
   feature activation happen only in the ordered deployment stage below.
4. Assign each moderator an active least-privilege role and an individually
   enrolled passkey. Do not store private staff wallet assignments in source.

These steps follow `RESOURCE_GATED_WORK.md` and
`runbooks/A8A_PASSKEY_FOUNDATION.md`.

## 3. Activate the database and deployment

Only after the Protocol Admin workflow is operational:

1. Take and verify a current Supabase backup.
2. Apply, in order, `sql/migrations/a8a_moderation_passkey_foundation.sql`,
   `sql/migrations/a8b_artwork_report_intake.sql`, and
   `sql/migrations/a8c_protocol_admin_review.sql`.
3. Run the matching read-only A8a, A8b and A8c verification files and retain
   the evidence.
4. Configure the final RP ID/origin/name and dedicated moderation-session
   secret. Enable only the passkey flag, create the one-time auditable
   bootstrap grant, and enrol the two independent founder passkeys.
5. Enable `ARTSOUL_PROTOCOL_ADMIN_ENABLED=true`, redeploy, and complete the
   protected admin acceptance checklist while public reporting remains off.
6. Set `ARTSOUL_REPORT_DAILY_LIMIT=5` and only then enable
   `ARTSOUL_REPORTING_ENABLED=true` for the controlled beta.
7. Redeploy and allow the public-config cache to expire.

Five new reports per reporter wallet across a rolling 24-hour window is the
approved controlled-beta starting value. It may be tuned later from observed
queue volume without changing protocol economics.

## 4. Production acceptance

Verify all of the following before declaring A8 complete:

- ordinary and disconnected users never see the Protocol Admin entry;
- manually adding the entry in browser tools grants no access;
- an eligible staff wallet sees the entry only after server role confirmation;
- the admin page exposes no protected data before passkey step-up;
- the 15-minute step-up expires and requires re-verification;
- the same wallet/artwork/category pending complaint deduplicates to one report
  and one event;
- two different reporter wallets create two independent reports and events;
- the sixth new report from one wallet inside 24 hours returns HTTP 429;
- report submission alone never hides an artwork;
- valid-claim hide/unhide decisions create immutable staff audit evidence;
- concurrent staff decisions resolve deterministically without lost history;
- notification failures do not corrupt the review decision;
- disabling any relevant feature flag fails closed and preserves stored evidence.
- resolving one of several actioned reports does not expose the artwork until
  the last actioned report for that artwork is resolved.

## 5. After controlled-beta observation

Review queue volume, duplicate patterns, false reports and response time. Keep
the limit at five unless observed evidence supports a change. Any new abuse
control must preserve privacy, individual report evidence and the rule that
submission count never determines a moderation outcome.
