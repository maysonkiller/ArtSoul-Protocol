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
