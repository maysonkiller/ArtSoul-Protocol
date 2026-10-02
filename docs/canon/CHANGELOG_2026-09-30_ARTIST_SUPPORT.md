# Artist support implementation scheduling — 2026-09-30

Historical decision record: the message minimum and its setter below are
superseded by `CHANGELOG_2026-10-03_PHASE_A_ACTIVATION.md`. Other preserved
mechanics remain applicable.

Authority: the founder's September 30 desktop follow-up explicitly requests the
Donate contract and usable interface now. This supersedes the earlier Phase C
implementation-only scheduling in `SUPPORT_THE_ARTIST_DESIGN.md`; it does not
authorize mainnet deployment or change auction economics.

## Preserved mechanics

- Support is voluntary native ETH for a specific registered artwork, pre-mint or
  minted. The immutable configured Core resolves its canonical creator.
- The caller-supplied creator must match that resolver. The full value is sent
  immediately; forwarding failure reverts the whole operation. No custody,
  donation history, protocol fee, treasury revenue or refund mechanism is added.
- Donations have no effect on Trust, discovery, ownership, floor, royalties,
  settlement, contests or eligibility. Anonymous labels do not conceal on-chain
  transactions. Messages are plain text and never linkified.
- The approved configurable message minimum remains an explicit deployment input
  with the existing proposed rehearsal value of `0.0005 ETH`; reconfirm it before
  deployment. Empty messages require only a non-zero donation.

## Bounded implementation decisions

1. Add a separate non-upgradeable `ArtSoulDonations` contract. Existing deployed
   Core/NFT storage and code remain unchanged. The future four-contract topology
   gains this separate optional fifth contract; deployment inventory is not
   changed merely by adding source code.
2. Use the existing Core `artworks` getter as the immutable creator resolver.
   Deployment preflight must verify its chain, bytecode and interface, and verify
   the configured administration Safe and its ownership/threshold. An address
   containing code alone is not evidence that it is a correctly configured Safe.
3. Reuse two-step ownership, reentrancy protection and pause controls. Administration
   can change the message minimum or pause support, never substitute a recipient
   or withdraw someone else's donation.
   The minimum is strictly positive; zero is rejected rather than silently
   disabling the approved message spam threshold. Pausing is the explicit stop
   control. This interpretation is recorded for review before deployment.
4. Bound a message to **560 valid UTF-8 bytes on-chain**. This is a resource limit,
   not a claim that bytes equal characters. The interface and public projection
   additionally enforce **140 Unicode grapheme clusters**, using the platform's
   `Intl.Segmenter`. Messages outside either display limit are not publicly
   rendered by ArtSoul. Raw valid events remain on-chain and attributable; a
   client cannot bypass the UI character policy through a direct transaction.
5. Project events with chain/contract/transaction/log identity and bounded cached
   reads. Reorgs, anonymous display, ordering, and complaint-driven message hiding
   require their own tests before the feature is activated.

## Status and rollback

Approved direction and local implementation scheduling: recorded here.
Implemented/tested/deployed: consult the current checkpoint; this amendment is
not completion evidence. No contract has been deployed by this document.

Before activation, rollback is removal of the isolated implementation and its
inactive configuration. After a testnet deployment, disable the UI/configuration
and pause the separate contract through its configured Safe; historical successful
donations remain irreversible. No auction contract rollback is needed.

Touches Bible §§6, 11, 14, 17; the artist-support design; and the contract rework
plan Part 2. Mainnet readiness, independent review and final deployment approval
remain separate from implementation.
