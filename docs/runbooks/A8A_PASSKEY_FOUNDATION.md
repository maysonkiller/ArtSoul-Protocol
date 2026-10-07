# A8a Moderation Passkey Foundation — Founder Runbook

Status updated October 3: schema applied and verified September 30; passkey setup
is enabled on the configured apex, while review/reporting activation and real
device acceptance remain separate gates. Do not repeat the migration steps
below. The founder authorizes the real ceremony; follow
`docs/RESOURCE_GATED_WORK.md` RG-03/RG-04 and the current A8 rollout order.

Founder decisions preserved (2026-07-20): 15-minute step-up sessions, two
independent founder passkeys before activation, one one-time auditable
bootstrap grant, Safe-only founder recovery, and X/Discord as eligibility/
profile data rather than authentication factors. A8d now implements the
Safe-only recovery foundation. Its migration is applied; configuration and the
founder ceremony remain uncompleted until recorded in the current checkpoint.

## 1. What ships in this phase

- Additive migration `sql/migrations/a8a_moderation_passkey_foundation.sql`
  (4 service-role-only tables + 4 atomic SECURITY DEFINER RPCs; no existing
  table or historical migration is changed).
- Read-only verification `sql/verification/a8a_passkey_foundation_verification.sql`.
- One-time bootstrap grant script `sql/runbooks/a8a_bootstrap_enrollment_grant.sql`.
- Server routes under `/api/moderation/passkey-*` and `/api/moderation/passkeys`,
  inert (404) while the flag is off.
- `getModerationAccess` step-up integration behind the flag.
- Staff passkey dialog in the Admin panel (WebAuthn browser helper is
  lazy-loaded only for eligible staff, never in the visitor bundle).

## 1a. First bootstrap and one-time enrollment codes

Founder amendment, October 3: first setup no longer requires manually transferring
a code when the server can resolve an existing approved bootstrap. The previous
rule required a raw one-time bearer token for every enrollment, so an otherwise
valid wallet/session without that token could not consume an approval. The new
exception deliberately removes that separate possession barrier for the first
approved bootstrap only.

- The user explicitly selects "Set up passkey" in Admin. Both registration
  requests use `mode: approved-bootstrap`; the server requires SIWE, an active
  staff role, exactly one live unused bootstrap for that wallet and its matching
  `grant_issued` audit. Any own historical credential or established bootstrap
  denies this path. No HTTP route creates or renews a bootstrap approval.
- The server binds the challenge to the exact grant and uses its stored hash
  internally with the unchanged atomic registration RPC. Neither the token,
  hash nor grant identifier is returned to the browser. Verification rechecks
  approval; expiration, revocation, supersession and replay fail closed.
- During that prior-approved grant window, the assigned wallet's authenticated
  session plus native passkey creation is sufficient. This is not equivalent
  to requiring independent bearer-code possession. Native user verification,
  RP/origin checks, two independent founder keys and Safe-only recovery remain.
- The legacy token path remains for additional-device and Safe recovery
  enrollment, and still accepts an operator-transferred bootstrap code.
- An already verified user can explicitly select "Add another passkey". This
  calls the existing self-grant route, holds the token only for the current
  browser operation, and passes it to registration without showing a code.
  Closing, changing wallets or losing authentication prevents later requests;
  cancellation does not automatically retry or revoke an already issued grant.
  The native chooser determines available device options. Use the advanced
  code-transfer method when enrolling from a separate browser instead.

- A grant stores ONLY the SHA-256 hash of a 256-bit random token; the raw
  token is displayed exactly once to the authorized issuer and never
  persisted or logged.
- In the token path, registration options AND verification require the raw token.
  The server re-derives the exact grant from the token hash, binds the
  WebAuthn challenge to that grant id, and (at verify) atomically consumes
  the grant + challenge and inserts the credential in one transaction.
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

Self-revocation refuses to revoke a wallet's LAST active credential
(`LAST_ACTIVE_CREDENTIAL`, audited
as `passkey_revoke_denied`, no state change). A wallet with two or more
active credentials may revoke one after a valid step-up. A8d recovery does
not weaken this normal-operation safeguard.

## 2. Environment variables (do NOT set in this PR)

