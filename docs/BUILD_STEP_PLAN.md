# Browser Build Migration — Step 1 Audit and Step 2 Plan

Status: audit and written plan only. This document does not authorize or implement runtime changes.

## 1. Objective and boundaries

The eventual Step 2 migration should:

- precompile JSX instead of compiling it in the browser with Babel Standalone;
- bundle page entrypoints and shared dependencies into cacheable, hashed assets;
- replace avoidable serial read waterfalls with explicit parallel read groups;
- show geometry-matched skeletons so each page appears as one stable composition;
- preserve the existing static multi-page URLs and Vercel serverless API routes;
- remain visually and functionally identical while each page is migrated.

Step 1 changes no application behavior, visuals, wallet behavior, contracts, lifecycle rules, or data logic. No build scaffold is added in this PR because a documentation-only change is the lowest-risk review unit.

## 2. Canon constraints

No protocol conflict is introduced by this plan. Step 2 must preserve:

- `docs/canon/ARTSOUL_CANON_BIBLE_FULL.md` §1: contracts and receipts remain protocol truth; public pages continue to read indexed `/api/public/artworks` projections.
- §2–§4: lifecycle, lazy minting, settlement, and floor behavior cannot move into or be reinterpreted by the build layer.
- §5: Creator / First Collector / Owner labels and provenance remain unchanged.
- §6 and §12: Trust and AI valuation remain guidance/discovery-only.
- §13: Classic/Future color semantics and the existing mobile layout behavior remain unchanged. Skeleton colors must use existing `--c-*` variables.
- The root `AGENTS.md` rule that the internal version label must not appear in UI or public build metadata.

Potential canon-sensitive risk: bundling can change execution order. Step 2 must not initialize wallet, contracts, indexed projections, or status resolution in a different semantic order merely to improve perceived speed.

## 3. Current delivery model

The site is a root-level static multi-page application. `vercel.json` contains only API rewrites; there is no frontend build command or output directory. HTML files are deployed directly, while `api/[...route].js` and its imported server modules remain Vercel functions.

Current browser work includes:

- Tailwind's browser CDN on every root page except `generate-favicon.html`;
- many ordered classic scripts that publish `window.*` globals;
- mixed classic and `type="module"` scripts;
- remote ESM imports for Reown, Supabase, and ethers;
- React UMD + ReactDOM UMD + Babel Standalone on four pages;
- large inline application bodies, including 148 KB of JSX in `artwork.html` and 88 KB in `profile.html`.

The mixed model makes ordering implicit. `src/index.js` currently compensates with a 100 ms delayed global-dependency check before creating services.

## 4. Exact Babel / browser-JSX inventory

Only these pages compile JSX in the browser:

| Page | React / Babel tags | JSX block | Mount |
|---|---|---|---|
| `artwork.html` | lines 278–280: React 18 production UMD, ReactDOM production UMD, `@babel/standalone@7.26.10` | starts line 282, approximately 148 KB | `ReactDOM.render(<ArtworkPage />...)` near line 2901 |
| `gallery.html` | lines 128–130: React 18 production UMD, ReactDOM production UMD, Babel Standalone | starts line 132, approximately 45 KB | `ReactDOM.render(<GalleryPage />...)` near line 880 |
| `profile.html` | lines 260–262: React 18 production UMD, ReactDOM production UMD, Babel Standalone | starts line 264, approximately 88 KB | `ReactDOM.render(<ProfilePage />...)` near line 1771 |
| `docs.html` | lines 545–547: React 18 **development** UMD, ReactDOM **development** UMD, Babel Standalone | starts line 549, approximately 14 KB | `ReactDOM.render(<DocsApp />...)` near line 749 |

Pages without Babel/JSX are `index.html`, `upload.html`, `auction-system.html`, `visual-lab.html`, and `generate-favicon.html`. They still contain large inline classic scripts and should receive page entrypoints later, but they do not need JSX conversion.

Line numbers are audit anchors for the current `main`; Step 2 should search by script URL/type rather than assume the anchors remain fixed.

## 5. Complete page script inventory

Lists below preserve current HTML order. “Inline” includes executable blocks not represented by a `src` URL.

### `artwork.html`

