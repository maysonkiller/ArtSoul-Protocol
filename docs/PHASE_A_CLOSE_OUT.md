# Phase A Close-Out

Updated: 2026-09-27. Local work is in `C:\Projects\ArtSoul`; see
[workspace reconciliation](WORKSPACE.md) and the [current checkpoint](audits/STABILIZATION_CHECKPOINT.md).

One page answering one question: what is left before Phase A can close, and who
can do each piece. It is a view of [`BACKLOG.md`](BACKLOG.md) and
[`RESOURCE_GATED_WORK.md`](RESOURCE_GATED_WORK.md), never a second opinion; if
they disagree with this file, they win and this file is stale.

Phase A stands at **62 done, 21 in progress, 0 planned** across A-01 to A-83.

## The shape of what is left

Phase A remains **NO-GO** until A8/A10 acceptance is evidenced. The moderation
chain - A-39, A-21, A-22, A-23 - has merged code, but activation and real operator
acceptance remain outstanding. A read-only production check on 2026-09-23 returned
`reportingEnabled: false`; it does not reveal or certify the migration ledger.

Local PostgreSQL rehearsals now pass all 46 checks across seven integration
suites, with no Docker skips. They validate SQL/RPC behavior, not production
activation, real passkey ceremonies or Safe signatures. The Base Sepolia indexer
also returned healthy with zero lag in that dated read-only snapshot. Neither
observation deploys the current profile, AI and auction patches.

A-34's presentation shell and A-35's runtime boundary map are complete locally.
They do not activate aura eligibility or the dormant Express server. Remaining
work separates into dependency CI/rollout acceptance, production/operator steps and connected
device acceptance, as listed below.

## 1. Founder gates - nothing ships past these

These are the phase. Each is blocked on something no code change can supply.

| Gate | What is missing | Why it cannot be delegated |
| --- | --- | --- |
| **RG-01** apex-origin acceptance | Two operators completing [`testnet/RG01_APEX_ORIGIN_SMOKE_CHECKLIST.md`](testnet/RG01_APEX_ORIGIN_SMOKE_CHECKLIST.md), including an iOS run | Wallet sessions and SIWE are origin-scoped and need real devices and real wallets |
| **RG-03** → **A-39** moderation activation | Ordered migrations, archived verification output, two founder passkeys, the one-time audited bootstrap grant | Credentials and a multisig-authorised ceremony; canon rule 12 forbids a single operator deciding it |
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

**A-21, A-22 and A-23 close behind A-39.** Their code is merged; they are waiting
on the same activation, and A-23 stays NO-GO until every gate above is evidenced
and no P1 issue is open.

## 2. Implementation and acceptance still open

Ordered by what the founder can feel, not by row number.

| Row | What it is | Note |
| --- | --- | --- |
| **A-64** | Accept deferred wallet runtime on connected devices | The deferred loader and hidden-tab timer fallback are implemented in the current source. The old static-SDK diagnosis is historical, not the current implementation. Connect, sign in, switch network and publish still need a real connected run on Android and iOS |
| **A-47** | Keep artwork loading continuous and shorten the exact-artwork path | PR #233 is merged after revised iOS preview acceptance and desktop/Android/tablet browser verification. A later cold-import audit isolated the exact public projection from the shared all-routes serverless graph without changing live-state caching, and the exact response now carries Creator identity before the first content frame instead of briefly showing a generated avatar. Preview proof plus production desktop, iOS, Android and legacy-video timing remain open evidence |
| **A-58** | Remove synthetic cards from the first uncached profile-tab load | Reopened by iOS evidence: `display: contents` bypassed the skeleton wrapper's opacity. The repair keeps the panel mounted and uses only the existing compact status |
| **A-61** | Commit the large profile avatar only after its frame is decoded | Reopened by contradictory iOS evidence: unlike the already-protected header avatar, the profile hero inserted the original multi-megabyte upload directly into visible DOM and exposed a partially decoded strip |
| **A-54** | Release profile identity before gallery data | The static shell removed empty frames but remained visible for 3-4 seconds because profile identity, Genesis state and up to 200 artworks shared one completion gate. The revised repair head-prefetches a narrow public profile read and commits identity first; the gallery retains the compact A-58 loading status instead of synthetic cards |
| **A-48** | The single full-document repaint on browser Back | Diagnosed and the code side is complete: every shared card image path defers. What remains is one measurement in an ordinary Chrome, reduced to two navigations and three console lines in [`testnet/A48_BACK_NAVIGATION_PROBE.md`](testnet/A48_BACK_NAVIGATION_PROBE.md). An embedded browser view cannot answer it |
| **A-53** | The identity settle gap between header and profile | Never reproduced on a device |
| **A-33** | Artwork-page acceptance sweep | Verification work, doable in a browser |
| **A-38** | Accept the bounded dependency and warning fixes | Local triage, clean install, 1227 combined tests with no skips, 33 contract tests and build passed. Root Ethers/ws/Axios paths, CI action pins and Reown font preloads are repaired. Hosted CI/deployed acceptance remains; 58 residual package findings are explicitly classified, not waived. See [dependency review](audits/DEPENDENCY_TRIAGE_2026-09-23.md) |
| **A-79** | Bound the profile's opening gallery read | Decided and shipped: one screenful first, the rest behind the frame, identity still committed on the narrow read. Needs one profile load on a device |
| **A-57**, **A-59** | Wallet capability limits; in-wallet account switch | Both need masked device evidence first, and both may end as documented wallet limitations rather than defects |

## 2a. All the device acceptance, in five trips

Sixteen rows below are code-complete and waiting on the same thing: somebody
using the site on a real device. Run row by row and that is sixteen sessions.
[`testnet/PHASE_A_DEVICE_ACCEPTANCE_SHEET.md`](testnet/PHASE_A_DEVICE_ACCEPTANCE_SHEET.md)
organises them by trip instead - arrive cold, connect, publish, settle, and the
two wallet questions - because most of these rows are watching the same screens
for different things. It is five sessions per device, and it carries the result
table.

## 3. Waiting only on a look

Merged and measured, needing one confirmation each:

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
