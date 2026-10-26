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

## Validation before release

- Search state/content/commands/docs: 41 passing checks.
- Voice/WebMCP/command panel/docs: 116 passing checks.
- Browser: eight Classic/Future cases at 320, 390, 844 and 1440 CSS pixels;
  visual viewport reduced to 320px with a nonzero offset where applicable.
  Tested result scrolling, loading/error height, Backspace/Delete/space/clear,
  composition, same-page/repeated docs links, Escape and listener cleanup.
  Inside-to-outside drag stays open; deliberate backdrop click closes.
- Build passes: 11 HTML routes and 173 Tailwind utilities verified.
- Evidence logs and screenshots: `output/audit/search-video-*` and
  `output/playwright/search-video-*-keyboard.png` (local artifacts).
- Full unit/CI and exact hosted deployment verification are pending at this
  checkpoint. Browser viewport emulation is not native iPhone acceptance.

## Scope and interpretation

Touches visual/UX canon section 16 and public documentation navigation only.
The recording continues the owner's request for site-wide public search;
it supersedes the earlier art-page-only launcher placement. The existing visual
language is retained. Search remains literal catalog/documentation matching,
not an AI question-answering service. No dependency, database, permission,
contract, economics, wallet-signature or mainnet change.

Phase B remains open. After this follow-up, resume B-21 Donate/Report
preparation through existing dialogs with explicit user review/submission.