1. inline theme preflight
2. `https://cdn.tailwindcss.com`
3. `src/ui/theme-manager.js`
4. `src/ui/theme-validator.js`
5. `src/ui/status-banner-system.js`
6. `src/ui/navigation-manager.js?v=4`
7. `src/ui/system-logger.js`
8. `src/ui/log-viewer-ui.js`
9. inline UI-system bootstrap
10. `modal-system.js`
11. `supabase-client.js` (module)
12. `supabase-auth.js` (module)
13. `src/features/artwork/ai-valuation-client.js?v=1`
14. `src/features/discovery/discovery-service.js?v=1`
15. `src/ui/components/artwork-card.js?v=7`
16. `avatar-dropdown.js?v=12`
17. `appkit-init.js?v=15` (module)
18. `contracts-config.js?v=1`
19. `contracts-integration.js?v=3` (module)
20. `src/core/auction-engine-final.js`
21. `src/core/economy-engine.js`
22. `src/core/app-controller.js`
23. `src/index.js` (module)
24. React 18 production UMD
25. ReactDOM 18 production UMD
26. Babel Standalone
27. inline `text/babel` page application
28. inline status-banner bootstrap

### `gallery.html`

1. inline theme preflight
2. Tailwind browser CDN
3. theme manager
4. theme validator
5. status banner system
6. navigation manager
7. system logger
8. log viewer UI
9. inline UI-system bootstrap
10. modal system
11. Supabase client (module)
12. Supabase auth (module)
13. discovery service
14. artwork-card component
15. avatar dropdown
16. AppKit (module)
17. contracts config
18. contracts integration (module)
19. auction engine
20. economy engine
21. app controller
22. `src/index.js` (module)
23. React production UMD
24. ReactDOM production UMD
25. Babel Standalone
26. inline `text/babel` gallery application
27. inline status-banner bootstrap

### `profile.html`

1. inline theme preflight
2. Tailwind browser CDN
3. theme manager
4. theme validator
5. status banner system
6. navigation manager
7. system logger
8. log viewer UI
9. inline UI-system bootstrap
10. modal system
11. Supabase client (module)
12. Supabase auth (module)
13. discovery service
14. artwork-card component
15. avatar dropdown
16. AppKit (module)
17. contracts config
18. contracts integration (module)
19. auction engine
20. economy engine
21. app controller
22. `src/index.js` (module)
23. `oauth-integration.js`
24. React production UMD
25. ReactDOM production UMD
26. Babel Standalone
27. inline `text/babel` profile application
28. inline status-banner bootstrap

### `docs.html`

1. inline theme preflight
2. Tailwind browser CDN
3. inline legacy theme bootstrap
4. theme manager
5. status banner system
6. inline status bootstrap
7. modal system
8. Supabase auth (module)
9. Supabase client (module)
10. avatar dropdown
11. AppKit (module)
12. React 18 development UMD
13. ReactDOM 18 development UMD
14. Babel Standalone
15. inline `text/babel` docs application

### `index.html`

1. inline theme preflight
2. Tailwind browser CDN
3. theme manager
4. theme validator
5. navigation manager
6. system logger
7. log viewer UI
8. admin control panel
9. status banner system
10. inline UI-system bootstrap
11. modal system
12. Supabase auth (module)
13. Supabase client (module)
14. discovery service
15. artwork-card component
16. avatar dropdown
17. contracts config
18. contracts integration (module)
19. AppKit (module)
20. inline homepage/profile application (approximately 40 KB)
21. inline theme validation

### `upload.html`

1. inline theme preflight
2. Tailwind browser CDN
3. theme manager
4. theme validator
5. navigation manager
6. status banner system
7. system logger
8. log viewer UI
9. inline UI-system bootstrap
10. modal system
11. Supabase auth (module)
12. Supabase client (module)
13. AI valuation client
14. avatar dropdown
15. AppKit (module)
16. `ipfs-client.js` (module)
17. contracts config
18. contracts integration (module)
19. auction engine
20. economy engine
21. app controller
22. `src/index.js` (module)
23. inline upload application (approximately 31 KB)

### `auction-system.html`

1. inline theme preflight
2. Tailwind browser CDN
3. inline legacy theme bootstrap
4. theme manager
5. status banner system
6. inline status bootstrap
7. modal system
8. Supabase auth (module)
9. Supabase client (module)
10. avatar dropdown
11. AppKit (module)
12. inline collapsible-section behavior

### Utility pages

- `visual-lab.html`: inline theme preflight, Tailwind browser CDN, and two additional inline visual-lab scripts. No React/Babel.
- `generate-favicon.html`: one inline canvas script. No external JavaScript.

