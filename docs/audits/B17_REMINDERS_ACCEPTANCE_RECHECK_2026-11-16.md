# B17 reminder acceptance recheck — November 16, 2026

Status: real payment-due delivery and physical-iPhone viewing are confirmed;
payment-due read acknowledgement and live extension remain unaccepted. The
settlement receipt and later purchase-notification read state are verified.
The receipt-refresh correction is released and the reloaded page is consistent;
convergence after a new no-reload settlement remains unobserved. This is a
bounded follow-up to
[the original reminder record](B17_REMINDERS_2026-10-25.md), not a new rollout.

## Current service evidence

- Supabase identifies the existing ArtSoul project as `ACTIVE_HEALTHY`.
- At 17:36:49.815839 UTC, the Base Sepolia Core indexer was `running` at
  confirmed/indexed block 59,643,691, with a heartbeat age of 1.36 seconds.
- At 17:37:05.459476 UTC, `auction_reminders_available` was true. Failed/dead
  indexed event count was zero.
- A 101-row bounded query found one persisted `auction_ending` reminder with
  one read marker, retaining the October 25 evidence. No `payment_due` row was
  present; the cap was not reached.
- No future auction/payment deadline was found in the bounded projected-deadline
  query. An empty current window does not establish a delivery defect.

Database calls used `BEGIN READ ONLY`, a five-second session-local statement
timeout and `ROLLBACK`. No materializing inbox RPC, mark-read call, preference
write, event mutation, clock change or configuration change was performed.

## Focused regression verification

The following command passed all 66 checks, with zero failures and zero skips:

```text
node --test --test-reporter=spec test/auction-notification-reminders-api.test.mjs test/auction-notification-reminders-state.test.mjs test/auction-reminders-inbox.test.cjs test/auction-notification-reminders-schema.test.mjs test/indexer-reminder-boundary.test.mjs
```

Coverage includes real disposable PostgreSQL and Engine behavior for current
winner isolation, deadline extensions without changed reminder identity/read
state, expiry, rollback, bounded/idempotent materialization, private preference
concurrency and confirmed-block freshness. Client checks cover hidden/closed
inboxes, late responses, elapsed-server-time expiry and visible-only polling.
These are local regressions, not physical-phone delivery evidence.

## Existing candidate for the next real observation

Two independent `eth_call` reads, through `sepolia.base.org` and
`base-sepolia-rpc.publicnode.com`, agreed on chain 84532 and auction 75:

- Artwork 14, BASE LOGO; status Active, with the November 10 18:15:16 UTC end
  time already past.
- Existing highest bidder `0x5e31…8383`, bid 0.001 test ETH and locked deposit
  0.01 test ETH. Settlement deadline remains zero.
- Indexed source evidence contains its creation and the already accepted bid;
  no ending/settlement event was returned for that round.

No transaction was prepared or sent by this recheck. The accepted bid must not
be replayed. A new, explicitly reviewed `endAuction(75)` would open the ordinary
24-hour settlement window; it does not itself mint an NFT or transfer funds.
Any live acceptance must use a fresh state check and the owner's wallet
confirmation.

If the owner proceeds, a temporary 1,440-minute reminder setting on the winning
account can make the new payment deadline eligible immediately when the inbox
is opened. Record the existing setting first, verify actual delivery/read state
on the phone, and restore it afterward. Complete the winner's ordinary payment
flow promptly rather than leave the locked deposit exposed to a test-induced
default. These are proposed steps, not completed evidence or authorization to
sign. The default one-hour setting would otherwise require waiting until the
last hour of the real payment window.

Live-extension observation remains separate: this already expired auction
cannot exercise a new last-minute extension. No deadline may be backdated and
no synthetic event may be inserted into production to close that gate.

## Owner-signed ending and persisted payment reminder

This later observation supersedes the earlier absence of a payment reminder;
phone delivery/read acceptance and settlement are still separate at this point.

The owner signed `endAuction(75)` on November 16. Both independent public RPCs
verified successful transaction
`0x39c751169641602b88a7362fe282f821b14f1b9721f1ad8a5a8b82713bf1c331`
in block `59649437`, timestamp `2026-11-16T17:55:56Z`. Its `AuctionEnded` log
has auction 75, the existing winner `0x5e31…8383`, a 0.001 test ETH winning bid
and deadline `2026-11-17T17:55:56Z` (18:55:56 Warsaw), exactly 24 hours later.
Both fresh contract reads returned SettlementPending for artwork 14, with
0.01 test ETH still locked. No bid or completed transaction was replayed.

