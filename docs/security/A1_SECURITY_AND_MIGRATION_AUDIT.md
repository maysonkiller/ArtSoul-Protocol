# Phase A1 Security And Migration Audit

Initial audit date: 2026-07-16

Last evidence update: 2026-07-26

Scope: repository secret hygiene, authentication boundaries, server-only credentials, Supabase RLS, deployment headers, and database migration reproducibility. No contract, wallet-connect, auction, mint, economics, or UI behavior is changed by this audit.

## Result

Phase A1 is **partially operationally accepted**. The repository corrections are merged, the reviewed Phase 18.7b and 18.7c transactions were applied to production on 2026-07-17 after a verified full and schema-only backup, and Storage bucket guardrails were applied on 2026-07-18. The 2026-07-26 follow-up verified the official repository secret-scanning boundary, preview/production response headers, and a post-hardening desktop SIWE plus signed media/metadata upload and public-read path. The remaining acceptance work is a production mobile SIWE smoke test, authenticated negative upload-policy checks, and the private secret-rotation/deployment-environment attestation.

## Findings And Corrections

| Area | Evidence | Correction | Remaining operator evidence |
| --- | --- | --- | --- |
| Current-tree secrets | `.env.example` contains empty placeholders; browser configuration exposes only the public Supabase URL and anon key. The service-role key is read only by server modules. On 2026-07-26, GitHub reported Secret Scanning and push protection enabled for the public repository with zero open secret-scanning alerts. | Added an explicit API-origin variable example. No credential value was added or copied. The repository-native scanner avoids adding another CI dependency or third-party credential boundary. | Keep GitHub Secret Scanning and push protection enabled and review any future alert before merge. |
| Local operator credential labeling | During the 2026-07-18 bucket operation, the ignored local value named `SUPABASE_SERVICE_ROLE_KEY` decoded as an `anon` role for the correct project and could not enumerate Storage buckets. No credential value was printed, copied, or committed. This does not prove the Vercel production value has the same problem. | The bucket change was completed through the founder's authenticated Supabase dashboard session instead of bypassing the failed authorization. | Replace the mislabeled local value with the correct private development credential only through the approved secret manager, and attest the Vercel variable role without recording its value. |
| Historical secrets | `SECURITY_PUBLIC_READINESS_REPORT.md` records redacted findings in repository history. Current code cannot prove whether those values were real, rotated, or placeholders. | Preserved the historical report and added the attestation checklist below. | Confirm rotation/retirement for the Supabase service role, anon key, and any genuine deployer key. Decide whether history will be rewritten or retained after rotation. |
| SIWE request binding | The active Vercel route verified the recovered wallet and merely checked nonce availability. It did not bind the signed domain, URI, version, wallet line, or issued-at value to the request. Nonce read and update were two requests. The standalone API had the same weakness. | Validate the complete signed request boundary and consume the nonce with one conditional update. This removes the concurrent replay window without changing wallet-only sign-in semantics. A successful desktop production publish on 2026-07-20 passed the current pre-publish SIWE authorization boundary. | Complete one production mobile SIWE sign-in smoke test. |
| Standalone API CORS | The optional Express API reflected every Origin while allowing credentials. | Require an exact configured origin, default to the production site, add private no-store defaults, and use a SameSite=Lax session cookie. | If this server is deployed separately, list every exact allowed origin in `API_ALLOWED_ORIGINS`. |
| Supabase RLS | Phase 18.7a covered public product tables but omitted several internal indexer, auth, moderation, queue, retry, reorg, and observability tables. Two older SQL files still grant direct authenticated writes and are unsafe for the current server-write architecture. | Phase 18.7b was applied to production on 2026-07-17: internal tables are service-role-only; product/projection tables remain direct-read-only; prior policies were removed deterministically; all 37 public tables now have RLS enabled and forced. | Complete the authenticated profile, discovery, moderation, and SIWE smoke tests and retain the private operator evidence. |
| Supabase Storage RLS (`storage.objects`, `artworks` bucket) | The production read-only verification found dashboard-created policies that no tracked SQL represented: three duplicate public SELECT policies (`Anyone can view artworks`, `Public Access for artworks`, `Public can view`) and direct client write policies (`Authenticated can upload to artworks`, `Authenticated users can upload`, `Authenticated users can upload to artworks`, `Users can update own files in artworks`, `Users can delete own files in artworks`). The write policies check only the bucket and the authenticated role; they do not enforce per-wallet ownership or a wallet-scoped path, so any authenticated client can write, overwrite, or delete objects directly, bypassing server validation. The active app upload path (`src/api/routes/upload/file.js`, `src/api/backend.js`) uses server-created signed upload URLs with the service_role key and does not depend on these client policies. | Phase 18.7c was applied to production on 2026-07-17: all direct artworks client write policies were removed and exactly one canonical public SELECT policy (`artsoul_artworks_public_read`) remains. The post-hardening production artwork `v41:84532:26` proves that both media and metadata continued through the only active signed-upload path and remained publicly readable. | No positive signed-upload evidence remains. Keep the public-read check in normal release smoke tests. |
| Supabase Storage bucket guardrails | The production `artworks` bucket was public with both `file_size_limit` and `allowed_mime_types` unset. The application also had conflicting 20 MB, 50 MB, 100 MB, and 200 MB client-side limits. The signing route validated declared size and MIME type, but bucket-level limits were still required as defense in depth for the signed upload itself. | At 2026-07-18T21:56Z the application boundary was consolidated into `src/config/upload-policy.js`: 50 MB for artwork media, 256 KB for metadata, and one reviewed media/metadata MIME allowlist. The production bucket was updated through the authenticated Supabase Storage dashboard without disabling the spend cap. A 2026-07-20 production publish succeeded within those limits. The 50 MB boundary is a temporary public-testnet operational limit, not canon; 100 MB may be reconsidered only after usage stabilizes and a resumable upload path is verified. | Complete one authenticated rejected unsupported-MIME request and one authenticated rejected request larger than 50 MB. These checks request no upload URL and store no object. |
| Migration path | SQL is split across three trees. The old JavaScript runner applied only migrations 004 and 005 while reporting success. One-off scripts bypassed checksums and a ledger. | The safe runner now enumerates the full indexer 001-014 chain, verifies continuity, uses an advisory lock, records SHA-256 checksums, and defaults to dry-run. A production read-only baseline audit completed on 2026-07-18: migration 014 is present and chain-scoped; the current V4.1 deployment intentionally lacks superseded legacy projection objects. No false ledger rows or legacy tables were created. | Preserve the baseline audit as testnet evidence. Do not run `--apply` or backfill the ledger on this historical database. The clean mainnet database starts with migration 001 and a complete ledger from inception. |
| Deployment headers | Production had HSTS but lacked consistent nosniff, referrer, and frame policy. Auth/session responses could inherit public revalidation behavior. | Added global nosniff/referrer/frame headers and private no-store defaults for API routes. A CSP was intentionally not guessed because current AppKit/ESM imports require a measured policy first. Preview and production smoke tests passed on 2026-07-26. | None for this correction; retain the checks in release acceptance. |

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

