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
account's free/no-spend controls and available quota. No paid plan, billing
change, credential creation or live inventory activation is part of this slice.

## Verification

- 13 offline API checks pass: authentication, dispatcher routing, owner binding,
  dedicated credential isolation, exact IDs/quantities, hostile metadata,
  cursor tampering/expiry, cache and concurrency, bounded response handling,
  provider failures, throttling and credential rotation races.
- Together with the related Saved API suite, 25 checks pass.
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

The Alchemy sign-in flow currently requires the owner to finish phone
verification before the account dashboard can be inspected. No new credential
has been created or installed. Separate provider apps can improve attribution
and isolation, but are not a remedy for an exhausted account quota.

## Interpretation and release boundary

Canon sections 1, 4, 5, 9 and 16 apply. The founder's external-inventory request
is interpreted as a Base-only read surface, separate from protocol provenance
and trading. No contract, economics, active product network or role changes.

The existing wallet sign-in is reused to bind the inventory to its owner;
anonymous profile browsing does not trigger third-party inventory requests.
These are explicit UX/data-boundary decisions, not new protocol mechanics.

Local implementation and checks are complete. Hosted CI and release are
recorded after completion. The activation gate remains open until provider
quota controls and a bounded live request are verified. Phase B is not closed
by this optional inventory feature.
