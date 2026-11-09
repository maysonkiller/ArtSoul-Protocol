# Phase B status — updated November 9, 2026

Phase A engineering readiness was accepted on October 24. Phase B engineering
and interface work is active; there is no claim of a completed public beta or
mainnet readiness. This note reconciles the recent chat histories with
`BACKLOG.md`, the dated audits and the stabilization checkpoint. Older handoff
snapshots are historical, not competing active versions of the product.

## Current interface

The accepted redesign has been applied across Home, Gallery, Profile, Artwork,
Publish, collection planning, Admin and Guide. Both original palettes remain.
Search, assistant and notifications remain separate header tools; profile and
protected Admin access remain reachable. Save, Donate, Report, social sharing,
playback, resale actions and provenance are retained. Collection planning is
still a local draft, not an on-chain launch flow.

The November 2 B18 slice reconciles PR441 with the accepted shared-card study;
its exact verification/release is recorded in
[the card audit](audits/B18_CARD_RECONCILIATION_2026-11-02.md).

The subsequent 178-second video follow-up preserves the showcase shell while
showing whole artwork, removes hover shaking, makes desktop cards smaller and
adds visible contextual guidance. See [the video follow-up audit](audits/B18_VIDEO_HELP_HERO_2026-11-02.md)
for scope, verification and interpretation of the revised desktop density.

The owner's next preview review superseded that banner arrangement: artwork
fills the banner with attribution over a darkened lower edge, and the shared
desktop card row is more compact. Menu load/retry feedback and viewport-aware
placement preserve the existing actions. See [the overlay follow-up](audits/B18_HOME_OVERLAY_2026-11-02.md).
PR444 is merged and deployed: production deployment `7482199645` succeeded,
and the normal domain serves the verified card v28, WebMCP v16 and matching
built stylesheets. Eight route shells returned HTTP 200; the actual homepage
and its enabled Donate/Report/Creation transaction menu were inspected. PR443's
earlier deployment-limit failure is historical. No paid upgrade or limit bypass
was used.

The next B18 slice removes the reproduced Home theme-switch layout jump,
keeps six selections available at every width, straightens the theme symbol
and groups connector identity separately from network/native balance.
The built interface passes 575 assertions across 13 viewport sizes and both
palettes. PR446 is merged and production deployment `7489083598` succeeded;
eight route shells and 14 shared assets match the build, and real public Home
data passes six mobile/desktop theme checks with zero measured layout shift.
Release evidence and limitations are recorded in
[the theme/account audit](audits/B18_THEME_ACCOUNT_2026-11-02.md).

## Remaining acceptance and operational work

The founder-requested NFT record slice adds contract/token identity and exact
last indexed ArtSoul sale details to the existing expandable artwork panel.
It reuses provenance without extra requests and distinguishes sale evidence
from ownership, asking price and floor. See [NFT record details](audits/B18_NFT_RECORD_DETAILS_2026-11-02.md)
for the local tests and release boundary. External Base wallet NFTs are a
separate requested read-only inventory; they are not active ArtSoul listings.
Its [bounded inventory implementation](audits/B18_EXTERNAL_BASE_INVENTORY_2026-11-02.md)
uses private pagination and a dedicated server credential. PR464 fixed the route;
signed production acceptance loaded two 12-item pages without changing the wallet
network or requesting a transaction. The project Alchemy team is Free with no
payment method; the old RPC account quota remains unverified. The next UX slice
places Wallet NFTs before Saved, adds uniform cards and a contained details dialog,
and shows a cached public ETH/USD reference separately from unknown purchase
prices. The founder selected account-plaque A, with the same-width dropdown
and separate name/address hover and copy feedback from B. The November 9
integration preserves the incoming multichain feature gate and corrects profile
canonicals reported by Search Console. See the [resume audit](audits/B18_RESUME_ACCOUNT_SEO_2026-11-09.md)
for checks and the release boundary, and the inventory audit for
provider limits, verification and release evidence.
PR470 is merged and released as `651db8a3`; production deployment
`dpl_GQGJJERyHNpSzyNjtiaC3qFeKTxM` is READY. Linux/Windows CI passed, eight
normal-domain route shells returned HTTP 200, and sixteen shared/build assets
matched. Both author canonicals reported by Google are now distinct in the
rendered page; HTTP-to-HTTPS remains an intentional redirect. Search recrawling
is not yet verified. This bounded release does not close the gates below.
The owner selected Google Password Manager for backup-key custody. Actual
independent encrypted-copy and key-recovery verification remain pending.

