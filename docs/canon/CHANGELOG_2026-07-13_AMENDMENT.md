# Canon Amendment — 2026-07-13

Authority: founder decision (sole owner and author of the canon). This amendment records decisions that prior audits correctly refused to add while the canon still forbade them. Each amended clause is marked in-place with "Amended 2026-07-13 by founder decision" and the previous wording is preserved as "Superseded".

No code, contract, database, or deployment behavior is changed by this amendment. It is documentation only.

## Amended clauses

| # | Where | Change | Superseded value |
| --- | --- | --- | --- |
| 1 | Bible FULL §6; `CLAUDE.md`/`AGENTS.md` rule 6 | Genesis trust weight lowered to **×1.3** with an explicit bound: Genesis status alone confers at most ×1.3 and must never decide a contest/ranking; outcomes stay winnable by non-Genesis works on organic demand. | Genesis **2x**, no Genesis-specific ceiling below the global 5x cap. |
| 2 | Bible FULL §7 (rewritten); `CLAUDE.md`/`AGENTS.md` rule 5 | Genesis final spec: **new dedicated `ArtSoulGenesis` contract**; the testnet `ProjectNFT` (`0xBd17…682B`) is a transferable 100-supply **prototype only**, not Genesis, not extended, retired at migration. Allocation: #0 founder; **RESERVED_TEAM = 200**; **~1,000** for on-chain activity on Base **mainnet only**; **~8,799** remainder via contests/rewards in **admin-granted batches** (~10/week, cadence tunable), not open self-claim. | High-level "supply 10,000; #0000 founder; #0001–#9999 public; soulbound; mainnet-only; real art NFT; eligibility via Discord role + activity" implying open merkle self-claim; no team reserve, no activity/contest split, no admin-console model, no dedicated-contract statement. |
| 3 | Bible FULL §7.5; `CLAUDE.md`/`AGENTS.md` rule 5 | **No fee waiver and no fee discount for Genesis holders. Final.** Rationale: zero/reduced fees enable wash trading that corrupts public metrics and the trust ranking and starves the reward pool. Genesis utilities are non-economic only (aura, ×1.3 trust, Discord role, contest priority, one undisclosed future utility). | Canon was silent on Genesis fee treatment. |
| 4 | Bible FULL §14 / §14.1; split `14_PROTOCOL_REVENUE_AND_TEAM.md`; `CLAUDE.md`/`AGENTS.md` rule 7 | Ecosystem Pool (1%) reframed as a **closed reward/contest loop** (fees → pool → contests → activity → fees, no token). Removed "future token liquidity reserve" as a pool use because it contradicts the token-free canon (§10). | "Future token liquidity reserve only if a future token is formally approved" listed as an Ecosystem Pool use. |
| 5 | Bible FULL §14.2; split `14_…` | Recorded the **known deployed-contract deviation**: testnet resale is 90/7.5/2.5 with no Ecosystem Pool split and 7.5% NFT royalty vs canon 92.5/5.5/1/1 and 5.5% royalty. Marked as a prototype deviation to fix in the rework, not a canon change. | Not previously recorded in canon. |
| 6 | Bible FULL §16 (new) | Added the **mandatory pre-mainnet migration / full data-reset checklist** (purge legacy testnet data, remove old addresses, reset indexer to new deploy block, verify no leftovers, exercise a full lifecycle, then marketing). | No migration/reset section existed. |
| 7 | Bible FULL §17 (new) | Recorded **Phase status = A (Stabilize Public Testnet)**; corrected earlier informal "Phase B" references. | Roadmap files already said Phase A; the Bible had no explicit phase-status clause. |

## Deliberately NOT changed

- Frozen economics values (97.5/2.5 primary; 92.5/5.5/1/1 resale; 80/20 default; 0.01 ETH deposit; increment; durations; settlement) — unchanged.
- Token policy (§10): still token-free; no token/points/airdrop designed, promised, or referenced.
- Single-chain Base scope.

## Open items flagged (not resolved here)

- **Trust multiplier value ×1.3** is applied per founder instruction 2026-07-13. If further tuning is wanted, it requires a new amendment.
- **Treasury/project multisig wallet address** and **project domain** remain undecided founder TODOs (blocking Collections/Official aura and brand/email respectively).
- **Exact contest cadence** for Genesis distribution is marked tunable.
- The contract architecture that realizes `ArtSoulGenesis`, the Ecosystem Pool module, and the corrected splits is specified separately in `docs/canon/CONTRACT_REWORK_PLAN.md` (contract-inventory task).
