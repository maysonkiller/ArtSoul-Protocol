# Post-Phase-A product direction

Reviewed: October 24, 2026. Source revision: `46b385fcfdc231c17b70bcb86fffc88e37dfe45e`.

Status: **DRAFTED decision brief**, not an implementation, deployment, approved
spending plan or replacement canon. The founder requests the design direction
below; detailed behaviors and architecture choices remain proposals where marked.
Phase A remains accepted. This brief maps new work into B/C rather than reopening A.

## 1. What the product should do for people

Proposed positioning: **ArtSoul helps independent digital artists present their
work, find their first collectors and run understandable art auctions, with an
observable purchase and ownership history.**

The first audience to validate is artists with a small existing audience who
need a dependable first-sale process, and collectors who want to discover those
artists and understand what they are buying. This is a hypothesis, not proven
product-market fit. Public testnet transaction counts are engineering evidence,
not paying-customer traction.

| Person | Job to be done | Useful ArtSoul behavior | Evidence still needed |
| --- | --- | --- | --- |
| Artist | Present a coherent body of work and complete a first sale | Shareable profile, selected works, auction status, clear payout/history | External artists publish and return without founder assistance |
| Collector | Find work worth following and complete a purchase confidently | Search, Saved, clear timing/payment obligations and provenance | Independent collectors return, bid, settle and collect again |
| Curator/community | Introduce a themed set of artists to an audience | Shareable selections and later approved collection tools | A curator brings collectors who actually participate |

Auction-first discovery, settlement before mint, creator support and readable
provenance form a coherent experience. None is alone an exclusive competitive
advantage. Defensibility would have to come from recurring artist/collector
relationships, trusted curation and a demonstrably better completion experience.
AI guidance and a different visual theme are supporting features, not proof of a moat.

## 2. Evidence and what is already reusable

| Claim | Evidence at the source revision | Disposition |
| --- | --- | --- |
| Phase A engineering acceptance is complete | `docs/PHASE_A_CLOSE_OUT.md`; `docs/testnet/CONTROLLED_BETA_ENTRY.md` | CONFIRMED CURRENT; invitations still require a staffed beta window |
| Existing profile has created/auction/sold/collected views and private email connection | `src/entries/profile.jsx:35`, `:1612`, `:1781` | CONFIRMED CURRENT; redesign these paths instead of replacing authentication |
| Notifications already exist | `src/features/moderation/notification-inbox.jsx:47` | CONFIRMED CURRENT for moderation; auction reminders are new work |
| Watching is a discovery signal, not a reversible personal bookmark | `src/api/routes/discovery/signal.js:11`; `src/features/discovery/discovery-service.js:251` | CONFIRMED CURRENT; a separate Saved list avoids silently changing ranking |
| Gallery already searches artwork fields in its loaded corpus | `src/entries/gallery.jsx:283` | CONFIRMED CURRENT; this does not establish a complete global people/collection search service |
| The prototype contains a profile constructor and horizontal page transitions | Founder-supplied `artsoul_curved_profile_prototype_v3.html`, lines 225-240 and 289-356 | CONFIRMED SOURCE CONTENT; UI inspiration only |
| New chain entries do not mean deployed support | `src/config/collection-networks.js:4`; `src/features/collections/launch-config.js` | CONFIRMED CURRENT; write capabilities remain explicitly disabled |

Prototype SHA-256:
`4440206a32acf3e67480038c5bab3c04a7ca5cacef6f18d225bb1ae0a42ca21e`.
The original file was not modified. Its document title still says v2 while the
filename and later CSS describe v3. The review used its HTML/CSS/JS source.
Browser policy rejected the local `file:` preview; no rendered prototype or
responsive-browser acceptance is claimed, and no alternate rendering route was used.

## 3. Prototype: retain the idea, replace the demo shortcuts

Retain: a coherent profile header, compact notification entry, rounded Future
controls, obvious active tabs, curated artwork sections, cover image and a
separate edit experience with preview/save/cancel.

The current file is a visual demo:

