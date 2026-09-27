# Runtime and migration boundaries

Verified from source on 2026-09-23 in the canonical workspace. This closes the
documentation half of A-35; it does not activate an alternative server or migration.

| Surface | Actual entry / owner | Boundary |
| --- | --- | --- |
| Public frontend | Root HTML entries and `src/entries/*`, built by `vite.config.js` | Vite emits `dist`. Root compatibility scripts and selected `src/` trees are intentionally copied; copied does not mean every module executes. |
| Serverless API | `api/[...route].js`, handlers in `src/api/routes/` | Explicit route map owns auth, profiles, OAuth, upload, public reads and flagged moderation. `src/api/backend.js` owns the active session/database helpers. |
| Exact public artwork reads | `api/public/artworks.js` | Dedicated cold-load entry; it shares the current public projection handler. Do not replace it with the older table API. |
| Active moderation | `src/api/routes/moderation/*`, `moderation-passkey.js`, `moderation-safe-recovery.js`, reporting/admin helpers | A8 flags, atomic RPCs and the ordered rollout control activation. The existence of a route does not mean its feature is enabled. |
| Browser service compatibility | `src/index.js`, `src/services-index.js`, `window.AuctionService` and other shared adapters | Profile, gallery and artwork still reference this layer. Removing it as "legacy" would break live clients. Maintain one implementation per operation and keep adapters thin. |
| Parallel Express composition | `src/api/server.js` | Not a Vercel entry and absent from npm start/build scripts. Composes its own Express/session/indexer/moderation services and binds a listener at import time. It must not be imported into serverless or browser entry graphs. |
| Older moderation service | `src/features/moderation/moderation-api.js` and related services | Composed by the parallel Express server, not the active A8 route map. It is not an alternative authority model or a substitute for passkey/Safe recovery. |
| Indexer services | `src/indexer/*`, deployed operational launcher/configuration | Separate long-running service and database/event-processing lifecycle. Frontend/API build output is not evidence that the live indexer was restarted or upgraded. |
| Collection service drafts | `src/api/routes/collections/review.js`, `src/api/routes/newsletter.js`, `src/api/launch-services.js` | Unwired in the active route map. Local drafts must not be described as live review/newsletter services. The September 27 newsletter correction saves consent before requesting email and fences stale opt-out updates; durable delivery and real service acceptance remain required before wiring. |

The parallel Express composition imports `express-session`, which is not a declared
direct dependency, and has separate initialization/configuration assumptions. It
is retained for reconciliation, not declared runnable or production-equivalent.
Its obvious `/health` variable typo (`dbHlth` instead of the local `dbHealth`) was
corrected without starting it or changing the active API. Installing a missing
package alone would not certify this stack.

Do not delete copied browser modules, rename a legacy endpoint into the public
projection, or wire the Express composition to production as "cleanup". Before
retiring a module, identify every HTML/import/runtime caller and its replacement,
verify the relevant flows, then remove it in a focused change.

## Migration ownership

`migrations/`, `src/indexer/migrations/`, and `sql/migrations/` are separate history
trees, not three interchangeable runners. Their per-file disposition and rollout
order live in [MIGRATION_RUNBOOK.md](../security/MIGRATION_RUNBOOK.md).
`test/migration-ledger-coverage.test.cjs` rejects an unrecorded SQL file. Prefix
numbers alone do not define ordering across trees; the existing duplicate `001`
prefixes do not authorize choosing one file over another.

A8 rollout follows [A8_MODERATION_ROLLOUT.md](../runbooks/A8_MODERATION_ROLLOUT.md)
with backup/verification discipline from the migration runbook. The collection
services migration remains a local draft and must not join that activation order.
No production migration state was inferred or changed by this source review.