The next bounded B18 fix improves Classic controls over dark/light media and
opens contextual Guide links only after the target section is expanded.
It also removes a Saved/playback overlap in the compact desktop Home row.
See [the control and guide audit](audits/B18_CLASSIC_CONTROLS_GUIDE_LINKS_2026-11-02.md)
for the 53 focused checks, 450 built-browser assertions and release boundary.

| Gate | What remains | Boundary |
| --- | --- | --- |
| B18 device acceptance | Native iPhone review of the latest composition; real Phantom Disconnect → choose another wallet after the fix | Browser geometry and synthetic wallet events are covered, but do not establish extension/device behavior. Android testing was declined. |
| B11/B12 actual journeys | Current-page expired settlement/default/re-auction and the remaining signed assistant scenarios | Retain accepted receipts, voice acceptance and completed transactions. Never replay a completed operation merely to collect another test result. |
| B30/B35 operations | Representative usage/egress and reviewed activation of the newer worker on the existing server | Whole outer Saved/search responses and combined polling/cache/auxiliary/periodic-reorg paths pass isolated tests. Real provider/cache transport and representative capacity remain unproven. The Hetzner worker is still the B30 version. No new server is required or purchased; ownership API/NFT-writer activation remains a separate gate. |
| Recovery | An independently durable encrypted copy and restore evidence | All 159 objects were recovered and verified locally. Two copies on one computer do not meet independent durability. |
| Real beta | Cohort/operator/support coverage and complete real-user journeys under the final agreed testnet plan | The owner wants the meaningful public testnet after the forthcoming contracts. Rehearsal evidence stays useful, but is not a substitute for that later cohort. |

The owner has prohibited extra paid infrastructure/API usage. Do not remove the
Supabase spend cap or enable paid conversational voice. Existing browser voice
commands and the authenticated public product continue within their configured
limits. Dedicated official-release announcements remain off until the project's
publisher address is designated; an artwork contract is not silently substituted
for that publisher wallet.

November 2 operations: the explicitly free Nano-to-Micro upgrade increased
database RAM to 1 GB at the same displayed price, and the previously disabled
Spend Cap was enabled. Worker cursors/hashes survived the restart unchanged;
the worker recovered to 11 blocks behind with no errors and four populated
public API checks passed. This is containment and recovery evidence, not
long-term IO/egress acceptance. See [the Disk IO audit](audits/B30_DISK_IO_2026-11-02.md).

The 09:41–09:54 UTC read-only follow-up found Micro healthy, the worker synced
at eight-block lag and four populated public API responses. Displayed current
cycle egress was 0.055 GB, with the dashboard's normal reporting delay. Matching
database reset markers establish 1.965 GB of temporary files over 7h56m;
temporary bytes are not billed egress. Historical catalog/statistics queries
lead the retained statement counters, but they do not explain the new growth.
Per-file logging was disabled, so attribution remains open. No further database,
worker or billing setting was changed. A provider trace or a reviewed bounded
logging plan is the next diagnostic step, not an assumed application rewrite.

The next B35 acceptance slice exercises actual confirmation polling, catch-up
and coordinated publication against disposable local PostgreSQL. A failed cache
purge recovers without replaying committed events, and an old delayed refill
cannot repopulate stale data. It also verifies the existing publication interval
and counts bounded work. See [combined acceptance](audits/B35_COMBINED_POLL_CACHE_ACCEPTANCE_2026-11-02.md)
for measured scope and exclusions; this does not establish production capacity.

The follow-up also runs actual resale/search refresh with a due periodic reorg,
cache retry, bounded NFT coverage rebuild and a delayed orphan metadata response.
That response cannot overwrite a replacement registration; notification quarantine
preserves identity without showing orphan messages. See [auxiliary/reorg acceptance](audits/B35_AUXILIARY_REORG_ACCEPTANCE_2026-11-02.md).
The read-only 11:03 UTC worker check remains healthy; this test-only slice does
not activate the newer worker or establish production resource usage.

