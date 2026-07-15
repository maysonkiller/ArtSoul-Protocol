# Contract Rework Plan

Status: design proposal. Analysis and architecture only — no Solidity is changed by this document.
Date: 2026-07-13 (contract-inventory task)
Companion: `docs/PROJECT_STATE.md` §7 (audit), `docs/canon/ARTSOUL_CANON_BIBLE_FULL.md` (§7 Genesis, §14 pool, §16 migration), `docs/canon/CHANGELOG_2026-07-13_AMENDMENT.md`.

This plan answers three things: **what is deployed today (facts from source, not memory)**, **what the final product-grade contract set should be**, and **the open questions the founder must resolve before Phase C implementation**.

---

## Part 1 — Exact inventory (from `contracts/` source + deployed addresses)

Network for all deployed addresses: **Base Sepolia (84532)**. The same address values also appear in legacy Ethereum Sepolia config and must not be assumed valid there without independent verification; that chain is stopped and read-only.

| File | Contract | Deployed address | What it actually does today |
| --- | --- | --- | --- |
| `contracts/ArtSoulCore.sol` | `ArtSoulCore` (Ownable2Step, Pausable, ReentrancyGuard) | `0x43368f7E2d5f11f4B7E11928D66d3f4A5a4E4ceF` | The engine. Artwork registration, primary auctions, deposit-backed bids, anti-sniping (10-min window/extension, 60-min cap), settlement, lazy mint call into the NFT, default handling, **resale marketplace (`listForResale`/`buyResale`)**, pull-payment withdrawals (`pendingWithdrawals`/`withdraw`). Single `treasury` address. |
| `contracts/ArtSoulNFT.sol` | `ArtSoulNFT` (ERC721URIStorage, ERC2981, Ownable2Step) | `0xf061f70503c37Cf2196A28F4785E524D0Fb32538` | The artwork NFT. `mint` is `onlyCore`. ERC-2981 royalty set to the creator at **7.5%** (`CANONICAL_ROYALTY_BPS = 750`). Standard ERC-721 approvals — **no marketplace whitelist**. |
| `contracts/ArtSoulProjectNFT.sol` | `ArtSoulProjectNFT` — ERC-721 name **"ArtSoul Genesis" / SOUL-GENESIS** (ERC721, Ownable2Step) | `0xBd17c875962a3cd34F10405234527a41A90A682B` | **The Genesis prototype.** `MAX_SUPPLY = 100`, token IDs from 1, `awardToWinner` is `onlyCore` (awarded via an auction path, not an admin console). Standard **transferable** ERC-721 (`_update` allows any transfer and logs on-chain ownership history). Stores an `eligibilityHash` per token. |

### What is `ProjectNFT` (`0xBd17…682B`)? — direct answer

