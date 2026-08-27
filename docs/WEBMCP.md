# ArtSoul agent tools (WebMCP)

ArtSoul declares its own tools to an AI agent instead of leaving the agent to
guess at the page. The implementation is one classic deferred script,
[`webmcp-tools.js`](../webmcp-tools.js), loaded by the homepage, the gallery and
the artwork page.

## Why declared tools instead of clicking

An auction is live state with arithmetic attached. Which number on the page is
the current bid, whether bidding is still open, how long is left, and what a
valid next bid would be are all questions an agent reading pixels answers by
inference. Every one of them has an exact answer the page already fetches. The
tools hand over those answers, and nothing else.

## The two rules the layer does not break

**The agent never signs.** Reading is fully automatic. Anything that moves value
stops at a prepared, explained action: `prepare_bid` reports the live auction and
opens its page, `prepare_artwork_registration` opens the publish page. The person
reviews the amount and approves the transaction in their own wallet. Neither tool
can return a transaction, and a regression test asserts it.

**No economics live in the layer.** Deposit size, minimum bid increment, auction
durations and the settlement window are contract constants on Base. When the
wallet layer is initialized they are read from the chain; when it is not, the
tools report what the public projection knows and say the contract decides the
exact figure at signing time. A test asserts that no frozen figure appears in the
file, so the agent layer can never become a second source of truth for canon
economics.

## The tools

| Tool | What it answers | Reads |
| --- | --- | --- |
| `search_artworks` | Published works by free text, creator or lifecycle status | `/api/public/artworks` |
| `find_active_auctions` | What is open for bidding right now, soonest deadline first | `/api/public/artworks?view=auctions` |
| `get_auction_state` | Status, current bid, bidder, bid count, end time, settlement deadline | `/api/public/auction-live` |
| `get_artwork_provenance` | Creator, First Collector, Owner and the event timeline | `/api/public/artwork-provenance` |
| `explain_settlement` | The publish → auction → settlement → mint lifecycle, and where one work sits in it | `/api/public/artworks` |
| `prepare_bid` | Live auction state, then opens the auction for the person to sign | `/api/public/artworks` (+ contract constants when available) |
| `prepare_artwork_registration` | Validates details, then opens the publish page for the person to sign | — |

No new API route was added. Every tool reads an endpoint the product already
serves, which keeps the public egress pattern (server projection plus CDN cache)
exactly as it was.

## Cost to an ordinary visitor

Nil. Without a WebMCP-capable browser the bootstrap exits before it registers a
handler, issues a request or touches the DOM. Where the API does exist,
registration waits for idle time, because an agent asks for tools
conversationally and never during first paint.

## Trying it

**Chrome:** open `chrome://flags/#enable-webmcp-testing`, set it to Enabled and
relaunch. Chrome 149 and later also offer the WebMCP origin trial.

**ChatGPT:** the in-app browser supports WebMCP directly.

Then open <https://artsoulprotocol.com> and ask the agent something the tools
cover, for example:

- "What ArtSoul auctions end in the next twelve hours?"
- "Who was the first collector of artwork 12, and who owns it now?"
- "Explain what happens after this auction ends."
- "Help me bid on artwork 31." — the agent will open the auction and stop; the
  bid is yours to review and sign.

Reading works with no wallet. The two `prepare_` tools end at a page where the
person needs a wallet on Base Sepolia; testnet ETH comes from any Base Sepolia
faucet.

## Tests

`test/webmcp-tools.test.cjs` runs in the canonical Node suite (`npm test`). It
covers the registered tool set, the JSON Schemas, text and creator search, the
deadline ordering, live-auction preference over cached cards, rejection of a
malformed artwork id before any request is made, the refusal to bid on a closed
auction, the absence of hardcoded economics, and Base Sepolia as the only network
the layer will read.
