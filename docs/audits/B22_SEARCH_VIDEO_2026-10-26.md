# Search video follow-up

Date: 2026-10-26. Workspace: `C:\Projects\ArtSoul`, branch
`codex/takeover-audit`, starting HEAD `03f7134`.

## Observation and cause

The owner supplied `IMG_2580.MP4` (127.67 seconds). The full timeline was
reviewed using sampled frames; audio was transcribed locally. Machine
transcription is supporting evidence, not a verified verbatim quotation.

- 00:01-00:39: ArtSoul search with the iPhone keyboard. The heading, input and
  Close control scroll with results; the dialog changes size between states.
  The original dialog used content-dependent height and one outer scroller.
- A dismissal around 00:14-00:15 is observable. Its exact input event is not
  proven. No Backspace/Delete close handler exists. The original backdrop
  handler checked only final click coordinates, without the pointer origin.
- 00:41-00:49 shows ArtSoul docs/gallery; 00:55-01:33 shows another site's
  documentation search as a reference, not an ArtSoul defect.
- 01:35-02:07 shows navigation through ArtSoul profile/artwork/Collected.
  Existing branded page-transition loading is visible. No additional avatar
  or profile-state root cause is established by this recording.

## Implementation

- Search uses a bounded visual-viewport height and offset. Heading/input/Close
  stay outside the content scroller. Compact keyboard layouts retain the
  accessible field label, readable results and horizontal category controls.
- Loading, zero results and errors do not resize/recenter the dialog.
  Backdrop dismissal requires a pointer gesture that begins outside it.
  Closing cleans up viewport listeners and restores focus without scrolling.
- All eight application headers expose the existing public search. Results
  include public pages and the 14 existing documentation sections. Documentation
  text has one source shared with its page; no contract/economic copy changes.
- Documentation links reveal the requested section, including same-page and
  repeated links. Static matches remain usable with an explicit warning when
  the artwork API is unavailable. Staff/private information is not indexed.
- Text/voice search and WebMCP share the new public categories, bounded results
  and safe links. Existing categories and old response fixtures still work.

## Validation and release

- Search state/content/commands/docs: 41 passing checks.
- Voice/WebMCP/command panel/docs: 116 passing checks.
- Combined final focused suite: 252 passing checks; cache guards: 5 passing.
- Browser: eight Classic/Future cases at 320, 390, 844 and 1440 CSS pixels;
  visual viewport reduced to 320px with a nonzero offset where applicable.
  Tested result scrolling, loading/error height, Backspace/Delete/space/clear,
  composition, same-page/repeated docs links, Escape and listener cleanup.
  Inside-to-outside drag stays open; deliberate backdrop click closes.
  Modified result activation preserves the current search, recent history
  remains clearable outside All, and IME candidate keys preserve input focus.
- Build passes: 11 HTML routes and 173 Tailwind utilities verified.
- Evidence logs and screenshots: `output/audit/search-video-*` and
  `output/playwright/search-video-*-keyboard.png` (local artifacts).
- Full local run initially recorded 2,763 passes and three failures: two stale
  cache-manifest assertions (fixed with the matching deployed version/hash),
  and a disposable PostgreSQL startup timeout. The unchanged isolated database
  test then passed all 37 checks; no database code or test timeout was altered.
- PR [#371](https://github.com/maysonkiller/ArtSoul-Protocol/pull/371), candidate
  `16513ab409e97b89955a19f1e1c1f268ee6838ea`, merged and deployed as
  `fb05b45f3a93ee4de727fb3e56aa7214c3cb25ca`.
- CI [40339786910](https://github.com/maysonkiller/ArtSoul-Protocol/actions/runs/40339786910)
  passed: Linux 2,771 passes/two skips; Windows 2,384 passes/31 skips; zero
  failures; 46 contract tests on each OS.
- Exact preview and apex verification each passed eight HTML routes, 36 asset
  byte hashes and guest denials for private APIs. On each deployment, 16 real
  browser cases passed across the eight pages/two themes, including ordinary
  search, same-page/repeated anchors and typed command search. Zero page script
  errors and zero API writes. No request fixtures were used in hosted checks.
- Live apex search finds the video's `lys` profile and artwork `#34`.
  Observed command timings in this single run: 652ms, 1,306ms and 0ms for the
  bundled `fees` documentation search. These are samples, not latency guarantees.
- Browser viewport emulation is not native iPhone acceptance. Exact cause of
  the original key-related dismissal remains unproven; the confirmed layout
  issue and related input/navigation boundaries are fixed and tested.

## Scope and interpretation

Touches visual/UX canon section 16 and public documentation navigation only.
The recording continues the owner's request for site-wide public search;
it supersedes the earlier art-page-only launcher placement. The existing visual
language is retained. Search remains literal catalog/documentation matching,
not an AI question-answering service. No dependency, database, permission,
contract, economics, wallet-signature or mainnet change.

Phase B remains open. After this follow-up, resume B-21 Donate/Report
preparation through existing dialogs with explicit user review/submission.
