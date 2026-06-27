-- ARTSOUL PRODUCTION MONITORING: DASHBOARD VIEWS
-- Objective: Create read-only projections of system health for the Dashboard API

-- 1. SYSTEM HEALTH VIEW
-- Aggregates core metrics from checkpoints and AI activity
CREATE OR REPLACE VIEW system_health AS
SELECT
  (SELECT last_processed_block FROM indexer_checkpoints ORDER BY updated_at DESC LIMIT 1) AS last_indexed_block,
  (SELECT COUNT(*) FROM ai_suggestions WHERE status = 'pending') AS pending_ai,
  (SELECT COUNT(*) FROM failed_ai_jobs WHERE resolved = false) AS dlq_size,
  now() as timestamp;

-- 2. QUEUE HEALTH VIEW
-- Since BullMQ state is in Redis, we create a table that the API can write to
-- for snapshots, and this view simply reads from it.
CREATE TABLE IF NOT EXISTS queue_metrics_snapshot (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    queue_name TEXT,
    waiting INT,
    failed INT,
    completed INT,
    timestamp TIMESTAMPTZ DEFAULT now()
);

CREATE OR REPLACE VIEW queue_health AS
SELECT
    queue_name,
    waiting,
    failed,
    completed,
    timestamp
FROM queue_metrics_snapshot
ORDER BY timestamp DESC
LIMIT 1;

-- 3. AI ACTIVITY STREAM
-- Live feed of AI suggestions and their status
CREATE OR REPLACE VIEW ai_activity_stream AS
SELECT
  id,
  entity_type,
  entity_id,
  status,
  confidence,
  created_at
FROM ai_suggestions
ORDER BY created_at DESC
LIMIT 100;

-- 4. INDEXER LAG TRACKING
CREATE TABLE IF NOT EXISTS indexer_lag (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    last_block INT,
    chain_head INT,
    lag INT,
    created_at TIMESTAMPTZ DEFAULT now()
);
