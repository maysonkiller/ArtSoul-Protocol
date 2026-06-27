# Security And Public Repository Readiness Report

Date: 2026-06-26
Branch: `chore/repo-audit-cleanup`

## Summary

Task 1 cleanup reduces current-tree risk, removes legacy/token/business-unsafe material from the tracked tree, translates the public canon to English, and removes current hardcoded Supabase anon JWTs from browser source files.

Public release status: NO-GO until the human rotates affected keys and purges or replaces leaked history.

## Secret Scan

Tool used:

```text
gitleaks detect --source . --redact -v
```

Result: 13 redacted findings in git history.

Tracked current-tree scan: no secret-looking values found after cleanup.

Note: local ignored `.env` still exists on the workstation and contains real local secrets. It was not read into the report, modified, deleted, staged, or committed.

Historical findings:

| Commit | File | Finding |
| --- | --- | --- |
| `3cbfe488007f` | `.env.example:8` | `PRIVATE_KEY`-style value flagged by gitleaks |
| `3cbfe488007f` | `.env.example:3` | Supabase anon/public JWT |
| `3cbfe488007f` | `.env.example:4` | Supabase service-role JWT |
| `bda927123c82` | `PROJECT_SNAPSHOT_V4/core/oauth-integration.js:7` | Supabase public JWT |
| `bda927123c82` | `PROJECT_SNAPSHOT_V4/core/supabase-auth.js:5` | Supabase public JWT |
| `bda927123c82` | `PROJECT_SNAPSHOT_V4/core/supabase-client.js:6` | Supabase public JWT |
| `d6ef1845284f` | `SECURITY_AUDIT_REPORT.md:85` | Hardcoded Supabase key |
| `94f9168ef221` | `oauth-integration.js:7` | Supabase public JWT |
| `926bcc89424d` | `supabase-auth.js:5` | Supabase public JWT |
| `926bcc89424d` | `supabase-client.js:6` | Supabase public JWT |
| `0721229c3e11` | `supabase-client.js:6` | Supabase public JWT |
| `0721229c3e11` | `supabase-auth.js:5` | Supabase public JWT |
| `58b7ac0627c9` | `supabase-client.js:5` | Supabase publishable/public key |

No full secret values are included in this report.

## Keys The Human Must Rotate Or Verify Retired

- Supabase service-role key for project `bexigvqrunomwtjsxlej`.
- Supabase anon/publishable key for project `bexigvqrunomwtjsxlej`, or confirm the exposed historical key is no longer valid after RLS is closed.
- Any deployer/private key ever committed through `.env.example` or local deployment docs. If the historical value was only a placeholder, document that decision before public release.

Do not make the repository public until those rotations are complete.

## History Cleanup Required

The current branch removes current-tree exposures, but leaked values remain in git history. Before public release, the human should either:

- rewrite/purge history with an approved tool, then force-push intentionally; or
- create a fresh public repository with a clean history after secrets are rotated.

This task intentionally did not rewrite history.

## Current-Tree Cleanup

Removed from the tracked tree:

- Legacy and archived trees: `legacy/`, `archive/`.
- Token-only code and schema: `src/core/token-service.js`, `src/ui/token-balance-display.js`, `token-ui-styles.css`, `migrations/002_token_system.sql`.
- Legacy browser AI/NFT/layered engines that were loaded but unused or canon-inconsistent: `src/core/ai-db-helpers.js`, `src/core/ai-valuation-engine.js`, `src/core/nft-engine.js`, `src/core/layered-architecture.js`, `src/ui/ai-event-handlers.js`.
- Old root reports, scratch notes, cleanup logs, and stale recovery docs.
- Stale `docs/protocol`, `docs/product`, and `docs/ai-context` notes that contradicted the current canon.
- Local cleanup script `cleanup.sh`.

No database, SQL execution, contracts, deployment, or Hetzner server changes were made.

## Current-Tree Secret Mitigation

- Added `/api/public/config` so browser clients can load public Supabase configuration without hardcoding the anon JWT in source.
- Updated `supabase-client.js`, `supabase-auth.js`, and `oauth-integration.js` to fetch the public config.
- Kept service-role keys server-side only.

## Business, Investor, And Legal Docs

The explicitly named private docs were not present in the current tracked tree:

- `09_BUSINESS_PLAN.md`
- `10_LEGAL_POLAND.md`
- `11_INVESTOR_STRATEGY.md`
- `15_INVESTOR_TERM_SHEET.md`
- `INVESTOR_BRIEF_RU.md`
- `INVESTOR_BRIEF_UA.md`
- `INVESTOR_BRIEF_PL.md`
- `ARTSOUL_OUTREACH_KIT.md`
- `FOUNDER_ACTION_PLAN_RU.md`

`.gitignore` now blocks those names and broad investor/business/legal/outreach patterns from being recommitted.

## Russian To English

Public canon docs were rewritten in English:

- `docs/canon/ARTSOUL_CANON_BIBLE_FULL.md`
- `docs/canon/00_ARTSOUL_V4_1_CANON_BIBLE.md`
- `docs/canon/05_PROVENANCE_UI_CANON.md`
- `docs/canon/07_ADMIN_MODERATION_CANON.md`
- `docs/canon/08_TOKEN_POLICY.md`
- `docs/canon/12_IMPLEMENTATION_BACKLOG.md`
- `docs/canon/13_CODEX_MASTER_PROMPT.md`
- `docs/canon/14_PROTOCOL_REVENUE_AND_TEAM.md`
- `docs/canon/16_VISUAL_STATUS_AND_THEME_CANON.md`
- `docs/canon/17_ROADMAP_PHASES.md`

Remaining Cyrillic scan result: no tracked current-tree Cyrillic text found.

## Hidden Anti-Sybil Check

Hidden anti-sybil implementation details were removed from public canon text. The public docs now state only that private anti-sybil implementation details, scoring, heuristics, and review tooling are intentionally excluded from the repository.

## What Stays

- Root `AGENTS.md` and `CLAUDE.md`.
- Public canon in `docs/canon/`.
- Active frontend pages.
- Active contracts.
- Active API routes.
- Active indexer code.
- Testnet tester guides in `docs/testnet/`.

## GO / NO-GO

NO-GO for making the repository public today.

Required human actions first:

1. Rotate or retire the Supabase service-role key exposed in history.
2. Rotate or verify retirement of historical Supabase anon/publishable keys.
3. Verify whether the historical `.env.example` private-key finding was a real deployer key; rotate the wallet/key if it was.
4. Purge git history or publish from a clean-history repository.
5. Choose the final license: MIT or proprietary/all rights reserved.
