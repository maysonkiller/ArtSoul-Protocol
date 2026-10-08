# Phase A device acceptance — one sheet, five trips

Fifteen backlog rows remain for device and connected-flow acceptance after
A-79 closed on September 27. Their implementation is published; failed
acceptance may still require a fix. Group the checks into five trips because
most rows are watching the same screens for different things.

This sheet is organised by trip. Each trip says what to do, what to watch, and
which rows its answers close. Record the result here, dated, per device — a
conversation saying it looked fine closes nothing.

October 8 owner follow-up: asked about the previous iPhone gallery/detail/Back,
wallet/profile reload, tab switching and lock/resume run, the owner reported
that it had already been done and appeared to work well. Record this as a
qualitative owner observation; do not ask for the same entire trip again without
a specific unresolved symptom. The reply did not identify an Android run,
timestamps, individual OAuth outcomes or a native staff-factor ceremony, so it
does not supply those missing evidence fields.

**Where.** `https://artsoulprotocol.com` — the apex origin, not a preview and not
a `vercel.app` address. Wallet sessions and SIWE are origin-scoped, so evidence
from any other origin proves nothing about production.

**Devices.** Desktop Chrome, iPhone (Safari), Android (Chrome). The iOS run
matters most: WebKit's rules differ from Chrome's and it reproduced several of
these first.

**Browsers, not embedded views.** Embedded browsers can change back/forward
caching and wallet handoff. Use the named ordinary browsers for trips 1 and 2;
an in-app wallet browser is additional coverage, not a substitute.

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
| Quick loads do not flash a transient placeholder; slower loads retain understandable progress rather than an unexplained blank screen. | A-72 |
| No skeleton or placeholder cards on a load that finishes quickly. | A-72, A-58 |
| Profile name and avatar appear before the gallery below them fills in. | A-54 |
| The avatar appears once, complete. Never a half-drawn strip that then redraws. | A-61 |
| Each profile tab's heading matches the list under it on its first visit. | A-58 |
| Artwork pages keep showing progress. No frozen intermediate state. | A-47 |
| **Back**: the gallery reappears with its scroll position intact, not rebuilt from nothing. | A-48 |
| The profile's first screen of works fills promptly; more appear without the page flashing. | A-79 (accepted September 27; reuse that evidence unless a relevant change occurs) |

### If Back rebuilds the page

Run the probe in [`A48_BACK_NAVIGATION_PROBE.md`](A48_BACK_NAVIGATION_PROBE.md)
— a page-restoration marker — and paste Chrome's own list of blocking reasons rather
than guessing.

The desktop portion passed on September 27. Complete the real iOS and Android
portions; a navigation timing type alone does not prove or disprove BFCache.

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
| The header reaches the correct identity or an actionable error; it does not remain stuck on `Connecting…`. | A-53 |
| While the session is being restored the menu says `Restoring wallet…` and offers neither Connect nor Disconnect. | A-53 |
| Header and profile body agree on who you are. Not one before the other by a noticeable gap. | A-53 |
| The account menu shows a **balance figure**, not an ellipsis. | A-73 |
| The page is usable before the wallet SDK has finished loading. | A-64 |
| After reload a still-valid session restores without another signature; an expired or invalid session requires authentication. | A-53 |

On both phones also complete SIWE, switching to Base Sepolia, returning from
the wallet app, and Publish in trip 3. A guest-only SDK check cannot close A-64.

---

## Trip 3 — Publish an artwork

This trip needs testnet ETH for gas. Bids, end/settlement, resale and withdrawals
in later trips also need testnet funds; review each value and gas estimate.

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

A-83 specifically needs an observed confirmation delay **after broadcast**,
with the submitted hash retained, an honest pending/uncertain state, and later
receipt/profile reconciliation without duplicate publication. A normal success
or a pre-send rejection alone does not close it. Prepare any controlled delay
with the operator; do not interrupt shared RPC service or blindly resubmit.

---

## Trip 4 — Bid, and settle

Needs three distinct wallets: creator A, first collector B and resale buyer C.
A creator cannot bid on their own work, and the contract enforces that.

