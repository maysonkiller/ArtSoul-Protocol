# A8c Protocol Admin Review Runbook

Status: implementation review behind a disabled feature flag. The migration
has not been applied and this document is not authorization to activate it.

This slice implements A-22 under Canon A8. It changes no protocol economics,
contract behavior, auction lifecycle, ownership or wallet connection logic.

## Delivered surface

- `admin.html`: a dedicated protected review workspace.
- `moderation/access`: menu discovery only; it returns eligibility for the
  existing SIWE session but never complaint or audit data.
- `moderation/review-queue`: bounded complaint, hidden-artwork, event,
  moderation-log and notification-ledger reads.
- `moderation/review-action`: reasoned hide, dismiss, reopen and conditional
  restore transitions through one atomic database RPC.
- `a8c_protocol_admin_review.sql`: additive review fields, append-only reasons,
  private notification obligations and serialized per-artwork decisions.

Report state machine (all transitions require a reason):

- `pending_review` -> `actioned` (**hide**; hides the artwork) or
  `dismissed` (**dismiss**; unfounded claim).
- `actioned` -> `resolved` (**resolve/restore**). An actioned report is
  active and can never be reopened; reopening it would strand the artwork
  hidden with no active report.
- `dismissed` / `resolved` -> `pending_review` (**reopen**), rejected with
  `REPORT_ALREADY_PENDING` when the same reporter already has a newer
  pending report of the same category for the artwork.
- A valid complaint that was actioned closes as `resolved`, never
  `dismissed`; the reporter receives a `REPORT_RESOLVED` notification.
- `REPORT_RESTORED` (audit) and `ARTWORK_RESTORED` (creator notification)
  are emitted only when resolving the final actioned report actually flips
  the artwork from hidden to visible, read under the per-artwork lock. If
  another actioned report still hides it, or it was already visible, the
  event stays `REPORT_RESOLVED` and no creator notification is created.

The shared account dropdown contains no wallet allowlist and no client-owned
role. Discovery is lazy: the header render performs no access request; the
`/api/moderation/access` check runs when the account menu is first opened, at
most once per wallet per page lifetime, and the cached result is dropped when
the wallet or session changes. The dropdown adds `Protocol Admin` only after
the server confirms an active role for the current SIWE session. With
`ARTSOUL_PROTOCOL_ADMIN_ENABLED=false` the endpoint answers without any
staff-role lookup. Knowing or manually opening `admin.html` grants no
authority.

## Security invariants

Every protected read and action re-checks all three server-side factors:

1. valid SIWE wallet session;
2. active `artsoul_staff_roles` role;
3. valid 15-minute passkey step-up for the same wallet.

Complaint text is rendered as untrusted React text. Each report remains an
independent row and event chain even when the UI groups reports by artwork.
Transitions lock the report and serialize by artwork. A stale
`expected_updated_at` fails with a conflict instead of overwriting another
moderator; a reopen that would duplicate a pending report fails with
`REPORT_ALREADY_PENDING`. If multiple reports have actioned a hide, resolving
one report does not expose the artwork while another actioned report remains.

Review state, visibility, append-only decision evidence and notification
obligations are one transaction. A failed audit or notification insert rolls
the entire decision back. Notification rows are durable delivery obligations;
external delivery workers are out of this slice and must not be claimed as
delivered notifications.

Critical or irreversible actions are not added here and remain multisig-only.

## Environment (keep disabled before activation)

```text
ARTSOUL_MODERATION_PASSKEY_ENABLED=false
ARTSOUL_PROTOCOL_ADMIN_ENABLED=false
ARTSOUL_REPORTING_ENABLED=false
ARTSOUL_REPORT_DAILY_LIMIT=
```

When activation is authorized, also configure the exact final WebAuthn RP ID,
allowed origin, RP name and a dedicated moderation-session secret according to
`A8A_PASSKEY_FOUNDATION.md`. Never infer them from request headers.

## Migration and verification order

Follow `A8_MODERATION_ROLLOUT.md`; do not run A8c alone on production. After a
verified current Supabase backup, apply A8a, A8b and then A8c. Run:

1. `sql/verification/a8a_passkey_foundation_verification.sql`;
2. `sql/verification/a8b_artwork_report_intake_verification.sql`;
3. `sql/verification/a8c_protocol_admin_review_verification.sql`.

Retain exported results as operational evidence. Never paste service-role
keys, passkey tokens, session secrets or private staff assignments into the
repository or tickets.

## Activation order

1. Keep public reporting and Protocol Admin off.
2. Enable/configure A8a, issue the audited one-time bootstrap grant, and enroll
   two independent founder passkeys.
3. Enable Protocol Admin and verify direct-route denial, menu discovery,
   passkey expiry, queue reads, independent reports, concurrent conflicts,
   multi-report restore behavior and append-only evidence.
4. Only after the admin path is operational, configure the limit at `5` and
   enable the public Report flow for the controlled beta.

## Rollback

First set `ARTSOUL_REPORTING_ENABLED=false` and
`ARTSOUL_PROTOCOL_ADMIN_ENABLED=false`, then redeploy. This closes public
intake and staff UI immediately without deleting evidence. If passkey access
itself is suspect, also disable the passkey flag after reporting and admin are
off. Do not drop A8 tables, reports, events, visibility decisions or
notification obligations during rollback.

## Remaining resource gates

- final funded project domain and exact WebAuthn RP ID;
- two founder passkeys and one audited bootstrap grant;
- rehearsed Safe-only founder recovery;
- least-privilege moderator enrollment;
- production backup, migration evidence and controlled-beta acceptance.