It is the **Genesis prototype**, and nothing else. It is `ArtSoulProjectNFT`, whose ERC-721 name is literally "ArtSoul Genesis". It is **not** a collections contract and **not** a general artwork contract. It diverges from canonical Genesis on every material axis: transferable (canon: soulbound), supply 100 (canon: 10,000), token IDs from 1 (canon: #0 founder + numbered), auction-award distribution (canon: admin-granted batches + mainnet-activity). Per the 2026-07-13 amendment it is a **DEPRECATED prototype: not Genesis, not extended, not migrated — retired at the mainnet migration.**

### What is the "third contract"?

Beyond Core and the artwork NFT, the third **deployed** contract is exactly this `ArtSoulProjectNFT` Genesis prototype. There is no separate collections contract deployed today.

### Compiled-but-not-in-source artifacts (flag)

`artifacts/contracts/` also contains `ArtSoulMarketplace.sol`, `ArtSoulMarketplaceV2.sol`, and `ArtSoulToken.sol`, but **no matching source exists in `contracts/`**. These are stale build artifacts from earlier experiments. `ArtSoulToken.sol` in particular is a **token artifact and must not be revived** (token-free canon §10). The rework should delete these orphan artifacts so no one mistakes them for live code. Resale/marketplace logic today lives **inside Core**, not in a `Marketplace` contract.

### Canon deviations found (all are mainnet blockers; none require touching the live testnet)

| Area | Canon | Deployed today | Severity |
| --- | --- | --- | --- |
| Resale split | 92.5 / 5.5 / 1 protocol / 1 ecosystem | **90 / 7.5 / 2.5, no ecosystem pool** (`buyResale`: PLATFORM 250 + ROYALTY 750 bps) | P0 |
| Creator royalty (ERC-2981) | 5.5% | **7.5%** (`CANONICAL_ROYALTY_BPS = 750`) | P0 |
| Ecosystem Pool | 1% routed to a separate ecosystem treasury | **Absent** — single `treasury` only | P0 |
| Genesis | soulbound, 10,000, #0 founder, admin-granted | transferable, 100, auction-awarded prototype | P0 (replace) |
| Marketplace enforcement | approvals restricted to whitelisted marketplaces | standard ERC-721 approvals | P0 |
| No-bid finalization | automatic on-chain transition | manual `endAuction()` required | P0 |
| Partner Collections | first-auction-then-buy-now with configurable supply | not implemented | build new |
| Primary split, deposit, increment, durations, settlement, 80/20 default | per canon | **match** | keep + re-test |

Primary economics, deposit (10%), increment (2.5%), durations (24/36/48h), settlement (24h), and the 80/20 default split already match canon and only need re-testing in the rework.

---

## Part 2 — Target architecture

### Contract count: **4 contracts, with the Ecosystem/Reward Pool as a module inside Core**

| # | Contract | Upgradeability | Responsibility |
| --- | --- | --- | --- |
| 1 | **`ArtSoulCore`** | **UUPS upgradeable** | Auctions, deposits, bids, anti-sniping, settlement, default 80/20, **resale marketplace** (stays here), fee routing to ProtocolTreasury **and** the Ecosystem Pool, permissionless keeper finalization. The **Ecosystem Pool is an internal accounting module** here, not a separate contract. |
| 2 | **`ArtSoulArtworkNFT`** | **Immutable contract, mutable whitelist state** | ERC-721 + ERC-2981 at **5.5%** to creator, `mint` restricted to Core, **marketplace-approval whitelist** enforced in `approve`/`setApprovalForAll`. The whitelist is admin-settable data, so policy can change without a contract upgrade. |
| 3 | **`ArtSoulGenesis`** | **Immutable** | New soulbound ERC-721, supply 10,000, `_update` reverts on transfer (soulbound), admin/eligibility-engine grant in batches, #0 founder + RESERVED_TEAM=200 + ~1,000 mainnet-activity + ~8,799 contest remainder. No economic privileges. |
| 4 | **`ArtSoulCollections` (partner factory)** | **UUPS singleton _or_ minimal-clone factory** (open question) | Lets ArtSoul and approved partners create drops with configurable supply. Canonical first-auction-then-buy-now, reusing the per-artwork floor system — no separate collection-floor protocol. Partner onboarding gated by an approver role. |

**No token contract.** A token is a possible future phase only (§10) and is out of scope.

### Why this shape

- **Resale/marketplace stays in Core** because it already lives there and because one settlement + one `pendingWithdrawals` accounting surface means fewer cross-contract value transfers, one reentrancy boundary, and a smaller attack surface than a separate marketplace contract calling back into Core.
- **Pool as a module in Core, not a 5th contract:** the 1% is computed in the same `buyResale`/settlement path that already splits funds, so a separate pool contract would only add an external call and more surface for no functional gain. The pool is an internal balance withdrawable **only** to the EcosystemTreasury multisig. (This is the recommendation the amendment asks Core to record.)
- **NFT and Genesis favor immutability** because minted art and soulbound identity should not be silently rewritable; needed flexibility (marketplace whitelist, royalty receiver) is expressed as **mutable state**, not upgradeable logic.
- **Core is UUPS** because its behavior genuinely evolves (keeper model, collections integration, pool accounting) and a storage-layout-reviewed upgrade path is safer than redeploy-and-migrate for the engine.

### Where OpenZeppelin replaces bespoke code

- ERC-721 / ERC721URIStorage / **ERC-2981** for NFT + royalty (already used; keep).
- **AccessControl** for multi-role separation (replaces single `Ownable` where several roles are needed).
- **ReentrancyGuard, Pausable, Ownable2Step** — keep.
- **UUPSUpgradeable + Initializable** for Core.
- **Clones (EIP-1167)** if Collections uses a factory.
- **Strings** replaces the bespoke `_toString` in the Genesis prototype.
- **Address.sendValue / pull-payment pattern** — keep pull payments.
- **Remove** the on-chain `ownershipHistory[]` arrays from the prototype; provenance comes from the indexer, and unbounded on-chain arrays are a gas/DoS risk.

### Role separation

- `DEFAULT_ADMIN` / deployer — deploys, wires addresses, then transfers admin to the treasury multisig.
- **ProtocolTreasury multisig** — receives protocol fees; holds admin after handover.
- **EcosystemTreasury multisig** — the only withdrawal destination for the Ecosystem Pool balance; quarterly allocation per §14.
- **KEEPER** — triggers finalization/settlement transitions. **Must have zero power over the outcome:** it can only execute the deterministic state machine (finalize expired auctions, refund losers via pull-payments, apply 80/20 on default). Recommend fully permissionless (anyone can call), Nouns-style.
- **GENESIS_GRANTER** — the admin-console signer that grants Genesis; a restricted role, not full owner.
- **COLLECTION_APPROVER** — whitelists partner projects for the factory.

### Reference study (take ideas, do not copy)

- **Nouns (settle-on-next-start):** finalizing the current auction and starting the next happen in one permissionless call. Take: fold no-bid finalization + return-to-re-auctionable into a single keeper/anyone call so no manual `endAuction()` step is ever required.
- **Zora modules:** lean core + modular strategies. Take: keep Core lean, pool as an internal module, Collections as a separate factory rather than bloating Core.
- **Chainlink Automation:** off-chain trigger, on-chain deterministic execution. Take: an automated keeper drives finalization on schedule; **losing bidders are refunded via pull-payments and never spend their own gas**; defaulted winner is 80/20; no funds are ever stuck.

---

## Part 3 — Open questions for the founder

1. **ProtocolTreasury and EcosystemTreasury addresses** (multisig). Blocks role handover, pool routing, Collections, and Official aura.
2. **Ecosystem Pool placement:** confirm module-inside-Core (recommended) vs a separate contract.
3. **Collections pattern:** UUPS singleton vs minimal-clone factory per partner drop?
4. **Keeper trust model:** fully permissionless (recommended, zero outcome power) vs a restricted keeper role?
5. **Genesis granter:** dedicated `GENESIS_GRANTER` role (recommended) vs owner-only?
6. **ArtworkNFT upgradeability:** immutable contract with mutable whitelist state (recommended) vs UUPS?
7. **ProjectNFT fate:** retire entirely at migration (canon default) — confirm there is no non-Genesis reuse intended.
8. **Metadata permanence:** confirm IPFS/Arweave as the mainnet metadata home (Bible/Phase D), plus the base/contract URI and project domain.
9. **Partner onboarding criteria** and who holds `COLLECTION_APPROVER`.
10. **Exact Genesis contest cadence** (currently ~10/week, marked tunable) and confirmation of the 200 / ~1,000 / ~8,799 split.

---

## Part 4 — Migration outline

The rework does **not** mutate the live testnet contracts. It is built fresh, deployed clean, validated on a fresh public-testnet cycle, and then the mandatory **pre-mainnet migration / full data reset** in **Bible §16** runs before launch:

1. Build the 4-contract set from this plan and the frozen canon.
2. Full unit + invariant tests; independent external audit; storage-layout review for Core's UUPS path.
3. Fresh public-testnet cycle: publish → auction → settle → mint → resale, plus Genesis grant and a partner collection.
4. Deploy audited contracts to Base mainnet.
5. Run Bible §16: purge legacy testnet data, remove old addresses from config/UI, reset the indexer to the new deploy blocks, verify zero leftover connections/env/UI references, and exercise a full lifecycle on the fresh deployment.
6. Only then does the public/marketing phase proceed.

Deployed testnet contracts remain running as-is for beta throughout; economics are never changed under live testers.
