# Support the Artist Consolidation — 2026-09-16

Authority: founder decision recorded 2026-08-11 in [`SUPPORT_THE_ARTIST_DESIGN.md`](SUPPORT_THE_ARTIST_DESIGN.md) (PR #165), and the founder's instruction on 2026-09-15 to keep the feature in Phase C and prepare the canon consolidation that design requires before implementation.

This changelog adds no mechanic the design did not already approve. It writes the approved design into the documents that must carry it, so that Phase C can begin contract work without a canon conflict.

## Consolidated

| # | Document | What it now says |
| --- | --- | --- |
| 1 | Bible §6 | Donations never affect Trust, discovery ordering, contests, rankings, or the public metrics those use. |
| 2 | Bible §11 and `07_ADMIN_MODERATION_CANON.md` | Complaint-driven moderation may hide a donation message on ArtSoul's pages only. The donation and its event stay immutable; moderation never deletes, reverses or refunds one. Messages are plain text with no clickable links. |
| 3 | Bible §14 and `14_PROTOCOL_REVENUE_AND_TEAM.md` | A donation is not protocol revenue. It goes 100% to the canonical creator in the same transaction and bypasses both treasuries and company capital. No donation path to a treasury, company or project-development wallet exists. |
| 4 | Bible §17 and `CONTRACT_REWORK_PLAN.md` Part 2 | The feature is Phase C work with no Phase B version. The target topology is five contracts; the donations contract is the fifth, sits outside Core, holds no balance, and reads the creator from Core. |
| 5 | `12_IMPLEMENTATION_BACKLOG.md` Phase C | New item C16, scheduled only after C1 sign-off and covered by C7, C8, C11, C12 and C13. |

## Explicitly Not Canonized

- The donations contract's upgradeability. It is a C1 decision, listed as open question 11 in the rework plan.
- The exact UTF-8 byte ceiling behind the 140 user-visible-character message limit. Also C1.
- The message threshold's value. It is configurable, starts at the design's rehearsal value, uses no oracle, and is reconfirmed by the founder against the ETH price before deployment. It is not a frozen figure.
- The contract's final name. `ArtSoulSupport` is a working name.

## Unchanged

The frozen economics in Bible §3 are untouched: primary, resale and default splits, deposit, increment, durations and settlement. Donations are outside them entirely.
