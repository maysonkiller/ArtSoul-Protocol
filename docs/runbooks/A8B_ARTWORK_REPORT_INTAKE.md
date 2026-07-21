# A8b Artwork Report Intake — Founder Runbook

Status: implemented behind a DISABLED feature flag. The migration has not
been applied to production and the public Report control must remain hidden
until the database verification in this runbook passes.

This slice covers backlog A-21 only: wallet-authenticated public complaint
intake and its immutable submission event. Staff review, notifications,
valid-claim hide actions, and the review/audit UI remain A-22.

## 1. What ships

- Additive migration `sql/migrations/a8b_artwork_report_intake.sql`:
  `artwork_reports`, append-only `artwork_report_events`, and the atomic
  `submit_artwork_report(...)` RPC.
- Read-only verification
  `sql/verification/a8b_artwork_report_intake_verification.sql`.
- `POST /api/moderation/reports`, authenticated through the existing SIWE
  wallet session and unavailable while the feature flag is off.
- An accessible Report dialog on indexed Base Sepolia and readable legacy
  Ethereum Sepolia artwork pages. Submitting a report does not hide an
  artwork, change ownership, or perform any wallet/contract write.

Complaint text, reporter wallets, and report events are service-role-only.
The browser receives only the report reference and status for its own
submission.

## 2. Environment variable

| Variable | Meaning |
| --- | --- |
| `ARTSOUL_REPORTING_ENABLED` | `true` enables the public button and API. Default/absent = button hidden and API fails closed with `REPORTING_DISABLED`. |
| `ARTSOUL_REPORT_DAILY_LIMIT` | Required positive integer limiting newly stored reports per wallet across the rolling previous 24 hours. The approved controlled-beta starting value is `5`; it remains explicit rather than a code default. Missing/invalid = button hidden and API fails closed. |

Do not set the flag without an explicit daily limit or before applying and verifying the migration. Public
configuration is cached for up to five minutes, so allow for cache expiry
after changing the flag or redeploying.

## 3. Production activation (founder-operated)

1. Take and verify a current Supabase backup.
2. Keep `ARTSOUL_REPORTING_ENABLED` absent or `false` in Production and
   Preview.
3. In Supabase SQL Editor, run only
   `sql/migrations/a8b_artwork_report_intake.sql`.
4. Run the read-only file
   `sql/verification/a8b_artwork_report_intake_verification.sql`.
5. Confirm its expected results:
   - both tables exist;
   - RLS is enabled and forced on both tables;
   - anon/authenticated have no table or RPC privileges;
   - the RPC is SECURITY DEFINER with a pinned `search_path`;
   - the pending-report uniqueness index exists;
   - the event foreign key uses `ON DELETE RESTRICT`;
   - report and event counts are initially zero unless a controlled test was
     already submitted.
6. Record the migration application using the repository's A-02 evidence
   practice.
7. Set the approved controlled-beta value
   `ARTSOUL_REPORT_DAILY_LIMIT=5` and
   `ARTSOUL_REPORTING_ENABLED=true` for the intended Vercel environment, then
   redeploy. The public button remains hidden if either setting is missing.
   Any later limit change requires observed queue-volume evidence and an
   update to this runbook; it is operational tuning, not protocol economics.
8. Verify one controlled submission:
   - open an indexed artwork and select Report;
   - connect and complete SIWE;
   - submit a good-faith test report;
   - confirm an opaque reference is shown;
   - submit the same category again and confirm it is deduplicated;
   - confirm the artwork is still visible (submission alone never hides it).

## 4. Rollback / emergency disable

Set `ARTSOUL_REPORTING_ENABLED=false` and redeploy. This immediately closes
the API and hides the button after public-config cache expiry. Do not drop
the tables or delete reports: the complaint record and submission audit data
must remain durable. Database removal, if ever required, needs a separately
reviewed data-retention decision and migration.

## 5. Privacy and abuse boundaries

- The form does not request email, legal name, IP address, or social handles.
- Supporting links are stored but never fetched by the server.
- A pending report is deduplicated per wallet, artwork, and category.
- The database serializes each reporter wallet and enforces the configured
  rolling 24-hour intake cap before storing a new report.
- A-22 must render all stored text as untrusted content, add queue-level abuse
  controls beyond the intake cap, and preserve append-only staff action evidence.
- A valid claim and authorized staff review—not submission volume—determine
  whether an artwork is hidden.
