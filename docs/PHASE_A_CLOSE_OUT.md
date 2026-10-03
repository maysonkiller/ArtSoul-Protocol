# Phase A Close-Out

Updated: 2026-10-03. Local work is in `C:\Projects\ArtSoul`; see
[workspace reconciliation](WORKSPACE.md) and the [current checkpoint](audits/STABILIZATION_CHECKPOINT.md).

One page answering one question: what is left before Phase A can close, and who
can do each piece. It is a view of [`BACKLOG.md`](BACKLOG.md) and
[`RESOURCE_GATED_WORK.md`](RESOURCE_GATED_WORK.md), never a second opinion; if
they disagree with this file, they win and this file is stale.

Phase A stands at **64 done, 19 in progress, 0 planned** across A-01 to A-83.

**Founder scheduling decision, October 3:** perform real passkey enrollment and
its operator recovery ceremony now. This supersedes the September 29 deferral;
the activation gates below remain required and are not represented as completed.
Real phone and OAuth evidence remain separate. See the
[exact amendment](canon/CHANGELOG_2026-10-03_PHASE_A_ACTIVATION.md).

September 29 execution evidence: eleven real Base Sepolia transactions now cover
resale purchase/listing/withdrawal and artwork 28's no-bid ending; three distinct
provenance roles were verified on the apex. Final application regression passed
1341 checks with no skips and the build passed. Portrait containment, card price,
profile network / Genesis and recipient notification corrections were published
through PR #282 at `9dcf82b`, with green candidate/post-merge CI and apex artifact
and profile acceptance. Separately authorized live
SIWE/Gemini/media/metadata verification passed all 13 steps. New artwork 34 /
auction 66 has two bids, and the losing bidder received its full deposit back.
The October 2 continuation ended and settled auction 66, minted token 6 with
floor 0.011 test ETH, and verified the creator's 0.010725 test ETH withdrawal.
Both-RPC accounting and eleven public apex browser checks passed. This closes
the bounded settlement rehearsal, not the remaining device/operator gates. See
[the evidence and limits](audits/PHASE_A_TESTNET_2026-09-29.md).

## The shape of what is left

Phase A remains **NO-GO** until A8/A10 acceptance is evidenced. The moderation
chain - A-39, A-21, A-22, A-23 - has merged foundations. A-22 recipient-facing
notification delivery is implemented, tested and published. The four dormant A8
schema migrations were applied and verified on September 30; real signed-in
notification reads now return 200 instead of the reproduced 503. The historical
database remains pre-ledger; no old migration entries were fabricated.
Real operator acceptance remains outstanding. PR #288 is deployed at
`1c55599bfabf848b41321a7452507dfec419c443`; candidate and post-merge CI passed.
Apex runtime checks confirm the passkey and email flags are enabled. Reporting,
Protocol Admin and Donate remain disabled. The October 2, 23:40 UTC read records
one authorized founder role and one unused bootstrap grant, but zero passkeys;
enabled routes and a grant do not prove enrollment or recovery. The corrected
email hosting route accepted one real verification request, and Resend reports
Delivered to the designated mailbox. Email-link confirmation remains unverified.
The separate Donate contract is deployed and verified on Base Sepolia; payments
and public activation still await indexer registration. See the
[current checkpoint](audits/STABILIZATION_CHECKPOINT.md) and
[schema evidence](audits/PHASE_A_A8_SCHEMA_2026-09-30.md).

The initial September 29 PostgreSQL baseline passed 46 checks across seven
integration suites. The final application run includes the additional 11-check
moderation journey: 57 checks across eight groups, with no Docker skips.
They validate SQL/RPC behavior, not production
activation, real passkey ceremonies or Safe signatures. The Base Sepolia indexer
also returned healthy with zero lag in that dated read-only snapshot. Neither
observation by itself proves deployment. The profile, AI and auction patches
were subsequently published through PR #280 at `81627ab`, after green CI and
preview checks; [apex acceptance](audits/STABILIZATION_RELEASE_2026-09-27.md) passed.

A-34's presentation shell and A-35's runtime boundary map are complete locally.
They do not activate aura eligibility or the dormant Express server. Remaining
work separates into residual dependency cleanup, production/operator steps and connected
device acceptance, as listed below.

## 1. Activation and acceptance requirements

Passkey/recovery setup is authorized now as recorded above. Code and regression
work continues; these ceremonies are not prerequisites for publishing independent
fixes. They still gate dependent live activation, and A10 requires a demonstrated
operationally safe reporting/moderation path before a beta GO.

| Gate | What is missing | Why it cannot be delegated |
| --- | --- | --- |
| **RG-01** apex-origin acceptance | Desktop and real iOS runs with distinct wallets/profiles, including SIWE and OAuth. The [dated acceptance form](testnet/RG01_APEX_ORIGIN_ACCEPTANCE_2026-09-04.md) permits one person to complete all blocks and record that honestly | Wallet sessions and SIWE are origin-scoped and need real devices and real wallets; separate Android rows still require Android |
| **RG-03** → **A-39** moderation activation | Dormant schema and verification are complete; two founder passkeys, the one-time audited bootstrap grant and live workflow acceptance remain open | Credentials and a multisig-authorised ceremony; canon rule 12 forbids a single operator deciding it |
| **A8d** Safe recovery rehearsal | The successful ceremony plus all eleven denial cases in [`runbooks/A8D_SAFE_RECOVERY.md`](runbooks/A8D_SAFE_RECOVERY.md) section 6 | Signing keys held by three people |