## 6. Dependency graph and bundle boundaries

These are the current verified dependency edges. Step 2 should convert them to explicit imports before removing compatibility globals.

### Shared UI lane

- `theme-manager.js` owns the active theme and publishes ThemeManager/ThemeSync globals.
- `theme-validator.js` requires the theme manager and the final DOM/CSS.
- `system-logger.js` precedes `log-viewer-ui.js`.
- `status-banner-system.js`, `navigation-manager.js`, and `modal-system.js` are global UI services.
- `avatar-dropdown.js` reads wallet events, profile display helpers, `ArtSoulDB`, and navigation labels.
- `artwork-card.js` reads `ArtSoulSecurity`, discovery helpers, canonical status/media helpers, and profile display helpers.

Recommended chunk: `shared-ui-[hash].js`, with small explicit modules instead of one mutable global initializer.

### Data/auth lane

- `supabase-client.js` fetches `/api/public/config`, dynamically imports `@supabase/supabase-js`, and publishes `ArtSoulDB`, `ArtSoulSecurity`, `ArtSoulProfileDisplay`, and `ArtSoulPublicConfig`.
- `supabase-auth.js` reuses `ArtSoulPublicConfig.load` when available, otherwise duplicates the public-config fetch, and publishes `SupabaseAuth`.
- discovery writes use `/api/discovery/*`; public reads use `/api/public/artworks`; moderation uses `/api/moderation/*`; AI uses `/api/functions/ai/analyze`.
- Server code under `api/` and `src/api/` is a separate Vercel function graph and must never enter browser bundles.

Recommended chunk: `shared-data-[hash].js`. Keep a temporary `window.ArtSoulDB` compatibility export while pages are migrated one at a time.

### Wallet/contracts lane

- `appkit-init.js` remotely imports Reown AppKit, the Wagmi adapter, and network definitions; it publishes wallet state/functions and wallet-state events.
- `contracts-config.js` publishes contract/network configuration.
- `contracts-integration.js` remotely imports ethers, consumes contract config and wallet providers, and publishes `ArtSoulContracts` plus transaction-error mapping.
- `auction-engine-final.js`, `economy-engine.js`, and `app-controller.js` consume DB/contract globals.
- `src/index.js` imports AuctionService, FileService, ArtworkService, UI components, status constants, error/loading/performance utilities, three AI engines, and the AI evaluation panel. AuctionService further imports ethers, system config, metrics, RPC client, and the five-part marketplace engine.

Recommended chunks: `vendor-wallet-[hash].js`, `shared-contracts-[hash].js`, and page-specific action code. Wallet code should be lazy-loaded on pages that do not need transactions.

### Page-only lane

- artwork: React page, AI valuation client, live-bid polling, moderation, auction actions.
- gallery: React page, discovery filters, artwork cards.
- profile: React page, OAuth integration, profile galleries, Genesis/trust reads, pending settlement reads.
- docs: React page only; no protocol service graph is required for content rendering.
- upload: IPFS, AI valuation, wallet/contracts, sequential publish flow.
- index: homepage discovery cards plus legacy in-page profile helpers.
- auction-system: static protocol documentation plus shared navigation/wallet shell.

Each becomes one page entry; shared imports let Vite create common chunks automatically.

## 7. Recommended toolchain

Use **Vite multi-page mode with `@vitejs/plugin-react`**.

Why Vite rather than a raw esbuild script:

- Vite uses esbuild for fast JSX transforms but also owns HTML entry rewriting, hashed assets, CSS extraction, modulepreload, dev serving, and Rollup production chunking.
- Multi-page HTML is a first-class Rollup input, matching the existing URLs without introducing a client router.
- A custom esbuild pipeline would require custom HTML rewriting, asset copying, chunk manifests, cache-busting, and dev-server behavior—the risky parts of this migration.
- Vite produces ordinary static files; it does not require a Node frontend server in production.

Proposed Step 2 dependencies, pinned in `package.json`:

- `vite`
- `@vitejs/plugin-react`
- `react` and `react-dom`
- npm versions matching the current Reown AppKit/Wagmi packages
- `ethers` matching current browser behavior
- `@supabase/supabase-js`

Do not upgrade library majors during migration. Dependency upgrades belong in later PRs.

Tailwind should be isolated into a later sub-step: first bundle JavaScript while retaining the Tailwind browser CDN, then pin and generate CSS after a class/safelist audit. Removing Babel and Tailwind runtime compilation simultaneously would make visual regressions hard to attribute.

