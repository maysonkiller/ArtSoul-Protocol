# A8a Moderation Passkey Foundation — Founder Runbook

Status: development complete behind a DISABLED feature flag. Nothing in this
runbook has been applied to production. Follow `docs/RESOURCE_GATED_WORK.md`
RG-03/RG-04 for the activation gates.

Founder decisions preserved (2026-07-20): 15-minute step-up sessions, two
independent founder passkeys before activation, one one-time auditable
bootstrap grant, Safe-only founder recovery (fails closed until built),
X/Discord are eligibility/profile data and never authentication factors.

## 1. What ships in this phase

- Additive migration `sql/migrations/a8a_moderation_passkey_foundation.sql`
  (4 service-role-only tables; no existing table is changed).
- Read-only verification `sql/verification/a8a_passkey_foundation_verification.sql`.
- One-time bootstrap grant script `sql/runbooks/a8a_bootstrap_enrollment_grant.sql`.
- Server routes under `/api/moderation/passkey-*` and `/api/moderation/passkeys`,
  inert (404) while the flag is off.
- `getModerationAccess` step-up integration behind the flag.
- Minimal staff passkey UI on the artwork page.

## 2. Environment variables (do NOT set in this PR)

| Variable | Meaning |
| --- | --- |
| `ARTSOUL_MODERATION_PASSKEY_ENABLED` | `true` enables the passkey requirement. Default/absent = disabled = exact current production behavior. |
| `ARTSOUL_WEBAUTHN_RP_ID` | Final production domain (RP ID). Never inferred from request headers. |
| `ARTSOUL_WEBAUTHN_ALLOWED_ORIGIN` | Exact allowed origin, e.g. `https://<final-domain>`. |
| `ARTSOUL_WEBAUTHN_RP_NAME` | Human-readable RP display name. |
| `ARTSOUL_MODERATION_SESSION_SECRET` | Dedicated HMAC secret for the 15-minute moderation cookie. Separate from `SESSION_SECRET`. |

With the flag `true` and ANY of the other four missing, every moderation
request fails closed (503 `MODERATION_PASSKEY_MISCONFIGURED`) — there is no
silent fallback to the legacy path.

## 3. Migration application (founder-operated, NOT done yet)

1. Take and verify a Supabase backup (same procedure as phase 18.7b/014).
2. Run `sql/migrations/a8a_moderation_passkey_foundation.sql` with the
   service role.
3. Run `sql/verification/a8a_passkey_foundation_verification.sql` and check:
   4 tables, RLS enabled AND forced on all 4, zero anon/authenticated
   grants, the single-bootstrap unique index present, zero IP/user-agent
   columns, `bootstrap_grants = 0`.
4. Record the application in the migration ledger per A-02 practice.

Optional local Docker rehearsal (recommended, mirrors the migration-014
PostgreSQL check): start a disposable PostgreSQL 17 container, apply the
migration, run the verification file, and discard the container. The
repository CI intentionally does not run a database service.

## 4. Bootstrap enrollment (one time only)

1. Ensure the founder wallet has an active `artsoul_staff_roles` row.
2. Edit `sql/runbooks/a8a_bootstrap_enrollment_grant.sql`: set
   `:founder_wallet` (lowercase) and `:ttl_minutes` (tunable window).
3. Run it once with the service role. The grant and its `grant_issued`
   audit event are one transaction; a second run fails on the
   single-bootstrap unique index.
4. On the staging origin with the flag enabled, open an artwork page with
   the founder wallet, use "Enroll passkey (grant required)", then
   "Verify passkey". This consumes the bootstrap grant and writes
   `grant_consumed` + `passkey_enrolled` audit events.
5. Enroll the SECOND founder passkey from the new device: on the already
   verified device issue a self-grant (`/api/moderation/passkey-grant`,
   requires the active step-up), then enroll on the second device within
   the grant window.

## 5. Activation checklist (all required, separately reviewed)

- [ ] Final production domain / RP ID is live (RG-03, C-02).
- [ ] Migration applied and verification output archived.
- [ ] Two founder passkeys enrolled and both verified.
- [ ] One-time bootstrap grant consumed and audit-recorded.
- [ ] Safe-only founder recovery implemented AND rehearsed (future PR;
      until then `/api/moderation/passkey-recovery` always denies).
- [ ] `ARTSOUL_MODERATION_SESSION_SECRET` generated and stored server-side only.
- [ ] Flag enabled through a reviewed deployment; legacy social-factor path
      removed in the same review.

## 6. Recovery position

There is NO recovery path in this phase. Lost-passkey recovery requires the
future Safe-authorized ceremony; the recovery endpoint fails closed and
audit-logs every attempt (`recovery_denied`). Do not create ad-hoc grants
to bypass a lost passkey outside a rehearsed, documented ceremony.
