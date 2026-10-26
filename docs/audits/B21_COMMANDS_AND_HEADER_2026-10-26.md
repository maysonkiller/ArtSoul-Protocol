# Phase B commands and interface follow-up

Status: implemented locally; release verification pending. Canonical checkout:
`C:\Projects\ArtSoul`, `codex/takeover-audit`, starting HEAD `6f0fc49`.

## Scope and evidence

The founder requested a text alternative to voice commands, a compact header,
restoration guidance for hidden artwork, a paused profile editor and newest-first
notifications. This touches Bible sections 1, 11, 13/visual part 16 and 17.
No economics, contract behavior, role, factor lifetime or signing rule changes.

- Commands reuse the existing WebMCP tools. Opening the panel does not request
  audio. English/Russian text works without SpeechRecognition; typed answers
  remain silent. Financial actions retain the existing review and wallet gates.
- Microphone callbacks are retired on cancel, language changes, account changes,
  hidden tabs and page exit. Late private answers are fenced by account/epoch.
  Closing a panel cannot undo a transaction; an in-flight command cannot be
  replayed by reopening it. Oversized input is rejected instead of truncated into
  a different instruction. Financial commands reject negation, questions and
  compound requests rather than extracting an executable substring.
- Seven pages have a static command launcher beside the wallet. Admin has none.
  Search is an icon on Home, Gallery, Artwork and Profile; it is removed from
  Admin, documentation and creation forms. Header slots keep their width while
  private notifications load. No microphone or private request occurs on launch.
- Gallery actions no longer stretch to match the two-line search control.
  Profile customization is unmounted, retaining source and stored data for a
  future reconsideration. It is not a deletion or a public API authorization change.
- Hidden artwork now links to its own actioned complaints using a validated,
  server-side chain/artwork filter before the existing 200-row cap. Restoration
  remains a reviewed complaint decision with a reason, authorization, conflict
  checks and audit trail. Other active restrictions still prevent visibility.
- Personal auction and report outcomes share one newest-first history, with
  source-scoped keys and independent read handlers. Reading does not reorder an
  open item. Staff review remains separate; upcoming deadlines remain distinct.

## Interpretation record

- A header icon opens ordinary commands, not administration or an autonomous
  signer. Full multilingual conversation, Saved/search expansion, publication
  drafts, Donate and complaint preparation remain later B-21 slices.
- The founder selected automatic official releases from a dedicated project
  address, with that address deferred until new contracts. The shared Core
  contract is not the official creator: it emits events for every artist.
  B-17 broadcasts remain disabled/unimplemented until a source is designated.
  Test fixtures may use fictional addresses, never an inferred founder/staff identity.
- The requested aggregate favorite count is queued separately. It must not expose
  who saved an item, alter Trust/ranking, or be confused with the private Saved
  list. No aggregate API/schema or ranking change is included here.
- Compact controls and paused customization are founder-prioritized Phase B
  follow-ups, not a claim that every page/function or the entire phase is complete.

## Verification

- Initial full local run: 2,626 tests, 2,617 passed and nine failed. Eight failures
  were test fixtures/cache pins tied to the previous header or hook positions;
  they were corrected without dropping assertions. The remaining failure was
  disposable PostgreSQL readiness; its isolated rerun passed all revision fences.
- Repaired suites: 109/109 pass. Final commands/WebMCP/admin-boundary group:
  120/120 pass, including targeted restoration and session isolation. Mixed
  inbox/review API group: 38/38 pass. Groups overlap and are not summed.
- Browser matrix: 64/64 cases across eight pages, Classic/Future and widths
  320/390/768/1440. Header controls and command panels remain inside the viewport;
  notification mounting causes zero account-button displacement. Text help and
  Escape work; gallery Filter/Clear measure 44px high. Real-browser checks found
  and fixed the inherited centre-column rule, narrow scrollbar overlap and a
  legacy mobile `[role="dialog"]` width/margin override.
- Final local build passes HTML-entry and Tailwind checks. No dependencies added.
- Local evidence: `output/audit/b21-browser-matrix.log`,
  `b21-repaired-tests.log`, `b21-final-focused.log`, `b21-inbox-admin-tests.log`,
  `b21-build-final.log`; screenshots in `output/playwright/b21-final-*.png`.
- CI and exact-deployment checks are pending. These local layout/mocked tests do
  not claim a physical phone, actual microphone, wallet signature or live
  complaint restoration.

Exactly next step: finish responsive browser and complete CI checks, then release
the authorized interface changes and verify exact deployed assets.
