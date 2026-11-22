# ArtSoul Protocol — UI copy punctuation audit

**Date:** 2026-11-22  
**Base:** `main` @ `9f72dbbd972fc29ad8095c0ca549650bbf2af637`  
**Mode:** SOURCE_ONLY / TEST_ONLY — not merged, not deployed, no contract or payment changes

## Why

The founder prefers no decorative periods in short marketing headlines, hero banners or labels, and no centered-dot visual separators in first-party UI copy. This is a typography/content preference, not a request to strip punctuation from meaningful prose.

## Screens and components reviewed

- Top-level HTML pages: home, gallery, artwork, profile, upload, collection draft, admin, protocol documentation, visual lab, wallet test
- React/browser entries and UI modules: landing cards, discovery, gallery tabs, artwork details, profile sections, collections, admin and moderation, notifications, search, wallet assets, voice command results, artist support
- CSS/theme handling: changes are text-only; no Classic/Future colors or animations were modified

## Exact changes

- Home hero line-break copy now uses `Discover a work` and `Start its next chapter`, without the headline full stops
- Home eyebrow: `Art first — ownership next`; spotlight subtitle no final period
- Gallery hero: `Art worth discovering`; collection draft badge: `Local draft — unpublished`
- The centered-dot delimiter in relevant UI JSX/JS labels is replaced with a simple slash separator, including card metadata, profile and wallet labels, collection review summaries, moderation and notification labels, search results and assistive display text

## Deliberately not changed

- Complete sentences in help text, validation, settlement and moderation notices still end with correct punctuation
- Decimal values, URLs, filenames, crypto amounts, addresses, code syntax, error traces, product names and user/creator-authored text are not rewritten
- `...` indicating ongoing work and `•••` for media-player options are meaningful interface conventions, not arbitrary wordmark decoration
- Brand logo and protocol economics, contracts and deployment configuration are untouched

## Checks and evidence

- A static gate is provided at `scripts/check-ui-copy-punctuation.mjs`. It reads first-party HTML/JS/JSX/TS/TSX in root and source UI directories and rejects centered dots, spaced decorative bullets, static heading periods and missing headline copy
- Source diffs are limited to first-party user-visible copy, the check script and this record. Review after a commit using GitHub's changed-files list
- The creator's original content may contain punctuation by design and should not be modified automatically
- Real full browser QA, native mobile devices, `npm run build`, all runtime/tab states and preview deployment: **NOT_RUN** in this source-only chat environment. Do not report an exhaustive UI PASS without those tests

## Follow-up for the owner

Review the draft pull request and run `node scripts/check-ui-copy-punctuation.mjs` plus project build and browser checks on a controlled local machine. No merge or production deploy until explicit owner approval.