# Homepage promotion schedule

C10 has an offline checker for the person reviewing a proposed schedule. The homepage continues to use its existing discovery flow. The checker reads two local JSON files and reports the number of scheduled promotions at a given instant. It has no database connection, signing key, bidding endpoint, or delivery path.

## What a visitor and sponsor should see

Out of twelve positions, reserve at least nine for community-ranked work. Up to three positions share a single **Promoted** allocation. A paid auction, a free partner feature and a negotiated sponsorship each use one of those positions. Unused inventory returns to organic discovery. Every promotion must identify the sponsor and its relationship to ArtSoul. A free partner placement must say it is free. A negotiated arrangement must disclose its fee and any goods or services exchanged.

The operator may choose the reserve for **each new banner auction**. Publish the reserve, bidding window, delivery slot and delivery dates before the first bid. A different reserve needs a new auction and its own available slot. All eligible bidders in that auction face the same terms. Artwork starting bids, collection mints and banner inventory have separate rules. For a direct placement, publish the agreed terms and the reason for choosing the partner before the placement begins. Record repeat placements as new decisions with new finite periods.

An accepted placement buys exposure in one designated position during its stated period. Its terms confer no guaranteed impressions, clicks, sales, verification, investment return or ranking benefit. Eligible cash proceeds from auctions and negotiated placements belong to ProtocolTreasury. A banner sale gives its operator no authority over the treasury, wallet approvals or protocol settlement.

## Run the preflight

Use the last independently retained **published** schedule as the first file. Supply the complete proposed successor as the second file. Both files have the same shape. Only an initial installation with no published terms may use the empty baseline `{"placements":[],"awards":[]}`. A test clock may be supplied as the last argument.

```sh
node scripts/check-banner-schedule.mjs previous.json proposed.json 2030-03-01T08:00:00Z
node --test test/banner-schedule.test.mjs
```

The report counts an auction during its delivery period only after an award has been recorded. All planned periods still reserve their lane for collision checks. An award record alone supplies no proof of payment. An occupied lane is available again at its exact end time.

| Record | Required public terms |
| --- | --- |
| Every placement | Stable `id`, `kind`, promotion `slot` (1–3), `publishedAt`, `startsAt`, `endsAt`, HTTPS `termsUrl`, separate `proposedBy` and `approvedBy` groups. |
| `auction` | `opensAt`, `closesAt`, exact `reserveWei`, `payee: "ProtocolTreasury"`. The auction opens to eligible bidders without a named sponsor. |
| `free-partner` | `sponsorGroup` and public `reason`. Use this mode only when there is no cash or in-kind consideration. |
| `negotiated` | `sponsorGroup`, public `reason`, exact `feeWei`, written `inKind` disclosure (or `null` for cash only), `payee: "ProtocolTreasury"`. A consideration consisting solely of goods or services uses an explicit zero fee. |
| Auction award | Add one entry to `awards` with `placementId`, winning `sponsorGroup`, `winningBidWei`, `decidedAt` and HTTPS `recordUrl`. Publish the result once bidding closes and by the scheduled start. |

UTC timestamps use whole seconds. Prices use decimal strings denominated in wei to preserve exact amounts. Executable sample schedules use synthetic prices in [the regression tests](../../test/banner-schedule.test.mjs).

## Fair allocation and review

Count affiliated sponsors as one group. A group can occupy one promotional position at a time across all three modes. The proposer and reviewer must be independent. Reviewers must recuse themselves from their own or affiliated sponsorships. Neither the proposer nor the reviewer may win an auction they operate. A free or specially negotiated slot needs a recorded public reason and an independent review under the same capacity and conflict checks. Direct terms cannot override or privately discount an existing auction.

The preflight verifies record shape, amounts, timing, lane capacity, recorded group conflicts and immutability against the supplied baseline. It cannot establish that a group controls only one identifier, authenticate personnel, read the referenced pages, validate off-platform consideration or prove the winning bid. No authority to publish a campaign or spend funds is granted by these local records.

Before enabling real placements, the delivery service must verify permissions and group affiliations, preserve a timestamped public version of each approved set of terms, and serialize schedule changes against the last committed version so concurrent approvals cannot overbook. It must use the settlement outcome and verified treasury destination, define cancellation/refunds and the auction award rules, and check eligibility before an irreversible payment. The homepage must label every delivered promotion, revert unavailable positions to organic discovery and prove organic ranking stays independent. These remain C10 acceptance work.

## Industry references

Google Ad Manager uses publisher pricing rules to filter bids below a configured floor and describes separate treatment for direct sponsorships. This is the relevant precedent for keeping a public auction reserve distinct from an agreed direct placement. [Google Ad Manager pricing rules](https://support.google.com/admanager/answer/9298008?hl=en)

Google documents sponsorship line items with scheduled start and end dates and separately negotiated proposal rates. ArtSoul applies its own shared three-position limit, relationship disclosure and group conflict policy across those formats. [Line item types and priorities](https://support.google.com/admanager/answer/177279?hl=en) · [Proposal line items](https://support.google.com/admanager/answer/9789673?hl=en)
