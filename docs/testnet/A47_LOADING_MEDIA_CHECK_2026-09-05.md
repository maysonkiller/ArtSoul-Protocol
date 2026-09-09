# A-47 loading and media check — 2026-09-05

Status: locally verified repair; device acceptance remains open. This is not a Phase A closure.

## Confirmed causes and changes

- A short artwork route prefetched `id=7`, while the page requested `id=v41:84532:7`. The unused request lost the head start and duplicated server work. Both now use the same composite key. Public config also consumes its existing head request instead of issuing a second one. Response freshness and moderation behavior are unchanged.
- Ownership put the neutral avatar behind the real image, allowing two identities to be visible during decoding. The real avatar now commits after decode, without a second background image. Known names remain readable while media loads, and a late result cannot replace a different address. Supplemental profiles still do not gate the page.
- Detail video used both an opaque loading surface and an extra poster image above a visibility-gated player. The native poster/first frame now owns the preview and controls remain visible before data arrives. A small non-blocking status handles posterless loading. Card previews and audio controls are preserved.
- Detail images/GIFs commit after bitmap decode rather than progressive partial paint. A failed decode reaches the existing unavailable state.

## Verification

- Node unit suite: 863 tests, 856 passed, 7 skipped, 0 failed.
- Production build: passed; 10 HTML routes and 178 Tailwind utilities verified.
- Actual local Chrome against the built assets and read-only public API: artwork 7 and 19 video, 10 GIF, 31 image, 8 audio; no page errors.
- Creator and First Collector on artwork 19 both resolved to the correct uploaded images and names at 390, 768 and 1440 px. No document horizontal overflow.
- A deliberately held video response left the player visible with controls at readyState 0, with no opaque overlay. Releasing the response produced readyState 4 and the 0.1-second preview frame.
- Home, gallery and profile continued rendering shared cards and media controls. These checks do not prove a signed wallet flow.

## Evidence boundaries

The founder's three September 5 recordings cover Android, iOS and desktop. Timeline samples were reviewed across their full durations, with denser samples around selected transitions. Do not describe this as every-frame inspection. Desktop viewport checks are not equivalent to real iOS/Android acceptance, and local timings are not a production before/after benchmark.

Still separate: external-wallet network-switch failures, transaction-target ambiguity, raw RPC error text overflowing a dialog, and a possible stale identity on back navigation. These are not fixed or closed by this change.

## Canon interpretation

Only frontend loading and provenance display are affected (Bible §5 and visual/theme rules). No protocol state, economics, ownership, chain selection, fees or lifecycle changed. A temporary avatar placeholder is not a new identity or role. No new dependency, page-wide loading gate or replacement design was introduced.

## September 8 preview follow-up: first frame and card controls

The earlier 4.4-second result measured navigation to a visible video element on one first visit, not video download duration or a comparison with the previous build. It must not be presented as a fixed playback delay or proof of a speed regression.

Compared immutable deployments of `86feaf5` (production base) and `94c05a2` (PR #258) using actual Chrome, fresh browser contexts, alternating order and the same artwork. The first-frame proxy is a visible video with decoded data and no active seek, observed on an animation frame. It is not a field-performance percentile or real-device acceptance.

| Artwork | Base, navigation to first-frame readiness | PR #258, same observation |
| --- | --- | --- |
| 7, three visits per version | 2.307 / 1.475 / 1.302 seconds | 1.751 / 1.280 / 1.139 seconds |
| 19, one visit per version | 1.357 seconds | 1.646 seconds |

On the slower artwork-19 preview visit, the exact-artwork request took 818 ms versus 165 ms on the base visit; media mount-to-frame time was about 482 ms versus 480 ms. The source of that individual delay is before the player mounts, not evidence that the new media renderer adds a playback wait. Deployment/backend caches were not controlled; do not extrapolate the small sample to all visits. No page errors occurred in these eight visits.

Artwork 7 currently has no separate image/poster in either its public projection or its source metadata. Both versions seek the video to 0.1 seconds to obtain its first frame. Music 2 (artwork 32) likewise has no stored cover; home, gallery and profile share the existing branded audio-card layout. This follow-up does not replace either media preview, alter styling or invent a cover image.

A separate keyboard defect was reproduced on the deployed Marketplace: Enter or Space on Music 2's play button opened artwork 32 instead of playing. The outer React card consumed bubbled key events from nested controls. It now handles activation only when the card itself is the event target, leaving native button activation intact. A failing behavioral test reproduced the defect before the one-line repair; the companion test preserves Enter/Space activation on the card itself. Actual Chrome with only the local card script substituted into the preview then played audio with both keys without navigating. Shared runtime version 12 is used by all four consuming pages and pinned in the cache guard.

Verification after the repair: 889 unit tests, 882 passed, 7 skipped, 0 failed; production build passed with 10 routes and 178 Tailwind utilities. No contract code changed. The local-script substitution check is not yet evidence that this follow-up has deployed, and the original device/performance gates remain open.

## September 9 follow-up: rapid media controls

Extended verification on the deployed keyboard repair exposed another pre-existing interaction: the global capture-phase double-click guard disabled a play/mute button for 500 ms after activation. Keyboard focus moved to the body, so a quick second Space press generated no event on the control. This was reproduced with key/click/media-event diagnostics; a successful first playback alone did not prove repeat interaction worked.

The shared DOM and React audio/video play and mute buttons now use the guard's existing `data-allow-rapid="true"` opt-out. No global guard, transaction action, styling, preview source or loading behavior changed. All four consumers load card runtime v13. Behavioral tests execute the real global guard: both media renderers failed before the opt-out and pass after it, while an ordinary action button still receives its existing 500-ms protection. Actual Chrome with only the updated card script substituted into the deployed preview passed Play with Enter/Space, immediate mute/unmute with both keys, and focused-card Enter navigation. No page errors occurred.

Full local verification: 892 unit tests, 885 passed, 7 skipped, 0 failed. Production build passed with 10 routes and 178 Tailwind utilities. This follow-up does not close the device/performance gates.