| Variable | Meaning |
| --- | --- |
| `ARTSOUL_MODERATION_PASSKEY_ENABLED` | `true` enables the passkey requirement. Default/absent = disabled = exact current production behavior. |
| `ARTSOUL_WEBAUTHN_RP_ID` | Final production domain (RP ID). Never inferred from request headers. |
| `ARTSOUL_WEBAUTHN_ALLOWED_ORIGIN` | Exact allowed origin, e.g. `https://<final-domain>`. |
| `ARTSOUL_WEBAUTHN_RP_NAME` | Human-readable RP display name. |
| `ARTSOUL_MODERATION_SESSION_SECRET` | Dedicated HMAC secret for the 15-minute moderation cookie. Separate from `SESSION_SECRET`. |

Safe recovery adds three more variables and a separate reviewed ceremony.
See `docs/runbooks/A8D_SAFE_RECOVERY.md`; leave them unset until A8d has been
migrated and rehearsed.

With the flag `true` and ANY of the other four missing, every moderation
request fails closed (503 `MODERATION_PASSKEY_MISCONFIGURED`) — there is no
silent fallback to the legacy path.

## 3. Migration application (historical procedure; already applied)

1. Take and verify a Supabase backup (same procedure as phase 18.7b/014).
2. Run `sql/migrations/a8a_moderation_passkey_foundation.sql` with the
   service role. A8d recovery, if included in the same reviewed rollout, is
   applied only afterward using its separate additive migration.
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
   one-time token exactly once in the result; only its hash is stored. Manual
   transfer is unnecessary for approved first setup. Copy it only if the legacy
   token path is deliberately used; never place it in logs or shared reports.
   - SAFE RETRY: if a previous bootstrap grant EXPIRED UNUSED, re-running
     supersedes it (auditable `grant_superseded`) and issues a fresh token,
     so an expired row never permanently locks the founder out. An ACTIVE
     unexpired bootstrap grant raises `A8A_ACTIVE_BOOTSTRAP_EXISTS`. Once any
     bootstrap grant is consumed or a bootstrap credential exists, it raises
     `A8A_BOOTSTRAP_ALREADY_ESTABLISHED` and no further bootstrap is possible.
4. On the configured origin with the passkey flag enabled, sign in with the
   assigned founder wallet and open Admin from the account menu. Choose "Set up
   passkey" and confirm native creation on the device, then "Verify passkey".
   Setup consumes the existing bootstrap grant and writes `grant_consumed` +
   `passkey_enrolled` audit events; it does not issue a moderation session.
   If approval is absent or expired, an authorized operator must separately
   follow the audited issuance/supersession procedure. Repeated setup clicks
   cannot issue or renew approval. An intentionally transferred legacy code may
   instead be entered under "Advanced: another device or recovery code".
   Use non-production credentials for the preliminary staging rehearsal. Final
   acceptance requires enrollment and verification on the approved apex RP ID
   and origin; a passkey enrolled for a preview domain is not evidence of this.
5. Enroll the SECOND independent founder passkey after verification. Select
   "Add another passkey" and choose an independent device or security key if
   offered by the native chooser. This uses the existing self-grant route and
   token authorization internally. Alternatively, create a self-grant in the
   advanced section, copy its once-displayed code to the second device's Admin
   panel, and enroll within the grant window. Verify both independent keys.
   A new credential count alone does not prove device independence. First setup
   cannot replace this second-device gate.

## 5. Activation checklist (all required, separately reviewed)

- [ ] Final production domain / RP ID is live (RG-03, C-02).
- [ ] Migration applied and verification output archived.
- [ ] Two founder passkeys enrolled and both verified.
- [ ] One-time bootstrap grant consumed and audit-recorded.
- [ ] A8d migration applied, read-only verification archived, and Safe-only
      founder recovery rehearsed against the configured Safe and two RPCs.
- [ ] `ARTSOUL_MODERATION_SESSION_SECRET` generated and stored server-side only.
- [ ] Flag enabled through a reviewed deployment; legacy social-factor path
      removed in the same review.

## 6. Recovery position

A8d provides the disabled Safe-only foundation described in
`docs/runbooks/A8D_SAFE_RECOVERY.md`. It remains unavailable until the A8a and
A8d migrations, complete server configuration, production-equivalent Safe
rehearsal, and reviewed feature activation are complete. Do not create ad-hoc
grants to bypass a lost passkey outside that documented ceremony.
