# Phase A device acceptance — one sheet, five trips

**October 11 founder scope amendment:** Android is **OWNER-WAIVED / NOT TESTED**
for the current Phase A close-out. No further Android run is required. This
supersedes the Android portions of the earlier checklist below without changing
its historical evidence. It is not an Android PASS or a compatibility claim.
Desktop and iOS retain their own criteria; do not repeat the owner's satisfactory
iPhone trip without a specific unresolved outcome.

Four backlog rows remain for device observations, recovery evidence or historical
defect disposition: A-48, A-57, A-71 and A-83. Their implementation is published; failed
acceptance may still require a fix. Group the checks into five trips because
most rows are watching the same screens for different things.

This sheet is organised by trip. Each trip says what to do, what to watch, and
which rows its answers close. Record the result here, dated, per device. An
owner-reported run is evidence of the outcomes actually asked about; label it
as owner-reported and do not infer unasked OAuth, transaction or device results.

**October 23 native visual acceptance:** asked specifically whether whole-page
or empty-card flicker, delayed names/avatars or wrong lists on profile-tab
switching remained in the already completed iPhone run, the owner reports that
these problems are no longer observed. This closes the outstanding qualitative
native outcomes for A-47/A-53/A-54/A-58/A-61/A-72 together with their published
repairs, prior desktop measurements/traces and regression evidence. It is not
a new cold-load timing benchmark, captured browser trace or repeated sign-in.
Do not repeat these visual checks. The historical trip checklists below remain
the record of their criteria, not a request to rerun accepted steps. The reply
does not establish native BFCache, A-71's immediate post-publication frame or
A-83's deliberate receipt-delay recovery; those remain separate. Android stays
owner-waived / not tested. A-23 is the later beta decision, and the additional
TA-10 exact-file restriction remains open independently.

**October 22 native publication acceptance:** the owner confirms successful
iPhone Chrome/MetaMask registration and auction creation after PR #325, and
provides an actual X post showing the correct image, title, creator, price and
testnet label. Read-only verification through both Base and PublicNode agrees:
artwork 36 / auction 70, successful receipts and matching indexer provenance.
See the current checkpoint for hashes and verifier. With the earlier recorded
connection/network and resale outcomes, A-33/A-64/A-78 are accepted. Do not repeat
publication or X sharing. The immediate publishing wait frame (A-71), deliberate
receipt-delay recovery (A-83), native modal geometry and BFCache are not inferred
from this success or screenshot. In a subsequent explicit iPhone check the
owner confirms both Donate and Report fit the screen and closing them leaves
the page, logo and wallet button in place without stretching. Native modal
geometry is therefore accepted separately; no form or donation was submitted
as part of that geometry check.

October 8 owner follow-up: asked about the previous iPhone gallery/detail/Back,
wallet/profile reload, tab switching and lock/resume run, the owner reported
that it had already been done and appeared to work well. Record this as a
qualitative owner observation; do not ask for the same entire trip again without
a specific unresolved symptom. The reply did not identify an Android run,
timestamps, individual OAuth outcomes or a native staff-factor ceremony, so it
does not supply those missing evidence fields.

October 12 owner clarification (iPhone Admin): after cancelling Verify passkey,
only Staff access / the team and Verify admin access were visible, not complaint
contents. Record the protected workspace as locked in this owner observation.
The authority roster is intentionally independent under canon 07; this is not an
observed authentication bypass. The ambiguous locked-page heading was clarified
locally and cancel paths were regression-tested. Do not infer successful native
iPhone passkey verification, actual network-context expiry or a captured protected
API response from this report, and do not reset an existing factor just because
the device displayed a cross-device QR choice. See the current checkpoint for
test and publication status.

The owner subsequently found the existing ArtSoul passkey in Chrome on iPhone,
enabled Chrome as a passkey provider and reported successful Safari Admin entry:
the review queue appeared after verification. A read-only server observation at
22:28:36 UTC on October 11 (October 12 Warsaw) confirms the same single active
credential, created October 8, with last use advanced from 20:46:35 to 22:28:04 UTC.
No factor reset, enrollment or role change occurred. This corroborates the
owner-reported native phone entry; the agent did not capture Safari traffic or
the biometric prompt. Provider metadata is a usability hint, not an additional
authorization factor. The earlier locked roster and subsequent successful
verification are distinct states. Full 24-hour expiry and a specific changed-IP
ceremony are not inferred. Remaining SIWE/disconnect and Discord-return outcomes
were requested separately, without repeating gallery, purchase or passkey tests.
The owner then confirmed both requested steps passed: site logout and old-wallet
reconnect/sign-in, followed by Discord relink and return to the apex, with the
correct nickname, avatar and Discord connection preserved. These phone flows
are no longer pending. Record the remaining unasked criteria separately.

**Where.** `https://artsoulprotocol.com` — the apex origin, not a preview and not
a `vercel.app` address. Wallet sessions and SIWE are origin-scoped, so evidence
from any other origin proves nothing about production.

