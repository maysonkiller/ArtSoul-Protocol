# B16 profile layout UI

Status: implemented and tested locally; release and activation pending.

Workspace: `C:\Projects\ArtSoul`, branch `codex/takeover-audit`. Started at
`7df28f55cd3049221d24b0136e14a05762ba2500`; the shared branch advanced to
`d1549c6f13a907d235677fb6ccd41bb123425cd7` during the independent B15 release.

## Implemented slice

The owner-only Customize profile editor sits above the existing profile sections.
It offers Standard grid or Featured artwork, one optional uploaded cover, one
pinned artwork and up to three named sections containing at most twenty distinct
deployment-scoped works. Both sections and selected works have keyboard-operable
Move up/down controls. Preview, Save layout, Cancel and Restore default are
separate actions; restoring defaults changes only the draft until saved.

Public selections reuse the shared artwork cards and their creator, actions,
status and provenance presentation. Missing, hidden and old-deployment cards are
omitted; their stored pointers remain available to the owner for removal. The
editor does not read or publish Saved, email, notifications or staff data.

Only works created by the profile or NFTs it currently owns are selectable. This
is the founder-delegated initial policy, shared with the backend validator;
ownership of an NFT is not described as ownership of its copyright. Cover help
requires an image the user created or has permission to display. No raw URL,
HTML, coordinates, custom theme, badge or aura controls are provided.

Implementation is in `src/features/profile/profile-layout.jsx` and
`profile-layout-state.js`, with a small `profile.jsx` mount and scoped theme-based
CSS. The shared `profile-layout.js` validator/defaults/constants/policy are reused.
Cover upload calls the separately implemented
`ArtSoulDB.uploadProfileCover(file, wallet, {signal})`; no alternate upload path is
introduced here. `profileLayout.enabled` keeps the whole feature gated.

## Correctness boundaries

- Public layout metadata and card hydration must match both wallet and revision.
  A stale hydration response cannot replace a newer layout.
- Save uses `expected_revision` and `X-ArtSoul-Wallet`. Only `LAYOUT_CONFLICT`
  forces a reload; an unavailable work remains removable from the retained draft.
- Cancel, account changes, sign-out and component disposal retire pending edits.
  A delayed upload/sign-in cannot mutate a new draft or initiate a later write.
- Cancel aborts a pending cover upload. A sent save cannot be undone by cancelling
  a client request; the UI disables Cancel during that write, and a retired
  response never repaints another account.
- Existing avatar decode, profile tab caches, ownership predicates and profile
  detail Save/Cancel are unchanged.

Interpretations: engineering limits are three sections/twenty distinct works;
Sales stays the prior B15 subset. Standard and Featured differ only in responsive
layout, with the visitor's Classic/Future variables. No architecture or economic
canon amendment is introduced; the product direction section 4 is the UI source.

## Validation and remaining verification

- UI/controller focused tests: **20 passed**, covering public rendering, exact
  deployment keys and uint IDs, keyboard controls, selection bounds, CAS conflict,
  unavailable work correction, stale hydration, repeated saves and account/upload
  cancellation races.
- Final `node --test --test-concurrency=4` over the existing
  `test/profile-*.test.cjs`, `test/profile-*.test.mjs`, `test/profile-*.test.js`,
  `test/saved-*.test.mjs` and `test/saved-*.test.cjs`: **242 passed, 0 failed,
  0 skipped**. This includes concurrently completed backend profile-layout tests
  and disposable PostgreSQL checks present in the shared tree.
- Final `npm run build`: passed, including 11 HTML routes and 174 Tailwind
  utilities; existing dependency PURE-annotation warnings remain.
- Edited tracked source/style `git diff --check`: passed.

No live OAuth, wallet signature, cover upload, browser-layout or physical-device
ceremony was performed here. Next step: independent source and isolated browser
checks in both themes, desktop/mobile widths, long section titles, preview/cancel,
cover failure and current-user versus visitor views. Backend migration/activation
and release remain with the main task.

## Root integration and data review

The additive `profile_layouts` table has forced RLS and explicit grants: service
read plus a SECURITY DEFINER save RPC, no direct service writes and no client
access. The RPC atomically compares the expected revision; parallel editors
cannot overwrite one another. Public card reads reuse the current bounded,
moderation-safe deployment projection. Old references stay stored for editing,
but unavailable, hidden, transferred or old-deployment works do not appear.

Cover authorization reuses signed Storage uploads, with a wallet-scoped random
path, raster MIME allowlist and 5 MB publication bound. Saving verifies the actual
stored response size, MIME and signature with bounded fetching and no redirects.
This is not a full image decoder or copyright check. Existing artwork/metadata
upload limits remain unchanged. Unused uploaded covers are not automatically
deleted; retention/cleanup is an operational follow-up, not part of Cancel.

Root focused integration: 34 passing API, cover, shared-validator, controller and
render checks. Actual PostgreSQL schema/CAS checks: 6 passed; no-implicit-Data-API
grant integration: 13 passed. All zero skips. Full candidate CI is still required.

Root isolated Chrome checks used the actual component and shared cards with
synthetic accounts and an in-memory API: Classic 390px, Future 320px and 1440px;
long titles, pin/section preview, save, Cancel and unsaved Restore default,
visitor/editor separation, zero horizontal overflow. Screenshots were inspected
under `output/playwright/b16-*`. An initial fixture omitted the existing artwork
URL dependency; it was corrected in the fixture and the flow rerun. No production
defect or device acceptance is claimed from that harness error.

## Rights and operating boundary

The founder delegated the initial selection rule. Authored works and currently
owned NFTs are a conservative product scope, not proof of copyright permission.
NFT acquisition does not automatically transfer copyright: see the
[USPTO/USCO report, section II.A.4](https://www.uspto.gov/sites/default/files/documents/Joint-USPTO-USCO-Report-on-NFTs-and-Intellectual-Property.pdf)
and [Eurojust's NFT/IP review](https://www.eurojust.europa.eu/publication/non-fungible-tokens-and-intellectual-property-rights-can-use-ntfs-lead-ip-infringements),
reviewed October 24, 2026. Creator attribution and existing artwork complaint
controls remain visible. No new licensing grant, resale right or guarantee of
legal clearance is created. Launch terms and jurisdiction-specific legal review
remain founder work.

The cover follows the existing profile-image model. The artwork complaint queue
does not yet target a profile cover or section caption; extending notice/removal
to those profile fields and defining unused-cover retention remain explicit
operational/legal follow-ups before broader public use. Disabling the feature
hides customization without deleting saved records or changing NFT state.
