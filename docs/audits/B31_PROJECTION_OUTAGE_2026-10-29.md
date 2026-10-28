# B31 — Distinguish a source outage from an empty artwork feed

Status: released in PR #390; preview and production outage checks pass.
Scope: canonical B3, public API error semantics. No protocol, schema, billing
or permission change. This is separate from B30's indexer transfer correction.

## Reproduction and cause

During the confirmed Supabase quota restriction, `/rest/v1/v41_artworks`
returned HTTP 402 but `/api/public/artworks?limit=1` returned HTTP 200,
`success: true`, an empty list and upstream warnings. The route's optional-table
fallback was also applied to its essential artwork source. The result could
be CDN-cached as an ordinary empty catalogue, and availability checks could
incorrectly accept HTTP 200 as recovery.

## Correction

For both feed and direct artwork lookups, a warning for `v41_artworks` now
returns HTTP 503, `ARTWORKS_UNAVAILABLE`, a generic retry message, and
`Cache-Control: private, no-store`. Provider diagnostics are not exposed.
A successfully read empty source still returns HTTP 200 and an empty list.
Unavailable optional metrics retain their existing degraded behavior.
Existing bounded projection caching and direct negative-result eviction remain.

This changes the API's availability contract; it does not restore Supabase,
change billing or assert that every legacy frontend fallback renders an error
panel. Full native user journeys remain blocked by the provider restriction.

## Verification

Seventeen focused tests pass across the projection smoke suite, dedicated API
entry isolation and artwork recovery suite. New cases cover feed/detail
failure, non-cacheability, provider-detail redaction, genuine empty success,
optional-metric degradation and immediate direct-read recovery.

Exact candidate `c959d7338a1839b6817953f6e804b9b80fd53258` passed CI
40789032692: Linux 2,907 unit tests (two skips), Windows 2,510 (33 skips),
49 contract tests per platform, both builds and static checks. The real
PostgreSQL regression also ran on Linux. PR #390 merged as
`1e7e27728476485972eccf3691aa8c612f3f6573` at 23:45:10 UTC on October 28.
Production deployment 7400144007 succeeded; post-merge CI 40789507981 also
passed on Linux and Windows, including builds and static checks.

Read-only checks on the preview at 23:42 UTC and `artsoulprotocol.com` at
23:45:58 UTC verified both `/api/public/artworks?limit=1` and
`/api/public/artworks?id=38&limit=1` against the actual restricted provider:
HTTP 503, `ARTWORKS_UNAVAILABLE`, `private, no-store`, and no `success` or
`data` field. Private JSON evidence is retained under `docs/private/`.

After provider restoration, verify populated reads again under B30. Do not
infer service recovery from a successful code deployment or a healthy direct
DB connection. Legacy frontend fallback presentation is not accepted by these
API checks and remains a separate product verification concern.
