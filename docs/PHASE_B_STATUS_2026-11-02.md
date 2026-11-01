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

## Remaining acceptance and operational work

| Gate | What remains | Boundary |
| --- | --- | --- |
| B18 device acceptance | Native iPhone review of the latest composition; real Phantom Disconnect → choose another wallet after the fix | Browser geometry and synthetic wallet events are covered, but do not establish extension/device behavior. Android testing was declined. |
| B11/B12 actual journeys | Current-page expired settlement/default/re-auction and the remaining signed assistant scenarios | Retain accepted receipts, voice acceptance and completed transactions. Never replay a completed operation merely to collect another test result. |
| B30/B35 operations | Verify usage/egress over a representative interval, complete outer Saved/search response acceptance, coordinated Core/NFT polling/cache checks, and review activation of the newer worker on the existing server | The existing Hetzner worker is still the B30 version. No new server is required or purchased. Ownership API/NFT-writer activation is a separate deployment gate. |
| Recovery | An independently durable encrypted copy and restore evidence | All 159 objects were recovered and verified locally. Two copies on one computer do not meet independent durability. |
| Real beta | Cohort/operator/support coverage and complete real-user journeys under the final agreed testnet plan | The owner wants the meaningful public testnet after the forthcoming contracts. Rehearsal evidence stays useful, but is not a substitute for that later cohort. |

The owner has prohibited extra paid infrastructure/API usage. Do not remove the
Supabase spend cap or enable paid conversational voice. Existing browser voice
commands and the authenticated public product continue within their configured
limits. Dedicated official-release announcements remain off until the project's
publisher address is designated; an artwork contract is not silently substituted
for that publisher wallet.

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