### Repository secret-scanning observation (complete)

Observed through the GitHub repository API on 2026-07-26:

- repository visibility: public;
- GitHub Secret Scanning: enabled;
- Secret Scanning push protection: enabled;
- open secret-scanning alerts: zero.

This proves the active repository scanning boundary. It does not replace the private rotation/retirement decisions for historical credentials.

### Preview and production header smoke (complete)

Observed on 2026-07-26 against production and the PR #146 Vercel preview:

| Surface | Result | Security/cache evidence |
| --- | --- | --- |
| Production `/` and `/index.html` | HTTP 200 | HSTS with preload, `nosniff`, `SAMEORIGIN`, `strict-origin-when-cross-origin`, and `public, max-age=0, must-revalidate` |
| Production `/api/public/config` | HTTP 200 | HSTS with preload, `nosniff`, `SAMEORIGIN`, `same-origin`, and `public, max-age=300` |
| Production invalid `/api/auth/nonce` request | HTTP 400 | HSTS with preload, `nosniff`, `SAMEORIGIN`, `same-origin`, and `private, no-store` |
| PR #146 preview `/` | HTTP 200 | The same HTML security and revalidation policy as production |
| PR #146 preview `/api/public/config` | HTTP 200 | The same public-config security and cache policy as production |

No CSP was added or inferred by this smoke test.

