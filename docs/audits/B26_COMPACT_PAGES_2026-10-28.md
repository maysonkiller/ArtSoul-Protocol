# B26: compact pages and visible artwork image controls

Date: 2026-10-28. Workspace: `C:\Projects\ArtSoul`, branch
`codex/takeover-audit`, starting HEAD `b854089b` (production `537bad1`).
Status: released in PR #377, production merge
`13bda8e5ffeea623d7a3f856c904516ec9885496`.

## Scope and observations

The founder requested a compact, coherent interface across pages, then supplied
a 4:22 desktop recording. The full recording was inspected through 131 frames
at two-second intervals and selected larger frames. An offline machine
transcription was used as an approximate aid; unclear speech is not treated as
a verified instruction. Raw frames, audio and transcription remain local.

| Video interval | Observation and disposition |
| --- | --- |
| 00:01-00:35 | Telegram retained the old homepage preview while X used the new banner. Current read-only crawler checks pass for the new asset; no claim that the site's response can evict Telegram's stored preview. |
| 00:41-01:05 | Profile editor framing and spacing are oversized for the laptop. Reduced spacing and desktop connection-row density; the visible manual Bio resize is normal browser behavior, not a persistence defect. |
| 01:07-01:17 | Staff inbox content arrives after opening. No cached staff role is used to bypass server authorization. Further measured latency work remains separate. |
| 01:33 onward | Ownership contains continuous decorative glow/color animation. Removed the loops and restrained its shadow while retaining the Future palette and identity data. |
| 01:47-01:54 | Donate history uses a large selector for two sort choices. Replaced it with two compact, keyboard-accessible pressed-state buttons. |
| 02:07-02:39 | Images enlarge on click but lack a visible action comparable to video controls. Added View full size and a guarded HTTPS Open original link for images/GIFs. |
| 02:42-03:15 | Homepage explanations take priority over artwork on the first laptop screen. Moved Discovery Spotlight above the three-step explanation and reduced short-desktop whitespace. |
| Around 02:50 and 03:19 | Added a static desktop wordmark with the existing mobile mark; shortened the public footer label to X. |
| 03:40-04:16 | Future desktop navigation/account-menu restructuring remains a B18 follow-up. It is not silently bundled into an authentication change. |

## Implementation and boundaries

- Shared short-desktop layout applies at widths of at least 1024px and heights
  up to 850px: home, gallery, artwork, upload, profile, Admin, documentation and
  collection builder. No global zoom, root-font shrink or new page scroll lock.
- Homepage artwork moves earlier in the actual DOM order on all devices.
  Desktop branding is static HTML, avoiding a late JavaScript insertion.
  All ten existing shared stylesheet references advance to version 57.
- Mobile profile text fields remain 16px; name height is 46px and Bio starts at
  70px. Labels, placeholders, immediate provider changes and Save/Cancel
  semantics remain intact. Desktop connected accounts use three columns.
- Image enlargement uses the native dialog top layer, blocks background focus,
  closes through Escape/backdrop/close, and restores the initiating focus and
  previous body overflow. Original-file navigation requires the existing
  storage guard plus HTTPS and uses `noopener noreferrer`.
- Donate history retains the existing query/pagination model and one content
  scroller. Changing sort resets the page; no donation or complaint is sent by
  these checks.
- No dependency, schema, contract, economic, fee, role or signer changes.
  Theme colors use the established variables. Palette separation remains.

## Validation

All browser data below are synthetic fixtures with wallet writes blocked, not
physical-phone or financial acceptance. Screenshots were inspected.

| Check | Result |
| --- | --- |
| Build | Pass; 11 HTML entries and 173 generated Tailwind utilities verified. |
| Focused source/behavior suite | 155 checks pass; the extended Donate sort test and five image-control tests also pass in the subsequent 12-check run. |
| Baseline rendered matrix | 98 cases across seven pages, two themes and seven viewport sizes; no page exceptions or horizontal overflow. |
| Candidate rendered matrix | Same 98 cases pass, from 320px mobile through 1920px desktop, including short desktop and landscape. Browser zoom stays 1. |
| Profile editor | Eight current-markup cases pass: labels, empty/filled placeholders, 16px fields, Cancel, overflow and desktop/mobile connection layout. |
| Donate history | Ten cases pass: long rows, both sort states, pagination, nested Report close/focus, reachable controls, one content scroller and stable background geometry. |
| Artwork image controls | Eight local fixture cases pass: native modal state, original link, visible/keyboard activation, background focus exclusion, Escape/close and focus/overflow restoration. Preview exposed a rapid-close focus failure through the real global click guard; image controls now use its existing UI-toggle exemption. Six source behavior tests cover image/GIF, rejected URLs/guards and the actual rapid-click listener. The affected 18-test group and rebuilt artifact pass; final preview and apex pass after this repair. |
| Social preview HTTP | 32 metadata requests, 12 images and three aliases pass across browser/Telegram/X/Facebook agents. Current homepage and generic fallback use the new banner. |
| Independent bounded review | No actionable findings in final compact/header cascade, image dialog, theme separation or Donate sorting. |
| Full local tracked unit run | 2820 passed; one outdated provider-row assertion expected exactly 60px. Replaced that arbitrary size expectation with the 44px minimum touch-target invariant; exact-candidate CI must pass before release. |
| Whitespace | `git diff --check` passes. |

