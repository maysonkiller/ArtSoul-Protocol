-- Event Queue Spillover for Zero Data Loss
-- Persistent queue when memory queue is full

CREATE TABLE IF NOT EXISTS event_queue_spillover (
    id BIGSERIAL PRIMARY KEY,
    event_data JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 5,
    last_attempt_at TIMESTAMPTZ,
    idempotency_key VARCHAR(100) NOT NULL UNIQUE,
    error_message TEXT,

    CONSTRAINT valid_status CHECK (status IN ('pending', 'processing', 'completed', 'dead_letter'))
);

-- Index for worker queries (status + created_at for FIFO)
CREATE INDEX IF NOT EXISTS idx_spillover_status_created
    ON event_queue_spillover(status, created_at)
    WHERE status IN ('pending', 'processing');

-- Index for visibility timeout recovery
CREATE INDEX IF NOT EXISTS idx_spillover_stuck_events
    ON event_queue_spillover(status, last_attempt_at)
    WHERE status = 'processing';

-- Index for idempotency check
CREATE INDEX IF NOT EXISTS idx_spillover_idempotency
    ON event_queue_spillover(idempotency_key);

COMMENT ON TABLE event_queue_spillover IS 'Persistent queue for events when memory queue is full';
COMMENT ON COLUMN event_queue_spillover.idempotency_key IS 'tx_hash-log_index for duplicate prevention';
COMMENT ON COLUMN event_queue_spillover.status IS 'pending → processing → completed | dead_letter';
COMMENT ON COLUMN event_queue_spillover.last_attempt_at IS 'Updated at moment of taking (FOR UPDATE), not after processing';
