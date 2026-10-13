# RG-01 Apex-Origin Acceptance Run - 2026-09-04

October 14 distinct-identity continuation:

- Existing owner Chrome (wallet suffix 989b), release `0ae7c31`: own profile and
  header agree after navigation/reload; Profile -> Gallery -> artwork 33 retains
  that connected identity. The creator link opens public profile suffix 1824
  with its own name/biography and no Edit Profile. This is public-profile browsing,
  not a second native signed wallet. The owner's tab subsequently changed to
  Admin setup; disconnect/reload was not performed over that ongoing workflow.
- PR #301 / `12f3e38` fixes profile saves following a different tab's shared
  session cookie. Three failing reproductions became five passing regressions;
  49 compiled Chrome assertions use the actual handler with isolated storage.
  Draft retention/retry and stale-response cache isolation pass. This is fixture
  coverage, not a real iPhone or successful production profile-save claim.
- Two old test wallets (suffixes 8383/1819) completed actual apex SIWE at
  22:52:53-22:53:00 UTC October 13 / October 14 Warsaw. Both reject mismatched
  and absent save intent, accept matching identity up to deliberately invalid
  input validation, and enforce wallet-scoped email/notification reads. Both
  public profile rows are absent and remain absent; do not call these two populated
  profiles. The first verifier stopped before signing because it incorrectly
  required an existing row; that evidence is retained. Corrected acceptance
  made no profile write or transaction and ended both isolated HTTP sessions.
- Evidence: `output/audit/rg01-desktop-profile-2026-10-14.json`, compiled/asset
  records with `profile-isolation-*`, and the private live-session record. All
  existing phone/provider PASS results below are retained. The remaining native
  disconnect/reload, account-switch and exact device criteria are not inferred.

October 11 reconciliation: the blank form below is the historical run template,
not evidence that later work never happened. The owner has reported a satisfactory
real iPhone gallery/Back, wallet/profile reload, tab-switch and lock/resume run;
reuse the dated entry in `PHASE_A_DEVICE_ACCEPTANCE_SHEET.md`. Native OAuth return,
explicit disconnect and unrecorded wallet/device details are not implied by it.
Android block D is OWNER-WAIVED / NOT TESTED by the founder and must not be asked
again or counted as PASS. RG-03's paired setup/replacement and passkey acceptance
and the live moderation journeys are separately completed in the October 11
moderation evidence record; the remaining RG-01 evidence is not a reason to
repeat those ceremonies or disable the already-authorized features.

October 12 owner-reported supplement (Warsaw date; October 11 UTC): the founder
completed the requested Safari/iPhone logout and reconnect/sign-in with the old
wallet ending 989b, then relinked Discord from Edit Profile and returned to the
apex. Both returns retained the correct nickname, avatar and Discord identity.
The native Admin passkey flow also succeeded using the existing Chrome/Google
provider; server last-use metadata corroborates the owner report. No factor was
replaced. See the dated row in `PHASE_A_DEVICE_ACCEPTANCE_SHEET.md`.

| Later acceptance item | Result | Evidence boundary |
| --- | --- | --- |
| C7: iPhone Discord return and displayed linked identity | PASS — owner reported | Actual Safari/apex flow; not a provider fixture |
| iPhone site logout/reconnect/sign-in and resulting profile identity | PASS — owner reported for the requested flow | Wallet suffix 989b; exact wallet/OS versions and the signature dialog were not captured |
| Native staff verification on iPhone | PASS — owner reported, server last use corroborated | Existing credential; no full 24-hour expiry or specific changed-IP claim |

October 12 desktop continuation (October 11, approximately 22:35–22:40 UTC):
ordinary installed Chrome, apex release `acf9e01`, existing owner wallet suffix
989b. This is an agent-operated UI flow in the owner's existing browser session,
not a second independent wallet or an OAuth fixture. Discord was disconnected,
the editor immediately showed "Discord account removed" and Link Discord, then
the existing identity-only authorization returned to the apex with the same
verified Discord profile, nickname and avatar. X disconnection also updated the
editor immediately. The owner then pressed Authorize app in X's existing-account
screen. The callback returned to the apex with "X account linked successfully",
the original verified X profile, Discord, nickname and avatar. Both original
links are restored. No other profile fields, email, roles or factors changed.
Final screenshot: `output/audit/rg01-providers-restored-2026-10-12.png`. The
account menu subsequently showed a numeric Base Sepolia balance (desktop-only
A-73 evidence). OAuth state, codes and session cookies were not exported.

| Desktop item | Result | Evidence boundary |
| --- | --- | --- |
| C1 / C2: Discord apex return and linked handle | PASS | Actual provider consent and callback, correct existing profile restored |
| C3: Discord unlink | PASS | Removed state and reconnect control appeared without saving other profile fields |
| C6: X unlink | PASS | Removed state and reconnect control appeared; original link restored afterwards |
| C4 / C5: X apex return and linked handle | PASS | Owner confirmed the provider screen; agent observed the apex callback and original verified profile |

This supplements the historical template, rather than marking every block as
passed. All block C outcomes are now recorded. Guest persistence after
reload before reconnecting, and any other unasked device criteria need their own
evidence. Do not ask the owner to repeat the newly passed flows wholesale.

Fill this file in as the run happens. It is the evidence RG-01 closes on, and it
retains its own device/OAuth acceptance requirements for Phase A close-out.

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
