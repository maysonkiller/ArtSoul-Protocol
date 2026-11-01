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
| Shared header, cards and media | static shared headers, `header-prepaint.js`, `avatar-dropdown.js`, `src/ui/components/artwork-card.js`, shared search, notifications, voice and Saved | Real wallet/account states; no false network support; the same actions and pressed states on Home, Gallery, Profile and detail; image/audio/video; both palettes |
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

## November 1 shared navigation adoption

Released in PR414 /63163ad5 after exact CI41260263441 (Linux3204/2skips,
Windows2649/35skips,49 contracts each, both builds/static). Production7466914003
is green; six live routes and exact built CSS bytes match. Guest Gallery, Admin
and Docs pass390/1366 header geometry checks. Eight
product pages ship native Home, Explore, Create and Guide links in their existing
header. Future displays them at first paint, on a second row below1101px. Classic
keeps its previous composition and both palettes are unchanged. Mobile Future
uses a44px avatar control and exposes the full bound identity inside its menu;
search, microphone and notifications remain reachable. Admin/Docs routes and
permission checks remain real. No new navigation dependency or wallet SDK.

Local Base/ETH and conditional Rabby marks identify the actual recognized chain,
asset and provider. Unknown providers have no invented brand. Cached values do
not supply image URLs or provider identity; labels are escaped and late network
responses cannot overwrite another wallet. Base Sepolia remains the sole switch
target. The legacy navigation manager no longer inserts a fixed Back overlay
into the new primary links; explicit page Back controls/history remain intact.

Validation: 2678 local unit tests pass,35 environment skips. Initial run found
three stale cache-pin expectations, corrected with the new runtime hashes. Build
passes11 routes and172 utilities. Browser matrix covers80 static first-frame
layouts (eight pages, two themes,320/390/768/1024/1366), six connected-menu layouts,
plus four long-provider/foreign-network layouts. No overlap or horizontal
overflow; header height matches popup/sticky offsets. Native notification popup
opens/closes below the header. Local marks decode successfully. Synthetic wallet
fixtures perform no signing or real authentication; no new iPhone acceptance is
claimed. Independent review found two compact-menu risks, addressed and rendered:
wrapped network marks preserve16px sizing and long provider names wrap.

Evidence: ignored b18-navigation-{layout,menu,long,units-final,build-final}.log,
output/playwright/b18-navigation-*.png. CSS63, avatar58, navigation8. Release and
exact candidate CI are pending. Interpretation: the accepted study's mobile
avatar-only presentation needs a full identity in its menu; the working microphone
remains visible. No architecture/economics change. Next: adopt Home/Gallery page
composition and existing controls, then artwork/Profile/forms.

## November 1 shared production-card adoption

The first implementation slice uses the existing shared DOM/React card; no new
card component, dependency or wallet/action handler is introduced. Future adopts
four columns on wide screens, three at tablet widths and two on phones across
both Home grids, Gallery, Profile and Saved. It uses an 18px frame, 16px body
spacing, a landscape preview on sufficiently wide cards and square previews on
narrow cards. Metadata stacks on narrow cards; long statuses and complete prices
wrap rather than disappear. The palette values are unchanged. Classic retains
its original composition. Shared media corners derive from the card radius.

The existing Profile mobile heading override was narrowed to exclude card titles;
otherwise it silently defeated the shared typography. Testing also found live
Saved audio/video controls overlapping labels at 320px and the Saved button on
short desktop previews. A 144px media minimum, square narrow-card previews and
4px right inset on the narrowest playback row keep all controls separate.
Menus remain over media and keep Donate, Report and Creation transaction order.
Saved pressed/pending state, status/timer logic and media behavior are unchanged.
All ten root HTML consumers advance the common stylesheet reference to v62.
Admin and documentation routes and their implementations remain present.