## 8. Vercel/static hosting fit

Proposed `vite.config.js`:

- `appType: 'mpa'`;
- Rollup inputs for `index.html`, `gallery.html`, `artwork.html`, `profile.html`, `upload.html`, `docs.html`, `auction-system.html`, `visual-lab.html`, and `generate-favicon.html` until utility-page deployment is explicitly reconsidered;
- output to `dist/`;
- hashed JS/CSS/media under `dist/assets/`;
- source maps enabled for preview builds and disabled or hidden for production by policy;
- deterministic manual chunks only for large stable vendors; avoid over-fragmenting small modules.

Proposed Vercel settings in Step 2:

- build command: `npm run build`;
- output directory: `dist`;
- preserve every existing API rewrite in `vercel.json`;
- keep `api/` at repository root so Vercel continues to build serverless functions separately;
- add a deployed-preview smoke test for every HTML route and every `/api/*` rewrite before production promotion.

No SPA fallback should be added. Existing `.html` URLs and query parameters remain canonical.

## 9. Proposed source and output structure

Source:

```text
src/
  entries/
    index.js
    gallery.jsx
    artwork.jsx
    profile.jsx
    upload.js
    docs.jsx
    auction-system.js
    visual-lab.js
    generate-favicon.js
  shared/
    boot-theme.js
    ui.js
    data.js
    wallet.js
    contracts.js
    skeletons/
  ...existing feature/core modules...
```

Production output (illustrative hashes):

```text
dist/
  index.html
  gallery.html
  artwork.html
  profile.html
  upload.html
  docs.html
  auction-system.html
  visual-lab.html
  generate-favicon.html
  assets/
    vendor-react-a1b2c3.js
    vendor-wallet-d4e5f6.js
    shared-ui-112233.js
    shared-data-445566.js
    shared-contracts-778899.js
    page-index-aabbcc.js
    page-gallery-ddeeff.js
    page-artwork-123abc.js
    page-profile-456def.js
    page-upload-789abc.js
    app-abcdef.css
    ...images/fonts with hashes where imported...
```

Source HTML during Step 2 references one entry:

```html
<script type="module" src="/src/entries/artwork.jsx"></script>
```

Vite rewrites that in `dist/artwork.html` to hashed output and adds modulepreload links. React, ReactDOM, and Babel CDN tags are removed only after that page passes parity checks.

## 10. Data-loading audit

### `artwork.html`

Current initial path:

1. `ArtSoulDB.getArtwork(id)` blocks all content.
2. V4.1 live projection application is awaited.
3. Creator, First Collector, and Owner profiles are fetched **serially**.
4. Legacy votes are fetched, then the user's vote/discovery state is fetched.
5. Wallet provider → contract init → auction read is another serial chain.
6. Moderation visibility starts separately but may request authentication.

Step 2 read plan after the required artwork projection resolves:

- start profile reads with one `Promise.allSettled` (deduplicate equal addresses);
- start legacy vote/user-interaction reads in a separate parallel group;
- start the optional connected-wallet contract refresh in parallel with profile reads, while continuing to treat the indexed projection as public display truth;
- keep provider → contract init → contract read serial inside that independent group;
- keep live-bid polling single-flight as it is now.

Skeletons: title/byline, contained media rectangle, AI panel, auction rail, bid rows, and three provenance rows. Reveal each region when its own data is ready rather than holding the whole page behind one text loader.

### `gallery.html`

There is one main projection request after polling for `ArtSoulDB`; no network waterfall follows. The problems are runtime readiness polling and a full-page “Loading gallery...” replacement.

Step 2:

- import the data client directly so no polling is required;
- keep the existing request sequence guard or replace it with `AbortController`;
- retain one request per selected public view and cache the latest view result in memory;
- render the filter bar immediately and show a responsive card-grid skeleton below it.

### `profile.html`

Current path:

- profile fetch must complete before the profile-dependent effects start;
- artwork gallery and pending-payment loaders already start together after `profile` changes;
- `refreshDiscoveryProfile` fetches creator projections and only then reads Genesis contract state, although those reads are independent once the wallet address is known;
- the selected gallery and discovery profile can duplicate creator projection requests;
- pending payments correctly uses `Promise.all` for artwork detail reads, but it first loads all auctions and then performs an N+1 detail query.

Step 2:

