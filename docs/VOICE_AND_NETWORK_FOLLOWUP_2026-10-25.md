# Voice, agent tools and future network scope

Status: first text/header slice released; explicit Saved slice under verification October 26; broader expansion planned.
Source: founder requests of October 25, 2026. Related: B-08, B-09, B-12,
B-13/B-14 and C-06/C-27 in `BACKLOG.md`.

## Current implementation

- `webmcp-tools.js` exposes structured public reads, navigation, personal
  activity and eight bounded wallet actions. See `WEBMCP.md` for the tool list.
  Each financial action retains the existing visible review and wallet signature.
- `voice-commands.js` maps English/Russian phrases to those same tools and
  uses browser speech recognition/synthesis. It is a command grammar, not a
  multilingual conversational assistant. The October 26 candidate adds a text
  composer without requiring browser speech support; the microphone is optional.
- New global search, Saved, profile curation, Donate, Report and publication
  preparation are not all exposed through that command layer. B-12's real agent
  journey acceptance remains open; passing parser tests does not close it.

## Next contained implementation

1. Provide one accessible text-and-voice panel in both themes. Text remains
   available without microphone support. Show the interpreted request, progress,
   cancel/retry and the actual outcome. Preserve state on mobile wallet return.
   The October 26 candidate covers the shared panel and existing tool set, with
   account/late-answer fencing and explicit microphone activation. It does not
   add durable command replay across reloads or claim new phone/speech acceptance.
2. Reuse the current search API and Saved store, with explicit `save`/`remove`
   semantics for commands rather than a retry-sensitive toggle. Add navigation
   and clarification for missing artwork/query. Do not build a second list or
   a separate search corpus for the assistant.
   The October 26 Saved candidate uses the shared store and existing signed-in
   session, with strict IDs, explicit desired state and account/auth fences.
   Global artwork/artist search reuse remains the next contained slice. See
   `audits/B21_SAVED_COMMANDS_2026-10-26.md` for the actual verification boundary.
3. Prepare publish drafts in the existing upload form. The person chooses the
   file, reviews title/description/price, completes authorization and signs the
   existing registration/auction transactions. Resume the existing durable
   publication attempt after interruption; never create a second attempt on an
   assistant retry. Add Donate and complaint-form preparation through existing
   dialogs; submission still requires the person's review.
4. Add multilingual intent understanding only after selecting an evaluated
   provider, privacy/retention policy, cost ceiling and supported-language test
   set. The model proposes an allowlisted tool call; code validates it, requests
   clarification where needed and uses the same existing permission gates.
   Artwork text, search results and metadata are untrusted data, not commands.
   The microphone is explicit and never listens in the background.
5. Test cancellation, misunderstood amounts/IDs, duplicates, expired sessions,
   wallet changes and mobile return. Admin, roles, moderation decisions and
   critical settings are excluded from assistant actions by founder instruction.

