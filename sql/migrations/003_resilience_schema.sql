-- 003: RESILIENCE SCHEMA
-- Error tracking, recovery queues and blockchain reorg handling.

-- Indexer Errors Table
CREATE TABLE IF NOT EXISTS indexer_errors (
    id BIGSERIAL PRIMARY KEY,
    error_type VARCHAR(100) NOT NULL,
    block_number BIGINT,
    transaction_hash VARCHAR(66),
    error_message TEXT NOT NULL,
    error_data JSONB,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    retry_count INTEGER DEFAULT 0,
    last_retry_at TIMESTAMPTZ,

    CONSTRAINT max_retries CHECK (retry_count <= 10)
);

CREATE INDEX idx_errors_error_type ON indexer_errors(error_type);
CREATE INDEX idx_errors_block_number ON indexer_errors(block_number) WHERE block_number IS NOT NULL;
CREATE INDEX idx_errors_occurred_at ON indexer_errors(occurred_at DESC);
CREATE INDEX idx_errors_resolved ON indexer_errors(resolved) WHERE NOT resolved;
CREATE INDEX idx_errors_retry ON indexer_errors(retry_count, last_retry_at) WHERE NOT resolved AND retry_count < 10;

-- Reorg Events Table (Track blockchain reorganizations)
CREATE TABLE IF NOT EXISTS reorg_events (
    id BIGSERIAL PRIMARY KEY,
    from_block BIGINT NOT NULL,
    to_block BIGINT NOT NULL,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    events_rolled_back INTEGER DEFAULT 0,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_reorg_detected_at ON reorg_events(detected_at DESC);
CREATE INDEX idx_reorg_resolved ON reorg_events(resolved) WHERE NOT resolved;

-- Retry Queue Table (Failed events for retry)
CREATE TABLE IF NOT EXISTS retry_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type VARCHAR(100) NOT NULL,
    event_data JSONB NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    log_index INTEGER NOT NULL,
    error_message TEXT NOT NULL,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 5,
    next_retry_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_retry_at TIMESTAMPTZ,

    CONSTRAINT max_retry_limit CHECK (retry_count <= max_retries)
);

CREATE INDEX idx_retry_queue_next_retry ON retry_queue(next_retry_at) WHERE retry_count < max_retries;
CREATE INDEX idx_retry_queue_event_type ON retry_queue(event_type);
CREATE INDEX idx_retry_queue_created_at ON retry_queue(created_at DESC);

-- Function to mark events as confirmed
CREATE OR REPLACE FUNCTION mark_events_confirmed(confirmation_block BIGINT, confirmation_depth INTEGER)
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER := 0;
    temp_count INTEGER;
BEGIN
    -- Mark auctions as confirmed
    UPDATE indexed_auctions
    SET confirmed = TRUE
    WHERE block_number <= (confirmation_block - confirmation_depth)
    AND NOT confirmed;

    GET DIAGNOSTICS temp_count = ROW_COUNT;
    updated_count := updated_count + temp_count;

    -- Mark bids as confirmed
    UPDATE indexed_bids
    SET confirmed = TRUE
    WHERE block_number <= (confirmation_block - confirmation_depth)
    AND NOT confirmed;

    GET DIAGNOSTICS temp_count = ROW_COUNT;
    updated_count := updated_count + temp_count;

    -- Mark events as confirmed
    UPDATE contract_events
    SET confirmed = TRUE
    WHERE block_number <= (confirmation_block - confirmation_depth)
    AND NOT confirmed;

    GET DIAGNOSTICS temp_count = ROW_COUNT;
    updated_count := updated_count + temp_count;

    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Function to rollback events from reorg
CREATE OR REPLACE FUNCTION rollback_events_from_block(from_block BIGINT)
RETURNS TABLE(auctions_deleted INTEGER, bids_deleted INTEGER, events_deleted INTEGER) AS $$
DECLARE
    auctions_count INTEGER;
    bids_count INTEGER;
    events_count INTEGER;
BEGIN
    -- Delete auctions
    DELETE FROM indexed_auctions WHERE block_number >= from_block AND NOT confirmed;
    GET DIAGNOSTICS auctions_count = ROW_COUNT;

    -- Delete bids
    DELETE FROM indexed_bids WHERE block_number >= from_block AND NOT confirmed;
    GET DIAGNOSTICS bids_count = ROW_COUNT;

    -- Delete events
    DELETE FROM contract_events WHERE block_number >= from_block AND NOT confirmed;
    GET DIAGNOSTICS events_count = ROW_COUNT;

    RETURN QUERY SELECT auctions_count, bids_count, events_count;
END;
$$ LANGUAGE plpgsql;