1. From the second wallet, bid on the artwork from trip 3.
2. After the deadline, end the auction and settle from its winning wallet.
3. List the resulting NFT and complete a legitimate resale to wallet C.
4. Open the artwork page again and compare all three addresses.

### What must be true

| | Row |
| --- | ---: |
| Bid/end use the current auction ID, historical settlement retains its explicit auction ID, and resale uses the correct token/artwork mapping. Compare UI target, wallet call and receipt. | A-78 |
| After resale to C the artwork page shows three distinct **Creator, First Collector and Owner** identities together. Immediately after settlement Owner equals First Collector and may be omitted. | A-33 |
| Token ID appears and links to the explorer. | A-33 |

**Most of this is already answerable without running an auction.** Five works
have settled on the public testnet. Open `artwork?id=v41:84532:19` and
`artwork?id=v41:84532:13`: both show Creator, First Collector, a full provenance
timeline and a Token ID. The Ownership panel shows no Owner row on either, and
that is correct - after mint the row is suppressed when Owner equals First
Collector. Equality with Creator alone does not suppress Owner.

Artwork `v41:84532:1` is the third case to open: its creator bought it back
through a completed resale, so the panel must show an **Owner** row naming the
creator. Before B-10 it did not.

What was absent in the September 27 read-only snapshot is a completed resale
where Owner, Creator and First Collector are three different addresses. Check
the current data before creating additional test assets. A-33 also needs real
rejection/error feedback and usable actions on narrow/landscape screens. Test
the nested estimate/RPC failure path as well as wallet rejection; cancellation
alone does not cover the original diagnostic-overflow defect. Use a controlled
pre-broadcast failure, without sending a deliberately failing transaction.

New auctions last 24, 36 or 48 hours; public time cannot be accelerated. The
settlement window begins at the successful end transaction. A suitable existing
asset may cover part of the journey with its owner's authorization.

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
| 2026-09-27 | Windows desktop, Chrome 153.0.8010.53 | Ordinary installed Chrome; headed window for BFCache | Trip 1, partial | A-79; desktop portion of A-48 | Apex at release `81627ab`: opening creator read limit 24, identity before cards and full corpus, no settled-content reset. A-79 accepted. Headed Back restored the same marker with `pageshow.persisted=true`; A-48 phones remain open. See [release evidence](../audits/STABILIZATION_RELEASE_2026-09-27.md). |

The same read-only run checked A-33's public provenance cases: five of 34 public
records were minted, but none had three different Creator / First Collector /
Owner addresses. This does not complete Trip 4 or connected transaction feedback.
Mobile viewport screenshots are layout checks, not iPhone/Android acceptance.

## What this sheet does not cover

September 29 additional evidence: real Base Sepolia purchases of token 4 and
the no-bid end of auction 63 were confirmed and reflected by the apex/indexer.
A-33's previously missing three-distinct-address provenance example now exists.
The six-transaction sequence also tested specific-token approval, listing and
withdrawal; see [execution evidence](../audits/PHASE_A_TESTNET_2026-09-29.md).
These were local operator signatures, not a browser-wallet or real-phone flow.
No phone row is closed by them. Built local profile verification confirms the
Genesis mainnet-only notice and correct Base Sepolia explorer link.

Combine these trips with all applicable blocks in
[`RG01_APEX_ORIGIN_ACCEPTANCE_2026-09-04.md`](RG01_APEX_ORIGIN_ACCEPTANCE_2026-09-04.md),
including lock/unlock, explicit disconnect and actual Discord/X callbacks. That
form permits one person to perform the device blocks using distinct wallets and
profiles; it does not relax independent Safe signer requirements.

The takeover acceptance also needs TA-01 (real Gemini success and honest
loading/error/stale-file handling), TA-02 (verified OAuth versus self-reported
links), and TA-06 (no-bid end, re-auction, shared modal, decimal comma, empty-price
rejection, cross-page freshness and address-based creator-bid protection).
Do not present existing fixture checks as new live-provider acceptance.

RG-03 moderation activation, the A8d Safe recovery rehearsal, and A-23's go/no-go
are ceremonies, not browsing. They are in
[`PHASE_A_CLOSE_OUT.md`](../PHASE_A_CLOSE_OUT.md) with what each needs.
