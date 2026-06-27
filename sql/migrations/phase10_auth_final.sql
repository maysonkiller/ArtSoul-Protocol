-- ARTSOUL PHASE 10 FINALIZATION: AUTH FOUNDATION
-- Objective: Move from volatile Map-based nonces to persistent, cryptographically sound SIWE.

-- 1. SIWE NONCES TABLE
-- Stores challenges to prevent replay attacks and ensure session integrity.
CREATE TABLE IF NOT EXISTS siwe_nonces (
    nonce TEXT PRIMARY KEY,
    wallet TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. TX STATE MACHINE
-- Tracks the actual lifecycle of a transaction from intent to finality.
CREATE TABLE IF NOT EXISTS tx_states (
    tx_id TEXT PRIMARY KEY,
    wallet TEXT NOT NULL,
    type TEXT NOT NULL, -- 'bid', 'list', 'settle', 'buy'
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'confirmed', 'failed', 'reverted', 'finalized'
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. MINIMAL ADMIN REGISTRY
-- Only allows specific wallets to access system control endpoints.
CREATE TABLE IF NOT EXISTS admin_users (
    wallet_address TEXT PRIMARY KEY,
    role TEXT DEFAULT 'operator', -- 'superadmin', 'moderator', 'operator'
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indices for performance and security
CREATE INDEX IF NOT EXISTS idx_nonces_expiry ON siwe_nonces(expires_at);
CREATE INDEX IF NOT EXISTS idx_tx_states_wallet ON tx_states(wallet);
