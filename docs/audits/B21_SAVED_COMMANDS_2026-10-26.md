# B-21 explicit Saved commands

Status: implemented and locally verified; release checks pending. Canonical
checkout `C:\Projects\ArtSoul`, branch `codex/takeover-audit`, starting HEAD
`a5ad479`. This is a bounded B-21 slice, not completion of Phase B.

## Scope and cause

The text/voice assistant exposed the original auction tools but had no Saved
commands. Calling a bookmark button's toggle would make a repeated command undo
the desired result. Cards, artwork and profile already share `savedStore` and an
idempotent, session-bound `/api/saved` endpoint; those remain the only state/API.

This touches Bible sections 16/17 and the existing B-21 ordinary-user assistant
boundary. No economics, contract, schema, Trust, ranking, role or network changes.
No new dependency or model/provider integration.

## Implementation and interpretation

- `add_to_saved` and `remove_from_saved` require an exact positive uint256 artwork
  ID string from its URL. The active deployment comes from existing configuration.
  They never infer a target from a title, auction ID, token ID or current page.
- Each command sets a boolean through the existing singleton. Repeated adds keep
  the item saved; repeated removals keep it removed. Server acknowledgement is
  required even if cached state matches. The shared per-item lock rejects
  conflicting clicks/commands with a visible busy answer.
- Existing authenticated sessions are reused. Commands do not open the wallet,
  sign in automatically or resume after an expired login. The user signs in
  through ordinary controls and deliberately repeats the command.
- Wallet, auth, storage and page-lifecycle invalidation retire pending replies.
  A stale response cannot repaint another account's list or report success.
- English/Russian explicit grammar, help and replies share the same tools.
  Negations, questions, compound/multiple-ID and malformed Saved requests never
  become a Saved action. Low-confidence speech refuses mutations; typed replies
  remain silent. Financial approval/signature gates remain unchanged.
- Commands work where the existing singleton is mounted: Home, Gallery, Artwork
  and Profile. Other command pages return an availability message. No second
  store or background assistant import is added to creation/docs pages.
- These are private reversible preferences. No implicit email subscription,
  public favorite count, unrestricted language understanding or admin action.
- Hosted browser reproduction found the generic capture-phase click guard
  disabled Send before native form submission on Gallery. Send now bypasses
  that generic guard, retaining the command panel's own pending lock. Repeated
  submit and close/reopen still cannot duplicate an in-flight request.

## Verification

- Final focused command/Saved/API/card/cache group: 175 passed, zero failed/skipped.
  Command: `node --test test/cache-version-follows-content.test.cjs test/saved-commands.test.mjs test/saved-state.test.mjs
  test/saved-api.test.mjs test/voice-commands.test.cjs test/webmcp-tools.test.cjs
  test/webmcp-agent-actions.test.cjs test/command-panel.test.cjs
  test/artwork-card-controls.test.cjs`.
- `npm run build` passes, including HTML-entry and Tailwind validation.
- Browser: eight theme/width combinations (Classic/Future, 320/390/768/1440).
  Real command parser, tool adapter, singleton, card/detail controls and React
  SavedList, including the real global click guard, run against a synthetic private transport. Repeated add/remove,
  cross-surface removal, English/Russian commands and panel bounds pass. Additional
  held-response checks pass for account switching, collision and expired auth.
  The initial fixture lacked the existing artwork URL helper; adding that fixture
  dependency resolved its render error, with no application workaround.
- Initial CI 40317130816 failed only the two cache-pin checks on each platform;
  the page versions had changed but the expected hashes had not. The pins were
  updated without weakening their assertions. Final candidate CI remains pending.
- Evidence: `output/audit/b21-saved-focused-final.log`, `b21-saved-build-final.log`,
  `b21-saved-browser-final.log`; screenshots `output/playwright/b21-saved-*.png`.
  No new physical-phone, microphone-service, native WebMCP client, wallet-signature
  or live-account mutation acceptance is claimed by these fixture checks.

Exactly next implementation step after release: B-21 reuse of global public
artwork/artist search through the assistant, without a separate search corpus.
Publication drafts, Donate/report preparation, aggregate favorite counts and
the B-18 final visual pass remain separate.
