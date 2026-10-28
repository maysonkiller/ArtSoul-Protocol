# B12 settlement completion and B21 native audio acceptance

Workspace: `C:\Projects\ArtSoul`, branch `codex/takeover-audit`.
Starting HEAD: `33497c9ce0959df14050dc731d296adcc810a045`.
Scope: B12 confirmed action completion; Bible sections 1, 2, 4, 5 and 13
(theme document 16). No contract, economics, permission or database changes.

## Real owner-operated acceptance

In Chrome with Rabby, the owner spoke `my activity` in Russian and separately
confirmed that the reply was audible. This proves one native desktop speech
recognition/read/spoken-response journey. It does not prove unrestricted AI,
paid OpenAI voice, other languages or mobile voice acceptance.

The owner then approved these Base Sepolia transactions for Taes, artwork 38,
auction 73. They are completed operations and must not be replayed.

| Action | Transaction | Block |
| --- | --- | --- |
| End auction | `0x95368318b481fa4760543ec365572c6c4a715be3d4e1ec3f4c825dd75fe31307` | 51483629 |
| Settle and mint | `0x9276c36e2d3df54fa13b6c3e8efdadda2b6c38b5c368027dd2dee9d6125d457f` | 51484121 |

Both existing RPCs agreed on chain 84532, pinned core/NFT code hashes, successful
receipts, artwork/auction mapping, and the following outcome:

- Token 7 minted to `0x6EC8C121043357aC231E36D403EdAbf90AE6989B`.
- Canonical floor is 0.001 ETH; active auction pointer and locked deposit cleared.
- Settlement transaction value is zero. The original 0.01 ETH deposit covers
  the 0.001 ETH winning bid; gas is separate.
- Winner credit increased by 0.009 ETH, creator credit by 0.000975 ETH and
  protocol treasury credit by 0.000025 ETH. No withdrawal is claimed here.
- The public API returned sold/minted/token 7 with the correct owner and floor.

Ignored evidence is retained in `docs/private/b12-taes-ended-2026-10-28.json`,
`b12-taes-settled-2026-10-28.json` and `b12-taes-settled-verified-2026-10-28.json`.
The last file corrects a verifier display error: remaining payment is inapplicable
after settlement, not winning bid minus the now-cleared deposit. It independently
checks transaction value zero. Earlier evidence is preserved, not overwritten.

## Reproduction and cause

After the real settlement, the open artwork still offered Complete Settlement.
The assistant retained the payment command in its input and showed a raw hash.
The settlement adapter awaited a receipt but never published the shared auction
refresh notice, unlike end/default/create and resale. The command controller
also left every successful write armed in the composer.

## Change

- Settlement uses the existing successful-receipt/repricing validator and emits
  the existing auction event. A bounded settled bridge closes stale payment
  state across shared readers; indexed owner, floor, metadata and token identity
  are never taken from browser storage. Newer auction and indexed resale win.
- A fresh on-chain status check rejects repeat settlement before a wallet write.
- Successful writes clear the command, disable empty submission and show a next
  action prompt, an artwork/profile link and a validated Base Sepolia receipt
  link. Declines and errors retain the draft. No automatic transaction follows.
- Only explicitly confirmed settlement says the NFT is received; submitted-only
  results retain the weaker wording. The panel stays open so the result can be
  read; opening the artwork closes it. Search drafts remain available to refine.
- Russian activity uses translated actions and links rather than internal tool
  names. Available optional actions are no longer labelled urgent obligations.
- Expired-auction guidance now distinguishes winning-bid settlement from no-bid
  re-auction. These are presentation interpretations, not new protocol rules.

## Validation before release

204 affected tests pass, zero skips: auction receipt reconciliation, ID namespaces,
artwork action gates, command controller/grammar, agent actions, resale and cache
pins. Tests include delayed confirmation, failed receipts, already settled state,
stale projections, cross-tab receipt reuse, metadata injection rejection, retry
drafts, result links, translation and composer replay protection.

`npm run build` passes, including 11 route and 173 utility checks.
Real Chrome rendering of the built page passes in desktop Classic and 390px
Future with deliberately stale API data and isolated fake wallet transports.
The payment button disappears, the empty composer is disabled, result links
work, and the mobile page has no horizontal overflow. Screenshots were inspected:
`output/b12-settlement-completion-desktop.png` and
`output/b12-settlement-completion-mobile.png`. Browser fixtures are not new signed
transactions. No completed Taes transaction was replayed to test the patch.

Release status and final hosted checks are recorded below after completion.
Phase B remains open for its other named acceptance/operational gates.
