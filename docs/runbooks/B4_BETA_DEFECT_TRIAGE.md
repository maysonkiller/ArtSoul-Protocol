# B-04 — what happens to a beta report after it arrives

The intake form already asks for everything a defect needs:
[`controlled-beta-bug.yml`](../../.github/ISSUE_TEMPLATE/controlled-beta-bug.yml)
requires steps, environment, expected, actual, reproducibility, a timestamp and
a recovery answer before it will submit. This file is the other half: what to do
with the issue once it exists.

Canon B3 gives the rule this whole process is built around.

> Do not mix protocol redesign into UI/UX defect fixes.

That is not a filing preference. A defect fix and a redesign need different
evidence, carry different risk, and belong to different phases. Merged together,
the redesign rides in on the defect's urgency and nobody reviews it as a
redesign.

---

## Gate 1 — is it a defect?

Ask one question: **does the thing work as it was built to work?**

| Answer | It is | Goes to |
| --- | --- | --- |
| No, it is broken or wrong | a defect | Gate 2 |
| Yes, and the reporter wants it different | a change request | [`controlled-beta-change-request.yml`](../../.github/ISSUE_TEMPLATE/controlled-beta-change-request.yml), then §Change requests |
| Yes, and the reporter misread it | a clarity problem | a defect, P3 — see below |

The third row matters more than it looks. If somebody reads a screen and draws
the wrong conclusion, the screen has a defect even though every number on it is
correct. That is a real fix with a bounded scope, and it is not a redesign.

**Close nothing at this gate.** A change request filed on the bug form is
re-filed, not dismissed: ask the reporter to use the other form, or convert it
yourself and say you did.

---

## Gate 2 — is it ours?

| It is | Signal | Response |
| --- | --- | --- |
| The wallet's limitation | the wallet cannot add a custom network, or never announces an account change | Record which wallet and what it did. Document it as a reach limit; it is not a defect to fix. A-57 and A-59 are both of this shape. |
| The network | Base Sepolia unreachable, or an RPC returning nothing | Check [`B3_INCIDENT_RESPONSE.md`](B3_INCIDENT_RESPONSE.md) first. If the site is in an incident, the report is a symptom of it and belongs to that incident. |
| Ours | anything else | Gate 3 |

A report that turns out not to be ours still gets an answer and a record. The
second person to hit the same wallet limitation should find the first person's
issue.

---

## Gate 3 — priority

The form asks the reporter to suggest one. Triage confirms it, and the form says
so, so changing it is expected rather than a correction.

| | Means | Timing |
| --- | --- | --- |
| **P1** | safety, authorization, economic truth, or a blocked core lifecycle: publish, auction, settlement, mint, resale | Before anything else. A-23 stays NO-GO while a P1 is open. |
| **P2** | a real defect with a safe workaround | Next, in order |
| **P3** | polish, clarity, or wording | Batched |

Two promotions to P1 regardless of what the reporter suggested:

- **Money or ownership displayed wrongly.** A price, floor, bid, deposit or role
  shown incorrectly is economic truth even when nothing on chain is wrong.
- **A message that would make somebody act wrongly.** A-83 is the worked
  example: a publish that said nothing had been sent, when the registration was
  already in flight, would have made people publish the same artwork twice.

---

## Gate 4 — evidence before a fix

The repository rule is that a backlog row closes on dated evidence that
satisfies its own acceptance criterion, never on a conversation saying it looked
fine. Applied here:

1. **Reproduce it, or say you could not.** An issue nobody reproduced can still
   be fixed, but the row must say the fix was accepted on reasoning rather than
   on a reproduction.
2. **Write the backlog row before the fix**, with the report linked as its
   source. The row states what would prove it fixed. Deciding that afterwards
   invites proving whatever happened to be true.
3. **One row, one branch, one pull request.** A second defect found while fixing
   the first gets its own row.
4. **Real-device claims need real-device evidence.** Wallet behaviour, back
   navigation and first-paint timing cannot be accepted from a preview or an
   embedded browser view.
5. **Close the issue with the row and the date**, so the reporter sees where
   their report went.

---

## Change requests

They are recorded, kept, and not built during the beta.

Fees, splits, bid increments, deposit sizes, auction durations and the
settlement window are frozen protocol architecture. The change-request form says
this on its face, so nobody spends effort writing one under the impression it
might ship next week.

Everything else — wording, layout, what is shown where — is not frozen, and a
change request about it is a genuine Phase C candidate. Label it and leave it.
The one thing not to do is fix it inside a defect branch because it was nearby.

**A change request never reopens acceptance.** If a row was accepted with dated
evidence and somebody now wants the behaviour different, that is new work with a
new row, not a reopening of the old one.

---

## Cohort tracking

Canon B1 asks for artists and collectors tracked through issues rather than
private chat-only notes, so that what a tester hit does not live only in a
direct message.

**Track the journeys, not the people.** A public issue naming who is testing,
with their wallet and their device, is a durable public record of a private
individual, and no beta needs one. An issue per journey — "publish to settlement,
iOS" — carries everything triage actually uses, and the reporter's identity
stays in the invitation channel.

Suggested labels, which do not exist yet and are the founder's to create:
`beta-defect`, `beta-change-request`, `beta-journey`, `wallet-limitation`.

---

## What this process is not

It is not a queue that must be empty. A beta with no open issues either has no
testers or is not being told the truth. What matters is that every open issue
has been through gate 1, so nothing is waiting to be fixed that was never a
defect.
