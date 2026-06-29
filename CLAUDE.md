You are working on **ArtSoul V4.1**, an NFT art auction protocol on **Base** (internal codename V4.1; never expose the version in UI or investor materials) (single chain).

## CANON SCOPE & CONFLICTS
The frozen canon governs ARCHITECTURE only: economics (fees, splits, bid increments, deposits), contract behavior, and the publish → auction → settlement → mint lifecycle. It does NOT freeze UI, layout, display rules, tab structure, copy, or UX — those are expected to evolve.

When a task or the user requests a change:

- If it concerns UI / display / layout / tabs / wording / UX: implement it as asked. The current request takes priority over any older canon description of the interface.
- If it genuinely conflicts with the frozen ARCHITECTURE (economics, contract logic, lifecycle): still implement what the user explicitly asks, BUT clearly flag in your report exactly which canon rule it conflicts with, where (file + section), and what you changed — so the canon can be updated.
- Never silently skip, refuse, or downgrade a requested change just because the canon currently says otherwise. Surface the conflict and proceed with the request.

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
1. Single source of truth: `docs/canon/ARTSOUL_CANON_BIBLE_FULL.md` (the complete Bible in one file) — or equivalently `docs/canon/00_ARTSOUL_V4_1_CANON_BIBLE.md` and its parts (05 provenance/UI, 07 admin/moderation/copyright, 08 token, 14 revenue/team, 16 visual/theme, 17 roadmap). THIS FILE (CLAUDE.md/AGENTS.md) must live in the REPO ROOT so it auto-loads. Read before any task. If a task conflicts with the Bible — STOP and report, do not implement.
2. NEVER invent mechanics, fees, roles, states, or parameters. If it is not in the Bible, it does not exist. Ask, don't assume.
3. NEVER change frozen economics: Primary 97.5/2.5; Resale 92.5/5.5/1 protocol/1 ecosystem-pool; Default 10% deposit split 80/20; bid increment max(+0.01 ETH, +2.5%); deposit 0.01 ETH; durations 24/36/48h; settlement 24h.
4. Lazy mint canon: NFT exists only after successful settlement. Floor created ONLY by successful settlement (auction) or buyNowMint price (collections).
5. Genesis: supply **10000** (#0000 founder reserved, #0001–#9999 public), **soulbound (non-transferable)**, mainnet-only free claim, 7-day window, ONE Discord role ID `1508973288431554723` + activity path, hidden anti-sybil layer kept OUT of the public repo. Genesis is a real art-NFT (image + animation_url/GIF in metadata, IPFS). Claim is automated: eligibility engine → admin panel shows count → merkle-root claim → users self-mint (founder never mints manually). Separate **Top-100k** = soulbound numbered profile badge (mainnet-only, hard criteria), NOT a tradeable NFT and NOT an artwork aura.
6. Trust weights: Verified 1x, Genesis 2x, 100+ settlements 3x, Partner 5x; take MAX applicable, hard cap 5x. Trust affects discovery only — never price/floor/ownership/settlement.
7. Ecosystem Pool (1% resale): emerging-artist grants + community growth + future token liquidity reserve; quarterly multisig allocation. NEVER to team salaries or investors, never passive income.
8. Partner Collections per Bible §6.3 exactly: one genesis auction at a time, floor only after settlement, max 3 attempts then Cancelled + 30-day cooldown (this limit applies ONLY to a collection's first auction, NOT to normal users). Remaining supply via buyNowMint at collectionFloor (= winning bid of the first auction; all remaining items same flat price). Reuse per-artwork canonicalFloor; do NOT build a separate collection-floor protocol.
9. Marketplace enforcement: NFT approvals restricted to whitelisted marketplaces; wallet-to-wallet = non-sale events.
10. NO token, NO points, NO airdrop logic anywhere in code or docs. Token-free until a future explicit decision (Bible §9 / doc 08).
11. UI provenance is canon (05): every NFT surface shows Creator / First Collector / Owner (NO emojis); NFT page shows full timeline from indexer data only. Labels: "First Collector" (not "winner"/"auctioner"). All artwork/auction/nft/collection/genesis pages must be RESPONSIVE — primary content visible without scrolling.
12. Moderation/Copyright (07): 3-factor moderator access (profile+X+Discord+wallet, all required); critical/irreversible actions gated by multisig, NOT social logins. Moderation button + panel (Hide/Unhide everything, Review Queue, notifications, audit log). Upload copyright check (perceptual hash / audio fingerprint / AI moderation) → soft-block + dispute flow. Notice-and-takedown supported.
13. Single chain only: Base. Do NOT add Solana/other chains — multichain is out of scope (Bible §10).
14. Work strictly through `12_IMPLEMENTATION_BACKLOG.md` order. One backlog item = one task. Write/extend tests for every contract change.
15. Security first: checks-effects-interactions, reentrancy guards, pull-payments, no unbounded loops, pausable admin paths. Any storage-layout change to deployed contracts must be flagged loudly.

16. VISUAL/THEME (doc 16): strict Classic/Future separation — a Future color NEVER appears in Classic and vice versa. ALL theme colors live as variables in `unified-styles.css` under `.classic`/`.future`; NEVER hardcode theme hex in pages or JS, use `var(--c-*)`. Mobile/desktop differ in LAYOUT only (colors identical across devices). Classic = no animation; Future = animation.
17. AURA SYSTEM (doc 16): one auto-assigned aura per NFT by priority — Platform (shimmer cyan/purple/pink) > Genesis (gold, static) > Partner collection (cyan/blue) > none. Users do NOT pick colors. Running border text is Future-only, toggleable from admin. Auras show on preview cards AND artwork pages (artwork media is contained, OpenSea-style, not full-bleed).
18. ROADMAP (doc 17): follow the phases in order. Business/legal/CEO/fundraising items are the FOUNDER's responsibility — surface them when a phase needs them, do not attempt them yourself.
19. AI valuation: Gemini 2.5 Flash-Lite, server-side key (never browser localStorage), guidance-only (no effect on settlement/floor/royalty); log features+outcomes to the DB for a future in-house model.

## WORKFLOW
- Before coding: restate which Bible sections the task touches.
- After coding: list every place you had to interpret ambiguity — these become Bible changelog candidates, never silent decisions.

## v1.2 DELTAS (read in addition to above)
- Moderation is SIMPLIFIED (doc 07 v1.2): primary mechanism is complaint-driven notice-and-takedown (Report button on each artwork → form → auto-hide on valid copyright claim → review queue). Do NOT build Content-ID/Shazam fingerprinting. Optional cheap upload flag may ride along the existing AI valuation call. AI valuation = single external vision-model API call (Claude/Gemini/GPT), no self-trained model, no self-hosting.
- Promoted Banners (Bible §15): of 12 homepage banners, up to 3 are paid "Promoted" (clearly tagged), priced via slot auction (reserve ~0.05 ETH/day) → ProtocolTreasury. ≥9 remain merit-ranked by community signal. Promoted never affects Trust/floor/discovery ranking of others.
- Decisions final (Bible §16): EcosystemPool stays 1%; chain = Base (testnet may run on Ethereum Sepolia + Base Sepolia, but canon/mainnet = Base); Snapshot A = last day of public testnet, announced 2 weeks ahead (target Oct–Nov 2026). Multichain (Solana) out of scope until proven single-chain mainnet.
- Badge "First Collector of the Collection" (doc 05 v1.2): NOT a stored image — contract stores firstCollector address; frontend renders the badge component automatically; optionally bake as NFT metadata trait. Shown on the COLLECTION card only.
- Treasuries (doc 14 §9): ProtocolTreasury (on-chain, fees) and EcosystemTreasury (on-chain, 1% pool) are separate from company operating capital (bank/investments). Never mix investments into ProtocolTreasury.