- Save Profile and Cancel show toast messages rather than performing durable
  profile save/restore (line 333). Layout data uses browser-local keys, not a
  wallet-bound server profile (lines 273, 325-331).
- Notification examples, balances and artwork lists are fixtures. Art-tab clicks
  only replace text (line 300). Social buttons do not implement OAuth.
- Admin Menu is unconditionally present (line 213). This cannot replace the
  current server-authorized roles, staff-directory rules and factor checks.
- Blocks use absolute coordinates, fixed canvas heights and mobile `!important`
  overrides (lines 39-40, 65). The desktop editor's arrangement cannot be assumed
  to survive mobile layout, longer text or zoom.
- Page changes are transforms, not URL/history navigation (line 289). Global
  arrow/wheel/swipe listeners need conflict handling for forms, media and native
  browser gestures. Back, deep links and restored scroll positions must survive.
- The Classic switch changes effect controls, not the hardcoded neon palette
  (lines 9, 306, 318). No reduced-motion media rule is present.
- The editor stores raw styles and several collection fragments as HTML. Do not
  adopt this as a public profile schema. Use validated values and ordinary text.
- The self-reported X field duplicates an old design the founder already removed.
  Preserve the current verified-provider boundary and allow an ordinary website
  link without presenting it as verified ownership.

The notification example "Claim available / ready to mint" also conflicts with
the actual primary lifecycle if it implies a separate free claim. Before payment
use "You won — complete payment" with the deadline and real action; after receipt
use "Artwork received". No separate claim mechanic is introduced.

## 4. Proposed profile and navigation specification

### Public profile versus personal controls

Public profile: cover, avatar, name, short biography, verified public social
links, website and selected artworks. Email address, notification inbox, sign-in
settings and private Saved items are never public profile modules.

Recommended visible tabs: **Artworks / Auctions / Collected / Activity**. On your
own profile add **Saved**. Preserve the existing Sales dataset as a filter within
Activity; do not lose sales or mislabel historical purchases as current ownership.
Collected means currently owned NFTs. Artworks can include unminted registered
work and must show its actual state. Creator, First Collector and current Owner
remain distinct wherever provenance requires them.

Use **Edit profile** for name, biography, avatar, cover and public links, with
**Connected accounts** inside it for Email / X / Discord. Reuse the working
verification components with equal row geometry. Linked accounts show the
provider identity; unlinked rows offer a clear connection action. A website link
does not have an OAuth state. Reddit is deferred until demand and provider support
justify another integration.

Save/Cancel apply to editable profile fields. OAuth connection, email verification
and disconnect are explicit account actions: explain that they take effect
immediately instead of suggesting Cancel can silently undo an OAuth ceremony.

### Personalization recommendation

Start with named responsive templates, cover selection, pinned work, curated
sections and section reordering. Store a versioned allowlisted layout, not HTML,
CSS strings or absolute pixel coordinates. Provide Preview, Save, Cancel and
Restore default. Stale saves and account switches must not write another wallet's
layout. Images follow the existing bounded media/storage path.

The visitor's Classic/Future preference controls the rendered theme. The owner
curates content and layout, not the visitor's theme, official badge or NFT aura.
Do not let custom imagery or captions masquerade as platform verification.
Keyboard Move up/down controls must accompany drag-and-drop. Mobile uses an
ordered single-column layout with no overlapping controls.

### Header, buttons and motion

Founder-requested direction: a typographic **ArtSoul** wordmark in both themes,
Future account/button treatment inspired by the prototype, and truthful SOON
labels in both themes. Use a shared text/vector component with reserved geometry
and accessible name; reuse existing typography before adding fonts/dependencies.
The mark can be calm in Classic and use the existing Future accent variables.

Reuse existing wallet states and real account identity inside the new button.
Use a small button family (primary, secondary, icon, destructive), with loading,
disabled, hover and focus states; equal styling does not mean every action has
equal emphasis. Apply it through shared components across home, gallery, profile,
artwork and dialogs, with changes released in bounded slices.

