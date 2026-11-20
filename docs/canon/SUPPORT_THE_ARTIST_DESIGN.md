# Support the Artist — Phase C Design

## First Base mainnet release, November 19, 2026

At launch, a supporter can copy the original creator’s address from the profile and send native ETH on Base using their own wallet. The artwork’s Creator link identifies the recipient even after resale. The supporter checks the network, address, amount and gas in the wallet. The creator receives the amount sent and the supporter pays network gas. ArtSoul charges no fee. The wallet receipt identifies the recipient and amount. A plain transfer carries no ArtSoul artwork ID, so it creates no per-artwork history entry, message or donor ranking.

The ordinary-market release needs two new application contracts, the Core and its paired NFT. The first mainnet deployment omits the donation forwarder. In a local Hardhat fixture its deployment used 778,400 gas. Sending 0.01 ETH for work 1 to an existing externally owned account used 53,362 gas through the forwarder with an empty message, 55,701 with “Thank you”, and 21,000 for a direct transfer. A recipient with contract code can consume more. The actual Base fee also depends on execution and L1 data prices. [Base transaction fees](https://docs.base.org/specifications/transactions/network-fees)

At Base mainnet block 59,632,454, the execution gas price was 0.006 gwei. Using the local gas figures, conservative transaction sizes, the network's L1 fee upper estimate and its zero operator fee at that block gave approximately 0.000000131 ETH for a direct transfer, 0.000000331 ETH for an empty-message donation and 0.00000479 ETH for deployment. These estimates exclude the donation amount. [Reference block](https://basescan.org/block/59632454) · [Fee estimation](https://docs.base.org/specifications/transactions/network-fees)

The Base Sepolia prototype and its event-backed history remain available under the existing testnet configuration. Two controlled transfers of one wei each on work 34 exercised that history. This sample covers one work and does not establish demand for mainnet attribution. Revisit the forwarder if artists or collectors repeatedly request public proof of support for a particular work or an attached message. Before enabling it, rehearse the full event-to-history path and review the contract, indexer and moderation costs. [Hosted history check](../audits/B22_HISTORY_LAYOUT_2026-10-26.md) · [Ordinary-market release scope](17_ROADMAP_PHASES.md#what-needs-an-address)

For launch budgeting, the material cost decision is the additional independent review and maintenance of the forwarder. Obtain its incremental scope and quote alongside the required market review before making a spending decision. [Independent review scope](CONTRACT_REWORK_PLAN.md#independent-review-scope-for-the-first-base-release)

## Artwork-linked support on Base Sepolia

The following design applies to the Base Sepolia Donate flow and the optional replacement candidate. The September 30 amendment authorized the prototype. The October 3 amendment removed the message amount threshold. [Prototype decision](CHANGELOG_2026-09-30_ARTIST_SUPPORT.md) · [Amount amendment](CHANGELOG_2026-10-03_PHASE_A_ACTIVATION.md)

### Replacement ordinary-artwork pair, November 19, 2026

The local [OrdinaryArtDonations candidate](../../contracts/replacement/OrdinaryArtDonations.sol) reads the original creator from the bound engine's `works(artworkId)`. The prototype binding reads `artworks(artworkId)`. Both share the ETH forwarding, message validation, donation event and administration implementation. Each deployment fixes its registry at construction.

The [Hardhat integration suite](../../test/OrdinaryArtDonations.test.cjs) exercises a registered work before minting and a settled work whose NFT ID differs from its artwork ID. It verifies full creator payment, rejects mismatched recipients and unknown works, and replays the local donation receipt through the existing parser and Sepolia projection with a recording SQL client. A future artwork-linked release would need the reviewed engine, administration Safe, forwarder address and a persisted, correctly attributed history row during rehearsal.

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

The anonymous notice must also state that the donor address remains publicly visible on-chain. The `anonymous` flag applies exclusively to the donor's public label inside ArtSoul: ArtSoul donation views must not expose that donor's profile name or address, while the artwork identity, creator identity, and verified recipient remain unchanged and explicit.

October 15 UI amendment (owner's explicit artwork feedback): the largest-support
summary lives inside the explicitly opened donation-history panel, not as an
asynchronously inserted line below the public action buttons. History is fetched
when opened. This supersedes only the earlier inline placement; recipient,
contract behavior, amounts, anonymity and ranking neutrality are unchanged.
The history panel shows one compact line for the largest successful donation:

- donor profile name when available, otherwise a shortened address linked to the donor profile;
- `Anonymous` when the on-site anonymity flag was selected;
- amount;
- no message.

`View all` opens a panel or tab with donor label, amount, optional visible message, and event time. The list supports a newest-first view and an amount-sorted view. Indexed block and log ordering provides deterministic ordering for equal values.

## How a donation is linked to an artwork

A plain native-ETH transfer pays the receiving address. Its transaction hash proves the transfer, but if an artist has several works it cannot establish which one the donor meant to support. ArtSoul therefore leaves those transfers out of per-artwork history.

The Donate form calls a forwarder in a single wallet transaction. It checks the creator against the registry, sends the entire donation to that creator, and emits the event the indexer uses for the artwork’s history and optional message. The sender pays network gas separately. If the payment fails, the transaction reverts. The external interface is:

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
- expose only the Safe-controlled pause and ownership administration surface;
- operate only under the canonical Base write policy. Base Sepolia `84532` is the rehearsal/testnet chain; Base is the production chain.

The exact UTF-8 byte ceiling used to enforce the approved 140 user-visible-character limit in Solidity must be fixed during C-06 architecture sign-off. Solidity byte length must not be silently presented as a user-visible character count.

## Amounts And Message Controls

Any non-zero donation is accepted with or without a message. There is no
message-specific minimum, threshold setter or price oracle. This October 3
founder decision supersedes the former proposed 0.0005 ETH message floor.
The prior rule remains documented in the dated amendment for review and rollback.

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
- a non-Base deployment.

## Founder Decisions Recorded

- On-site anonymous display: approved.
- Amount: any non-zero value, with or without a message; no message threshold
  (amended October 3).
- Delivery scope: artwork-linked support on the existing testnet. The first Base mainnet release uses a direct wallet transfer.
- Creator routing: 100% of each successful donation, with no protocol cut or custody.
