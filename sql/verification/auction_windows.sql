-- Operator preflight for the current Base Sepolia Core. Run once in a fresh
-- read-only transaction. Times are from indexed projections and the DB clock.
-- An open window identifies a candidate for a check. It cannot confirm wallet
-- eligibility, delivery to an inbox, or a successful on-chain action.
WITH current_rounds AS NOT MATERIALIZED (
    SELECT a.*
    FROM public.v41_auctions a
    JOIN public.v41_artworks w
      ON w.chain_id = a.chain_id AND w.artwork_id = a.artwork_id
     AND w.active_auction_id = a.auction_id
    WHERE a.chain_id = 84532 AND NOT w.minted
      AND NOT EXISTS (
          SELECT 1 FROM public.artwork_moderation_visibility v
          WHERE v.chain_id = a.chain_id AND v.artwork_id = a.artwork_id AND v.hidden
      )
), late_bids AS (
    SELECT 'late_bid' AS scenario, artwork_id, auction_id,
           end_time - interval '10 minutes' AS opens_at, end_time AS deadline
    FROM current_rounds
    WHERE status = 'active' AND end_time > CURRENT_TIMESTAMP
      AND end_time < original_end_time + interval '60 minutes'
    ORDER BY end_time, auction_id
    LIMIT 5
), finalizable AS (
    -- Finalizing starts the winner's clock. Offer this path only if that
    -- participant is present and ready to pay during the joint session.
    SELECT 'finalize' AS scenario, artwork_id, auction_id,
           end_time AS opens_at, NULL::timestamptz AS deadline
    FROM current_rounds
    WHERE status = 'active' AND end_time <= CURRENT_TIMESTAMP
      AND current_bid > 0 AND current_bidder ~* '^0x[0-9a-f]{40}$'
      AND lower(current_bidder) <> '0x0000000000000000000000000000000000000000'
    ORDER BY end_time DESC, auction_id
    LIMIT 5
), payments AS (
    SELECT 'payment' AS scenario, artwork_id, auction_id,
           settlement_deadline - interval '24 hours' AS opens_at, settlement_deadline AS deadline
    FROM current_rounds
    WHERE status = 'settlement_pending' AND settlement_deadline > CURRENT_TIMESTAMP
      AND winning_bid > 0 AND winner ~* '^0x[0-9a-f]{40}$'
      AND lower(winner) <> '0x0000000000000000000000000000000000000000'
    ORDER BY settlement_deadline, auction_id
    LIMIT 5
), candidates AS (
    SELECT * FROM late_bids UNION ALL SELECT * FROM finalizable UNION ALL SELECT * FROM payments
)
SELECT CURRENT_TIMESTAMP AS checked_at, s.scenario,
       CASE WHEN c.auction_id IS NULL THEN 'no_candidate'
            WHEN CURRENT_TIMESTAMP < c.opens_at THEN 'waiting' ELSE 'open' END AS window_state,
       c.artwork_id::text AS artwork_id, c.auction_id::text AS auction_id, c.opens_at, c.deadline
FROM (VALUES ('late_bid'), ('finalize'), ('payment')) s(scenario)
LEFT JOIN candidates c ON c.scenario = s.scenario
ORDER BY s.scenario, c.deadline, c.opens_at DESC, c.auction_id;