The actual November 1 archive now passes the ordered five-migration rehearsal:
111 tables / 286,532 rows preserved, full transaction rollback, explicit Data
API privilege checks and replay preserving both pending and acknowledged
recovery tokens. The network-isolated container was stopped. The exact runtime
staging bundle is prepared. A subsequent full committed-schema archive restore
also passes: 113 tables / 286,536 rows, 22 sequences, normalized complete schema,
effective privileges and migration replay. Fresh-token barriers close both
pending and previously acknowledged readable coverage without losing inbox
state. These barrier checks are local rolled-back scenarios, not real
cache/provider recovery.
Production activation, independent encrypted durability/key custody and actual
recovery cutover remain open. See [archive migration evidence](audits/B35_ARCHIVE_MIGRATION_REHEARSAL_2026-11-02.md).

The 14:00 UTC read-only server comparison also passes: 50 installed package
metadata records match the candidate dependency closure, with only documented
optional/platform absences. The stable running worker shares the Node 22 probe's
executable identity. This does not verify package/native content integrity,
module loading or worker configuration and does not activate the newer worker.
See [runtime metadata evidence](audits/B35_RUNTIME_METADATA_2026-11-02.md).

The 15:19 UTC content follow-up matches all 3,948 installed files in the 50-package
closure to integrity-verified tarballs, with one explicitly reviewed declared-bin
execute-bit difference. Isolated native and JavaScript-fallback runs pass 106
checks and import all 27 candidate modules without network access. The container
and live Node patch versions differ, so exact live equivalence is not claimed.
At 15:35 UTC the startup-context probe also confirmed the NFT writer, its new pins
and Redis URL are absent from the initial worker environment. Configuration and
transport qualification remain necessary; nothing was activated or restarted.
See [runtime content and loading evidence](audits/B35_RUNTIME_CONTENT_2026-11-02.md).

## Subsequent architecture work

The next contract phase must consolidate the collection launch, auction,
marketplace, refunds, upgrade/module boundaries, deployment binding and Genesis
requirements before a new test deployment. Cross-network payment routing is
future design work, not an enabled product capability. No new chain support or
economics are introduced by the redesign.

The [C1 decision/invariant annex](architecture/C1_DECISION_INVARIANTS_2026-11-02.md)
now records six concrete next-phase reviews: deployment identity and mint
authority, funded-auction pause/deadline behavior, exact liability/rounding
accounting, resale authorization lifetime and automatic execution with separately
accounted optional gas reserves/payment funding, and compromised-wallet transaction
authorization/recovery. Customer website MFA and protected contract accounts are
separate proposals; no customer enrollment or custody change is activated.
Source facts and unapproved policy
are separated; no Solidity or existing deployment was changed. Architecture
sign-off, replacement storage layout and independent security review remain open.

Three C1 local contract cases now reproduce funded pause expiry, old-settlement
mint-authority denial and artwork-ID collision between two Core versions sharing
one NFT contract. Failed payments preserve balances/state, and authority restoration
is verified as a positive control before expiry. All 52 current contract tests pass.
See [the characterization](audits/C1_PAUSE_AUTHORITY_CHARACTERIZATION_2026-11-02.md);
these are confirmed prototype hazards to resolve in the replacement design, not
newly approved behavior or repairs to existing deployed contracts.

The [C1 source-storage baseline](audits/C1_STORAGE_BASELINE_2026-11-02.md) also
captures six current contract layouts and their immutable bindings. Repeated
compiler output agrees and six refusal cases pass. This provides comparison
evidence, not replacement layouts, deployed-state migration or proxy approval.

The D6 follow-up checks exact settlement amounts, unauthorized/repeated settlement
and unauthorized/repeated credit withdrawal on the local chain. The full contract
suite now passes 54 tests. Website authentication is explicitly separate from
on-chain spending authority: ordinary users do not gain stolen-key protection
from existing staff passkey/TOTP sessions. Customer factors, protected accounts,
recovery and their upgrade bypass boundaries remain design decisions in C1.

A further D1 test now exercises owner-authorized minting without any registered
artwork or successful settlement. Revocation stops new mints but does not remove
the issued NFT. The pending legitimate auction's escrow and credits stay intact,
and it settles successfully after the genuine Core regains authority. The full
suite passes 55 local contract tests. This records a privileged mint-authority
hazard for the replacement design; no deployed configuration or Solidity changed.

Actual Snapshot A remains at the end of the final public testnet, announced in
advance and independently stored/verified before any destructive reset. Export
tooling readiness is separate from capturing that final snapshot. Mainnet,
legal, external audit and launch operations retain their own acceptance gates.
