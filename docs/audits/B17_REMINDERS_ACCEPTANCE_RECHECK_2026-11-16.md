# B17 reminder acceptance recheck — November 16, 2026

Status: implementation regressions pass; the remaining real payment reminder,
live-extension and physical-device observations are not yet accepted. This is a
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
