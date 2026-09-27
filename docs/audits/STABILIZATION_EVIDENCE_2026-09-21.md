# Stabilization evidence — 2026-09-21

Local implementation and browser verification, not production acceptance. No deployment, production writes, mainnet transactions, DNS changes, migrations or bulk profile cleanup were performed. The video was not re-analyzed; the founder's timestamped text report defines the observed symptoms. No audio statements are attributed to the founder.

## Working state and scope

- Worktree: `C:\Users\mayso\.codex\worktrees\artsoul-takeover-audit\ArtSoul`; branch `codex/takeover-audit`; base HEAD `607f21337941fc1bd98a3651fde8953b981d5f91`. Changes remain unstaged.
- The original checkout at `C:\Projects\ArtSoul` remains on `codex/artwork-cold-load-restoration-v2`, HEAD `7b982ee3f574d1683c55cb76c658203f5f71e156`, with its three pre-existing tracked changes preserved. Nothing was merged from it.
- Pre-edit recovery snapshot: `C:\Users\mayso\.codex\audit-evidence\stabilization-2026-09-21`; `tracked.patch` SHA-256 `661156467B51A358E5D041DFDD4BB0AAE083838018F68B9F6AE63BEBA8C87FB5`; `untracked.zip` SHA-256 `C7FE0123C93335AA77F414A174CD6FAA75883B29E92323F20E2F36D34352E2A5`. Archive excludes environment files and dependencies.
- Canon touched: §§1–4 (network boundary, auctions, deposit, mint lifecycle), §§5/11 (identity, provenance, access), §12 (guidance only), §16 (shared presentation), §17 (ordered delivery). Collection authoring follows the existing [development amendment](../canon/CHANGELOG_2026-09-20_COLLECTION_LAUNCH.md), not a new economic approval.

## Reproduction, cause and correction

| Area / text observation | Reproduced cause | Local patch and regression evidence |
| --- | --- | --- |
| Profile identity | Authenticated generic PUT accepted Discord/X names; name presence was treated as connected in UI and a legacy access check. | Only OAuth owns provider IDs/canonical names. Public flags derive from private stored IDs. A separate editable public X link remains self-reported. Tests execute real route handlers with authenticated session/state cookies and mocked provider/database responses, including forgery, wallet swap, cancellation, successful callback and disconnect. |
| Disconnect / avatar error | Old cached/pending profile reads could restore pre-disconnect presentation. Avatar recovery referenced a variable outside its scope. | Invalidate cache and pending reads; only the current request may populate cache or update the profile. Error recovery restores the prior avatar. No stored legacy names were deleted. |
| AI upload / range around 00:32 and 01:16 | Remote media fetch accepted arbitrary destinations and unbounded bodies. Invalid model ranges were silently repaired; stale responses could outlive form/file changes. Exact video cause cannot be proven retrospectively from the deployed SHA. | Allowlisted HTTPS storage/IPFS media, redirect rejection, deadline/size bounds. Validate model and stored ranges; invalid output becomes unavailable rather than an invented estimate. Abort/ignore stale requests, preserve loading/error/success states, disclose text-only guidance. Actual browser form/image decoding tested with mocked AI/auth; no real Gemini call. |
| 00:16–00:46 end without bids | A stale active projection could reopen a terminal auction. Final browser reproduction additionally found that a 503 replaced the confirmed page with the initial indexing screen. | Confirm successful receipt before presentation update; terminal state cannot regress. Differentiate read failure from successful empty/hidden response. Preserve an already-loaded page on transient failure, with a nonblocking warning and Retry. Valid hidden responses still remove the artwork. |
| 00:48–01:48 artwork 28 / auction 63 | Merging old auction 35 with new 63 retained the old ID, bid and price. List caches and exact-read cache could return older data; event cache invalidation confused auction ID with artwork ID. | Replace round-specific fields on identity change; scope responses to generation and auction. Receipt bridge survives navigation/tabs, triggers bounded exact refresh, and yields to newer indexed state. Event invalidation resolves the containing artwork. Gallery and profile show auction 63 while fixtures deliberately still return 35. |
| 01:36–01:47 create form / decimal input | Profile used browser prompts while detail used a modal. Comma input alone was not proven as the historical failure cause. | Profile routes into the canonical artwork modal. Exact decimal parser accepts `0,001` as `0.001`, rejects empty/malformed/overprecision input, preserves input on errors. Passive account/network and actual onchain artwork preflight run before opening and submitting. |
| Minimum bid / deposit | The UI said only 10%, despite a 0.01 ETH minimum. API serialization also truncated ETH to six fractional digits: 1 wei became zero. | Explain `max(ceil(bid / 10), 0.01 ETH)` in wei, with gas separate and remaining settlement payment capped below at zero. Quote the contract before confirmation. Serialize price/bid values without losing wei. No contract economics changed. |
| Creator bid / wallet warnings | Equal display names cannot establish address identity. No Rabby defect was established. | Compare normalized actual creator, connected account and highest bidder; block self-bidding early. Recheck passive account/chain before send, reject changed-intent replacements and missing/failed receipts. Actual Rabby simulation and signing remain unverified. |

