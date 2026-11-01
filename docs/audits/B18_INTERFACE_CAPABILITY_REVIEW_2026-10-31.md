# Interface and capability review — October 31, 2026

Status: bounded visual review completed; Phase B remains open. On November 1,
the founder accepted the separate study as the implementation design target,
with both existing ArtSoul color palettes retained. The study is not a replacement
application or evidence that production workflows have been migrated.

## Accepted target and production adoption — November 1

The founder accepted the current direction and asked to stop expanding the demo,
estimate adoption, preserve Admin and documentation, check control sizes and
consider mobile swipes. This supersedes the study's previous proposal status;
it does not approve replacing working routes with illustrative HTML.

### Preserved routes and behavior

`vite.config.js` still includes `admin.html` and `docs-protocol.html`. Neither
route nor its implementation is removed. The study's Guide and staff preview
are illustrative; they must not replace the real guide or protected workspace.

| Adoption surface | Existing implementation to retain | Required acceptance |
| --- | --- | --- |
| Shared header, cards and media | `src/ui/simplified-header.js`, `src/ui/components/artwork-card.js`, shared search, notifications, voice and Saved | Real wallet/account states; no false network support; the same actions and pressed states on Home, Gallery, Profile and detail; image/audio/video; both palettes |
| Home and Gallery | `src/entries/index.js`, `src/entries/gallery.jsx` | Discovery default/order, filters and search meaning, current auction status/timers, Back/scroll restoration |
| Artwork | `src/entries/artwork.jsx` and existing transaction handlers | Creator, First Collector and current Owner remain explicit; full provenance retained; bid/settle/withdraw/list/edit/remove/buy eligibility, pending and confirmed outcomes preserved; Donate and Report keep their actual targets |
| Profile | `src/entries/profile.jsx`, `src/features/profile/profile-edit-dialog.jsx` | Own/public distinction, all tabs including private Saved, Edit profile, account connections and notifications preserved; customization remains intentionally paused |
| Publish and collection draft | `src/entries/upload.js`, `src/entries/collection-builder.jsx` | File/auth/guidance checks, durable pending publication recovery and wallet review retained; the draft builder is not presented as deployed collection publication |
| Admin | `src/entries/admin.jsx` and current staff modules | Existing role and authority visibility, factor verification, private queue/catalog/history and recovery flows; no administrative shortcuts from demo state or cached role hints |
| Documentation | `src/entries/docs-protocol.jsx`, `src/content/protocol-docs.js` | Existing topics, links and anchors remain reachable; contextual help links to the real content |

The approved visual composition is the Future adoption target. Classic retains
its own appearance and palette; shared behavior and usability fixes apply to
both. Mobile and desktop retain identical theme color semantics. Existing theme
values stay in `unified-styles.css`; no alternative palette is introduced.
Network, token and wallet marks identify the actual selected chain, asset and
provider. The sample Rabby mark is not a hardcoded production provider. The
real mobile microphone entry must remain reachable even though the small-screen
study hides its standalone header button. No new product network is enabled.

### Control sizes and mobile navigation

A measured 48-case check (six pages, two themes, widths 320/390/768/1366) found
small account-menu, help, social and one tab target. Four scoped sizing rules
now provide at least 44 by 44 CSS pixels for visible study buttons. The rerun
found no smaller visible page buttons and no horizontal overflow. Icon artwork
stays compact; this does not require making every button visually large.
Evidence: ignored `docs/private/b18-adoption-button-check{,-after}.log`.
This check is not a complete accessibility certification. After the sizing edit,
the existing 36-layout/24-dialog and 24-artwork/42-dialog passes remained green,
including real sample audio/video playback, shared Saved state and profile edits.
The three focused static suites passed 19 tests with no skips. These are study
and presentation checks, not fresh production-wallet acceptance. Logs are
`docs/private/b18-accepted-{design,media}-check.log` and `b18-accepted-static.log`.

Adoption direction for touch navigation: keep visible, tappable tabs and add
horizontal swipe only between adjacent Gallery/Profile tabs if it remains
unambiguous in real-device testing. Preserve the browser's edge Back gesture,
vertical scrolling, zoom, text selection, input fields and media scrubbing.
Ignore gestures starting in interactive controls, dialogs or a multi-touch
sequence. Do not use swipe to bid, pay, sign, delete or moderate. Keyboard and
tap navigation remain complete; motion respects reduced-motion preferences.
Swipes are not implemented in the current study or production release.

