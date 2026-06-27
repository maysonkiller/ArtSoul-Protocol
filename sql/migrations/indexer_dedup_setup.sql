-- PHASE 8.6: INDEXER RELIABILITY & EVENT DEDUP ENGINE
-- Target: Ensuring idempotent event processing and crash recovery.

-- 1. Track processed events to prevent duplicates
CREATE TABLE IF NOT EXISTS processed_events (
    event_key TEXT PRIMARY KEY,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 2. Update secondary_sales to include blockchain transaction identity
-- Note: We add tx_hash and log_index to uniquely identify each event
ALTER TABLE public.secondary_sales
ADD COLUMN IF NOT EXISTS tx_hash TEXT,
ADD COLUMN IF NOT EXISTS log_index INTEGER;

-- 3. Unique constraint on transfers to prevent double-counting sales
ALTER TABLE public.secondary_sales
ADD CONSTRAINT unique_transfer UNIQUE (tx_hash, log_index);

-- 4. Checkpoint table for block tracking
CREATE TABLE IF NOT EXISTS indexer_checkpoints (
    contract_address TEXT PRIMARY KEY,
    last_processed_block BIGINT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Grant access to service role for the indexer
GRANT ALL ON TABLE public.processed_events TO service_role;
GRANT ALL ON TABLE public.indexer_checkpoints TO service_role;
