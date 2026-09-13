# A-61 profile avatar failure path — 2026-09-07

Status: locally verified failure-path repair. Normal avatar/device acceptance remains open.

The profile hero had empty error handlers for both image loading and bitmap decoding. Either failure left an empty circle with aria-busy=true indefinitely. Behavioral tests execute the actual effect and reproduced both failures before the change. The existing cancellation token already rejected stale callbacks; it is retained for the new error state.

The repair ends the pending state and shows “Avatar unavailable” inside the same box after an actual load/decode failure. It does not time out a slow image, replace a valid uploaded avatar, transform its URL, change proportions or remove previews. Successful avatars still commit only after off-DOM decode. No fallback image is layered underneath a real image.

## Verification

- Final combined unit suite: 887 tests, 880 passed, 7 skipped, 0 failed. Production build passed with 10 HTML routes and 178 Tailwind utilities verified.
- Actual Chrome at 390x844 with a controlled failed avatar request: pending before release, non-busy unavailable state after HTTP 503, zero visible broken img elements and no page errors. The responsive avatar box remains exactly 72x72 before and after failure.
- Tests also cover bitmap decode rejection and disposal before a late failure. The existing successful decode and stale-result tests remain green.

This is not a claim that every gray circle in a recording was caused by a failed request. Cold-image transfer time and the profile first-frame decision remain separate. No ownership, protocol state, economics, lifecycle or theme palette changed. A-61 stays in progress until real iOS/Android acceptance.
