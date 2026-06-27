-- ARTSOUL PHASE 12: PRODUCTION CORRECTNESS
-- Objective: Fixing hallucinations, implementing distributed locks and stateful DLQ

-- 1. DLQ STATE MACHINE
-- Move from binary (exists/deleted) to a state machine: pending -> replaying -> resolved -> dead
ALTER TABLE public.failed_ai_jobs
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMPTZ;

CREATE TYPE job_status AS ENUM ('pending', 'replaying', 'resolved', 'dead');
ALTER TABLE public.failed_ai_jobs
ALTER COLUMN status TYPE job_status USING status::job_status;

-- 2. DISTRIBUTED LOCKS (Simple Postgres-based)
CREATE TABLE IF NOT EXISTS system_locks (
    lock_key TEXT PRIMARY KEY,
    locked_at TIMESTAMPTZ DEFAULT now(),
    locked_by TEXT
);

-- 3. RPC FALLBACK CONFIG
CREATE TABLE IF NOT EXISTS rpc_providers (
    provider_url TEXT PRIMARY KEY,
    priority INTEGER DEFAULT 1,
    is_healthy BOOLEAN DEFAULT true,
    last_failure TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Initial RPC setup
INSERT INTO rpc_providers (provider_url, priority)
VALUES (process.env.RPC_URL, 1)
ON CONFLICT (provider_url) DO NOTHING;
