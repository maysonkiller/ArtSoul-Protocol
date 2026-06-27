-- ARTSOUL PHASE 11: AI WORKER CORE SCHEMA
-- Objective: Add asynchronous intelligence layer and transaction state tracking

-- 1. AI SUGGESTIONS TABLE
-- AI never writes to core state, only proposes changes here.
CREATE TABLE IF NOT EXISTS ai_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL, -- 'auction', 'nft', 'bid'
    entity_id TEXT NOT NULL,
    suggestion JSONB NOT NULL,
    status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    confidence FLOAT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. TRANSACTION STATE MACHINE
-- Tracks the lifecycle of a user intent before it is confirmed on-chain.
CREATE TABLE IF NOT EXISTS tx_states (
    tx_id TEXT PRIMARY KEY,
    wallet TEXT NOT NULL,
    type TEXT NOT NULL, -- 'bid', 'list', 'settle'
    status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'CONFIRMED', 'FAILED'
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. SYSTEM CONTROL FLAGS
-- Minimal control plane for admins to pause/resume components.
CREATE TABLE IF NOT EXISTS system_flags (
    flag_key TEXT PRIMARY KEY,
    flag_value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Initial flags
INSERT INTO system_flags (flag_key, flag_value) VALUES
('indexer_paused', 'false'),
('ai_workers_paused', 'false');

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_entity ON ai_suggestions(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_tx_states_wallet ON tx_states(wallet);
