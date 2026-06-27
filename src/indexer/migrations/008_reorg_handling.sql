-- Reorg Handling for Blockchain Indexer
-- Stores block hashes to detect chain reorganizations

-- Block hashes table for reorg detection
CREATE TABLE IF NOT EXISTS block_hashes (
    block_number BIGINT PRIMARY KEY,
    block_hash VARCHAR(66) NOT NULL,
    parent_hash VARCHAR(66) NOT NULL,
    timestamp BIGINT NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for parent chain verification
CREATE INDEX IF NOT EXISTS idx_block_hashes_parent
    ON block_hashes(parent_hash);

-- Index for timestamp queries
CREATE INDEX IF NOT EXISTS idx_block_hashes_timestamp
    ON block_hashes(timestamp);

COMMENT ON TABLE block_hashes IS 'Stores block hashes for reorg detection';
COMMENT ON COLUMN block_hashes.block_hash IS 'Current block hash';
COMMENT ON COLUMN block_hashes.parent_hash IS 'Parent block hash for chain continuity check';

-- Drop existing function if exists
DROP FUNCTION IF EXISTS rollback_events_from_block(BIGINT);

-- Rollback function for reorg handling
CREATE OR REPLACE FUNCTION rollback_events_from_block(reorg_block BIGINT)
RETURNS TABLE(
    events_deleted BIGINT,
    auctions_deleted BIGINT,
    bids_deleted BIGINT,
    outbox_deleted BIGINT
) AS $$
DECLARE
    v_events_deleted BIGINT;
    v_auctions_deleted BIGINT;
    v_bids_deleted BIGINT;
    v_outbox_deleted BIGINT;
BEGIN
    -- Delete from event_processing_registry
    DELETE FROM event_processing_registry
    WHERE block_number >= reorg_block;
    GET DIAGNOSTICS v_events_deleted = ROW_COUNT;

    -- Delete from indexed_auctions
    DELETE FROM indexed_auctions
    WHERE block_number >= reorg_block;
    GET DIAGNOSTICS v_auctions_deleted = ROW_COUNT;

    -- Delete from indexed_bids
    DELETE FROM indexed_bids
    WHERE block_number >= reorg_block;
    GET DIAGNOSTICS v_bids_deleted = ROW_COUNT;

    -- Delete from outbox_events (side effects from rolled back events)
    DELETE FROM outbox_events
    WHERE correlation_id IN (
        SELECT transaction_hash || '-' || log_index
        FROM contract_events
        WHERE block_number >= reorg_block
    );
    GET DIAGNOSTICS v_outbox_deleted = ROW_COUNT;

    -- Delete from contract_events
    DELETE FROM contract_events
    WHERE block_number >= reorg_block;

    -- Return counts
    RETURN QUERY SELECT v_events_deleted, v_auctions_deleted, v_bids_deleted, v_outbox_deleted;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION rollback_events_from_block IS 'Rolls back all data from reorg block onwards';
