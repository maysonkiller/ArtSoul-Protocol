# B-08 — WebMCP accepted in ChatGPT's in-app browser, 2026-09-02

B-08 declared eleven ArtSoul tools to whatever agent drives the page. Its
acceptance was a real agent using them on production, not a test run. The
founder ran it, and this file records what that run showed.

## The run

| | |
| --- | --- |
| Date | 2026-09-02, 12:36-12:39 CEST |
| Surface | ChatGPT desktop, in-app browser, site tools enabled |
| Origin | `artsoulprotocol.com` |
| Operator | the founder |
| Record | the agent's answers, pasted into the working session the same day |

**Question 1.** *What ArtSoul auctions are open for bidding right now, and when do
they end?*

The agent answered with three Base Sepolia auctions, #37, #38 and #39, each with
its artwork title, end time converted to CEST, no bids, and a 0.005 ETH starting
price. It stated that the live API and the Core contract agreed at block
46,288,570.

Checked against the projection on 2026-09-15: auctions 37, 38 and 39 on artworks
31, 29 and 30 all started at 0.005 ETH and ended at 17:32:08, 10:11:42 and
10:12:04 UTC, which are the CEST times the agent gave. No other auction was open
at that moment.

**Question 2.** *Who created ArtSoul artwork 19, who was its first collector, and
who owns it now?*

The agent named the creator by profile name with the masked address, `Fourcat`,
`0xA61C…0329`, which matches the artwork page on production.

**The wallet boundary.** During the same recording session the founder reported
the agent stopping to ask for confirmation before a bid, which is the layer
declining to act without the person. The final video itself was not reviewed for
this record.

## What followed

The video was published on YouTube on 2026-09-02 and the Devpost submission to
the OpenAI WebMCP Challenge was completed before the 3 September deadline. On
2026-09-15 the founder confirmed again that the tools work in ChatGPT.

## What this does not cover

The row also named Chrome with `chrome://flags/#enable-webmcp-testing`. No run in
that browser was recorded. The surface that was built for, demonstrated and
judged is ChatGPT's in-app browser, and the founder accepted the row on that
evidence. A Chrome run remains a useful second check if the flag-gated
implementation diverges, but it no longer holds the row open.
