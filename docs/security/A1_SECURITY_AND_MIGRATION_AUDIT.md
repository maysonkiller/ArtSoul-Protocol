# Phase A1 Security And Migration Audit

Audit date: 2026-07-16

Scope: repository secret hygiene, authentication boundaries, server-only credentials, Supabase RLS, deployment headers, and database migration reproducibility. No contract, wallet-connect, auction, mint, economics, or UI behavior is changed by this audit.

## Result

Phase A1 is **code-ready but not operationally accepted**. The repository corrections are contained in this branch, but the founder/database operator must still complete the evidence checklist below. No SQL in this branch has been applied to production.

## Findings And Corrections

| Area | Evidence | Correction | Remaining operator evidence |
| --- | --- | --- | --- |
| Current-tree secrets | `.env.example` contains empty placeholders; browser configuration exposes only the public Supabase URL and anon key. The service-role key is read only by server modules. A file-name-only scan found no current private-key or service-role value. | Added an explicit API-origin variable example. No credential value was added or copied. | Run an approved secret scanner in CI as part of A4. |
| Historical secrets | `SECURITY_PUBLIC_READINESS_REPORT.md` records redacted findings in repository history. Current code cannot prove whether those values were real, rotated, or placeholders. | Preserved the historical report and added the attestation checklist below. | Confirm rotation/retirement for the Supabase service role, anon key, and any genuine deployer key. Decide whether history will be rewritten or retained after rotation. |
| SIWE request binding | The active Vercel route verified the recovered wallet and merely checked nonce availability. It did not bind the signed domain, URI, version, wallet line, or issued-at value to the request. Nonce read and update were two requests. The standalone API had the same weakness. | Validate the complete signed request boundary and consume the nonce with one conditional update. This removes the concurrent replay window without changing wallet-only sign-in semantics. | Deploy and complete one production sign-in smoke test on desktop and mobile. |
| Standalone API CORS | The optional Express API reflected every Origin while allowing credentials. | Require an exact configured origin, default to the production site, add private no-store defaults, and use a SameSite=Lax session cookie. | If this server is deployed separately, list every exact allowed origin in `API_ALLOWED_ORIGINS`. |
| Supabase RLS | Phase 18.7a covered public product tables but omitted several internal indexer, auth, moderation, queue, retry, reorg, and observability tables. Two older SQL files still grant direct authenticated writes and are unsafe for the current server-write architecture. | Added Phase 18.7b as a review-only migration: internal tables become service-role-only; product/projection tables remain direct-read-only; prior policies are removed deterministically. | Export the pre-change verification, review the classification, apply 18.7b manually, then export the post-change verification. |
| Migration path | SQL is split across three trees. The old JavaScript runner applied only migrations 004 and 005 while reporting success. One-off scripts bypassed checksums and a ledger. | The safe runner now enumerates the full indexer 001-013 chain, verifies continuity, uses an advisory lock, records SHA-256 checksums, and defaults to dry-run. | Production predates the ledger. Reconcile and attest the existing schema before any `--apply` run. Never use automatic adoption. |
| Deployment headers | Production had HSTS but lacked consistent nosniff, referrer, and frame policy. Auth/session responses could inherit public revalidation behavior. | Added global nosniff/referrer/frame headers and private no-store defaults for API routes. A CSP was intentionally not guessed because current AppKit/ESM imports require a measured policy first. | Verify headers on the deployed preview and production after merge. |

## Secret Rotation Attestation

Do not paste keys, tokens, seed phrases, or private-key material into this document, GitHub, chat, or an issue. Record only status, date, and the responsible person.

| Credential class | Required decision | Status |
| --- | --- | --- |
| Supabase service-role key | Rotated after historical exposure, or historical value proven to be a non-working placeholder | UNVERIFIED |
| Supabase anon/publishable key | Rotated, or deliberately retained only after Phase 18.7b verification proves read-only client access | UNVERIFIED |
| Deployer/private key | Wallet/key rotated if the historical value was genuine; otherwise record that it was a placeholder | UNVERIFIED |
| Session and OAuth secrets | Confirm present only in server environment variables and never in `NEXT_PUBLIC_*` | UNVERIFIED |
| Repository history | Record approved decision: rewritten/clean public history, or retained only after every genuine secret is rotated | UNVERIFIED |

## Production Read-Only Observation

Observed on 2026-07-16 without authentication or writes:

- `https://artsoul.vercel.app/` returned HTTP 200 and HSTS.
- `/api/public/config` returned only the public Supabase URL and anon key fields; no service-role field was present.
- `/api/auth/session` returned HTTP 200 but did not yet carry the new private no-store default because this branch was not deployed.

These observations do not prove database policy state or credential rotation.

## Acceptance Evidence

Phase A1 may be checked off only after all of the following are attached to a private operations record or a security issue that contains no secrets:

1. Completed rotation attestation above.
2. Pre-change export from `sql/verification/phase_a_security_verification.sql`.
3. Reviewed and manually applied Phase 18.7b transaction.
4. Post-change verification showing no unclassified application table, no disabled/unforced RLS table, no client write grant, and no client grant on an internal table.
5. Migration baseline ledger reconciliation for the live database.
6. Preview and production header smoke tests.
7. Desktop and mobile SIWE sign-in smoke tests.

## Canon Impact

None. This work enforces Phase A security boundaries. It does not amend architecture, economics, roles, lifecycle, Genesis, moderation mechanics, or chain policy.
