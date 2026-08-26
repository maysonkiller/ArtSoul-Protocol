# Phase A Close-Out

Recorded: 2026-08-23

One page answering one question: what is left before Phase A can close, and who
can do each piece. It is a view of [`BACKLOG.md`](BACKLOG.md) and
[`RESOURCE_GATED_WORK.md`](RESOURCE_GATED_WORK.md), never a second opinion; if
they disagree with this file, they win and this file is stale.

Phase A stands at **56 done, 16 in progress, 5 planned** across A-01 to A-77.

## The shape of what is left

The moderation chain that gates the phase - A-39, A-21, A-22, A-23 - is **built
and merged**. Every part of it sits behind a disabled feature flag with its
migration unapplied. Nothing further is written for it; what remains is an
activation ceremony, and that cannot be performed by an engineer working from
this repository.

So the remaining work divides cleanly:

| | who | count |
| --- | --- | ---: |
| Engineering, in this repository | anyone working here | 9 |
| Operator ceremony and outside resources | the founder | 4 gates |
| Acceptance on a real device | the founder | 4 |

## 1. Founder gates - nothing ships past these

These are the phase. Each is blocked on something no code change can supply.

| Gate | What is missing | Why it cannot be delegated |
| --- | --- | --- |
| **RG-01** apex-origin acceptance | Two operators completing [`testnet/RG01_APEX_ORIGIN_SMOKE_CHECKLIST.md`](testnet/RG01_APEX_ORIGIN_SMOKE_CHECKLIST.md), including an iOS run | Wallet sessions and SIWE are origin-scoped and need real devices and real wallets |
| **RG-02** project mailbox | A monitored mailbox for general, security and copyright contact, with a retention procedure | An outside service and a person who reads it |
| **RG-03** → **A-39** moderation activation | Ordered migrations, archived verification output, two founder passkeys, the one-time audited bootstrap grant | Credentials and a multisig-authorised ceremony; canon rule 12 forbids a single operator deciding it |
| **A8d** Safe recovery rehearsal | The successful ceremony plus all eleven denial cases in [`runbooks/A8D_SAFE_RECOVERY.md`](runbooks/A8D_SAFE_RECOVERY.md) section 6 | Signing keys held by three people |

The sequence is already written down and must not be improvised: the ordered
migration steps and their backup discipline are in
[`security/MIGRATION_RUNBOOK.md`](security/MIGRATION_RUNBOOK.md) under **A8
Moderation Activation**, and the surrounding rollout in
[`runbooks/A8_MODERATION_ROLLOUT.md`](runbooks/A8_MODERATION_ROLLOUT.md).

**A-21, A-22 and A-23 close behind A-39.** Their code is merged; they are waiting
on the same activation, and A-23 stays NO-GO until every gate above is evidenced
and no P1 issue is open.

## 2. Engineering that remains

Ordered by what the founder can feel, not by row number.

| Row | What it is | Note |
| --- | --- | --- |
| **A-64** | Take the wallet SDK off the first-load critical path | Implemented behind a preview gate: all seven shared-header pages now mount and paint before dynamically importing the unchanged wallet runtime. The build manifest no longer makes AppKit a static dependency of the profile or homepage. The audit then closed an early-action race: the boundary now waits for AppKit boot, not merely module evaluation, before delegating a wallet action or announcing readiness. Needs connected desktop, Android and iOS runs covering cached reload, reconnect, SIWE, Base Sepolia switching and publish before merge |
| **A-47** | Keep artwork loading continuous and shorten the exact-artwork path | PR #233 is merged after revised iOS preview acceptance and desktop/Android/tablet browser verification. Production measurements put primary content at 0.7-2.4 seconds and video readiness at 1.6-3.2 seconds; production Android and the legacy-video tail remain open evidence |
| **A-58** | Remove synthetic cards from the first uncached profile-tab load | Reopened by iOS evidence: `display: contents` bypassed the skeleton wrapper's opacity. The repair keeps the panel mounted and uses only the existing compact status |
| **A-61** | Commit the large profile avatar only after its frame is decoded | Reopened by contradictory iOS evidence: unlike the already-protected header avatar, the profile hero inserted the original multi-megabyte upload directly into visible DOM and exposed a partially decoded strip |
| **A-54** | Release profile identity before gallery data | The static shell removed empty frames but remained visible for 3-4 seconds because profile identity, Genesis state and up to 200 artworks shared one completion gate. The revised repair head-prefetches a narrow public profile read and commits identity first; the gallery retains the compact A-58 loading status instead of synthetic cards |
| **A-48** | The single full-document repaint on browser Back | Diagnosis not started |
| **A-53** | The identity settle gap between header and profile | Never reproduced on a device |
| **A-33** | Artwork-page acceptance sweep | Verification work, doable in a browser |
| **A-34** | One reusable presentation-only aura frame shell | Canon 17; no economics |
| **A-35** | Legacy runtime boundaries, second half | The migration ledger half is done |
| **A-38** | Dependency and production warning triage | No forced upgrades |
| **A-57**, **A-59** | Wallet capability limits; in-wallet account switch | Both need masked device evidence first, and both may end as documented wallet limitations rather than defects |

## 3. Waiting only on a look

Implemented and measured, needing one confirmation each:

- **A-71** the ArtSoul mark, not a skeleton, after publishing
- **A-72** quick loads showing no placeholder at all
- **A-73** the balance in the account menu showing a number
- **A-77** card posters and Play controls on desktop, Android and iOS, with no media request before interaction

## What Phase A does not need

Recorded because it keeps coming up. Phase A does not need a mainnet deployment,
a token, verified user metrics, or Genesis. Canon rules 4, 5 and 10 stand
unchanged, and no claim of any of those may appear in progress reports or grant
material.