Receipt reconciliation changes presentation only: no ownership, floor, mint status, trust or eligibility is fabricated. It is bounded to 20 records / 10 minutes and at most four exact refreshes per list read. A known moderation suppression wins over a receipt. These operational limits do not change protocol mechanics.

For a `0.00001 ETH` winning bid, the minimum deposit is `0.01 ETH` and remaining payment is zero. Existing `ArtSoulCore.settleAuction` credits the `0.00999 ETH` excess to the winner's withdrawable balance after successful settlement. This is existing contract behavior, not an increase in the artwork price or a new fee.

## Evidence files

All paths below are relative to this worktree. Logs and screenshots under `output/` are local generated evidence; they are not proof of a deployment.

- Profile: `output/audit/profile-stabilization-tests.log` (92 pass), `profile-cache-tests.log` (7 pass), `output/playwright/profile-self-reported.png`.
- AI: `output/audit/ai-valuation-validation-before.log`, `ai-stabilization-tests.log` (59 pass); `output/playwright/ai-upload-flow.log` and `ai-upload-*.png`. Browser exercised success, inverted result, HTTP failure, pending request cancellation and fresh text-only result; zero non-AI API writes.
- Auction creation/cache: `output/audit/auction-event-cache-before.log` (5 fail / 1 pass before correction), `auction-creation-focused.log` (103 pass), `auction-browser-form.log`, `auction-browser-additional.log`, `auction-browser-crosspage.log`.
- Round/race/receipt behavior: `output/audit/auction-freshness-tests.log` (35 pass before final outage checks), `auction-final-outage-tests.log` (55 pass including added page/cache/card checks). Actual shipped functions, API handlers and receipt ABI are exercised; these are not substitutes for wallet acceptance.
- Precision: `output/audit/public-auction-eth-precision-before.log` (1 pass / 6 fail), `public-auction-eth-precision-after.log` (56 pass including related suites).
- Frontend precision: `output/audit/artwork-bid-precision-before.log` (1 pass / 5 fail), `artwork-bid-precision-after.log` (81 pass including related suites). Exact integer fallback matches contract `minimumBid`; a permissive floating-point helper cannot allow a bid one wei below the minimum.
- Final outage browser: `output/audit/auction-browser-receipt.log`, `output/playwright/receipt-ended-read-outage.png`. Additional moderation race: `auction-list-suppression-before.log` reproduces hidden-list / visible-old-detail restoration; `auction-list-suppression-after.log` passes 46 related tests. Suppressions from both responses remain available to downstream merging.
- Deposit/action review: `output/audit/bid-deposit-review.log`; browser screenshots include shared modal, active-auction preflight, creator-bid blocking, and 390px modal with visible controls.
- Contracts: `npm run test:contracts`, `output/audit/stabilization-contracts.log`: **33 pass**, comprising 19 existing and 14 isolated Collection Launch tests. Existing deployed contract source/storage was not modified. The stale package reference to a nonexistent `PrototypeAudit.test.cjs` was removed; its source findings remain in the [contract audit](TAKEOVER_CONTRACTS_2026-09-20.md).
- Final combined `npm run test:unit`: **1162 pass / 0 fail / 7 skip**, 1169 total, `output/audit/stabilization-unit-final-combined.log`. The seven PostgreSQL integration suites require Docker, which is unavailable; none is claimed as executed. Existing WebMCP, wallet, lifecycle and profile tab regressions are included in this run.
- Final `npm run build` after all production edits: **11 routes**, shared header verification and **178 Tailwind utilities** pass, `output/audit/collection-builder-build.log`. Only existing dependency annotation warnings were emitted. `git diff --check` passes. Earlier clean baseline results are not used as evidence for these patches.