### Delivery estimate and order

Planning estimate: **6–10 focused working days including review and contingency**,
assuming existing data, contracts and workflows are retained and test services
are available. This is an estimate of design adoption, not a completion promise
for all Phase B gates or a measure of model throughput. A coherent first set of
primary pages is approximately 2–3 working days; it is not full acceptance.

1. Shared presentation: layout/spacing/type rules and real shared artwork cards,
   retaining theme tokens and action handlers. Review both palettes at narrow
   mobile, landscape, tablet and desktop sizes.
2. Home, Gallery, artwork and Profile composition with existing live data/state;
   preserve all role-specific actions and stable loading behavior.
3. Publish, collection draft, notifications, assistant, Admin and documentation;
   review explanatory copy, dialog sizing and keyboard/focus behavior.
4. Full route/role/media regression, performance comparison and focused native
   iPhone acceptance. Release coherent tested slices with recoverable commits.

Demo expansion stops here apart from the requested control-sizing correction.
No product source, contract, migration, service or paid API is changed by this
record. B35 remains an unresolved data-integrity/release gate; visual approval
does not close it or the remaining Phase B acceptance and operations work.
The next B18 implementation slice is the shared real artwork-card presentation,
using `src/ui/components/artwork-card.js` across all existing consumers. Keep it
separate from the pending B35 recovery work and from a wholesale site rewrite.

## Scope, versions and method

Founder priority: profile/avatar consistency, simpler page hierarchy, a full
ordinary-user feature inventory and a separate redesign without breaking the
working site. Architecture/economics and replacement contracts are outside this
implementation. Relevant Bible sections: 5 (provenance), 11 (moderation), 16
(themes), 17 (phases). No contract, eligibility, fee or authority change.

Inspected source: candidate `0afa71b4`, released by PR409 as
`517b3d40a49ff85f716282c30572a37941ea95f4`. Work stays in
`C:\Projects\ArtSoul`. Previous B35/infrastructure/untracked changes remain separate.

Evidence:

- Full local suite: **2,601 passed, 35 environment skips, zero failures**;
  build, 11 HTML routes and Tailwind checks pass. Exact PR409 Linux/Windows
  builds/tests, static checks and preview are green. Vercel production status
  for the merge is successful.
- Actual profile/editor markup in an isolated Chromium fixture: both themes,
  320/390/1280 widths and 844x390 landscape; equal metric boundaries, no
  horizontal overflow, unchanged summary while editing, focus/Cancel/Escape
  and local save presentation pass. This is not new OAuth/persistence evidence.
- Loaded guest browsing on the live site: Home, Gallery, public Profile,
  artwork13, Publish, Collection Draft, Docs and Admin at 1366 and 390 pixels.
  All 16 cases had no horizontal page overflow. Images sampled after loading
  were available. Artwork13 on desktop retained one independently scrolling
  right column; mobile used ordinary page scrolling.
- Public configuration currently enables email, Report, Donate, Saved and
  auction notifications. The profile-layout capability flag is also true,
  but the editor is deliberately not rendered. A flag alone is not UI proof.
- Post-release browser check: Gallery without a hash starts with Discovery,
  followed by Auctions, NFTs, Marketplace, Collections; a profile without an
  uploaded avatar loads `/default-avatar.png`.
- Logs: ignored `docs/private/profile-summary-*`, `b18-loaded-review.log`,
  `b18-release-check.log`; screenshots: `output/playwright/b18-loaded-*`.
  Initial fast shell observations were superseded by the loaded review.
  Script elapsed times include readiness waits and **are not performance metrics**.

This review does not certify every authenticated action, every artwork/media
type, screen-reader operation, real iPhone rendering or load capacity. Existing
device receipts remain dated evidence; no new signatures or live writes were
performed. No paid service, billing setting or database data was changed.

## Avatar diagnosis and released improvement

The creator's uploaded image on artwork13 loaded in both Ownership and the
creator's public profile. The reported intermittent missing creator image was
not reproduced and is not declared fixed. A separate reproducible inconsistency
was found: the First Collector had the ArtSoul default image in Ownership but
`No Avatar` in the profile. PR409 makes these defaults consistent, preserves
uploaded images and retains an explicit failure state for unavailable images.