Preserve real routes/history. Add short directional transitions and swipe only
where they do not consume form/media interactions or the browser's edge-back
gesture. Avoid transforming the entire page/viewport: dialogs and fixed headers
must not inherit the prototype's curved-screen clipping or scaling. Reduced
motion gets an immediate state change. SOON opens an honest information state or
is explicitly unavailable; it never simulates a deployable collection or deposit.

## 5. Saved and global search

### Saved

Recommendation: a private, reversible bookmark independent of Like, Would Buy,
Watching, Trust and ranking. It has no fee or contract transaction.

- One saved artwork follows its current auction and eventual NFT. Saving an
  auction card must not create three copies of the same artwork in Saved.
- Use deployment-scoped identity (chain + contract/registry + artwork ID; map
  minted token identity explicitly). A bare artwork ID or chain ID alone is
  insufficient across contract redeployments. Round-specific alerts retain their
  auction ID separately.
- A dedicated bookmark control belongs in the shared card overlay and artwork
  header. Preserve the existing overflow menu: Donate, Report, creation explorer.
  Reserve non-overlapping positions for timer and official mark.
- Guest saves may remain local to that browser with an explicit local-only label.
  Signed-in saves synchronize to the correct wallet through authenticated APIs.
  Any guest merge is explicit and deduplicated. Switching wallets clears private
  state immediately. Use idempotent add/remove, rollback on error, RLS and explicit
  grants in the migration; never optimistic success after a failed server write.
- Saving does not subscribe the person to email. Notifications have separate
  preferences. Hidden/removed work remains subject to current moderation rules.

### Search

One header entry, keyboard shortcut and mobile button open the same bounded
search surface. Categories: **All / Artworks / Auctions / Artists**, with
**Collections** only when real collection search is available. An NFT is a state
of a work, not a confusing duplicate search category.

Show recent searches and recent views locally with Clear, then grouped matches
with thumbnail, title, creator, actual lifecycle, current relevant price and
deadline. Query supports names, artist handles, addresses and explicit artwork
identifiers. Add optional chips for Live, Ending soon, media and price. Prefer
one immediately understandable search over a new chat/AI search dependency.

Extend current search helpers, but use bounded indexed server queries for complete
results at scale. The current loaded gallery corpus is not a global search index.
Cancellation/request fencing, pagination, keyboard navigation, escape/focus
return, long names, empty/error/loading and wallet-free browsing are requirements.
Only public fields are searchable; exclude email, staff data and hidden content.
Do not add a chain selector while only one product network is active.

## 6. Notifications

Reuse the private inbox and separate personal events from staff complaints.
Add event-backed bid, outbid, ending, settlement-due and completion categories
incrementally; each category needs a real producer, recipient rule and current
action target. Read/unread, deduplication, pagination and preference state must
persist. Bind messages to deployment/artwork/auction identifiers, not titles.

On-chain messages follow canonical indexed/confirmed events. Scheduled reminders
must re-read actual deadlines after extensions; reorgs and old rounds cannot
leave misleading action buttons. Reuse the existing outbox/worker patterns where
they fit. Verified email enables opted-in delivery; a local bookmark alone does
not. No notification or badge may promise a mint before successful settlement.

## 7. OpenSea reference: useful patterns and scope limits