## Next Collection Launch slice completed locally

`/collection-builder` now renders a local-only authoring page, discoverable from upload. It reuses the existing draft/network/components model and shared header/theme. Features: blank draft, optional explicitly proposed Origin template, variable phase editing/order, UTC scheduling, deterministic review, local save/load, JSON import/export and undo replacement. Unknown extension fields survive round-trip. Publish stays disabled even when all validation categories pass; this page cannot lock terms, deploy or mint.

Four reproduced draft defects were fixed: null recipient entries crashing review; booleans being accepted as supply; prototype property names passing eligibility lookup; unsafe numeric token IDs being rounded by a duplicate asset-key helper. `output/audit/collection-draft-before.log`: 0 pass / 4 fail; `collection-draft-tests.log`: 18 pass including unsaved-page lifecycle checks. Existing strict chain/contract/token identity is reused. No dependency was added.

`output/playwright/collection-builder-flow.log` records browser acceptance against the **built artifact** at local port 4177, with API reads stubbed and **zero API writes / zero page errors**: two-phase editing and ordering, price reference, explicit UTC export, save/reload, JSON export/import retaining extension data, malformed/unsupported import preserving current work, template/undo and disabled publication. Desktop Classic and 390px Future screenshots were inspected; there is no horizontal page overflow. Primary-button hover contrast was corrected using existing theme variables.

`output/playwright/collection-builder-controls.log` verifies actual saved/dirty/saved navigation-guard transitions and keyboard focus. Measured primary-button hover/focus contrast: Classic 13.89:1, Future 15.50:1. Exported JSON was deep-equal to the imported fixture, including unknown extension fields.

Remaining Collection Launch work includes full financial/utility authoring, contract capability matching, backend persistence/projections, reviewed provider integrations and configured testnet rehearsal. The local builder completes this small authoring slice; it does not complete the entire takeover brief.

## Read-only production observation

Checked on 2026-09-21: GitHub's latest returned `Production` deployment was `6470347826`, SHA `607f21337941fc1bd98a3651fde8953b981d5f91`, created `2026-09-15T23:16:35Z`, with a success status at `23:16:37Z`. This reports GitHub deployment metadata, not a guarantee about every alias/cache instance.

The public artwork API returned `v41:84532:28`, auction/active auction `63`, status `auction`, start price `0.00001`, current bid `0`, minted `false`, end `2026-09-23T18:38:28+02:00`. The indexer therefore knew round 63 at that read; this cannot prove that historical delay alone caused the reported video behavior.

## Interpretations and unfinished boundaries