PR409 also removes the profile's implicit four-row metric span/negative-margin
layout, aligns the three compact metrics, vertically centers the existing-side
avatar and moves editing to a bounded native dialog outside the summary flow.
It changes display labels, not Trust, Genesis or discovery calculations.

## Capability inventory

“Implemented” describes code/surface coverage. It does not mean that every
variant was freshly executed in this review.

| User outcome | Current evidence/status | Remaining limitation or improvement |
| --- | --- | --- |
| Browse art without a wallet | Home/Gallery live; Discovery default released | Too many equally emphasized homepage panels; simplify the first decision |
| Find art, artists and help | `src/features/search/{search-ui,site-content-search}.js`; separate local gallery filter | Explain “Search ArtSoul” versus “Filter these artworks”; do not promise private/admin search |
| Save and remove favorites | Shared `src/features/saved` state/API; B13 accepted | Keep the same pressed state and action name on cards/detail/Saved; no identity list of savers |
| Read artwork, ownership and history | `src/entries/artwork.jsx`; live artwork13 populated | Reduce desktop nested scrolling; expose current-owner meaning when roles share an address |
| Publish a single artwork | Upload UI/API and recovery; native iPhone acceptance in Phase A | Preserve mandatory authorization/guidance workflow and durable pending attempts; do not replace it with demo success |
| Bid, end, pay and receive NFT | Page handlers and adapters implemented; recorded real settlement receipts | B11 expired-payment close/re-auction and remaining B12 assistant journeys still need their specific evidence |
| List, edit price, remove from sale, buy | Artwork resale modal/eligibility/adapters; B23 and B12 price-edit/removal receipts | Actions depend on actual owner/listing/network state; do not offer them to everyone |
| Withdraw credits | Page/assistant adapters and Phase A receipt | Preserve fresh on-chain amount review and wallet approval |
| Support the creator | Donate enabled; creator-address and message/history implementation | History belongs inside Donate; label clearly that donation is not purchase |
| Report a work | Enabled; form/review/audit/email acceptance in Phase A | Preserve reason/evidence and private staff access; no automatic proof from complaint count |
| Edit profile and connect accounts | Existing save, email, X/Discord handlers; compact editor released | New layout tested with fixtures; do not infer a new real OAuth ceremony |
| Read/configure/remove notifications | `notification-inbox.jsx`: badge, settings, personal/moderation split, selection/dismissal | B17 live payment-deadline/extension evidence remains separate from unit coverage |
| Receive official-project announcements | Prepared source policy; dedicated issuer deferred by founder | Off until an approved creator address is assigned; a registry contract is not a creator wallet |
| Moderate/restore hidden artwork | Admin catalog includes Hide/Restore with reason and current-version checks | Protected UI was not entered in this guest pass; no authority changes made |
| Team access and recovery | Two-authority-wallet flow, passkey/authenticator and protected staff routes | Keep roster privacy; public UI cannot treat cached role hints as authorization |
| Build a collection | Working local draft/import/export/phase planner | **Not end-to-end publication**; metadata upload, deployment, active collection pages and mint journey remain future work |
| Verify collection origin | Founder-approved policy in October7 amendment | **No issued-registry/grant/revoke workflow yet**; do not infer a badge from OAuth or a title |
| Display NFT aura | `aura-frame.js` presentation helper exists | Not wired to authoritative assignment; C14 remains pending, not cancelled |
| Customize public profile layout | Stored code/data retained; live entry deliberately omitted | Intentionally paused, not a missing button to restore automatically |
| Use voice/text assistant | Bounded English/Russian commands, shared WebMCP tools, real PC voice acceptance | Not universal-language conversational AI; paid provider activation remains deferred |
| Obtain Genesis | Dedicated mainnet-only design | No testnet entitlement/claim button; future audited issuance rather than a missing beta feature |

Primary sources: `src/entries/{profile,gallery,artwork,collection-builder,admin}.jsx`,
`src/entries/upload.js`,
`src/features/admin/artwork-catalog.jsx`, `src/features/moderation/notification-inbox.jsx`,
`src/api/routes/public/config.js`, `webmcp-tools.js`, `voice-commands.js`,
`docs/BACKLOG.md`, `docs/PHASE_A_CLOSE_OUT.md` and the dated B12 receipts linked there.

## Ranked interface findings