Validation: 126 focused unit checks passed with zero skips; production build,
11-route verification and 172 Tailwind utility verification passed. The real
Home/Gallery/Profile renderers passed 221 browser assertions in 30 combinations
of five widths (320/390/768/1024/1366) and both themes, with zero page errors or
outbound writes. Real Saved modules passed cross-surface add/remove in eight
layouts plus pending-operation, wallet-change and expired-session checks.
A further eight Saved audio/video layouts exercised actual sample playback,
measured all five overlay regions and found no overlap or off-card controls.
These browser checks use synthetic transport and local sample media; they do not
claim fresh native iPhone, wallet signing or production service acceptance.
The first exact CI run exposed three old stylesheet-version assertions. Their
expected version is advanced to v62 without weakening the order/consistency
guards. The full local suite then passed 2,645 checks with 35 explicit environment
skips (including 29 pre-existing untracked authority-policy tests); exact CI runs
only tracked tests. No product behavior changed in this follow-up.
The same 221 assertions also passed against the production build, with zero page errors. Exact-candidate CI and release status are recorded separately.
Evidence is retained in ignored `docs/private/b18-card-*.log`,
`docs/private/b18-saved-toggle-check.log` and
`output/playwright/b18-{cards,saved-media}-*.png`.

Interpretations: adopt Future geometry only, retain Classic appearance; adapt
media ratio to actual card width so controls remain usable; use two phone columns
while preserving all 44px primary overlay targets. No change to Bible sections 5,
16 or17 architecture, economics, roles, deployment or supported networks.
The wider page/header/detail redesign, mobile gestures and remaining B35 gates
are not closed by this slice.

Release: PR #413 merged November 1 at 00:50:01 UTC as
723461df21dfc50116c5ab64c46f4a207d81e7fa. Exact candidate
19b572eb64cb22ee3f44856cab18e1588236df2c passed CI41258135755:
Linux 3,171/two skips; Windows 2,616/35 skips; 49 contract tests on each platform;
both builds/static checks and Vercel preview. Production deployment7466638111
is green. Home/Gallery/Profile/artwork13/Admin/Docs return200 and share the
exact built unified-styles-C97qIvTY.css. Live guest Gallery renders28 actual
Discovery works at1366/390 in four/two Future columns with18px frames and no
horizontal overflow. Menu links target the same work. No authenticated write or
native-device acceptance is inferred. Owned browser sessions and preview4211
are stopped; the pre-existing4198 study server is retained. Evidence:
`docs/private/b18-card-{production,preview-final,live-visual}-check.log`.

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

## November 1 Home and Gallery adoption

Released in PR415 / `e396dfb5`, based on `63163ad5`.
Future adopts the accepted two-column hero with a static CSS illustration,
left-aligned discovery heading, quieter informational panels, Gallery heading
and underline categories. The illustration makes no media/API request and is
not presented as a purchasable work. Real metrics, ranked feeds, error/retry,
all five categories, status, sorting, local search and price filters remain.
Classic retains its composition; Home copy is shared and both original theme
palettes remain unchanged. Gallery's category strip scrolls natively on narrow
screens; direct category bookmarks stay visible without moving the page.

The shared select had two keyboard/accessibility stops: clipped native control
and visible replacement. Enhancement now exposes only its ready replacement,
preserving labels, native values, form reset, validation and events. Unsupported
multi-select/listbox controls stay native. This is a behavior correction shared
by both themes, not an alternate form implementation.

A reproduced mismatched profile response could place wallet B's identity and
initial balance in wallet A's header. The existing menu/cache generation guards
did not prevent the in-memory profile cache from accepting it. Responses with
an explicit different wallet are rejected before caching; render uses the
requested/current wallet and existing wallet-only fallback. Bounded retry,
matching casefold and missing-wallet compatibility remain. No signing/auth
bypass was demonstrated, and no real wallet action was run for this fix.

Local full units2695pass/35 explicit skips; build verifies11 routes/172 utilities.
Initial unit run caught two runtime-pin updates and one old initializer assertion;
all corrected without weakening their guards. Browser source190 assertions across
20 Home/Gallery layouts passed; final built checks add direct category bookmark
and actual keyboard selection/focus. Built checks passed 195 assertions across
20 layouts, with no page errors or write requests. Exact CI41261857497 passed:
Linux3221/two skips, Windows2666/35 skips, 49 contract tests on each platform,
both builds and static checks. Preview7467067613 and production7467108395 pass.
Six apex routes serve the exact compiled stylesheet, SHA256
`fe861b1e8aef8ead9bc9f149c11948e192acb081a33b0386079dfbb9c61d97bf`.
Live guest Home/Gallery at390/1366 load real metrics and16/28 cards respectively,
with no horizontal overflow. These public reads made no wallet operations.
Evidence: docs/private/b18-discovery-*.log and output/playwright/b18-discovery-*.
No native iPhone or wallet acceptance is inferred from synthetic transport.

