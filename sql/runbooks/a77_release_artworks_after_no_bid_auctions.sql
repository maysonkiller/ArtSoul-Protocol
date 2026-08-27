-- A-77 FOUNDER-OPERATED ONE-TIME BACKFILL.
--
-- Releases artworks whose auction ended with no bids but whose projection row
-- still points at that finished auction.
--
-- WHY THIS EXISTS
--   `AuctionEnded` is the terminal event for an auction nobody bid on: no
--   settlement and no default can follow it. Only those two handlers ever
--   cleared `v41_artworks.active_auction_id`, so a no-bid ending left the
--   artwork pointing at a finished auction forever. On chain
--   `ArtSoulCore.endAuction` had already set `Artwork.activeAuctionId` to 0 for
--   the same event, and `createAuction` asks only for an unminted work with
--   `activeAuctionId == 0` - so the contract was ready to auction these works
--   again while every surface reading the projection believed an auction was
--   still running, and the creator's own profile refused a new auction.
--
--   The indexer fix in the same change closes the leak for every future
--   ending. This script repairs the rows already stored wrong. Run it AFTER
--   the fixed indexer is deployed, so nothing re-creates the state.
--
-- WHAT IT DOES NOT DO
--   It never touches an auction with a bidder. A winner who has not settled
--   still occupies the artwork on chain, and clearing that would show a work as
--   free while its winner can still complete the settlement. It changes no
--   auction row, no bid, no settlement, no floor, no ownership, and no economic
--   value. It only clears a pointer the contract has already cleared.
--
-- HOW TO RUN
--   1. Take a database backup and confirm it completed.
--   2. Run STEP 1 alone and read the list. Every row must be a work you expect
--      to see released. If anything looks wrong, stop and report it.
--   3. Run STEP 2 inside its transaction. Read the reported count and compare
--      it with STEP 1 before COMMIT. ROLLBACK if they disagree.
--   4. Run STEP 3. It must return no rows.
--
-- Service role, Supabase SQL editor. Not reachable from any browser or API.

-- ---------------------------------------------------------------------------
-- STEP 1 - INSPECT. Run alone, review, and keep the output as evidence.
-- ---------------------------------------------------------------------------
SELECT
    art.chain_id,
    art.artwork_id,
    art.active_auction_id      AS stale_auction_id,
    auc.status                 AS auction_status,
    auc.winner,
    auc.winning_bid,
    art.minted,
    art.last_updated_at
FROM v41_artworks AS art
JOIN v41_auctions AS auc
  ON auc.chain_id = art.chain_id
 AND auc.auction_id = art.active_auction_id
WHERE art.active_auction_id IS NOT NULL
  AND art.minted = FALSE
  AND auc.status = 'defaulted_no_bids'
  AND auc.winner IS NULL
ORDER BY art.chain_id, (art.artwork_id)::NUMERIC;

-- ---------------------------------------------------------------------------
-- STEP 2 - REPAIR. Review the count against STEP 1 before COMMIT.
-- ---------------------------------------------------------------------------
BEGIN;

WITH released AS (
    UPDATE v41_artworks AS art
    SET active_auction_id = NULL,
        last_updated_at = NOW()
    FROM v41_auctions AS auc
    WHERE auc.chain_id = art.chain_id
      AND auc.auction_id = art.active_auction_id
      AND art.active_auction_id IS NOT NULL
      AND art.minted = FALSE
      AND auc.status = 'defaulted_no_bids'
      AND auc.winner IS NULL
    RETURNING art.chain_id, art.artwork_id
)
SELECT chain_id, count(*) AS released_artworks
FROM released
GROUP BY chain_id;

-- Compare the count with STEP 1. Then:
--   COMMIT;    -- if they match
--   ROLLBACK;  -- if they do not

-- ---------------------------------------------------------------------------
-- STEP 3 - VERIFY. Must return zero rows after COMMIT.
-- ---------------------------------------------------------------------------
SELECT art.chain_id, art.artwork_id, art.active_auction_id
FROM v41_artworks AS art
JOIN v41_auctions AS auc
  ON auc.chain_id = art.chain_id
 AND auc.auction_id = art.active_auction_id
WHERE art.active_auction_id IS NOT NULL
  AND art.minted = FALSE
  AND auc.status = 'defaulted_no_bids'
  AND auc.winner IS NULL;