Score = reach x confidence x severity, following the audit skill. This list
prioritizes the requested UI slice; it does not demote the existing B35 integrity gate.

| Finding / backlog reference | Evidence | Score | Disposition and acceptance |
| --- | --- | --- | --- |
| B18-V1: inconsistent missing-avatar treatment | Live First Collector profile versus Ownership; `renderAvatar` and `getDefaultProfileAvatar` | 3x3x2=18 | Fixed/released PR409; custom/default/failure rendering tests and apex check |
| B18-V2: editor grows the identity panel; metrics waste space | Actual source/fixture before change; implicit rows and negative margins | 3x3x2=18 | Fixed/released PR409; both-theme responsive/focus evidence |
| B18-V3: current Owner meaning disappears when also First Collector | `shouldShowOwnerRole` suppresses the separate owner row for equal addresses; artwork13 shows only First Collector | 3x3x2=18 | Planned: display both role meanings in one identity block, preserve indexer ownership truth and test transfer cases |
| B18-V4: competing frames and desktop right-column scrolling | Loaded artwork13 screenshot; `.artwork-page-right` 757px viewport/898px content | 3x3x1=9 | Proposed Future hierarchy: one primary action, ordinary page flow, reveal history/details on demand; no silent removal of provenance |
| B18-V5: specialist terminology needs contextual help | Live “Would Buy”, “Watching”, “Trust”, “Floor”, “Settlement” and protocol documentation | 3x2x2=12 | Planned: short touch/keyboard explanations, links to the relevant existing guide section; user-research comprehension not yet measured |
| B18-V6: project contact is inconsistent with project mailbox preference | Homepage footer `index.html` still uses the founder's personal email | 3x3x1=9 | Planned copy-only correction to the approved project contact; do not modify provider credentials |
| B18-V7: missing creator photo is intermittent/unreproduced | Uploaded creator image loaded in both sampled surfaces | Not scored | Keep as observation; if it recurs capture profile URL, exact image request/result and cache state before changing identity logic |

Rejected shortcuts: globally shrinking all text, fixing every region to one
screen, hiding authority checks, eagerly loading original media, inventing badge
eligibility from popularity, or rewriting working flows solely to match a mockup.
These make appearance simpler while increasing access, readability or correctness risk.

## Separate Future study

Canonical artifact: `docs/design/ARTSOUL_FUTURE_STUDY_2026-10-31.html`.
No remote asset requests, API, wallet, upload, microphone or persistence. All names,
amounts, artwork and notifications are visibly illustrative. Its clickable
Home/Explore/Artwork/Profile/Create/Guide pages show the design direction.

- November 1 founder correction supersedes the initial alternative palette:
  retain both existing ArtSoul palettes exactly. The root/Classic/Future color
  definitions are copied unchanged from `unified-styles.css` into the independent
  study; layout aliases reference those values. Brand marks and sample media
  retain their own asset colors. No production theme file was changed.
- One main action per region; stable header controls; compact profile metrics.
- Saved state shared across cards/detail/profile, selected artwork preserved,
  edit Cancel/Save, search targets and read-notification feedback are interactive.
- History/Provenance is initially expanded, with explicit ownership roles;
  guidance/details remain disclosures. Dialogs are bounded and native.
- A Classic reference switch illustrates separation only. It does not change
  the deployed Classic palette or promise pixel-identical reproduction.
- Verification is shown as a **proposed mark in the guide**, not awarded to any
  demo account. It is distinct from saved checks and decorative aura.

November 1 requested coverage extension (study only):

- Distinct Base Sepolia network, test ETH currency and Rabby provider marks,
  all served locally from official sources listed in `../design/study-assets/README.md`.
  No additional networks, wallet provider integrations or payment assets enabled.
- Image/video/audio cards; on-demand local synthetic media playback, inline video,
  pause/stop on navigation or dialog opening, and one active player at a time.
- Card action sheet: Donate to the original creator, Report, creation-transaction
  explanation. No fictional transaction hash or original-file download added.
- Creator, First Collector and current-owner meanings remain explicit, including
  one combined person row when the latter two are the same. This is a proposed
  display clarification, not a new ownership rule or a live application patch.
- Mobile puts the artwork and its primary action before ownership/history.
- Account menu exposes My profile, wallet/network information and help. Staff
  menu entry can be explored only after explicitly selecting the demo staff state
  in Guide; it grants no authorization and loads no private records. Real admin
  operations are not implemented in the study. Profile customization stays paused.