## Profile, artwork, publish, Admin and Docs adoption — November 1 release

Based on PR415 / `e396dfb5`, in the same `C:\Projects\ArtSoul` checkout.
Future now uses the accepted compact profile summary and equal statistics,
ordinary page scrolling on artwork, readable publication form, calmer protected
Admin navigation and accessible Docs contents. Classic composition and all 71
theme variables remain unchanged. Existing media, wallet handlers, recovery,
complaint/donation dialogs and protected access checks are retained.

Artwork roles stay explicit: matching First Collector and current Owner share
one identity row with both labels; transfers and creator buybacks retain their
distinct roles. Provenance remains the real indexed history. AI guidance and
technical details use native disclosures in Future; mobile visual and DOM order
match. Community help explains the existing signals and links to the real Guide.
The public contact address is the approved project mailbox.

Two related interaction corrections accompany the presentation: profile tab
switches retire the outgoing read immediately and release the temporary viewport
reservation when the current load settles; the existing file picker gains a
native keyboard button and ignores its own bubbled input click. Docs navigation
focuses the opened topic and respects reduced motion. No new dependencies.

Final local units: 2,717 pass, zero failures, 35 explicit environment skips
(includes 29 pre-existing untracked authority-policy checks, outside this PR).
Build: 11 routes and 172 utilities verified. Actual built-browser checks pass
706 assertions across both themes and 320–1366px layouts: all eight artwork
panels, role labels, dialogs, native audio/video playback, profile editing and
all five tabs, publication file types, 14 Docs topics/keyboard focus, and Admin
queue/navigation/session-loss gates. Native Space activates the chooser once.
Synthetic transport blocks remote writes; protected Admin states use fixtures.
No physical iPhone, live wallet, paid AI or new moderation ceremony is inferred.
Evidence: `docs/private/b18-built-*.log`, `b18-detail-{units,build}-final.log`
and `output/playwright/b18-{detail,profile-flow,publish,docs,admin}-*`.

Interpretations: publication steps are orientation, not a new state machine;
disclosures do not hide required publication or auction actions; the changed
layout does not amend economics or lifecycle. Collection drafts are the next
presentation slice; issuance, badges and contract deployment remain unfinished
capabilities rather than enabled demonstration buttons.

Released PR416 / `8b687411` from candidate `2cce8c70`. Exact CI41264138384
passed Linux3,243/two skips, Windows2,688/35 skips, 49 contract tests per
platform, both builds and static checks. Preview7467359680 and production
7467399560 succeeded. Six apex routes serve the exact stylesheet SHA256
`752d553ee5845c45f1854c26b7beeb6cfc01dd4dae82afb594fea78306897182`.
Live public Artwork13, creator profile, Publish, Guide and guest Admin pass at
390/1366 without horizontal overflow; actual indexed First Collector/Owner
labels are visible. No protected guest rows or wallet operations. Evidence:
`docs/private/b18-detail-{ci,preview-release,production-release,live-check}.log`.

## Collection draft presentation — November 1 release

Future-only CSS adapts the existing Collection/Phases/Review flow: 44px actions,
16px fields, wrapping long text and quiet panels. Classic, both palettes, the
existing draft model and unavailable publication boundary remain unchanged.
This is not Collection Launch activation. All 29 draft/capability unit tests and
build pass. Source and built-browser passes each verify194 assertions across
eight theme/width layouts and all three steps, including actual browser-local
save/load, valid/invalid import, blank/undo, phase reorder/remove/undo, review
errors, keyboard explanation and quota failure preserving the saved copy.
Evidence: `docs/private/b18-{built-collection-browser-check,collection-units,
collection-build}.log`; no remote writes or wallet operations.

