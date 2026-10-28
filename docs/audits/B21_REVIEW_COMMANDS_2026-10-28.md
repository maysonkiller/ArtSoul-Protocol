# B21 Donate and Report review commands

Status: implemented locally, release verification pending.
Workspace: `C:\Projects\ArtSoul`, branch `codex/takeover-audit`.
Starting production HEAD: `13bda8e5`; B26 release evidence commit: `77624572`.

## Scope and boundaries

The ordinary-user assistant could search and change Saved, but could not open
Donate or Report. This slice exposes the existing review forms through the same
text, speech and WebMCP tool adapter. It touches Bible moderation section 11,
interface section 13 (detailed document 16), and Phase B/B21. No economics,
contract, schema, roles, networks or automatic signing change.

- `prepare_donation` and `prepare_artwork_report` require one explicit positive
  uint256 artwork ID string. Auction numbers, token numbers, amounts, messages
  and complaint evidence are not inferred or accepted as additional arguments.
- Read the public artwork, verify its ID and Base Sepolia chain, reject hidden
  records even in a staff session, and use the existing `cardActionItems` policy
  with public feature configuration. The destination checks availability again.
- Navigate to the existing `?action=donate` or `?action=report` form. Navigation
  is preparation, not submission. Authentication, complaint validation and wallet
  approval remain behind the form's explicit actions. No amount is preselected.
- Pages without cards load the existing card/URL scripts only on an explicit
  command, rather than adding them to first paint or duplicating eligibility.
- Anchored English/Russian commands refuse questions, negation, missing or
  malformed IDs, unsupported parameters and compound requests. Low-confidence
  recognition does not open a form. Search phrases remain search data.
- Public title text is not spoken as an instruction. Replies explain that
  nothing has been sent. API, configuration, missing-feature and navigation
  failures are visible refusals; they do not fall through to financial tools.
- Changed static runtime pins: WebMCP 8, voice 7 across all seven consumers.
  No new package or external language provider.

## Interpretation ledger

1. "Donate/report by command" means opening a review form, not fabricating a
   complaint or assuming a payment amount. These remain explicit user input.
2. No administrative commands or hidden-artwork shortcuts are added.
3. Current English/Russian grammar is still bounded. Other languages, free-form
   intent recognition, model/provider privacy and cost remain separate B21 work.

## Verification

- Focused tools/voice/panel/cache group: 123 passing checks before the additional
  lazy-import cache consistency assertion. New behavior suite: 11 passed.
- `npm run build`: passed, 11 HTML routes and 173 Tailwind utilities verified.
- Final affected cache/review group: 17 passed. Sixteen built-browser cases
  pass using local production assets and read-only public apex data proxied by
  the test harness. Home/Gallery/Docs/Builder, both forms, Classic laptop/Future
  mobile: correct modal, bounded width, empty donation amount, consumed action,
  closing behavior, zero page exceptions and zero API writes. Includes actual
  lazy imports on pages without cards. This is not a physical-device test.
- Full tracked unit suite, hosted CI and deployment: pending at this checkpoint.
  No real payment or complaint was submitted.

Exactly next: finish browser and full-suite verification, release the reviewed
candidate, and verify its actual deployed runtime before advancing B21.