**Current devices.** Desktop Chrome and iPhone (Safari). Android is owner-waived /
not tested under the amendment above. The iOS run
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

The desktop portion passed on September 27. Complete the outstanding real iOS
portion; Android is owner-waived / not tested. A navigation timing type alone
does not prove or disprove BFCache.

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

Accepted October 14: the actual owner Chrome/Rabby switch, correct profile and
reload passed with masked events; the owner confirmed no remaining stale-address
case in another currently used wallet. Do not repeat this acceptance. The probe
below is retained only for a specifically reproduced future regression.

Follow [`A59_ACCOUNT_SWITCH_PROBE.md`](A59_ACCOUNT_SWITCH_PROBE.md): connect,
switch account inside the wallet application, come back to the tab, read the
buffer. The four possible answers and what each implies are in that file.
Record which wallet produced which, since this was reported on more than one.

---

## Recording the result

Add a dated section below per device, naming the trip and the row. A row closes
only when its own criterion is met on the required devices. Older criteria that
name iOS *and* Android are subject to the October 11 Android waiver; desktop
alone does not establish iOS acceptance.

| Date | Device | Browser | Trip | Rows answered | Result |
| --- | --- | --- | --- | --- | --- |
| 2026-10-20 | Windows desktop; additional 390px layout check | Ordinary installed Chrome | Ownership repair on artwork 34, 30 and 19 | Desktop Ownership portions of A-47/A-61; A-33 three-role regression | PASS on published PR #312 (`bf6604d`): /34 renders complete standard avatars for confirmed absent profiles without their separate profile requests; /30 renders the existing nickname and decoded portrait; /19 preserves three distinct Creator, First Collector and Owner links. The remaining same-wallet public-profile read comes from the header. No horizontal overflow at 390px; no native iPhone acceptance, wallet signature or transaction is inferred. Evidence: `output/audit/ownership-apex-browser-2026-10-20.json`. The owner was asked only for the two repaired public artwork views on iPhone, without sign-in. |
| 2026-10-20 | iPhone | Owner's mobile browser; no new browser identification supplied | Ownership follow-up and guest-header reload | Scoped Ownership portion of A-47/A-61; separate header follow-up | Owner reports the repaired display looks good, then identifies a brief avatar-circle flash in the top-right account button when reloading as a never-connected guest. Ownership appearance is accepted for this scoped reply; the guest flash remains a separate repair/acceptance item. No wallet, OAuth, publishing or other profile-tab result is inferred. |
| 2026-10-20 | iPhone | Owner-reported continuation of the same guest reload scenario | Published PR #317 guest bitmap | Guest-header follow-up | Owner confirms the avatar is now good and separately reports whole-page flashing. Accept only the guest-avatar outcome; page continuity remains under investigation. No new login or publishing outcome is inferred. |
| 2026-10-20 | Desktop with mobile-width check | Isolated Chromium in-app browser, no connected wallet | Published guest-header source preservation, reload and account menu | Guest-header follow-up | PR #314 (`56b17ef`) serves bridge version 5 on all eight shared-header pages. After reload there is one complete 256px standard image displayed at 30px desktop / 29px mobile, the guest label/menu, and no horizontal overflow at a 390px browser width (375px content viewport). Final-state/geometry evidence: `output/audit/guest-header-apex-browser-2026-10-20.json`. First-frame instrumentation is unsupported in this browser, so this does not claim a native iPhone transient-paint PASS. The owner was asked only to reload the same guest page. |
| 2026-10-14 | Owner's actual iPhone | Existing phone browser; no newly supplied version | Account menu and network selection | A-73; current network-switch observation | OWNER-REPORTED PASS: numeric Base Sepolia balance is visible and switching works. Combined with the October 12 desktop balance, A-73 is accepted. No new phone run, wallet brand, masked provider error or historical Robinhood diagnosis is inferred. |
| 2026-10-14 (Warsaw; October 13 UTC) | Owner desktop; Rabby Wallet, suffixes 989b -> 1ccd | Ordinary installed Chrome | Native in-wallet switch; own-profile navigation/reload | Desktop A-59; distinct-wallet UI continuity | PASS: actual `accountsChanged` from both injected/AppKit providers; runtime and displayed profile became 1ccd without retaining the previous identity or works. Subsequent reload retained 1ccd. No agent signature, transaction or profile save. The mobile WalletConnect namespace path remains unobserved. See `A59_ACCOUNT_SWITCH_PROBE.md`; do not repeat the passed desktop switch. |
| 2026-10-14 (Warsaw; October 13 UTC) | Windows desktop; owner wallet suffix 989b before logout | Ordinary installed Chrome | Explicit site disconnect, Admin reload, Profile navigation/reload | RG-01 A7/A8 | PASS on `12f3e38`: guest header, no stale identity, directory or Edit Profile; Admin requires wallet verification. Owner confirmed setup complete before logout. No factor or role reset. Queue was already factor-locked, so active-factor revocation is not inferred. Evidence: `output/audit/rg01-desktop-logout-2026-10-14.json`. |
| 2026-09-27 | Windows desktop, Chrome 153.0.8010.53 | Ordinary installed Chrome; headed window for BFCache | Trip 1, partial | A-79; desktop portion of A-48 | Apex at release `81627ab`: opening creator read limit 24, identity before cards and full corpus, no settled-content reset. A-79 accepted. Headed Back restored the same marker with `pageshow.persisted=true`; A-48 phones remain open. See [release evidence](../audits/STABILIZATION_RELEASE_2026-09-27.md). |
| 2026-10-08 | Owner's actual iPhone | Safari was specified in the question; version not recorded | Gallery/detail/Back, wallet/profile reload, profile tabs, lock/resume | Owner-reported browsing/restore subset of trips 1–2 | Owner answered that the requested run had already been done and appeared to work well. Reuse this result; do not demand the whole trip again. This does not identify the wallet suffix, native OAuth returns, explicit disconnect, account-menu balance, a publish confirmation delay or BFCache instrumentation. |
| 2026-10-11 | Android | Not exercised for current close-out | All Android portions | Android portions of Phase A device gates | OWNER-WAIVED / NOT TESTED by explicit founder instruction. No Android PASS is inferred from iOS, desktop or automated layout checks. |
| 2026-10-12 (Warsaw; October 11 UTC) | Owner's actual iPhone; wallet suffix 989b | Safari with Chrome/Google passkey provider; exact OS/wallet-app versions not supplied | Staff verification; site logout/reconnect/sign-in; Discord relink/return | RG-01 mobile sign-in/profile continuity and C7; native staff entry | OWNER-REPORTED PASS for the requested flows. Locked team view did not expose complaints; the existing passkey then opened the queue. Server last use advanced to 22:28:04 UTC without new enrollment. Subsequent wallet and Discord returns retained the correct profile. No inferred publish, unsupported-network, account-switch or full 24-hour expiry result. |
| 2026-10-12 (Warsaw; October 11 UTC) | Windows desktop; existing owner wallet suffix 989b | Ordinary installed Chrome | Disconnect/reconnect Discord and X; account menu | RG-01 C1–C6; desktop portion of A-73 | PASS: both disconnect states updated immediately; both real provider callbacks returned to the apex with the original profile and verified handles. Owner confirmed X's authorization screen; the agent verified its return. Both original links restored, other profile fields unchanged. Account menu showed a numeric Base Sepolia balance. Same wallet as the phone, so this does not establish distinct-wallet isolation or mobile balance acceptance. Screenshot: `output/audit/rg01-providers-restored-2026-10-12.png`. |

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

