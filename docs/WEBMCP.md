# ArtSoul agent tools (WebMCP)

ArtSoul declares its own tools to an AI agent instead of leaving the agent to
guess at the page. The implementation is one classic deferred script,
[`webmcp-tools.js`](../webmcp-tools.js), loaded on Home, Gallery, Artwork,
Profile, Publish, Collection Builder and the protocol guide. Tools belong to the page that offers them, so they follow the
person as they move through the site instead of disappearing on the first
navigation.

## Spoken responses

The assistant uses Marin for prerecorded English and Russian speech. The [phrase bank](audio/assistant-phrase-bank.json) defines paired, complete responses. The [recording manifest](../public/audio/assistant/v1/manifest.json) tracks the generated speech, transcript and digest of each available WAV. Playback of these files requires no API call. Changing the voice language leaves the written interface in English.

The [local live conversation pilot](audits/LIVE_VOICE_LOCAL_PILOT_2026-11-27.md) uses microphone input and the same API voice. Its provider connection is disabled by default. The public site plays the available recordings.

Run the following from the repository root to check the bank and see which responses still need recording. Both commands run offline.

```sh
node scripts/build-voice-phrase-index.mjs
node scripts/generate-assistant-audio.mjs
```

For an approved recording batch, confirm the receiving organization's available promotional balance in Billing, then supply its `OPENAI_ORG_ID`, the grant's UTC expiry as `ARTSOUL_VOICE_GRANT_EXPIRES_AT`, and a server-side `OPENAI_API_KEY`. Select up to ten explicit phrase IDs with `--only` and a cumulative USD ceiling with `--budget-usd`. The generator defaults to a dry run. Adding `--generate` opens one Realtime session per missing phrase. Each attempt reserves $0.025 locally, including failed or interrupted attempts. Other projects can consume the same grant. Review the remaining credit before each batch. After an interruption, `--recover` finishes publishing an already received recording offline. [OpenAI API credit coverage and balance](https://help.openai.com/en/articles/20001626-api-credits-benefit-for-eligible-chatgpt-subscriptions)

If the recorder process was terminated, confirm it has exited before clearing a stale `docs/private/assistant-audio-generation-ledger.json.lock`. Check provider usage after an unresolved paid attempt. For a single confirmed failure, explicitly select its ID with `--only` and `--retry-failed` to make one new attempt. Both attempts count toward the cumulative budget. Interrupted attempts with unclear outcomes remain blocked.

## Why declared tools instead of clicking

An auction is live state with arithmetic attached. Which number on the page is
the current bid, whether bidding is still open, how long is left, and what a
valid next bid would be are all questions an agent reading pixels answers by
inference. Every one of them has an exact answer the page already fetches. The
tools hand over those answers, and nothing else.

## The two rules the layer does not break

**The agent never signs.** Reading is fully automatic. Every chain write goes as far as
a website can: it opens the person's wallet with the transaction, and the wallet
asks them to approve it. That last click cannot be delegated from a page — no
website can make a wallet approve anything — and it is where the boundary
belongs, because an agent reads instructions from the open web and an agent that
could sign is an agent that can lose someone's money on a misread instruction.

Opening the wallet at all requires a permission the person grants themselves,
through the page's confirmation dialog. Its asynchronous answer is awaited;
only an explicit approval grants access. The default level is
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

### How a write stays safe (B-12)

Every tool that opens the wallet passes through one gate, and the rules are the
same for all of them:

1. **Refuse what the contract would revert, before the wallet opens.** Not the
   winner, a window already closed, a price below the floor, a listing that is
   no longer active, a duration the contract does not accept. Nobody pays gas to
   learn a rule the page already knew.
2. **Amounts come from the chain, never from the conversation.** A purchase pays
   the price the contract holds for the listing now; a settlement pays what the
   contract computes; auction durations are read from the contract. Amounts are
   compared as integers of wei, so exactly the floor passes and one wei under
   does not.
3. **An amount or a price is confirmed on the page every time.** The wallet
   shows the value it sends, not the figures inside the transaction data: a bid
   amount, a resale price and a starting price are all invisible there. So even
   after the grant, the page names the work, its number and the figure, and a
   person has to accept it. Actions that move nothing out of the person's wallet
   - ending an auction, closing an expired settlement, withdrawing their own
   funds - rely on the grant and the wallet approval alone.
4. **One wallet action at a time.** A retried command or a voice command heard
   twice cannot stack a second approval behind the first, including when voice
   and WebMCP are both active. Revocation or an account change invalidates an
   open review before it can grant access or submit a transaction.
5. **The agent can lower its own access and never raise it.**
   `revoke_wallet_access` removes the grant; nothing restores it but the person's
   click.

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
| `search_catalog` | Global artwork, live-auction and artist-profile search; bounded grouped results with `hasMore`, no total-count claim | Shared Search ArtSoul state and `/api/public/search` |
| `search_artworks` | Legacy compatibility tool: filters at most 200 recent cards by free text, creator or lifecycle status; prefer `search_catalog` | `/api/public/artworks` |
| `find_active_auctions` | What is open for bidding right now, soonest deadline first | `/api/public/artworks?view=auctions` |
| `get_artwork` | The whole public record of one work: description, owner, prices, community signals | `/api/public/artworks` |
| `get_auction_state` | Status, current bid, bidder, bid count, end time, settlement deadline | `/api/public/auction-live` |
| `get_artwork_provenance` | Creator, First Collector, Owner and the event timeline | `/api/public/artwork-provenance` |
| `explain_settlement` | The publish → auction → settlement → mint lifecycle, and where one work sits in it | `/api/public/artworks` |
| `open_artwork` | Opens an artwork page so the person can see it; navigates only | `/api/public/artworks` |
| `open_page` | Opens a named page, a gallery tab, Collected ArtSoul NFTs or the enabled Wallet NFTs tab for a connected wallet | Site navigation |
| `prepare_bid` | Live auction state, then opens the auction for the person to sign | `/api/public/artworks` (+ contract constants when available) |
| `get_my_activity` | What the connected wallet created, owns, is leading, has won and must pay, has listed and can withdraw, and which tool handles each waiting action | `/api/public/artworks` (+ withdrawable balance from the contract) |
| `place_bid` | Opens the connected wallet with the bid, for the person to approve | `ArtSoulContracts.placeBid` (contract computes the deposit) |
| `end_expired_auction` | Opens the wallet to finalize an auction whose time has passed | `ArtSoulContracts.endAuction` |
| `complete_settlement` | The winner pays for a won auction, which mints the NFT | `ArtSoulContracts.completeSettlement` (contract computes the payment) |
| `close_expired_settlement` | Closes a settlement nobody paid in time, so the creator can auction again | `ArtSoulContracts.claimSettlementDefault` |
| `start_auction` | A creator starts a primary auction on an unminted work | `ArtSoulContracts.createAuction` (durations read from the contract) |
| `list_for_resale` | An owner lists an NFT at or above its canonical floor | `ArtSoulContracts.listResale` |
| `change_resale_price` | Changes an active listing's asking price after reviewing its live price and floor; never creates a missing listing | `getResaleManagementState`, `listResale` |
| `cancel_resale_listing` | Removes the connected seller's active listing; NFT ownership is unchanged | `getResaleManagementState`, `cancelResale` |
| `buy_resale_listing` | Buys a listed NFT at the price the contract holds now | `ArtSoulContracts.getResaleListing`, `buyResale` |
| `withdraw_pending_funds` | Withdraws proceeds, royalties and returned deposits to the same wallet | `ArtSoulContracts.getPendingWithdrawal`, `withdraw` |
| `revoke_wallet_access` | Takes away the agent's wallet access in this browser | — |
| `prepare_artwork_registration` | Stages a local title, optional description and starting price for review in Publish; never uploads or signs | — |
| `revise_publication_draft` | Checks the current or suggested title, or stages a title, description or available duration for manual review | Current Publish form |
| `prepare_donation` | Opens the selected artwork's donation form when available. The visitor enters the amount, reviews it and approves in their wallet | Existing artwork and donation controls |
| `prepare_artwork_report` | Opens the selected artwork's complaint form when available. The visitor provides evidence and submits | Existing artwork and reporting controls |
| `add_to_saved` | Saves one explicitly identified artwork to the signed-in account's private list | Existing Saved store and `/api/saved` |
| `remove_from_saved` | Removes that artwork from the same list, including an already absent item | Existing Saved store and `/api/saved` |

No new API route was added. Public reads retain the existing projection/CDN path;
Saved uses the existing private, no-store API with the expected wallet header.

### Publication drafts (B-21)

`prepare_artwork_registration` reuses the existing Publish form. Its suggested
title, optional description and optional `start_price_eth` are shown separately;
**Use these details** is the person's explicit action to fill blank fields.
Conflicting existing details are not replaced. Preparing on Publish does not
reload the page or discard selected media. A publication already being
authorized, analyzed, submitted or recovered cannot be edited this way.

Other pages transfer suggestions once through tab-local session storage and an
opaque URL fragment, never title/description query parameters or the durable
publication journal. The transfer expires after five minutes, is consumed once,
and waits for the original wallet to finish restoring. A different settled
wallet discards it. This timeout is UI housekeeping, not an authorization grant.

Commands: `prepare artwork titled Moonlight` or
`подготовь работу с названием Лунный свет`. A request without a title asks for
one. Title text is data, including words resembling commands. EN/RU command
grammar is still bounded; this is not unrestricted conversational AI. Structured
tools may also supply a description and exact positive ETH price. Once on
Publish, `revise_publication_draft` can suggest a duration offered by the
form. The visitor applies it and handles original-work confirmation and file selection. No AI request,
upload, wallet connection, signature, complaint or contract write is performed
by this preparation path. Registration still does not mint an NFT.

### Private Saved commands (B-21)

On Home, Gallery, Artwork and Profile, `add_to_saved` and `remove_from_saved`
reuse the singleton that paints every Saved button and refreshes the profile
list. They require one canonical artwork ID from its page URL, not a title,
auction ID or token ID. The active deployment comes from public configuration.
Repeating a command sends the same desired boolean; it never toggles the item.
Concurrent changes to the same artwork report busy. Success requires the server
acknowledgement for the same account and sign-in context.

These reversible preferences do not open a wallet or grant transaction access.
A guest or expired session must sign in through the ordinary site controls and
repeat the command; the assistant never resumes it automatically. Saved remains
private and does not affect Trust, ranking, prices or email subscriptions.
Other pages give an explicit availability response rather than navigating or
creating another store. Administrative commands remain excluded.

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

## Voice (B-09)

[`voice-commands.js`](../voice-commands.js) maps supported spoken and typed
phrases to the same tools. The write gate applies to both. Each phrase needs
its own parser coverage. For example, `explain_settlement` is available to
WebMCP clients, while the command grammar has no direct phrase for that tool.

The header launcher opens a text composer. A visitor can use the microphone
for one utterance or explicitly start a voice chat. In voice chat the microphone
waits while a tool runs and its reply plays, then listens for the next turn.
When a voice command opens an ArtSoul page in the same tab, the destination
restores the panel and resumes listening if the browser allows it. A browser
requiring a gesture displays Start voice chat. Manual navigation, reload,
Back, hiding the tab, changing accounts and explicit Stop end the session.
Typing returns control to the composer. A protected
command heard in chat pauses for a deliberate Send and the usual action
confirmation. The wallet still owns the signature. ArtSoul retains the
written answer when speech is unavailable.

Speech recognition depends on the browser and can send microphone audio to its
speech provider, as explained before first use. The [recorded voice](#spoken-responses)
uses the visitor's selected language. Typed replies are silent until the visitor
requests playback. The site shows dynamic artwork facts as text. The recognizer
and response player are separate from the RU/EN command parser.

“Show my collection” opens the Collected tab for ArtSoul NFTs. “Open my
gallery” opens Explore. “Let's create artwork” opens Publish. The visitor
chooses the media file. On Publish they can dictate a title, description or
supported duration, revise the suggestion and apply it with **Use these
details**. The publication form retains its existing authorization and final
review. “Open NFT” asks which destination or artwork number the visitor
means. “Marketplace” then opens that gallery tab. After a search or title
question, a bare reply supplies the value. It cannot authorize a wallet action.

Examples, in English or Russian: "what auctions are open" / «какие аукционы
открыты», "bid 0.05 on artwork 31" / «ставка 0,05 на работу 31», "my activity" /
«мой профиль», "stop using my wallet" / «стоп, не трогай кошелёк». Say "help" or
«помощь» for the rest.

Saved examples: "save artwork 34" / «добавь работу 34 в избранное» and
"remove artwork 34 from favorites" / «убери работу 34 из избранного».
Negations, questions, multiple IDs and incomplete Saved commands never choose
an action by extracting a phrase. Search terms remain data.

## Deferred acceptance for full user journeys

The November 18 founder decision sets the coverage target for future work.
Every action offered to an ordinary visitor, artist, owner or collector should
be reachable through speech and typing, using the same permissions, enabled
controls, validations and results as the pointer and keyboard UI. A request
for a private or protected action hands control to the person for wallet
selection, signatures, passkeys, native file selection and final approvals.
Only an authorized staff member can use administrative controls. Any future
assistant support for staff must use the same role checks, step-up and review
as the staff interface. Further assistant and WebMCP acceptance is deferred.
[Phase B handoff](PHASE_B_STATUS_2026-11-02.md)

| User journey | Available in the current local implementation | Work to cover in a later session |
| --- | --- | --- |
| Find and browse art | Catalog search, artwork by number, gallery tabs and NFT destination clarification | Gallery filter and sort, result selection, card menus, sharing, media playback and in-page guide topics |
| Use a wallet and profile | Profile navigation, activity summary, Collected and enabled Wallet NFTs, artwork Save/Remove | Open the wallet menu or connection chooser, change network or disconnect through the existing UI, edit a profile, open notifications and manage preferences |
| Publish a work | Open Publish, suggest or revise title, description and available auction duration, check the title | Review all enabled form fields and errors, hand off the file picker and final submission, then show the actual registration result |
| Bid, collect and resell | Read artwork, auction and provenance data, start or end an auction, bid, settle or close after default, list, reprice, cancel, buy and withdraw | Check that each result matches the visible auction, ownership or balance after indexing. Distinguish prepared, submitted and confirmed states |
| Support artists and report issues | Open the existing Donate or artwork Report form | Cover the other enabled form controls, community signals and profile reporting with the same review and submission steps as the UI |
| Explore collections and site settings | Open the Collections gallery tab and the guide | Map enabled collection-builder controls and personal display settings as their respective UI journeys become available |

For the first retest, record the served build, browser, wallet connection
state and language. Start separate conversations for “open NFT” and “open my
wallet.” The first needs a destination or artwork number. In a pending NFT
question, “wallet” means the gated Wallet NFTs tab. A fresh request to connect
the wallet needs the ordinary connection chooser. The current registry has
no tool for that chooser. A generic help reply leaves the case open.

Use the same starting state in local fixtures for pointer, typed command,
spoken command and a WebMCP tool call where supported. Record the resulting
route, visible tab, applied form values, account state or receipt as applicable.
Include cancellation and unavailable actions. A registered tool or a spoken
acknowledgement alone supplies no evidence of a completed journey. Append new
user controls to this inventory as they ship. Existing [navigation checks](../test/voice-navigation-dialogue.test.cjs)
and [device observations](audits/VOICE_ASSISTANT_HANDOFF_2026-11-18.md)
identify which results already have local or physical-device evidence.

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
- "What do I have on ArtSoul, and what needs me?" — works, NFTs, leading bids,
  won auctions to pay, listings, withdrawable funds, and the tool for each.
- "Pay for the auction I won." / "List artwork 19 for 0.002." / "Buy artwork 19."
  — each names the work and the figure on the page before the wallet opens.
- "Put artwork 31 up for auction for 36 hours at 0.005." — the duration is
  checked against what the contract accepts.
- "Withdraw my money." / "Stop using my wallet."

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

`test/webmcp-agent-actions.test.cjs` covers the B-12 writes: every refusal the
contract would otherwise revert, the price read from the contract rather than
the conversation, wei-exact floor comparison, the per-action page confirmation,
the one-action lock, revoking access, and the absence of copied durations and
splits. Its safety assertions were checked by removing each guard and watching
the test fail.
