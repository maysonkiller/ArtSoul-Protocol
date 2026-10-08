# Complaint email delivery

Status: code published in PR #292; the exact delivery migration was applied and
verified on October 8. Delivery remains disabled and unscheduled; actual complaint
email acceptance has not passed. See the dated migration ledger and checkpoint.
This extends A8 notifications without changing complaint decisions or access.

The existing `REPORT_SUBMITTED` event is the durable source. The scheduled worker
is the only email delivery path. Intake returns immediately after the atomic
report commit, without claiming delivery or contacting the provider; email
latency or an outage cannot delay or fail a recorded report's response.
Mail contains only its reference and a link to the protected Admin panel. It
contains no reporter identity, complaint text, attachments or evidence.

## Configuration and activation

1. Follow `../security/MIGRATION_RUNBOOK.md`: inspect the live catalog, retain a
   validated backup and review the exact checksum of
   `sql/migrations/moderation_report_email_delivery.sql`. Apply once only after
   authorization and verify RLS, privileges and all three RPCs. Do not replay
   historical A8 migrations or modify their applied checksums.
2. Use the existing server-only `ARTSOUL_EMAIL_API_KEY`, `ARTSOUL_EMAIL_FROM` and
   `ARTSOUL_PUBLIC_ORIGIN`. Configure `ARTSOUL_MODERATION_ALERT_EMAIL` with the
   approved staff mailbox. No browser or report payload chooses the recipient.
3. Enable `ARTSOUL_MODERATION_EMAIL_ENABLED=true` only after the schema and
   provider checks pass. It does not enable Report or the moderation queue.
4. Configure the existing operator scheduler to run
   `node scripts/deliver-report-emails.mjs` regularly with the same protected
   server settings. Each invocation attempts at most three records. Record the
   actual schedule, host revision and successful runs; an unscheduled script
   does not send initial notifications or retry them. New-report email latency
   depends on this schedule and pending workload. Do not put secrets in command
   arguments, Git or logs.
5. Submit an explicitly authorized test report through the real UI. Verify the
   report reference, staff notification, email-provider event and actual inbox
   delivery. Provider acceptance alone is not proof of delivery. Verify a retry
   does not create another email, then record evidence and remaining gates.

## Retries and operator review

Concurrent attempts use a database lease and an attempt token. The same report
uses the same provider idempotency key and exact payload. Resend documents a
[24-hour retention window](https://resend.com/docs/dashboard/emails/idempotency-keys);
automatic retries stop conservatively after 23 hours. Changed recipient, sender
or content also requires operator review rather than a new send.

The worker reports aggregate counts only. Inspect `needs_review` explicitly
through an authorized server/database session; it is excluded from automatic
batches. Compare the report reference with provider records and the intended
mailbox before deciding whether delivery is missing. Never reset or delete a
claim just to resend, and never equate `accepted` with `delivered`. Any manual
resolution requires an audited, case-specific action; this worker provides no
automatic override of the retry window.

To pause email, disable its flag and scheduler. Preserve delivery state and
report events so a restart cannot blindly replay accepted mail. Reporting and
moderation have separate gates and remain governed by the A8 rollout runbook.