- after address resolution, fetch profile, selected gallery projection, discovery corpus, and eligible pending-payment summary through shared cached promises where possible;
- run creator projection and Genesis state with `Promise.allSettled`;
- reuse the created-artwork projection for both gallery and trust computation;
- replace the pending-payment N+1 pattern only if an existing public projection can supply the same canonical fields; otherwise preserve it until a dedicated API change is reviewed separately;
- use independent skeletons for profile header, trust/Genesis panel, gallery cards, and pending settlement panel.

### `index.html`

The homepage has one public projection fetch, but startup depends on global scripts becoming ready and currently clears/rebuilds the gallery after the response. Legacy profile-tab reads are user-triggered and separate.

Step 2:

- import dependencies directly and begin the homepage projection request from the page entry;
- render the static header/hero immediately;
- reserve all 12 discovery card slots with skeletons to prevent layout shifts;
- keep pending-indexer merge, suppression, ranking, and status logic byte-for-byte equivalent during extraction.

### `upload.html`

The submission chain is intentionally sequential: wallet connection → auth → hash → media upload → metadata upload → contract registration → auction creation. Those steps have real data and transaction dependencies and must **not** be parallelized.

Safe Step 2 optimization:

- preload/import wallet, IPFS, AI, and contract modules once the page is idle or the user selects a file;
- allow file hashing, preview generation, and guidance request to share already-read file bytes where practical;
- keep every upload/transaction boundary and error message unchanged;
- show stable placeholders for preview and AI guidance, plus the existing explicit progress state for submission.

### Static/content pages

- `docs.html` and `auction-system.html` need no data skeleton. Their content should render immediately from precompiled code/static HTML.
- `visual-lab.html` and `generate-favicon.html` are utilities; preserve them as independent entries in the first build to avoid an accidental route removal.

## 11. Safe page-by-page Step 2 sequence

Each numbered item should be a separate reviewable commit or PR checkpoint.

1. **Baseline capture**
   - Record script/request counts and Web Vitals for every page.
   - Capture Classic/Future screenshots at 375×812, 768×1024, and 1440×900.
   - Record logged-out and connected-wallet states without sending transactions.

2. **Add inert build scaffold**
   - Add pinned Vite/React dependencies, scripts (`dev`, `build`, `preview`), MPA config, and `dist` ignore.
   - Build copied/no-op entrypoints first; do not switch Vercel output yet.
   - Verify `dist` contains all HTML routes and no server code in browser chunks.

3. **Extract shared modules with compatibility exports**
   - Convert theme/UI/data/wallet/contracts modules to explicit imports.
   - Continue publishing existing `window.*` names temporarily.
   - Remove timeout/polling readiness hacks only after all consumers on a page use imports.

4. **Migrate `docs.html` first**
   - Smallest React/Babel page and no protocol data.
   - Move JSX to `src/entries/docs.jsx`, use `createRoot`, remove its React/ReactDOM/Babel tags.
   - Prove visual parity and collapsible/navigation behavior.

5. **Migrate `gallery.html`**
   - One read path, artwork-card rendering, filter/search/tab parity.
   - Add grid skeleton without changing final layout.

6. **Migrate `artwork.html`**
   - Preserve media player behavior, status wording, bid polling, moderation, and every transaction handler.
   - Parallelize only independent reads identified in §10.
   - Verify every lifecycle state and media type.

7. **Migrate `profile.html`**
   - Introduce shared request caching and region skeletons.
   - Verify own/foreign profile, Created/auction/sold/Collected galleries, OAuth callback, trust/Genesis, pending settlement, resale, and re-auction surfaces.

8. **Extract non-JSX page entries**
   - `index.html`, `upload.html`, and `auction-system.html` move inline code into module entrypoints without semantic edits.
   - Preserve the upload transaction sequence exactly.

9. **Migrate utility pages**
   - Bundle or statically copy visual lab and favicon generator; confirm direct URLs remain available.

10. **Remove compatibility globals and duplicate tags**
    - Only after every page imports dependencies.
    - Remove Babel Standalone, React UMD, duplicate React copies, remote ethers/Supabase/Reown imports, and redundant per-page scripts.

11. **Tailwind runtime removal (separate checkpoint)**
    - Pin Tailwind, scan all HTML/JSX sources, safelist constructed classes, generate CSS, and compare screenshots.
    - Remove `cdn.tailwindcss.com` only after visual parity.

