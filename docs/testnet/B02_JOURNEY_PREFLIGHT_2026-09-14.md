# B-02 — journey pre-flight, 2026-09-14

B-02 asks for complete publish-to-resale journeys verified with real users. Before
anyone is invited to walk that path, somebody should walk it on the data that is
already there and see whether every step can actually be completed from the site.

This is that walk. It is read-only: the production projection, the public pages
signed out, and the contract source. No transaction was sent.

## Has every step happened at least once?

From the `v41_*` projection on Base Sepolia:

| Step | Evidence | Happened |
| --- | --- | --- |
| Publish | 33 artworks | yes |
| Auction started | 56 auctions | yes |
| Auction ended, no bids | 28 `defaulted_no_bids` | yes |
| Auction ended, with a winner | 10 of 38 recorded endings | yes |
| Settlement completed and minted | 5 settled, tokens 1-5 | yes |
| Settlement defaulted | 1 `defaulted` | yes, once |
| Listed for resale | 4 listings, 3 active | yes |
| Resale completed | 1, token 1 | yes |

Every step exists on chain. Seven addresses produced all of it, so none of it is
evidence about real users; that is still what B-02 is for.

## What the walk found

### 1. A buyback showed the wrong owner — fixed, B-10

Token 1 was resold to its own creator. The artwork page's Ownership panel omitted
the Owner row whenever the owner was the creator, so the page read as though the
first collector still held the work while its own provenance timeline said
otherwise. Merged in #273.

### 2. An expired settlement could not be closed — fixed, B-11

Four auctions sit in `settlement_pending` with their 24-hour window long past:

| Artwork | Auction | Window closed |
| --- | --- | --- |
| 14 | 14 | 2026-06-27 |
| 24 | 24 | 2026-07-16 |
| 25 | 25 | 2026-07-20 |
| 30 | 39 | 2026-09-05 |

The contract closes that state one way, `claimSettlementDefault`, and lets anyone
call it. Nothing on the site called it. Each of these works kept an active auction
id its creator could not replace, the creator's share of the locked deposit was
never credited, and the page said *Awaiting payment* while still showing the
winner a *Complete Settlement* button that the contract would revert with
`SettlementExpired` after the winner had paid gas for it.

The page now says *Payment window closed*, stops offering the payment, and offers
*Close Expired Settlement* to anyone connected, as the contract allows. Cards say
the same.

The one `defaulted` settlement in the projection, artwork 2, was closed by a
path the current page does not have. The repository still carries a legacy
auction service that called the function, so this records only that today's page
could not, not how that one was closed.

### 3. Eighteen "active" auctions are all over

Every auction with status `active` is past its end time. Seventeen have no bid;
artwork 23 has one.

This is not a defect. Ending is permissionless by design, *End Expired Auction*
exists on the page, and bidding closes at the end time regardless (#239). But it
means the public testnet currently has **no live auction for anyone to bid on**,
and eighteen works whose creators cannot start a new auction until somebody
presses the button.

## Before inviting anyone

These cost testnet gas and need a connected wallet, so they are the founder's to
do. Each is one button on the artwork page.

**After B-11 is deployed**, open each of the four and press *Close Expired
Settlement*:

`v41:84532:14` · `v41:84532:24` · `v41:84532:25` · `v41:84532:30`

**Any time**, open each of these and press *End Expired Auction*. Artwork 23 has
a bid, so ending it opens a 24-hour settlement window for its bidder rather than
freeing the work:

`3` · `4` · `9` · `21` · `23` · `26` · `27` · `28` · `10` · `15` · `17` · `5` ·
`8` · `31` · `29` · `16` · `6` · `11`

**Then** start at least one fresh auction, so a tester arriving has something
live to bid on. A beta whose first screen offers nothing to do tests nothing.

## What this does not cover

Moderation and wallet recovery are named in B-02 and are not walked here.
Moderation is behind a disabled flag until the RG-03 ceremony runs, and wallet
recovery is the A8d rehearsal. Both remain open on their own rows.
