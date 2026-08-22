# Phase A Close-Out

Recorded: 2026-08-22

One page answering one question: what is left before Phase A can close, and who
can do each piece. It is a view of [`BACKLOG.md`](BACKLOG.md) and
[`RESOURCE_GATED_WORK.md`](RESOURCE_GATED_WORK.md), never a second opinion; if
they disagree with this file, they win and this file is stale.

Phase A stands at **57 done, 10 in progress, 7 planned** across A-01 to A-74.

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
| Acceptance on a real device | the founder | 3 |

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
| **A-64** | Take the wallet SDK off the first-load critical path | 504 KB across 129 files, downloaded by every visitor whether or not they ever connect. It is the only remaining change that shortens the wait itself, and it is the cause behind both the placeholder people still see and the font arriving late. Needs one connected run - connect, sign in, switch network, publish - before it can be merged on anything but test evidence |
| **A-47** | Reduce head asset weight | Largely subsumed by A-64; reassess after it |
| **A-48** | The single full-document repaint on browser Back | Diagnosis not started |
| **A-53** | The identity settle gap between header and profile | Never reproduced on a device |
| **A-33** | Artwork-page acceptance sweep | Verification work, doable in a browser |
| **A-34** | One reusable presentation-only aura frame shell | Canon 17; no economics |
| **A-35** | Legacy runtime boundaries, second half | The migration ledger half is done |
| **A-38** | Dependency and production warning triage | No forced upgrades |
| **A-57**, **A-59** | Wallet capability limits; in-wallet account switch | Both need masked device evidence first, and both may end as documented wallet limitations rather than defects |

## 3. Waiting only on a look

Merged and measured, needing one confirmation each:

- **A-71** the ArtSoul mark, not a skeleton, after publishing
- **A-72** quick loads showing no placeholder at all
- **A-73** the balance in the account menu showing a number

## What Phase A does not need

Recorded because it keeps coming up. Phase A does not need a mainnet deployment,
a token, verified user metrics, or Genesis. Canon rules 4, 5 and 10 stand
unchanged, and no claim of any of those may appear in progress reports or grant
material.