12. **Switch Vercel preview to `dist`**
    - Preserve API rewrites and functions.
    - Run full preview smoke/E2E matrix, then promote. Do not merge if any route, status, media, wallet, or transaction parity check differs.

## 12. Parity verification matrix

Every migrated page must pass:

- exact visible copy and canonical status labels;
- same DOM order/ARIA names for interactive controls;
- Classic and Future screenshots at desktop/tablet/mobile;
- mobile zero-motion and reduced-motion checks;
- no unexpected cumulative layout shift between skeleton and final content;
- direct navigation, reload, back/forward, query parameters, and deep links;
- logged-out, wallet-hydrating, connected, wrong-network, and rejected-signature states;
- no transaction sent during automated visual tests.

Page-specific gates:

- artwork: image/GIF/video/audio, first-frame behavior, controls, media fallback, live/no-bid/ended/settlement/sold/defaulted states, live bid refresh, Creator/First Collector/Owner, moderation visibility, AI guidance.
- gallery: all tabs, filters, sorting, search debounce, empty/error states, safe-media filtering.
- profile: self/other profile, tabs, OAuth return, pending indexer rows, Genesis/trust, pending payments, re-auction/resale controls.
- upload: each media type, AI retry, validation, rejected wallet/auth/upload/registration/auction paths; transaction order unchanged.
- index: 12 ranked slots, pending-indexer merge, suppression, media cards, empty state.
- docs/protocol/utilities: content and controls identical.

Build/network gates:

- no `@babel/standalone`, `text/babel`, React UMD, or ReactDOM UMD on migrated pages;
- one page entry plus expected shared/vendor chunks;
- no duplicate React, ethers, Supabase, or Reown runtime;
- no `src/api`, secrets, or server-only dependencies in browser output;
- hashed immutable assets and HTML with short/no-cache policy;
- all current Vercel API routes return the same status/body contract.

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Global script order changes wallet or contract readiness | Compatibility `window.*` exports, explicit boot promise, page-by-page removal, wallet-state regression matrix |
| Duplicate singleton clients during mixed migration | One shared data/auth module and one shared AppKit module; inspect bundle graph |
| Bundler includes server code or secrets | Separate browser entries; CI scan `dist`; never import `src/api` from client graph |
| Vercel stops serving API functions or `.html` routes | Preview deployment smoke tests for every route and rewrite before output-directory switch |
| Tailwind purge removes constructed classes | Separate Tailwind checkpoint, content scan, safelist, screenshot diff |
| Skeleton changes final layout or theme semantics | Skeletons use the same final containers and `--c-*`; visual diff in both themes |
| Parallel reads create stale races | request IDs/AbortController, `Promise.allSettled`, preserve existing single-flight bid polling |
| Indexed truth is replaced by wallet/RPC data | Keep `/api/public/artworks` as public source; RPC refresh remains optional and scoped to connected actions |
| Remote dependency behavior changes when moved to npm | Pin exact compatible versions and do not upgrade during migration |
| Large first bundle replaces many small requests with one blocking file | Route entries, stable vendor chunks, lazy wallet/transaction code, bundle-size budgets |
| Rollback mixes old HTML with missing assets | Keep legacy tags until each page passes; deploy atomically; retain previous Vercel deployment |

## 14. Rollback

Rollback unit is one page:

1. Restore that page's previous HTML script tags and inline code.
2. Leave shared build output in place for already-migrated pages.
3. Redeploy the last known-good Vercel deployment if the output-directory or API smoke test fails.
4. Do not delete compatibility globals until all pages have completed their rollback window.
5. Keep build artifacts content-hashed so an HTML rollback cannot receive incompatible cached JavaScript.

The final cutover rollback is a single revert of the Vercel build/output configuration plus redeployment of the last direct-static commit. Database, contracts, indexed data, and user assets are not migrated by this work and require no rollback.

## 15. Step 2 acceptance criteria

Step 2 is complete only when:

- all four JSX pages are precompiled and Babel Standalone is absent;
- every root page is emitted and reachable through its existing URL;
- Vercel APIs and rewrites are unchanged and passing;
- independent reads identified above run in parallel without changing truth precedence;
- geometry-matched skeletons replace full-page text loaders on data pages;
- visual/function parity matrix passes in both themes and target viewports;
- wallet, contract, lifecycle, economics, status wording, provenance, and media behavior are identical;
- rollback has been tested on a preview deployment.
