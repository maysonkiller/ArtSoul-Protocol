-- Event processing registry for idempotency
CREATE TABLE IF NOT EXISTS event_processing_registry (
    event_hash VARCHAR(66) PRIMARY KEY,
    transaction_hash VARCHAR(66) NOT NULL,
    log_index INTEGER NOT NULL,
    event_name VARCHAR(100) NOT NULL,
    block_number BIGINT NOT NULL,
    processing_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    processing_started_at TIMESTAMPTZ,
    processing_completed_at TIMESTAMPTZ,
    processing_error TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_tx_log UNIQUE (transaction_hash, log_index)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_event_registry_hash ON event_processing_registry(event_hash);
CREATE INDEX IF NOT EXISTS idx_event_registry_status ON event_processing_registry(processing_status);
CREATE INDEX IF NOT EXISTS idx_event_registry_block ON event_processing_registry(block_number);

-- Function to compute event hash (deterministic)
CREATE OR REPLACE FUNCTION compute_event_hash(
    p_transaction_hash VARCHAR(66),
    p_log_index INTEGER,
    p_event_name VARCHAR(100),
    p_event_data JSONB
) RETURNS VARCHAR(66) AS $$
BEGIN
    RETURN '0x' || encode(
        digest(
            p_transaction_hash || ':' ||
            p_log_index::TEXT || ':' ||
            p_event_name || ':' ||
            p_event_data::TEXT,
            'sha256'
        ),
        'hex'
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON TABLE event_processing_registry IS 'Idempotency registry for event processing';
COMMENT ON COLUMN event_processing_registry.event_hash IS 'SHA256 hash of (tx_hash:log_index:event_name:event_data)';
COMMENT ON COLUMN event_processing_registry.processing_status IS 'pending, processing, completed, failed';