1. Existing `twitter_handle` is retained as the self-reported public link, avoiding a destructive cleanup/migration. OAuth canonical X identity is `twitter_id` plus `twitter_username`; public IDs are not exposed. Provider flow references: [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2), [X authorization code flow](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code).
2. Invalid AI guidance is unavailable; the frontend does not reorder, fabricate, or regenerate a valuation from discovery heuristics. AI never sets settlement price or floor.
3. A comma is accepted as one unambiguous decimal separator; thousands separators and more than 18 decimal places are rejected.
4. Collection authoring is a reversible local draft. Origin supply, allocation, pricing fallback, fees and Genesis changes remain proposals. A supported registry entry does not imply deployed contracts or working chain integration. No Ink implementation was added.
5. Network parameters were checked against official [Robinhood connection documentation](https://docs.robinhood.com/chain/connecting/) and [Base chain-ID documentation](https://docs.base.org/base-chain/api-reference/ethereum-json-rpc-api/eth_chainId). Draft networks: Base Sepolia 84532 and Robinhood testnet 46630, ETH with 18 decimals, writes disabled. Existing 1/1 writes remain Base Sepolia only.
6. Collection contracts, services and SQL from prior work are preserved. Services remain unwired, SQL unapplied, and deployment/terms-locking unavailable. Newsletter send/save consistency still needs a dedicated implementation decision. No real-provider acceptance, newsletter send, collection deployment or launch is claimed.
7. The prior contract audit remains open, including pause/default timing, resale listing revival, recipient recovery, unsafe mint handling and repeat core configuration. Those findings require separate scoped fixes and deployment review; this stabilization patch does not certify the entire live protocol.

## Continuation — September 23–27

The active workspace is now `C:\Projects\ArtSoul`. The prior implementation was
preserved in local commit `25917f0`, then the original checkout was switched to
that reviewed branch through Git. Its three dirty files were line-ending-only
changes and were backed up first. All 77 implementation/test fingerprints matched;
86 evidence files copied without a conflict. The former Codex worktree is detached
and locked as an archive. See [workspace evidence](../WORKSPACE.md).

A-34 now has a reusable presentation-only aura frame with no production eligibility
assignment; two tests and 32 theme/state/surface/viewport browser cases passed.
A-35 maps the active and dormant runtimes and all migration trees. A-38's bounded
dependency, CI and font changes have a clean install and explicit residual-risk
classification in the [dependency review](DEPENDENCY_TRIAGE_2026-09-23.md).

Collection Draft now checks compatibility with the isolated local contracts.
Twenty-nine focused tests pass; seven otherwise valid drafts reproduce unsupported
settings. Desktop/mobile edits, import/export, preservation and disabled publication
are verified. This closes the earlier capability-matching slice, not deployment or
approval of final launch terms. Wallet allowlists require reviewed Merkle proofs;
later-public routing is not silently converted to next-phase routing, and unknown
fields or missing constructor addresses never become activated configuration.

The September 27 built-browser replay exercised the actual profile, AI, auction and
collection pages with fixtures. The guest wallet check additionally loaded and
settled the real built SDK, confirmed guest state and system fonts, and observed
no external font preloads. External requests were deliberately blocked; console
errors from those blocks and injected API failures are classified in
`output/audit/final-browser-summary-2026-09-27.json`. These are not live OAuth,
Gemini, signed-wallet or real-phone acceptance results.

That replay found a real Back button recursion: applying its theme registered a
callback which ThemeManager immediately invoked, recursively registering again.
The source regression failed before the fix. Shared CSS variables now own the
button's appearance; history behavior is unchanged, reduced motion is respected,
and all five script references use version 6 with a content-hash guard. The built
AI replay after rebuilding passed with no unexpected console errors.

Final aggregate results and immutable source fingerprints are recorded in the
[current checkpoint](STABILIZATION_CHECKPOINT.md). Failed intermediate attempts are
retained: stale TODO/count assertions and source scans entering generated evidence
were corrected without weakening the actual UI/navigation invariants. Production
remains untouched. A8/A10 and the existing contract audit remain open.
