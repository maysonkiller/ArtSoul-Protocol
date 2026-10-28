# B31 — Distinguish a source outage from an empty artwork feed

Status: implemented; focused tests pass; exact-candidate CI/release pending.
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

After deployment, verify the actual restricted provider yields HTTP 503 from
both public feed and detail, with no successful-empty payload or cache header.
After provider restoration, verify populated reads again. Do not infer service
recovery from a successful code deployment or a healthy direct DB connection.