At 1366x700, the homepage Spotlight heading moves from y=664.64 to y=370.42;
the first card starts at y=412.42. This is a 294px reduction in introductory
height, not a promise that all page content fits on one screen. The gallery
matrix includes an empty Discovery result; populated production reads are a
separate release check. Local evidence is in `output/audit/b26-*.log` and
`output/playwright/`; private fixtures are excluded from the public repository.

## Interpretations and remaining work

This slice touches Bible sections 5 (presentation/provenance), 16 (visual/theme)
and 17 (Phase B). It changes presentation under the founder's explicit direction;
architecture and the publish/auction/settlement/mint lifecycle are unchanged.
Interpretations for the maintained design guide:

1. Compact means reducing framing and whitespace while preserving readable
   text, touch targets and natural scrolling; not fitting an unlimited feed
   into one fixed viewport.
2. Golden-ratio proportions are optional composition guidance, not a mandatory
   multiplier for controls or a reason to violate accessibility.
3. The requested original/download affordance is Open original: browsers do
   not guarantee cross-origin forced downloads. No false download promise.
4. Desktop wordmark/mobile mark and restrained Ownership motion are applied
   consistently in both themes. Other Future navigation changes remain B18.
5. Existing architecture/design skills are reused; no duplicate skill or
   visual dependency was introduced.

Phase B is not complete. Real-user beta journeys/operation, snapshot gates,
remaining notification acceptance, ordinary-user command preparation and final
visual work retain their individual backlog status. No mainnet, new collection
deployment, broadcast source or live wallet ceremony is implied by this report.

## Release evidence

- PR: https://github.com/maysonkiller/ArtSoul-Protocol/pull/377.
  Final candidate `d23960050cc5bb6d6d8585d13d1206793e66c8bd`; merge tree matches it
  exactly. Production merge `13bda8e5ffeea623d7a3f856c904516ec9885496`.
- Exact-candidate CI 40689668153 passes: Linux 2820 passed/two skipped;
  Windows 2425 passed/32 skipped; zero failures, builds/static checks and
  49 contract tests on each platform. Post-merge CI 40690418396 also passes.
- Earlier candidate CI 40688853210 hit an unrelated 20-second Windows DPAPI
  self-test timeout. No credential code or security assertion was weakened;
  the final candidate's unchanged DPAPI test passes.
- Preview and apex checks each verify eight HTML routes, matching header and
  39 asset hashes, expected runtime configuration and protected guest endpoints.
  Apex evidence: `output/audit/b26-apex-verification.log`.
- Actual deployed browser, with real public reads and no synthetic route
  interception: 32 preview and 32 apex cases pass across eight pages, both
  themes, 1366x700 and 390x844. Native image open/rapid Escape/focus restoration
  pass with the real global click guard. No page exceptions or API writes.
- An additional six populated-preview gallery cases pass at 1366, 390 and
  320px, both themes. Apex renders 16 homepage cards and 29 Discovery cards;
  no horizontal overflow. These counts are observations, not product claims.
- Final build and the 18 affected behavior checks pass. Screenshots were
  inspected. Public guest/profile/collection-draft rendering is not evidence
  of authenticated profile editing, mainnet collection deployment or a new
  physical iPhone acceptance.
- Sources of record: `output/audit/b26-final-ci.log`,
  `b26-final-preview-verification.log`, `b26-final-preview-browser.log`,
  `b26-preview-populated-gallery.log`, `b26-apex-verification.log`,
  `b26-apex-browser.log`, `b26-final-focused.log` and `b26-build-final.log`.

Exactly next: resume B21 Donate/Report command preparation through the existing
review dialogs without automatic signing. B18 Future navigation and subsequent
visual work remain explicitly open.
