# B24 — compact laptop profile and actionable restriction explanations

Status: released in PRs #375 and #376; final production merge `537bad1`.
Workspace: `C:\Projects\ArtSoul`, branch `codex/takeover-audit`, starting commit
`55cca68`. This is one bounded Phase B slice, not completion of Phase B.

## Reproduction and changes

- Creator/highest-bidder controls used native `disabled`, so activating them
  could never explain the existing rule. A shared `ExplainedAction` now opens a
  small named dialog for an unavailable action and never calls its handler.
  Pending transactions remain natively disabled. Actual contract, provider,
  identity, validation and server checks are unchanged.
- The same interaction covers resale network/floor prerequisites, an already
  recorded discovery signal, incomplete Report/Donate acknowledgements, and
  unavailable collection publication. Pagination boundaries and in-progress
  operations remain ordinary disabled controls; this is not a change of rights.
- The explanation is portalled to the document body so parent form spacing does
  not reposition it. Native dialog supplies modal focus and Escape behavior.
  Cancel/close events are isolated from React ancestors: browser reproduction
  caught closing an explanation also closing Donate/Report. Wallet changes
  close stale explanations, including a nested donation explanation.
- Short desktop profiles put statistics beside identity and reduce excess
  vertical spacing. The rule is scoped to profile viewing at width >=1024px and
  height <=850px. No global zoom, smaller card media/fonts, nested gallery
  scrolling or mobile editor change. Long content can still require scrolling.
- All ten HTML stylesheet references and their existing pin assertions advance
  together to `unified-styles.css?v=55`.

## Validation

- `npm run build`: passed, 11 HTML routes and 173 Tailwind utility checks.
- `node --test test/explained-action.test.cjs test/resale-eligibility.test.js
  test/artwork-auction-reconciliation.test.cjs`: 33 passed.
- Profile focused checks: 29 passed; 30 rendered cases in both themes from
  320px to 1920px, including long identities/bio, editing, public profile,
  missing statistics and 683px effective width (zoom layout).
- At 1366x700 the first card row bottom moved from 898.8px to 680.5px;
  at 1280x720 from 884.5px to 666.2px. These are measured fixture layouts,
  not a guarantee that arbitrary profiles fit one screen.
- Built artwork browser: 12 theme/width/scenario combinations, creator and
  highest-bidder gates, wrong-chain resale, Enter/Space/Escape, focus restoration,
  nested Donate/Report draft retention and wallet-change closure. Zero page
  exceptions or real writes. Four collection-draft explanation cases pass.
- Four existing resale browser flows still pass: exact floor, below-floor
  rejection, wallet cancellation, price update, cancellation and relisting.
  Wallet/API responses are synthetic; no signed testnet or new physical-phone
  acceptance is claimed.
- The first full local unit run had six stale harness/markup/asset-pin
  expectations and one disposable PostgreSQL startup failure. Updated the
  affected expectations and component dependency stubs; 117 focused tests pass.
  The unchanged PostgreSQL revision-fencing suite passes separately (37 checks).
  The failed initial full run is not represented as a passing baseline.
- `git diff --check`: passed. No dependencies, contract changes, migrations,
  notification broadcasts, token transfers or external messages.

Local evidence: `output/audit/b24-*.log`,
`output/audit/profile-density-evidence-2026-10-26.json`, and
`output/playwright/b24-*.png`, `profile-density-*.png`.

## Interpretation record

The founder requested denser design and an explanation for restricted actions.
This implements layout and feedback only (Bible lifecycle/interface/theme/roadmap
sections); it does not relax creator bidding, duplicate-signal or payment rules.
Busy controls do not open a second interaction. Accessibility and readable text
take precedence over forcing all content into one viewport.

Milestone notifications are a distinct proposed feature in
[the source-backed policy note](../architecture/PLATFORM_MILESTONES_2026-10-26.md).
A bid is not a completed sale; publication is not minting; asking price is not
collection volume. The founder's 1 ETH/USD examples have not become live thresholds.
No historical testnet event is broadcast as a new achievement. Official project
release notices still await the separately designated creator address.

## Release evidence

PR #375 released candidate `0028aed`, merge `eecd340`. CI40366520845 passed:
Linux2814/two skips, Windows2419/32 skips, 49 contract tests each, both builds and
static checks. Post-merge CI40367228430 also passed. The merge tree equals the
tested candidate. Preview and apex verification match eight routes and 39 assets;
five private API guest-denial checks pass. Twelve explanation scenarios each on
preview and apex pass with synthetic API/wallet data and zero page exceptions.

Real public-profile read-only inspection confirms the compact layout and no
horizontal overflow. It exposed a further hydration issue: `discoveryProfile`
arrives after identity data, and `:has(.profile-stat-grid)` changed the identity
column from 1168px to 576px when statistics appeared at 1366px. The follow-up
reserves the short-desktop columns before statistics arrive. No invented/loading
statistics are rendered. Long content still scrolls naturally.

Follow-up PR #376 released candidate `d7f006f`, merge `537bad1`. Production build
and 104 focused checks pass. Exact-candidate CI40368341237 passes: Linux 2814
tests/two skips, Windows 2419 tests/32 skips, 49 contract tests each, both builds
and static checks. The merge tree equals the tested candidate. CSS references
and assertions advance together to version 56.

Six controlled real-DOM cases (Classic/Future x 390/1280/1366px) on the deployed
preview, without injected CSS, preserve identity/social width while statistics
are removed/reinserted, with no horizontal overflow. Evidence:
`output/audit/b24-profile-hydration-preview-browser.log`. This experiment is not
a claim of new physical-device or signed acceptance.

Final production deployment 7338912185, checked at 2026-10-26 17:33 UTC: eight
HTML routes and 39 assets match the local build; five protected API guest checks
remain denied with private/no-store responses. Evidence:
`output/audit/b24-final-apex-verification.log` and
`output/audit/b24-actions-apex-537bad12796b-1793036018986.json`.
The same six real-DOM cases pass on the final apex release without injected CSS;
identity/social widths stay 317.8125px, 533.5px and 576.015625px respectively.
Evidence: `output/audit/b24-profile-hydration-apex-browser.log` and inspected
`output/playwright/b24-final-profile-apex.png`. The owned browser and local
preview server were closed after verification.

Next step: resume B21 Donate/Report command preparation through existing visible
dialogs, without automated signing. Phase B remains in progress.
