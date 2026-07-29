# Support the Artist — Phase C Design

Status: founder-decided feature design; documentation only; no current implementation.

Phase: C — Mainnet Preparation, together with the final contract rework, test, Base Sepolia rehearsal, and security-review cycle.

This document records the approved product direction without displacing Phase A stabilization. Before Solidity work begins, the Canon Bible and `CONTRACT_REWORK_PLAN.md` must receive a dated consolidation because this feature adds a separate contract to the currently proposed four-contract topology.

## Product Purpose

`Support the artist` lets a collector voluntarily send native ETH to the creator of a specific artwork. It is available for both registered pre-mint artworks and minted NFTs.

Support is:

- voluntary, irreversible, and non-refundable;
- social support only;
- never consideration for an artwork, service, protocol right, reward, ranking advantage, or other benefit;
- routed in full to the canonical creator;
- separate from ProtocolTreasury, EcosystemTreasury, company operating capital, auction settlement, and marketplace payments.

Donations never affect Trust, discovery ordering, floor, price, ownership, provenance roles, settlement, royalties, auction state, public metrics used for those systems, or any other protocol outcome.

## Artwork-Page Experience

A compact `Support the artist` button opens a modal containing:

- the connected wallet balance, using the existing balance read with no new polling;
- the amount field;
- an optional plain-text message limited to 140 user-visible characters;
- an `Anonymous on ArtSoul` option;
- the recipient profile name when available and the raw creator address in every case;
- a wallet confirmation step;
- a clear notice that support is voluntary, irreversible, non-refundable, and provides no protocol benefit.

The anonymous notice must also state that the donor address remains publicly visible on-chain. Anonymity changes only the ArtSoul display label.

Under the button, the artwork page shows one compact line for the largest successful donation:

- donor profile name when available, otherwise a shortened address linked to the donor profile;
- `Anonymous` when the on-site anonymity flag was selected;
- amount;
- no message.

`View all` opens a panel or tab with donor label, amount, optional visible message, and event time. The list supports a newest-first view and an amount-sorted view. Indexed block and log ordering provides deterministic ordering for equal values.

## Why a Contract Is Required

A plain native-ETH transfer does not emit an application event and carries no trustworthy artwork identifier. Discovering such transfers would require transaction scanning rather than the existing `eth_getLogs` indexer path, would consume additional RPC resources, and still could not establish which artwork the sender intended to support.

If donations are displayed, Phase C therefore adds a minimal event-only donations contract. The proposed external shape is:

```solidity
function donate(
    address creator,
    uint256 artworkId,
    string calldata message,
    bool anonymous
) external payable;
```

On success it emits:

```solidity
event Donation(
    address indexed donor,
    address indexed creator,
    uint256 indexed artworkId,
    uint256 amount,
    string message,
    bool anonymous
);
```

The contract must:

- require a non-zero donation;
- resolve the artwork through the canonical Phase C artwork/Core interface and verify that `creator` is the registered creator for `artworkId`; a caller-supplied recipient is never trusted by itself;
- support registered pre-mint works as well as minted NFTs through the same canonical artwork identity;
- forward the full value to the verified creator immediately;
- take no protocol fee and retain no donation balance or donation-history storage;
- revert the entire donation if forwarding fails, so no value becomes trapped and no misleading event is emitted;
- emit the event only after a successful transfer;
- follow OpenZeppelin and checks-effects-interactions/reentrancy-safe patterns;
- expose only the smallest Safe-controlled administration surface needed for the message threshold;
- operate only under the canonical Base write policy. Base Sepolia `84532` is the rehearsal/testnet chain; Base is the production chain.

The exact UTF-8 byte ceiling used to enforce the approved 140 user-visible-character limit in Solidity must be fixed during C-06 architecture sign-off. Solidity byte length must not be silently presented as a user-visible character count.

## Message Floor And Abuse Controls

The primary spam defense is economic:

- a donation with a non-empty message must meet a configurable native-ETH threshold;
- the initial rehearsal value is `0.0005 ETH`, approximately USD 1 at the reference ETH price used on 2026-07-26;
- this is not an on-chain USD peg;
- no price oracle is added;
- the founder reconfirms the value against the then-current ETH price before deployment;
- a Safe-controlled administrator can adjust the threshold without redeployment;
- an empty-message donation is not subject to the message threshold, but must still be non-zero.

Messages are plain text only. ArtSoul never renders their content as HTML or markup and never makes message links clickable.

Staff may hide a donation message from ArtSoul through the existing complaint-driven moderation system. Hiding affects only the on-site message display: the donation, donor, recipient, amount, anonymity flag, and raw event remain immutable and publicly inspectable on-chain. A donation itself is never deleted or reversed by moderation.

## Indexer And API Shape

The final contract address is added to the existing bounded event filter. The indexer projects immutable donation events into a chain-scoped donations table and records moderation visibility separately.

Public reads follow the existing cached projection pattern:

- no browser RPC;
- no per-card or per-donation fan-out;
- no per-visitor polling;
- no transaction-history scanning;
- no runtime full-table aggregation for the compact top-donation line.

Reorg rollback, idempotency, chain scope, event identity, moderation state, top-donation selection, and both list orders require focused tests in the Phase C indexer/database cycle.

## Explicit Exclusions

This feature does not add:

- donations to ProtocolTreasury, EcosystemTreasury, a company wallet, or a general project-development wallet;
- custody, escrow, refunds, subscriptions, donor rewards, badges, points, tokens, airdrops, or fee privileges;
- donation-based Trust, discovery, contest, ranking, floor, price, provenance, or settlement mechanics;
- a Phase B or standalone early contract;
- a non-Base deployment.

## Founder Decisions Recorded

- On-site anonymous display: approved.
- Message threshold: configurable, initially `0.0005 ETH`, with deploy-time reconfirmation and no oracle.
- Delivery phase: Phase C with the full contract rework; no Phase B version.
- Creator routing: 100% of each successful donation, with no protocol cut or custody.

## Required Canon Consolidation Before Implementation

The following architecture touchpoints are queued rather than changed silently:

1. Canon Bible section 6 — explicitly preserve Trust and discovery neutrality.
2. Canon Bible section 11 and `07_ADMIN_MODERATION_CANON.md` — extend complaint-driven UI moderation to donation-message visibility only.
3. Canon Bible section 14 and `14_PROTOCOL_REVENUE_AND_TEAM.md` — state that creator donations bypass both protocol treasuries and company operating capital and are not protocol revenue.
4. Canon Bible section 17 and `CONTRACT_REWORK_PLAN.md` Part 2 — place the work in Phase C and reconcile the additional minimal donations contract with the current four-contract target topology.
5. `12_IMPLEMENTATION_BACKLOG.md` Phase C — schedule contract, indexer, API, moderation, test, rehearsal, and audit work only after architecture sign-off.