| Pattern | Verified reference | ArtSoul adaptation |
| --- | --- | --- |
| Curated profile galleries and reorderable selections | [OpenSea profile galleries](https://support.opensea.io/en/articles/8866962-how-can-i-feature-nfts-using-my-profile-s-galleries-tab), checked October 24 | Use a constrained gallery builder; distinguish authored work from currently owned NFTs |
| Notification categories and separate delivery channels | [OpenSea notification settings](https://support.opensea.io/en/articles/8866965-how-do-i-manage-my-notifications), checked October 24 | One private inbox; explicit email preferences and verification |
| Quick search and keyboard navigation | [OpenSea shortcuts](https://support.opensea.io/en/articles/10549947-how-do-i-use-keyboard-shortcuts-on-opensea), checked October 24; founder screenshot | Accessible grouped search, recent views, visible filters; do not copy assets/layout wholesale |
| Authenticity marks with a stated meaning | [OpenSea verification](https://support.opensea.io/en/articles/8867072-what-is-a-verified-account-or-badged-collection), checked October 24 | Keep ArtSoul's approved provenance review without a sales threshold; no price or safety guarantee |

OpenSea currently also exposes token/perpetual trading and rewards. Those surfaces
are visible on [its homepage](https://opensea.io/), but do not solve the initial
ArtSoul art-sale problem and are not proposed scope. The screenshot is inspiration,
not evidence that every menu item is needed. OpenSea's current verification entry
criteria include collection volume; ArtSoul's separately approved origin mark
must not silently inherit those requirements.

## 8. Contracts: design for bounded change

Current source is a constructor-based Core, separate NFT and prototype ProjectNFT,
plus Donations. Core is not a proxy. Local Launch/Forge scaffolds already exist;
the builder is draft authoring, not proof of a deployed product. NFT source permits
owner replacement of Core, so immutable bytecode does not alone mean immutable
mint authority. Donations binds its Core at construction. See
`contracts/ArtSoulCore.sol`, `contracts/ArtSoulNFT.sol`, `contracts/ArtSoulDonations.sol`
and `contracts/launch/CollectionLaunch.sol`.

The founder requests future extensibility. Recommendation: stable identities,
versioned interfaces, explicit capabilities and locked terms for an existing sale.
Do not implement an unlimited admin ability to change a live auction, floor,
ownership or accrued credit. Exact upgrade topology is a C1 decision, not settled
by the phrase "make it upgradeable".

| Option | Benefit | Cost/risk | Proposed disposition |
| --- | --- | --- | --- |
| Versioned immutable deployments | Small upgrade trust surface; existing sales retain their rules | Coexistence, routing and carefully designed migration | Preferred starting comparison baseline |
| Proxy-upgradeable Core | Repairs can retain state/address | Upgrade-key risk, initializer/storage discipline, upgrade compatibility and user-exit policy | Evaluate only with explicit governance and invariant design |
| Stable ownership/settlement boundaries with versioned peripheral modules | Evolve collection, indexing and UI interfaces without rewriting everything | More interfaces to specify and test | Recommended design direction; exact contract split remains open |

[OpenZeppelin's upgrade guidance](https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable)
requires initializer and storage-compatibility discipline. Proxy selection is not
an assurance of safety. C1 must decide upgrade/rotation authority, delay and emergency
scope, metadata permanence, pause/deadline behavior, safe recipients and withdrawal
recovery before implementation. Do not invent timelock durations or signer thresholds.

Rework requirements already include canonical resale 92.5/5.5/1/1, 5.5% royalty,
pool routing, bounded deterministic finalization/refunds, dedicated Genesis and
approved collection lifecycles. Source prototype resale is 90/7.5/2.5 with 7.5%
royalty; this documented deviation requires new tested contracts, not a UI edit.
Existing deposit/increment/duration economics remain unchanged. Their suitability
for low-price art should be measured during beta; any change needs its own decision.

Separate 1/1 auctions, partner first-auction-then-buy-now collections and generic
phased Collection Launch. Decide exact-file uniqueness scope for editions and
direct-contract publication; the present website guard cannot enforce universal
copyright originality. [ERC-2981](https://eips.ethereum.org/EIPS/eip-2981) supplies
royalty information, not universal enforced payment. External marketplace
compatibility and royalty enforcement require an explicit tradeoff and tests.

### Future networks

Keep Base as the active product chain. Reuse existing chain-aware collection keys,
RPC/start-block/confirmation configuration and indexer boundaries. Each additional
EVM network needs code/deployment verification, wallet support, fee currency,
finality/reorg policy, indexer/API coverage, UI and receipt recovery tests, security
review and explicit activation. Non-EVM networks require separate implementations.
Bridge/cross-chain ownership and eligibility are separate projects, not config flags.
No network is enabled by this brief; the September 20 Collection Launch exception
does not authorize multichain 1/1 deployment.

## 9. Canon reconciliation queue

Replace the confusing mix of current decisions and historical proposals with a
compact current specification plus a linked, dated decision history. Preserve
old text and source commits; every substantive change gets old rule, new rule,
reason, affected code/tests, approval status and rollback implications.

| Current problem | Reconciliation needed |
| --- | --- |
| `docs/BACKLOG.md` C-26 still describes Phase-C-only donations and a 0.0005 message threshold | Mark that baseline superseded by approved no-threshold donation amendments and actual implementation; preserve final-generation binding/rehearsal work |
| `docs/RESOURCE_GATED_WORK.md` mixes old A8-disabled/15-minute assumptions with later supersession | Present the current paired-authority/24-hour session rule first; keep old entries historical |
| `CONTRACT_REWORK_PLAN.md:63` says UUPS as if selected while the document is a proposal | Separate proposed topology from approved requirements; record C1 decision before Solidity work |
| Same plan suggests a Genesis grant cadence and universal gasless loser refunds | Preserve undecided operational cadence and bounded executor batches plus withdrawable fallback; no invented guarantee |
| Root Base-only wording versus separate chain-aware Collection Launch amendment | State active deployment scope and future development exception together |
| Full Bible versus part 14 differs on when pool contests activate | Consolidate the undecided trigger, not an implied date or Genesis milestone |
| Historical inventories omit Donations and local Launch/Forge | Separate deployed prototype, local tested scaffolds and approved target |

Touched canon: §§5/6/11/16/17 for profiles, discovery, notifications and roadmap;
§§1-4/8/9/14 for future chain, lifecycle, contract and treasury decisions. This
brief changes no frozen rule. A full canon rewrite is not claimed complete.

## 10. Delivery order and evidence gates

These are planning windows after capacity is assigned, not launch promises.

| Slice | Typical planning window | Outcome and release gate |
| --- | --- | --- |
| 1. Source-of-truth reconciliation and retained TA-12 | Week 1 | Current rules clearly labelled; bounded desktop loading investigation before layering new UI over it |
| 2. Shared brand/header controls and Saved | Weeks 2-3 | One vertical slice at a time; save/remove persists across pages, reload and account switch; no ranking effect |
| 3. Global search and profile organization | Weeks 3-5 | Complete bounded results, real routes/Back, current ownership, usable keyboard/mobile layout, private data isolation |
| 4. Responsive profile curation and event notifications | Weeks 5-8 | Save/cancel/restore, event truth and optional email verified; external people complete assigned journeys |
| 5. Product evidence and contract decisions | Throughout beta, review at 8-12 weeks | Test the initial audience; close C1 decisions with threat model and costed scope |
| 6. Final contracts, independent review and fresh rehearsal | Subsequent funded C stage; tentative months 3-6 | Invariants, audit fixes, Safe custody, migration/Snapshot and complete fresh Base Sepolia lifecycle before any D launch decision |

Use existing B1-B4 for cohort/operations/defect handling, B-11/B-12 for remaining
live journeys, C1-C15 for final architecture and visual readiness, D for migration
and launch. Do not run a second competing phase system. Major UI changes need
cross-page and responsive acceptance; prior iPhone success is not evidence for a
new layout, and the prior Android waiver is not an Android pass.

For each UI slice check Classic/Future, desktop/iPhone, keyboard/zoom/reduced
motion, cold/warm load, long/missing data, wallet switch, OAuth return, error/retry,
dialog open/close, Back/deep link and WebMCP action consistency. Existing tests and
components should be extended rather than duplicating a second UI stack.

## 11. Team and funding model — assumptions, not hiring or spending approval

Minimum accountable capabilities: founder/product and artist recruitment; one
frontend/full-stack engineer; a Solidity/security lead for C; independent audit;
fractional product design, QA, community/moderation and legal help. One person can
cover compatible roles. AI assistance reduces some implementation effort but does
not replace accountable security review, user research or independent audit.

For a lean beta, start with the founder and one engineer plus fractional design,
QA and community support. Bring contract expertise in for C1 scope/review; do not
hire a large permanent team before evidence supports the cost.

Illustrative USD planning model, using assumed all-in contractor costs rather
than researched salary claims. Geography, employment taxes, current vendor quotes
and the founder's living needs are unknown. None of these figures is a quote,
committed budget or fundraising valuation.

| 90-day beta scope | Assumed calculation | USD |
| --- | --- | ---: |
| Full-stack engineering | 1 x 5,000/month x 3 | 15,000 |
| Product design | 0.25 x 6,000/month x 3 | 4,500 |
| QA | 0.25 x 4,000/month x 3 | 3,000 |
| Artist/community operations | 0.5 x 2,500/month x 3 | 3,750 |
| Founder operating allowance | 1,500/month x 3 | 4,500 |
| Infrastructure/tools | 500/month x 3 | 1,500 |
| Initial legal/IP advice allowance | Fixed assumption | 2,500 |
| Subtotal | | 34,750 |
| Unallocated contingency | 20% | 6,950 |
| Total planning envelope | | **41,700** |

This beta envelope excludes final-contract implementation and independent mainnet
audit. A founder-led cash-constrained version must reduce scope/time allocations;
it cannot obtain the same promised delivery by declaring unpaid work free.

Illustrative **alternative six-month combined beta/C-readiness envelope**, not
an extra amount to add automatically to the 90-day model:

| Capability / external cost | Assumption | USD |
| --- | --- | ---: |
| Full-stack engineering | 6,000/month x 6 | 36,000 |
| Solidity/security engineering | 8,000/month x 4 | 32,000 |
| Design | Scoped allowance | 8,000 |
| QA | Scoped allowance | 9,000 |
| Community operations | 1,500/month x 6 | 9,000 |
| Founder operating allowance | 1,500/month x 6 | 9,000 |
| Infrastructure/tools | 500/month x 6 | 3,000 |
| Legal/IP/launch advice | Scope-dependent allowance | 8,000 |
| Independent audit and remediation verification | Unquoted reserve; replace with written scopes/quotes | 30,000 |
| Subtotal | | 144,000 |
| Contingency | 20% | 28,800 |
| Total planning envelope | | **172,800** |

Audit, jurisdiction or a larger contract scope may exceed that reserve. The runway
ends at six months; a funded launch also needs continuing operations after it.
Before an actual raise target, build monthly cashflow and add an approved runway
for the period after launch. Company capital must not be confused with on-chain
ProtocolTreasury or the Ecosystem Pool.

### Revenue sanity check

Under approved target economics, gross protocol fees are `0.025 x primary volume
+ 0.01 x resale volume`. USD examples require a stated valuation time. At an
illustrative $100,000 primary volume, gross protocol fees are $2,500; at $100,000
resale volume, $1,000. The separate 1% ecosystem allocation is not team revenue.
Donations send 100% to the artist and add no protocol revenue. These target figures
do not describe the prototype's different resale split.

An illustrative $20,000 monthly cost would require $800,000 primary-only volume
or $2,000,000 resale-only volume just to match that amount in gross protocol fees,
before other costs and without assuming company access to treasury funds. This
is arithmetic sensitivity, not a forecast or an approved payroll funding route.
Therefore test willingness to return and buy before describing the platform as
self-financing. Promoted slots remain separately governed/unapproved mechanics
where unresolved; do not count prospective fees or donations as available runway.

## 12. Fundraising and validation work

Suggested first experiment: interview a small group of artists and collectors,
then run two deliberately curated beta windows. Planning recruitment targets
might be 10-15 external artists and 20-30 collectors; they are neither traction
nor acceptance thresholds. The founder owns invitations and contacts.

Record activation and return by role; publish-to-first-independent-bid conversion;
auction settlement/default rates; repeat collector participation; creator repeat
publication; completion time; failure/support burden; creator payout and fee
accounting; and delivery cost per successful journey. Separate owner/operator
wallets from external participants. Wallet counts are not person counts, self
trades are not demand, and testnet willingness is not proven willingness to pay
real money. Define beta success thresholds before looking at the results.

Prepare an evidence-linked investor packet:

1. One-page problem, audience, product and competitive difference hypothesis.
2. Short live demo of discovery -> save -> artist -> auction -> settlement/history.
3. Cohort evidence with dates, denominators and testnet labels; no manufactured traction.
4. Roadmap and funded use-of-proceeds tied to measurable milestones.
5. Technical state, documented prototype differences, security plan and audit scope.
6. Team responsibilities, availability and identified hiring gaps.
7. Monthly runway model, operating/legal dependencies and data-room index.

Research early-stage creator/consumer-onchain investors and art/curation angels
alongside ecosystem capital. Prioritize fit and warm introductions, track outcome
and reason for rejection, and revise from evidence. No outreach, applications,
financial terms or investment instrument are authorized by this brief.

The official [Base Ecosystem Fund application](https://www.base.org/ecosystem-fund/apply)
was accessible when checked October 24. Current [Base investment focus](https://www.base.org/blog/request-for-builders-1)
emphasizes onchain finance; an art-market case needs a credible fit rather than
assuming Base deployment alone makes it fundable. [Batches 004](https://www.base.org/batches)
shows applications closed September 10 and describes an investment offer for
selected teams, not a guaranteed grant. Do not present it as an open October
cohort or book uncommitted funding as cash.

## 13. Decisions left explicit and next action

Interpretations recorded: SOON means a capability/status label; "main button"
means the header account control; favorites are private and rank-neutral by
recommendation; profile customization is content curation rather than arbitrary
page code; Sales remains available inside Activity; new-network readiness is
an interface-design objective, not deployment authorization. These interpretations
can be revised without silently changing economics.

Still requires a concrete decision before architecture implementation: upgrade
topology/authority, new network targets, collection terms, duplicate-file policy
for editions, metadata permanence and migration constraints. Budget and raise
size require actual capacity, quotes and founder approval. No need to decide all
of these to improve the profile or search.

Exactly next implementation task: finish the retained TA-12 display investigation,
then take the first bounded B-13 Saved slice against the shared card and artwork
surfaces. Keep the current accepted publication, OAuth, recovery and moderation
paths as the regression baseline. The remainder of this document is a sequenced
brief, not an instruction to rewrite the whole application at once.

## 14. Remaining effort and delivery scenarios

October 24 follow-up: the founder asks to continue Phase B and estimate the
remaining work at the present cadence with GPT-6 Astra at the preferred high
reasoning setting. This is a capacity estimate, not a release date or a model
benchmark. No model or account setting was changed by this review.

Evidence: the first-parent Git history has 51 commits/merges during October 1-24,
on 12 distinct commit dates. Some are documentation, corrections or acceptance
records, not new features. Commit dates are not tracked working hours. The
September 20-October 24 takeover window is not all of Phase A: earlier accepted
work reaches back into July. Do not estimate remaining hours by PR count or call
the entire completed Phase A a five-week project.

At this revision the detailed backlog has 18 B rows (2 done, 7 in progress,
9 planned), 27 C rows (17 planned, 10 blocked-on-founder) and 6 planned D rows.
Canonical B1-B5, C0-C15 and D1-D6 are grouped acceptance gates, not extra tasks to
add to those totals. Existing runbooks and local scaffolds reduce implementation
work, but do not close their real-operation acceptance gates.

The following active-work estimates include implementation, tests, review,
integration and likely repair, with one principal implementation stream and
bounded specialist assistance. An active day means a substantive work-and-review
session, not a commit or a promise of autonomous round-the-clock operation.

| Phase | Remaining scope | Active work allowance | Rough effort index, completed A = 100 |
| --- | --- | --- | --- |
| B | Deferred display follow-up, remaining native journeys, controlled cohort operations, Saved/search/profile/notifications and feedback | 20-35 active days | 60-100 |
| C | Architecture decisions, final Core/NFT/Genesis/pool/collections, indexer/UI integration, invariants, audit fixes and fresh rehearsal | 40-70 active days | 150-250 |
| D | Snapshot/migration/deployment verification, custody handover, launch smoke checks and initial controlled rollout | 7-14 active days | 20-40 |

The effort index is a low-confidence complexity judgement, not measured labor.
C is the largest remaining engineering and security stage; D has less code but
more consequential irreversible operations. D6 continuing growth has no finite
completion date and is excluded from the initial-launch estimate.

Calendar scenarios, assuming decisions, access and adequate model usage are
available and scope is held stable:

- **Present intermittent cadence:** approximately 3-4 active days per week;
  B about 6-10 weeks, C about 12-20 weeks, D about 2-4 weeks: roughly **20-34 weeks
  (5-8 months)** to an initial staged launch decision/rollout.
- **Near-daily cadence:** approximately 5-6 active days per week; B about 4-7
  weeks, C about 8-14 weeks, D about 2-3 weeks: roughly **14-24 weeks
  (3.5-6 months)** after rounding for integration and observation.

These are planning ranges, not best/worst-case guarantees. Recruitment, funding,
counsel, auditor procurement/availability and substantive audit findings can add
unbounded waiting. B's external feedback may take 8-12 elapsed weeks even where
its engineering completes earlier. Snapshot notice needs at least two weeks;
auctions/settlement and D's approved observation window take real elapsed time.
Prepare external inputs concurrently, without claiming the next phase's exit
before its gates pass. Broad new utilities, non-Base launches and repeated
economic/design changes are excluded and require re-estimation. Reforecast
after two weeks of actual B delivery using accepted slices and rework, not lines
of code or number of agents.

Official [GPT-6 Astra documentation](https://developers.openai.com/api/docs/models/gpt-6-astra)
describes complex reasoning/coding capabilities, not a delivery-time multiplier
for ArtSoul. The public API lists effort settings through `max`; this does not
establish the meaning or speed of the owner's Codex `ultra` setting. Do not
substitute another model or promise that a stronger setting removes independent
audit, human/device approval or actual chain-time requirements.

## 15. Collection module: finish one usable path, then extend it

Current assets worth preserving:

- `src/entries/collection-builder.jsx`: Collection -> Phases -> Review, browser
  draft save/load, JSON import/export, replacement undo, dirty-leave protection
  and phase editing/order.
- `src/features/collections/launch-config.js`: bounded parsing, exact amounts,
  timezones/schedules, allocations, price/eligibility descriptions and explicit
  compatibility findings.
- `contracts/launch/CollectionLaunch.sol` and `CollectionForge.sol`: isolated
  local contracts and focused tests for phased allocation, funded auctions,
  credits, configuration locking, unused supply and a separate craft output.

This is meaningful draft/local infrastructure, not an end-to-end launch product.
Publishing is disabled; listed networks have writes disabled. Verified deployment
binding, reviewed constructor/owner/receiver policy, durable media and allowlist
manifests, indexed projections and a real testnet rehearsal remain missing gates.
Neither an AI-review endpoint nor a selectable draft option proves support.

Proposed work order within the existing collection/C1 scope:

1. Choose an actually supported template and use plain language. Keep advanced
   settings collapsed; never present unsupported eligibility or royalty choices
   as deployable.
2. Complete media/metadata/rights entry, preview, resumable drafts and clear
   browser-only versus account-synced saving. Account sync is new work.
3. Show a visual schedule/allocation review with local time and explicit UTC,
   overlaps, unused allocation and the collector's preview.
4. Complete one supported flow from reviewed deployment through wallet
   confirmation/recovery, indexer, public collection and creator dashboard.
5. Extend utilities through versioned, capability-aware modules after separate
   approval. Label each as contract-enforced, externally integrated or a creator
   commitment; explain what a holder can do and who must deliver it.

Possible later utility proposals: holder access to artist material/community;
creator extras with explicit redemption terms; curated exhibitions; and the
existing optional Forge path after its own terms/rehearsal. Transfer, revocation,
single-use redemption, privacy and provider obligations must be decided before
implementation. Ownership checks alone cannot guarantee physical delivery or
third-party service. No yield, token, points or new Genesis entitlement is implied.
Sold rights must not be arbitrarily rewritten by a new module.

Generic Collection Launch, canonical Partner Collections (first auction then
flat buy-now) and ordinary 1/1 auctions stay distinct. Collection improvements
are included in C's estimate at a bounded first-release scope; an unlimited
utility/app platform is not. No Solidity, economics or network activation is
changed by this planning update.
