# B18 — November 2 video: artwork fit, interaction and guidance

## Evidence and scope

The owner supplied the 178-second desktop recording dated November 2 at 01:17:01
and a Home screenshot. The recording was reviewed end to end with its audio;
local frames, contact sheets and transcription remain private. Canon sections
05, 16 and 17 are touched through presentation and acceptance evidence only.
No economic, contract, authentication or network rule changes.

The recording demonstrates browser zoom and oversized cards at approximately
00:00–00:28, requests clearer accent feedback at 00:28–00:41, looks for contextual
explanations around 01:45–01:59, and compares the design study's marks and response
around 02:13–02:31. The separate screenshot specifically accepts the showcase's
outer size while rejecting the cropped image and hover movement.

The mark visibility comparison does not establish a separate reproducible logo
defect. The static design study has no live-data or wallet work, so its faster
navigation is not evidence that the product performs the same workload. Public
API recovery checks are recorded in B30; representative latency/load acceptance
remains open rather than being inferred from the study.

## Changes

- Keep the shallow Home showcase dimensions. Contain the entire artwork and
  reserve separate space for its caption and carousel controls inside the same
  shell. Remove the scrim that obscured the lower portion of the image.
- Remove the legacy global hover glitch/pulse stylesheet. Future buttons and
  cards retain restrained accent feedback without shaking or scaling the linked
  banner. Classic remains static; original palettes and reduced-motion rules
  remain in force. User-controlled media playback is unchanged.
- Make shared desktop cards more compact: five columns from 1200px, six from
  1600px, consistently on Home, Gallery and Profile. Keep ordinary phone layouts,
  readable type, 44px controls and Home's existing eight-work limit.
- Add visible question-mark guidance beside Community and Trust, auction
  payment guidance, and Profile's Trust/discovery measures. A shared native
  dialog explains the existing behavior and links to the relevant Guide section.
  Escape, backdrop dismissal, a labelled close control and focus restoration
  work without activating the action being explained.
- Bump the shared stylesheet references on all nine affected HTML routes.
  Existing CSS-version and removed-scrim assertions were updated accordingly.

The earlier four-column wide-screen choice in the November 2 card audit is
superseded by the owner's subsequent video request for smaller desktop cards.
Zoom was treated as evidence of desired density, not a request to make the whole
interface or mobile touch targets tiny. The approved eight-work Home limit is
unchanged. Separating caption from media is the explicit interpretation needed
to keep the accepted short banner while showing the full artwork.

## Verification

- Full local unit suite: 3,406 passed, 35 environment-dependent skips, zero
  failures. The first run found stale stylesheet pins and the removed-scrim
  assertion; those expectations were corrected and the full suite rerun.
- Focused UI coverage: 59 passing checks.
- Build: 11 route contracts and 172 required style utilities verified.
- Browser fixtures: 1,706 assertions across 320/390/1366/1920px in both themes,
  covering shared cards, hero fit and help interaction. No page errors or writes.
- Screenshots of both palettes were reviewed, including the 320px hero and
  390px help dialog. An independent read-only review found no blocking defect.

Private fixture evidence is under `docs/private` and `output/playwright`; it
uses built product routes with controlled data, not real wallet/device
acceptance. Release requires Linux/Windows CI, the preview and exact production
route/asset checks. Native iPhone acceptance is not claimed by proxy.

## Boundaries and rollback

This closes the reported local presentation defects, not all Phase B gates.
Current remaining gates are in `docs/PHASE_B_STATUS_2026-11-02.md`. The separate
B30 audit records the zero-cost database intervention and its limits.

The UI change can be reverted independently of the earlier operations evidence
commit. No database rollback, writer reset, chain replay, dependency addition or
asset deletion is required. Unrelated accumulated workspace changes were
preserved outside this patch.
