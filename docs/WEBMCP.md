# ArtSoul agent tools (WebMCP)

ArtSoul declares its own tools to an AI agent instead of leaving the agent to
guess at the page. The implementation is one classic deferred script,
[`webmcp-tools.js`](../webmcp-tools.js), loaded by every product page: the
homepage, the gallery, an artwork, a profile, the publish page and the protocol
documentation. Tools belong to the page that offers them, so they follow the
person as they move through the site instead of disappearing on the first
navigation.

## Why declared tools instead of clicking

An auction is live state with arithmetic attached. Which number on the page is
the current bid, whether bidding is still open, how long is left, and what a
valid next bid would be are all questions an agent reading pixels answers by
inference. Every one of them has an exact answer the page already fetches. The
tools hand over those answers, and nothing else.

## The two rules the layer does not break

**The agent never signs.** Reading is fully automatic. `place_bid` goes as far as
a website can: it opens the person's wallet with the transaction, and the wallet
asks them to approve it. That last click cannot be delegated from a page — no
website can make a wallet approve anything — and it is where the boundary
belongs, because an agent reads instructions from the open web and an agent that
could sign is an agent that can lose someone's money on a misread instruction.

Opening the wallet at all requires a permission the person grants themselves,
through the browser's own confirmation dialog, in the page. The default level is
`read`; the `wallet` level is remembered per browser and can be revoked with
`window.ArtSoulWebMCP.revokePermission()`. A storage that cannot be read denies
rather than grants, a refusal is never remembered as a grant, and **no tool can
raise the level** — there is deliberately no tool that grants permissions, and a
test asserts that none appears. Anything beyond this — an agent signing inside
bounds the person set once — needs scoped session keys on a smart account, which
is contract architecture; it is filed as backlog C-27 and gated behind the
independent audit.

`prepare_bid` and `prepare_artwork_registration` remain the no-wallet path: they
report state, open the relevant page and stop, and neither can return a
transaction.

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
| `get_artwork` | The whole public record of one work: description, owner, prices, community signals | `/api/public/artworks` |
| `get_auction_state` | Status, current bid, bidder, bid count, end time, settlement deadline | `/api/public/auction-live` |
| `get_artwork_provenance` | Creator, First Collector, Owner and the event timeline | `/api/public/artwork-provenance` |
| `explain_settlement` | The publish → auction → settlement → mint lifecycle, and where one work sits in it | `/api/public/artworks` |
| `open_artwork` | Opens an artwork page so the person can see it; navigates only | `/api/public/artworks` |
| `prepare_bid` | Live auction state, then opens the auction for the person to sign | `/api/public/artworks` (+ contract constants when available) |
| `place_bid` | Opens the connected wallet with the bid, for the person to approve | `ArtSoulContracts.placeBid` (contract computes the deposit) |
| `end_expired_auction` | Opens the wallet to finalize an auction whose time has passed | `ArtSoulContracts.endAuction` |
| `prepare_artwork_registration` | Validates details, then opens the publish page for the person to sign | — |

No new API route was added. Every tool reads an endpoint the product already
serves, which keeps the public egress pattern (server projection plus CDN cache)
exactly as it was.

## Answering completely, so the agent stops re-deriving

Watching a real agent use these tools showed the cost of an incomplete answer.
Asked which auctions were open, it produced a correct list — and then read the
contract anyway: once to find the auction numbers, which the tools had not
returned, and once more to prove the data was current. Two round trips the page
could have answered for free, paid for in latency and in the person's usage.

So every listing now carries the auction number alongside the artwork number, and
an `as_of` block that says how current the projection is — last indexed and
confirmed block, when it was indexed, how far behind the chain it is, and whether
it has gone stale. That status is read once per page and reused. If it cannot be
read the tools still answer; they simply do not claim a block, because freshness
is context and never the answer itself.

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
- "Tell me about artwork 31." / "Open it." — search accepts the number as
  readily as a title, so "31", "#31" and "artwork 31" all find the same work.
- "Help me bid on artwork 31." — the agent opens your wallet with the bid and
  stops; the approval is yours.
- "This auction has expired, can you finalize it?" — anyone may finalize an
  expired auction, and the caller receives nothing for it.

Reading works with no wallet. The two `prepare_` tools end at a page where the
person needs a wallet on Base Sepolia; testnet ETH comes from any Base Sepolia
faucet.

## Tests

`test/webmcp-tools.test.cjs` runs in the canonical Node suite (`npm test`). It
covers the registered tool set, the JSON Schemas, text and creator search, the
deadline ordering, live-auction preference over cached cards, rejection of a
malformed artwork id before any request is made, the refusal to bid on a closed
auction, the absence of hardcoded economics, and Base Sepolia as the only network
the layer will read. It also pins which tools may reach the chain, so a write
cannot be added to this layer without a test noticing.