RG-03 access setup/replacement is accepted under the October 8 paired-wallet
policy; historical Safe-only application recovery is superseded. Remaining live
moderation edges and A-23's go/no-go are separate from device browsing. They are in
[`PHASE_A_CLOSE_OUT.md`](../PHASE_A_CLOSE_OUT.md) with what each needs.

October 11 stopping instruction: the owner is unavailable and requested all
independent work followed by a stop. The unanswered Android and native-factor
questions stay pending; no repeated request or inferred PASS is recorded. Retain
the satisfactory iPhone observation above and ask only for missing outcomes when
the owner returns. Automated layout/SQL checks are saved in the dated moderation
acceptance record and do not fill phone rows.

Later October 11 amendment: the founder explicitly removed Android testing from
the remaining work. The earlier unanswered Android question above is therefore
superseded by OWNER-WAIVED / NOT TESTED, not by a test result. Other unresolved
device or factor outcomes remain separate.

October 11 evening reconciliation: the existing owner passkey was reverified,
live complaint edges completed, and the two reproduced Admin UI defects were
released and accepted on the apex through PR #298. Those are completed work,
not new phone prerequisites. The source recordings' saved September 30 analysis
documents pre-fix symptoms; it cannot certify the later repair on a real phone.
No video was reanalysed for this reconciliation.

October 12 superseding follow-up: the requested site logout/reconnect/sign-in,
Discord apex return and native staff entry now have owner-reported passes above.
Do not request them again as an entire trip. Subsequent October 14 evidence also
accepts the iPhone balance and current network switching. Remaining unrecorded
phone criteria include guest persistence after a reload before reconnecting,
connected publish/pending feedback and the specific visual restoration transitions.
The historical Robinhood failure stage remains unknown; the accepted desktop
Rabby switch is not a reason to repeat that flow.
Existing gallery/Back, profile reload, tab and lock/resume observations remain
valid. Do not invent wallet-app versions, missing timestamps or an Android result.

October 14 visual follow-up: the owner reports slow profile avatars and occasional
artwork-page flashing today on both iPhone and desktop. This is new symptom
evidence, not a confirmed cause or acceptance of the remaining transient visual
criteria. Investigate the current source and requests before another phone trip;
do not convert the earlier qualitative satisfactory run into a blanket pass.
