# Platform milestones — proposed design

Status: **proposed; policy and activation pending**. Reviewed against repository
`55cca6873a25b2a34df4a6ce4533fc7106346117` on 2026-10-26.
This note adds no broadcasts, SQL, runtime capability or delivery subscription.
Do not build a helper/API implementation until the policy below is chosen.

## Meaning and scope

| Candidate milestone | Required evidence and wording |
| --- | --- |
| First publication | Confirmed `ArtworkRegistered` in the selected creator/deployment scope. This is a published artwork, not a minted NFT. A new creator address is not proof of a unique human or verified artist. |
| First settled NFT | Confirmed `SettlementCompleted`, identifying the minted token. Registration, a bid and an auction win do not qualify. |
| New completed-sale record | Exact `SettlementCompleted.finalPrice` for primary sales or `ResaleCompleted.price` for resales. Choose separate records or explicitly approve a combined scope; never use asking prices, bids, deposits or AI estimates. |
| Native-asset volume threshold | An approved scope and exact integer sum of completed sales in one asset. **1 ETH was an example, not a selected threshold.** Thresholds, cadence and audience remain open. |
| Collection milestone | Verified collection identity and indexed sale events, with an explicit distinction between highest sale, primary proceeds and combined trading volume. None means a guaranteed resale floor. |

Choose whether each first/record is personal, creator-wide or platform-wide; do not
silently switch those meanings. Scope includes chain and deployed Core/collection.
Label Base Sepolia notices as **Testnet**. Testnet ETH is not dollar revenue.
USD milestones require a separately reviewed valuation source, timestamp and
methodology; this proposal introduces no oracle or conversion rule.

Official project releases remain separate. The founder deferred their dedicated
creator address until new contracts; the shared Core emits events for every artist
and is not an official creator. See [the recorded decision](../audits/B21_COMMANDS_AND_HEADER_2026-10-26.md#interpretation-record).

## Delivery and safety

- Propose one optional **Platform milestones** category with a clear off switch,
  independent of personal transactions, reminders and official releases. Initial
  preference/default is a policy decision. In-app only; no email or push enrollment.
- Prefer rare one-time achievements and a finite approved threshold set. Do not
  broadcast every publication or one-wei record increase. Define coalescing/rate
  limits before activation. Recorded volume is not proof of independent demand;
  neither self-funded activity nor wallet counts establish market quality.
- Capture a confirmed activation baseline with block/hash and policy version.
  Establish existing counts/record maxima without emitting historical unread
  notices. Historical milestones, if offered, retain their original dates and
  appear as history. Re-enabling a category must not cause an unread flood.
- Prefer one shared canonical milestone record plus wallet-bound preferences,
  reads and dismissals, rather than a recipient fan-out. Never put a fake `all`
  recipient into the existing private notification path.
- Use deterministic achievement/source identities, transactional uniqueness and
  serialized threshold crossings. Duplicate delivery, retry, restart and concurrent
  processing must not create duplicate notices. Reorgs invalidate orphaned notices
  and recompute records; replay must preserve the approved read/dismissal behavior.
  Reading or dismissing a notice never deletes its protocol evidence.
- Apply opt-out/dismissal before pagination and unread counting. Preserve wallet
  isolation, stale-response guards and preference conflict handling. Global notices
  contain only public facts; moderation-hidden content must not be promoted through
  thumbnails, titles or active links. Define whether hidden sales qualify for public
  records/counts; do not silently alter the existing metric definition.

## Existing foundations and missing collection support

Reuse the transaction boundary and idempotency pattern in
[`_writeToOutbox` / lifecycle generation](../../src/indexer/sync-engine.js#L993),
the [source-proven notification projection](../../sql/migrations/auction_notification_lifecycle.sql#L11),
and [metric event/reorg bookkeeping](../../src/indexer/migrations/015_public_metrics_projection.sql#L19).
Current [metric generation](../../src/indexer/sync-engine.js#L1142) counts unique
creator addresses and completed primary/resale volume. `auctions_completed` also
includes no-bid endings and defaults: it is not a sale or NFT-mint count. Existing
metrics are chain-scoped; deployment-specific milestones must additionally prove
the Core/collection source. Do not scan the full corpus from each browser request.

The [private API](../../src/api/routes/notifications.js),
[client state](../../src/features/moderation/auction-notifications-state.js),
[settings/inbox](../../src/features/moderation/notification-inbox.jsx), and
[summary/dismissal projection](../../sql/migrations/notification_inbox_removal.sql)
provide reusable behavior. Their exact type/preference validation requires a
versioned extension; a new checkbox or alias to `lifecycle` is insufficient.

Generic [Collection Launch](../../contracts/launch/CollectionLaunch.sol) remains
local infrastructure with writes disabled. It needs verified deployment bindings,
collection event indexing and accepted public flows before milestone activation.
For uniform auctions, proceeds arise at `AuctionFinalized`; later auction claims
also emit `CollectionMinted`. Never count both as separate sales. Fixed-price mints
use quantity times unit price; free mints add no volume. Select one accounting
definition and prove it before publishing a collection threshold.

## Acceptance gates before activation

1. Approve milestone names, personal/platform scope, qualifying events, primary vs
   resale treatment, asset, thresholds, audience, default preference and anti-spam
   policy. Approve public treatment of hidden content and record corrections.
2. Verify exact deployment sources and canonical confirmations; establish and
   record the activation baseline and history/re-enable behavior. Unknown or
   incomplete source history must not produce a claimed first or all-time record.
3. Review the minimal additive schema/API design, explicit feature capability,
   private read-state permissions, shared-event identity and rollback strategy.
   Preserve existing inbox versions, preferences and source records.
4. Pass behavioral tests for threshold boundaries, ties, deduplication, concurrent
   crossings, replay/reorg, baseline/no historical unread flood, exact wei, hidden
   content, opt-out/count consistency, durable dismissal and account/tab races.
5. Reuse coverage patterns from [lifecycle SQL tests](../../test/auction-notification-lifecycle-schema.test.mjs),
   [client-state tests](../../test/auction-notifications-state.test.mjs),
   [dismissal tests](../../test/notification-inbox-removal-schema.test.mjs),
   [summary tests](../../test/notification-summary-schema.test.mjs) and
   [public metrics tests](../../test/public-metrics-projection.test.cjs). Add the
   missing milestone cases; existing passing suites do not prove this feature.
6. For collections, additionally prove deployment/event identity and no double
   counting across auction finalization, mint claims, free mints and resale.
   USD and official-release categories retain their separate source/policy gates.
7. Complete staged browser acceptance for real settings/read/dismissal flows,
   testnet labeling and failure states; verify migration recovery and flag-off
   behavior. Obtain release/activation approval before any live broadcast.

Next bounded step: choose the policy in gate 1, then implement and test one complete
current 1/1 milestone path. Collection milestones and official releases need not
block that separate path, but neither is implied by its completion.
