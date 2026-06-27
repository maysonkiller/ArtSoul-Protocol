-- Distributed locks table for multi-instance coordination
CREATE TABLE IF NOT EXISTS distributed_locks (
    id SERIAL PRIMARY KEY,
    lock_name VARCHAR(100) NOT NULL UNIQUE,
    instance_id VARCHAR(100) NOT NULL,
    fencing_token BIGINT NOT NULL DEFAULT 1,
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_heartbeat TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lock lookups
CREATE INDEX IF NOT EXISTS idx_distributed_locks_name ON distributed_locks(lock_name);
CREATE INDEX IF NOT EXISTS idx_distributed_locks_expires ON distributed_locks(expires_at);
CREATE INDEX IF NOT EXISTS idx_distributed_locks_token ON distributed_locks(fencing_token);

-- Cleanup function for expired locks (optional, can be called periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_locks()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM distributed_locks
    WHERE expires_at < NOW();

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE distributed_locks IS 'Distributed locks for multi-instance coordination with fencing tokens';
COMMENT ON COLUMN distributed_locks.lock_name IS 'Unique name of the lock (e.g., indexer_leader)';
COMMENT ON COLUMN distributed_locks.instance_id IS 'ID of the instance holding the lock';
COMMENT ON COLUMN distributed_locks.fencing_token IS 'Monotonically increasing token to prevent split-brain (CRITICAL)';
COMMENT ON COLUMN distributed_locks.expires_at IS 'When the lock expires (TTL)';
COMMENT ON COLUMN distributed_locks.last_heartbeat IS 'Last heartbeat timestamp';

