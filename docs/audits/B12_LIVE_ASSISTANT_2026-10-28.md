# B12 real assistant acceptance: Chrome and Rabby

Latest continuation: `B12_SETTLEMENT_COMPLETION_2026-10-28.md` records actual
desktop microphone/spoken response and owner-signed Taes end/settlement, plus
the completion-state fix released in PR #388. Earlier pending audio/settlement
notes below are historical; other signed journey gates remain separate.

Workspace: `C:\Projects\ArtSoul`, branch `codex/takeover-audit`.
Starting documentation HEAD: `53e58dc2bd674b9dd35ef22e57f4843470e5160f`.
Published implementation: `63c0c28626a47d5e755d347ab44e03fcdac647c5`.
Status: real connected-wallet read, declined review, signed repricing and signed
removal passed. A subsequent owner listing is verified separately. Refresh and
provenance defects found during acceptance are patched locally; release pending.

## Observed journey

- The owner selected desktop Chrome and Rabby. The first controlled tab remained
  on the wallet picker. The owner reported that control prevented their clicks,
  opened another ArtSoul tab, and connected there. That second tab displayed the
  intended old test wallet `0x6EC8C121043357aC231E36D403EdAbf90AE6989B`.
- The account menu displayed Base Sepolia. The assistant's Russian read-only
  activity command returned 30 created, two owned, one resale listing and 30
  attention items. No financial request was submitted by this command. This is a
  bounded discovery summary, not an exhaustive live ownership proof.
- Profile / Collected showed Music 2 (artwork 32) for sale at 0.1 ETH and Tesst
  (artwork 18). Music 2's detail page showed token 5, canonical floor 0.0001 ETH,
  sale price 0.1 ETH, Change price and Remove from sale.
- The Russian price-edit command for artwork 32 at 0.11 ETH opened a real review
  dialog identifying Music 2, the artwork ID, old/new price and floor. Clicking
  Cancel returned the explicit permission refusal without proceeding to Rabby.
- The same command was prepared again and left at the ArtSoul review for the
  owner's final approval and wallet signature. No signed transaction is claimed.

## Independent read-only preflight

At block 51456851 (`2026-10-28T18:47:19Z`), both existing RPC endpoints agreed on:

- chain 84532 and the pinned core/NFT runtime hashes;
- artwork 32 mapped to token 5, minted, with the connected wallet as owner;
- active listing by that same wallet, price 0.1 ETH, floor 0.0001 ETH.

The six hashes in the retained September 29 transaction journal all have
successful receipts on both RPCs with the expected sender and destination. Its
old `SIGNED_NOT_CONFIRMED` snapshots were not treated as unperformed operations;
none was replayed. A separate append-only evidence file records reconciliation.

Private evidence: `docs/private/b12-live-assistant-preflight-2026-10-28.json` and
its read-only verifier. Screenshot:
`output/b12-live-review-music32-2026-10-28.png`. The verifier initially called the
NFT artwork-to-token lookup on the core and reverted; the target was corrected
to the existing NFT ABI, then the complete two-RPC preflight passed. No write
RPC exists in the verifier.

## Initial pending step (superseded by the signed evidence below)

The owner approves the prepared Music 2 edit from 0.1 to 0.11 test ETH in ArtSoul,
then reviews/signs the Base Sepolia request in Rabby. The edit changes the asking
price, not the floor or ownership; it sends no purchase payment and costs gas.
Read the visible result/receipt before any new command. Verify the receipt and
state with both RPCs and check indexer/UI convergence. Then exercise removal and
restore the original 0.1 ETH listing through separately reviewed owner-signed
commands. Reconcile current state first if interrupted. Do not rerun a completed
command merely because a browser result was missed.

No economics, contract, database, paid-provider or mainnet changes. Actual audio
recognition and signed command acceptance remain unperformed at this checkpoint.

## Signed acceptance and follow-up

The following receipts and state were independently verified through both
existing Base Sepolia RPCs, including chain 84532, pinned core/NFT hashes,
artwork32/token5 mapping, owner and unchanged 0.0001 ETH floor:

