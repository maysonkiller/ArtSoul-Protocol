-- Migration 015: precomputed, chain-scoped public metrics for the homepage.
--
-- The browser and public API must never scan lifecycle projections or fan out
-- to RPC providers to calculate headline metrics. The indexer records only
-- metric-bearing contract events; triggers maintain one aggregate row per
-- chain. Metric events reference contract_events with ON DELETE CASCADE, so
-- the existing chain-scoped reorg rollback automatically reverses them.

CREATE TABLE IF NOT EXISTS public.v41_public_metric_participants (
    chain_id NUMERIC(78,0) NOT NULL,
    participant_type VARCHAR(16) NOT NULL
        CHECK (participant_type IN ('artist', 'collector')),
    participant_address VARCHAR(42) NOT NULL,
    first_seen_block BIGINT NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (chain_id, participant_type, participant_address)
);

CREATE TABLE IF NOT EXISTS public.v41_public_metric_events (
    chain_id NUMERIC(78,0) NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    log_index INTEGER NOT NULL,
    event_name VARCHAR(100) NOT NULL,
    participant_type VARCHAR(16)
        CHECK (participant_type IS NULL OR participant_type IN ('artist', 'collector')),
    participant_address VARCHAR(42),
    auctions_completed_delta BIGINT NOT NULL DEFAULT 0
        CHECK (auctions_completed_delta >= 0),
    settled_volume_delta NUMERIC(78,0) NOT NULL DEFAULT 0
        CHECK (settled_volume_delta >= 0),
    block_number BIGINT NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (chain_id, transaction_hash, log_index),
    CONSTRAINT v41_public_metric_event_participant_pair
        CHECK (
            (participant_type IS NULL AND participant_address IS NULL)
            OR
            (participant_type IS NOT NULL AND participant_address IS NOT NULL)
        ),
    CONSTRAINT v41_public_metric_event_contract_event_fk
        FOREIGN KEY (chain_id, transaction_hash, log_index)
        REFERENCES public.contract_events (chain_id, transaction_hash, log_index)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.v41_public_metrics (
    chain_id NUMERIC(78,0) PRIMARY KEY,
    artists_onboarded BIGINT NOT NULL DEFAULT 0 CHECK (artists_onboarded >= 0),
    auctions_completed BIGINT NOT NULL DEFAULT 0 CHECK (auctions_completed >= 0),
    unique_collectors BIGINT NOT NULL DEFAULT 0 CHECK (unique_collectors >= 0),
    settled_volume_wei NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK (settled_volume_wei >= 0),
    last_updated_block BIGINT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_v41_public_metric_events_chain_block
    ON public.v41_public_metric_events(chain_id, block_number);
CREATE INDEX IF NOT EXISTS idx_v41_public_metric_events_participant
    ON public.v41_public_metric_events(chain_id, participant_type, participant_address);

CREATE OR REPLACE FUNCTION public.apply_v41_public_metric_event_insert()
RETURNS TRIGGER AS $$
DECLARE
    v_participant_inserted BIGINT := 0;
BEGIN
    IF NEW.participant_type IS NOT NULL THEN
        INSERT INTO public.v41_public_metric_participants (
            chain_id,
            participant_type,
            participant_address,
            first_seen_block,
            first_seen_at
        ) VALUES (
            NEW.chain_id,
            NEW.participant_type,
            LOWER(NEW.participant_address),
            NEW.block_number,
            NEW.indexed_at
        )
        ON CONFLICT (chain_id, participant_type, participant_address) DO NOTHING;
        GET DIAGNOSTICS v_participant_inserted = ROW_COUNT;
    END IF;

    INSERT INTO public.v41_public_metrics (
        chain_id,
        artists_onboarded,
        auctions_completed,
        unique_collectors,
        settled_volume_wei,
        last_updated_block,
        updated_at
    ) VALUES (
        NEW.chain_id,
        CASE WHEN NEW.participant_type = 'artist' AND v_participant_inserted = 1 THEN 1 ELSE 0 END,
        NEW.auctions_completed_delta,
        CASE WHEN NEW.participant_type = 'collector' AND v_participant_inserted = 1 THEN 1 ELSE 0 END,
        NEW.settled_volume_delta,
        NEW.block_number,
        NEW.indexed_at
    )
    ON CONFLICT (chain_id) DO UPDATE SET
        artists_onboarded = public.v41_public_metrics.artists_onboarded +
            CASE WHEN NEW.participant_type = 'artist' AND v_participant_inserted = 1 THEN 1 ELSE 0 END,
        auctions_completed = public.v41_public_metrics.auctions_completed +
            NEW.auctions_completed_delta,
        unique_collectors = public.v41_public_metrics.unique_collectors +
            CASE WHEN NEW.participant_type = 'collector' AND v_participant_inserted = 1 THEN 1 ELSE 0 END,
        settled_volume_wei = public.v41_public_metrics.settled_volume_wei +
            NEW.settled_volume_delta,
        last_updated_block = GREATEST(
            COALESCE(public.v41_public_metrics.last_updated_block, NEW.block_number),
            NEW.block_number
        ),
        updated_at = GREATEST(public.v41_public_metrics.updated_at, NEW.indexed_at);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.apply_v41_public_metric_event_delete()
RETURNS TRIGGER AS $$
DECLARE
    v_participant_removed BIGINT := 0;
    v_next_seen_block BIGINT;
    v_next_seen_at TIMESTAMPTZ;
BEGIN
    IF OLD.participant_type IS NOT NULL THEN
        SELECT
            block_number,
            indexed_at
        INTO v_next_seen_block, v_next_seen_at
        FROM public.v41_public_metric_events
        WHERE chain_id = OLD.chain_id
          AND participant_type = OLD.participant_type
          AND LOWER(participant_address) = LOWER(OLD.participant_address)
        ORDER BY block_number ASC, indexed_at ASC, transaction_hash ASC, log_index ASC
        LIMIT 1;

        IF v_next_seen_block IS NULL THEN
            DELETE FROM public.v41_public_metric_participants
            WHERE chain_id = OLD.chain_id
              AND participant_type = OLD.participant_type
              AND participant_address = LOWER(OLD.participant_address);
            GET DIAGNOSTICS v_participant_removed = ROW_COUNT;
        ELSE
            UPDATE public.v41_public_metric_participants
            SET first_seen_block = v_next_seen_block,
                first_seen_at = v_next_seen_at
            WHERE chain_id = OLD.chain_id
              AND participant_type = OLD.participant_type
              AND participant_address = LOWER(OLD.participant_address)
              AND first_seen_block = OLD.block_number;
        END IF;
    END IF;

    UPDATE public.v41_public_metrics
    SET artists_onboarded = GREATEST(
            artists_onboarded -
                CASE WHEN OLD.participant_type = 'artist' AND v_participant_removed = 1 THEN 1 ELSE 0 END,
            0
        ),
        auctions_completed = GREATEST(
            auctions_completed - OLD.auctions_completed_delta,
            0
        ),
        unique_collectors = GREATEST(
            unique_collectors -
                CASE WHEN OLD.participant_type = 'collector' AND v_participant_removed = 1 THEN 1 ELSE 0 END,
            0
        ),
        settled_volume_wei = GREATEST(
            settled_volume_wei - OLD.settled_volume_delta,
            0
        ),
        last_updated_block = (
            SELECT MAX(block_number)
            FROM public.v41_public_metric_events
            WHERE chain_id = OLD.chain_id
        ),
        updated_at = NOW()
    WHERE chain_id = OLD.chain_id;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS v41_public_metric_event_insert
    ON public.v41_public_metric_events;
CREATE TRIGGER v41_public_metric_event_insert
AFTER INSERT ON public.v41_public_metric_events
FOR EACH ROW
EXECUTE FUNCTION public.apply_v41_public_metric_event_insert();

DROP TRIGGER IF EXISTS v41_public_metric_event_delete
    ON public.v41_public_metric_events;
CREATE TRIGGER v41_public_metric_event_delete
AFTER DELETE ON public.v41_public_metric_events
FOR EACH ROW
EXECUTE FUNCTION public.apply_v41_public_metric_event_delete();

CREATE OR REPLACE FUNCTION public.record_v41_public_metric_event(
    p_chain_id NUMERIC,
    p_transaction_hash VARCHAR,
    p_log_index INTEGER,
    p_event_name VARCHAR,
    p_participant_type VARCHAR,
    p_participant_address VARCHAR,
    p_auctions_completed_delta BIGINT,
    p_settled_volume_delta NUMERIC,
    p_block_number BIGINT,
    p_indexed_at TIMESTAMPTZ
) RETURNS BOOLEAN AS $$
DECLARE
    v_inserted BIGINT := 0;
BEGIN
    INSERT INTO public.v41_public_metric_events (
        chain_id,
        transaction_hash,
        log_index,
        event_name,
        participant_type,
        participant_address,
        auctions_completed_delta,
        settled_volume_delta,
        block_number,
        indexed_at
    ) VALUES (
        p_chain_id,
        p_transaction_hash,
        p_log_index,
        p_event_name,
        p_participant_type,
        CASE WHEN p_participant_address IS NULL THEN NULL ELSE LOWER(p_participant_address) END,
        p_auctions_completed_delta,
        p_settled_volume_delta,
        p_block_number,
        p_indexed_at
    )
    ON CONFLICT (chain_id, transaction_hash, log_index) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN v_inserted = 1;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

-- Backfill the event ledger from authoritative V4.1 lifecycle projections.
-- The insert trigger builds the aggregate without an uncached runtime scan.
INSERT INTO public.v41_public_metric_events (
    chain_id, transaction_hash, log_index, event_name,
    participant_type, participant_address,
    auctions_completed_delta, settled_volume_delta,
    block_number, indexed_at
)
SELECT
    artwork.chain_id, artwork.transaction_hash, artwork.log_index, 'ArtworkRegistered',
    'artist', LOWER(artwork.creator),
    0, 0,
    artwork.block_number, artwork.indexed_at
FROM public.v41_artworks artwork
JOIN public.contract_events event
  ON event.chain_id = artwork.chain_id
 AND event.transaction_hash = artwork.transaction_hash
 AND event.log_index = artwork.log_index
ON CONFLICT (chain_id, transaction_hash, log_index) DO NOTHING;

INSERT INTO public.v41_public_metric_events (
    chain_id, transaction_hash, log_index, event_name,
    participant_type, participant_address,
    auctions_completed_delta, settled_volume_delta,
    block_number, indexed_at
)
SELECT
    settlement.chain_id, settlement.transaction_hash, settlement.log_index,
    CASE
        WHEN settlement.settlement_status = 'completed' THEN 'SettlementCompleted'
        ELSE 'SettlementDefaulted'
    END,
    CASE WHEN settlement.settlement_status = 'completed' THEN 'collector' ELSE NULL END,
    CASE WHEN settlement.settlement_status = 'completed' THEN LOWER(settlement.winner) ELSE NULL END,
    1,
    CASE WHEN settlement.settlement_status = 'completed' THEN COALESCE(settlement.final_price, 0) ELSE 0 END,
    settlement.block_number, settlement.indexed_at
FROM public.v41_settlements settlement
JOIN public.contract_events event
  ON event.chain_id = settlement.chain_id
 AND event.transaction_hash = settlement.transaction_hash
 AND event.log_index = settlement.log_index
WHERE settlement.settlement_status IN ('completed', 'defaulted')
ON CONFLICT (chain_id, transaction_hash, log_index) DO NOTHING;

INSERT INTO public.v41_public_metric_events (
    chain_id, transaction_hash, log_index, event_name,
    participant_type, participant_address,
    auctions_completed_delta, settled_volume_delta,
    block_number, indexed_at
)
SELECT
    ending.chain_id, ending.transaction_hash, ending.log_index, 'AuctionEnded',
    NULL, NULL,
    1, 0,
    ending.block_number, ending.indexed_at
FROM public.v41_auction_endings ending
JOIN public.contract_events event
  ON event.chain_id = ending.chain_id
 AND event.transaction_hash = ending.transaction_hash
 AND event.log_index = ending.log_index
WHERE ending.winner IS NULL
   OR LOWER(ending.winner) = '0x0000000000000000000000000000000000000000'
ON CONFLICT (chain_id, transaction_hash, log_index) DO NOTHING;

INSERT INTO public.v41_public_metric_events (
    chain_id, transaction_hash, log_index, event_name,
    participant_type, participant_address,
    auctions_completed_delta, settled_volume_delta,
    block_number, indexed_at
)
SELECT
    resale.chain_id, resale.transaction_hash, resale.log_index, 'ResaleCompleted',
    'collector', LOWER(resale.buyer),
    0, resale.price,
    resale.block_number, resale.indexed_at
FROM public.v41_resale_history resale
JOIN public.contract_events event
  ON event.chain_id = resale.chain_id
 AND event.transaction_hash = resale.transaction_hash
 AND event.log_index = resale.log_index
ON CONFLICT (chain_id, transaction_hash, log_index) DO NOTHING;

-- These tables contain public-facing aggregate data but remain service-only at
-- the database boundary. The public API exposes only a narrow normalized row.
ALTER TABLE public.v41_public_metric_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v41_public_metric_participants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.v41_public_metric_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v41_public_metric_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.v41_public_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v41_public_metrics FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.v41_public_metric_participants FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v41_public_metric_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v41_public_metrics FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.v41_public_metric_participants TO service_role;
GRANT ALL ON public.v41_public_metric_events TO service_role;
GRANT ALL ON public.v41_public_metrics TO service_role;

REVOKE ALL ON FUNCTION public.record_v41_public_metric_event(
    NUMERIC, VARCHAR, INTEGER, VARCHAR, VARCHAR, VARCHAR,
    BIGINT, NUMERIC, BIGINT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_v41_public_metric_event(
    NUMERIC, VARCHAR, INTEGER, VARCHAR, VARCHAR, VARCHAR,
    BIGINT, NUMERIC, BIGINT, TIMESTAMPTZ
) TO service_role;

REVOKE ALL ON FUNCTION public.apply_v41_public_metric_event_insert()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_v41_public_metric_event_delete()
    FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.v41_public_metrics
IS 'Precomputed chain-scoped public metrics; updated incrementally by indexed lifecycle events';
COMMENT ON TABLE public.v41_public_metric_events
IS 'Reorg-safe event ledger backing v41_public_metrics; cascades with contract_events rollback';
