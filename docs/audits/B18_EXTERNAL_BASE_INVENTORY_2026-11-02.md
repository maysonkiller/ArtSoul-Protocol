# External Base wallet inventory — November 2, 2026

## Scope

The founder explicitly requested NFTs from other collections held by the user's
wallet on Base, in addition to ArtSoul NFT records. This is a separate,
read-only section in the owner's Collected tab. It is disabled by default.
Viewing it does not switch the wallet or activate mainnet transactions.

The user loads a page explicitly. Each page contains at most 12 ERC-721 or
ERC-1155 items, with contract, exact token ID, quantity and bounded metadata.
Navigation replaces the page rather than appending an unbounded list. No
inventory is fetched when opening a profile or another profile tab.

External NFTs do not become ArtSoul artworks or listings, acquire Trust or
canonical floor, or gain a fabricated Creator/First Collector history. The
current inventory does not have verified purchase prices or venues; it says so.
A transfer, floor price or asking price is not a substitute for a sale receipt.

## Access and resource boundaries

- The existing signed wallet session and matching connected-wallet header
  determine the owner. There is no arbitrary owner, chain or URL parameter.
- A dedicated server-only `ARTSOUL_EXTERNAL_BASE_NFTS_ALCHEMY_API_KEY` is
  mandatory. RPC credentials are never used as a fallback.
- Provider responses, timeouts, concurrency, page counts and cache size are
  bounded. Concurrent requests are deduplicated, pages are cached for five
  minutes, and failures have a short cache. There is no automatic retry loop.
- Continuation cursors are authenticated, wallet-bound, expiring and invalidated
  when the inventory credential changes. Unrelated RPC rotation preserves them.
- External metadata is rendered as text. Only validated Alchemy Base cached
  raster previews can load; original metadata, animation and arbitrary remote
  URLs cannot execute or be fetched by this feature.
- Logout, wallet changes, auth changes and page exit retire in-flight results
  and clear the visible inventory. Responses are private and not browser cached.
- No database migration, background worker, storage copy or dependency is added.

Local request budgets are process-scoped. They are containment, not an
account-wide billing ceiling. Separate Alchemy apps/keys do not create extra
account quota. Activation requires verification of the existing provider
account's free/no-spend controls and available quota. The initial implementation
was released disabled in PR461; the provider follow-up below records subsequent
configuration without upgrading to a paid provider plan.

## Verification

- 14 offline API checks pass: authentication, dispatcher routing, owner binding,
  dedicated credential isolation, exact IDs/quantities, hostile metadata,
  cursor tampering/expiry, cache and concurrency, bounded response handling,
  provider failures, throttling and credential rotation races.
- The previous implementation and related Saved API suite passed 25 checks.
  The additional check covers current CDN paths and hostile alternatives.
- Production build passes, including all 11 HTML route and Tailwind checks.
- 35 isolated browser checks pass at 320, 390, 768 and 1366 pixels in both
  palettes: disabled/no-auto-fetch state, explicit pagination, metadata text
  safety, auth clearing, throttling without retry, stale wallet response
  rejection and horizontal bounds. No page exception or write occurred.
- Rendered mobile and desktop fixtures were inspected. These use synthetic
  data and are not a real iPhone or live Alchemy acceptance claim.

## Provider follow-up

The existing local Base Sepolia, legacy Ethereum Sepolia and generic RPC
settings share a credential. One bounded chain-ID read from each configured
chain endpoint and the existing public Base endpoint succeeded on November 2;
the reported limit failure was not reproduced. This does not establish spare
monthly quota or fix a provider account restriction.

The owner completed phone verification. The signed-in project account opened
new-team onboarding, rather than the old RPC account. Its dashboard confirms
Free ($0/month), 30 million CU/month and no payment method. The automatically
created app was dedicated to Base NFT inventory; only Base Mainnet is enabled.
Its credential is kept in a protected, ignored local file pending server-secret
installation. Existing protocol RPC credentials have not changed. Separate apps
do not provide additional account quota; old RPC account usage is still unverified.

One real inventory request returned HTTP 200: 12 items, 463,568 response bytes,
ERC-721 and ERC-1155 quantities, and continuation. A second read reused the cache.
The response exposed a provider compatibility issue: cached previews now use
`nft2-cdn.alchemy.com` with two opaque path segments. The adapter now accepts that
exact HTTPS shape as well as the legacy CDN. Queries, fragments, extra segments,
lookalike hosts, arbitrary originals and active SVG remain rejected. Replaying
the captured response offline produces 11 raster previews and one SVG fallback,
without another provider request. The new CDN test and production build pass.

Alchemy's usage-limit control prompted a paid-plan upgrade. It was closed without
an upgrade, card entry or spending authorization. The verified Free plan remains
the cost boundary; process-local request limits are not represented as a shared
quota or a guarantee of availability after free quota exhaustion.

## Interpretation and release boundary

Canon sections 1, 4, 5, 9 and 16 apply. The founder's external-inventory request
is interpreted as a Base-only read surface, separate from protocol provenance
and trading. No contract, economics, active product network or role changes.

The existing wallet sign-in is reused to bind the inventory to its owner;
anonymous profile browsing does not trigger third-party inventory requests.
These are explicit UX/data-boundary decisions, not new protocol mechanics.

PR461 is merged and its dormant production release was verified. Provider-plan
inspection and the bounded live request are now complete. The CDN compatibility
patch, production-secret installation and explicit feature activation must still
be verified in the release record. Native iPhone acceptance is not inferred from
desktop fixtures or the provider probe. Phase B is not closed by this optional
inventory feature.