The root browser observation, reported separately from the read-only checks,
showed the ended notice, Complete Settlement action, exact deadline and an
unread Payment due soon entry without reloading. The reminder preference was
temporarily changed through the site's UI from one hour to 24 hours and saved.
The database snapshot confirms `[1440]`, reminders/lifecycle enabled, revision
28 and preference update at `17:54:05.423284Z`.

At `17:57:45.132657Z`, a bounded read-only query found:

- The ending source marked `completed` and the auction projection in
  `settlement_pending`, with the same contract deadline.
- Exactly one persisted `payment_due` row for auction 75/artwork 14, addressed
  to the actual winner, created at `17:56:35.256409Z` within the real window.
- No read marker or dismissal for that row; the total read-marker count was
  zero. This preserves a before-read observation rather than marking it read
  as part of verification.

At `17:58:32.064332Z`, the existing read-only canonical reminder function
resolved that same persisted row to the actual ending transaction and deadline.
The creator's payment-due candidate count for auction 75 was zero. The stable
round correlation matches the original AuctionCreated transaction/log, and the
recipient/type/offset idempotency hash was independently recomputed and matched.
These checks establish the current winner identity and persisted delivery;
they do not establish physical-phone viewing or read acknowledgement.

Private evidence, excluded from Git:

- `docs/private/b17-payment-reminder-end75-before-read-2026-11-16.json`
- `docs/private/b17-end75-dual-rpc-2026-11-16.json`
- `docs/private/b17-payment-reminder-end75-canonical-2026-11-16.json`

All database verification used READ ONLY transactions and a five-second local
statement timeout. No materialization, read acknowledgement, preference write,
signature or transaction was performed by this evidence check. Physical-device
viewing/read state, the owner's ordinary settlement, any separate credit
withdrawal and restoration of the original one-hour preference are not yet
recorded as completed here. Live-extension acceptance remains separate.

## Physical-phone viewing and independent owner settlement

The owner then confirmed seeing the notification on the physical iPhone after
being asked to open the payment reminder for artwork 14/auction 75. This is an
owner observation of device delivery/viewing; it is not proof that its disclosure
was expanded or its read acknowledgement persisted. The root agent did not
expand that reminder on the PC.

At `18:03:58.197882Z`, one bounded read-only check still found no read marker
for payment-due row 154. The auction projection was already `settled`: the owner
had independently completed settlement while the phone check was in progress,
before the root agent's planned settlement handoff. No new signature or replay
was requested to reproduce that completed action.

Both public RPCs verified successful settlement transaction
`0xc3166f53beb86f309469a1a6d74c46cddf32a44884bcd7541cc82f5119813007`,
block `59651556`, timestamp `2026-11-16T18:03:00Z`:

- Sender is the existing winner `0x5e31…8383`; calldata is exactly
  `settleAuction(75)` and transaction value is zero.
- `SettlementCompleted` names artwork 14, token 8 and final price 0.001 test
  ETH. The receipt includes NFT 8's mint Transfer from the zero address to the
  winner, and a fresh `ownerOf(8)` confirms that same owner.
- Auction status is Settled and locked deposit is zero. The winner has
  0.009 test ETH in `pendingWithdrawals`, representing the excess deposit.
  It is withdrawable contract credit, not an automatic wallet refund; no
  withdrawal is claimed or performed by this check.

The `18:04:24.747295Z` database snapshot confirms the settlement event is
processed and the canonical payment-reminder count is zero even when evaluated
with the temporary 24-hour offset. Thus settlement retires the payment reminder;
it was not removed merely by restoring the preference.

The root agent restored the original one-hour reminder through the UI. That
same snapshot independently confirms `[60]`, revision 29, update time
`18:04:21.425717Z`, with reminders and lifecycle still enabled. No settings were
changed by these read-only verification queries.

At `18:04:39.352294Z`, the canonical purchase notification for this exact
settlement was row 155, token 8, amount 0.001 test ETH, with `read=true` and read
time `18:03:45.038876Z`. This is a distinct lifecycle notification. It does not
supply the missing read acknowledgement for payment-due row 154, which remains
unread in the stored evidence. The database timestamp alone does not identify
which device acknowledged the purchase notification.

The root browser showed Sold and Purchase completed/Read, with Payment due soon
absent. However, the same artwork page still showed only Creator, six timeline
events ending with AuctionEnded and an updating-data notice. Receipt, ownership
and reminder retirement are verified; full in-place ownership/timeline
convergence is not accepted by this observation. The released correction and
later reloaded-page check are recorded below; they do not replace this failure
with a claimed no-reload success. No repeated payment was used for verification.

Additional private evidence, excluded from Git:

- `docs/private/b17-phone-settlement-database-2026-11-16.json`
- `docs/private/b17-settlement75-dual-rpc-2026-11-16.json`