| Action | Transaction | Block | Result |
| --- | --- | --- | --- |
| Assistant repricing to 0.11 test ETH | `0xb41087037029312e7ed138531871600962ed1964024a183395fd56d7660e3ca4` | 51458340 | Successful, active listing at 0.11 |
| Assistant removal | `0xd59f37395c1b018515a9e8195c6ecb560798d5054d68f9c05ab94b5f7953bc4d` | 51460564 | Successful, inactive listing; UI offers List NFT |
| Subsequent owner listing at the floor | `0x90e37a804c2a4c9e7c8fb18d24ac7650c9e3716353b8595d26a5fb623d4b745f` | 51461486 | Successful, active listing at 0.0001; page agrees |

The last listing was observed after the owner interacted with the page, not
submitted by the agent. Do not attribute it to assistant acceptance or overwrite
it with the earlier planned 0.1 restoration. The owner is now away and requested
independent work; further signatures wait. No new write is pending in the tab.

Public API reads confirmed the 0.11 price while the open page retained 0.1.
The receipt handler waited for the entire artwork read before updating visible
state. It now applies the existing receipt bridge synchronously, then refreshes;
a regression test holds the refresh unresolved and verifies the new price or
cancellation immediately, with owner/floor preserved. A fresh real signed edit
after release remains necessary to confirm this specific latency symptom.

The provenance defect was reproduced independently in the public API: current
price 0.11 was attached to the original September 7 listing transaction/time.
Cause: `buildTimeline` treated mutable `v41_resale_listings` as event history.
The patch reads bounded, chain/token-scoped immutable `ResaleListed` logs from
`contract_events`. Each listing survives later edits/removal with its original
price and receipt; truncation is explicit. No synthetic cancellation is added:
the deployed contract emits no cancellation event. Existing owner resolution
and moderation suppression remain unchanged.

The real database contains five listing logs for token5: the original 0.1,
three 0.11 transactions, and the latest 0.0001 listing. The local handler's
read-only run against that database returned all five correct event/price pairs.
The other two 0.11 hashes are `0xb9e47789813475c59bf5159de24edd6c4d53229c01f34876ccf2f7e88793e1af`
and `0xb20ae02a2bfd22bef7e1abb5d444e3ed45c6b4218fa9d9222476ee40c2018f16`;
do not replay them or claim their unobserved submission UI.

The strict Russian parser rejected "выстави работу 32 на продажу за 0,1".
It now accepts that explicit variant with the same review/signature requirements;
runtime voice cache version is 11. This remains bounded EN/RU grammar, not an
unrestricted multilingual AI assistant.

Validation: 139 affected resale/provenance/parser/snapshot checks pass; 109
agent/cache-version checks pass (overlapping suites, not 248 unique checks).
Build and release results are recorded below once complete. Private evidence:
`b12-price-edit-confirmed-2026-10-28.json`, `b12-remove-confirmed-2026-10-28.json`,
`b12-owner-relisted-confirmed-2026-10-28.json`, `b12-resale-events-2026-10-28.json`
and `b12-fixed-provenance-read-2026-10-28.json` under `docs/private/`.

No data migration, economic change, autonomous signature or paid API activation.
Snapshot timing is a separate approved amendment linked in the canon changelog.

The final local build passes 11 route and 173 Tailwind-utility checks. A built
Chrome fixture holds all artwork API reads unresolved after a synthetic receipt:
price changes to 0.11 immediately, and cancellation immediately removes the sale
price and shows List NFT. Both browser cases pass; owner/floor remain unchanged.
No real wallet is installed in that fixture. Screenshot:
`output/b12-slow-read-price-2026-10-28.png`. Real post-release acceptance stays
separate.

## Release verification

Released in PR #385, candidate `7b9b76f5996cb48087f0973c4d4a4397a822050c`,
production merge `a093d1a54dd6168ed63fabfb438394bf8c73cbfc` (identical tree).
Candidate CI40752823553 and post-merge CI40753567678 pass Linux, Windows and static checks. Production
deployment7395108941 succeeded. Preview and apex each pass eight route and four
exact asset checks, including voice v11. Both rendered pages show nine provenance
events: the four existing lifecycle events and all five immutable listings.
The apex still shows the owner's current 0.0001 ETH asking price and floor,
with Change price / Remove from sale available. No new signature was requested.
Screenshot: `output/b12-pr385-apex-2026-10-28.png`.
The actual signed post-release refresh and microphone journeys remain pending.
