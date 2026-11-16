# B17 reminder acceptance recheck — November 16, 2026

Status: implementation regressions pass and the live payment reminder was
delivered after the owner-signed ending below. Read acknowledgement,
live-extension and physical-device observations remain separate. This began as a
bounded read-only follow-up to
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