Payment-due read acknowledgement and a real live-extension observation remain
open. Existing isolated tests cover their logic; neither the later purchase
read marker nor the owner's successful settlement substitutes for those missing
live observations.

## Released receipt-refresh correction

The live stale-state observation above exposed a separate frontend defect:
the confirmed-auction handler performed one indexed refresh, then normal
auction polling stopped after the receipt changed the page to Sold. Ownership
and history could therefore remain at the earlier projection despite the
successful settlement. This does not invalidate the receipt or imply another
payment is needed.

The correction in `src/entries/artwork.jsx` shares one bounded,
visible-only refresh loop between auction and resale receipts. It permits at
most seven serial refresh attempts, with 60 seconds of scheduled delays in
total excluding read duration and hidden-tab time. A confirmed receipt retires
the completed action immediately; mint, role and timeline facts still come
from the indexer. Auction reconciliation waits for the matching auction ID and
event type in history even after artwork ownership has caught up. A replacement
receipt invalidates an earlier in-flight read; account/network changes and
unmount cancel the work, and hidden pages pause scheduled refreshes.

Exhaustion exposes an explicit Retry. Independent review found that retrying
after only history remained stale could lose the original receipt target; the
follow-up retains that target until history also catches up. Duplicate
or detail-less receipt events preserve that window and its exhausted warning;
only an explicit Retry starts another bounded window.

The implementing agent's latest local run passed 78 checks (38 + 40):

```text
node --test test/artwork-auction-reconciliation.test.cjs test/auction-confirmed-reconciliation.test.cjs
```

