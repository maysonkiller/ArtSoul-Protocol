You are working on **ArtSoul V4.1**, an NFT art auction protocol on **Base** (internal codename V4.1; never expose the version in UI or investor materials) (single chain).

## CANON SCOPE & CONFLICTS
The frozen canon governs ARCHITECTURE only: economics (fees, splits, bid increments, deposits), contract behavior, and the publish → auction → settlement → mint lifecycle. It does NOT freeze UI, layout, display rules, tab structure, copy, or UX — those are expected to evolve.

When a task or the user requests a change:

- If it concerns UI / display / layout / tabs / wording / UX: implement it as asked. The current request takes priority over any older canon description of the interface.
- If it genuinely conflicts with the frozen ARCHITECTURE (economics, contract logic, lifecycle) and the current request **explicitly authorizes that architecture change**: implement it as asked, update or queue the corresponding canon amendment, and clearly flag the exact rule, file, section, and change in the report.
- If an architecture conflict is ambiguous, inferred, or not explicitly authorized: **STOP before implementation**, report the conflict, and ask for a decision. The STOP rule applies to unapproved architecture changes; it does not override an explicit founder instruction to amend the architecture.
- Never silently skip, refuse, or downgrade a requested change just because the canon currently says otherwise. Surface the conflict and follow the explicit-authorization rule above.

## IMPLEMENTATION DISCIPLINE
Before writing new code, prefer the simplest solution:

- Check whether the project ALREADY has a function / component / util that does this - reuse it instead of duplicating.
- Prefer the standard library / platform built-ins over adding a new dependency. Do NOT add a new dependency unless there is no reasonable built-in or existing option; if you must add one, state why.
- Write the MINIMUM code needed - avoid new abstractions or layers for a small change.

Apply changes CONSISTENTLY:

- If a change concerns a TYPE of UI element (e.g. media previews, cards, status badges, play controls), apply it to EVERY surface where that element appears (gallery, homepage, profile, artwork detail) - never fix it on one page and leave the others inconsistent.
- If the request scopes a fix to one specific element, change ONLY that element and do not touch unrelated ones.

When you notice an obvious closely-related bug in the same area you are editing, fix it too - or, if it is out of scope, clearly flag it in your report. Never leave an area half-correct.

