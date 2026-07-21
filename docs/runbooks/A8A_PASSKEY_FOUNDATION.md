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
  (4 service-role-only tables + 4 atomic SECURITY DEFINER RPCs; no existing
  table or historical migration is changed).
- Read-only verification `sql/verification/a8a_passkey_foundation_verification.sql`.
- One-time bootstrap grant script `sql/runbooks/a8a_bootstrap_enrollment_grant.sql`.
- Server routes under `/api/moderation/passkey-*` and `/api/moderation/passkeys`,
  inert (404) while the flag is off.
- `getModerationAccess` step-up integration behind the flag.
- Minimal staff passkey UI on the artwork page (WebAuthn browser helper is
  lazy-loaded only for eligible staff, never in the visitor bundle).

## 1a. One-time enrollment token transfer

Enrollment now proves **possession of a one-time bearer token**, not just
wallet ownership. A stolen wallet without the token cannot enroll a device.

- A grant stores ONLY the SHA-256 hash of a 256-bit random token; the raw
  token is displayed exactly once to the authorized issuer and never
  persisted or logged.
- Registration options AND registration verify both require the raw token.
  The server re-derives the exact grant from the token hash, binds the
  WebAuthn challenge to that grant id, and (at verify) atomically consumes
  the grant + challenge and inserts the credential in one transaction.
- Bootstrap and additional-device enrollment use the same possession rule.
- The additional-device self-grant route returns its raw token once in the
  JSON response; the operator copies it to the second device.

## 1b. Atomic RPC boundaries

Every successful state transition is one PostgreSQL transaction via a
SECURITY DEFINER RPC (fixed `search_path`, execute granted to `service_role`
only, revoked from PUBLIC/anon/authenticated). A failed credential or audit
insert rolls the whole operation back, so the one-time bootstrap grant is
never lost on a partial failure, a registration retry can never create two
credentials or consume two grants, and revocation/authentication state and
their audit rows always move together:

- `a8a_complete_registration` — validate+consume the exact grant and its
  bound challenge, insert the credential, write `grant_consumed` +
  `passkey_enrolled`.
- `a8a_issue_enrollment_grant` — insert grant + `grant_issued` (with safe
  bootstrap retry, below).
- `a8a_revoke_credential` — last-key protection + revoke + `passkey_revoked`.
- `a8a_complete_authentication` — reject a stale counter (allowing a
  zero-counter authenticator), advance `sign_count`/`last_used_at`, write
  `passkey_auth_success`.

## 1c. Last-passkey protection

Because Safe recovery is not implemented yet, self-revocation refuses to
revoke a wallet's LAST active credential (`LAST_ACTIVE_CREDENTIAL`, audited
as `passkey_revoke_denied`, no state change). A wallet with two or more
active credentials may revoke one after a valid step-up.

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
   grants, the active-bootstrap partial unique index present, the four RPCs
   present as SECURITY DEFINER with a pinned `search_path` and service-role-
   only execute, no raw-token column, zero IP/user-agent columns,
   `active_bootstrap <= 1`.
4. Record the application in the migration ledger per A-02 practice.

Historical-migration immutability: `phase18_7b_supabase_security_hardening.sql`
was already applied to production and MUST remain byte-identical to `main`.
The A8a tables and grants are self-hardened inline in the A8a migration; do
not edit any historical migration. A regression test enforces this.

Local Docker rehearsal (mirrors the migration-014 PostgreSQL 17 check and is
automated in `test/a8a-passkey-rpc-integration.test.cjs`): start a disposable
PostgreSQL 17 container, apply the migration, exercise the RPC atomicity /
last-key / bootstrap / counter invariants, then discard the container. It
self-skips when Docker is unavailable.

## 4. Bootstrap enrollment (one time only)

1. Ensure the founder wallet has an active `artsoul_staff_roles` row.
2. Edit `sql/runbooks/a8a_bootstrap_enrollment_grant.sql`: set
   `:founder_wallet` (lowercase) and `:ttl_minutes` (tunable window).
3. Run it once with the service role. It calls `a8a_issue_enrollment_grant`
   (grant + `grant_issued` audit in one transaction) and DISPLAYS the raw
   one-time token exactly once in the result — copy it immediately; only its
   hash is stored.
   - SAFE RETRY: if a previous bootstrap grant EXPIRED UNUSED, re-running
     supersedes it (auditable `grant_superseded`) and issues a fresh token,
     so an expired row never permanently locks the founder out. An ACTIVE
     unexpired bootstrap grant raises `A8A_ACTIVE_BOOTSTRAP_EXISTS`. Once any
     bootstrap grant is consumed or a bootstrap credential exists, it raises
     `A8A_BOOTSTRAP_ALREADY_ESTABLISHED` and no further bootstrap is possible.
4. On the staging origin with the flag enabled, open an artwork page with
   the founder wallet, use "Enroll passkey (grant required)", paste the raw
   token, then "Verify passkey". This consumes the bootstrap grant and writes
   `grant_consumed` + `passkey_enrolled` audit events.
5. Enroll the SECOND founder passkey from the new device: on the already
   verified device issue a self-grant (`/api/moderation/passkey-grant`,
   requires the active step-up), which returns a fresh raw token once; paste
   it on the second device and enroll within the grant window.

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
