# RG-01 Apex-Origin Acceptance Run - 2026-09-04

Fill this file in as the run happens. It is the evidence RG-01 closes on, and it
is an explicit precondition of RG-03 and therefore of the whole A8 activation.

**Record `PASS` or `FAIL` in every Result cell, never a blank and never "ok".**
On a `FAIL`, stop that block, write what you saw, and report it. A partial run is
not evidence, and a row left blank reads as a step nobody ran.

**Apex only:** every step runs on `https://artsoulprotocol.com`. Not the Vercel
domain, not a preview URL. WalletConnect sessions, SIWE signatures, browser
storage and OAuth returns are all origin-scoped, so a preview result proves
nothing about production.

**Wallet addresses:** record the last four characters only. RG-04 keeps addresses
and role assignments out of public source.

**If one person runs every block,** say so in Run details rather than inventing a
second operator. Device coverage is what the evidence rests on; who held the
device is context, not proof.

## Operators

| Operator | Devices | Blocks to run |
| --- | --- | --- |
| Operator A | iOS device | B, and C7 |
| Operator B | Desktop PC, and an Android phone | A, D, and C1 to C6 |

Operator A's iOS run is mandatory. RG-01 names desktop and iOS explicitly,
and the external-mobile WalletConnect path behaves differently on iOS because the
browser leaves and re-enters the page.

Operator B's Android run in block D is additional coverage rather than an RG-01
requirement, but it is cheap and it is where a second wallet app would first
show a divergence.

The two operators use **different wallets and different profiles**. That is
deliberate: it also proves that identity is bound to the connected wallet rather
than leaking between sessions.

## Run details

| Field | Operator A | Operator B |
| --- | --- | --- |
| Date (UTC) | | |
| Desktop browser and version | n/a | |
| Phone, OS and browser | | |
| Mobile wallet app and version | | |
| Wallet address used (last 4 characters only) | | |

## Block A - Desktop (Operator B)

| # | Step | Expected result | Result |
| --- | --- | --- | --- |
| A1 | Open `https://artsoulprotocol.com` in a normal window | Page loads, header shows a connect action, no console errors | |
| A2 | Connect the wallet | Header shows the connected identity: avatar, name or shortened address | |
| A3 | Reload the page | Still connected. No `Connecting...` that never resolves, no flash back to guest | |
| A4 | Navigate to Gallery, then an artwork, then Profile | Identity stays the same on every page. No guest flicker | |
| A5 | Sign in with Ethereum when prompted | Signature request appears and is accepted; the session is established | |
| A6 | Open Profile and confirm the address shown | Matches the connected wallet | |
| A7 | Disconnect explicitly from the account menu | Returns to guest cleanly. No stale avatar or name remains | |
| A8 | Reload after disconnect | Still guest. The session did not resurrect itself | |

## Block B - iOS (Operator A)

Use the real phone and the real mobile wallet app, not a desktop emulator. This
run is the one that matters, because the external-mobile path leaves the browser
and comes back.

| # | Step | Expected result | Result |
| --- | --- | --- | --- |
| B1 | Open `https://artsoulprotocol.com` in the phone browser | Page loads; layout has no horizontal scrolling | |
| B2 | Connect through the mobile wallet | The wallet app opens, approval is possible, and the browser returns to the same tab | |
| B3 | Confirm the header after returning | Connected identity is shown, not `Connecting...` | |
| B4 | Sign in with Ethereum | The wallet opens for the signature and the browser returns with the session established | |
| B5 | Navigate across five pages: home, gallery, artwork, profile, protocol docs | Identity is stable on all five | |
| B6 | Lock the phone, wait about a minute, unlock and return to the browser | Session restored, still connected | |
| B7 | Reload the page | Still connected | |
| B8 | Disconnect explicitly | Returns to guest cleanly and stays guest after reload | |

## Block C - Social link return

These exist because OAuth redirects back to a fixed origin. If a provider
callback still points anywhere other than the apex, linking silently breaks in
production.

X linking failed on the apex until 2026-08-19 because the X application had no
apex callback registered. Backlog A-49 records the diagnosis and the correction,
and a founder link/unlink on the apex succeeded afterwards. All rows below are
runnable; C4 to C6 are no longer blocked.

| # | Step | Operator | Expected result | Result |
| --- | --- | --- | --- | --- |
| C1 | Profile, link Discord | B, desktop | Discord authorization opens and returns to `artsoulprotocol.com`, not to the Vercel domain | |
| C2 | Confirm the linked Discord handle appears | B, desktop | Handle is shown on the profile | |
| C3 | Unlink Discord | B, desktop | Link is removed and the profile updates | |
| C4 | Profile, link X | B, desktop | X authorization opens and returns to `artsoulprotocol.com` | |
| C5 | Confirm the linked X handle appears | B, desktop | Handle is shown on the profile | |
| C6 | Unlink X | B, desktop | Link is removed and the profile updates | |
| C7 | Repeat C1 and C2 for Discord | A, iOS | Returns to the apex on mobile as well | |

Linked social handles are eligibility and profile data. They are never
authentication factors and they grant no moderation authority.

## Block D - Android (Operator B, additional coverage)

| # | Step | Expected result | Result |
| --- | --- | --- | --- |
| D1 | Open `https://artsoulprotocol.com` in the Android browser | Page loads without horizontal scrolling | |
| D2 | Connect through the mobile wallet and return to the browser | Connected identity shown | |
| D3 | Sign in with Ethereum | Session established after returning from the wallet | |
| D4 | Navigate across five pages | Identity stable | |
| D5 | Reload | Still connected | |
| D6 | Disconnect explicitly and reload | Guest, and stays guest | |

## Outcome

| Field | Operator A | Operator B |
| --- | --- | --- |
| Block A passed | n/a | |
| Block B passed | | n/a |
| Block C Discord rows passed | | |
| Block C X rows passed | | |
| Block D passed | n/a | |
| Defects observed | | |

RG-01 is complete only when blocks A and B pass in full and every block C row
passes.

When it does pass, update `RESOURCE_GATED_WORK.md` RG-01 in a docs-only change
that cites this filled checklist.

If a wallet or SIWE step fails, do not update RG-01. Open the defect as a backlog
row first; a failure there is a production wallet defect and outranks the A8
activation sequence.
