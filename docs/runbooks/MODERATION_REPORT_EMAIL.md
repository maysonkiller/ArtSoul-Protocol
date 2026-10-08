# Complaint email delivery

Status: code published in PR #292; the exact delivery migration was applied and
verified on October 8. The separately authorized host worker is now configured,
enabled and scheduled. A real transport test reached the project inbox; repeating
its exact idempotency key produced only one delivered message. Actual complaint
UI-to-queue-to-inbox acceptance remains open. See the dated ledger and checkpoint.
This extends A8 notifications without changing complaint decisions or access.

The existing `REPORT_SUBMITTED` event is the durable source. The scheduled worker
is the only email delivery path. Intake returns immediately after the atomic
report commit, without claiming delivery or contacting the provider; email
latency or an outage cannot delay or fail a recorded report's response.
Mail contains only its reference and a link to the protected Admin panel. It
contains no reporter identity, complaint text, attachments or evidence.

## Observed host activation, October 8

- Host: `artsoul-indexer`; source `/opt/artsoul` at
  `5529973e41b29ca6ed62662c2e8fae17242bda2f`. The Base indexer was not restarted.
- Root-only configuration: `/etc/artsoul/report-email.env`, owner root, mode 0600.
  The owner separately approved placing the existing Supabase service-role key
  on this host. Its broad database access remains a server secret, never a browser
  credential. Transport was encrypted; no secret is stored in this runbook.
- A separate Resend sending-only key is restricted to `notify.artsoulprotocol.com`.
  The existing website verification key remains intact. Sender is
  `ArtSoul <notifications@notify.artsoulprotocol.com>` and the sole configured
  recipient is `artsoulprotocol@gmail.com`.
- `artsoul-report-email.service` runs the existing script as a systemd oneshot
  with a 120-second timeout, UMask 0077, NoNewPrivileges, PrivateTmp,
  ProtectSystem=strict and ProtectHome. The environment comes only from the
  restricted file; no secret is passed in the command line.
- `artsoul-report-email.timer` is enabled with OnBootSec=30s,
  OnUnitInactiveSec=60s and AccuracySec=5s. There is at most one running instance
  of this unit; each invocation processes at most three emails. The interval
  starts after completion, so it is not an exact delivery-time guarantee.
- Three initial runs exited successfully with zero pending records or failures.
  The real `sendProductEmail` transport test and one exact-key retry resulted in
  one delivered Resend event, confirmed in the project Gmail inbox. Do not replay
  the completed test merely because this task resumes.
- Private evidence: `docs/private/moderation-mail-worker-acceptance-2026-10-08.json`.
  Inbox screenshot: `output/audit/moderation-mail-real-inbox-2026-10-08.png`.
  No report was fabricated. Public Report/Admin/Donate flags remain disabled.

The project mailbox now has accepted Admin access to the existing Resend team
and its two existing verified domains. After separate explicit approval, the
personal membership was removed and the project mailbox became the sole Admin.
All five existing keys remained. Removal evidence:
`output/audit/resend-personal-access-removed-2026-10-08.png`. This is team access migration,
not a claim that Google account recovery/security settings have been changed.

## Configuration and activation

1. Follow `../security/MIGRATION_RUNBOOK.md`: inspect the live catalog, retain a
   validated backup and review the exact checksum of
   `sql/migrations/moderation_report_email_delivery.sql`. Apply once only after
   authorization and verify RLS, privileges and all three RPCs. Do not replay
   historical A8 migrations or modify their applied checksums.
2. Configure the server-only `ARTSOUL_EMAIL_API_KEY`, `ARTSOUL_EMAIL_FROM` and
   `ARTSOUL_PUBLIC_ORIGIN`. Use a separate domain-scoped sending key for this
   host, as recorded above. Configure `ARTSOUL_MODERATION_ALERT_EMAIL` with the
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

To pause scheduled mail, run `systemctl disable --now artsoul-report-email.timer`.
Check `systemctl status artsoul-report-email.service` for an already running
batch; stopping the timer does not cancel it or retract an accepted email.
Disable the email flag in the protected configuration before any further manual
run. Preserve delivery state and
report events so a restart cannot blindly replay accepted mail. Reporting and
moderation have separate gates and remain governed by the A8 rollout runbook.
