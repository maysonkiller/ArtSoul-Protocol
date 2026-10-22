# Stabilization checkpoint

Updated: 2026-10-23. Continue only in `C:\Projects\ArtSoul`, branch
`codex/takeover-audit`. Read `git status` and `git log -1` before editing.

October 23 TA-10 registration evidence (Canon 1/2/11; local, not activated):

- Resume HEAD `f004836`, same workspace/branch; preserved untracked authority
  files are excluded. No UI, contract, live schema or feature flag changed.
- `src/api/upload-registration-evidence.js` reuses the indexer's registration
  ABI and installed ethers. Its read-only verifier requires the pinned Base
  Sepolia chain/Core/code hash, exact creator and metadata URI, matching receipts
  and canonical block hashes on two RPCs. Relayed execution is valid; the outer
  sender is not substituted for the event's creator.
- Each RPC's own advertised finalized header is checked before choosing their
  common anchor. Code is checked at that anchor and the registration block;
  anchor/event headers are reread before returning evidence. This is deliberately
  stronger than the indexer's three-block lag for an immutable catalog write;
  it changes no auction timing or economics. See the official
  [Base finality stages](https://docs.base.org/specifications/transactions/transaction-finality)
  and [JSON-RPC block/receipt definitions](https://ethereum.org/developers/docs/apis/json-rpc/).
- A missing transaction hash can use a trusted explicit scan page (at most
  2,000 blocks, 128 returned logs and eight matching registrations). The result
  reports coverage/cursor and retains every match, cross-checked against receipts.
  No result proves absence or permits another send: `can_submit` is always false.
  RPC bodies/time are bounded; errors do not reveal endpoints or upstream text.
- Independent review found an unchecked higher finalized header; it was repaired
  and negative regressions added. The subsequent bounded review has no blocker.
  The focused suite passes 104 checks (59 in the new evidence suite), zero skips;
  build passes. Logs: `output/audit/registration-evidence-focused-2026-10-23.log`
  and `registration-evidence-build-2026-10-23.log` in the same directory.
- Actual read-only evidence: both existing RPCs verify artwork 36 at block
  `48908274` by reported hash and by an explicit five-block no-hash scan, and
  reject changed metadata. The verified common finalized anchor is `48939549`.
  Latest evidence after the review fix:
  `output/audit/registration-evidence-2026-10-22T23-18-49-628Z.json`;
  local reproducer `docs/private/verify-registration-evidence-2026-10-23.mjs`.
  No transaction was sent and no actual receipt delay was induced: A-83 remains open.
- The verifier is not connected to the public route or catalog writer. The current
  catalog cannot atomically retain block-hash/finality anchors or handle reorg
  discrepancies. Do not insert these observations through the old RPC and call
  durable recovery complete. Browser integration and legacy coverage remain open.
- Next concrete step: persist verified registration and its block/finality anchors
  atomically with the existing catalog/claim reconciliation, including repeated
  reads, multiple matching registrations and conflicting evidence tests. Keep
  activation disabled and preserve the original unverified reported hash.

October 23 deferred desktop observation (Canon 5/16/17):

- Resume HEAD `f004836`, same workspace and branch. The existing untracked
  `.codex/`, `output/` and two authority-policy files remain untouched.
- The owner reports a very brief Ownership flash when opening an artwork on
  desktop, slow Protocol activity / Provenance population, and delayed card
  auction timers after refresh. Possible subsection overlap is a hypothesis,
  not a diagnosed cause. Source: `Запись экрана 2026-10-23 004307.mp4`, retained
  in the owner's local screen-recordings directory (59,452,664 bytes). The
  file exists; no frame analysis or reproduction has been performed yet.
- The owner explicitly defers these repairs until the existing phase work is
  finished. Track the follow-up as October 23 TA-12 in `BACKLOG.md`; do not
  change these UI areas now or erase the separately accepted iPhone results.
  A beta decision must disclose this pending desktop observation.
- Next concrete step remains TA-10 bounded registration receipt/event recovery;
  no new wallet ceremony, deployment or UI repair is implied by this report.

October 23 TA-10 submission journal (Canon 1/2/11; released, rollout disabled):

- Resume HEAD `7a1adf7` in the same workspace. Native acceptance PR #328 is
  merged as `79fc7cb`; its exact candidate `62ac5a8` passed Linux/Windows/static
  CI `39867472947`. The squash produced identical trees on main and the task
  branch; an explicit ancestry-only merge preserved all unfinished source edits.
  After the later A-71 answer, Phase A is 80 done / 3 in progress; TA-10 remains
  additional unfinished work.
- The private claim now has a durable attempt timestamp and optional reported
  transaction hash. Atomic begin requires the matching prepared metadata and
  owned deployment; concurrent/lost-response retries return the same attempt
  with `submission_created: false`. A late hash is recorded idempotently, never
  substituted or treated as confirmed registration. Indexer registration and
  conflict reconciliation preserve this evidence. No expiry/release is added.
- Authenticated begin/report/status actions share the existing disabled route.
  All responses retain `can_submit: false`; neither a begin nor `RESUME` allows
  a browser broadcast. This is private recovery scaffolding, not an activated
  duplicate-file restriction. No live migration, flag or contract was changed.
- The bounded independent review found no blocker and requested a real
  `record_artwork_media_identity` integration check; it is included alongside
  race, lost-response, failed-write and private-access cases. The extended
  PostgreSQL suite passes 30 checks and the API suite 22. Build passes.
  Full local workspace run: 2051 pass / one failure / zero skips; the sole
  failure was the missing migration-ledger entry, which is now added. The
  subsequent ledger/security/no-default-grant rehearsal passes all 43 checks
  with the new migration included. Counts, close-out and branded-wait checks
  also pass (13 checks). Logs: `output/audit/media-submission-full-unit-2026-10-23.log`,
  `media-submission-grants-2026-10-23.log` and `media-submission-build-2026-10-23.log`
  in the same directory. The untracked authority tests remain excluded from Git.
  Exact candidate `0518cfb` passes hosted CI `39868754680`: Linux 2021 pass /
  2 skips; Windows 1803 pass / 17 skips; zero failures, and 46 contract tests
  pass on each OS. Log: `output/audit/media-submission-candidate-ci-2026-10-23.log`.
- PR #329 is merged as `dbefd6840ea5765dc2f4041731925ac6174987a6`; this workspace
  fast-forwarded without replacing files. Production deployment `7265815674`
  succeeded at 23:02:47 UTC on October 22 (October 23 Warsaw). Preview and apex
  checks match eight pages and 57 assets. All five guest preparation/journal
  actions return private/no-store 401; GET returns 405. Server code is published,
  but live schema, feature flag, browser integration and enforcement are not
  activated. Exact evidence: `output/audit/media-submission-apex-dbefd68-2026-10-23.json`
  and `page-font-apex-dbefd68-release-2026-10-20.json` in that directory. These
  checks do not claim a live journal write or any wallet transaction.
  Post-merge main CI `39869122331` also completed successfully.
- Interpretation: reported hash means unverified client evidence, not an
  on-chain state. A missing hash or an empty indexer query never proves that
  nothing was sent. Recovery must establish positive chain evidence before
  connecting this journal to the browser. Existing contract writes remain
  permissionless and bypass any website-only restriction.
- Next concrete step: add bounded receipt/event verification against the pinned
  Base Sepolia Core and reconcile the exact creator/metadata registration with
  the existing catalog. Keep activation disabled through reorg and legacy
  coverage checks; do not authorize replay from a timeout or a client rejection.

October 23 native visual acceptance (Canon 5/16/17):

- Resume HEAD `826281e`, same workspace/branch and preserved untracked files.
  The owner answers the outstanding, scoped iPhone observation question:
  whole-page/empty-card flicker, delayed names/avatars and wrong profile-tab
  lists are no longer observed. This is owner-reported acceptance of the
  completed phone run, not a new agent-captured trace or quantitative timing.
- A-47/A-53/A-54/A-58/A-61/A-72 are now done, combining this native outcome with
  published repairs and prior desktop/regression evidence. Do not repeat
  accepted visual, login, OAuth, publication, X or Donate/Report ceremonies.
  Android remains owner-waived / not tested.
- A subsequent explicit owner answer accepts browser Back: the gallery returns
  to its previous position without flicker or visible reconstruction. A-48 is
  done with prior desktop BFCache/lazy-image evidence; no Safari cache marker
  or `pageshow.persisted` measurement is inferred from the phone observation.
- A further scoped answer confirms the ArtSoul mark appeared without empty
  cards after the successful iPhone publication. A-71 is accepted; no new
  transaction or deliberate receipt-delay case is inferred.
- Counts: 80 done / 3 in progress / 0 planned. Remaining formal rows are
  A-57 (historical provider-error disposition), A-83 (actual delayed-receipt recovery), then
  A-23 (beta decision). Additional TA-10 exact-file enforcement remains open.
  No unasked delayed-receipt outcome is inferred.
- Acceptance bookkeeping verification: `node scripts/sync-phase-a-counts.mjs
  --check`, seven existing close-out/status-summary/header-acceptance tests and `git diff --check`
  pass. This update changes documentation only; the prior application release
  and its build/runtime checks remain the implementation evidence. Hosted CI
  identified an older documentation assertion that required A-48 to stay open;
  it now checks the dated acceptance and its explicit native-telemetry limit.
- The next TA-10 read-only review confirms that the current browser stores a
  pending record only after receiving a transaction hash, while unknown
  no-hash attempts are discarded by display-card cleanup. The new server
  issuance/claim survives, but contains no submission journal yet. Never use
  those display cards as authoritative submission evidence or treat `RESUME`
  as permission to broadcast again. A client rejection is not server proof
  that no transaction exists.
- Next concrete step: add a private, atomic submission journal for the existing
  publication UUID before wallet submission, idempotent hash recording and
  recovery reads. Keep rollout disabled until confirmed receipt/event and
  indexer/reorg recovery is integrated; absence from current logs is not proof
  of cancellation. No timeout-based claim release or new contract behavior.

October 23 TA-10 upload preparation (Canon 1/2/11; released, not activated):

- Resume HEAD `a29dd90124472d872820400b75428f4d6bbf68c8`; remote main remains
  `66a3dde` at that preflight. PR #327 is now merged as
  `3f12c48598a1e594808711b3ae9b27305237b65d`; this workspace fast-forwarded
  without replacing files. Existing untracked authority-policy files, `.codex/` and `output/`
  are preserved and excluded from this change. No additional checkout exists
  for this work; older registered worktrees remain recovery/history only.
- The new private preparation table durably records wallet/deployment and fixed
  media/metadata paths before upload authorization. Its service-only RPC pins
  actual original-byte SHA-256, size, MIME and exact metadata once. Retrying
  preserves the record; changing pinned data or another wallet's request fails.
- `POST /api/upload/publication` authenticates the wallet, pins Base Sepolia/Core
  from server configuration and remains disabled by default. It binds every
  consumed creator/media alias using the existing metadata shape, writes
  metadata without overwrite, reads it back and only then claims the hash.
  Lost upload/write responses recover from verified existing bytes/JSON.
  Every response says `can_submit: false`; `RESUME` never authorizes rebroadcast.
- The existing upload route reuses its extracted signing helper with the same
  response shape. The byte verifier now accepts the existing issuer's full
  101-character filename output (96-character stem plus `.webp` / `.webm`).
  No file format, title rule, AI guidance or contract behavior is changed.
- Focused API checks: 19 pass. Disposable PostgreSQL preparation checks: 21
  pass, no skips, including authenticated API-to-real-SQL integration and
  concurrent retries. The independent review's existing-object signing concern
  is fixed and rechecked. The build passes. Complete local workspace unit run:
  2040 pass, zero failures/skips, using the existing collector with file
  concurrency 2 (includes preserved untracked tests, excluded from the PR).
  Log: `output/audit/media-preparation-full-unit-2026-10-23.log`; runner:
  `node docs/private/run-phase-a-unit-2026-10-23.mjs`. This includes the actual
  no-default-grant migration rehearsal, not just static SQL checks.
- Exact candidate `dc137c0` passes CI `39864320530`: Linux 2009 pass / 2 skips,
  Windows 1800 pass / 17 skips, zero failures, and 46 contract tests per OS.
  Linux skips are Windows custody tests; local Docker covers the SQL groups
  unavailable on hosted Windows. Logs:
  `output/audit/media-preparation-ci-{linux,windows}-2026-10-23.log`.
- Production deployment `7265216560` succeeded at 2026-10-22 22:25:34 UTC
  (October 23 local time). Preview and apex match all eight checked pages and
  57 assets. Evidence: `output/audit/page-font-{preview-dc137c0,apex-3f12c48}-release-2026-10-20.json`.
  The new route denies anonymous POST with 401 and `private, no-store`; preview
  also rejects GET with 405. No authenticated production write was exercised.
  Post-merge CI `39864805267` also passes both OS jobs and static checks.
- Not applied: both media migrations remain manual rollout prerequisites;
  no production schema/flags, browser publishing flow or on-chain state changed.
  Phase A remains 72 done / 11 in progress; TA-10 remains additionally open.
  Exact bytes are file identity, not copyright evidence or title reservation.
- Fresh anonymous projection reads identify the old inventory's four unresolved
  rows: artworks 1-4 have empty media URLs and only historical metadata URIs.
  These reads cannot establish their original-byte hashes. No record was removed,
  repaired or marked verified, and hidden/unindexed coverage is not inferred.
- Next concrete step: implement durable submission/recovery coordination for
  the same publication UUID, with unknown-broadcast and confirmed-event/reorg
  tests, before switching the browser. Legacy coverage and actual storage-policy
  verification remain activation gates. The bounded helper has finished.

October 22 TA-10 exact-media foundation (Canon 1/2/11; merged, not activated):

- PR #326 is merged as `66a3ddee4ac4c60dc1e91fe7ebc5e8aea7eec90e`; this
  workspace fast-forwarded to that exact main commit without disturbing the
  existing untracked files. Production deployment `7264434883` succeeded at
  21:43:59 UTC. Preview and apex HTTP verification match all eight checked pages
  and 57 assets. This code release does not apply the manual database migration
  or enable website duplicate enforcement.

- Native acceptance is recorded in commit `f37cd18`, following application
  merge `fb9dde0`. Phase A is 72 done / 11 in progress; the extra TA-10 website
  duplicate guard is still in progress, not silently counted as complete.
- `src/api/upload-media-identity.js` hashes actual original storage bytes with
  Node SHA-256, bounded streaming, the existing 50 MB/MIME policy, a deadline,
  wallet-owned issued-path format validation and the existing host allowlist. It never
  accepts a supplied digest or image-transform URL as byte identity. Ten tests
  pass, including renamed files, false Content-Length, stream timeout and
  foreign paths. A read-only live call verifies artwork 36's 1,493,557-byte PNG:
  `17978df015cc2175624a73dcba8a57fba15ffd05ebfb0b23f5acb986f9125f10`.
  Evidence: `output/audit/upload-media-identity-live-2026-10-22.json`.
- `sql/migrations/artwork_media_identity.sql` adds a private historical catalog
  and deployment/hash-unique publication claims. Two service-only RPCs preserve
  identical retries, serialize catalog/claim races, reconcile matching confirmed
  registration and block conflicts without deleting history. Explicit grants,
  revokes and forced RLS cover the changed Supabase default-grant behavior.
  It is a manual migration, not part of automatic indexer setup.
- The disposable PostgreSQL 17 suite passes 21 tests with no skips, including
  real concurrency, permissions, rollback and legacy duplicates. The server
  verifier has independent review; 48 focused policy/docs/security checks and
  `npm run build` pass. Initial full run: 1986 pass / 14 fail. Two failures
  correctly require the migration in the disposition ledger and no-default-grant
  rehearsal; both registrations are fixed and the 21-check rehearsal/ledger
  rerun passes. The other 12 are two existing indexer suites' temporary Docker
  TCP startup failures; both suites pass all 12 checks when rerun sequentially.
  Do not describe that initial full run as green. Logs are
  `output/audit/media-identity-{full-unit,grants,existing-pg-recheck}-2026-10-22.log`.
  Exact corrected candidate `de37f0f` passes hosted CI `39858992650`: Linux
  1969 pass / 2 skipped, Windows 1780 pass / 16 skipped, zero failures, and 46
  contract tests per OS. No new dependency, live migration or transaction occurred.
- Interpretation: exact bytes identify a repeated file, not copyright or
  authorship. Catalog rows retain all historical artwork references. These
  internal coordination states do not amend artwork/auction lifecycle states.
  No claim expiry, abandoned-attempt release or reorg policy was invented.
- NOT activated: no upload route or browser consumes this foundation yet.
  Before rollout it still needs server-issued preparation/metadata binding,
  safe cancellation/unknown-broadcast recovery, confirmed-event/reorg integration
  and a full legacy coverage report. The unchanged permissionless contract
  cannot enforce website uniqueness. Existing publication remains unchanged.
- Next concrete step: connect authenticated, server-issued upload preparation
  to immutable metadata and the verified claim, with rejection/retry tests,
  before enabling any website duplicate block. The bounded helper is finished.
  Focused integration review at `66a3dde` confirms two activation blockers:
  metadata repeats creator/media in multiple aliases, and the public adapter
  can prefer image/animation_url over media_url; bind every consumed alias.
  Existing upload/profile pending-card cleanup removes records without a
  registration hash, so prepared/uncertain operations need durable server
  issuance and recovery separate from display cards. SQL `RESUME` is only an
  identical preparation, never permission to broadcast another registration.
  Preserve the existing upload helper's return shape for unrelated callers.
  This review changed no code or external state; the single helper is finished.
- Owner follow-up: both Donate and Report open and close correctly on the real
  iPhone; the page, logo and wallet button keep their positions without stretch.
  This closes native modal geometry acceptance for PR #320/#322. Do not ask for
  this trip again. It does not imply BFCache or delayed-receipt recovery.

October 22 native publication and X acceptance (Canon 1/2/5/17):

- Resume HEAD `fb9dde0c063237ad90198e0e040dd5a061de2a28`, same branch and
  workspace. Preserved the existing tracked documentation diff in
  `output/audit/before-mobile-acceptance-2026-10-22.patch`; unrelated untracked
  authority-policy files, `.codex/` and `output/` remain untouched.
- The owner confirms successful iPhone Chrome/MetaMask publication and actual
  X sharing. The supplied 23:14 screenshot shows "Web 3 Rialo test", creator,
  live-auction wording, 0.0001 test ETH, Base Sepolia and the actual artwork image.
  This is native/user acceptance, not a synthetic browser result.
- Independent Base and PublicNode reads agree: artwork 36 belongs to
  `0x6EC8C121043357aC231E36D403EdAbf90AE6989B`, active auction 70 references
  artwork 36, start price is 100000000000000 wei, no NFT/floor exists yet.
  Core runtime hash is `0xa5409acf771b939445714ede5c8aeeb6db4567a5c759beec807f17f83f874d8b`.
  Registration `0x7165fc4aab96e1bb6087903fc1f5370d006ce22508b8ead45fa1de0047cc0d2f`
  and auction `0x2ba1c2930d12f4dd50537abc0e7494792d935128eedd74abf6c331f4ac77f028`
  both succeeded. The exact public projection/provenance contains one of each.
  Outer transaction senders are relayers; creator identity is checked against
  events emitted by the pinned Core and its storage, not assumed from tx.from.
- Reproducible read-only verifier:
  `node docs/private/verify-mobile-publication-2026-10-22.mjs`; result:
  `output/audit/mobile-publication-accepted-2026-10-22.json`. Initial verifier
  assumptions about the API field and direct sender were corrected against
  actual API/receipt evidence; no product mutation or signing occurred.
- TA-11 is accepted. A-33/A-64/A-78 now combine this native publication with
  their recorded prior composition, connection/network and resale evidence.
  A-71's immediate post-publish frame and A-83's deliberate receipt-delay
  recovery are NOT inferred. Native dialog geometry/BFCache remain separate.
- Next: implement the first reviewed TA-10 server-side exact-byte identity
  change with regression tests; do not claim unchanged contracts enforce it.

October 22 later publication video follow-up (Canon 1/2/5/16; superseded acceptance above):

- Resume HEAD `0378eb7f9296476b71cc66ec1df18004619e9b7b`, same workspace.
  The previous tracked checkpoint/close-out diff is preserved in
  `output/audit/before-publish-network-2026-10-22.patch`. Unrelated untracked
  authority-policy files, `.codex/` and `output/` remain untouched.
- Reviewed the new 2:16.70 iPhone video `IMG_2546.MP4`. Around 00:48–00:51,
  guidance is present and the form reaches Ready to publish; around 00:54–00:56
  it enters Registering artwork and opens MetaMask; around 01:03 the site shows
  the generic Base Sepolia error. Repeated attempts reproduce the symptom.
  The visible wallet screen is its dashboard, not a transaction approval.
  No internal exception or receipt is visible; do not invent one. Frames are
  under `output/audit/publish-video-2026-10-22/`.
- Two independent live RPC reads confirm chain 84532, sufficient creator gas
  balance, unpaused Core and successful registerArtwork estimation. No signing
  or transaction was performed. Current success cannot prove historical RPC
  health. A bounded helper found mobile read RPC still uses only the SDK's
  first endpoint; this remains a limitation, not a proven video cause.
- Actual apex Chromium/WebKit, 390px, real deployed ethers plus a synthetic
  EIP-1193 peer reproduce the exact misleading message for both error 4100
  (unauthorized account) and -32603 (unknown provider failure). No storage,
  AI or chain write is real in this probe. Evidence:
  `output/audit/publish-wallet-before-2026-10-22.json`.
- Local repair traverses bounded nested wallet errors; preserves distinct
  rejection, insufficient funds, session and chain-change guidance; unknown
  submissions show only safe stage/method/code diagnostics and instruct checking
  wallet activity before retry. A recorded registration hash survives connection
  changes; only a proven failed receipt may remove its pending record. Auction
  failures retain the fact that registration already succeeded. No auto-resend.
- Every guarded write refreshes its signer from the current provider even on the
  same chain. A false network-preparation result stops the write. Registration
  and initial auction both check the upload's authorized wallet/chain. Back is
  omitted only on Upload; history functions and other pages remain available.
  Both modified runtime cache pins advance across all consuming pages.
- Corrected pre-patch fixtures fail 8 of 11 checks (the first run also exposed
  two fixture history assumptions, corrected before recording the baseline).
  Final focused checks pass 121/121 and the build passes. The independent review
  caught a post-broadcast network-change regression and stale cache pins; both
  are repaired with retained-hash coverage. No dependency or canon economics
  changed. Interpretation: the video proves a failed user journey, not an RPC
  outage; no hidden wallet error is attributed to the owner.
- First candidate CI `39851012395` found one stale secondary A12 test still
  expecting contract runtime v12; both OS suites otherwise passed. Its expected
  version is updated to v13, matching all five pages and the hash guard; full
  CI is rerun on the corrected candidate. This was not a phone-flow failure.
- PR #325 is merged as `fb9dde0c063237ad90198e0e040dd5a061de2a28`; production
  deployment `7263337939` succeeds at 20:49:22 UTC. Corrected candidate
  `ccc454258a78cd6e7c356eca4e33f048dcfa8ad9` passes CI `39851594302`: Linux
  1938 pass/2 skip, Windows 1769 pass/15 skip, and 46 contract tests per OS.
  Preview `7263264508` and apex match eight pages and 57 assets. The final
  numeric-zero receipt hardening also passes 12 targeted recovery checks.
- Actual released Chromium/WebKit code at 390px and 1440px passes all four
  synthetic-provider journeys: no Upload Back control, precise 4100 session
  recovery, unknown -32603 submission diagnostics without a false unsent claim.
  Both attempts reach the actual ethers send method; no real transaction is
  signed. Evidence: `output/audit/publish-wallet-after-2026-10-22.json`,
  `publish-video-final-ci-2026-10-22.log`, and
  `publish-video-{final-preview,apex}-artifacts-2026-10-22.log`.
- Read-only RPC evidence is saved in
  `output/audit/publish-read-only-chain-2026-10-22.json`. Before asking the owner
  to retry, both RPCs report artworkCounter=35; the anonymous projection has
  35 works and no Piwko title. This does not predict a later wallet response.
- Current HEAD is `fb9dde0` in the same branch/workspace. Post-release edits
  affect only this checkpoint, backlog and close-out report; preserve them on
  continuation along with the unrelated untracked entries. The bounded helper
  has completed; no additional agents were launched.
- Next: collect one native iPhone publication result or its new precise error
  (requested after apex verification). Do not claim the underlying recorded
  phone failure is solved until that result exists. TA-10 remains independent
  unfinished work; Phase A remains open.

October 22 upload validation follow-up (Canon 05/11/12/16):

- Resume HEAD `1214e7d9d177e0801bb4b0513067b42131882a5b`, same checkout.
  PR #322 consumes card action links once. Candidate CI `39842627269` and
  post-merge CI `39843119661` pass; production `7262009091` succeeds.
  Preview/apex match eight pages and 57 assets. Actual apex Chromium/WebKit
  card-menu Donate/Report and contextual Share checks pass; see
  `output/audit/card-actions-share-apex-2026-10-22.json`.
- The owner now reports rejected filenames/titles while publishing. Both the
  client and signed-upload API reject screenshot/camera filenames. The client
  also rejects short titles and broad prefixes such as Photo and Untitled.
  Any details error focuses the title, including a short description or bad
  price. The owner explicitly asks to accept ordinary titles and device files.
- Local repair removes both filename heuristics and the title blacklist,
  retaining a nonempty title, existing format/50 MB bounds, authentication and
  sanitized random storage paths. Details errors identify their actual field
  with inline feedback and clear on editing. Price entry reuses the existing
  exact ETH parser, accepts decimal commas and removes the unrelated HTML
  0.01 step constraint. Mandatory AI and contract economics are unchanged.
  Five new regressions fail before repair; focused tests pass 39/39 and the
  production build passes. No dependency added.
- Actual apex Chromium/WebKit at 390px and 1440px reproduces screenshot-name
  rejection, Photo-title rejection and description errors focusing the title.
  It also exposes input events being rendered as `[object InputEvent]` in the
  readiness hint; the repaired input listener calls readiness without passing
  the event as a message. Evidence: `upload-validation-before-2026-10-22.json`
  under `output/audit/`. All writes are blocked in the isolated probe.
- Interpretation: filename is not artwork title, and a common title is not a
  unique NFT identifier. OpenSea documents separate media/name metadata, not
  a global title reservation. No title-uniqueness restriction was invented.
  The 12-to-1000-character description requirement remains unchanged.
- **Newly confirmed gap:** the existing browser SHA-256 is only stored in a
  pending local draft. `contracts-integration.js:uploadArtwork` ignores its
  `_fileHash` argument; `ArtSoulCore.registerArtwork` only checks a nonempty
  metadata URI. Neither the API nor contract enforces file uniqueness. Earlier
  chat language implying existing duplicate protection was incorrect and has
  been corrected. Owner requests duplicate protection; deployment scope is
  being clarified. Do not mark it implemented or replace it with a title check.
  A server implementation needs verified bytes, atomic reservations, bounded
  legacy coverage and registration reconciliation. It cannot prevent direct
  calls to the unchanged permissionless contract. Cropped/re-encoded images
  are not byte-identical; no visual copyright guarantee is implied.
- Preserve unrelated untracked authority-policy files, `.codex/` and `output/`.
  One narrowly scoped read-only helper checked duplicate enforcement and has
  completed. The final bounded diff review also found no blockers.
- PR #323 is merged as `8ba8082c6fdbc89aff6919e5ed715c289c857651`; production
  deployment `7262421713` succeeds. Exact candidate `4ae2a0f` passes CI
  `39845339997`: Linux 1927 pass/2 skip, Windows 1758 pass/15 skip and 46
  contract checks on each OS, zero failures. Local full suite: 1958/1958,
  including the unrelated preserved authority-policy tests. Preview and apex
  match eight pages and 57 assets; guest moderation remains denied. Evidence:
  `output/audit/upload-input-{preview,apex}-artifacts-2026-10-22.log`.
- The owner delegates the duplicate-protection approach and says new test
  contracts will be prepared before mainnet. Sequence: website publishing
  protection first, contract enforcement reviewed for that later deployment.
  No current contract replacement, migration or duplicate deletion is performed.
  Common artwork titles remain allowed; filenames are not identity keys.
- A read-only inventory hashes 31 of 35 anonymous Base Sepolia projected works
  (47,643,763 downloaded bytes). Exact-byte pairs: artworks 6/13, 8/32 and
  14/15. Four legacy media URLs are outside the reviewed fetch allowlist and
  remain unresolved. This does not cover hidden, archived or unindexed media,
  nor establish authorship. The first inventory attempt lacked the public
  storage-origin environment and downloaded nothing; the configured retry is
  `output/audit/public-media-hashes-checked-2026-10-22.json`. Nothing is mutated.
- Post-release form probes pass in Chromium but reveal a second actionable
  WebKit defect: after editing price, the first analysis tap never reaches the
  handler. Explicitly settling scroll does not fix it. Field blur rewrites the
  unchanged button text node between pointer-down and click. Suppressing just
  these redundant assignments in the isolated client makes both WebKit layouts
  reach Ready to publish. This is an actual DOM/touch reproduction, not a native
  wallet ceremony. A late real guest-runtime event also interfered with the
  synthetic wallet fixture; it is explicitly isolated, not counted as a product
  account-switch failure. Evidence: `upload-validation-after-webkit-{settled,guard}-2026-10-22.log`.
- Local follow-up preserves unchanged text nodes on both analysis and retry
  buttons. Its new regression fails before repair; focused suite passes 40/40.
- PR #324 is merged as `0378eb7f9296476b71cc66ec1df18004619e9b7b`; production
  deployment `7262695828` succeeds. Candidate `88cabb2` passes CI `39847285561`:
  Linux 1928 pass/2 skip, Windows 1759 pass/15 skip, plus 46 contract checks per
  OS. Preview/apex each match eight pages and 57 assets. Actual released code,
  without the diagnostic text-setter guard, now passes all four Chromium/WebKit
  390/1440px form journeys: camera/screenshot filename, short Unicode title,
  precise comma price, correct error focus, and first-tap Ready to publish.
  Evidence: `output/audit/upload-validation-after-2026-10-22.json` and
  `upload-button-blur-apex-artifacts-2026-10-22.log`. Synthetic provider/session/AI
  responses are still used and real guest-runtime events are isolated; no native
  wallet, model, upload or chain transaction is claimed. The owner has been asked
  to repeat this specific blocked step on the real iPhone, without renaming media.
- Current app HEAD is `0378eb7` in the same checkout/branch. Only this checkpoint
  and the close-out report are being updated after release; the unrelated four
  untracked entries remain preserved. Next: implement TA-10's server-verified
  byte identity and atomic publication coordination. Include pending/uncertain
  registration recovery, deployment-scoped identity, explicit Data API grants
  and legacy coverage before activation; do not ship a raceable client-only
  check or claim a hash proves copyright. Native publishing acceptance remains
  pending independently. No helper is running.

October 22 mobile publishing and share follow-up (Canon 05/11/12/16):

- Resume HEAD `a4b06f8437d14fa71468b410ef80597f83731a8e`, same checkout.
  PR #320's Donate/Report repair is published. Candidate CI `39447392182`
  passes Linux (1908 pass/2 skip) and Windows (1739 pass/15 skip), plus
  46 contract checks per OS; production deployment `7203757517` succeeds.
  Eight apex pages and 57 built assets match. Post-release Chromium/WebKit
  probes at 390px and 1440px keep the header and document geometry stable
  while both dialogs open/close; text fields are 16px. Evidence:
  `output/audit/artwork-actions-after-2026-10-20.json`. Native iPhone keyboard
  zoom acceptance remains separate; no payment or report was submitted.
- The owner identifies iPhone Chrome with MetaMask and supplies the exact
  pre-analysis error screenshot. An isolated actual-apex fixture reproduces
  the same message in both engines when the connected wallet reports chain 1:
  the handler stops before session/signature/analysis because it rejects the
  network without calling the existing provider-confirmed switch guard, then
  loses `UNSUPPORTED_NETWORK` in the generic publish-error mapper. This is a
  confirmed failure path, not proof of the owner's unseen selected chain.
  Evidence: `output/audit/upload-wrong-chain-before-2026-10-22.log`.
- Local repair reuses `ensureArtSoulWriteNetwork` before authorization,
  rechecks wallet/chain after signing, and retains specific retry feedback.
  Four new regressions fail before the patch; focused authorization,
  finalization and submitted-registration checks pass 24/24 afterward.
  AI remains mandatory before Publish; neither the model nor transaction
  lifecycle/economics changed. Native MetaMask handoff remains unverified.
- Local sharing repair prepares a canonical work link and a bounded draft
  with creator, lifecycle-appropriate price and explicit testnet context.
  Twitterbot receives work-specific HTML from the existing anonymous public
  projection, including its permitted image URL. Hidden work cannot leak via
  staff cookies; HTML is escaped. Other visitors retain the static page.
  Focused sharing/media/URL checks pass 36/36. Actual deployed conditional
  routing and X's own preview/cache still require separate verification.
- One bounded read-only review helper found no blocking issue and completed;
  no other helpers are running. Preserve unrelated untracked authority-policy
  files, `.codex/` and `output/`.
- Preview verification caught static-file precedence on `/artwork?id=...`:
  the short path served the correct work image, but the legacy query URL still
  served generic static tags. Replace only that ineffective rewrite with a
  temporary Twitterbot-only redirect of validated IDs to the existing short
  route; normal browser routes are unchanged. This follows Vercel's conditional
  [redirect configuration](https://vercel.com/docs/project-configuration/vercel-json#redirects).
  Both forms pass on the final preview and apex, with human responses unchanged.
- PR #321 is merged as `02356e0e58429a4466d3584a02bfc103937a552c` and
  production deployment `7261805010` succeeds on October 22. Exact candidate
  `1f66491` passes CI `39841335348`: Linux 1921 pass/2 skip, Windows 1752
  pass/15 skip, zero failures and 46 contract checks per OS. Post-merge CI
  `39841938134` also passes. The local full suite passes 1952/1952, including
  the preserved untracked authority-policy tests; that broader local count is
  not the public candidate's test count. Build passes all 11 routes.
  Preview and apex each match eight pages and 57 assets; guest moderation
  access remains denied. Evidence: `share-apex-02356e0-2026-10-22.json`,
  `sharing-upload-apex-artifacts-2026-10-22.log` under `output/audit/`.
- Actual-apex isolated Chromium/WebKit fixtures now reach Ready to publish
  after a synthetic wrong-chain switch and after synthetic sign-in; rejecting
  the switch retains its specific message and makes no analysis request.
  These six flows use synthetic provider/session/AI responses, not real keys,
  wallet approvals or model calls. The owner's iPhone Chrome/MetaMask check is
  pending. Evidence: `upload-{network,declined,sign-in}-after-2026-10-22.log`.
  Future-theme dialog probes also pass at both widths in both engines.
- The card-menu pass finds a separate reproducible issue: closing Donate leaves
  `action=donate` in the URL, and reloading reopens it. Local follow-up consumes
  only the supported one-time action once the form is permitted, preserving
  artwork ID, hash, other parameters and history state. It does not navigate
  or sign. A regression fails before the patch; the focused suite passes
  30/30 and build passes. Released as PR #322; see the newer entry above for
  actual card-button and deployment evidence.

October 20 mobile actions follow-up (Canon 05/11/12/16, A-33/A-47/A-71):

- Start HEAD `788ea280e9b8bc6d6ca1128f1497c71200d28dab`, same checkout.
  The owner reports improvement after the page-paint releases, then three
  concrete failures: Donate/Report zoom and displaced page after closing;
  X sharing uses the wrong image; mobile AI analysis does not progress before
  publishing. Do not treat this as complete native visual/publishing acceptance.
- Public apex probes reproduce Report changing the body scroll root: at a
  390px layout the sticky header moves from y=0 to y=-756 when opening the
  form. Donate's initially focused amount input and Report fields compute to
  14px, outside the existing mobile 16px zoom-prevention rule. Desktop WebKit
  does not reproduce physical iPhone keyboard zoom; that limit is explicit.
  Evidence: `output/audit/artwork-actions-before-2026-10-20.json`.
- Local dialog repair uses the native top layer for Report, as Donate already
  does, without mutating body overflow. Both focus a close control on opening,
  preserve scroll on focus return, and use 16px input text within bounded
  dynamic-viewport dialogs. Manual page zoom remains enabled. Report submission,
  donation recipient/value and wallet confirmation are unchanged. Focused
  regression: 35/35; production build passes, no new dependency.
- Isolated Chromium/WebKit touch probes of the existing upload entry reach
  analysis and Ready to publish when the synthetic wallet is already authorized.
  No provider, signature, model, upload or database write occurs in that fixture.
  This proves the click handler runs in that path, not native wallet handoff.
  The pending owner clarification concerns browser/wallet and any status text.
  Evidence: `output/audit/upload-click-before-2026-10-20.json`.
- X currently receives generic static ArtSoul metadata and a share URL copied
  from the address bar, including action parameters. Work-specific server
  metadata and contextual draft text remain to implement and verify.
- No helpers started. Preserve the unrelated untracked authority-policy files,
  `.codex/` and `output/`. Next: verify/release the bounded action-dialog repair,
  then finish sharing and the connected mobile analysis path.

October 20 whole-page first-paint follow-up (Canon 05/16, A-47/A-53/A-72):

- Start HEAD `338147d577d30779df1adbe095561d2a9af6e6f0`, same checkout and
  branch. The owner accepts PR #317's iPhone guest avatar and reports a separate
  whole-page flash. Record only this narrow acceptance; do not restart ceremonies.
- Read-only apex probes cover all eight product pages in Chromium and WebKit,
  390px Future and 1440px Classic, plus home/gallery reloads (40 traces).
  Chromium paints body content before its theme class in every tested route.
  Delaying the deferred theme script reproduces unthemed body frames in WebKit
  too. Body-specific CSS includes the Future loading mark. Evidence:
  `output/audit/page-paint-before-2026-10-20.json`
  and `page-paint-theme-delay-2026-10-20.json`, plus browser recordings.
- The head selects the theme early, but body-specific styles wait for
  DOMContentLoaded. Gallery/artwork also initialize React in Classic before
  syncing the selected theme. Local repair applies the head-selected class
  immediately after the body opens and uses that theme for the initial render.
  Existing body classes, theme switching and wallet behavior are preserved.
  Theme manager now has cache version 1 and a content guard.
- Ten new regressions fail before the patch. Focused checks pass 95/95, the
  local full suite passes 1934/1934 without skips, and build passes all 11 routes.
  PR #318 candidate `31ec2df54a17d29cf6ddd489e25a03267fa200bb` passes CI
  `39440988257` (Linux 1903 pass/2 skip, Windows 1734 pass/15 skip,
  zero failures; 46 contract tests per OS). Preview `7202634078` is verified.
  Merge `1a836d9de280268860d4c9da96811009352b85d8` is deployed successfully as
  `7202749229` at `2026-10-20T14:42:41Z`; post-merge CI `39441659833` passes.
  All eight apex pages and 57 script/style assets match the build; guest access
  remains denied. The app patch is published, and unrelated files are untouched.
- Empty roots while React initially loads and the actual artwork data wait are
  observed separately. No post-content disappearance or light-background flash
  was reproduced in these traces. Do not claim every native page transition
  fixed from this theme repair or hide genuine network waits behind a timeout.
- Evidence correction: the initial generic `.btn-main` measurement changed
  targets when the account menu was inserted. Withdraw that button-shape
  inference; it does not invalidate the independently captured body classes.
  The corrected probe pins the home hero button and checks loading-mark styles.
- Corrected post-release evidence: 64 route openings cover eight pages, both
  themes and both viewport widths in Chromium/WebKit. Thirty separate
  reload/link/Back traces and 12 delayed-theme traces pass. Every observed
  body frame has the selected theme and the appropriate loading-mark style.
  Route traces were recovered from the log after an automation click timed out
  waiting for continuously animated Future decoration to stop. Navigation was
  rerun using visible links' current pointer positions. These are instrumented
  desktop engines, not native iOS or BFCache acceptance. Evidence:
  `page-paint-after-routes`, `page-paint-after-navigation`,
  `page-paint-after-theme-delay` under `output/audit/`, dated October 20.
- The video review also reveals a separate late font swap. With a bounded
  900ms font-response delay, the same heading's width changes from 306.78 to
  315.14px in Chromium and 307.84 to 315.13px in WebKit after text is already
  visible. Font weight stays 700. Evidence: `page-paint-fonts-study-2026-10-20.json`.
  All nine Inter-loading pages request `display=swap`. The follow-up changes
  only that policy to `optional`, retaining the family/weights and using the
  existing fallback for the current document if Inter arrives too late.
  This follows [CSS Fonts](https://www.w3.org/TR/css-fonts-4/#font-display-desc)
  and the [Google Fonts API](https://developers.google.com/fonts/docs/css2).
  No new asset, dependency, layout color or architecture change.
  The new policy guard fails before the patch; the final focused suite passes
  101/101 and build passes. PR #319 candidate
  `64520ba0774d044aceaf265b020bf2b9da970003` passes CI `39443444864`
  (Linux 1904 pass/2 skip, Windows 1735 pass/15 skip, zero failures and
  46 contract tests per OS). Preview `7203029815` is verified.
- PR #319 is published as `6a255e31f2af3d0bbb091e319f9afabcc2d71f1b`.
  Production deployment `7203138766` succeeds at `2026-10-20T14:58:44Z`.
  Eight product pages, the lab font policy and 57 script/style assets match;
  guest moderation access remains denied. The final apex delayed-font run
  passes eight open/reload traces in Chromium/WebKit at 390px Future and
  1440px Classic. The browser receives `optional`; each heading keeps exactly
  the same measured text width before/after the delayed font response.
  Evidence: `output/audit/page-paint-after-fonts-2026-10-20.json` and
  `page-font-apex-6a255e3-release-2026-10-20.json`.
- The 1934-test local full run belongs to the preceding theme candidate, not
  the font follow-up; the latter has its own focused/build/full-CI evidence
  above. No unpublished application patch remains. The final release receipt
  is `docs/private/page-paint-release-2026-10-20.json`.
- Native acceptance of the two page repairs remains pending; the earlier guest
  avatar acceptance stays accepted. Phase A remains 69 done / 14 in progress.
  No architecture amendment or additional agent was needed. Next: reconcile
  the owner's pending iPhone page-flash reply against the published version.

October 20 native guest reload follow-up (Canon 05/16, A-53/A-61):

- Start HEAD `5149a1bc432a1f1e11b75875dbaa52d421b62ae4`, same checkout.
  The Supabase follow-up below is merged as PR #316 and deployed successfully
  (`7201555402`). Preserve the unrelated untracked files already listed below.
- The owner's new 9.68-second iPhone recording shows the guest bitmap absent
  while its button/name are visible at approximately 1.15, 2.75 and 4.25 seconds.
  This contradicts full acceptance of PR #314; its same-source assignment fix
  remains valid, but did not eliminate the initial image fetch/decode gap.
  Frame sheets: `output/audit/guest-video-2026-10-20/`.
- Read-only apex probes reproduce the gap in Chromium and WebKit with an
  explicitly delayed image response and empty browser contexts. The shared
  optimizer also changes the unmarked header image to lazy loading. Evidence:
  `output/audit/guest-first-paint-before-2026-10-20.json`. This desktop WebKit
  run is not a substitute for the native recording or native post-repair proof.
- Local repair: embed the unchanged canonical PNG into each shared header at
  dev/build time, keep `/default-avatar.png` as its logical identity, preserve
  its embedded source during prepaint, and declare eager synchronous decoding.
  This removes a separate first-frame network dependency, without hiding the
  button, changing the logo, adding a dependency or changing wallet behavior.
  The eight pages use bridge version 7 and dropdown version 56. Cost: about 34 KiB of raw HTML per page;
  compression reduces the transfer overhead. Other profile images stay external.
- Two new cold-load regressions fail before the repair. A further pre-release
  case catches a new fetch on logout from a cached connected avatar. The bridge
  now retains its embedded neutral bitmap for logout, wallet switches and image
  failures as well. Its logical identity remains the canonical URL.
  The expanded focused suite passes **166/166**, including connected-preview/account-switch
  protection and exact built bitmap bytes on all eight pages. Build passes
  11 routes/eight headers/174 utilities. Logs: `guest-inline-before`,
  `guest-inline-lifecycle-focused`, `guest-inline-build-final` under `output/audit/`,
  all suffixed `-2026-10-20.log`.
- Final local unit run: **1924/1924 pass, zero skips**, log
  `output/audit/guest-inline-full-unit-final-2026-10-20.log`.
  Build assertions also run as a hard gate in `verify-build.mjs`;
  the extra built-output unit case explicitly skips only without a local build.
- PR #317 is merged as `f183b78f92993362090d624f0a872a9a9cec5fd4`.
  Candidate `ca2ff85fbbecb2f3c50a568c1c1ea5c1c619f0f0` passes CI
  `39436940066`: Linux 1893 pass/2 skip, Windows 1724 pass/15 skip,
  zero failures and 46 contract tests on each OS. Local PostgreSQL checks above
  cover the environment-dependent cases; do not describe CI skips as passes.
  Production deployment `7202088484` succeeds at `2026-10-20T14:15:34Z`.
- All eight apex pages and 57 script/style assets match the local build.
  Actual apex first-frame traces pass on Chromium/WebKit at 390px Future and
  1440px Classic: initial opening, reload and clicking Profile (12 traces).
  Every observed header frame has its bitmap ready; zero neutral bitmap
  network requests occur, even with such requests deliberately delayed.
  Recorded WebKit frames also retain the avatar through reload/navigation.
  Evidence: `output/audit/guest-first-paint-after-2026-10-20.json`,
  `guest-inline-apex-f183b78-release-2026-10-20.json`, the associated browser
  recordings and `guest-inline-webkit-frames-2026-10-20/`.
- Current local application code matches the release. This release-evidence
  documentation update is a local follow-up; no unpublished application patch
  remains. Final receipt: `docs/private/guest-inline-release-2026-10-20.json`.
- No architectural ambiguity or canon amendment: only delivery of the existing
  header bitmap changes. Phase A remains 69 done / 14 in progress. No helpers
  started. The later owner reply accepts the narrow guest-avatar result;
  continue the separate whole-page investigation above.

October 20 Supabase Data API follow-up (A-02/A-35, Canon 11):

- Start HEAD `eefdab05ad39c259f8b111c4fa6608d70963122a`; same checkout. Preserve
  `.codex/`, `output/` and the two unrelated untracked authority-policy files.
- The official October 30 change affects new public tables/sequences, not
  existing grants. ArtSoul uses Data API; newer feature migrations already
  grant explicitly. No live permission repair or database write was needed.
- Read-only live evidence: 61 tables with forced RLS, one view, zero client
  table writes, zero missing service reads and six successful empty Data API
  reads. The private catalog preserves 19 sequences and the intentional nine
  RPC-only tables/two authority-owned sequences; do not "repair" their denials.
  Evidence: `docs/private/data-api-grants-catalog-2026-10-20.json` and
  `data-api-security-verification-2026-10-20.json`.
- Repair the migration runbook's missing fresh-environment hardening order and
  stale 001-014 runner wording. Never replay 18.7b after A8: its broad historical
  grants would restore direct authority writes. No applied SQL checksum changes.
- The read-only verifier now includes seven newer private/draft tables and
  reports missing service reads/default grants. Live missing/unclassified/RLS
  and client-write queries all return zero rows.
- New disposable PostgreSQL 17 rehearsal removes implicit grants before every
  feature, reproduces legacy access denial without hardening, and verifies
  reads, writes, sequences, private tables and RPC-only authority boundaries.
  Final focused command: `node --test test/data-api-grants-integration.test.cjs
  test/security-migration.test.cjs test/migration-ledger-coverage.test.cjs`:
  **43/43 pass, zero skips**, log `output/audit/data-api-grants-focused-final-2026-10-20.log`.
  Initial fixture errors (legacy prerequisite order, invalid event name and
  an unordered sequence-type predicate) were corrected without changing product
  migrations. Collection draft execution is local evidence, not activation.
  `npm run build` passes (11 routes, eight shared headers, 174 utilities); log
  `output/audit/data-api-grants-build-2026-10-20.log`.
- Only the root agent is running; its previous guest-avatar helper completed.
  The app's returned task inventory shows only this task active. No additional
  subagent was started for this follow-up.
- This follow-up changes verification/tests/docs only. Phase A remains 69/14;
  scoped native iPhone guest-avatar feedback is still pending. Next: finish
  required repository checks for this follow-up, then resume that existing gate
  without repeating wallet/OAuth/moderation ceremonies.

October 20 guest account-avatar follow-up (Canon 05/16, A-53/A-61):

- Start from `03fbae142b6ec8e7010c41f29ff89db28f2077f4` in the same checkout.
  The owner reports Ownership now looks good on iPhone, but the guest header
  avatar briefly flashes on reload without any wallet ever connected.
  Accept the scoped Ownership result; do not infer other device/publish results.
- `header-prepaint.js` assigned the same image source again while adopting the
  parsed guest shell. The shared component already avoided this unnecessary
  assignment. New desktop/iPhone-UA harness cases fail before the patch because
  the decoded image is reset, and pass when the bridge preserves the source.
  This reproduces the code defect, not an observed native WebKit frame.
- The bridge now preserves an unchanged image source. Cache version 5 is used
  by all eight shared-header pages, including the collection draft. Existing
  real-source preview, account-switch and logout regressions remain green.
  No theme, connection, authentication or protocol behavior changes.
- Focused regressions pass 138/138. Build passes 11 routes, all eight header
  pages and 174 utility checks. Evidence: `output/audit/guest-avatar-before-2026-10-20.log`,
  `guest-avatar-focused-final-2026-10-20.log` and `guest-avatar-build-2026-10-20.log`.
  An intermediate test caught the bridge's 7 KiB budget; the explanatory comment
  was shortened, not the budget relaxed. One read-only helper finished its review.
- Candidate CI caught two additional stale test-version declarations (three
  failing assertions on each OS). All page pins were already updated; the
  runtime hash/version ledger and the network-copy regression now also expect
  version 5. The application source is unchanged by this follow-up.
- Final candidate `15aa49291d2ce70a80fff838b5b73da0d026e91a` passes 164 expanded
  checks and 1905/1905 full local unit checks with no skips. Linux/Windows/static
  CI `39430587316` passes, including 46 contract tests on each OS. Logs are
  `guest-avatar-expanded-2026-10-20.log`, `guest-avatar-unit-bounded-2026-10-20.log`
  and `guest-header-ci-final-full-2026-10-20.log` under `output/audit/`.
- PR #314 merged as `56b17ef73cd633aee3414b5f240661ab5e59eadf` at 13:31:35 UTC.
  Production deployment `7201066858` succeeded at 13:32:01 UTC. Preview and
  apex HTTP checks verify all eight header pages, version 5 and 57 built assets,
  plus unchanged guest access denials. Evidence:
  `output/audit/guest-header-apex-release-2026-10-20.json`.
- An isolated Chromium in-app guest browser verifies one complete standard
  avatar after reload, the guest menu, and no horizontal overflow at a 390px
  browser width (375px content viewport). The temporary size override is reset.
  `guest-header-apex-browser-2026-10-20.json` and desktop/mobile screenshots
  record the final loaded state, not an unobserved native iPhone first-frame
  sequence. The browser did not support the attempted first-frame diagnostic
  instrumentation; no application state, wallet session or security setting
  was changed to work around that limitation.
- Tracked changes are this narrow bridge/test/cache-pin repair plus acceptance
  notes; historical untracked paths remain untouched. Phase A remains 69 done /
  14 in progress. The remaining acceptance review found no fully satisfied row
  to close solely from the current evidence. Both bounded helper tasks ended.
  No new signatures, setup or credentials are needed for this fix.
- Exactly next step: record the requested post-repair iPhone guest reload result,
  then continue the existing device/publishing acceptance sheet without repeating
  already accepted Ownership, OAuth or staff-factor ceremonies.

October 20 Ownership identity continuation (Canon 05 / A-47 / A-61):

- Continue in the same branch from `190f80ee849d1bd354e866a193a9f6b473e46459`.
  A-22/A8 remains accepted. The owner confirms the other recent changes work,
  but reports slow black avatar circles and wallet-to-name replacement in
  Ownership, with a desktop screenshot of artwork 34. This does not establish
  a new native iPhone pass for the unrelated profile/publishing criteria.
- The exact projection supplies only Creator identity. Client role requests
  start after first content and their shared completion waits for the slowest.
  Actual apex /34 timing: artwork headers 780ms; Creator/First Collector profile
  headers 1702ms/1431ms. Both profiles are genuinely absent, so those addresses
  must retain wallet labels and the standard avatar. Do not invent nicknames.
- The bounded repair supplies exact-only public role identities in one batch,
  skips redundant role/bidder reads, resolves uncovered roles independently,
  and reveals each decoded avatar with its name rather than an empty circle.
  No authority, transaction, economics or AI-valuation changes.
- Resumed from the unchanged SHA and seven-file diff on October 20; recovery
  patch saved to `output/audit/ownership-resume-2026-10-20.patch`. No other
  agents are running. The owner is away from the laptop and can only use an
  iPhone; do independent checks without repeating accepted factor ceremonies.
- Focused API/client regressions pass 49/49, including chain-colliding IDs,
  role deduplication, public-field allowlisting, confirmed absence versus query
  failure, independent fallback completion and decoded identity display.
  The profile batch starts independently of slow metadata/bids/signals.
  Final review also covers an uncovered Highest Bidder with no avatar; a
  completed bidder read must release its loading indicator.
  Production build passes 11 routes and 174 utility checks. Logs:
  `output/audit/ownership-focused-bidder-2026-10-20.log` and
  `output/audit/ownership-build-bidder-2026-10-20.log`.
- Full local unit run: 1877 passed, two disposable PostgreSQL startup failures,
  no skips. The affected Donate integration files then pass 25/25 sequentially
  without a code change. Both logs are retained as `ownership-unit-2026-10-20.log`
  and `ownership-donation-db-recheck-2026-10-20.log` under `output/audit/`;
  do not describe the initial all-at-once run as green or as a full run of the
  subsequent Highest Bidder edge-case patch.
- The final full local run (file concurrency 4) passes 1903/1903, no skips:
  `output/audit/ownership-unit-bounded-2026-10-20.log`. Candidate `57721aa`
  passed Linux, Windows, contract and static CI `39426262073`. Preview verification
  matches 199 assets across six pages, exact identity payloads and access guards.
  No declined local/preview browser check was retried.
- PR #312 merged as `bf6604df8413fd5f48255589e4000d6d3dec227e` at
  13:00:26 UTC; production deployment `7200357647` succeeded at 13:00:53 UTC.
  Apex verification matches the same 199 assets, private/no-store exact reads,
  enabled feature flags and guest protected-data denials. Base Sepolia indexer
  is healthy with zero observed lag. Evidence:
  `output/audit/ownership-apex-artifact-2026-10-20.json`.
- Actual apex Chrome: /34 has both complete default avatars and wallet labels
  without either ownership-profile request; /30 shows maysonkiller and a complete
  decoded portrait. The one remaining same-wallet profile read originates in the
  header, not Ownership. Observed artwork response headers: 1208ms (/34) and
  883ms (/30); these are samples, not a universal latency guarantee. A 390px
  desktop viewport has no horizontal overflow; its override was cleared.
  Artwork /19 also renders three distinct Creator / First Collector / Owner
  rows, complete avatars and correct profile links with no loading indicator.
  Evidence: `output/audit/ownership-apex-browser-2026-10-20.json` and screenshots.
- Historical untracked paths remain untouched. Phase A remains 69 done /
  14 in progress. The owner was asked only for the two repaired public artwork
  views on iPhone; no new authentication or signature is required. Native phone
  feedback is pending and is not inferred from desktop screenshots.
- Exactly next step: record the scoped iPhone Ownership result, then complete
  the remaining connected publishing/transaction acceptance from the existing
  device sheet. Do not replay accepted moderation, OAuth or account-switch runs.

Earlier October 15 final moderation UI acceptance:

- Workspace `C:\Projects\ArtSoul`, branch `codex/takeover-audit`; application
  HEAD `9a2965f0833089b5bd4f889b8beeeb2bcff40a2b` / PR #310. No source-tree
  copies or new worktrees. Historical `.codex/`, `output/`, and the two untracked
  moderation-authority-policy files remain untouched.
- PR #310 merged at 16:07:52 UTC after exact-candidate CI `38765668701` passed
  Linux, Windows and static checks. Production deployment `7097845201` succeeded
  at 16:08:18 UTC. The published apex matches 199 assets across six pages;
  guest protected-data denials pass, expected flags remain enabled, and Base
  Sepolia indexer lag is zero. Evidence:
  `output/audit/artwork-admin-stability-apex-artifact-2026-10-15-activation.json`.
- Actual apex artwork 34 opens Moderation tools on the first click, with Checking
  access feedback, then closes and returns focus correctly. At 390px the dialog
  is 358px wide within the viewport; the page has no horizontal overflow.
  `artwork-moderation-open-browser-2026-10-15.json` and the matching screenshots
  retain this result. This is a desktop breakpoint check, not a native phone pass.
- The owner's single-passkey confirmation and previous actual Admin DOM close
  the successful-login regression. No new setup, reset, complaint, donation or
  visibility write occurred. A-22 / canonical A8 are accepted again; the backlog
  and three count summaries agree at 69 done / 14 in progress / 0 planned.
- Focused application/API regression: 51/51; production build: 11 routes and
  174 utilities. PR #309's previous full local result is 1891/1891; it is not
  relabelled as a PR #310 run. The unrelated header test no longer forces A8 to
  remain unchecked. Documentation/count checks pass 6/6; application code is
  unchanged by the acceptance update.
- Preview browser navigation was declined and not retried through another
  surface. Existing authorized apex testing continued separately. Android stays
  owner-waived / not tested. The three iPhone symptom checks are pending owner
  feedback; do not repeat already accepted wallet, OAuth or factor ceremonies.
- Exactly next step: record the post-repair iPhone artwork result, then continue
  the remaining connected publishing/transaction acceptance from the existing
  device sheet without replaying the completed moderation rehearsal.

Earlier October 15 release and final artwork follow-up:

- PR #309 is merged as `e8c70cf0bfa2f142ab31c3ef96a090dd957f969c` (15:53:50
  UTC), production deployment `7097511209` succeeded at 15:54:17 UTC. Candidate
  `2ab3d3d`, CI `38763840178`: Linux/Windows/static all passed. Exact local
  application checks passed 1891/1891, no skips; build verifies 11 routes and
  174 utilities. A first run had one stale document-status assertion; the
  final frozen-source rerun is green. Preserve both logs under `output/audit/`.
- Preview and apex artifacts each match 199 files across six pages; guest
  private-data denials and expected feature flags pass, Base Sepolia lag is zero.
  Opening the preview URL in the browser was declined, so no preview UI run
  is claimed or retried through another surface. Existing authorized apex
  browsing continues separately. The local-browser fixture waiver is retained.
- The owner confirms a single existing passkey assertion now closes the login
  dialog. Actual apex DOM independently shows Verified, available review queue,
  zero open dialogs. No reset, enrollment or repeated network ceremony occurred.
  Evidence: `artwork-admin-stability-native-entry-2026-10-15.json`.
- Actual apex Report opens only by click and Cancel restores focus. History
  opens/closes correctly: artwork 18 is empty; artwork 34 has the two existing
  1-wei donations, with Largest support inside history, never inserted while
  collapsed. No report, payment or visibility mutation was submitted.
- Final staff-button inspection found a separate first-click race: the optional
  client sign-in restoration emitted an auth event and invalidated the opening
  read, despite existing server-verified access. Follow-up removes the redundant
  sign-in ceremony from these tools; GET and POST still enforce server session,
  role and factor, writes match the live connected wallet, and expiry directs
  staff to Admin. The button shows Checking access during its read. Focused
  endpoint/client regressions pass 51/51. A-22 remains open for this follow-up,
  not for another successful-login ceremony.
- Next step: release the bounded first-click repair after CI/build checks, verify
  opening/closing the tools on the apex without a visibility mutation, and record
  A-22 acceptance while leaving the remaining phone/publish/beta rows honest.

Earlier October 15 owner UI report (Canon 05/07/16, donation design):

- Continue from `d78f3b9`, branch `codex/takeover-audit`; PR #309 is not merged.
  Published application remains `ca77eb7` / PR #308. Four historical untracked
  paths are preserved. One existing helper completed the bounded Admin repair
  and review; no other agents remain active.
- Actual apex artwork 18 reproduces the expanded Staff moderation section.
  Source also places the largest donation outside the history disclosure and
  fetches history on every initial artwork visit. Local patch moves tools into
  an explicit staff-only dialog, retains server checks, and loads/shows donation
  history only after opening it. No payment, complaint or role operation ran.
- Avatar refresh replaced the same creator's hydrated profile with a sparse
  projection. Local patch retains that identity during refresh, waits for a
  resolved avatar, and keeps the same wallet's decoded image during replacement.
- Earlier apex Admin evidence already shows Verified and the queue behind a
  successful dialog. Both factor paths never closed that dialog. Local patch
  closes login intent after current server-confirmed access, before slow queue
  reads, preserves deliberately opened settings and guards focus/identity races.
  This does not prove rejection of the owner's first two passkey assertions.
- A-22/A8 UI acceptance is reopened for this repair. Operational evidence below
  remains accepted; no full 24-hour wait, factor reset or repeated network test
  is introduced. Other unaccepted iPhone/publishing rows remain open.
- The UI interpretation is explicit: Report stays a user-invoked form; staff
  visibility controls move behind a separate button; the largest-support line
  moves inside history. `SUPPORT_THE_ARTIST_DESIGN.md` records the placement
  amendment. No frozen architecture or economics changes.
- Next step: finish regression/build review, publish this bounded candidate only
  after green CI and preview verification, then verify the apex and one ordinary
  Admin login without reenrollment.

October 15 A-22 / A8 closure (Canon 07 / Bible 11 and 17):

- Continue from `4321663`, published application `ca77eb7` / PR #308, in the
  same checkout. Tracked source is unchanged; four historical untracked paths
  remain untouched. Reuse the exact-source passing baseline and release evidence.
- Independent bounded reconciliation found that a natural 24-hour wait is not
  required by canon 07, the rollout or migration runbook. Earlier audit notes
  promoted an unperformed observation into an extra gate. Fixed expiry and
  non-renewal have exact-boundary backend/client and compiled-browser evidence;
  real native setup/replacement, different-device entry and changed-network
  verification are separately accepted. No natural wait is claimed or waived.
- A-22 / canonical A8 are accepted by mapping the retained real complaint,
  recipient/project-mail, concurrency, restoration, failure-isolation and
  flag-preservation evidence. See the October 15 reconciliation at the top of
  `PHASE_A_MODERATION_ACCEPTANCE_2026-10-11.md`. The full Bible's section 11 now
  explicitly consolidates the already-approved October 8/11/13 policy so its
  historical October 3 Safe/bootstrap paragraphs cannot be read as current.
  This is a documentation correction, not a new role or authentication policy.
- Recheck: `node --test test/moderation-session-context.test.mjs
  test/protocol-admin-review.test.cjs test/admin-session-boundary.test.cjs`
  passes 48/48 with no skips. Log:
  `output/audit/a22-closeout-session-checks-2026-10-15.log`. No full-suite rerun
  is needed for unchanged application code; exact-source CI from PR #308 remains
  valid. The six document/count checks pass after updating their stale A-22
  assertion and removing an arbitrary requirement to keep nine rows open.
- GitHub has zero open issues at this observation. This does not prove absent
  device defects or authorize beta entry. A-23 and unrecorded publishing/phone
  criteria remain open. The owner reports a remaining iPhone visual problem
  after the October 15 repair; its page/action/symptom clarification is pending.
- A-78 comparison found adapter collision tests, deployed artifacts and real
  operator transactions, but no recorded native browser wallet-call/receipt
  pairing for the affected namespaces. Reuse an existing suitable token/auction
  for that check; do not start a new 24-hour auction just to collect evidence.
- Exactly next step: reproduce the owner's clarified iPhone symptom and repair
  its cause, while retaining the existing independent acceptance results.

October 15 Admin navigation follow-up (A-22; Canon 07 / 16):

- Continue from `bafb4ec`, published application `f84557be` / PR #307, in the
  same checkout. The owner confirms that the real network-change verification
  worked, but the next action was unclear until a page refresh. Record the
  access requirement as owner-accepted; immediate in-place guidance is a
  separate reproduced UI issue, not a new failed factor enrollment. Natural
  24-hour expiry remains unobserved.
- A same-wallet state event was ignored by Admin but unconditionally cleared
  Staff access, including its roster and prepared approval. The child now
  preserves an unchanged settled wallet/authentication pair. Actual identity,
  auth, unsettled-state and lifetime boundaries still clear it and fence late
  responses. No role, request, signature or factor is changed by this fix.
- Admin now has one stable header with the connected wallet, readable role,
  access state and sign-in/refresh controls. Verification stays in one keyed
  position before the body. Staff access/Team directory has its own selected
  navigation entry; its authorized form stays mounted across section switches.
  Non-ready states never render the complaint sections. Access loss brings the
  guidance into view; protected data is removed immediately, without fading.
- Optional NetworkInformation changes reuse server revalidation; offline locks
  complaints and online resumes checks. This adds no polling and cannot detect
  every silent IP change without a browser event. Foreground and explicit
  refresh remain available. Primary-button specificity is corrected; theme
  variables and reduced-motion behavior are retained.
- Regression evidence: old-source navigation/session tests fail 6 cases, and
  old StaffAuthority fails 2 cases. The focused current suite passes 47/47;
  the full application suite passes 1875/1875 with no skips. The final build
  passes 11 route and 174 utility checks. A bounded independent review found no permission or dialog
  lifetime regression. Local browser testing remains owner-waived; no native
  ceremony or new phone acceptance is inferred from rendered component tests.
- Published through [PR #308](https://github.com/maysonkiller/ArtSoul-Protocol/pull/308):
  candidate `41f2f393c57b6384eb3a5c471d57aeb36987bdbf`, merge
  `ca77eb7d60f580e4f963027001d29404364b2d9a` at 11:46:38 UTC. Production
  deployment 7091669545 succeeded at 11:47:05 UTC. Candidate CI 38729321352
  and post-merge CI 38729753387 pass all static, Linux and Windows jobs,
  including contract tests. Preview deployment 7091593421 and the apex each
  match 199 assets across six pages. Anonymous complaints, staff directory and
  notification requests remain denied; apex Donate/Report/email remain enabled
  and Base Sepolia indexer lag is zero. No environment flags changed.
- Actual apex observation at 11:49-11:50 UTC confirms the new Admin asset,
  top wallet/role/status/actions, Staff access selection and return to Review
  queue, and the authorized staff form remaining mounted while hidden. At
  390x844 the top controls fit and no horizontal overflow occurs; the viewport
  was restored afterward. This is desktop browser breakpoint evidence, not a
  new native phone ceremony. No factor, role, complaint or approval was changed.
  No setup secret or complaint content was captured. The existing owner Admin
  tab remains open on Review queue.
- Evidence: `output/audit/admin-navigation-{candidate,postmerge}-ci-2026-10-15.json`,
  `admin-navigation-{preview,apex}-artifact-2026-10-15.json`, and the
  `admin-navigation-{desktop,responsive}-2026-10-15` JSON/PNG pairs. The reviewed
  published tree is integrated into this same branch at `e7ea814`; the release
  evidence follow-up changes docs only. Four historical untracked paths remain
  untouched. The bounded reviewer is completed; no child agent is active.
- UI interpretation: highlight the current section, keep one top sign-in action,
  and preserve the authorized Staff access form between navigation tabs. These
  are Canon 07/16 presentation changes, not new permissions or mechanics.
- Exactly next step: reconcile A-22's remaining natural 24-hour expiry criterion
  against a genuinely elapsed session; do not accelerate time or repeat the
  accepted network/factor setup. Remaining phone publishing/pending-state and
  beta-entry evidence stays open in the close-out. Phase A is not declared done.

October 15 real factor completion and authenticator QR follow-up (Canon 07 / 16):

- Continue from `4ad63d0`, published application `0032e94f` / PR #306, in the
  same checkout. The owner completed real paired approvals and Google
  Authenticator setup. Read-only metadata at 11:09 UTC confirms both wallets
  remain active Team: the primary wallet has one current passkey (version 8),
  and the second/founder wallet has one activated TOTP factor (version 9).
  The TOTP setup permission was consumed at 11:06:08 UTC, and the current
  primary passkey authenticated at 11:07:15 UTC. This accepts the previously
  failing real setup on the repaired server. No factor reset or role change
  was performed by the agent, and neither factor value was inspected.
- The requested QR presentation is implemented in the existing factor
  dialog. It encodes the existing server-provided otpauth URI entirely in the
  browser, renders a React SVG with a four-module quiet border, and retains
  manual-key and same-device setup. The existing locked qrcode 1.5.3 package is
  now declared directly; no version or dependency-graph addition is introduced.
  QR encoding is lazy, and there is no external image service or raw SVG HTML.
- QR state is discarded on close, identity changes, permission expiry, rejected
  setup authorization and successful enrollment. Late encoding cannot restore
  it. Bounded review reproduced and corrected an initial coupling to ordinary
  request epochs: a failed manual-code check must not strand a pending encoder.
  Focused client/session checks pass 38/38; build passes. New QR cases first
  failed on the earlier implementation. Independent jsQR 1.4.0 decoding of
  actual component paths passes 6/6 for synthetic short/full-wallet labels at
  256, 200 and 160 pixels. No real key or QR was captured for tests.
- Evidence: `output/audit/staff-qr-{before,focused,build}-2026-10-15.log` and
  `output/audit/staff-qr-independent-2026-10-15/result.json`. The decoder is an
  ignored local verification tool, not an application dependency. No new local
  browser fixture is requested after the owner's earlier waiver. No native
  phone scan of the new QR is claimed, and the completed factors are retained.
- UI interpretation: the machine-readable QR uses neutral black/white variables
  declared for both themes to preserve scan contrast; the surrounding dialog
  retains the active theme. No role, factor policy, economics or contract changes.
- Published through [PR #307](https://github.com/maysonkiller/ArtSoul-Protocol/pull/307):
  candidate `e355239c22d8da61f3fa115c213ee34c9d54f24b`, merge
  `f84557be9de95b63df708c9fbfe4608b3d585320` at 11:21:43 UTC. Production
  deployment 7091167208 succeeded at 11:22:12 UTC. Local application checks pass
  1866/1866, with no skips; candidate CI 38726261255 and post-merge CI
  38726784656 pass all static, Linux and Windows jobs. Preview deployment
  7091075750 and the apex each match 199 assets
  across six pages, including the lazy QR encoder dependency graph. Donate,
  Report and email remain enabled on the apex; guest private-data requests are
  denied and Base Sepolia indexer lag is zero. The preview remains disabled.
- Additional evidence: `output/audit/staff-qr-full-unit-2026-10-15.log`,
  `staff-qr-{candidate,postmerge}-ci-2026-10-15.json`,
  `staff-qr-{preview,apex}-artifact-2026-10-15.json`. Source and public docs are
  committed through `e355239`; the release-evidence follow-up is documentation
  only. The four historical untracked paths remain untouched. No agent remains
  active after the bounded QR review.
- Acceptance reconciliation: A-64 already has real iPhone reconnect/sign-in,
  wallet-return and current network-switch passes. A-73's balance is accepted.
  Do not ask for those again. The earlier Robinhood failure stage is unknown;
  A-57 has current working-switch evidence, not a proven historical cause.
  A-83 still requires a real browser post-broadcast delay and reconciliation;
  the existing operator runner receipt is not browser pending-state evidence.
- Exactly next step: finish the remaining A8 changed-network acceptance using
  the owner's working factor. A bounded request asks for a real network change
  in the same authenticated desktop tab; its outcome is pending, not a pass.
  Preserve current enrollment. Natural 24-hour expiry, remaining connected-phone
  visual/publish feedback and the beta review remain separate open evidence.

October 15 authority setup navigation and supplied video (Canon 07 / 05 / 16):

- Continue from `6a34a38`, published application `90bf7cc` / PR #305, in the
  same checkout. The owner reports a founder-wallet QR prompt and no setup
  buttons on the primary wallet. Read-only metadata at 09:29 UTC confirms no
  new reset request today: the primary wallet's current authorization version
  has no passkey or authenticator and its October 13 setup permission expired.
  The second authority has a separate current passkey. Its native QR prompt is
  for complaint access, not an authority signature. No role, factor or grant
  was changed during this diagnosis.
- The UI automatically opened factor verification on either eligible staff
  wallet, covering the paired-approval workflow. The local fix suppresses only
  that automatic opening for a server-authenticated current authority. Explicit
  verification remains available; ordinary staff still get the automatic
  dialog. Added guidance distinguishes wallet approvals from complaint login.
  Queue/decision, session-boundary and factor checks pass 71/71, with no skips;
  build passes. The new regression failed on the prior implementation.
- The supplied `Video Project 30.mp4` is 4.33 seconds / 130 desktop frames on
  artwork 34. First content appears at 00:00.933; media and Creator follow at
  00:01.033, First Collector at 00:01.333. No loaded-avatar disappearance is
  visible afterward. The existing Future glow/hover effects continue. At
  00:03.067 the asynchronous largest-support paragraph inserts between Donate
  and View all support, moving the latter down. The local fix keeps both action
  buttons before the optional paragraph. No AI valuation, donation economics,
  avatar source or theme animation was changed; no audio was inferred.
- Evidence: `output/audit/authority-dialog-before-2026-10-15.log`,
  `authority-dialog-focused-2026-10-15.log`, `authority-dialog-build-2026-10-15.log`
  and `output/audit/video-project-30-2026-10-15/observations.json` plus extracted
  frames. A bounded independent review found no runtime issue and identified
  one obsolete automatic-dialog expectation, now updated while retaining its
  protected queue/decision assertions.
- The browser origin approval rejected the local fixture. The owner explicitly
  chose to continue without local browser testing; both fixture servers were
  stopped. No compiled-browser or native-device success is claimed for this
  change in that environment. Historical untracked files remain untouched.
- Published through [PR #306](https://github.com/maysonkiller/ArtSoul-Protocol/pull/306):
  candidate `a05bc8281aaaf60b2990326b08e979365276412d`, merge
  `0032e94f4ff27bc6a9878b317fc8c1eb2b0cd67e` at 09:41:30 UTC. Production
  deployment 7089179516 succeeded at 09:41:58 UTC. Local application checks
  pass 1861/1861 without skips; candidate CI 38714382702 and post-merge CI
  38714805861 pass Linux, Windows and static jobs. Preview 7089108308 and apex
  each match 53 assets across six pages. Donate, Report and email remain enabled;
  guest private reads remain denied and Base Sepolia indexer lag is zero.
- Actual apex Chrome loads `admin-CDDDbe_P.js`. The primary authority's Staff
  access is visible without an automatic dialog, while complaint access remains
  locked. Its existing roster Reset sign-in action correctly prepares
  `renew_setup` / Team / the primary wallet. The form was handed to the owner;
  no request, signature or credential was submitted by the agent. On artwork 34,
  both support buttons have y=568.39 and the summary follows at y=618.39, with
  both avatars decoded and no horizontal overflow. This verifies final rendered
  placement, not a new frame-by-frame loading or native-phone test. Only wallet
  extension provider collisions appeared in the inspected error log.
- Release evidence: `output/audit/authority-dialog-{ci,postmerge-ci}-2026-10-15.json`,
  `authority-dialog-full-unit-2026-10-15.log`,
  `staff-factor-{preview,apex}-artifact-2026-10-15-layout.json`,
  `support-layout-apex-2026-10-15.json` and the owner-handoff/placement screenshots
  under `output/playwright/`. Reviewed reconciliation with main retained the
  newer checkpoint evidence; its only conflicts were these two evidence docs.
- Interpretation: authority approval navigation stays available without a
  complaint-access factor, as already authorized; suppressing an automatic
  dialog changes no permission. The supplied video does not establish repeated
  avatar reload or an iPhone failure. Phase A remains 68 done / 15 in progress.
- Exactly next step: record the owner's result for the prepared Reset sign-in
  method / Team request, signed by both authority wallets, followed by native
  authenticator enrollment within the resulting setup permission. Reconcile
  fresh read-only request/factor metadata before proposing another reset. The
  renewed real enrollment remains unaccepted; Phase A is not closed by this release.

October 15 authenticator setup repair (Canon 07 / Bible 11):

- Continued from `d05c7d5` in the same workspace. PR #304 is published as
  `0de0fda1736a54840c026c3dee602bda96f5a131`: deployment 7053181007 succeeded
  October 14 at 00:06:20 UTC, candidate CI 38487741580 and post-merge CI
  38488177681 passed. Preview and apex matched 53 assets across six pages.
  The avatar correction is published, not newly accepted on a native phone;
  unspecified artwork flashing remains open.
- The owner's actual authenticator setup returned HTTP 500 /
  `SUPABASE_INSERT_FAILED`. Live catalog inspection confirmed pgcrypto lives in
  `extensions`, while three SECURITY DEFINER functions searched only
  `public, pg_temp` and used unqualified pgcrypto calls. The new regression first
  failed with `function gen_random_bytes(integer) does not exist`; after a8h,
  39 integration checks pass for both public and extensions installations,
  including setup, enrollment, authentication, replay and unchanged access.
- On October 15 at 09:01:50 UTC, the reviewed a8h repair committed successfully.
  Its runner pinned the previous function bodies and exact rollback definitions;
  an independent connection then verified all three definitions and unchanged
  owner, ACL, SECURITY DEFINER search path, OIDs and staff roles. No factors,
  grants, complaints or role records were rewritten. The earlier attempt never
  executed because automatic permission review was unavailable; it is not a
  rejected security decision or a second database application.
- The published UI correction cancels the owned native WebAuthn request on close,
  account/auth changes, page exit and permission expiry. Existing stale-response
  guards remain. Device refusal/timeout is no longer described as definite user
  cancellation. Focused tests pass 110/110; build and compiled AbortSignal
  fixture pass. This is not a real successful device ceremony. Bounded review
  found no source issue; its private runner receipt-preservation finding was
  fixed and verified without connecting to the database.
- Evidence: `output/audit/a8g-extensions-regression-before-fix-2026-10-14.log`,
  `a8h-extensions-regression-after-fix-2026-10-14.log`,
  `staff-factor-repair-focused-2026-10-14.log`,
  `staff-native-cancel-browser-2026-10-14.json`, and
  `staff-factor-live-catalog-2026-10-15.json`. Private plan, rollback and committed
  receipt remain in `docs/private/totp-extension-repair-2026-10-14-*`.
- The two factor dialogs, their client tests, the authority integration test,
  a8h migration and runbook are committed and published in PR #305. Historical
  untracked `.codex/`, `output/` and the moderation-authority-policy pair remain
  excluded and untouched. No new dependency or canon policy interpretation is introduced.
  Role changes still invalidate factors by authorization version; new setup
  still requires the two-wallet approval and its 15-minute permission.
- Release preparation: implementation `bfe107e` was reconciled with published
  main as `1c12dcc` with identical trees; only two older documentation conflicts
  required retaining the new evidence. PR #305 contains the bounded repair.
  Fresh build and six close-out checks pass. The initial full run in the sandbox
  could not use Docker/local HTTP fixtures (13 failures, 14 skips); the normal
  run executed 1860 checks, 1859 passed and one failed because this new migration
  was absent from the per-file disposition ledger. Both initial CI jobs found
  the same missing row. The runbook now records the applied repair; all 14 focused
  ledger/close-out checks pass. No runtime
  code changed to resolve that bookkeeping failure.
- Final candidate `73c9e7a681d01c39d129c308a9142db38eadade4` passed Windows,
  Linux and static CI 38711339206. PR #305 merged at 09:18:32 UTC as
  `90bf7cc549aa9917b724697eb545e5ee93b1da9c`. Production deployment 7088713701
  succeeded at 09:18:57 UTC; post-merge CI 38711985974 passed. Preview and apex
  matched 53 assets across six pages. Enabled Donate/Report/email flags stayed
  enabled, private guest APIs stayed denied, and the Base Sepolia indexer had
  zero lag. Actual Chrome loads `admin-Db9h8zB3.js`. Evidence prefix:
  `output/audit/staff-factor-{ci,postmerge-ci,preview-artifact,apex-artifact}-2026-10-15.json`.
- Actual desktop observation: a cold artwork 30 request showed the existing
  branded loading state, then the correct work and contained creator avatar.
  Exact artwork response took 914 ms and first contentful paint was 820 ms in
  this single cache-disabled browser sample, not a new cold-server benchmark.
  Profile identity appeared before the collection of cards. The avatar remained
  loaded at 88x88 with cover through Created, Auctions, Sales and Owned; each
  list matched its heading, and returning to Created immediately restored 27
  cards. First visits showed text progress, not placeholder cards. The browser
  cannot install a pre-document observer through the exposed CDP capability;
  these snapshots do not prove absence of sub-frame flashing or iOS behavior.
  Cache disabling was reverted. Evidence:
  `output/audit/phase-a-desktop-observations-2026-10-15.json`.
- Exactly next step: owner completes the prepared Admin `Reset sign-in method`
  for their existing Team wallet with BOTH authority signatures, then completes
  authenticator-app setup within the renewed 15-minute permission. The old
  permission is expired; no grant was created or role reset by this repair.
  The prepared page is left open and the owner was given exact steps. Record
  successful real setup/verification or the masked failure; never capture the
  setup secret or user code. Native TOTP acceptance is still open.
  Phase A remains 68 done / 15 in progress; Android stays OWNER-WAIVED / NOT TESTED.
  The one bounded reviewer finished; no subagent or local fixture server remains active.

October 14 avatar display and resumed Admin acceptance:

- Continuing from `543ae7c` in the same workspace. PR #303 merged as
  `c63536f1996187f201b20d7dcd17eb7204e74da6`; deployment 7052872764 succeeded
  at 23:45:38 UTC October 13. Candidate CI 38485813275 and post-merge CI
  38486144847 passed. Preview and apex matched 53 assets across six pages;
  guest private APIs remained closed and the Base Sepolia indexer had zero lag.
  Actual Chrome loaded `admin-C9bJVeRy.js`. The expiry fix is published; native
  renewed access is not yet accepted.
- The owner explicitly accepted numeric iPhone Base Sepolia balance and working
  switching, closing A-73. Counts: 68 done / 15 in progress / 0 planned. Android
  remains OWNER-WAIVED / NOT TESTED. The owner also reported slow avatars on both
  desktop and iPhone today and occasional artwork flashing; do not treat an
  earlier qualitative satisfactory trip as acceptance of these current symptoms.
- The live 48px creator avatar downloaded a 1254x1254 original (about 2.37 MB).
  Public source and profile hydration URLs matched. Verified contained 384px
  copies cost 23,066 bytes for that square and 17,910 bytes for an 832x1248
  portrait, returning 256x384 without distortion. First transform latency can
  still vary. Profile and provenance now share the existing decoder with a
  contained display URL and one original fallback. Stored URLs, artwork media,
  GIF/SVG and unsupported hosts remain untouched. Provenance also used default
  `object-fit: fill` in live Chrome; it now uses cover like the profile circle.
- Final focused tests pass 39/39; build passes. Full run passes 1855/1855 with
  zero skips; the later cover-only correction has its focused rerun and rebuilt
  browser proof. Compiled Chrome verifies contained portraits in both themes at
  390px and original fallback on profile/artwork. The initial isolated artwork
  fixture omitted its URL helper; the corrected fixture uses the real helper.
  This is not native iPhone acceptance or proof that unspecified flashing ended.
  Evidence: `output/audit/avatar-*2026-10-14*` and `output/playwright/avatar-*`.
- Canon 05/16 presentation only; no dependency, schema, role policy, contract or
  economics change. Bounded independent review found no runtime issue and its
  additional stale-fallback regression is included. Historical untracked files
  remain excluded from the release.
- The owner reports passkey/setup failure after changing their role to Team.
  Existing role-version policy invalidates old factors and grants 15-minute
  re-enrollment. Live browser request metadata shows registration-options 200
  without registration-verify, and two factor-setup 500 responses. The current
  generic cancellation text does not distinguish device refusal/timeout. This
  is open; no successful renewed access or wrong user code is inferred.
- That next step was completed; see the October 15 repair record above.

October 14 profile session isolation (A7 / RG-01 / A-53):

- Starting HEAD `c44257e`; published main `0ae7c31` / PR #300. No other checkout
  was used. Historical `.codex/`, `output/` and the untracked moderation-authority
  policy pair remain untouched and excluded from the release.
- Three regression tests first reproduced a shared-cookie race: a draft for A
  could be written to B after another tab signed in as B, and the B response
  could be cached under A. Profile PUT now requires the intended wallet header
  to match the signed cookie before validation/storage. The shared create/update
  client sends that wallet and validates the returned identity before caching.
  Existing public reads and OAuth-owned identity fields keep their boundaries.
  Old open clients without the new header fail closed and need a page reload.
- Five isolation regressions pass, including retry without lost confirmed data
  and an old public read arriving after save. The earlier focused profile suite
  passed 56 checks before the two additional cache tests. Build passed. Compiled
  Chrome passed 49 assertions at 1280/390 in Classic/Future against the actual
  profile handler with fixture storage/cookies. This is not native mobile proof.
- Full unit run: 1843 checks, 1837 pass / 6 fail / 0 skipped. All six failures
  belong to A8d PostgreSQL startup (`database system is shutting down`); its
  separate unchanged rerun passed 6/6. Keep both logs; do not call the original
  run entirely green. No runtime dependency, schema, role, contract or economic
  change. No canon interpretation/amendment is needed for this identity fix.
- Local evidence: `output/audit/profile-isolation-{reproduction,unit,build,
  full-unit,recovery-retry}-2026-10-14.log` and
  `profile-isolation-browser-2026-10-14.json`; recovery diff saved before release.
  Independent bounded code review found no actionable issue. The prepared
  private live verifier signs only SIWE using the two old disposable accounts,
  rejects writes using deliberately invalid input and never sends transactions.
- Implementation `4469f8e` and candidate `3950ca7` have identical trees. The two
  inspected conflicts with the previous squash merge contained only older docs;
  reconciliation retained the newer release evidence. PR #301 passed candidate
  Linux/Windows/static CI (38479994926), preview and build verification. It merged
  at 22:49:54 UTC October 13 / October 14 Warsaw as
  `12f3e38183d29a27600af16a9a976cb8bfe5008c`. Production deployment 7052017907
  succeeded at 22:50:37 UTC. Preview/apex matched 53 assets across six pages,
  guest boundaries stayed closed, enabled features were retained and Base Sepolia
  indexer lag was zero. Post-merge CI passed (38480386643). Evidence prefix:
  `output/audit/profile-isolation-{ci,postmerge-ci,preview-artifact,apex-artifact}-2026-10-14.json`.
- Real SIWE/API acceptance passed for old disposable wallet suffixes 8383/1819:
  wrong/missing intended wallet rejected before save validation; matching wallet
  reached intentionally invalid input validation; private email/notification
  reads matched the correct wallet. No profile write, transaction or new founder
  key was used; both isolated HTTP sessions ended. Both public profiles were
  absent and stayed absent. The initial verifier stopped before signing because
  it incorrectly required existing profile rows; retain that stopped record and
  `docs/private/profile-isolation-live-recheck-2026-10-14.json`. Do not claim
  successful production profile saves or two populated native profiles.
- Actual owner Chrome on the prior release passed own-profile reload, stable
  header across Profile/Gallery/artwork navigation, and a distinct public profile
  with no edit controls. The owner tab changed to Admin setup during this work,
  so no disconnect was performed over that workflow. Evidence and remaining
  limits are recorded in RG-01's dated supplement. No other browser was signed in.
- Separate evidence reconciliation closes A-21 intake from the completed October
  11 actual submissions, deduplication, independent reporters, sixth-report denial
  and review/delivery path. A bounded independent review found no missing intake
  criterion; no complaint or payment was replayed. A-22/A8 retain 24-hour/context,
  provider-failure and flag-preservation boundaries. Counts are now 66 done / 17
  in progress / 0 planned. Documentation checks pass 6/6. This follow-up updates
  evidence only; it is not another application deployment or full Phase A closure.
- Continuation from local documentation HEAD `a0bf17a`: the owner confirmed Admin
  setup complete. Actual desktop Chrome on `12f3e38` then passed RG-01 A7/A8:
  account-menu Disconnect removed identity, roster and authority controls; Admin
  reload settled at Wallet verification required; Profile navigation/reload
  remained guest with no Edit Profile. No factor, role or stored profile changed.
  The queue was already factor-locked before logout. The browser client blocked
  direct session-JSON navigation, so this records UI acceptance only. Evidence:
  `output/audit/rg01-desktop-logout-2026-10-14.json` and two logged-out screenshots.
  Historical untracked files remain untouched. No new source patch or deployment.
  `node scripts/sync-phase-a-counts.mjs --check` retains 66/17/0;
  `node --test test/phase-a-status-summary.test.cjs test/phase-a-close-out.test.cjs`
  passed 6/6 and `git diff --check` passed. No application rebuild is claimed
  for this documentation-only continuation. No subagent is running.
- Continuation from `c68c4c2`: the owner performed the requested switch using the
  personal/founder pair. The actual Chrome buffer records Rabby `accountsChanged`
  989b -> 1ccd at 23:01:01 UTC October 13, then accepted runtime/provider identity
  1ccd. Header, own-profile navigation and reload show 1ccd without the former
  profile's avatar/name/works. No agent signature, transaction, factor or profile
  mutation. Saved suffix-only events and screenshot use the prefix
  `output/audit/a59-rabby-*-2026-10-14`. This closes the Rabby desktop observation.
  No mobile or other-provider result is inferred. Do not request this switch
  again. No source change is warranted by the passing event flow.
- One bounded read-only review reconciled A-53: existing iPhone reload/navigation,
  sign-in and correct-profile outcomes already pass. Its remaining unrecorded
  criterion is the transient restoration menu/header-to-profile timing, not
  another full phone/OAuth trip. The reviewer completed; no subagent remains active.
  A follow-up scope review found no explicit mobile requirement in A-59. Its
  older probe says one wallet does not close other reported wallets, but does not
  name them. A focused evidence search found no other native switch event record;
  videos and fixtures were not replayed or counted as new native acceptance.
  Original backlog introduction `9ca5ff8` (August 21) and probe `3419115`
  (September 14) likewise supply no provider name beyond the MetaMask exclusion.
  Do not turn that ambiguity into an invented list of mandatory wallet tests.
  Counts remain 66/17/0; documentation checks passed 6/6 and whitespace checks
  passed. This continuation changes evidence only, with no new build/deployment.
- Continuation from `d037fb9`: the owner confirmed no other currently used wallet
  still exhibits the stale-address problem. A-59 is now accepted from the actual
  Rabby event/profile/reload proof and that explicit original-scope clarification.
  Do not claim universal wallet or native-mobile coverage. No source change or
  repeated switch is needed. Counts become 67 done / 16 in progress / 0 planned,
  including fourteen remaining device/connected-flow rows.
- A8 / A-22 independent continuation: extended the existing moderation journey
  with the unchanged delivery migration and actual worker. Local HTTP 503 and
  lost-response attempts both leave committed report/visibility/audit/recipient
  records unchanged; immediate retry is denied, a due retry preserves payload/key,
  and a recorded acceptance suppresses another send. Creator inbox stays intact.
  Disposable PostgreSQL and loopback capture only; no external message, live
  fault injection, production flag, migration or contract change.
  Focused worker/adversarial/SQL/journey run passed 28/28, zero skips
  (`output/audit/report-email-journey-2026-10-14.log`). Documentation checks pass
  6/6; counts are synchronized. Bounded independent review found no actionable
  issue. No application code changed; no fresh app build is claimed.
- Saved the test/evidence change as `fa34506`; the inspected reconciliation with
  published `origin/main` (`12f3e38`) produced candidate `03927bb` with the identical
  tree. PR #302 is open and attached, with eleven test/documentation files only.
  Exact-candidate CI 38483378726 passed Linux, Windows and static checks; Vercel's
  preview status is successful. Linux reports 1813 passed / 2 Windows-only skips;
  Windows reports 1658 passed / 14 Docker-dependent skips. Both contract runs
  passed 46 tests. The changed PostgreSQL journey ran successfully on Linux and
  in the local 28/28 focused run. No full-suite zero-skip claim is made.
  Logs and candidate status use `output/audit/phase-a-acceptance-*2026-10-14`.
  PR #302 subsequently merged as `d0c6c618d87759984961e6d9f4ff49c92fa9f250`
  at 23:29:04 UTC October 13. Deployment 7052633568 succeeded at 23:29:48 UTC;
  post-merge CI 38484516637 passed. Preview matched 53 assets on six pages.
  This was a test/documentation release, not an application behavior change.
- A8 expiry continuation starts from local `03927bb` in the same workspace and
  branch. Four failing regression cases confirmed that an open Admin could keep
  showing cached complaint data after its server session expired. The protected
  APIs already rejected expired sessions; this was stale UI, not an API bypass.
  The access response now exposes the validated deadline and server time. Admin
  uses a bounded timer and rechecks on foreground/online events, concealing old
  data before the request. Slow responses and client wall-clock skew cannot
  extend access. The approved 24-hour lifetime and all server checks are unchanged.
- Compiled review reproduced a related dialog remount during a pending passkey
  result; a stable verification-section key preserves that flow. The before/after
  request journals and screenshots are retained. Chrome with local HTTP/identity
  doubles passes deadline lock, context denial, pending passkey return, Team
  directory removal and the authority-pair directory exception. Both themes and
  390px layout were checked. The eight-second fixture deadline is not a real
  24-hour wait; no native passkey or trusted-IP transition is claimed.
- Build passed. Focused backend checks passed 101/101; client checks passed 29/29.
  The first full run had 1845 passes and four legacy VM harness failures from
  missing browser primitives. After that harness update the full rerun passed
  1849/1849 with zero skips; both logs are retained separately. Bounded final
  review found no further issue.
  Evidence prefix: `output/audit/admin-expiry-*2026-10-14*`; UI screenshots are
  in `output/playwright/`. No contract, schema, dependency, role or economics
  changed. Canon 07 / Bible section 11 policy is unchanged, with no new mechanic
  or ambiguous policy interpretation. Historical untracked files remain excluded.
- Completed release: PR #303 and its deployment are recorded in the latest
  entry above. Remaining native-context acceptance stays open.

October 13 staff-wallet privacy (A8 / A-22):

- Starting HEAD `e4564f2`; the latest verified main is `acf9e01` / PR #299.
  The owner explicitly approved Team plus either current authority wallet as
  the directory readers. The authority exception survives removal of its staff
  role; Team requires a live factor and receives no proposal/signing controls.
- Existing authority metadata reads are reused. Server responses remove foreign
  staff attribution from queue decisions, events and visibility results for
  ordinary administrators/moderators. Own attribution and complaint-participant
  identities remain available. Stored audit identities are unchanged. Role,
  factor and authority changes are rechecked after data reads; private responses
  are non-cacheable. Pending UI results cannot restore a removed Team directory.
- Canon 07 and the canonical backlog record the exact scope/interpretations.
  No new role, schema, dependency, factor, contract or economic change. Historical
  untracked `.codex/`, `output/`, authority-policy source and its test remain
  untouched and excluded from staging. One bounded read-only reviewer completed;
  no other agents were started. Its two findings (submission actor attribution
  and legacy Team factor enforcement) are fixed and covered by handler tests.
- Local evidence: focused final handlers passed 62/62; build passed; compiled
  Chrome UI passed 127 assertions across both themes and 1280/390/320px, including
  readonly Team, ordinary staff, authority-without-role, factor expiry and
  downgrade during a pending roster response. No external fixture requests or
  page exceptions. Screenshots were inspected. Evidence is under
  `output/audit/staff-privacy-*2026-10-13*` and
  `output/playwright/staff-privacy-2026-10-13*`.
- The first full run found a legacy VM test loader that stripped only one export,
  plus a build/read overlap. The loader now strips exported declarations and
  build/tests run sequentially. Its 98 focused checks passed; the next full run
  passed 1837/1837. The final run including the two review corrections passed
  1838/1838, zero skips (`staff-privacy-unit-reviewed-2026-10-13.log`). The final
  focused handler count is 62; documentation checks passed 12/12.
- Saved implementation `3a4955e` and candidate `1b24e41` are tree-identical.
  Reconciliation with PR #299 retained the newer phone/OAuth evidence in three
  inspected documentation conflicts; no source-tree copy or other worktree was
  used. PR #300 passed Linux/Windows/static CI (38364478080), including contract
  tests. Preview matched 53 checked assets across six pages and denied protected
  guest reads. It merged at 07:47:01 UTC as
  `0ae7c31334dfb00507dfc88a6b983b7bc79148d9`; production deployment 7032991025
  succeeded at 07:47:26 UTC. Apex matched the same 53 assets, denied guest queue,
  directory and notification reads, kept Report/Donate/email enabled and returned
  healthy Base Sepolia indexing with lag zero. Evidence:
  `staff-privacy-{ci,preview-artifact,apex-artifact}-2026-10-13.json`.
- Actual owner Chrome after deployment: wallet suffix 989b retains the directory
  as a current authority; dismissing the factor dialog leaves the queue locked.
  No signatures, factor verification, role change or complaint write occurred.
  Team outside the pair and ordinary staff privacy were tested through real route
  handlers with isolated storage/session fixtures and the compiled UI, not by
  granting new production roles. The bounded observation is recorded in
  `staff-privacy-owner-ui-2026-10-13.json`. Post-merge Linux/Windows/static CI
  passed (38364885214); evidence is `staff-privacy-postmerge-ci-2026-10-13.json`.
  Final documentation checks passed 12/12 and `git diff --check` passed. This
  release-evidence follow-up changes documents only and is not a new deployment.
- The previously preserved Admin browser tab is no longer open. Do not infer
  natural 24-hour session-expiry acceptance from its absence or create a new
  session as substitute evidence. Prior phone/OAuth acceptance remains valid.
  Exactly next step: resume RG-01 distinct-wallet/profile isolation acceptance,
  reusing the completed phone/provider outcomes and existing transaction journals.

October 12 iPhone verification-window clarification (Warsaw date):

- Follow-up at 22:28:36 UTC, October 11 / October 12 Warsaw: the owner reported
  successful Safari Admin verification using the existing Chrome/Google passkey
  provider; the review queue appeared. Read-only server metadata confirms one
  unchanged current credential with last use 22:28:04 UTC, versus 20:46:35 before
  this phone flow. No enrollment/reset or role change occurred. Private evidence:
  `phone-passkey-metadata-2026-10-12{,-after-login}.json`. This is corroborated
  owner-reported phone acceptance, not an agent-captured Safari request or full
  24-hour expiry. The owner then confirmed the requested site logout, old-wallet
  reconnect/sign-in and Discord relink/return, with the correct profile retained.
  Do not repeat these successful phone flows. See the dated device/RG-01 records
  for the precise scope; unasked wallet-version and transaction observations are
  not inferred.
  PR #299 candidate `461946c` is tree-identical to tested `a0f9e14`; conflicts
  with already-squashed PR #298 were limited to retaining newer release evidence.
  Preview `artsoul-kymxutatk-maysonkiller-be9112b5.vercel.app` matches all 53 checked
  assets across six pages; disabled APIs remain closed and indexer lag is zero.
  Linux/Windows/static CI passed (38180475223). PR #299 merged at 22:30:52 UTC as
  `acf9e014ab6df719e0296e414a91a1124ec9a9e9`; production deployment 7002756552
  succeeded at 22:31:17 UTC. The apex also matches all 53 checked assets on six
  pages, denies guest queue/notification access, retains enabled Report/Donate,
  and reports healthy Base Sepolia indexing with lag zero. Evidence:
  `output/audit/admin-locked-gate-{ci,preview-artifact,apex-artifact}-2026-10-12.json`.
  Post-merge Linux/Windows/static CI also passed (38180727029); evidence is saved
  as `output/audit/admin-locked-gate-postmerge-ci-2026-10-12.json`. This
  documentation follow-up is not included in the tested/released candidate.

- Starting HEAD `2ce3f4d`, same workspace and branch. The owner clarified that
  closing the passkey window on iPhone showed only Staff access / the team and
  Verify admin access, not complaints. This is the approved authority workspace,
  not an observed factor bypass: canon 07 permits the authenticated authority
  roster independently of the protected complaint queue. Paired signatures are
  still required for role changes. No factor was reset or enrolled.
- The ambiguous locked heading said "Admin panel". The released patch changes it
  to "Admin verification required" and explicitly states that closing the window
  does not unlock complaints. There is no authorization or policy change.
- The added cancel regression keeps an authority wallet locked after dismissal,
  refresh and retained queue/decision callbacks. Expanded handler checks deny
  four queue statuses and all four actions for both target types before factor
  verification, in paired and legacy modes, without accessing report storage.
  Focused checks passed 64/64. Build passed. Compiled Chrome passed 158 assertions
  across both themes, 1280/390/320px, ordinary staff and authority wallets, and
  Close/Escape/backdrop dismissal. No external requests or page exceptions.
  Evidence: `output/audit/admin-locked-gate-*2026-10-12*` and the corresponding
  `output/playwright/admin-locked-gate-2026-10-12.mjs` and screenshots.
- Initial full-suite execution inside the sandbox could not reach local HTTP /
  Docker and could not create DPAPI self-test files. That run is not a baseline;
  its log is retained. The normal-host rerun passed 1827/1827, zero skips:
  `output/audit/admin-locked-gate-unit-host-2026-10-12.log`.
- The initial locked phone observation and the subsequent successful native
  entry are distinct. No iOS API capture or 24-hour wall-clock expiry is claimed.
  The provider-selection issue needed no credential reset. Android remains
  waived. Historical untracked files are preserved; no agent was started.
- Desktop continuation at approximately 22:35–22:40 UTC completed RG-01 C1–C6 in
  the owner's installed Chrome, existing wallet suffix 989b. Unlink immediately
  updated the editor for each provider. Discord's identity-only consent returned
  correctly; the owner confirmed X's provider screen and its callback restored
  the original X link. The final apex profile retained both verified identities,
  nickname and avatar. No other profile data, email, role or factor changed.
  Together with the phone C7 report, block C is complete. This is the same
  owner's wallet on both devices, not proof of distinct-wallet isolation.
  The account menu also displayed a numeric Base Sepolia balance on desktop.
  Evidence: `output/audit/rg01-provider-acceptance-2026-10-12.json` and
  `output/audit/rg01-providers-restored-2026-10-12.png`.
  Final documentation checks passed 12/12; `git diff --check` passed. Their log
  is `output/audit/admin-locked-gate-docs-final-2026-10-12.log`. Only the four
  evidence documents changed after the released candidate; historical untracked
  source/output files remain preserved.
  Exactly next step: after 20:47 UTC on October 12, verify natural expiry of
  the preserved desktop staff session before a new passkey verification, without
  changing time or refreshing its factor. No background follow-up was scheduled.
  Remaining wallet/device observations, production failure-isolation boundaries
  and the founder-owned beta operating record remain listed in the close-out;
  do not repeat native entry, social relinks or completed transactions.

October 11 decision UI release and live acceptance (21:08 UTC):

- PR #298 merged at 21:05:52 UTC as `a51c16ff907c1b192df989aec984d0c9a3b72fe7`.
  Production deployment 7001780457 succeeded at 21:06:18 UTC. Candidate
  `798e6f4ddda584b087da5a9fa238add9385800f5` passed Linux/Windows/static CI
  (38174677863). Reconciliation commit 798e6f4 is tree-identical to tested
  application/evidence commit d2d0a2c; only duplicate squash-history docs needed
  reconciliation. All historical untracked files are untouched.
  Post-merge Linux/Windows/static CI also passed (38174943182); the final
  documentation checks passed 18/18, with zero skips.
- Preview and apex both matched 53 checked assets across six pages; guest
  private APIs fail closed, the anonymous logout clears both secure cookies,
  Report/queue/Donate remain enabled and the indexer is healthy with lag 0.
  Evidence: `output/audit/moderation-decision-{preview,apex}-artifact-2026-10-11.json`.
- Actual apex UI after release: cancelled and successful decisions leave the
  next reason empty, confirmation requires fresh text, and a real duplicate
  reopen refusal (409) keeps the queue usable without another passkey. The
  bounded follow-up only reopened/dismissed the already-created create-3 report
  and attempted the denied create-2 reopen. Three responses were 200/409/200.
  All six reports are closed. Ledger now has 30 events (the expected four extra
  reopen/dismiss/notification events); other reports, visibility, mail records,
  artwork and donations are unchanged. No new intake or transaction occurred.
  Private `moderation-decision-live-{before,after,reopen,refusal,dismiss}-2026-10-11.json`
  and the saved plan establish the scope. Never replay this completed follow-up.
- The native factor-use timestamp was 20:46:35 UTC; protected queue HTTP 200 at
  21:03:17 UTC proves continued access beyond the old 15-minute limit. No cookie,
  credential or IP value was exported. Exact 24-hour expiry and changed-IP native
  entry remain separately unobserved. No additional owner action is pending now.
- Screenshots: `output/audit/moderation-decision-{empty-reason,conflict,complete}-live-2026-10-11.png`.
  Local full suite 1826/1826, focused 51/51, compiled UI 65 and build passed;
  documentation follow-up checks are recorded with the release evidence.
- Same workspace/branch; use git log -1 for the documentation-only follow-up
  HEAD. No active subagent, financial operation or new automation remains.
  RG-01 reconciliation reused the September 30 saved analysis and October 8
  owner iPhone report without reanalysing video. The device sheet now explicitly
  records that report and narrows missing outcomes; the historical blank RG-01
  template no longer implies repeated Android or staff-setup ceremonies.
  Exactly next step when the owner is available: record only the missing native
  iOS SIWE/disconnect and Discord-return outcomes, retaining their wallet/device
  context. Do not replay completed moderation, funding, donation or setup/reset.
  Other listed device criteria and the controlled-beta operator/cohort/window GO
  inputs remain open; no fresh acceptance is invented from the saved video.

October 11 live moderation edges and decision UI (21:00 UTC):

- Same workspace/branch; starting HEAD `0f54d9c`. Owner confirmed the existing
  passkey and the actual apex Admin showed the new active 24-hour session.
  No reset, enrollment, role, flag, payment or contract change was needed.
- Three explicitly technical reports on the existing Base Sepolia artwork 34
  completed the live sixth-intake limit, duplicate-pending/actioned reopen,
  stale decision and concurrent restore checks. The race returned one 200 and
  one 409 with one restoration event. The sixth intake returned 429 without a
  new row. All three new reports are closed, all six mail records accepted once,
  and the three earlier reports plus artwork/donation records are unchanged.
  Private journals use `moderation-edge-*` and `moderation-edges-*` for this date;
  their final offline verification passed 26 assertions. Never replay them.
- Actual hidden and restored artwork browser checks passed; the unavailable
  state no longer spins. The existing owner session supplied the real review
  authority, never a fixture. Screenshots use `moderation-{hidden,restored}-live`.
- Live tests found two frontend defects: expected state refusals replaced the
  entire Admin view, and a decision reason leaked into the next report dialog.
  The minimal patch reuses conflict refresh and unmounts closed dialogs. The
  backend, authorization, report states and notification rules are unchanged.
  Reproductions failed before the patch; focused checks 51/51, full suite
  1826/1826 (zero skips), build and compiled Chrome 65 assertions passed.
  Both themes at 1280/390/320px have zero page errors/external fixture requests.
  Logs/evidence: `output/audit/moderation-decision-*` for October 11.
- Exactly next step: release this bounded UI patch after exact-candidate CI,
  then recheck actual Admin behavior and record the release. Current production
  remains `ba61d5c` until that later entry. Preserved untracked files are unchanged.
  No child agent is running. Android remains owner-waived / not tested.
- Remaining limits: exact 24-hour wall-clock expiry and changed-IP native entry
  are not inferred from local clock/context tests; disabled-preview preservation
  is not a production flag-toggle ceremony. Phase A is not declared complete.

October 11 staff-session release (20:29 UTC):

- PR #297 merged as `ba61d5c94c661d1e68615bd8f7c4b95203146e99` at 20:28:13 UTC.
  Production deployment 7001332984 succeeded at 20:28:36 UTC. Exact candidate
  `ab5be99c588853ad0d4a363674a9746cae7e68e3` passed Linux/Windows/static CI
  (run 38172119770), local 1823-check suite, build and 68 compiled UI assertions.
  Application commit `3aa02f2` and reconciliation `ab5be99` have identical trees.
- Preview and apex matched all 53 checked assets across six pages. The new
  anonymous logout clears both secure session cookies; guest private API checks
  pass. Report, queue and Donate remain enabled on apex. Indexer healthy/lag 0.
  Evidence: `output/audit/staff-session-{preview,apex}-artifact-2026-10-11.json`
  and `staff-session-ci-2026-10-11.json`. No hosting setting or data was changed.
- Actual owner Admin tab was refreshed and correctly requested normal passkey
  verification. Screenshot: `output/audit/staff-session-live-handoff-2026-10-11.png`.
  The owner was asked once to confirm the existing key. No reset, enrollment or
  paired approval is needed. Do not substitute a fixture for native verification.
- Exactly next step: after the owner confirms, observe the real active session
  under the new policy and continue the bounded remaining moderation acceptance.
  Android is owner-waived / not tested. Phase A is not marked complete.
- This release evidence is a documentation-only follow-up; use git log -1 for
  its saved HEAD. No active child agent or unattended transaction remains.

October 11 resumed owner amendment (24-hour staff verification):

- Owner explicitly waives Android testing for this Phase A close-out. Record
  OWNER-WAIVED / NOT TESTED, never PASS. Do not repeat the Android question.
- Owner replaces the 15-minute verified session with a fixed 24-hour maximum,
  requiring factor verification again in a new browser context or client IP.
  Canon 07 records the amendment and cookie/IP/User-Agent binding limitations.
  Setup permission stays 15 minutes; paired approvals and contract custody stay
  unchanged. Logout now clears wallet and staff cookies together.
- Same workspace/branch, starting HEAD `8966b8e`; application source/tests/docs
  are being prepared for release. The currently published version is still
  `c7dcef6` until a later deployment entry confirms otherwise.
- Current focused backend checks 112/112; frontend/document checks 52/52;
  full application suite 1823/1823, zero skips; build and route/style checks pass.
  Logs: `output/audit/staff-session-{focused,unit,build}-2026-10-11.log` and
  `admin-session-copy-docs-2026-10-11.log`. Compiled Chrome passed 68 assertions
  in both themes at 1280/390/320px, with zero page errors/external requests:
  `output/audit/staff-session-built-2026-10-11.json`. Host checks confirm Vercel
  runtime identification and correctly configured direct A-record routing:
  `output/audit/staff-session-host-2026-10-11.json`. No live factor is simulated.
- Exactly next step: finish compiled UI and exact-candidate CI/deployment checks,
  then request one normal verification with the existing passkey. Existing
  unbound cookies deliberately require re-verification; no reset or paired
  signatures are needed. A real changed-IP ceremony is not claimed by unit tests.
- Preserve historical untracked observer files, .codex and output. One bounded
  reviewer handles only compiled local UI; no new audit agents or worktrees.

October 11 owner-unavailable checkpoint (09:10 UTC):

- Owner requests all independent work, then stop. Do not wait for or repeat the
  pending passkey/Android questions; owner is away. No new automation is needed.
- Same workspace/branch; starting HEAD `7a27fcd`. Application remains published
  as `c7dcef6` (PR #296); this follow-up changes only one existing regression test
  and evidence/status documents. Use git log -1 for the saved follow-up HEAD.
- Scoped moderation checks 67/67, zero skips. The added flag-off assertions prove
  a valid decision is denied and all five ledger/visibility tables preserved.
  `output/audit/moderation-edges-2026-10-11.log`. Existing full 1814-check and
  compiled 68-check baselines are reused only for the unchanged application.
- Read-only current evidence: 9 live HTTP checks; disabled preview shares the
  apex public database, denies its disabled routes, and leaves rehearsal ledger
  hashes unchanged. 16 deployed RPC bodies match source; 13 protected tables
  retain forced RLS; runtime direct staff writes are denied. All 3 reports remain
  resolved, due mail backlog 0, Base Sepolia indexer healthy/lag 0. Evidence:
  `docs/private/phase-a-unattended-2026-10-11T09-10-07-529Z.json`.
- GitHub open issue query returned 0 and candidate CI remains green. These facts
  do not substitute for remaining real device/OAuth or live A8 acceptance.
  The existing SSH key could not open a read-only service check; no access change
  was attempted. Database mail/health evidence remains current.
- Exactly next step after the owner returns: existing passkey re-verification,
  then bounded stale/concurrent/reopen/rolling-limit moderation acceptance plus
  actual post-release hidden-state UI. No setup reset or financial replay.
- Phase A remains 65 done / 18 in progress, NO-GO. Named beta operator/window,
  connected-device/OAuth evidence and remaining live moderation edges are still
  required. Detailed results: PHASE_A_MODERATION_ACCEPTANCE_2026-10-11.md.
- Preserve historical untracked observer files, .codex and output. One bounded
  reviewer finished; no agent work or unattended signing remains active.
- Final documentation/count/entry checks passed 19/19, zero skips; git diff
  whitespace checks passed. Only tests and documentation need the local follow-up
  commit. No application rebuild/deployment is required for this continuation.

October 11 closing checkpoint (09:04 UTC):

- Workspace unchanged; local tested application HEAD `38c9e71`. PR #296 merged
  as `c7dcef6a511046ed94a406377b6093f8851b30f7` at 09:02:31 UTC; production
  deployment 6993341447 succeeded. Source changes: only suppression handling in
  supabase-client/artwork page and their two regression files. Docs record facts.
- Full local application suite passed 1814/1814, zero skips; focused 64/64;
  build passed; isolated compiled Chrome 68 checks across two themes/three widths
  passed; post-document consistency 6/6. CI run 38126729232 passed Linux/Windows/
  static. Preview and apex both matched all 53 checked assets across six pages. Guest Admin and
  notification APIs remain private; Report and Donate are enabled. Indexer was
  healthy with zero observed lag. Evidence: hidden-artwork-apex-artifact-2026-10-11.json.
- Real artwork and donation-message moderation journeys completed. All three
  reports are resolved; artwork 34 and original donation text are visible.
  No payment was repeated. Both RPC snapshots, payment records and public lists
  unchanged apart from temporary message masking. Final private report snapshot:
  `moderation-acceptance-2026-10-11T09-02-56-107Z.json`; message verification:
  `donation-message-acceptance-restored-2026-10-11.json`. Both creator and donor
  SIWE notification reads passed; actual profile showed reporter notifications.
- Report, protected queue and Donate are ON. Current Donate deployment address
  remains 0xa36bd0da05fa5aa113834ad355363c66cd42a22b on 84532. The owner confirms
  first complaint mail reached project inbox; all 3 provider submissions accepted
  once. Donate modal and gallery menu order/auto-open passed actual browser.
- Real passkey session expired and cleared complaint data again at 08:59. Owner
  was asked for Verify admin access > Verify passkey for remaining live edges;
  no reset/two signatures needed. Android availability question also pending.
  Do not impersonate native verification or mark unobserved device tests passed.
- A-39 accepted; Phase A counts: 65 done / 18 in progress. TA-10/TA-11/TA-13 accepted.
  Owner email verification is server-confirmed at October 3 06:56:12 UTC without
  reading/disclosing the email. Separate OAuth/device and A10 GO remain open.
- This documentation follow-up is saved separately after the tested application
  commit; use git log -1 for its HEAD. Preserve historical
  untracked observer files, .codex and output. The one bounded reviewer finished.
- Exactly next step: once owner passkey is renewed, run bounded stale/concurrent
  decision, reopen and sixth-report-limit cases on project artwork 34, with fresh
  journals and final restoration. Do not repeat existing transactions/reports.

October 11 live acceptance continuation (08:51 UTC):

- Current local HEAD `eccc7e1`, branch `codex/takeover-audit`, same workspace.
  PR #295 merged at 08:42 UTC as `2ba480bed7328ff01ce43995e1f107f6f0e93399`.
  All exact-candidate Linux/Windows/static CI checks passed (run 38124785727).
  Apex matched 53 assets on six pages; live roster shows both approval wallets
  and staff roles. Evidence: `output/audit/staff-roster-apex-artifact-2026-10-11.json`
  and `staff-roster-live-2026-10-11.png`. New role writes were not replayed.
- Reporting is ON with the approved daily limit 5. The actual browser submitted
  technical report `3f8984e2-7a01-4490-93b5-f374cd7eeaa3` on artwork 34; a distinct
  old test account submitted `b1790bea-a4be-44a6-b014-af834f4daa03`. Its exact
  duplicate returned the same reference. Both emails were accepted once; the
  owner confirmed receipt of the first in the project mailbox.
- Actual owner Admin UI hid both, resolved the first while visibility stayed
  hidden, then resolved the second at 08:47:33 UTC and restored visibility.
  Read-only snapshots at 08:46:38, 08:47:04 and 08:47:58 preserve states/events.
  Both reports are resolved; no unrelated artwork or payment was touched.
  Actual recipient SIWE notification read passed and mismatched wallet was denied:
  `docs/private/recipient-notification-2026-10-11.json`. Same author/reporter uses
  one REPORT_RESOLVED notice under existing SQL deduplication, not a duplicate
  ARTWORK_RESTORED notice. Ownership, auction 66, token 6 and floor are unchanged.
- Found a real hidden-artwork UI defect: suppression became an indexer-pending
  spinner. Four-file local fix distinguishes ARTWORK_UNAVAILABLE and clears stale
  artwork/auction state. Three reproduced failures became 64 passing focused
  regressions, zero skips. Not built/published yet; reviewer finished.
- Donate configuration was added after both RPCs matched the pinned deployed
  code and the artwork was restored. Read `docs/private/donate-activation-2026-10-11.json`
  before retrying. Same-source deployment `dpl_5sxAyDwpgLtUofbjcadC4WGYezdm`
  (`artsoul-2pl1501te-maysonkiller-be9112b5.vercel.app`) was requested; verify READY.
  Only the two existing 1-wei donations may be used; never replay payments.
- Exactly next step: verify Donate deployment, exercise message-only complaint /
  hide / restore on existing tx 0x91f63b0d...c17 log 15, then validate and release
  the hidden-artwork fix. Phase A remains open for remaining acceptance evidence.

October 11 continuation (team roster and remaining moderation acceptance):

- Started at `71c7ae3` in the same workspace/branch. Preserved the prior agent's
  66-line authority regression diff in `output/recovery/staff-roster-2026-10-11/`.
  Historical untracked observer source/test, `.codex/` and `output/` are unselected.
- The October 8 read-only evidence at 12:45 UTC confirmed the second paired reset
  at 12:40:20 UTC, version 2 to 4, replacement passkey enrollment at 12:40:50 and
  successful authentication at 12:40:57/12:41:05. Both approval signatures were
  cryptographically checked against their recorded consumption time. Prior
  factors have obsolete versions; they are retained, not deleted. Evidence:
  `docs/private/owner-staff-ceremony-2026-10-08T12-45-17-415Z.json`.
  This closes observed owner replacement/entry; old-session rejection is covered
  by integration tests, not an actual captured pre-reset browser session.
- Local roster endpoint reads only wallet/role/active, requires a current
  authority SIWE session, limits each page to 50, and rechecks policy after read.
  Staff access shows the pair, active/removed staff and exact role/reset actions;
  all mutations still use the existing two-signature workflow. Wallet/auth changes
  clear displayed roster and invalidate late responses. No migration is needed.
- API checks passed 7/7; actual PostgreSQL/signature checks 37/37; build passed
  (11 routes / 175 CSS utilities). Compiled Chrome checks passed 101 assertions
  across both themes and 1280/390/320px, including late roster after logout.
  The full run passed 1811/1812 with zero skips; its sole failure was an outdated
  close-out sentence, corrected with all 5 close-out checks passing. Logs:
  `output/audit/staff-roster-{api,build,browser,unit,closeout}-2026-10-11.log`
  and `staff-authority-roles-2026-10-11.log`. Bounded independent review found
  no actionable issue; reviewer finished. New roster changes are NOT published.
- Owner refreshed SIWE and the existing passkey. The protected queue was enabled
  by adding only `ARTSOUL_PROTOCOL_ADMIN_ENABLED=true` and redeploying accepted
  `17cfc3c` as `dpl_GhvhgajY2nhUfDU2uutYeSuiTZXm`. Actual owner browser queue
  access passed; 14 real SIWE/HTTP checks confirmed guest/nonstaff rejection
  and logout, with no transaction/role/factor mutation. Private evidence:
  `staff-queue-denials-2026-10-11.json`; screenshot:
  `output/audit/admin-queue-active-2026-10-11.png`. Initial Vercel 403 cleared
  after existing CLI authentication refresh; no config write was replayed.
- Report activation is in progress using its approved daily limit 5; read
  `docs/private/moderation-report-activation-2026-10-11.json` before any retry.
  Donate remains off. Do not claim the empty queue as complaint acceptance.
- Exactly next step: finish changed-tree verification, release the reviewed roster,
  then enable the protected queue and run the existing bounded complaint acceptance
  plan in `docs/private/PHASE_A_MODERATION_ACCEPTANCE_2026-10-08.md`.
  Phase A remains OPEN until actual complaint/notification/decision gates pass.

October 8 release and activation continuation (historical initial owner entry):

- This release continuation started at local HEAD
  `80d38a5db17a3dcbc1a48313a30104354837047e` in the same workspace/branch; use
  `git log -1` for the subsequent documentation checkpoint. No application code
  changed after that tested candidate. The untracked recovery files remain untouched. The sole
  bounded reviewer finished; no child agents are running.
- Exact candidate CI passed on Linux, Windows and static checks (run
  `37774913604`). Preview and apex each matched all 53 JS/CSS artifacts across
  six pages. The founder explicitly approved PR #294 production release after
  the automatic reviewer requested that exact approval. It merged at 12:16 UTC
  as `17cfc3cb2b2ac005366c56097e3f9b35a28dbcc1`; production deployment
  `dpl_CWnkynPzpy61pJvTxS3wGW4F3XKv` succeeded. Apex evidence:
  `output/audit/staff-factor-apex-artifact-2026-10-08.json`. Indexer was healthy
  with zero observed lag; guest private APIs denied access as expected.
- A fresh protected full/schema backup was hash-checked and archive-read before
  writes (no restore drill). Reviewed A8e/A8f/A8g installed at 12:20 UTC, each
  transaction verified before commit: forced RLS, RPC bodies/privileges, no
  direct runtime role writes, unchanged role assignments and existing counts.
  Journal: `docs/private/staff-factor-schema-apply-2026-10-08.json`. Do not replay.
- The approved initial authority pair, apex origin, Base Sepolia and TOTP policy
  5/300/120 were installed separately. No role, setup permission, factor, session
  or report was created. The private policy journal records the exact values.
- The existing Vercel CLI login was refreshed. Three production-only settings
  were added: server-only TOTP encryption key, key version 1, dual-wallet gate.
  Protected local key recovery material is outside Git. Provider type naming
  (`secret` in CLI, `sensitive` in API) stopped the first verification; the
  successful first add was reconciled without replacement, then the two remaining
  settings completed. Unrelated variable metadata was unchanged. Configuration
  was activated by same-source production redeploy
  `dpl_C9LzezTwTeYR6LdEXUutgG3556QE`, READY on the apex at 12:26 UTC. The connected
  owner browser showed the new verification dialog and Staff access controls.
  The prepared form targets the existing old-founder Administrator role using
  Reset sign-in method; no request or signature was created automatically.
- Post-activation apex verification again matched all 53 assets across six pages
  and confirmed paired mode, guest denial, disabled public gates and healthy
  indexer: `output/audit/staff-factor-apex-artifact-2026-10-08-activation.json`.
  A fresh real SIWE login with the existing disposable creator account passed
  13 HTTP steps: guest denial, non-staff authority/factor denial, expected-wallet
  mismatch, rejected legacy self-grant, closed queue and logout. No transactions,
  roles, permissions or credentials were created by that check. Private evidence:
  `docs/private/staff-live-denials-2026-10-08.json`. It does not prove the owner
  ceremony. Release-document checks passed 29/29 with no skips in
  `output/audit/staff-factor-release-docs-final-2026-10-08.log`.
- The owner confirmed completing both signatures and entry. Read-only verification
  at 12:33 UTC independently recovered both approved authority signers from the
  saved request. It was consumed once at 12:29:08 UTC; the old founder remained
  Administrator and authorization version advanced from 1 to 2. A real passkey
  consumed the shared setup permission at 12:31:33 UTC, followed by successful
  authentications at 12:31:50 and 12:32:09 UTC. Evidence:
  `docs/private/owner-staff-ceremony-2026-10-08T12-33-55-482Z.json`.
  This accepts initial paired setup and passkey entry, not replacement recovery
  or authenticator-app acceptance. The first read-only verifier used current
  time for the historical signature and stopped on expiry; it was corrected to
  use the recorded consumption instant. No approval was replayed or fabricated.
- Exact next step: the owner performs the agreed two-wallet reset of the now
  existing sign-in method; verify old-factor/session invalidation before enrolling
  its replacement, then proceed to protected queue and complaint acceptance.
  Public reporting/review/Donate remain off. Phase A is OPEN.

October 8 current continuation (paired staff setup implemented, not activated):

- Started from `707d180438ad4d41f6b9c19ce7c21037ec1bc12f`; same canonical
  workspace/branch. Snapshot: `output/recovery/factor-setup-2026-10-08/`.
  No worktrees were created, combined or reset. The older untracked Safe policy
  observer/test, `.codex/` and `output/` remain unselected recovery material.
- Completed shared single-use setup permission, version-bound native passkey
  registration and encrypted authenticator-app setup/login. Grant/reset consumes
  both authority approvals, advances role version and issues 15-minute setup.
  Successful enrollment consumes the permission once across both methods.
  Legacy self-grant/recovery/key-removal paths are rejected under the paired
  policy; replacement needs both current authorities. No complaint is deleted.
- Added the gated authority and factor routes, the Admin verification dialog and
  explicit two-wallet role/reset/rotation UI. Authority discovery is distinct
  from staff eligibility; authority alone cannot read complaints. Signatures
  survive a wallet switch only as the exact public proposal and approvals in
  sessionStorage, then expire/clear. Codes and factor secrets stay out of storage.
  Account-menu runtime is v55 on every consumer. Existing Safe/contracts/economics
  are unchanged. This is application staff administration, not a complete console
  for every future protocol operation.
- `node scripts/run-unit-tests.mjs`: **1,802 passed, zero failed/skipped** in
  `output/audit/factor-setup-full-unit-final-2026-10-08.log`. Includes actual
  disposable PostgreSQL, real ephemeral EOA signatures, software P-256 WebAuthn
  registration/authentication, TOTP replay/throttling, role changes and atomic
  permission races. The retained unselected observer contributes 29 checks.
  Earlier full-run failures were stale asset version/hash expectations, fixed
  without weakening the cache checks; their failing log is retained.
- Build: **11 routes, 175 CSS utilities**, passed in
  `output/audit/factor-setup-build-final-2026-10-08.log`. Built Chrome test passed
  **51 assertions**, both themes at 1280/390/320px, zero uncaught errors:
  `output/audit/staff-factor-built-2026-10-08.json`. It covers wrong-code retry,
  native cancellation/setup/verification, late response after logout, two actual
  ephemeral signatures across account switch and rejection of tampered stored
  approval. Screenshots are under `output/playwright/staff-factor-*` and
  `staff-authority-*`. Synthetic local HTTP/provider boundaries do not prove
  live deployment, physical passkeys or iPhone/Android wallet acceptance.
- A bounded independent review found one historical-key revocation issue; the
  paired-mode removal guard fixes it. Final UI review found no further concrete
  bypass or wallet/session race. The sole reviewer is finished; no new team ran.
- Read-only live preflight at 12:04 UTC found no A8e/A8f/A8g objects, one staff
  role, zero passkeys/reports and one historical unused expired bootstrap.
  Reporting/Admin/Donate remain off. Private preflight and operator aggregates
  are timestamped under `docs/private/`; no live role/schema/config was changed.
- Owner reported the earlier phone pass appeared good. Record that qualitative
  observation without repeating the entire trip; it does not supply Android,
  OAuth or native-factor evidence. The device sheet records the limit.
- Unfinished: publish/review this continuation of PR #294; verify its preview,
  safely install reviewed A8e/A8f/A8g and initial policy/config, then obtain real
  owner two-wallet setup/reset and device verification. Full complaint/review/
  recipient/mail acceptance and gated Donate activation follow. Phase A is OPEN.
  Exact next step: commit the selected tested source and update existing PR #294,
  then verify its exact candidate CI and preview before release.
- The continuation was committed/pushed as `4e17d23`. Its first CI run caught
  two documentation assertions still requiring the superseded activation heading
  and Safe-only wording. No application test failed. The runbooks now label the
  historical procedure explicitly; tests check the approved paired setup/reset
  and forbid rollback into the legacy model. Focused documentation/security
  checks passed 34/34 in `factor-docs-supersession-2026-10-08.log`; fresh exact
  candidate CI is required before release.

October 8 continuation (UX published; Donate indexed; mail worker active):

- Recovery started at `838f54b71881c4e5199dd0828793c2053aeb48eb`; remote main matched
  at that read. Production is `154d16f2fe18734a6766330c3aa7021eecf00702`;
  the challenge-binding continuation started at committed HEAD
  `a611d424b8cd8441aa1f3eed9821c31b939b83f9` on the same branch
  (draft PR #294, not merged). Use `git log -1` for the saved continuation commit.
  Existing October 3 source and checkpoint changes were
  preserved in `output/recovery/phase-a-resume-2026-10-07/before.patch`, with
  separate copies of seven untracked implementation/test files. No worktree,
  overlay, reset or cleanup was performed.
- Local changes unify X/Discord/private email management in Edit Profile,
  move preview actions onto media, preserve one status/price row, expose full
  metadata and remove the redundant View artwork menu action. Card runtime
  uses v18 on all four consuming pages. Report/Donate still respect server
  rollout gates and open the existing targeted dialogs when enabled.
- Native first-passkey setup uses an existing audited bootstrap approval
  without manual code transfer. Additional setup reuses the existing protected
  grant. No approval is issued by ordinary wallet login. The narrower admin
  wallet/logout fix was explicitly confirmed by the founder and applied;
  it clears browser memory only and rejects stale responses. It does not delete
  complaints. The formerly rejected broad candidate remains a recovery artifact,
  not a copied implementation. Seventeen regressions reproduced 13 failures
  against HEAD and passed on the repaired source.
- Built-browser testing found and fixed a real first-render temporal-dead-zone
  error introduced by the email-editor effect. Whole-component React rendering
  now covers guest, restoring, connected and public-profile cases. Do not
  substitute the earlier function-slice tests for this evidence.
- Full local suite after that correction: **1,613 passed, zero failed/skipped**,
  including real disposable PostgreSQL tests. Log:
  `output/audit/phase-a-ux-full-unit-v2-2026-10-07.log`. Build passes 11 routes /
  175 CSS utilities. Final v5 build passed after card-only sizing refinements;
  their focused Node checks passed 46/46 and built-browser checks passed 629/629
  across 24 viewport/theme/surface combinations. At 320/360px the shared grids
  use one column so ordinary prices remain fully readable; 390px is unchanged.
- Native-UI fixtures passed 187 assertions across 1280/390/320px and both
  themes; profile passed 21 scenario groups and staff notices 26 cases. There
  were zero uncaught page errors and zero external writes. These use synthetic
  credentials and local HTTP fixtures, not physical authenticator acceptance.
  Source/artifact hashes and screenshots are in the corresponding October 7
  `output/audit/` and `output/playwright/` records, including
  `card-overlay-built-browser-2026-10-07-v5-final.json`. These fixtures do not
  establish physical iOS/Android authenticator or wallet acceptance.
- [PR #292](https://github.com/maysonkiller/ArtSoul-Protocol/pull/292) merged as
  `5529973e41b29ca6ed62662c2e8fae17242bda2f` after Linux, Windows and static CI
  passed (run `37592870318`). Preview and apex each matched all 51 JS/CSS
  assets across five pages. Production deployment `6905182667` succeeded.
  Evidence: `phase-a-ux-{preview,apex}-artifact-2026-10-07.json`. The connected
  apex browser loaded v18 and 26 real gallery cards; checked cards had media
  overlays and one-row status/prices. Screenshot:
  `output/audit/phase-a-ux-apex-gallery-2026-10-07.png`.
- Complaint email delivery code is published with a separate worker flag,
  service-only claims, idempotent bounded retries and no complaint content in
  email. Its migration, protected configuration and scheduler were verified on
  October 8, including actual transport delivery to the project inbox (see below).
  Full complaint-flow acceptance remains open. See `docs/runbooks/MODERATION_REPORT_EMAIL.md`.
  Staff profile notices use existing protected APIs, store only reference/count
  information and never turn ordinary users into staff. Email runs only in the
  scheduled worker; report intake never waits for the provider. The actual
  intake/email focused regressions passed 31/31 after that correction.
- Read-only live check at October 7 07:52 UTC found one active administrator,
  zero passkeys, one unused expired bootstrap approval and no recovery ceremony.
  No role/credential mutation or transaction was performed by that check.
  The original bootstrap/auction/Donate journals must never be replayed.
- Founder approved mandatory BOTH-wallet authority for roles/critical changes,
  normal moderator report decisions, an authenticator-app alternative, and
  reviewed collection-origin badges without a sales threshold or Trust effect.
  See `CHANGELOG_2026-10-07_ADMIN_AUTHORITY.md`; these are approved direction,
  not completed implementations. The existing 2-of-3 Safe does not satisfy the
  new mandatory-pair rule. Exact 0.002 test ETH funding to the new founder wallet
  in Base Sepolia completed in transaction
  `0xafbbfe605ad1ed0efd229d29430962d3d853da99eadb4a3c2c94c38a5f75eca9`.
  The recipient remains excluded as an automated signer. A transient initial
  receipt verification failure was reconciled without resending; both RPCs
  confirmed the transaction and exact recipient balance. Fourteen legacy, one
  Donate deployment and one funding record reconcile to 0.025315172029030397
  test ETH total campaign cost. A write-once recovered receipt is recorded;
  funding is now included in the reviewed future runner's budget and nonce
  checks (115 offline checks passed). The founder then explicitly authorized
  release for exactly two 1-wei Donate checks. Both completed without replay:
  message transaction `0x91f63b0d5796ee1c2f7248113210851ee8d558623d6947e5fb21fa18354c0c17`
  and empty anonymous transaction `0x178309ae89d156c574f08bb10e456143bc72ea1e4706f7134bbd9e35f4e3cc7d`.
  Each canonical receipt, block, creator transfer and unchanged Core/NFT state
  was independently verified after an initial receipt-check mismatch. Neither
  transaction was resent. Completed locks were released by receipt-only
  finalizers. All 18 campaign operations total 0.025316087413030749 test ETH.
  Do not rerun those completed plans or finalizers.
- October 8 read-only acceptance found exactly one indexed row per donation,
  completed processing records, healthy advancing Base cursor 47837333 and zero
  failed/dead events. The actual public API handler against live data passed
  exact amount/message and anonymous-address suppression checks using a
  process-local enabled flag. Apex Donate remains disabled. Evidence:
  `docs/private/donation-projection-acceptance-2026-10-08T07-02-51-151Z.json`.
- After the owner reset the forgotten Linux password, SSH access succeeded.
  Read-only inspection found `/opt/artsoul`, main
  `93ad98a9b9dee9863a9e1828e096444abfbec615`, clean tracked files and two untracked
  launcher scripts to preserve. Base Sepolia is healthy with zero event errors;
  legacy Ethereum Sepolia is stopped. That older revision lacked Donate.
- The host now runs the same reviewed `5529973` revision via a checked Git
  fast-forward. A restricted source/runtime/configuration backup is retained
  at `/var/backups/artsoul-phase-a-2026-10-07`; both archives were validated.
  Base stopped at cursor 47796924. Two-RPC log coverage from deployment block
  47607186 through that cursor found zero Donation events, so no backfill,
  cursor reset or migration was performed. The shared launchers were preserved.
  `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`, runtime imports,
  message-codec smoke and all 25 host event regressions passed. Only the
  verified Donate address was appended to the Base configuration. Restarted
  Base is healthy, depth 3, cursor advancing 47797013 -> 47797035, with zero
  failed/dead/unresolved events. Seven source/package hashes match the reviewed
  commit. PM2 state was saved; Ethereum remains stopped. Private evidence:
  `hetzner-donation-runtime-2026-10-07.json` and the host backup's acceptance log.
- October 8: a fresh restricted database backup was created and its archive
  read-validated (not a restore rehearsal). The single published complaint
  delivery migration `67435e2b396131bc5bffbccd54b22ff89fb8258ad73c58ec4488463835cab46e`
  was applied in one transaction after fresh catalog preflight. Table shape,
  forced RLS, browser privilege denial, service access, exact RPC bodies,
  signatures and search paths passed before commit. Report counts stayed zero;
  no email, scheduler or feature flag was enabled. Private journal:
  `docs/private/report-email-schema-apply-2026-10-08.json`.
- October 8 recovery snapshot is in `output/recovery/phase-a-resume-2026-10-08/`.
  No other agents are running; continue solo per founder request. The approved
  role authority uses BOTH designated wallets' gasless signatures; no new Safe
  is wanted for application roles. Contract/fund authority remains separate.
  Ordinary complaint decisions remain human moderator-confirmed; AI does not
  autonomously grant roles. This clarification supersedes any proposed Safe
  deployment for application authority, not historical recovery evidence.
- Local TOTP crypto (38 checks), Safe observation helper (29 checks) and TOTP
  persistence (22 real PostgreSQL checks) are preserved but not wired or live.
  Role epochs, dual-signature issuing/rotation, factor session integration and
  real setup/recovery ceremonies remain open. Native key/app setup is unverified.
- Current requested card amendment is published: Donate, Report, Creation transaction
  only, in that order; no management/details actions. Valid indexed registration
  hashes only; owner auction management remains on artwork detail. Shared cache
  v19 covers all four consumers. All 32 card regressions and the 11-route build pass. Built-browser acceptance
  passed 629 checks across 24 viewport/theme/surface combinations; Donate
  rendering with the real sanitized API read response passed 27 checks. Both
  suites performed zero writes and had zero page exceptions. Evidence is in
  `output/audit/{shared-card-menu,donation-real-read}-built-2026-10-08.json`.
  PR #293 merged as `154d16f2fe18734a6766330c3aa7021eecf00702` after Linux,
  Windows, static and Vercel checks passed (CI run `37743580044`). Initial CI
  `37743100607` found an outdated card cache pin and obsolete upload guidance;
  both were corrected and their 43 focused checks passed before the green run.
  Production deployment `6929874943` succeeded. Preview and apex matched all
  53 JS/CSS assets across six pages; Base indexer was healthy with zero lag.
  The actual connected Chrome gallery loaded v19, rendered 25 cards, kept the
  menu over media and exposed only the correctly labelled creation transaction
  while public Donate/Report remain off. Screenshot:
  `output/audit/phase-a-menu-apex-gallery-2026-10-08.png`. Artifact evidence:
  `output/audit/phase-a-menu-{preview,apex}-artifact-2026-10-08.json`.
  Browser fixtures do not prove public feature activation or physical phones.
- October 8 dual-wallet message verification is local and unwired (29/29 checks):
  both current EOAs sign the exact domain/action/target/role/version/nonce/expiry;
  one signer, duplicates, changed fields, expired requests and replacement-pair
  approval are denied. A8f now adds local-only durable proposals, atomic role
  grants/revocation/rotation and immutable runtime audit evidence. Its unregistered
  API handler loads the stored proposal and recovers both signatures itself.
  SQL rechecks authority and target versions after locks, consumes the request
  once and commits the role change with its audit. Direct runtime role writes
  are denied. The final focused run passed 47 checks, including real disposable
  PostgreSQL, real ephemeral EOA signatures and the actual handler/session code
  over a fixture PostgREST transport. Evidence:
  `output/audit/a8f-authority-handler-2026-10-08.log`. No project keys or external
  transactions were used. The migration is unapplied, the policy registry is
  unseeded, the handler is not routed, and no role-management UI is wired.
  Factor/session integration and real approvals remain unfinished.
- A real disposable PostgreSQL regression reproduced two TOTP role-regrant gaps:
  an old matched login and an old enrollment approval could both return OK after
  revocation/recreation. The local unapplied migration now binds grants/attempts
  to a monotonic role authorization version. All 28 PostgreSQL checks passed,
  including concurrent revoke/regrant, deletion/recreation, fresh replacement
  setup and denial of sequence rewinds. Evidence:
  `output/audit/a8e-role-regrant-after-2026-10-08.log`. No live schema or staff
  authorization has changed. Retained failing evidence:
  `output/audit/a8e-role-regrant-before-real-2026-10-08.log` (22 passing checks,
  two failed subtests plus their parent, no skips). Docker startup caused an
  earlier skipped run, which is not verification evidence.
- Final October 8 working-tree regression: **1,756 passed, zero failed/skipped**.
  Command: `npm run test:unit`; log:
  `output/audit/phase-a-authority-full-unit-final-2026-10-08.log`. The first run
  passed 1,753 and failed three integration guards: a missing migration-ledger
  row, missing private-table classification and a CRLF/LF-only header comparison.
  Those guards were corrected; 93 focused checks and the full rerun passed.
  The table scanner now recognizes CREATE TABLE with or without IF NOT EXISTS.
  No historical applied migration was rewritten. The retained unselected Safe
  observer and its 29 tests remain outside the new authority change; no new Safe
  is selected by their presence. Recovery snapshot:
  `output/recovery/phase-a-authority-2026-10-08/`. Only this root agent is active;
  the completed isolated browser and preview server were closed.
- The tested source is preserved in [draft PR #294](https://github.com/maysonkiller/ArtSoul-Protocol/pull/294)
  at `917d084da74a93f747777b2c21c3f3516288b772`. CI run `37747560963` passed
  Linux, Windows and static checks; the Vercel preview also passed. No draft
  migration or route is activated by publishing it.
  Remaining untracked files are `.codex/`, `output/`, the previously preserved
  `src/api/moderation-authority-policy.js` Safe observer and its test. They were
  deliberately not folded into the selected gasless application authority.
  The subsequent session-binding changes were pushed as `a611d42`; CI run
  `37765791029` passed Linux, Windows, static and Vercel checks for that exact
  commit. The newer challenge-binding diff below is not covered by that old CI.
- October 8 factor policy is now explicitly approved: both current authority
  wallets approve initial setup and replacement setup/recovery, with one-time
  15-minute permission. TOTP allows five reservations per rolling five minutes,
  counting abandoned attempts; each lasts two minutes. Sessions remain 15
  minutes. Canon 07, its dated amendment and the migration/runbook notes record
  the replacement of historical bootstrap/Safe application recovery. No live
  policy or factor configuration was changed.
- A reproduced API regression allowed an old step-up cookie to become valid
  after role revocation/regrant. The local repair signs the current role version,
  rechecks it for every protected session, rejects legacy cookies when the new
  authority flag is on, and rejects authorization changes during passkey
  verification before issuing a cookie. Mixed dual-wallet/no-factor flags now
  fail closed instead of falling back to social profiles. Complaints are never
  deleted. Snapshot: `output/recovery/phase-a-session-binding-2026-10-08/`.
  Failing evidence: `output/audit/passkey-session-regrant-before-2026-10-08.log`.
  Focused regressions passed 139/139; the full working-tree suite passed
  **1,776/1,776, zero failures/skips**, including isolated PostgreSQL. Logs:
  `output/audit/passkey-session-binding-{focused-final,full-unit}-2026-10-08.log`.
  Build passed 11 routes / 175 utilities, recorded in the matching `build` log.
  A subsequent real SQL grant -> cookie -> revoke -> regrant regression and
  policy guards passed **74/74, no skips** in
  `output/audit/passkey-session-binding-real-2026-10-08.log`. Its credential is
  synthetic; this does not prove physical passkey acceptance. Earlier sandbox
  Docker skips and missing-process fixture failures are not acceptance evidence.
  Enrollment grants and factors still need full role-version integration;
  current checks alone do not authorize feature activation.
- Resend transfer: the owner explicitly approved temporary inspection through
  the personal account and then an Admin invitation to the project mailbox.
  The invitation was sent and accepted on October 8. A fresh project-mailbox
  login shows active Admin membership in the existing team and both existing
  verified domains. The existing four API keys were retained; no DNS/domain
  transfer, subscription or key rotation occurred. After separate explicit
  confirmation, the personal membership was removed; the project mailbox is
  now the sole Admin. Both domains and all five current keys were retained.
  Removal evidence: `output/audit/resend-personal-access-removed-2026-10-08.png`.
  Initial acceptance evidence:
  `output/audit/resend-project-admin-accepted-2026-10-08.png`.
  After separate owner authorization, the sending-only key
  `ArtSoul Protocol moderation mail`, restricted to `notify.artsoulprotocol.com`,
  was created and installed through encrypted transport. The existing website
  key was retained. The owner also explicitly approved placing the existing
  Supabase service-role key on the host for the delivery worker.
- October 8 mail worker is live: `/etc/artsoul/report-email.env` is root-owned
  mode 0600; only `artsoulprotocol@gmail.com` receives these alerts. The separate
  systemd oneshot/timer runs at most three records per invocation, 60 seconds
  after completion, with a 120-second timeout. Three observed runs exited zero
  with an empty queue. The real transport test reached the project Gmail inbox;
  one exact-key retry produced no second delivered message in Resend. The owner
  explicitly approved this permanent schedule; the prior automatic-review
  blocks on secret placement/scheduling are resolved, not outstanding gates.
  Private evidence: `docs/private/moderation-mail-worker-acceptance-2026-10-08.json`;
  screenshot: `output/audit/moderation-mail-real-inbox-2026-10-08.png`.
  Host source remains `5529973`, Base healthy (observed lag five, failed/dead zero),
  legacy Ethereum stopped. No indexer restart or synthetic complaint was made.
  Actual complaint submission, moderator decision and notification acceptance
  remain open; transport evidence does not close those gates.
- The challenge-binding continuation reproduced a separate gap: a WebAuthn
  response created before role regrant could obtain a new version-bound cookie
  if the verify request itself started after regrant. The candidate now stores
  the role version on authentication challenges and includes it in the atomic
  consume predicate. Missing/old versions fail closed under the dual-wallet
  flag, without rewriting old rows. The A8e migration is still unapplied.
  Snapshot: `output/recovery/passkey-challenge-binding-2026-10-08/`;
  failing evidence: `output/audit/passkey-challenge-binding-before-2026-10-08.log`.
  API and actual disposable PostgreSQL checks passed **128/128, no skips**,
  including signed revoke/regrant and concurrent one-time consumption:
  `output/audit/passkey-challenge-binding-real-final-2026-10-08.log`.
  An earlier TOTP fixture aged out its previous-step setup code at a 30-second
  boundary. Fixture preparation now uses database execution time; production
  code/window rules were not relaxed. Initial failure and sandbox Docker skips
  are retained and are not passing evidence. The build passed 11 routes and
  175 utilities: `output/audit/passkey-challenge-binding-build-2026-10-08.log`.
  The final complete working-tree Node run passed **1,787/1,787, no failures or
  skips**, including actual disposable PostgreSQL. Command:
  `node scripts/run-unit-tests.mjs`; log:
  `output/audit/passkey-challenge-binding-full-unit-2026-10-08.log`.
  The count includes 29 preserved unselected Safe-observer tests outside PR #294.
  Registration/factor setup and real device acceptance remain incomplete; these
  checks do not establish those flows or change any live authority flag.
- Report, Protocol Admin and public Donate flags remain disabled. Phase A is open.
- Exactly next step: complete the approved two-wallet factor-setup permission
  consumer and bind passkey enrollment grants/factors to its role version before wiring
  the role route. The policy decision is resolved; real integration is not.
  Public Donate activation also requires working donation-message moderation
  under the October 3 amendment; successful test payments do not waive it.

October 3 admin-access placement correction (published and browser-verified):

- Workspace remains `C:\Projects\ArtSoul`, `codex/takeover-audit`, based on
  `a47d57847c047a30ca68ace077433ef9599dd4ea`. The previous checkpoint diff is
  preserved in `output/recovery/admin-passkey-modal-2026-10-03/before.patch`.
- Placement [PR #290](https://github.com/maysonkiller/ArtSoul-Protocol/pull/290)
  merged as `a17af5313c3706895328dc647353a09cb6d3be10`; candidate CI
  `37083385789` and post-merge CI `37083886999` passed all jobs. Production
  deployment `6821279027` succeeded at 00:53:21 UTC. Both preview and apex
  matched all 51 JS/CSS assets across five pages to candidate `5f61e0e`.
  Evidence: `output/audit/admin-modal-{preview,apex}-artifact-2026-10-03.json`.
  The actual connected Chrome session confirmed artwork has no passkey panel,
  the account menu exposes Admin panel after server discovery, and `/admin`
  opens the verification dialog with its dark backdrop. No native ceremony ran.
- Live visual inspection also found browser-default serif typography and an
  8px body margin on the admin page. Layout-only candidate `0290132` in
  [PR #291](https://github.com/maysonkiller/ArtSoul-Protocol/pull/291) adds a
  scoped body font/reset, border-box sizing and inherited input font; it does
  not change authentication handlers. The new build passed 11 routes/177 CSS
  utilities and **145/145** browser assertions at 1280/390/320px in both themes,
  including page/dialog overflow and input font size. Evidence:
  `output/audit/admin-passkey-relocation-ui-only-browser-summary-layout-2026-10-03.json`.
  Preview deployment `6821336060` matched all 51 assets; the production CSS is
  content-hashed, so the new file cannot reuse the previous browser cache key.
- PR #291 passed all hosted checks in `37084301402` and merged as
  `838f54b71881c4e5199dd0828793c2053aeb48eb` (current workspace HEAD).
  Production deployment `6821378071` succeeded at 01:03:17 UTC; immutable host
  `artsoul-fmmldt6sn-maysonkiller-be9112b5.vercel.app`. Final apex verification
  matched all 51 assets; evidence is
  `output/audit/admin-modal-apex-artifact-2026-10-03-layout.json`.
  Actual connected Chrome on `/admin` now confirms zero body margin, the shared
  sans-serif font, 560px border-box dialog, and equal document/client widths
  (1521px). Screenshot: `output/audit/admin-modal-apex-final-2026-10-03.png`.
  Enrollment input remained empty and no native ceremony or grant issuance was
  triggered. The `/admin` and existing Hetzner login tabs are retained for handoff.
  Only this post-release checkpoint is a new tracked local change; `.codex/`,
  `output/` and private journals remain unstaged. Feature gates are unchanged.
- Founder correction: remove the Staff passkey panel from artwork pages and
  put enrollment/verification in an Admin panel dialog with clear steps and
  a dark backdrop. Scope is UI/access continuity (canon 05/07/16), with no
  economic, contract, AI valuation or live-moderation activation changes.
- Discovery now distinguishes passkey setup from enabled moderation queues.
  Only server-confirmed staff may receive the menu link. Expected-wallet
  comparison and menu session-generation guards prevent old SIWE/wallet
  responses from restoring stale menu eligibility. Protected queue/action
  gates stay intact.
- The broader admin-page stale-response correction is an inert reviewed
  candidate in `output/audit/admin-passkey-host-candidate.jsx` (11 passing
  candidate regressions). Automatic approval review rejected applying it as
  broader than the latest UI placement request. A precise human authorization
  question is pending; do not apply that candidate without the answer. The
  independently reviewed UI-only relocation is now applied; existing admin
  authentication, queue and decision handlers are preserved.
- Local verification: **1,548/1,548 Node checks passed, zero skips**, including
  disposable PostgreSQL integration; **11 built routes / 176 CSS utilities**.
  Logs: `output/audit/admin-modal-unit-verified-2026-10-03.log` and
  `output/audit/admin-modal-build-verified-2026-10-03.log`. The first restricted
  run exposed outdated source-extraction/cache assertions and could not access
  Docker/private-directory enumeration; those results are retained, not reused
  as passing evidence. Build used the installed npm CLI with a process-local
  prefix because the ordinary npm shim selected an inaccessible global path.
- The new dialog reuses the existing registration/authentication/grant routes,
  with labelled code input, explicit native-device actions and transient codes.
  Artwork no longer imports or renders passkey setup. Native dialog presentation
  opens only when verification is needed; active sessions retain Manage passkeys.
  Interpretation: setup is independent of review-queue activation, not a bypass
  of that flag or a new staff role. Real native ceremonies remain outstanding.
- Built-browser acceptance: **81/81 assertions passed**, desktop/mobile in
  Classic/Future, zero uncaught page errors, zero queue requests or external
  writes. Eight POST requests used intercepted local fixtures and synthetic
  native-credential responses, not real credentials. The pending broad host
  race cases are explicitly excluded in
  `output/audit/admin-passkey-relocation-ui-only-browser-summary-2026-10-03.json`.
  Screenshots are in `output/playwright/admin-passkey-{classic,future}-{1280,390}.png`.
- The existing renewal process is still waiting for human READY; no renewal
  journal was present at the placement correction's initial check. Do not
  restart that process merely to replace its old artwork-page instructions.
  After release, direct the human to `/admin`; the same wallet/RP/grant rules
  apply. The helper's future display text now names that route.
- Exactly next step: have the founder complete the native passkey ceremony in
  the retained `/admin` dialog using the existing audited renewal handoff, then
  read the credential/grant audit state before the second independent device.
  Do not replay bootstrap/renewal operations. The separate admin host-session
  candidate still awaits the explicit authorization answer; Phase A remains open.

October 3 card release and native handoff (completed):

- Canonical path/branch: `C:\Projects\ArtSoul`, `codex/takeover-audit`; current
  HEAD and published application: `a47d57847c047a30ca68ace077433ef9599dd4ea`,
  [PR #289](https://github.com/maysonkiller/ArtSoul-Protocol/pull/289).
  Corrected candidate `98a7a7c7f42d1d303f526fdd7de91472bd6601fc` passed all
  Linux, Windows and static jobs in CI `37080015592`. The earlier Windows
  failure was a test-only LF/CRLF assumption; its log remains retained.
  Post-merge CI `37080283906` also passed all three jobs.
- Production deployment `6820742214` succeeded at October 3, 00:02:17 UTC,
  immutable host `artsoul-gwbb386xv-maysonkiller-be9112b5.vercel.app`. Apex
  verification matches 49 JS/CSS assets across four pages to the tested build.
  The final test/document-only commit did not change application artifacts.
  Evidence: `output/audit/card-menu-{preview,apex}-artifact-2026-10-03.json`.
  Email remains enabled; Report/Admin/Donate remain gated. The Base indexer is
  healthy with zero observed lag; legacy Ethereum Sepolia stays stopped by design.
- Shared preview metadata and ellipsis actions are published. Local evidence:
  1,528 Node checks, 76 built-browser checks, 11 built routes/177 CSS utilities,
  and 29 independent focused checks passed. Real profile data loaded correctly
  on the preview host, then the wallet extension redirected it to a security
  warning. Browser interaction was stopped, not bypassed. The extension now
  blocks automation until the user closes its warning. No final connected-browser
  or physical-device acceptance is claimed from asset equality.
- The October 2, 23:57 UTC operator read still found one role, zero passkeys,
  one unused grant and zero available grants: the first code expired. A separate
  reviewed renewal window (28 offline checks) is waiting for human READY.
  Its journal was still absent in the latest process check; no renewed grant is
  claimed. Initial bootstrap and completed auction 66 transactions must not be
  replayed. Enroll/Verify on native authenticators remain human actions.
- Resend delivery and Donate deployment are complete as recorded below. Mailbox
  link confirmation, indexer host access/source registration and real Donate
  payment/projection tests remain outstanding. Phase A is not closed; the
  retained device/OAuth/moderation/recovery and A10 gates are unchanged.
- Application source is committed and published. The only new local tracked
  change after release is this checkpoint; `.codex/`, `output/` and private
  journals are preserved and excluded from staging.
- Exactly next step: after the user closes the extension warning and completes
  Enroll/Verify, read the credential/grant audit state and continue the second
  independent passkey. Resume Donate host inspection when Hetzner login is ready.

October 3 activation and card alignment (completed preparation; retained evidence):

- Workspace remains `C:\Projects\ArtSoul`, `codex/takeover-audit`; base HEAD for
  this follow-up is `1c55599bfabf848b41321a7452507dfec419c443` (PR #288).
  PR #287 released the second-device passkey interface. PR #288 repaired a
  missing Vercel rewrite for `/api/profile/email`; candidate CI `37077626390`
  and post-merge CI `37077971791` passed. Production deployment `6820404323`
  succeeded at `artsoul-ipoondbg2-maysonkiller-be9112b5.vercel.app`.
- Email and passkey routes are active on the apex. Reporting, Protocol Admin
  and Donate remain off. One real verification email was accepted and reported
  Delivered by Resend; screenshot: `output/audit/profile-email-delivered-2026-10-03.png`.
  The request did not mark email ownership verified, and the signed-in test
  session was logged out. The mailbox-link confirmation is still outstanding.
  Preserve the initial zero-send failure and the one-send retry evidence; do
  not blindly send again.
- The founder-authorized test wallet now has one active staff role and one
  audited bootstrap grant. A read-only check at October 2, 23:40 UTC found zero
  passkeys and the grant unused. Native registration, a second independent
  authenticator and Safe recovery remain human/operational acceptance steps.
  Never replay the initial role/bootstrap helper. An expired unused grant can
  only be superseded through the existing audited grant procedure.
- The isolated Donate contract is deployed on Base Sepolia at
  `0xA36bD0Da05fA5Aa113834aD355363C66cd42a22b`, block `47607186`, transaction
  `0xa4e943175ecf2b0641b869436277fc9c79a5ff734a2cd099a1a9c5771fbfd7ae`.
  Both RPCs verified canonical inclusion, runtime code, Core and Safe owner.
  The initial runner stopped on a receipt disagreement; read-only recovery
  finalized that exact transaction without re-signing or rebroadcasting.
  No donation payment has been sent. Indexer source registration still needs
  authenticated host access; the current SSH identities were rejected.
  Preserve the existing cursor and prove the deployment-to-registration gap
  before payment tests or public activation.
- The founder requested matching preview metadata and an ellipsis menu on
  home/gallery/profile. The pending patch reuses the shared card, removes the
  profile-only body/action layout, and exposes available actions through that
  menu. Donate/Report links open the existing checked forms only; feature gates
  remain authoritative. AI valuation, auction economics and contracts are
  outside this patch. Existing source differences were preserved under
  `output/recovery/card-menu-2026-10-03/` before release preparation.
- Unfinished public diff: shared card/menu, profile/gallery integration, narrow
  artwork action links, matching CSS/cache references, regressions and status
  documentation. `.codex/`, `output/` and ignored private material must not be
  bulk-staged. Phase A remains open; device, OAuth and native key ceremonies are
  not inferred from fixtures or an enabled flag.
- Final card candidate checks: **1,528/1,528 Node tests passed, zero skips**;
  build **11 routes / 177 utilities**; **76/76 built-browser checks** across
  home/gallery/profile, both themes and 1280/390px widths, zero page exceptions
  or write/auth/transaction calls. Native links, menu keyboard/focus behavior,
  delayed wallet restoration, checked forms and disabled gates were covered.
  Wallet/data/config were fixtures, not physical-device or real payment proof.
  Independent review passed 29 checks with no remaining P1/P2 finding in scope.
  The first full run found one obsolete profile-wrapper assertion; its failure
  is retained. Current logs: `output/audit/card-menu-unit-verified-2026-10-03.log`,
  `card-menu-build-final-2026-10-03.log` and
  `shared-card-actions-built-browser-2026-10-03.log` in that same directory.
  Hosted Windows then exposed a test-only LF/CRLF assumption in callback
  extraction; the test now normalizes line endings before parsing. Application
  source and the verified build are unchanged; require the corrected CI run.
- Interpretation recorded: each menu shows available View/Donate/Report actions
  and creator/owner controls. Existing checked artwork forms own submission;
  moving an entry into the menu never grants permission or submits a transaction.
  No architecture amendment was needed. The moderator canon's stale September
  29 scheduling sentence now references the already approved October 3 amendment.
- Exactly next step: publish this verified card candidate, require its hosted CI
  and preview acceptance, then verify the apex artifact before resuming the
  pending native-passkey and indexer-access steps.

October 3 initial release candidate (completed; retained evidence):

- PR #286 is merged as `aaf24cd5b03241f380a20efa2ca1e407a9d519a4`, now the
  working HEAD. Candidate and post-merge CI passed. Production deployment
  `6820025852` succeeded; its immutable host is
  `artsoul-otar63kt2-maysonkiller-be9112b5.vercel.app`. Preview and apex checks
  matched 48 assets across four pages to the tested candidate build. Evidence:
  `output/audit/phase-a-{preview,apex}-artifact-2026-10-03.json`.
  All work remains in the canonical checkout; recovery archives are preserved.
- The founder authorizes real passkey/recovery setup now and removes the Donate
  message amount threshold. Any non-zero donation may include a message; 100%
  goes to the creator. The separate contract has no minimum/setter. Exact prior
  rules and the amendment are recorded in
  `../canon/CHANGELOG_2026-10-03_PHASE_A_ACTIVATION.md`.
- Profile email now clears immediately on same-wallet sign-out and fences old
  reads/writes without cancelling initial sign-in. Donate rejects obsolete
  receipt-check completions and keeps changed-calldata replacements locked for
  verification. Three real local HTTP reproductions also exposed an A8d
  wrong-chain check that trusted static provider configuration; it now explicitly
  queries each RPC's chain ID before accepting Safe code/signatures.
- Current complete Node regression: **1,512/1,512 passed, zero skips** in
  `output/audit/phase-a-unit-final-2026-10-03.log`. The initial run's only failure
  was an obsolete test requiring the now-superseded passkey deferral; its log is
  retained. Final build passed **11 routes / 177 utilities** in
  `output/audit/phase-a-build-final-2026-10-03.log`.
- Current full contract suite passed **46/46**, including the amended any-positive-
  amount donation cases, in `output/audit/phase-a-contracts-final-2026-10-03.log`.
- Actual built browser checks passed: profile **13 groups**, Donate UI **26**,
  Donate recovery **22**, Report **3**; zero uncaught page exceptions. Wallet,
  mail and transaction transport were local fixtures in these runs. They do not
  prove real delivery, signatures, OAuth, physical phones or passkey enrollment.
- Resend verified the mail domain; Cloudflare contains the three authorized
  records and the original seven are preserved. A domain-restricted sending key
  and sender/origin configuration were saved to Vercel Production under explicit
  founder approval. No value is in Git or this document. Email activation and a
  real verification roundtrip still require the reviewed schema and release.
- Four feature schema stages are now committed and verified: shared quotas,
  private email, donations, and typed donation-message reports. A fresh protected
  backup was read and validated before application; eight isolated runner checks
  include actual transaction rollback. The private application journal records
  every stage. Existing A8 migrations were reconciled and were not rerun.
- The founder selected the existing testnet wallet ending `6989B` for moderation.
  No role or bootstrap grant has been issued yet. The separate second-passkey UI
  is being tested. Email/passkey flags are saved for the next deployment; that
  is not proof of runtime activation, delivery or authenticator enrollment.
  Reporting, Protocol Admin and Donate remain inactive. Auction 66 is complete
  and must never be replayed.
- Exactly next step: publish and verify the bounded second-passkey interface,
  then complete the authorized email, operator and Donate activation using their
  separate journals; native authenticator confirmations remain human actions.

October 2 auction 66 continuation (completed):

- HEAD remains `4e67451617be3bf96dc814026d45243f82f1b2b7`. The September 30
  uncommitted implementation remains intact, with a tracked patch and new-source
  recovery archive in `output/recovery/auction66-20261002`. No release, migration,
  contract deployment, moderation activation or mainnet operation occurred here.
- Both Base Sepolia RPCs reconciled all eleven previous journal records and the
  pinned Core/NFT hashes. Auction 66 still mapped to artwork 34, remained Active
  after its unchanged deadline, and retained the authorized buyer at 0.011 test
  ETH with a 0.01 deposit. The new real `before-end` verification passed.
- Exactly three new authorized transactions completed: end auction 66, settle
  with the exact 0.001 test ETH remainder, then withdraw the creator's own
  0.010725 test ETH credit. Token 6 was minted to the buyer, floor became 0.011,
  active auction mapping cleared, and treasury credit increased by 0.000275.
  Treasury credit was not withdrawn; the earlier losing-bidder refund was not
  repeated. [Receipt and verification evidence](PHASE_A_TESTNET_2026-09-29.md#october-2-auction-66-completion).
- All three real settlement verifier stages passed against one explicit
  before-end basis. The separate withdrawal verifier passed exact wallet/Core
  balance deltas including execution and L1 fees, zero creator credit, unchanged
  NFT state and `NothingToWithdraw` for a repeat simulation. Offline verifier
  checks: 31 settlement and 20 withdrawal, all passed.
- Public projection/provenance/indexer reads converged. Eleven actual apex
  browser checks passed: desktop/mobile artwork, token/floor/timeline, creator
  Created and Sales, buyer Owned NFTs and gallery. Zero page exceptions; no
  connected wallet or physical-device acceptance is inferred. The scheduled
  `finish-artsoul-auction-66-rehearsal` automation was deleted after completion.
- Phase A remains open for retained phone/OAuth, connected wallet UI, reviewed
  moderation/operator activation and go/no-go evidence. The separate September
  30 social/email/Donate implementation still needs its final changed-tree
  checks/release and outstanding activation inputs; this heartbeat did not resume
  its DNS/browser setup or merge that diff.
- Exactly next step: resume the existing September 30 candidate's final
  email-session/Donate-recovery browser regression and current-tree release checks;
  never replay auction 66's now-completed operations.

September 30 17:31 desktop follow-up (active):

- Canonical workspace/branch: `C:\Projects\ArtSoul`, `codex/takeover-audit`,
  starting HEAD `4e67451617be3bf96dc814026d45243f82f1b2b7`; tracked tree was clean.
  No new checkout, source overlay or historical worktree integration occurred.
- New recording: 252.90 seconds, 1920x1080, SHA-256
  `91902a2fa6d51624a6960235168d41d3299bf825dd3f8a8267170a53dd7ff370`.
  All 126 two-second samples were visually reviewed. Local chunked speech
  recognition is approximate and is not a verified quotation. Evidence stays in
  ignored `output/audit/video-review-2026-09-30-173100`.
- Confirmed request: remove visible connected qualifiers and manual X editor;
  link verified Discord profile; add private verified email after wallet sign-in;
  reduce measured loading delay; deliver Report/moderation and artist support.
  AI valuation remains excluded. The recording shows an X unlink/relink roundtrip
  and profile cancel/navigation, not every RG-01 mobile or wallet-signature step.
- Existing Report/review/notifications are implemented but disabled. Their schema
  is already applied. Operator passkey/recovery activation conflicts with the
  retained deferral; a narrow decision is pending, not a reason to stop other work.
- Local social changes remove redundant qualifiers and the manual X editor;
  verified Discord links are derived from the server-held provider identity.
  Private email uses existing wallet sign-in, single-use expiring tokens, revision
  fencing and isolated storage. Email/quota schema is unapplied; mail delivery is
  not configured locally. A catalog-only read confirms the quota prerequisite is
  absent, so a separate quota-only migration avoids applying unrelated launch work.
- Loading work adds gallery head prefetch and prioritizes the three public page
  entries before legacy wallet/contract modules. Controlled 390px runs reduced
  gallery first-card mean from 2188.95 to 1273.40 ms with one feed request per run.
  Built connected-wallet readiness and confirmed-auction propagation checks pass;
  this is controlled local evidence, not a production timing percentile.
- Artist support has a separate local contract, bounded indexer projection/API,
  optional artwork UI and wallet adapter. The dated canon amendment records the
  earlier implementation request and unchanged full-creator/no-benefit economics.
  Combined contract checks: 46/46; unit-runner checks: 6/6. Donation API, projection
  and adapter checks: 20/20; event-source checks: 7/7; isolated real PostgreSQL
  indexing/reorg/RLS checks: 9/9. Raw NUL message bytes are retained as hex before
  PostgreSQL ingestion. No new contract is deployed and feature flags remain off.
- Profile-focused verification passes 192/192; the fresh built social/email matrix
  passes 11/11, including the disabled/missing feature flag and wallet race cases.
  Moderation API/compatibility checks pass 46/46, combined real PostgreSQL review
  journeys 32/32, and ten built admin checks pass at desktop/mobile widths. Three
  normal-click report groups pass with two intercepted writes and no external write.
- The full changed-tree run passes 1,487/1,487 with zero failures/skips in
  `output/audit/desktop-followup-unit-final-2026-09-30.log`. Subsequent independent
  review found Donation signer, receipt recovery and event-time edges; their final
  source and regression completion must precede a fresh release result. Do not
  present that earlier full run as verification of those last changes.
- All current work is local and uncommitted. Existing AI valuation files remain
  excluded. No database migration, external mail or chain write was performed in
  this follow-up. Local builds pass 11 routes and 177 CSS utilities. Resend login
  confirmed only the separate ArtSoul OS domain was verified; Protocol sending
  configuration is still being prepared, not asserted active.
- Exactly next step: finish the bounded Donation recovery/timestamp regression,
  rerun the current suite/build, then release the reviewed inactive-feature candidate.

September 30 prior release (retained evidence):

- Published application revision: `aacbc5aedd76f7d668f1db3f1f0ca2ed1bdb0531` via [PR #284](https://github.com/maysonkiller/ArtSoul-Protocol/pull/284). The single checkout fast-forwarded to the exact merge. Subsequent evidence-only commits do not change this application artifact. Candidate CI `36718205321` passed Linux, Windows and static jobs; post-merge run is `36719161906`. Production deployment `6760112584` succeeded at 13:06:02 UTC, immutable host `artsoul-pdcnfoeux-maysonkiller-be9112b5.vercel.app`. Preview and apex JS/CSS hashes match the checked local build.
- TA-09 repair is published and read-only apex acceptance passed: real saved profile, one X link/no overflow, artwork 28/current auction 68 Live at 1280px and 390px; no page exceptions, no failed HTTP requests in the recorded smoke matrix. All 13 built profile fixture groups passed (edit/recovery 7, Discord/X restoration 4, tab continuity 2). No fixture is being promoted to real OAuth or physical-device evidence. [Release evidence](RG01_PROFILE_VIDEO_2026-09-30.md) contains exact tests, limits and rollback baseline.
- Current RG-01/RG-03 video correction: canonical checkout `C:\Projects\ArtSoul`, branch `codex/takeover-audit`, base HEAD `82ab404e4e9b2b0d2949e1017f0aed990739e131`. PR #283 is merged and its CI/post-merge CI passed. All historical worktrees remain recovery copies. No consolidation, overlay or new checkout is needed.
- Founder-corrected scope: AI valuation is intended, not a video defect. The unsolicited AI client/handler/tests were reverted; exact rejected drafts survive privately under `output/recovery/rejected-ai-changes-2026-09-30/`. Current artwork changes affect only the loading tree. Auction IDs, publication, prices, contracts and provider authentication semantics are unchanged.
- Local TA-09 diff covers profile OAuth return, committed profile versus edit draft, normalized saves, delayed-response guards, read-error Retry, deduplicated/wrapping social links, tab viewport continuity and shared static/React loading feedback. Cache references and generated Tailwind CSS follow these edits. New and adjusted tests plus `RG01_PROFILE_VIDEO_2026-09-30.md` record the bounded scope. Do not stage `.codex/`, `output/` or private evidence.
- Final local verification: 1,380 Node tests passed without failure/skip (`output/audit/rg01-release-unit-2026-09-30.log`), build passed 11 routes / 177 utilities (`rg01-release-build-2026-09-30.log`). An earlier run found one outdated CSS-version assertion; its failure log remains retained. Twelve built-browser loading combinations and module Retry passed; mobile wordmarks compute to 40px and desktop to 84px with reduced-motion animation disabled correctly. Four additional homepage/gallery loading-to-completion cases passed. Baseline published-entry React errors 418/423 are absent. Tab layout reproduced the original 380px jump and retained position after repair.
- Independent final review: 104 focused checks passed. Deferred probes verify old save/create responses cannot repaint a changed wallet; unlink replaces the pending initial gallery with the latest tab; an avatar upload survives same-edit unlink; failed uploads restore the draft correctly; Cancel and wallet changes do not revive stale drafts. The implementation-focused profile suite passed 171 checks.
- Built profile journey: seven groups passed on desktop/mobile, covering Cancel, normalized Save, unlink/Cancel/reload, failed read/Retry, failed refresh preserving identity, delayed Save after wallet change and module failure/Retry. Five local intercepted writes, zero page errors (`output/audit/profile-edit-built-browser-2026-09-30.log`); four built callback cases and two built tab cases also passed.
- Remaining gate: physical-device OAuth/wallet return/reload/lock and the separately deferred A8 operator activation ceremony are not completed by these fixes. Reporting/admin flags remain off. No database duplicate-profile conclusion is claimed from the apparent blank-profile symptom. The original Phase A acceptance status is not silently changed.
- Exactly next step: record the real iPhone RG-01 return/reload/lock and OAuth acceptance on the published apex revision; keep the existing auction-66 settlement handoff scheduled for its actual deadline and do not replay prior transactions.

Earlier September 30 baseline (retained evidence, superseded status where stated above):

- Application HEAD: `9dcf82bda0619e1009dcdadc0268f63b78f7a6f8`, PR #282 merged and deployed. Candidate CI 36636435784 and post-merge CI 36636763773 passed Linux, Windows and static jobs. Production deployment 6746439656 succeeded; apex artifact hashes and actual profile behavior match. PR #281 newsletter durability merged separately; its route remains unwired.
- One canonical working tree: `C:\Projects\ArtSoul`, branch `codex/takeover-audit`. Historical worktrees are recovery copies; no overlays or divergent active implementation. The schema/release records and read-only SQL verifier checks are tracked in [PR #283](https://github.com/maysonkiller/ArtSoul-Protocol/pull/283); inspect its actual CI/merge state when resuming. No new app or contract patch is pending. Preserve untracked `.codex/`, `output/` and ignored private evidence; stage only named public files.
- Eleven real Base Sepolia transactions are confirmed by two RPCs: resale purchase/approval/listing/second purchase/withdrawal, no-bid ending for artwork 28, and artwork 34 registration/auction 66/two bids/full losing-bidder refund. Never replay journalled operations. The three old authorized accounts are already DPAPI-encrypted locally; the clean founder wallet remains excluded. No key reimport or transcript search is needed.
- The real apex SIWE/Gemini/storage journey passed all 13 checks. Artwork 34 remains unminted/no floor, auction 66 leads at 0.011 test ETH. Current recorded end: September 30 21:25:20 UTC (23:25:20 Warsaw); re-read the actual deadline, winner and payment before fresh plans. Existing token 4 verifies three distinct provenance roles. See [testnet evidence](PHASE_A_TESTNET_2026-09-29.md).
- Published fixes include portrait containment, Base Sepolia profile explorer, truthful Genesis boundary, current-bid card price, zero-token classification, v16 cache references/guard and recipient notification history. Final local application suite passed 1341 checks, no failures/skips; build passed 11 routes / 178 utilities. Log: `output/audit/phase-a-release-unit-final-2026-09-29.log`. Both hosted platforms passed 33 unchanged contract tests. Windows CI initially exposed the child-pipe UTF-8 BOM issue; the corrected candidate passed genuine Windows DPAPI/BOM regressions before release.
- Live notification read initially returned 503 because all A8 tables were absent. Four unchanged reviewed A8 SQL migrations now committed under advisory lock, backup/hash checks and pre-COMMIT assertions. Eight tables, seven RPCs and five sequences pass isolation checks; all feature tables remain empty. No role, credential, grant, report or decision was inserted; all activation flags remain off. Fresh real SIWE notification reads now return 200, wrong wallet 401, bad cursor 400, logout 200. [Schema report](PHASE_A_A8_SCHEMA_2026-09-30.md) records exact hashes and limitations.
- Full and schema-only backups are private and readable; no restore drill is claimed. The database remains historically pre-ledger; no baseline entries were invented. General verification found no RLS/grant/classification violations and unchanged existing policies/Storage. The read-only verifier now includes all eight A8 and three existing A11 metric tables. Focused doc/security tests: 32 passed, zero skips.
- Local complaint/review/notification engineering: 52 focused checks, 11 real PostgreSQL journeys and 10 built-browser scenarios passed. Two newsletter requests were captured locally; no external email delivery or real staff decision is claimed. Empty live history proves availability, not recipient delivery after moderation.
- Founder deferred real passkey/recovery ceremony to Phase C before dependent activation. Phase A remains NO-GO pending actual device/OAuth and connected UI feedback, live moderation acceptance and A10. TA-08 is now done with deployed evidence; the historical 83-row register remains 64 done / 19 in progress. No mainnet, DNS, deployed-contract or economics change.
- One-time follow-up `finish-artsoul-auction-66-rehearsal` remains scheduled for September 30, 23:35 Warsaw in this chat. The app/computer must be running. Re-read chain state and immutable journals first; future settlement is not claimed.
- **Exactly next step:** at the existing September 30 23:35 Warsaw continuation, re-read auction 66 through both RPCs and prepare its authorized ending/settlement only if the actual deadline, winner and payment still satisfy the recorded testnet policy.

September 29 initial preparation — historical, superseded by the current block above:

- HEAD remains `1d8877a6579bd57c3aa504a141540ae356c5e081`. Prior documentation edits are preserved. Added `scripts/testnet-wallets.ps1`, `scripts/testnet-wallets.mjs`, `test/testnet-wallet-import.test.mjs`, and `docs/runbooks/TESTNET_WALLET_IMPORT.md`; these are local and uncommitted.
- The founder requested autonomous testnet verification and local wallet import. The importer accepts individual keys through hidden interactive input, validates the expected address and private exclusion policy, uses DPAPI plus restricted ACLs, and atomically preserves existing records. It has no signing/broadcast operation. The newly designated founder address is excluded privately; no role or Genesis assignment was made.
- A visible import window was started but later found closed; public status showed zero imported accounts. `Prepare` successfully initialized the vault without keys. User-submitted recovery material in chat was not copied into commands, source or custody files. Do not solicit or repeat it. The operator must complete the local hidden import; a process ID or a chat message is not custody evidence.
- Fresh existing checks: 1212 Node checks passed in the initial managed run, followed by all 46 PostgreSQL checks from the seven initially skipped suites under permitted Docker access: 1258 existing checks passed in total, no unresolved skips. All 33 contract tests and the build (11 routes / 178 utilities) passed. Evidence: `output/audit/phase-a-local-verification-2026-09-29.json`. Existing historical Docker material was preserved.
- New importer checks: 6/6 passed, zero skips, including an actual Windows DPAPI/child-pipe/file roundtrip. Log: `output/audit/phase-a-wallet-import-tests-2026-09-29.log`. Initial failures exposed an inherited PowerShell module-path issue; explicit built-in imports corrected it. Independent security review found partial-write and unchecked-existing-record risks; atomic rename, record/policy checks and decryption/address revalidation fixed both. Final review found no blocker for interactive import. `git diff --check` passed.
- Safe/config read-only revalidation: two independent RPC snapshots agree at Base Sepolia block 47448680; version 1.4.1, threshold 2 of 3, nonce 5, unchanged handler/singleton, balance 0.088 test ETH. Active Core/NFT wiring is consistent and Core is not paused. The Safe is not the owner/pending owner of these contracts or Core treasury. Apex contract config matches the local file. Full addresses and evidence remain in ignored `docs/private/safe-revalidation-2026-09-29T07-07-35-704Z.json`; human custody and A8d are not proven by read-only checks.
- Limits: no signing, broadcast, OAuth, mobile ceremony, passkey enrollment, production migration, moderation activation, mainnet or DNS change. Phase A remains 64 done / 19 open. Do not mark resource/device gates complete from automated tests. The existing application build does not publish these new local operator scripts.
- Exactly next step: complete the hidden local import of the existing three test accounts, read their public metadata, then prepare a bounded testnet plan against their actual assets. Resume final-origin device acceptance alongside that work; do not silently substitute script transactions for phone/wallet UI evidence.

September 28 owner-instructions update (documentation only):

- Current HEAD: `1d8877a6579bd57c3aa504a141540ae356c5e081`. Published stabilization remains `81627ab`; PR #281 is a separate draft. No new deployment, signing, enrollment, migration or activation was performed.
- The owner requested a complete Russian Phase A procedure and an explanation of optional local test-wallet automation. The private guide is `docs/private/PHASE_A_FOUNDER_ACTION_RU.md`, excluded by the existing Git ignore rule; it contains no credentials. All 19 remaining rows and TA-01/02/06 are mapped. Redesign remains future work.
- Corrected the device sheet's stale count, test-funding claim, post-mint Owner rule, insufficient A-83 criterion and incomplete A-78 coverage. The close-out now follows the dated RG-01 form: one person may perform all real-device blocks using distinct wallets/profiles. Independent Safe custodians remain required.
- Corrected migration instructions to match the existing route and rollout: passkey-only flag, audited bootstrap, enrollment, Safe recovery, then admin and reporting. Clarified staging versus final-origin enrollment and the actual A8 verification queries (no embedded transaction wrapper); the recovery gate's final RP/origin evidence requirement remains in force. Independent review also corrected post-resale provenance timing, retained the nested RPC error acceptance in A-33, and accounted for prior report usage in the quota scenario.
- Validation: `node --test test/phase-a-close-out.test.cjs test/migration-ledger-coverage.test.cjs test/security-migration.test.cjs` passed 30/30, zero skips; `git diff --check` passed. This verifies the documentation/security checks, not new connected-device or production acceptance. No new application build was needed for these Markdown-only edits.
- Pending tracked diff: this checkpoint, `docs/PHASE_A_CLOSE_OUT.md`, `docs/testnet/PHASE_A_DEVICE_ACCEPTANCE_SHEET.md`, `docs/security/MIGRATION_RUNBOOK.md`, and `docs/runbooks/A8A_PASSKEY_FOUNDATION.md`. Pre-edit copies are retained in `output/recovery/phase-a-instructions-2026-09-28`. Existing `.codex/` and `output/` remain untracked and must not be bulk-staged.
- Risks/interpretations: a private key is not intrinsically testnet-only; an independently reviewed restricted local signer is an optional future implementation, not an existing capability or a Phase A requirement. Real phones, OAuth consent, passkey user presence and independent Safe signatures cannot be replaced with fixture evidence. Fault-injection rehearsal topology must be concretely reviewed before activation. No architecture or economics amendment was made.

- Published stabilization: `81627ab5d5d5f17ed190aad352e56af701f724c5`, merged via PR #280 after exact-candidate Linux/Windows CI and preview acceptance. The canonical workspace fast-forwarded to this merge. Subsequent commits on this branch contain the separate inactive newsletter correction and acceptance records, not another production rollout.
- Production: successful deployment `6691460363`, Vercel `7GkotETLCoSRM8gKwsAMur2VCWua`, at 11:13:22 UTC. Apex and immutable deployment match the reviewed artifact. Rollback reference is `6470347826` / `607f213`. See `STABILIZATION_RELEASE_2026-09-27.md` for URLs and evidence.
- Workspace recovery: original checkout was an ancestor 47 commits behind, with three line-ending-only dirty files. Byte backups/patches were preserved; 77 implementation files and 86 evidence files were reconciled without collisions. The old Codex worktree remains detached and locked as an archive. No overlay, hard reset, clean, blind merge or unknown-file removal occurred. Recovery snapshots and historical worktrees are not active implementations; see `../WORKSPACE.md`.
- Completed profile/AI/auction patches are included in the published build: OAuth-owned provider identities versus public links; bounded AI media reads and honest valuation/upload states; confirmed-receipt reconciliation, current-round/request guards, shared auction form, exact decimals/deposit explanation and wallet-address checks. Existing Base economics and deployed contracts/storage are unchanged. Full reproduction/patch evidence: `STABILIZATION_EVIDENCE_2026-09-21.md`.
- Hosted stabilization verification: runs `36314685277`, `36314843935` and post-merge `36315006251` passed Linux, Windows and static checks. Linux passed 1,227 Node tests with no skips; Windows passed 1,181 and skipped seven PostgreSQL suites that Linux executed. Both passed 33 contract tests. Build: 11 routes / 178 Tailwind utilities.
- Clean-install correction: npm 11.6.2 selected optional CDP 1.57 against the locked 1.55. A fresh-metadata reproduction failed before the scoped override and passed afterward, with no lockfile change. Actual clean install, 184 wallet/navigation checks and build passed. Source fingerprints: `output/audit/release-source-manifest-2026-09-27.json`.
- Apex acceptance passed: guest SDK, gallery/profile/artwork 28 and auction 63 consistency, decoded media, provenance, desktop/mobile viewport layout, disabled Collection Publish, four Back-button theme switches and reduced motion. Base Sepolia indexer healthy / zero lag; legacy Ethereum Sepolia stopped by design; reporting flag false. No application writes, wallet signatures or OAuth were performed. Only ordinary SDK telemetry ran during the uninterrupted Back-cache probe. All task browsers are closed.
- A-79 closed with a real desktop profile load: first request limit 24, identity before cards/full corpus, no settled-content reset. TA-07 closed on deployed Back-button behavior. A-48 desktop portion passed in ordinary headed Chrome with a surviving marker and `pageshow.persisted=true`; phones remain open. A-33 still lacks real transaction-feedback acceptance and a three-distinct-address provenance example: five of 34 public records were minted, none satisfied that latter case.
- A-38 bounded triage/rollout accepted. Current conservative audit count: 64 package findings (26 high / 19 moderate / 19 low). The six extra parent-package warnings inherit existing CDP/Axios findings; repeated unchanged-tree audits and the installed npm calculator reproduce the cache-dependent 58-to-64 difference. All six are in the browser wallet graph, not API/indexer entry graphs. Residual risks are documented, not waived. See `DEPENDENCY_TRIAGE_2026-09-23.md` and `output/audit/release-audit-disposition-2026-09-27.md`.
- Next Collection Launch slice implemented locally: newsletter consent/token hash persist before provider calls; duplicates keep active tokens; explicit resubscription uses conditional writes; unsubscribe fences stale snapshots; send completion never rewrites opt-out. Independent review found and reproduced a daily-quota trap, then verified the correction. The handler is still unwired, SQL unchanged/unapplied, flags unactivated, and no real email was sent. See `NEWSLETTER_DURABILITY_2026-09-27.md`.
- Newsletter evidence: original handler failed 11 checks; the additional quota-flow regression failed before repair; final focused command `node --test test/newsletter-durability.test.mjs test/security-migration.test.cjs` passed 50 checks. A preceding combined run passed 1,257 with no skips; the final 1,258-check run exposed only a documentation wording assertion, corrected and followed by eight passing documentation checks. Failed logs remain retained. Consult the follow-up PR checks and `output/audit/newsletter-publication-2026-09-27.json` for subsequent hosted verification.
- Phase A remains NO-GO: 64 done / 19 in progress / 0 planned across the historical 83 rows. Remaining gates include real iPhone/Android and connected-wallet/SIWE/OAuth acceptance, separately approved ordered moderation migrations/activation, two founder passkeys, audited bootstrap and Safe recovery success/denials. RG-02 mailbox is deferred to C14. `../PHASE_A_CLOSE_OUT.md` and the device sheet hold the specific criteria.
- Collection builder/capability review, isolated contracts and service drafts are preserved. Publish remains disabled; full service wiring, durable delivery, verified email ownership, unsubscribe availability while sending is paused, real providers, final launch terms and deployment remain unfinished. No Genesis rights, fees or proposed supply became approved economics.
- Authorization: only PR publication and the reviewed existing application rollout were approved. No moderation activation, production migration, indexer-host change, contract deployment, mainnet, DNS or irreversible operation occurred. Private keys, passkeys and operator ceremonies cannot be substituted with test fixtures.
- Current diff discipline: save only named source/tests/docs; `.codex/` and generated `output/` remain untracked evidence/recovery material. Do not stage the entire workspace. No foreign uncommitted code was overwritten.
- September 27 next step (retained history): complete the apex RG-01 acceptance trip on a real iPhone with its owner-controlled wallet, recording results in `docs/testnet/PHASE_A_DEVICE_ACCEPTANCE_SHEET.md`; keep the inactive Collection service follow-up separate from production activation.
