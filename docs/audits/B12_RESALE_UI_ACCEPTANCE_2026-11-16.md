# Resale UI production acceptance

Date: November 16, 2026

## New transaction

The owner signed a new assistant purchase of Music 2, artwork 32 / token 5,
using lys in Rabby on Base Sepolia. This did not repeat the previously completed
Taes purchase. The existing listing required no new approval or listing action.

Both independent public RPCs confirm transaction
`0x86ae0bd17970acdd3dfda92ced13896e4a69099853435ce72604dd676ce5aab5`,
status 1, block `59568267`, `2026-11-16T13:25:22Z` (14:25:22 Europe/Warsaw).
The call is `buyResale(5)` against the pinned Core with value `0.0001 ETH`;
the seller is the founder and the buyer is lys. Matching Core resale and NFT
transfer logs, current runtime identities, Core/NFT bindings and the artwork
mapping were verified read-only. The listing is inactive, owner is lys and
canonical floor remains `0.0001 ETH`.

Private verification evidence: `docs/private/b12-music2-receipt-2026-11-16.json`.

## Observed page result

The existing production page remained open from preparation through the owner's
signature. The owner was instructed not to reload; the agent did not reload or
navigate that tab. The resumed observation shows:

- Creator: lys; First Collector: maysonkiller; Owner: lys.
- Buy and the old sale price are gone; the new owner can see List NFT.
- Provenance grew from nine to ten events, including Resale completed with the
  exact new transaction, seller, owner and price.
- The assistant input is empty, Send is disabled, and success follow-ups link
  to the artwork and the exact transaction.

Screenshot: `output/b12-music2-purchase-success-2026-11-16.jpg`.
The direct public card and complete provenance endpoint independently agree.

This accepts the complete production resale UI journey after the correction in
PR #482. The browser's retained network-event buffer was truncated by the time
the owner returned; the initial stale response and exact retry timing were not
captured. Therefore this is no-reload outcome evidence, not a measured live
delay test. Existing controlled regressions establish bounded delayed retries,
history convergence, hidden-page handling, cancellation and exhaustion.
Do not repeat either completed purchase to manufacture timing evidence.

## Remaining scope

This result does not declare all of Phase B complete. The reported first-attempt
mobile profile sign-in issue, separately unconfirmed native voice behavior,
reminder delivery/extension observations and provider/operational acceptance
retain their recorded boundaries. Contract replacement and the later real-user
beta remain separate work.
