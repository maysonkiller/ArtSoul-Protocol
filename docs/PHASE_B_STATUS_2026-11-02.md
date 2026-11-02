# Phase B status — November 2, 2026

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

## Remaining acceptance and operational work

| Gate | What remains | Boundary |
| --- | --- | --- |
| B18 device acceptance | Native iPhone review of the latest composition; real Phantom Disconnect → choose another wallet after the fix | Browser geometry and synthetic wallet events are covered, but do not establish extension/device behavior. Android testing was declined. |
| B11/B12 actual journeys | Current-page expired settlement/default/re-auction and the remaining signed assistant scenarios | Retain accepted receipts, voice acceptance and completed transactions. Never replay a completed operation merely to collect another test result. |
| B30/B35 operations | Representative usage/egress, full combined workload including auxiliary refresh/reorg work, and review activation of the newer worker on the existing server | Whole outer Saved/search responses and a bounded combined polling/cache recovery scenario pass isolated tests. The latter excludes resale/search enrichment, periodic reorg work and real provider/cache transport. The Hetzner worker is still the B30 version. No new server is required or purchased; ownership API/NFT-writer activation remains a separate gate. |
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

The next B35 acceptance slice exercises actual confirmation polling, catch-up
and coordinated publication against disposable local PostgreSQL. A failed cache
purge recovers without replaying committed events, and an old delayed refill
cannot repopulate stale data. It also verifies the existing publication interval
and counts bounded work. See [combined acceptance](audits/B35_COMBINED_POLL_CACHE_ACCEPTANCE_2026-11-02.md)
for measured scope and exclusions; this does not establish production capacity.

## Subsequent architecture work

The next contract phase must consolidate the collection launch, auction,
marketplace, refunds, upgrade/module boundaries, deployment binding and Genesis
requirements before a new test deployment. Cross-network payment routing is
future design work, not an enabled product capability. No new chain support or
economics are introduced by the redesign.

Actual Snapshot A remains at the end of the final public testnet, announced in
advance and independently stored/verified before any destructive reset. Export
tooling readiness is separate from capturing that final snapshot. Mainnet,
legal, external audit and launch operations retain their own acceptance gates.
