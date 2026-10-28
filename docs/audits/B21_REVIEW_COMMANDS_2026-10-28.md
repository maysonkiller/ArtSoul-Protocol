# B21 Donate and Report review commands

Status: released in PR #378. Candidate `b49311cd920979c343113a44ebe5de88e7269a83`;
production merge `8abca4615d09aa206ab219f3e972c2ae212cb886`.
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
- Full tracked local unit suite: 2,833 passed, zero failures/skips. The final
  cache assertion added during that run passed separately in the 17-check group.
- Exact-candidate CI 40695082625 passed: Linux 2,832 passed / two skipped;
  Windows 2,437 passed / 32 skipped. Zero failures, 49 contract tests per platform,
  both builds and static checks passed. Post-merge CI40696631058 also passed.
  Skipped cases are not claimed executed.
- Preview deployment 7386418350: eight HTML routes and 39 assets match the local
  build, existing guest API boundaries remain enforced. Fourteen actual browser
  cases across all seven command pages correctly refused preview-disabled
  Donate/Report without navigation or writes. Initial harness attempts forgot
  that same-hash Gallery navigation preserves the open command panel; explicitly
  closing between cases fixed the test sequence without an application change.
- Production asset/deployment verifier passed for the merge SHA; its tree equals
  the reviewed candidate. Fourteen actual apex browser cases opened and closed
  the existing forms from Home/Gallery/Profile/Artwork/Upload/Docs/Builder, with
  English/Classic desktop and Russian/Future mobile layouts. No request mocking,
  page exceptions or API writes. Additional four local visual cases captured both
  forms in both themes; representative screenshots inspected.
- No real payment, complaint, wallet signature or physical microphone/device
  acceptance was performed for this slice. Existing forms retain those steps.
- Logs: `output/audit/b21-review-tracked-unit.log`, `b21-review-focused.log`,
  `b21-review-final-affected.log`, `b21-review-build.log`, `b21-review-ci.log`,
  `b21-review-local-browser.log`, `b21-review-visual.log`,
  `b21-review-preview-browser.log`, `b21-review-preview-verification.log`,
  `b21-review-apex-browser.log`, `b21-review-apex-verification.log`.

Exactly next: B21 publication draft preparation through the existing Publish
form, preserving selected files, pending publication recovery, explicit review
and wallet approval. Wider language coverage and the other Phase B exit gates
remain open; this release does not complete all of Phase B.