This is feasible in slices. It does not promise every language/browser today.
WebMCP exposes application tools; it does not itself supply a language model or
speech service. The proposed web standard supports user confirmation for
sensitive actions ([Chrome documentation](https://developer.chrome.com/docs/ai/webmcp)).
Browser speech support and language availability vary
([MDN](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/lang)).
Sources checked October 25, 2026. No new provider, dependency, credential,
microphone permission or signing delegation was introduced by this review.

## Network direction: discussion, not activation

The active 1/1 product remains Base Sepolia; Base mainnet is not launched.
The existing Collection Launch amendment allows chain-aware design work but
does not prove deployment or end-to-end support on a new network.
The founder's network examples are candidates to evaluate, not a final target
selection. No chain IDs/RPCs or stablecoin economics are introduced here.

Recommended design for the later C1/C-06 decision:

- One discovery interface with explicit network filters; keep artwork identity
  scoped by network and deployed contract, never by a bare numeric artwork ID.
  Saved already uses `(chain_id, core_address, artwork_id)`. Search/history
  should retain the same scope before more than one deployment is selectable.
- Each auction has one authoritative settlement chain, contract and currency.
  A unified gallery must not merge ownership, floors or payment obligations
  across networks. Collection-wide cross-chain supply and bridging require a
  separate custody/finality threat model before implementation.
- Stablecoin payments are a distinct architecture decision: supported asset,
  decimals, quote/expiry, funding and refund denomination, settlement proof,
  bridge failure/recovery and costs must be defined. Do not infer these from
  the request or silently replace the current ETH economics.
- Before a new network is supported, verify official network availability,
  wallets, contracts, indexer/reorg recovery, receipts, explorer/media URLs and
  all user journeys. A configuration entry alone is insufficient.
- Before clearing test data, preserve and independently validate Snapshot A as
  required by Bible section 16. Existing saves are deployment-scoped; an old
  saved number must never silently become a different new-mainnet artwork.

Interpretation log: ordinary assistant actions are an approved product direction;
automatic signing remains C-27 research, not authorized implementation. Multiple
networks/stablecoins remain a design discussion; no canon economics or contract
behavior is amended by this note.

### Clarification: pay from another chain, keep the artwork on its origin

The October 25 clarification asks for payment-source flexibility, not an NFT
bridge. Base, Ethereum, Robinhood and Rialo remain evaluation priorities rather
than activated targets. Arc is an interoperability candidate, not a required
intermediate chain or a replacement home for every artwork.

Official sources checked October 25:

- [Arc's September 23 announcement](https://www.arc.io/blog/introducing-interop-on-arc-crosschain-liquidity-without-the-complexity)
  says mainnet and its interoperability services are live. Older March material
  describing Arc as testnet is superseded. [Arc connection documentation](https://docs.arc.io/arc/references/connect-to-arc)
  identifies USDC as native gas. No network configuration is changed here.
- [CCTP](https://developers.circle.com/cctp) transfers supported assets and can
  trigger destination actions. This does not make arbitrary native tokens or
  arbitrary ArtSoul auction calls automatically compatible.
- [Gateway](https://developers.circle.com/gateway) provides a deposited unified
  balance per asset; it does not exchange one asset for another. Its fast spending
  claim applies after the balance is established. Deposits have separate finality
  requirements. [The current support matrix](https://developers.circle.com/gateway/references/supported-blockchains)
  includes USDC on Base, Ethereum and Arc, but does not list Robinhood or Rialo.
  Absence from this matrix is not a claim about every other provider.

Recommended sequence (proposed, not implemented):

1. Keep one catalog and deployment-scoped artwork identity. Separately show
   **Artwork network**, **Pay from**, **Pay with**, recipient, total cost and
   estimated arrival before approval. Only show routes that have been verified.
2. First prototype funding the buyer's own destination wallet. Route a supported
   stablecoin, convert only with a bounded quote where necessary, then let that
   wallet perform the existing destination transaction. The NFT, canonical
   price, floor, deposit and settlement rules remain on the artwork chain.
   This is less seamless but compatible with the current caller model.
3. Only then consider an atomic destination checkout for eligible buy-now sales.
   Auctions additionally need confirmed deposits before the bid deadline and
   payment before settlement expiry. A source-chain transfer is never an accepted
   bid or completed purchase. Do not promise instant first-time funding.
4. Native-token payment needs a separately evaluated swap/route provider with
   available liquidity; Circle's asset transport alone is not that swap. Compare
   supported routes, permission scope, total fees, outage recovery and refunds
   before choosing an integration. Avoid building a custom bridge.

The current `ArtSoulCore` records the bidder as `msg.sender` and requires the
same winner to settle. A relay calling it directly would become the bidder or
fail settlement. Any later on-behalf-of adapter must bind buyer, destination,
chain, contract, artwork/auction, amount, nonce and expiry to explicit signatures,
and prove who receives the NFT/refund. It requires a reviewed contract design and
new test deployment; no silent caller substitution or wallet delegation.

Failure cases for that later rehearsal: expired quote, insufficient destination
amount after fees, source reorg, duplicate relay, partial route, auction ending
in transit, rejected destination transaction, wrong recipient, cancelled intent
and recoverable unspent funds. No transfer is called successful until the
destination receipt and protocol state prove it. Adding a payment network and
deploying ArtSoul contracts there are separate decisions.
