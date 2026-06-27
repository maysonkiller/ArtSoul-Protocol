-- Migration 011: Shared discovery/social signal persistence
-- These signals affect discovery ranking only, never protocol economics.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS artwork_social_signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    artwork_id TEXT NOT NULL,
    wallet_address VARCHAR(42) NOT NULL,
    signal_type VARCHAR(24) NOT NULL,
    chain_id BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT artwork_social_signals_type_check
        CHECK (signal_type IN ('like', 'would_buy', 'watching')),
    CONSTRAINT artwork_social_signals_unique_user_signal
        UNIQUE (artwork_id, wallet_address, signal_type)
);

CREATE INDEX IF NOT EXISTS idx_artwork_social_signals_artwork
    ON artwork_social_signals(artwork_id);

CREATE INDEX IF NOT EXISTS idx_artwork_social_signals_wallet
    ON artwork_social_signals(wallet_address);

CREATE INDEX IF NOT EXISTS idx_artwork_social_signals_type
    ON artwork_social_signals(signal_type);

COMMENT ON TABLE artwork_social_signals IS
    'Shared discovery signals for likes, would-buy, and watching. Used only for ranking/discovery.';
