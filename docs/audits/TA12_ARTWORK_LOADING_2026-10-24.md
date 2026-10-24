# TA-12: artwork and activity loading

Date: October 24, 2026. Starting HEAD: `e863b10`. Workspace:
`C:\Projects\ArtSoul`, branch `codex/takeover-audit`.

Status: **implemented, tested and built locally; not deployed**. The earlier
countdown fix is separate (`62fdb2a`); Community consolidation is `e863b10`.
Phase A engineering acceptance remains unchanged.

## Reproduction and causes

One read-only desktop Chrome opening of live artwork 34 used the production
bundle `/assets/artwork-QiToyRnW.js`. Navigation-relative timings were:

| Resource | Start | End | Duration |
| --- | ---: | ---: | ---: |
| Public artwork projection | 1,664 ms | 2,721 ms | 1,058 ms |
| Provenance | 2,725 ms | 3,935 ms | 1,210 ms |
| Default avatar | 2,798 ms | 2,843 ms | 45 ms |

The current live roles used the default image and truncated addresses. They did
not contain custom portraits/names in this observation; an old screenshot is
not evidence of missing present-day profile data. The homepage's projection
request took 1,185 ms, from 875 to 2,059 ms after navigation. These are individual
observations, not a latency distribution or a production improvement claim.

Code inspection and controlled tests established four avoidable waits:

1. The client started Provenance only after the main artwork resolved, although
   the URL already supplied the chain/artwork ID.
2. The full projection fetched metadata/public creator profiles only after all
   eleven lifecycle/metric reads completed. The exact-item path already had a
   reusable preload mechanism.
3. The provenance endpoint waited for settlements/resales/listings before reading
   auction endings, although endings depend only on auction IDs.
4. Every Ownership mount started a new image-preparation effect, including when
   the shared default avatar was already decoded. A real Chrome fixture using
   the previous and current component source reproduced the first DOM commit:
   old = zero images/names and two loading labels; new = two images/names and
   zero loading labels. The same result held on a second mount.

No panel overlap was established as the cause. No new layout fix is inferred
from the recording, and ordinary network/image latency is not eliminated.

## Patch and boundaries

- Start the independent provenance read alongside the exact artwork read. Apply
  it only after artwork success and the existing current-load sequence check.
  Reuse that promise for matching IDs; retain the canonical-ID fallback.
  A failed history read now reaches the existing unavailable state instead of
  leaving a loading state. Failed/stale primary loads never expose early history.
- Reuse the existing metadata/profile preload interface for the full feed.
  Preserve all lifecycle, moderation, precision, confirmed-auction recovery and
  metric checks before returning a projection. No partial metrics or extra
  statistics cache is introduced.
- Start auction endings once auction IDs arrive, while other history sources
  remain in flight. Preserve the moderation gate before history reads, the final
  complete-source join, truncation rules and event ordering.
- Prepare the shared default avatar when the artwork module loads. Reuse public
  avatar preparation by URL through a bounded 64-entry memory cache; evict failed
  entries so later visits can retry. Changed upload URLs prepare independently.
  Same-wallet refresh and stale-result cancellation remain intact. Main artwork
  media decoding is unchanged. A cold custom portrait still requires download
  and decode; this patch does not promise an instant first network visit.

Canon scope: public participant/provenance display, Trust/activity display,
visual behavior and Phase B (Bible sections 5, 6, 13 and 17; visual document 16).
No contract, economics, lifecycle, permissions, metric formula or Trust change.
Interpretation: independent public reads may overlap, but visible data still
waits for its validation gates. The cache size is an internal memory bound,
not a protocol parameter. No canon architecture amendment or dependency added.

## Verification

- Four new regression cases failed before the concurrency patch: 23 passed,
  4 failed. After patch: **27 passed, zero failures**. Cases cover request overlap,
  no premature history display, unavailable history and full-projection preload.
- Ownership/decoding checks: **21 passed**, including prepared first render,
  same-identity continuity, pending decode, failure retry and bounded eviction.
- Final combined regression run: **123 passed, zero failures/skips**, using:

  ```powershell
  node --test test/artwork-auction-reconciliation.test.cjs test/artwork-provenance-timeline.test.cjs test/artwork-provenance-labels.test.cjs test/auction-confirmed-reconciliation.test.cjs test/artwork-secondary-panels.test.cjs test/artwork-creator-first-paint.test.cjs test/decoded-image.test.mjs test/data-prefetch.test.cjs test/egress-public-projection-smoke.test.cjs test/public-metrics-projection.test.cjs test/public-auction-eth-precision.test.cjs test/navigation-theme-reentry.test.cjs test/page-theme-first-paint.test.cjs
  npm run build
  ```

- Build verifies **11 HTML routes / 174 Tailwind utilities**. Existing dependency
  annotation warnings are non-fatal; no package or lockfile change.
- Actual local Chrome fixture: first and repeated DOM commits confirm the
  prepared-avatar result above. All four eventual images are complete at 256x256;
  Classic/Future render the unchanged participant rows. This is synthetic public
  state using real components/styles, not production or native iPhone acceptance.
- Independent bounded diff review found no blocker. Reviewer finished; no
  background helper is needed for this task.

Local evidence is retained under `output/audit/`:
`ta12-live-artwork-before-2026-10-24.json`,
`ta12-live-home-before-2026-10-24.json`,
`ta12-waterfall-{red,green}-2026-10-24.log`,
`ta12-ownership-2026-10-24.log`, `ta12-regressions-2026-10-24.log`,
`ta12-build-2026-10-24.log`, `ta12-ownership-browser-2026-10-24.json`,
`ta12-ownership-{classic,future,panels}-2026-10-24.png` and the fixture generator
`ta12-ownership-fixture.mjs`. Raw local artifacts are not committed.

## Remaining release work

Prepare a reviewed release with this bounded loading change, the earlier timer
fix and Community consolidation; obtain production-release authorization, then
repeat public timing and layout checks on that deployed version. Do not mark
TA-12 deployed or claim a specific millisecond improvement from local mocks.
After that bounded release, B-13 Saved is the next implementation slice.
No database changes, signing, credentials or native owner ceremonies are needed
for this patch. Rollback is by its isolated Git change, not by copying a tree.