An earlier adjacent run passed 23 action-flow, owner-after-buyback and provenance
checks. These targeted results do not establish a passing full-suite run.
Independent review found no remaining blockers after both Retry corrections.
The final local build passed all 11 route checks and 172 CSS utility checks.
[PR #497](https://github.com/maysonkiller/ArtSoul-Protocol/pull/497) merged as
`f02595bf888fc9baa44e4ca9cd4057d93686fd19`. Hosted run `43926281894`
passed Linux, Windows, static and contract checks. Production deployment
`dpl_F1RpoHxD81j9uYK9HyxsAGLTqdib` is READY. At
`2026-11-16T18:16:51.793Z`, the apex served `/assets/artwork-AoGz7bC5.js`,
byte-identical to the local build with SHA-256
`874c1c5be7600a1e0b4035ae9107c2276a8876f4ed7b8fc1686a0dd750e0fb2c`.

After reloading the released page, the browser showed the correct Creator and
First Collector/current owner `0x5e31…8383`, seven provenance events including
the exact settlement transaction above, no updating-data notice and the owner's
List NFT action. This verifies deployed state and presentation after reload;
it does not claim a new transaction's in-place convergence. The original live
failure and missing payment-reminder read acknowledgement/live-extension
observations remain recorded above. No completed transaction was replayed.

## Read acknowledgement on the deployed inbox

Later on November 16, expanding **You won the auction** for artwork 14 and
auction 75 changed its status from Saving to Read. The badge went from 16 to
15. After reload, the All view still showed Read. This verifies the ordinary
read action for the winner's lifecycle notification. The **Payment due soon**
reminder had already retired on settlement. Its stored read-marker count was
still zero at 20:07 UTC. The bounded check found no upcoming active or
settlement-pending round and no indexed `AuctionExtended` event at that time.

## Local contract-to-inbox regression, November 18

The following command passed 53 tests with zero failures and zero skips on
Windows, including the new [contract-to-inbox test](../../test/auction-reminders-local-evm.test.mjs).

```text
node --test --test-reporter=spec test/auction-reminders-local-evm.test.mjs test/auction-notification-reminders-api.test.mjs test/auction-notification-reminders-state.test.mjs test/auction-reminders-inbox.test.cjs test/indexer-reminder-boundary.test.mjs
```

The test compiles the repository contracts with the installed `solc` 0.8.26,
executes them on an in-memory Hardhat chain, and processes the resulting logs
through the event listener and sync engine into disposable PostgreSQL 17. It
calls the notification handler with locally issued signed session cookies. A
test adapter executes the handler's RPC requests against the database under
the `service_role` role. The fixture uses the real database clock and advances
only its private EVM clock.

- A late bid emits `AuctionExtended`. The creator's ending reminder retains
  its ID and read state, points to the new receipt, and shows the new deadline.
  The database contains exactly one matching reminder.
- A separate round opens a payment window for its winner. The creator and
  unrelated account see no payment reminder. The unrelated account's attempt
  to acknowledge the winner's reminder returns HTTP 409. The winner's session
  marks it read, and a fresh authenticated request returns that acknowledgement.
- Settlement mints the NFT to the winner, retires the payment deadline, and
  leaves the earlier acknowledgement intact. The purchase notification refers
  to the settlement transaction. The isolated worker completes all its events.

This closes the local engineering check. Remaining hosted observations are an
explicit read of an eligible payment reminder before settlement and an actual
late-bid extension processed by the deployed indexer. The next eligible rounds
can provide these observations through the existing UI and indexer.

At 12:39:59 UTC on November 18 a three-second-limited, read-only check
found no indexed Base Sepolia `AuctionExtended` event and no stored read
acknowledgement for a `payment_due` reminder. The original reminder 154
also had no read acknowledgement.

At 13:08:26 UTC a read-only check found no indexed Base Sepolia auction
with a future bidding deadline and no winner with an open payment window.
The deployed indexer still contained no extension or acknowledged payment
reminder. No qualifying hosted scenario was available at that time.

## Candidate check for the next joint session

At 15:19 UTC on November 18, the [read-only preflight](../../sql/verification/auction_windows.sql)
found no open late-bid or payment window. It also looked for expired rounds
that still had a bid and could open a payment window on finalization.
Artwork 23, auction 23, appeared in that third category.

At [Base Sepolia block 60466748](https://sepolia.basescan.org/block/60466748),
15:20:18 UTC, direct reads of the Core configured on the public site confirmed
the unpaused engine, active round 23 and unminted artwork. Bidding ended July 12
at 16:34:58 UTC. The highest bidder was `0xA61C…0329`, with a 0.001 test ETH
bid and 0.01 test ETH locked. At those values settlement would require zero
additional purchase value plus transaction gas. The released artwork and
auction-live APIs both returned round 23 with status `awaiting_end`, the
same bid and deadline for [Tarpot](https://artsoulprotocol.com/artwork/23).
These observations initiated
no transaction. Verify the same state again at the session. Use the round only
if its winning wallet holder is present and agrees to start the payment clock.

The query returns up to five current visible rounds per scenario and an
explicit `no_candidate` when a scenario has no match. A future `opens_at`
allows the operator to schedule a late-bid check. Candidate selection uses
current prototype deadlines and must be reviewed against the C13 contracts.
The [joint checklist](../PHASE_B_STATUS_2026-11-02.md#next-joint-testnet-session)
records what the participants must actually observe before marking a row passed.

On November 19 at 12:41 UTC, the preflight again returned Tarpot as the only
finalizable candidate with a winner and found no late-bid or payment window.
Independent Base Sepolia RPCs agreed at [block 60851191](https://sepolia.basescan.org/block/60851191)
on the unpaused Core, highest bidder, bid and locked deposit. The winning
wallet holder must be available before starting the payment clock. The
artwork JavaScript served by the public site differed from the local build.
The public indexer reported healthy through confirmed Base Sepolia block
60,851,867 with a five-second-old update. If the Tarpot winner is unavailable,
the founder's unminted [Rialo VIDEO CAT, artwork 7](https://artsoulprotocol.com/artwork/7)
had no active round. It can host a fresh 24-hour test round with a separate
bidder. Recheck its state and agree the closing time before creating one.

Round 23 was excluded from the joint session because its winning wallet
holder was unavailable. No finalization was initiated. For artwork 7, two
RPCs at Base Sepolia blocks 60,852,496–497 confirmed an unpaused Core, the
expected creator, no minted NFT and no active round. The participants can
create a 24-hour round with an opening price of 0.001 test ETH. Use the
creation receipt to identify its round and UTC deadline before timing the
first bid. No creation receipt was observed in this preflight.

## November 19: artwork 7 opened round 76

The creator's [Base Sepolia transaction](https://sepolia.basescan.org/tx/0x60d9c97a2064ca80f82c1d2eaaeed104424d1a7bad3a5769ba06c9ab7b3e272a)
created round **76** for [Rialo VIDEO CAT, artwork 7](https://artsoulprotocol.com/artwork/7)
in block 60,856,941. The starting price recorded on-chain was **0.00001
test ETH**; the proposed test scenario had used 0.001 test ETH. The public
artwork projection and auction-live API both returned round 76, the recorded
starting price and no bids. The public indexer had confirmed block 60,857,109.

The original bidding deadline is November 20 at 13:00:57 UTC (14:00:57 in
Warsaw). For a first late bid, the inclusion window begins at 12:50:57 UTC
(13:50:57 in Warsaw) and excludes the deadline itself. Recheck the current
deadline, minimum bid and bidder before signing. One qualifying extension
would move the deadline to 14:10:57 in Warsaw. The extension event, winner's
payment reminder acknowledgement and settlement remain unobserved.
