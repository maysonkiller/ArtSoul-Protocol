# B30 — No-new-spend provider exit / degraded-read design

Status: **DOC_ONLY proposal / not a migration approval**.
Date: 2026-10-29. Read-only source review, no account, billing, database,
production DNS, environment, deployment or wallet mutation.

## Why this is needed

The ArtSoul Supabase organization is service-restricted for Egress Exceeded,
with Spend Cap enabled and next reported billing reset November 24. The
founder explicitly refuses paid overages or any new subscription.

B30 found an indexer query returning roughly 9.25 MB of full block-hash
history per calculation, repeatedly. PR #389 changed this to a digest
calculated inside PostgreSQL, preserving format and returning one row;
PR #390 and PR #391 made read outages visible in the API/home/gallery.
The current restriction is a billing-cycle consequence, not evidence of
deleted artwork. The earlier B30 read-only inventory records about
101 MB database and 159 objects / 116 MB Storage.

A cheap or free PostgreSQL target **does not automatically replace Supabase**.

## Actual integration inventory (source as of main 4653b47)

| Dependency | Current source | Migration implication |
| --- | --- | --- |
| PostgreSQL via Supabase PostgREST | `src/api/backend.js` `supabaseRest` sends service-role REST to `/rest/v1` | Neon/plain PG has no matching REST/role policy surface by itself |
| Storage API / URL | `src/api/backend.js` `supabaseStorageRest`, `getPublicStorageUrl`; `/storage/v1` | Keep signed upload/read semantics, media URLs, permissions and content types |
| Browser data/auth client | `supabase-client.js` dynamically imports `@supabase/supabase-js@2`, uses `/api/public/config`, and directly queries client tables | Needs a reviewed replacement for GoTrue auth/session, data reads and RLS, not just a new database URL |
| Media origin allowlist | `supabase-client.js` `ALLOWED_STORAGE_DOMAIN`, `storage-image.js` | New media origin must be explicitly validated, not globally unblocked |
| Profile/ownership UI | `src/entries/profile.jsx` and wallet/auth helpers | Unknown/unreachable profile must not imply owner permissions, empty asset list, or deletion |
| Public art projection | `/api/public/artworks`, homepage/gallery consumers | Preserve unavailable vs genuine empty, no-store errors and bounded cache |
| Indexer/state hash | deployed B30 correction + current cursor | Preserve cursor, hash parity, rollback and no full-history outbound queries |

The source review is a compatibility map, not a complete endpoint/secret
inventory. Every caller and signed-upload flow needs exact enumeration and
negative tests before any write cutover.

## Options under a strict $0 *additional* spend rule

1. **Existing capped Supabase:** no new account and no paid overage;
   continue local/offline Phase B, then restore populated Data API/Storage
   reads after provider restriction ends or a no-charge support exception.
   Existing $25 Pro subscription remains payable until separately cancelled.
2. **Neon Free as a PostgreSQL candidate:** official 2026 limits include
   1 GB/project, 100 CU-hours/project/month, 5 GB public transfer, and
   automatic suspension at free limits. A continuously polling indexer
   requires measured active-compute and network use. Requires separate
   API/auth/media adapters. It is **not** a drop-in site migration.
3. **Cloudflare R2 Standard as a *media* candidate:** 10 GB-month storage,
   1 million Class A and 10 million Class B operations in free allowance,
   egress free. It is **not a database**; operations beyond the free
   allowance can be billed, so do not create a bucket or attach billing
   without a reviewed hard no-spend control and owner acceptance.
4. **Isolated Protocol service on already-owned host:** potential zero new
   subscription, but old B30 bounded host probe found 2 vCPU, 3,819 MiB
   RAM and ~28 GB free disk while the indexer runs. Full Supabase
   self-host Docker minimum is 2 cores, 4 GB RAM, 40 GB SSD, so that
   stack **does not fit the measured host**. A minimal isolated
   PostgreSQL/PostgREST/media arrangement is research-only until CPU,
   RAM, disk, backups, availability, TLS and process isolation pass.
   Never reuse ArtSoul OS production DB or secrets.
5. **Cloudflare D1 / SQLite:** not wire-compatible with PostgreSQL,
   PostgREST or current extensions/indexer SQL; reject as a quick swap.

The media service and database can be separate, but creating a second
free provider does not erase the old cycle's egress or exempt current
subscription charges.

Sources: [Supabase egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress),
[Supabase cost controls](https://supabase.com/docs/guides/platform/cost-control),
[Neon Free limits](https://neon.com/pricing),
[Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/),
[Supabase Docker resources](https://supabase.com/docs/guides/self-hosting/docker).

## Read-only fallback during a provider outage

A future **public read-only snapshot** can show last-verified artwork metadata
and media only from a checksum-verified, permission-reviewed export at a
separate available origin. It must visibly state snapshot time, cannot claim
live auction state, listing, price, ownership, current moderation or fresh
metrics, and cannot enable auction/settlement/relist/buy/upload/edit actions.
No fabricated artwork cards; no scraping private data or silently changing
public URLs. The current provider restriction prevents claiming that
the full export has been acquired today.

Use a stable public snapshot manifest (schema version, source checkpoint,
row count, media inventory, SHA256 root, timestamp, origin), privately
retain backups, and verify every referenced image before exposing a card.
Failure is an explicit unavailable notice, not empty success.

## Sequenced gates for an optional migration

- **G0 / no-spend freeze:** preserve Spend Cap and original environments;
  never turn on usage billing, create paid services or change subscriptions.
- **G1 / independent export:** after provider recovery, perform two read-only
  count/hash-checked exports of DB schema/data and public/private Storage
  metadata, record RLS, identities, storage keys, URL map and backup restores;
  freeze private credentials out of evidence.
- **G2 / compatible sandbox:** simulate existing REST, signed upload,
  auth/session and profile endpoints against isolated data with exact
  failure envelopes. Prove that API responses, chain identifiers, revision
  controls and authenticated roles match originals.
- **G3 / source-executed negatives:** 401/403, wrong wallet, unsigned
  upload, expired signed URL, stale revision, lost response after commit,
  forbidden cross-project access, private media disclosure, duplicate
  settlement, provider timeouts, and zero blind retry.
- **G4 / resource and transfer budget:** 24-hour isolated poll/load
  rehearsal, ceiling for transfer and active compute, backup verification
  and restore time, latency and fail-closed observability.
- **G5 / preview:** deploy separately with no live user writes, no
  mainnet/testnet wallet signing and no DNS cutover; verify inventory
  parity, media delivery, errors and owner access.
- **G6 / controlled cutover (separate decision):** single-writer fence,
  verified snapshot, stable rollback window, contract/RPC checks,
  no cross-project mixing and explicit no-extra-cost decision.
- **G7 / follow-up:** compare days of performance and cost before
  separately considering cancellation of the existing paid service.

G1–G7 are **NOT_RUN** and blocked on provider access, real artifacts or
resource approval. This document neither authorizes nor performs them.

## Phase B disposition

Do not close B30 until real provider reads recover and the post-fix egress
slope is measured. B32 is frontend degradation, B33 is profile navigation,
not backend recovery. Independent Phase B unit, build, UX, runbook and
migration-design work can continue without transactions or provider writes.
Final controlled beta, owner-signed journeys and real-device checks cannot
be inferred from offline tests.
