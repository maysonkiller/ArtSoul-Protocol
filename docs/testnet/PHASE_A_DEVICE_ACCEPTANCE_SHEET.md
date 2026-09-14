# Phase A device acceptance — one sheet, five trips

Sixteen backlog rows are code-complete and waiting on the same thing: somebody
using the site on a real device. Run row by row and that is sixteen sessions.
Run trip by trip and it is five, because most rows are watching the same screens
for different things.

This sheet is organised by trip. Each trip says what to do, what to watch, and
which rows its answers close. Record the result here, dated, per device — a
conversation saying it looked fine closes nothing.

**Where.** `https://artsoulprotocol.com` — the apex origin, not a preview and not
a `vercel.app` address. Wallet sessions and SIWE are origin-scoped, so evidence
from any other origin proves nothing about production.

**Devices.** Desktop Chrome, iPhone (Safari), Android (Chrome). The iOS run
matters most: WebKit's rules differ from Chrome's and it reproduced several of
these first.

**Browsers, not embedded views.** An in-app browser inside another application
disables the back/forward cache and changes wallet handoff, so it cannot answer
trips 1 or 2.

---

## Trip 1 — Arrive cold, signed out

Clear site data first, or use a fresh private window. This is somebody's first
visit.

1. Open the home page. **Watch the first two seconds.**
2. Go to the gallery. Wait for cards.
3. Open any artwork.
4. Press the browser **Back button** — the button, not a link.
5. Open a profile page from any artwork's Creator.
6. Switch between all four profile tabs, first visit to each.

### What must be true

| | Row |
| --- | ---: |
| No black, grey or empty frame at any point. Something is always on screen. | A-72 |
| No skeleton or placeholder cards on a load that finishes quickly. | A-72, A-58 |
| Profile name and avatar appear before the gallery below them fills in. | A-54 |
| The avatar appears once, complete. Never a half-drawn strip that then redraws. | A-61 |
| Each profile tab's heading matches the list under it on its first visit. | A-58 |
| Artwork pages keep showing progress. No frozen intermediate state. | A-47 |
| **Back**: the gallery reappears with its scroll position intact, not rebuilt from nothing. | A-48 |
| The profile's first screen of works fills promptly; more appear without the page flashing. | A-79 |

### If Back rebuilds the page

Run the probe in [`A48_BACK_NAVIGATION_PROBE.md`](A48_BACK_NAVIGATION_PROBE.md)
— three console lines — and paste Chrome's own list of blocking reasons rather
than guessing.

---

## Trip 2 — Connect the wallet

With a profile page already open, connect.

1. Connect the wallet. Approve in the wallet application.
2. **Watch the header and the profile body.**
3. Open the account menu.
4. Reload the page. Watch the header through the reload.
5. Navigate to another page and back.

### What must be true

| | Row |
| --- | ---: |
| The header never sits on `Connecting…` for seconds. | A-53 |
| While the session is being restored the menu says `Restoring wallet…` and offers neither Connect nor Disconnect. | A-53 |
| Header and profile body agree on who you are. Not one before the other by a noticeable gap. | A-53 |
| The account menu shows a **balance figure**, not an ellipsis. | A-73 |
| The page is usable before the wallet SDK has finished loading. | A-64 |
| After reload the session comes back without asking for a new signature. | A-53 |

---

## Trip 3 — Publish an artwork

This is the one trip that costs testnet ETH. Do it once, carefully.

1. Publish an artwork with a starting price and a duration.
2. **Watch the moment after the transaction is approved.**
3. Land on the artwork page.
4. Open your profile.

### What must be true

| | Row |
| --- | ---: |
| After publishing, the ArtSoul mark appears where the wait is. Not a page skeleton. | A-71 |
| The artwork page shows Creator, media contained rather than full-bleed, and the network named as **Base Sepolia**. | A-33 |
| If anything fails, the message says what actually happened. | A-33, A-83 |

### If the publish fails

Copy the exact message. Two of them mean opposite things and the difference
matters:

- *"nothing was sent and nothing was published"* — safe to try again.
- *"the registration was submitted … check your profile before publishing it
  again"* — **do not republish.** Check the profile first. Publishing is two
  transactions and the first is permanent; republishing makes two artworks.

Either message closes A-83 if it is the right one for what happened.

---

## Trip 4 — Bid, and settle

Needs a second wallet. A creator cannot bid on their own work, and the contract
enforces that.

1. From the second wallet, bid on the artwork from trip 3.
2. Let the auction end. Settle it.
3. Open the artwork page again.

### What must be true

| | Row |
| --- | ---: |
| The bid targets the right auction, and the artwork page reflects it. | A-78 |
| After settlement the artwork page shows **Creator, First Collector and Owner** together. | A-33 |
| Token ID appears and links to the explorer. | A-33 |

**Most of this is already answerable without running an auction.** Five works
have settled on the public testnet. Open `artwork?id=v41:84532:19` and
`artwork?id=v41:84532:13`: both show Creator, First Collector, a full provenance
timeline and a Token ID. The Ownership panel shows no Owner row on either, and
that is correct - the row is suppressed when the owner is the creator or the
first collector, so one person is not listed twice.

Artwork `v41:84532:1` is the third case to open: its creator bought it back
through a completed resale, so the panel must show an **Owner** row naming the
creator. Before B-10 it did not.

What is left for this trip is a completed resale, where owner, creator and first
collector are three different addresses. That is the one arrangement no existing
work has.

---

## Trip 5 — The two wallet questions

Both may end as documented wallet limitations rather than defects. Both need
evidence before anyone decides.

### 5a — A wallet that will not switch network (A-57)

On a wallet that cannot reach Base Sepolia, open `/wallet-test`, try the switch,
and copy the log. It records the masked provider error per stage. The message
you see on the account menu should now name one of four distinct causes rather
than telling you to reconnect. Record the wallet name and which message appeared.

### 5b — An account switched inside the wallet (A-59)

Follow [`A59_ACCOUNT_SWITCH_PROBE.md`](A59_ACCOUNT_SWITCH_PROBE.md): connect,
switch account inside the wallet application, come back to the tab, read the
buffer. The four possible answers and what each implies are in that file.
Record which wallet produced which, since this was reported on more than one.

---

## Recording the result

Add a dated section below per device, naming the trip and the row. A row closes
only when its own criterion is met on the devices its criterion names — several
of these say iOS *and* Android, and desktop alone does not satisfy them.

| Date | Device | Browser | Trip | Rows answered | Result |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

## What this sheet does not cover

RG-03 moderation activation, the A8d Safe recovery rehearsal, and A-23's go/no-go
are ceremonies, not browsing. They are in
[`PHASE_A_CLOSE_OUT.md`](../PHASE_A_CLOSE_OUT.md) with what each needs.
