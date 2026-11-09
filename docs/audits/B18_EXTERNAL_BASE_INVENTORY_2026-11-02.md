# External Base wallet inventory — November 2, 2026

## Scope

The founder explicitly requested NFTs from other collections held by the user's
wallet on Base, in addition to ArtSoul NFT records. This is a separate,
read-only Wallet NFTs tab in the owner's profile, before Saved. The rollout
is disabled by default in code and enabled on the verified Free production app.
Viewing it does not switch the wallet or activate mainnet transactions.

Selecting the tab loads the first page. Each page contains at most 12 ERC-721 or
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
Its credential is kept in a protected, ignored local file and the production
server-secret store. Existing protocol RPC credentials have not changed. Separate apps
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

PR461 and PR463 are merged. The CDN patch passed Linux/Windows CI; the dedicated
secret and production feature flag are installed on the ArtSoul project only.
The activated deployment passed route/config and unauthenticated denial checks.
The signed-in production browser then exposed a separate routing failure:
`/api/wallet-nfts` returned `INVALID_WALLET_NFT_QUERY` before any provider read.
Unlike the existing profile and notification endpoints, this route lacked an
explicit Vercel catch-all rewrite. The follow-up adds that same deployment
mapping and exercises its actual query through the private dispatcher test.
Owner binding and query rejection remain unchanged. Signed-in production
acceptance was rerun after PR464: the signed-in production browser loaded two
12-item pages, with 11 raster previews and one safe SVG fallback on the first.
The wallet stayed on Base Sepolia and no transaction was requested. Repeating
the first page used the server cache. This completes that route acceptance,
not the remaining native-device or whole-phase gates.

## Profile and details follow-up

The founder requested a dedicated profile tab, uniform cards and compact details.
Wallet NFTs now appears before Saved only on the connected owner's profile when
enabled. Collected retains ArtSoul NFTs. Selecting the private tab mounts the
inventory; other tabs do not fetch it. Previous/Next replace the bounded page;
horizontal swipes use the same pagination and do not intercept vertical scroll.

Cards reserve equal title/collection space. Details open in one native dialog,
with Escape, close/focus restoration and one scrollable surface. The background
does not scroll while it is open. Images stay contained; missing or rejected
images have a safe fallback. Exact IDs, quantities and text-only traits remain.

A details-only ETH/USD reference uses the fixed public Coinbase spot endpoint,
without a wallet address or credential. It has a two-second timeout, an 8 KiB
response cap, five-minute cache, in-flight deduplication and a one-minute failure
backoff. It reuses the signed owner route and existing per-wallet request budget.
It adds no database, paid account, dependency or background polling. The price,
source and retrieval time are distinct from NFT purchase evidence.

Purchase amount and venue remain explicitly unverified. Alchemy's inventory
response is not sale evidence, and its getNFTSales V2/V3 endpoints were retired
on September 30, 2026 without a direct replacement. A future purchase adapter must
verify a marketplace sale receipt, recipient, asset and payment rather than infer
price from a transfer or floor. Other chains and external-NFT trading remain off.

Official references:
- [Alchemy NFT sales retirement](https://www.alchemy.com/docs/changelog/2026/8/18)
- [Alchemy owner inventory](https://www.alchemy.com/docs/reference/nft-api-endpoints/nft-api-endpoints/nft-ownership-endpoints/get-nf-ts-for-owner-v-3)
- [Coinbase public price API](https://docs.cdp.coinbase.com/coinbase-app/track-apis/prices)
- [MetaMask wallet RPC](https://docs.metamask.io/metamask-connect/evm/reference/json-rpc-api/)
- [Draft wallet_getAssets interface](https://eips.ethereum.org/EIPS/eip-7811)

Provider wallet APIs are not assumed to expose a complete NFT inventory or sale
history. Draft ERC-7811 is an optional future adapter, not claimed wallet support.
The bounded Base index remains the current source. A different key does not
increase the quota of its provider account.

The related account-plaque request is prepared separately as
`docs/design/ARTSOUL_ACCOUNT_OPTIONS_2026-11-02.html`: two compact shapes with
separate name/address copy controls and a network/balance/Disconnect menu.
Both use the existing palette variables. The founder subsequently selected A,
with the same-width dropdown and B's distinct name/address copy feedback.
That shared-header implementation and its November 9 integration are recorded
in [the resume audit](B18_RESUME_ACCOUNT_SEO_2026-11-09.md).

Rendered checks cover 320, 390, 768 and 1366 px in both themes: equal card heights,
no page horizontal overflow, contained details, rejected late-wallet responses,
and session-expiry/sign-in recovery. Clipboard name/address copies were verified
by pasting into the prototype's test input; simulated failure exposes manual copy.
These use synthetic data and desktop viewport overrides, not native iPhone proof.

Native iPhone acceptance is not inferred from desktop fixtures or the provider
probe. Phase B is not closed by this optional inventory feature.