**RG-02 is not on this list, and was.** `RESOURCE_GATED_WORK.md` blocks RG-02
against **C14**, and RG-03's own completion clause does not mention it, so a
project mailbox gates Phase C rather than the moderation activation or Phase A
exit. It was listed here as a founder-owned item and read as a gate it is not.
It stays deferred, with private operational channels in use and no unmonitored
mailbox published.

The sequence is already written down and must not be improvised: the ordered
migration steps and their backup discipline are in
[`security/MIGRATION_RUNBOOK.md`](security/MIGRATION_RUNBOOK.md) under **A8
Moderation Activation**, and the surrounding rollout in
[`runbooks/A8_MODERATION_ROLLOUT.md`](runbooks/A8_MODERATION_ROLLOUT.md).

**A-21, A-22 and A-23 do not close from merged foundations alone.** A-22 also
needs real recipient-facing notification delivery acceptance following a staff decision; A-21 needs intake acceptance and
A-23 needs the recorded beta review. A-23 remains NO-GO while its required safe
operating path or evidence is missing, or a P1 issue remains open.

## 2. Implementation and acceptance still open

Ordered by what the founder can feel, not by row number.

| Row | What it is | Note |
| --- | --- | --- |
| **A-64** | Accept deferred wallet runtime on connected devices | The deferred loader and hidden-tab timer fallback are implemented in the current source. The old static-SDK diagnosis is historical, not the current implementation. Connect, sign in, switch network and publish still need a real connected run on Android and iOS |
| **A-47** | Keep artwork loading continuous and shorten the exact-artwork path | PR #233 is merged after revised iOS preview acceptance and desktop/Android/tablet browser verification. A later cold-import audit isolated the exact public projection from the shared all-routes serverless graph without changing live-state caching, and the exact response now carries Creator identity before the first content frame instead of briefly showing a generated avatar. Preview proof plus production desktop, iOS, Android and legacy-video timing remain open evidence |
| **A-58** | Remove synthetic cards from the first uncached profile-tab load | Reopened by iOS evidence: `display: contents` bypassed the skeleton wrapper's opacity. The repair keeps the panel mounted and uses only the existing compact status |
| **A-61** | Commit the large profile avatar only after its frame is decoded | Reopened by contradictory iOS evidence: unlike the already-protected header avatar, the profile hero inserted the original multi-megabyte upload directly into visible DOM and exposed a partially decoded strip |
| **A-54** | Release profile identity before gallery data | The static shell removed empty frames but remained visible for 3-4 seconds because profile identity, Genesis state and up to 200 artworks shared one completion gate. The revised repair head-prefetches a narrow public profile read and commits identity first; the gallery retains the compact A-58 loading status instead of synthetic cards |
| **A-48** | The single full-document repaint on browser Back | Ordinary headed desktop Chrome passed the apex [probe](testnet/A48_BACK_NAVIGATION_PROBE.md) on September 27: the marker survived and `pageshow.persisted` was true. iOS and Android acceptance remain open; navigation timing or desktop viewport emulation cannot replace them |
| **A-53** | The identity settle gap between header and profile | Reproduced in founder desktop and Android captures in August; the repair still needs production iOS/Android reload and navigation acceptance |
| **A-33** | Artwork-page acceptance sweep | Verification work, doable in a browser |
| **A-57**, **A-59** | Wallet capability limits; in-wallet account switch | Both need masked device evidence first, and both may end as documented wallet limitations rather than defects |

## 2a. All the device acceptance, in five trips

Fifteen rows remain for device and connected-flow acceptance after A-79 closed.
The underlying repairs, including the September 29 portrait/profile
corrections, are published. A failed acceptance may require another fix.
[`testnet/PHASE_A_DEVICE_ACCEPTANCE_SHEET.md`](testnet/PHASE_A_DEVICE_ACCEPTANCE_SHEET.md)
organises them by trip instead - arrive cold, connect, publish, settle, and the
two wallet questions - because most of these rows are watching the same screens
for different things. It is five sessions per device, and it carries the result
table.

## 3. Waiting only on a look

**A-38 accepted on September 27:** the bounded fixes passed candidate and
post-merge Linux/Windows CI and apex guest warning/font checks. The current audit
retains 64 affected package names, including six inherited parent-package findings
that explain the earlier 58-count report. This closes triage/rollout acceptance;
it does not close residual dependency cleanup or certify the protocol as secure.

**A-79 accepted on September 27:** the actual apex profile opened with 24 works,
committed identity first and loaded the remaining corpus without clearing settled
cards. This closes its one-device criterion; the separate mobile rows stay open.

Merged and measured, needing the device coverage specified in each backlog row:

- **A-71** the ArtSoul mark, not a skeleton, after publishing
- **A-72** quick loads showing no placeholder at all
- **A-73** the balance in the account menu showing a number

**A-78 reopened on 2026-09-06.** The active-first heuristic can target another
artwork's auction when two counters collide. The same ambiguity affects token
versus artwork resale inputs. Explicit identifier namespaces replace guessing;
connected-flow acceptance remains outstanding. See the backlog for current scope.

A-82 closed on 2026-09-14. The graceful-shutdown module no longer registers
a leave-site confirmation in the browser. The current explicit allowlist covers
unfinished artwork upload and unsaved collection authoring only; the latter was
added with the locally tested draft builder.

**A-77 closed on 2026-08-28.** The fix shipped to production and to the Hetzner
indexer, the backfill released all ten affected artworks, and artwork 31 was
auctioned again from the profile with the new auction confirmed on chain.

## What Phase A does not need

Recorded because it keeps coming up. Phase A does not need a mainnet deployment,
a token, verified user metrics, or Genesis. Canon rules 4, 5 and 10 stand
unchanged, and no claim of any of those may appear in progress reports or grant
material.
