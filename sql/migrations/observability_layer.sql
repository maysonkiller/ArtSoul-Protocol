-- ARTSOUL OBSERVABILITY LAYER
-- Objective: Implement Global Trace ID and System Monitoring

-- 1. GLOBAL SYSTEM LOGS
CREATE TABLE IF NOT EXISTS system_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id TEXT,
    layer TEXT, -- 'indexer' | 'queue' | 'worker' | 'api'
    level TEXT, -- 'info' | 'warn' | 'error'
    message TEXT,
    meta JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. QUEUE METRICS
CREATE TABLE IF NOT EXISTS queue_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    queue_name TEXT,
    depth INT,
    failed INT,
    processed INT,
    timestamp TIMESTAMPTZ DEFAULT now()
);

-- 3. INDEXER LAG MONITORING
CREATE TABLE IF NOT EXISTS indexer_lag (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    last_block INT,
    chain_head INT,
    lag INT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. DLQ ENHANCEMENT
ALTER TABLE public.failed_ai_jobs
ADD COLUMN IF NOT EXISTS trace_id TEXT,
ADD COLUMN IF NOT EXISTS retry_reason TEXT;

-- Indices for traceability
CREATE INDEX IF NOT EXISTS idx_system_logs_trace ON system_logs(trace_id);
CREATE INDEX IF NOT EXISTS idx_failed_jobs_trace ON failed_ai_jobs(trace_id);
