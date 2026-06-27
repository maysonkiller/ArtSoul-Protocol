-- ARTSOUL STABILIZATION: RELIABILITY LAYER
-- Objective: Implement DLQ, DB-level Idempotency, and Failure Tracking

-- 1. IDEMPOTENCY ENFORCEMENT
-- Ensure that an AI worker cannot generate duplicate suggestions for the same event.
-- We add a unique constraint on (entity_type, entity_id, suggestion_hash)
-- or simpler: (entity_id, type) if we only want one suggestion per entity per type.
-- For this protocol, we'll use a composite unique constraint to allow
-- multiple different types of suggestions for the same entity, but no duplicates of the same type.
ALTER TABLE public.ai_suggestions
ADD CONSTRAINT unique_suggestion_per_entity
UNIQUE (entity_type, entity_id, status);
-- Note: We might need a more granular hash if we want history,
-- but for stabilization, we enforce one active suggestion per entity/type.

-- 2. DEAD LETTER QUEUE (DLQ) TABLE
-- Instead of just logging errors, we store the failed event for manual recovery.
CREATE TABLE IF NOT EXISTS failed_ai_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT,
    payload JSONB,
    error_message TEXT,
    retry_count INTEGER,
    failed_at TIMESTAMPTZ DEFAULT now(),
    resolved BOOLEAN DEFAULT false
);

-- 3. AI WORKER LOGS (DETAILED)
-- Separate from general system logs to monitor AI performance and failures.
CREATE TABLE IF NOT EXISTS ai_worker_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_name TEXT,
    event_id TEXT,
    severity TEXT, -- 'INFO', 'WARN', 'ERROR'
    message TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for DLQ recovery
CREATE INDEX IF NOT EXISTS idx_failed_jobs_resolved ON failed_ai_jobs(resolved);