## ABSOLUTE RULES
1. Single source of truth: `docs/canon/ARTSOUL_CANON_BIBLE_FULL.md` (the complete Bible in one file) — or equivalently `docs/canon/00_ARTSOUL_V4_1_CANON_BIBLE.md` and its parts (05 provenance/UI, 07 admin/moderation/copyright, 08 token, 14 revenue/team, 16 visual/theme, 17 roadmap). THIS FILE (CLAUDE.md/AGENTS.md) must live in the REPO ROOT so it auto-loads. Read before any task. If a task conflicts with the Bible and does not explicitly authorize an architecture amendment, STOP and report before implementation. If the founder explicitly authorizes the conflicting architecture change, implement it, amend or queue the canon update, and report the exact conflict; never leave code and canon silently divergent.
2. NEVER invent mechanics, fees, roles, states, or parameters. If it is not in the Bible, it does not exist. Ask, don't assume.
3. NEVER change frozen economics: Primary 97.5/2.5; Resale 92.5/5.5/1 protocol/1 ecosystem-pool; Default 10% deposit split 80/20; bid increment max(+0.01 ETH, +2.5%); deposit 0.01 ETH; durations 24/36/48h; settlement 24h.
4. Lazy mint canon: NFT exists only after successful settlement. Floor created ONLY by successful settlement (auction) or buyNowMint price (collections).
5. Genesis (Amended 2026-07-13; roadmap-aligned 2026-07-16, see Bible §7): NEW dedicated contract `ArtSoulGenesis` (the testnet `ProjectNFT` 0xBd17…682B is a transferable 100-supply PROTOTYPE ONLY — not Genesis, not extended, retired at migration). Supply **10000**, **soulbound (non-transferable)**, mainnet-only, real art-NFT (image + animation_url/GIF, IPFS). Allocation boundaries: #0 founder; RESERVED_TEAM=200 (team/contributors/devs); ~1,000 for on-chain activity on Base MAINNET only (testnet never qualifies); ~8,799 remainder via contests/rewards in admin-granted batches. Numeric grant cadence is tunable operational policy, not frozen canon. Grants require published eligibility categories, durable grant records, an audit log, and multisig-authorized administration; no undocumented single-operator discretion. NOT open self-claim/merkle. Discord role ID `1508973288431554723` + activity path; hidden anti-sybil stays OUT of the public repo. **NO fee waiver and NO fee discount for Genesis — final.** Genesis utilities are non-economic only: aura, ×1.3 trust weight (rule 6), Discord role, contest priority, one undisclosed future utility. Separate **Top-100k** = soulbound numbered profile badge (mainnet-only, hard criteria), NOT a tradeable NFT and NOT an artwork aura.
6. Trust weights: Verified 1x, **Genesis 1.3x** (Amended 2026-07-13; superseded 2x), 100+ settlements 3x, Partner 5x; take MAX applicable, hard cap 5x. Genesis status alone confers at most ×1.3 and must never decide a contest/ranking — outcomes stay winnable by non-Genesis works on organic demand. Trust affects discovery only — never price/floor/ownership/settlement.
7. Ecosystem Pool (1% resale): emerging-artist grants + community growth + community reward/contest loop (fees → pool → contests → activity → fees, no token); quarterly multisig allocation. NEVER to team salaries or investors, never passive income, never token/airdrop accounting. The trigger for pool-funded contests is undecided; never invent a date, distribution count, or percentage. (Amended 2026-07-13: removed "future token liquidity reserve" — contradicts rule 10 token-free.)
8. Partner Collections per Bible §8 exactly: one genesis auction at a time, floor only after settlement, max 3 attempts then Cancelled + 30-day cooldown (this limit applies ONLY to a collection's first auction, NOT to normal users). Remaining supply via buyNowMint at collectionFloor (= winning bid of the first auction; all remaining items same flat price). Reuse per-artwork canonicalFloor; do NOT build a separate collection-floor protocol.
9. Marketplace enforcement: NFT approvals restricted to whitelisted marketplaces; wallet-to-wallet = non-sale events.
10. NO token, NO points, NO airdrop logic anywhere in code or docs. Token-free until a future explicit decision (Bible §10 / doc 08).
11. UI provenance is canon (05): every NFT surface shows Creator / First Collector / Owner (NO emojis); NFT page shows full timeline from indexer data only. Labels: "First Collector" (not "winner"/"auctioner"). All artwork/auction/nft/collection/genesis pages must be RESPONSIVE — primary content visible without scrolling.
12. Moderation/Copyright (Bible §11 / doc 07 v1.2): complaint-driven notice-and-takedown is the primary mechanism: Report button → complaint form → valid-claim hide pending review → review queue, notifications, and audit log. Critical/irreversible actions require multisig, not social login alone. Do NOT build Content-ID, Shazam-style fingerprinting, or self-hosted moderation ML. An optional cheap upload flag may share the existing external AI valuation request, but it never replaces the complaint/review flow.
13. Single chain only: Base. Base Sepolia is the only active product testnet; legacy Ethereum Sepolia data may remain readable but is never an active write/selectable product network. Do NOT add Solana/other chains — multichain is out of scope (Bible §1).
14. Work strictly through `12_IMPLEMENTATION_BACKLOG.md` order. One backlog item = one task. Write/extend tests for every contract change.
15. Security first: checks-effects-interactions, reentrancy guards, pull-payments, no unbounded loops, pausable admin paths. Any storage-layout change to deployed contracts must be flagged loudly.

16. VISUAL/THEME (doc 16): strict Classic/Future separation — a Future color NEVER appears in Classic and vice versa. ALL theme colors live as variables in `unified-styles.css` under `.classic`/`.future`; NEVER hardcode theme hex in pages or JS, use `var(--c-*)`. Mobile/desktop differ in LAYOUT only (colors identical across devices). Classic = no animation; Future = animation.
17. AURA SYSTEM (doc 16): one auto-assigned aura per NFT by priority — Platform (shimmer cyan/purple/pink) > Genesis (gold, static) > Partner collection (cyan/blue) > none. Users do NOT pick colors. Running border text is Future-only, toggleable from admin. Auras show on preview cards AND artwork pages (artwork media is contained, OpenSea-style, not full-bleed).
18. ROADMAP (Bible §17 / doc 17): follow the canonical A–D phases in order. Roadmap/backlog files are subordinate to the Bible and cannot create mechanics or economics. Business/legal/CEO/fundraising items are the FOUNDER's responsibility — surface them when a phase needs them, do not attempt them yourself.
19. AI valuation: Gemini 2.5 Flash-Lite, server-side key (never browser localStorage), guidance-only (no effect on settlement/floor/royalty); log features+outcomes to the DB for a future in-house model.
20. LOSING-BIDDER REFUNDS (Bible §3.1): finalization records deterministic full-refund obligations; execution is bounded and batchable; failed transfers become withdrawable credit; no losing bidder is required to progress finalization; no unbounded bidder loop; tests must prevent double payment. Default penalties apply only to the defaulted winner.

## WORKFLOW
- Before coding: restate which Bible sections the task touches.
- After coding: list every place you had to interpret ambiguity — these become Bible changelog candidates, never silent decisions.
- Everything committed to the public repository — branch names, commit messages, PR title/body, code comments, test names/comments, and docs — is English. User-facing chat reports may follow the user's language.

## v1.2 DELTAS (read in addition to above)
- Moderation is SIMPLIFIED as summarized in rule 12. Do not reintroduce the superseded 3-factor social-login gate or upload fingerprinting plan.
- Promoted Banners (existing v1.2 delta, pending consolidation into the full Bible before implementation): of 12 homepage banners, up to 3 are paid "Promoted" (clearly tagged), priced via slot auction (current planning reserve ~0.05 ETH/day) → ProtocolTreasury. ≥9 remain merit-ranked by community signal. Promoted never affects Trust/floor/discovery ranking of others. Do not implement C10 until the full Bible records the approved mechanics and whether the reserve is fixed or tunable.
- Decisions final (Bible §16): EcosystemPool stays 1%; chain = Base; Base Sepolia is the active testnet; Snapshot A = last day of public testnet, announced at least 2 weeks ahead. Snapshot A must be a versioned, machine-readable, hashed export stored and verified in at least two independent durable locations before destructive reset; it creates no entitlement. Multichain is out of scope.
- Badge "First Collector of the Collection" (doc 05 v1.2): NOT a stored image — contract stores firstCollector address; frontend renders the badge component automatically; optionally bake as NFT metadata trait. Shown on the COLLECTION card only.
- Treasuries (doc 14 §9): ProtocolTreasury (on-chain, fees) and EcosystemTreasury (on-chain, 1% pool) are separate from company operating capital (bank/investments). Never mix investments into ProtocolTreasury.
