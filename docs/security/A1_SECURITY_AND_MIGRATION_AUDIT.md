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
| Supabase Storage RLS (`storage.objects`, `artworks` bucket) | The production read-only verification found dashboard-created policies that no tracked SQL represented: three duplicate public SELECT policies (`Anyone can view artworks`, `Public Access for artworks`, `Public can view`) and direct client write policies (`Authenticated can upload to artworks`, `Authenticated users can upload`, `Authenticated users can upload to artworks`, `Users can update own files in artworks`, `Users can delete own files in artworks`). The write policies check only the bucket and the authenticated role; they do not enforce per-wallet ownership or a wallet-scoped path, so any authenticated client can write, overwrite, or delete objects directly, bypassing server validation. The active app upload path (`src/api/routes/upload/file.js`, `src/api/backend.js`) uses server-created signed upload URLs with the service_role key and does not depend on these client policies. | Added Phase 18.7c as a separate review-only migration: drop the duplicate SELECT policies and all direct anon/authenticated/public INSERT/UPDATE/DELETE policies for the artworks bucket, retain exactly one canonical public SELECT policy (`artsoul_artworks_public_read`), and leave the signed server-side upload flow untouched. | Export the pre-change storage verification (section 8), review, apply 18.7c manually, export the post-change verification (write_policies = 0, select_policies = 1), and smoke-test a signed upload and a public read. |
| Supabase Storage bucket guardrails | The production `artworks` bucket is public, but both `file_size_limit` and `allowed_mime_types` are unset. The signing route validates the declared size and MIME type, but bucket-level limits are still required as defense in depth for the signed upload itself. | The runbook now defines the exact bucket settings matching the application boundary: 100 MB and the media/metadata MIME allowlist already accepted by `src/api/routes/upload/file.js`. Phase 18.7c intentionally does not mutate Supabase-managed bucket tables directly. | Set the bucket restrictions through the Supabase Storage dashboard or supported bucket API, re-run verification section 8, then smoke-test media and metadata uploads. |
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

### Production RLS verification status (pre-change audit complete)

The complete verification file was run directly against production on 2026-07-16 inside an explicit read-only transaction with a statement timeout and mandatory rollback. No schema, data, policy, grant, function, or Storage setting was changed.

| Check | Pre-change result | Interpretation |
| --- | --- | --- |
| Unclassified public tables | 0 | Every current application-owned public table is covered by the Phase 18.7b classification. |
| RLS disabled or not forced | 37, all with RLS enabled and `FORCE ROW LEVEL SECURITY` absent | Phase 18.7b is still required to force RLS consistently. |
| Client non-SELECT grants | 0 | No direct table write grant was found for `anon` or `authenticated`. |
| Client grants on internal tables | 0 | No direct client access to the classified internal tables was found. |
| Public read policies | 7 SELECT-only policies | Public client access is currently read-only at the table-policy layer. |
| Client-executable `SECURITY DEFINER` functions | 0 | The one observed security-definer moderation function is not executable by `anon` or `authenticated` and fixes `search_path` to `public`. |
| Migration ledger | Missing | Production predates `artsoul_schema_migrations`; baseline reconciliation remains mandatory and must not be guessed. |
| Required schema objects | Present | `siwe_nonces`, `artsoul_staff_roles`, `artwork_moderation_visibility`, and the checked V4.1 projection tables exist. |
| `artworks` bucket | Public; size and MIME restrictions unset | Existing objects remain publicly readable, but bucket-level upload guardrails must be configured. |
| `artworks` Storage policies | 3 SELECT policies and 5 direct client write policies | Phase 18.7c is required before Phase A1 can be accepted. |

This is sufficient evidence to review and merge the repository changes, but not to mark Phase A1 operationally complete. Manual application, post-change verification, baseline reconciliation, secret-rotation attestation, and smoke tests remain outstanding.

## Acceptance Evidence

Phase A1 may be checked off only after all of the following are attached to a private operations record or a security issue that contains no secrets:

1. Completed rotation attestation above.
2. Pre-change export from `sql/verification/phase_a_security_verification.sql`, including the storage section 8/8a-8d grids.
3. Reviewed and manually applied Phase 18.7b transaction.
4. Reviewed and manually applied Phase 18.7c storage transaction.
5. Post-change verification showing no unclassified application table, no disabled/unforced RLS table, no client write grant, no client grant on an internal table, and for the artworks bucket write_policies = 0 with select_policies = 1.
6. Bucket verification showing `file_size_limit = 104857600` and the reviewed MIME allowlist from the migration runbook.
7. Migration baseline ledger reconciliation for the live database.
8. Preview and production header smoke tests.
9. Desktop and mobile SIWE sign-in smoke tests, plus signed media upload, signed metadata upload, and public-read smoke tests after 18.7c.

## Canon Impact

None. This work enforces Phase A security boundaries. It does not amend architecture, economics, roles, lifecycle, Genesis, moderation mechanics, or chain policy.
