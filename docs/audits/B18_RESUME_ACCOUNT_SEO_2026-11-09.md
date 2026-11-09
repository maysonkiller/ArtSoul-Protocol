# B18 resume: account plaque, private inventory and profile canonicals

## Scope and recovery

The founder selected account plaque A, requested the same-width lower frame,
aligned text and separate name/address hover/copy feedback from B. The November
9 request also asks to reconcile intervening work and inspect Search Console.
This slice changes no economics, roles, write networks, provider credentials or
billing. Both established palettes remain; Classic feedback stays static.

The active checkout is `C:\Projects\ArtSoul`. Before syncing it, the tracked
unfinished work was preserved in an ignored recovery patch and retained Git
stash. The branch was fast-forwarded from `fdc40245` to `d3f3638c`; five incoming
commits cover the private Wallet NFTs tab, gated multichain inventory, provider
diagnostics, card network frames, first paint, Guide and upload controls. No
historical worktree was copied over this checkout. Unrelated unfinished audit,
authority-policy and capacity work is not part of this release.

## Corrections

- Restore the missing menu-identity helper still called by the account menu.
  Never use a resolved profile belonging to a different connected wallet.
- Use sibling name/address copy controls and an avatar menu button, with
  keyboard feedback, clipboard-failure fallback and stale-wallet guards.
  The desktop plaque and menu both measure 184 CSS pixels. On mobile the
  avatar remains 44 pixels and the open menu exposes copyable identity.
- Correct old shared CSS overriding the new identity dimensions and layering.
  Mirror structural dimensions in critical first-paint CSS and bump shared
  runtime/style versions on every header route.
- Preserve B36's multichain gate. The enabled Base inventory remains a private
  owner tab before Saved. Other profile tabs do not initiate inventory reads.
  Cards reserve consistent title space; details use one contained native
  dialog with Escape and focus restoration. Swipes use bounded pagination.
- Display the cached public Coinbase ETH/USD reference separately from NFT
  purchase amount/venue, which remain unverified without sale evidence. The
  quote endpoint reuses owner authentication and request limits, adds no DB
  reads, paid key, dependency or background polling, and has timeout, byte cap,
  cache, deduplication and failure backoff. No additional chain is activated.

## Search Console findings

Read-only inspection of the correct `artsoulprotocol.com` property found six
indexed URLs, two alternate canonical URLs and one redirect in the report
updated November 6. The alternate URLs were public profiles for addresses
`0x6EC8C121043357aC231E36D403EdAbf90AE6989B` and
`0xcF94a13e647b1C07Ed23ed840604B16b56BdE7Ce`.

Those distinct author pages inherited the static `/profile` canonical. The
profile shell now emits one canonical synchronously from a valid normalized
public address parameter, independent of the connected wallet. It removes
tracking parameters and updates `og:url`; invalid addresses use `/profile`.
The initial document contains no contradictory generic canonical link.

The redirect entry is `http://artsoulprotocol.com/`. Its HTTPS redirect is
intentional and must remain. No Search Console validation or removal request
was submitted. Deployment does not establish that Google has recrawled or
indexed the corrected author pages.

References:
- [Google Page indexing report](https://support.google.com/webmasters/answer/7440203)
- [Google JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- [Google canonical consolidation](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)

## Verification and limits

- Local unit suite: 3,520 tests, 3,485 passed, 35 skipped, zero failures.
- Production build, built-route verification and Tailwind verification passed.
- The real shared account implementation was rendered with synthetic identity
  at 320, 390, 768 and 1366 pixels in Classic and Future. All eight combinations
  kept the menu inside the viewport without horizontal page overflow; desktop
  plaque/menu widths matched. Screenshots were visually reviewed.
- Private inventory checks at those same eight width/theme combinations found
  equal card heights, no horizontal overflow and contained details. Landscape
  (844 by 390 pixels) kept the dialog in view. Pagination, expired-session
  clearing/sign-in recovery and rejecting a delayed previous-wallet response
  were exercised using synthetic data. Desktop and mobile dialogs were reviewed.
- Dedicated behavioral tests exercise profile canonical generation, clipboard
  context guards, private query/auth boundaries and bounded quote handling.

Browser fixtures contain synthetic accounts, not real wallet signing or native
iPhone proof. Current upstream worker activation, independently durable recovery,
remaining signed journeys and native-device acceptance stay separate Phase B
gates. No extra subscription, account quota or spend-cap change was made.

## Released and checked on the normal domain

- [PR470](https://github.com/maysonkiller/ArtSoul-Protocol/pull/470) merged as
  `651db8a3271a1bf8754489ccee79cd9c9fea77de`. PR CI run `42609542176` and
  main CI run `42610195872` passed static checks, builds, unit tests and
  contract tests on Linux and Windows. No contract source changed.
- Production deployment `dpl_GQGJJERyHNpSzyNjtiaC3qFeKTxM` is READY with that
  exact source commit and aliases `artsoulprotocol.com` and
  `www.artsoulprotocol.com`. The prior production deployment was retained.
- At 11:38 UTC, Home, Gallery, Artwork 13, Profile, Publish, Collection Builder,
  Admin and Guide returned HTTP 200 and the current account/prepaint versions.
  Sixteen shared/built stylesheet and script assets matched the local build
  after CRLF/LF normalization. The first probe incorrectly expected the source
  stylesheet URL in built HTML and byte equality across Windows/Linux line
  endings; the corrected probe checks the actual content-hashed stylesheet URLs
  and normalizes line endings. Both results are retained privately.
- Anonymous access to `/api/wallet-nfts?quote=eth-usd` returned HTTP 401 with
  `Cache-Control: private, no-store`. No provider request or private inventory
  is authorized by that anonymous probe.
- The normal-domain browser showed one address-specific canonical and matching
  `og:url` for each of the two author URLs reported by Google, with normalized
  lowercase addresses and tracking parameters removed. An invalid address
  emitted only the generic `/profile` canonical; its public-profile API request
  was rejected with HTTP 400 as expected.
- The loaded public author page showed the expected profile and a 184-pixel
  account plaque and menu, without horizontal overflow. No application error
  occurred on that valid profile route. Browser automation here is desktop
  Chromium, not a new native iPhone or wallet-extension acceptance claim.
- `http://artsoulprotocol.com/` returned HTTP 308 to HTTPS. This intentional
  redirect is not an SEO defect and was not removed. Google's subsequent crawl
  and indexing outcome remain external observations, not inferred from release.

This closes the bounded account/inventory/SEO implementation and release slice.
The remaining operational and real-device gates in the Phase B status remain
open; this release does not declare Phase B or the public beta complete.