Additional browser evidence: 24 artwork/theme/width cases, 42 dialog cases;
actual audio/video playback, single-player behavior, pause on navigation, correct
Donate/Report target, same/different-owner cases, mobile content order, demo staff
visibility and reduced motion passed. No page errors or remote requests observed.
Original 36-layout/24-dialog regression pass also remains green. Native iPhone
playback has not been retested; Chromium width emulation is not that evidence.
The first CLI attempt passed multiline code incorrectly and failed to parse;
the file-based run passed. Local favicon404 was removed with an empty data favicon.
Private evidence: `docs/private/b18-network-media-{baseline,check}.log`.

Prototype browser checks: **36 page/theme/width cases**, **24 dialog cases**,
cross-surface favorite removal, correct search target, profile cancel/save,
stable summary, unread clearing, zero JavaScript page errors. Widths 320/390/1366;
screenshots inspected. It remains a design study, not production acceptance.
First rerun after an asset edit hit a development-server reload; the subsequent
unchanged-file run passed. No production failure is inferred from that event.
The repository-wide grid guard also caught a generic `grid` class in the
standalone study. It was renamed `study-grid`; the guard was not weakened.

## Verification mark policy

The founder-approved rule remains: review creator-to-collection origin, record
the decision, allow revocation, impose **no sales threshold**, and change no
Trust, price, fee or ownership. See
`docs/canon/CHANGELOG_2026-10-07_ADMIN_AUTHORITY.md`.

Proposed implementation checklist (not activated): prove control of the creator
wallet, establish the public project's connection to the collection using an
official channel, check identifying metadata, record reviewer/evidence/reason
and grant/revoke events, and show a clickable explanation of scope. Do not
describe this as a copyright, investment or security guarantee. Define appeal,
recheck and delegation policy before issuing marks; critical authority remains
under the existing approved approval model.

OpenSea currently distinguishes verified accounts from collection badges and
does not treat a badge as an endorsement. Its published application requirements
include volume; **that is not ArtSoul's approved rule**. Reference checked
October31: [OpenSea verification](https://support.opensea.io/en/articles/8867072-what-is-a-verified-account-or-badged-collection).

Accessibility references: [WCAG target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)
and [hover/focus content](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html).
The study uses 44px primary controls and persistent field labels. A formal
contrast, zoom, keyboard/screen-reader and real-device audit remains required
before adopting a new shared design system; a screenshot is not conformance proof.

## Performance, operating cost and phase exit

Current public data loads in this pass. That does not close the prior egress
incident. Before buying capacity, measure bytes by route/source, request
duplication, image sizes, database query volume and indexer behavior. Keep
thumbnails appropriately sized, original media on demand, bounded projections,
cache invalidation, explicit errors/retry and separate Protocol/OS environments.
Removing a link alone does not solve database egress. Expensive hosting cannot
repair an unbounded query or recovery error; no million-user capacity is claimed.

Phase A is recorded complete in its closeout with its historical coverage limits.
Phase B still has concrete work:

1. **B35:** prove a retained common ancestor before reorg rewind. The preserved
   sparse-header reproduction leaves an orphan auction; repair and verify before
   activating the existing indexer worker's new release. No new host is implied.
2. **B30/B03:** measure corrected usage slope, exercise independent restore,
   finish monitored-operation evidence. Do not change billing to claim closure.
3. **B11/B12/B17:** close the exact remaining page/assistant/reminder acceptance
   cases without replaying completed transactions or repeating accepted Phase A tests.
4. **B18/B20:** finish the scoped help/owner-role/content follow-ups and introduce
   approved Future changes in small verified components, not a wholesale mockup swap.
5. **B01/B02/B04/B07:** founder-led real tester cohort, observed journeys and
   incident/defect loop. Engineering tests cannot substitute for actual users.

Final Snapshot A is deferred to the end of the final public testnet, not a
current-beta gate. Collection publication, authoritative badges/aura, contract
redesign, Genesis issuance and mainnet assurance belong to their recorded C work;
multichain payments remain research, not an active product promise.

Next data-integrity step: resume the existing B35 sparse-ancestor regression
and require proof before mutation, preserving current writer/cache/lease fences.
Do not open a second source checkout or silently close B35 based on UI success.
