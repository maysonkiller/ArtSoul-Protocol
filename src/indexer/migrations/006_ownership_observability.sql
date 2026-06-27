-- Migration 006: Add owner_worker_id for proper ownership tracking
-- This fixes observability and allows proper "who owns the lock" detection

-- Add owner_worker_id column
ALTER TABLE event_processing_registry
ADD COLUMN IF NOT EXISTS owner_worker_id VARCHAR(50);

-- Add index for fast owner lookups
CREATE INDEX IF NOT EXISTS idx_event_registry_owner ON event_processing_registry(owner_worker_id);

-- Add last_heartbeat_at for proper stuck detection (not just TTL)
ALTER TABLE event_processing_registry
ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;

-- Add correlation_id for tracing
ALTER TABLE event_processing_registry
ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(100);

COMMENT ON COLUMN event_processing_registry.owner_worker_id IS 'Worker ID that owns this event processing';
COMMENT ON COLUMN event_processing_registry.last_heartbeat_at IS 'Last heartbeat from owner worker (for stuck detection)';
COMMENT ON COLUMN event_processing_registry.correlation_id IS 'Correlation ID for distributed tracing';