### Post-hardening signed upload and public read (positive path complete)

The production projection returned artwork `v41:84532:26`, titled `ArtSoul`, with `created_at = 2026-07-20T10:30:03.318Z`. This is after the 2026-07-17 Storage RLS hardening and the 2026-07-18 bucket guardrails.

The current publish UI requires a wallet-bound SIWE session before enabling publish. Both media and metadata call `/api/upload/file`, whose handler requires that wallet session and creates a single-object signed Storage upload URL. Direct client Storage writes had already been removed, so this successful post-hardening publish is positive production evidence for the intended path.

Read-only checks on 2026-07-26 returned:

| Object | Result |
| --- | --- |
| Media | HTTP 200, `image/png`, 2,179,571 bytes |
| Metadata | HTTP 200, `application/json`, 2,324 bytes; `name`, `description`, and `image` were present |

No new artwork or Storage object was created by the verification. Mobile SIWE and the two authenticated negative-policy requests remain separate acceptance evidence.

### Remaining mobile operator smoke

After the A1 wallet-test auth variant is deployed:

1. On the phone, open `https://artsoul.vercel.app/wallet-test.html?walletdebug=1&layer=auth`.
2. Tap **Connect, sign in, and run A1 smoke**, approve the Base Sepolia connection, and return to the same browser tab.
3. If the page says authentication was deferred, tap **Complete SIWE and run A1 smoke** and approve the gas-free SIWE signature.
4. Accept the run only when the page reports `A1 auth smoke passed` and the visible log contains two `A1 upload policy result` entries with HTTP 400, `passed: true`, and no signed upload returned.
5. Copy the visible log into the private operations record. It masks the wallet address and contains no secret, file, signed URL, or Storage token.

The two invalid requests are validated before service-role access or signed-URL creation. They do not upload media, create metadata, send a transaction, or create a Storage object.

### Rejected mobile smoke attempt (2026-07-26)

The first production Variant E attempt was rejected and does not count as A1
acceptance. WalletConnect reported that the cached session topic did not exist,
but the wrapper still returned a cached wallet address on Ethereum mainnet. The
SIWE signature was never requested, neither authenticated upload-policy check
ran, and the wallet did not list ArtSoul as a connected site.

The root cause was a fail-open liveness check that treated
`provider.session` as proof of an active connection without reconciling its
topic against the initialized SignClient session store. The remediation
requires a non-expired topic in that store before any connected state can be
published. An absent, unreadable, expired, or SDK-rejected topic is discarded
locally without disconnecting a live remote session, and the next explicit
Connect action creates a fresh pairing. Session topics are masked in copied
diagnostics.

Repeat the operator smoke above after the remediation reaches production. A1
remains open until the exact success evidence in steps 3-5 is captured.

The first post-remediation rerun confirmed that the stale topic no longer
published a false connected address. A later explicit attempt established a
live wallet address and confirmed Base Sepolia (`84532`), but SIWE was still
deferred and neither policy request ran. The follow-up root cause was narrower:
the mobile wrapper re-armed its one-turn SIWE deferral even when
`connectCoreWallet()` reused an already-live session. The deferral must apply
only to a newly paired session (`restored: false`); a restored live session is
already the next protected-action gesture and may proceed to serialized network
confirmation and SIWE.

