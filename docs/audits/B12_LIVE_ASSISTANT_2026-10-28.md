# B12 real assistant acceptance: Chrome and Rabby

Workspace: `C:\Projects\ArtSoul`, branch `codex/takeover-audit`.
Starting documentation HEAD: `53e58dc2bd674b9dd35ef22e57f4843470e5160f`.
Published implementation: `63c0c28626a47d5e755d347ab44e03fcdac647c5`.
Status: real connected-wallet read and declined review passed; signed mutation pending.

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

## Next bounded step

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
