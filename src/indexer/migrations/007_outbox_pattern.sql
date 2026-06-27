-- Outbox Pattern for Side Effects Isolation
-- Ensures external API calls happen only after successful transaction commit

CREATE TABLE IF NOT EXISTS outbox_events (
    id BIGSERIAL PRIMARY KEY,

    -- Event identification
    aggregate_type VARCHAR(50) NOT NULL,  -- 'auction', 'bid', 'artwork', etc.
    aggregate_id VARCHAR(100) NOT NULL,   -- artworkId, userId, etc.
    event_type VARCHAR(50) NOT NULL,      -- 'notification', 'webhook', 'api_call', etc.

    -- Payload
    payload JSONB NOT NULL,               -- Full data needed for side effect

    -- Metadata
    correlation_id VARCHAR(100),          -- Link to event_processing_registry
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Processing state
    processing_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- 'pending' -> 'processing' -> 'completed' | 'failed' | 'dead'

    processed_at TIMESTAMPTZ,
    processing_attempts INT NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,

    -- Error tracking
    last_error TEXT,

    -- Idempotency
    idempotency_key VARCHAR(100) UNIQUE,

    -- Indexes for efficient polling
    CONSTRAINT outbox_events_status_check CHECK (
        processing_status IN ('pending', 'processing', 'completed', 'failed', 'dead')
    )
);

-- Index for polling pending events
CREATE INDEX IF NOT EXISTS idx_outbox_pending
    ON outbox_events(created_at)
    WHERE processing_status = 'pending';

-- Index for monitoring failed events
CREATE INDEX IF NOT EXISTS idx_outbox_failed
    ON outbox_events(last_attempt_at)
    WHERE processing_status = 'failed';

-- Index for correlation tracking
CREATE INDEX IF NOT EXISTS idx_outbox_correlation
    ON outbox_events(correlation_id);

-- Index for aggregate lookup
CREATE INDEX IF NOT EXISTS idx_outbox_aggregate
    ON outbox_events(aggregate_type, aggregate_id);

COMMENT ON TABLE outbox_events IS 'Transactional outbox for side effects isolation';
COMMENT ON COLUMN outbox_events.aggregate_type IS 'Type of entity (auction, bid, artwork)';
COMMENT ON COLUMN outbox_events.event_type IS 'Type of side effect (notification, webhook, api_call)';
COMMENT ON COLUMN outbox_events.payload IS 'Full data needed to execute side effect';
COMMENT ON COLUMN outbox_events.idempotency_key IS 'Prevents duplicate side effects';