A second post-remediation phone run again reached a liveness-checked wallet
address and Base Sepolia. The operator approved a gas-free signature on some
attempts, but the isolated bench still reported only the combined
`deferred or not completed` outcome and no policy request ran. The same bench
also displayed `Account: none` and `provider or relayer absent` because its
local diagnostic handle was not attached to the production core facade even
when that facade was live. This attempt is rejected as acceptance evidence. The
bench must await the production wrapper boot, report the exact SIWE stage and
sanitized failure, and provide one-tap complete-log copy before the next phone
run. This is diagnostic hardening only; A1 remains open until the exact success
criteria above are captured.

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

This pre-change evidence supported the reviewed production application on 2026-07-17. The historical results above are retained to show the before state; the verified after state is recorded below.

### Production RLS verification status (post-change audit complete)

The reviewed migrations were applied on 2026-07-17 after a custom-format full backup and a separate schema-only backup were created and validated. Both SQL files completed their own transactions, and the complete verification report was captured before and after application.

| Check | Post-change result | Interpretation |
| --- | --- | --- |
| Public application tables | 37 total; 37 with RLS enabled; 37 with `FORCE ROW LEVEL SECURITY` | Phase 18.7b is active across the complete classified public schema. |
| Client non-SELECT grants | 0 | Browser roles retain no direct application-table write grant. |
| `artworks` Storage write policies | 0 | Direct client INSERT, UPDATE, and DELETE paths are closed. |
| `artworks` Storage read policies | 1, `artsoul_artworks_public_read` | Existing public artwork downloads remain available without duplicate policies. |
| Production public reads | Homepage, public config, V4.1 artwork projection, indexer status, and an existing public artwork object returned HTTP 200 | Public application and Storage reads remained available after forcing RLS. |
| Unauthenticated signed-upload request | HTTP 401 before signed URL creation | The server upload route remains reachable and rejects unauthenticated callers before Storage. |
| Bucket guardrails | Updated on 2026-07-18 to `file_size_limit = 52428800` with the reviewed media/metadata MIME allowlist | The bucket now enforces the same boundary as the signing API and upload UI. The global 50 MB limit and spend cap remain enabled. |

Phase A1 is not complete yet. The historical testnet migration ledger remains intentionally absent rather than inferred from table names. The remaining operator evidence is the private credential attestation, one production mobile SIWE smoke test, and authenticated rejection of unsupported MIME and an artwork size greater than 50 MB.

## Acceptance Evidence

Phase A1 may be checked off only after all of the following are attached to a private operations record or a security issue that contains no secrets:

1. Completed rotation attestation above.
2. **Completed 2026-07-17:** pre-change export from `sql/verification/phase_a_security_verification.sql`, including the storage section 8/8a-8d grids.
3. **Completed 2026-07-17:** reviewed and applied Phase 18.7b transaction.
4. **Completed 2026-07-17:** reviewed and applied Phase 18.7c storage transaction.
5. **Completed 2026-07-17:** post-change verification showing no disabled/unforced RLS table, no client write grant, and for the artworks bucket `write_policies = 0` with `select_policies = 1`.
6. **Completed 2026-07-18:** bucket verification showing `file_size_limit = 52428800` and the reviewed MIME allowlist from the migration runbook.
7. **Completed 2026-07-18:** read-only production baseline audit captured. Migration 014 and the active V4.1 schema were verified, superseded legacy objects were recorded absent, and no ledger rows were invented. The historical testnet database remains pre-ledger; the clean mainnet environment will start ledgered from migration 001.
8. **Completed 2026-07-26:** preview and production header smoke tests.
9. **Partially completed 2026-07-20/26:** desktop SIWE, signed media upload, signed metadata upload, and both public reads. Production mobile SIWE remains.
10. Authenticated rejection of an unsupported MIME request and an artwork-size request greater than 50 MB. The API must reject before creating a signed URL or Storage object.

## Canon Impact

None. This work enforces Phase A security boundaries. It does not amend architecture, economics, roles, lifecycle, Genesis, moderation mechanics, or chain policy.
