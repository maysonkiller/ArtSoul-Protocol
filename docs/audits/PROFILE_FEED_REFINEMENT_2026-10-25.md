# Profile controls and public feed refinement

Status: released and apex-verified in PR #345 / `8fdf58f`.
Workspace: `C:\Projects\ArtSoul`, `codex/takeover-audit`, starting HEAD `8a6230e`.
The deployed baseline was PR #344 / `d844349`.

## Evidence and reproduction

Reviewed the complete 86.7-second desktop recording dated October 25 at 10:20:27,
with timestamped frames and local offline speech transcription. The transcript
has uncertain passages and is not a verified quotation. The written request
and visible actions are the authority for the implemented changes:

- 00:00–00:43: profile editing and curation; notifications and the separate
  navigation panel are shown below the profile rather than with their content.
- 00:49–00:57: reload/navigation; the homepage waits for metrics/cards.
- 00:57–01:18: Saved states in both themes; the unwanted plus is visible.
- 01:19–01:26: artwork detail and Saved removal. This recording does not show
  a new failure of the cross-surface synchronization fixed in PR #344.

Read the full supplied curved-profile HTML prototype, including styles, layout
builder, notification mock, page carousel and Collection Studio. Its sample
counts, arbitrary HTML/style persistence, theme-color chooser, public email/social
assumptions and client-only admin switches are not production capabilities.
Use its composition as a reference; do not import these mock mechanisms.

## Changes

- Shared Saved SVG: remove the unselected plus; retain the selected check,
  distinct Classic/Future states, accessible pressed state and pending protection.
  Runtime is v23 on all four consumers. No persistence or API behavior changed.
- Move the existing private notification inbox into the profile identity area,
  next to social links in display mode and below connections in edit mode.
  Its compact bell control expands a bounded inline panel. No invented unread
  counts or auction notifications are activated. Ownership/session gates remain.
- Put content navigation inside the same surface as the artwork list, including
  Saved; remove the redundant "Profile Sections" heading and separate frame.
  Mobile tabs scroll horizontally; active and keyboard-focused tabs are explicit.
  Existing section semantics, loading ownership and hash behavior are retained.
- Public feed enrichment reuses existing verified indexed metadata where eligible
  instead of issuing one original-file request per artwork. The implementation
  retains current auction/lifecycle reads and the public serializer. Missing,
  mismatched, unavailable or unsupported metadata falls back to existing reads.
  No database migration or indexer deployment is part of this correction.

## Performance findings and limits

PR #344 did not change homepage loading or public projection. A clean browser
measured 2.33 seconds to metrics/cards, including a 1.86-second public request;
the warm request was 38 ms. The longer delay from the separate screenshot was
not reproduced. Metrics and Spotlight share the same response and therefore
both wait for metadata enrichment. This identifies avoidable work, not proof
that every observed delay has one cause.

Real read-only handler measurements (baseline/indexed/indexed/baseline) were
737 / 260 / 650 / 285 ms. Baseline made 45 requests, including 33 metadata files;
indexed mode made 14, including two existing batched RPC reads. All 38-card
responses were identical. Network/cache order affects timing; request-count
reduction is the deterministic result, not a guaranteed page-speed multiplier.

Only this project's allowed public artwork Storage paths qualify. Supported
upload paths use unique names or `x-upsert=false`; publication retries compare
already-pinned metadata. External originals retain their existing fetch path.
Privileged out-of-band replacement of a stored original requires an explicit
index refresh; it is not a supported artwork-edit operation.

## Validation

- 97 focused checks passed: profile organization, card controls/cache versions,
  Saved API/store, notification privacy, countdown expiry and indexed metadata.
- Isolated browser used actual profile JSX and notification component, with
  synthetic identities/API responses: Classic/Future at 320, 390, 768 and 1440 px,
  no horizontal page overflow, one content panel, one owner inbox, none for a
  visitor. Edit/display, open/close and Saved panel placement checked.
- Actual shared Saved controls/store/capture guard with an in-memory API:
  preview add → detail remove → profile add → Saved-list remove produced exactly
  `[true,false,true,false]`; all surfaces ended unselected. No plus SVG remained.
- Local build passed: 11 routes and 174 required Tailwind utilities.
- The first full local run passed 2,368 checks but failed two PostgreSQL scenarios
  (three failures including their parent): container readiness and observing a
  held transaction. Serial rechecks of both affected files passed all 58 checks
  without code changes or skips. This initial full run is not reported as green;
  exact-candidate hosted CI is still required before release.
- Existing search-schema tests passed all 15 checks with real PostgreSQL, no skips.

Browser artifacts are under ignored `output/playwright/profile-refinement-*`
and `saved-no-plus-*`. No real OAuth, wallet write or physical-phone acceptance
is inferred from emulation. No secrets are stored in this report.

## Scope decisions and remaining work

Bible sections 5 (display), 13 (themes), and 17 (roadmap) are touched; protocol
economics and lifecycle remain unchanged. The prototype supplies layout intent,
not new permissions or mechanics. No architecture amendment is implemented.

The founder's cross-chain payment clarification and current official Arc/Circle
sources are recorded in `../VOICE_AND_NETWORK_FOLLOWUP_2026-10-25.md` as design
discussion. NFT origin and payment source are separate; no new chain is activated.

B17's unfinished source/API/schema work is preserved in stash
`abea37274cb45283f49f012ead2cd9ef56218765`, with earlier recovery copies retained.
Restore it after release, integrating the compact inbox prop without discarding
its pending state/privacy changes. B17 is not complete or applied to the database.
Full redesign, prototype-style Future account controls and page transitions stay
in the final B18 pass after the remaining functional Phase B work. Phase B as a
whole is not closed by this correction.

## Release evidence

- Candidate `78819e921fb0748f626b62298a08808a055a05e2` passed CI `40182431768`:
  Linux 2,378 passed / two Windows-only skips; Windows 2,077 passed / 23
  Docker/PostgreSQL skips. No failures. Both ran all 46 contract checks and built
  successfully. Linux exercised the PostgreSQL scenarios skipped on Windows.
- The exact-candidate preview was READY. Real public profile content tabs and
  private-inbox absence for a visitor were verified at 390 px without horizontal
  overflow. A WalletConnect analytics request received 403 in the preview;
  no application error or wallet-flow success is inferred from that request.
- PR #345 merged as `8fdf58f27d56bd1ede27a075cbc71f94698c5114`.
  READY production `dpl_AptqwLcaQyEFGYmPDGDAifTBnWMg`, immutable deployment
  `artsoul-3cbj0ekdn-maysonkiller-be9112b5.vercel.app`, serves the same SHA.
- All eight apex page asset lists match the saved final build. Shared v23 runtime
  SHA256 is `ef343be5c814bd8a11f528d0b693ef7c0fe0cf133590c76d70a6c1d40c69746b`.
  Guest Saved API remains 401/private-no-store and active Saved config is 84532.
- Actual apex homepage at 390 px shows all four metrics and 16 artwork links,
  no plus SVG and no horizontal overflow. Two public feed requests took about
  1.00/1.03 seconds in this browser run; this is an observation, not a speed SLA.
- No new physical-device test, authenticated write, schema/worker deployment,
  contract transaction or network activation was performed for this release.