Released PR417 / `b4416d92` from candidate `fd3a3d2b`. Exact CI41264742604
passed Linux3,243/two skips, Windows2,688/35 skips,49 contract tests per platform,
both builds and static checks. Preview7467441395 and production7467479143
succeeded. The apex collection entry and stylesheet match the built bytes;
collection CSS SHA256 is
`723bc0325e8cdbaa9eb0b9c56469d51b7a10207d57bc21f7c8612b8ad593d8d3`.
Real guest390/1366 layouts show all three steps and the unpublished boundary
without horizontal overflow. Logs: `docs/private/b18-collection-{ci,
preview-release,production-release,live-check}.log`.

## Assistant, notification overlays and payment guidance — November 1 release

Future overlay presentation retains the actual existing components, a sticky
close/settings area, wrapping long responses,44px controls and a single popup
scroll region. Both original palettes and Classic presentation are unchanged.
There is no new speech provider, listening behavior, wallet permission or fee.
Native artwork payment guidance links to the existing settlement/deposit Guide;
it distinguishes the paid auction price, withdrawable excess and non-guaranteed
market value. This is explanatory copy, not an economic amendment.

The real notification component exposed one related bug during browser testing:
preferences saved successfully but their success notice appeared only in the
hidden personal view. Pending/saved feedback now appears inside Settings too.
The unchanged API error remains visible in that same view.

Final local units:2,717 pass/35 explicit skips, including29 unrelated untracked
authority-policy checks; no failures. Build verifies11 routes/172 utilities.
Source and built assistant checks each pass342 assertions over20 language,
theme and viewport cases, including synthetic recognition errors and long
results. Built artwork checks pass394 assertions, including keyboard payment
guidance and dialog restoration. Source notification browser acceptance passes
10 layouts plus settings validation/save, read-on-open, current mock deletion
APIs, hidden groups, staff gates and close/focus behavior. No real private inbox,
microphone capture or transaction is used. Built notification acceptance also
passes all10 layouts and interaction cases with the actual production bundle.
Its isolated fixture needed a protected nested config loader and selectors that
exclude the deliberately hidden native select; no product workaround was added.

Released PR418 /cc574d85, exact candidate ecc17962. CI41265999428 passes
Linux3243/2 explicit skips, Windows2688/35 skips,49 contracts on each platform,
both builds and static checks. Preview7467618072 and production7467706320
are successful. Six apex routes serve the exact local stylesheet bytes,
SHA25639b90d05b45c77084d9df94b80b93d1c63ee5d1afe4b123290bce5d6e03df884.
Real guest checks at390/1366 verify payment-guide links, an actual assistant
help response, close behavior and the notification sign-in prompt without page
overflow. No real inbox, microphone or wallet action was used in that pass.
Evidence: `docs/private/b18-overlay-{ci,preview-release,production-release,live-check}.log`,
`b18-built-overlay-notifications-final.log` and the earlier source/built logs;
screenshots in `output/playwright/b18-{built-notification,overlay-live}*`.

The accepted composition is now adopted across shared navigation/cards, Home,
Gallery, Profile, artwork, Publish, collection drafts, Admin, Guide, assistant
and notifications (PR413–418). Both original palettes are retained. This closes
the page-adoption implementation, not native-device acceptance or all Phase B.
Keep tappable tabs and native browser navigation for this release. Whole-page
swipe interception is deferred until a real-device check can establish that it
does not conflict with Back, media controls, scrolling or text selection. No
unimplemented swipe control is presented to users.

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

1. **B35:** common-ancestor proof is merged in PR412 with130 isolated PostgreSQL
   checks passing. A new offline fixture reproduces missing direct NFT transfers
   in ownership/history/recovery (five controls pass, six desired checks fail).
   Repair the deployment-bound journal/projection before activation; do not add
   a listener alone. The existing worker remains on B30; no new host is implied.
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

Next data-integrity step: complete deployment-bound NFT transfer ingestion,
projection and bounded history/recovery, preserving writer/cache/lease fences.
Do not open a second source checkout or silently close B35 based on UI success.
