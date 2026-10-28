# B12 / B21 resale commands and asynchronous wallet consent

Workspace: `C:\Projects\ArtSoul`, branch `codex/takeover-audit`.
Starting HEAD: `5d592dca`; starting production implementation: `e5f121f3`.
Status: released in PR #383; release evidence follows below.

## Reproduction and cause

- B23 already exposes listing, price changes and removal through the artwork page
  and the contract adapter. B12's statement that these adapters did not exist was
  obsolete. The assistant offered listing but no explicit edit/removal commands.
- The assistant listing call supplied only `idType`; the adapter's expected-wallet
  checks therefore did not run. Its review used projected owner/floor/price data.
- Actual browser testing reproduced a separate consent defect: `modal-system.js`
  replaces `window.confirm` with a Promise-returning dialog. The synchronous agent
  gate treated that Promise as truthy and continued before the user answered.
  The initial negative browser case failed because its fake writer was called.
  No real wallet or transaction was involved in this reproduction.

## Changes

- Add `change_resale_price` and `cancel_resale_listing`; reuse `list_for_resale`
  and the existing page adapters. Explicit edit never creates a missing listing.
- Review live contract identity, owner, floor, seller and price. Preserve artwork
  versus token ID namespaces. Cancellation remains available to the listing's
  seller after an NFT transfer; it does not transfer or destroy the NFT.
- Bind reviewed writes to wallet, chain, core/NFT deployment and listing state.
  Recheck after approval waits. Capture adapter references and check them
  synchronously immediately before approval/list/cancel writes.
- All wallet tools now await the common confirmation gate. Only resolved `true`
  is consent. Rejection, errors, revocation or account/runtime changes stop the
  pending action. Voice and WebMCP instances share one in-flight wallet action.
- Add strict EN/RU commands and examples. Questions, negations and combined
  commands do not execute a financial command. Low speech confidence remains a
  refusal. Root runtime cache versions: WebMCP 10, voice 9, contracts 16.

## Validation

Final affected command:

```text
node --test test/a12-stale-network-copy.test.cjs test/cache-version-follows-content.test.cjs test/expired-settlement-close.test.cjs test/profile-lifecycle-action-gating.test.cjs test/voice-commands.test.cjs test/resale-listing-flow.test.cjs test/webmcp-tools.test.cjs test/webmcp-agent-actions.test.cjs
```

- 172 checks pass. Includes one-wei floor boundaries, inactive edit/removal,
  cancellation after transfer, stale reviews before/after approval, wallet/chain/
  adapter replacement, pending/declined/rejected confirmation, revoked access,
  strict identifiers and the shared voice/WebMCP lock.
- `npm run build` passes, including built-route and Tailwind verification.
- Initial CI40738564744 exposed one stale secondary cache-version assertion in
  `a12-stale-network-copy.test.cjs`; corrected to the shipped adapter version 16.
  The expanded affected suite above includes this regression guard.
- Actual browser fixture: Classic/Future x 390/1366 px x EN/RU, eight journeys,
  56 checks and 32 real custom confirmation interactions. Checks initial refusal,
  list/edit/cancel, no writes before consent, inactive actions, question refusal,
  modal/panel bounds and closure. Zero page exceptions or API writes.
- Local artifacts: `output/b30-all-focused.log`, `output/b30-build.log`,
  `output/b30-browser-fixture.log`, `output/playwright/b30-resale-fixture.js` and
  `output/playwright/b30-resale-review-mobile.png` (ignored, not public assets).
- Bounded independent review found adapter replacement during the last awaited
  check; the guarded captured writers and regression cases resolve it. Final
  scoped review reported no remaining concrete defects.

## Interpretation and limits

Canon sections 4 and 9 apply. No contract, economics, floor or lifecycle amendment.
The explicit edit command intentionally refuses an inactive listing; listing is
a separate command. Original-seller cancellation follows existing contract rules.
Question punctuation now prevents all financial commands, matching their existing
documented intent. No dependency or paid provider was added.

Browser contract transports are synthetic. No real signature, microphone,
mobile-device or ChatGPT in-app-browser financial acceptance is claimed. The
deployed contract has no expected-old-listing argument: changes after transaction
submission cannot be prevented by a frontend snapshot; contract authorization and
price/floor checks remain authoritative. B12 and Phase B remain open for their
remaining acceptance and beta gates.

## Release

PR [#383](https://github.com/maysonkiller/ArtSoul-Protocol/pull/383) merged as
`268808687ef66b41d9b4db5088aa320ee0598a93`. Its source tree matches the checked
candidate `d028e9b8d3d3e98575e8b8e70660a68b387e4df6`.

- Exact-candidate CI40739293538: Linux 2,871 pass / two skips; Windows 2,476
  pass / 32 skips; 49 contract checks per runner, builds and static checks pass.
- Preview7393093202 and production7393179527 succeeded. Each passed seven route
  checks and three exact runtime-content comparisons. Production was compared
  with the merged Git revision, not subsequent local microphone changes.
- Both preview and apex passed four guest browser journeys / 20 checks across
  Classic/Future, mobile/desktop and EN/RU: explicit refusal without a connected
  wallet, help, panel bounds and closure. Zero page exceptions or API writes.
- Post-merge CI40739908758 succeeded. Local evidence:
  `output/b30-final-preview-assets.log`, `output/b30-final-preview-browser.log`,
  `output/b30-production-assets.log`, `output/b30-production-browser.log`.

The follow-up microphone consent review is recorded separately in
`B21_AUDIO_CONSENT_2026-10-28.md`; it does not turn fixture financial acceptance
into a real signed transaction.
