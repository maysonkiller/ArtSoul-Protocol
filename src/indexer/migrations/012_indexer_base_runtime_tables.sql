-- Base indexer runtime tables required by the production sync engine.
-- Safe to run repeatedly. No data is deleted or reset.

CREATE TABLE IF NOT EXISTS indexer_state (
    id INTEGER PRIMARY KEY DEFAULT 1,
    contract_address VARCHAR(42) NOT NULL,
    chain_id NUMERIC(78,0) NOT NULL,
    last_indexed_block BIGINT NOT NULL DEFAULT 0,
    last_confirmed_block BIGINT NOT NULL DEFAULT 0,
    confirmation_depth INTEGER NOT NULL DEFAULT 12,
    total_events_indexed BIGINT NOT NULL DEFAULT 0,
    last_indexed_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(32) NOT NULL DEFAULT 'initialized',
    state_hash VARCHAR(66) NOT NULL DEFAULT '0x0',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT indexer_state_singleton CHECK (id = 1)
);

CREATE INDEX IF NOT EXISTS idx_indexer_state_chain_id
    ON indexer_state(chain_id);

CREATE INDEX IF NOT EXISTS idx_indexer_state_status
    ON indexer_state(status);

CREATE TABLE IF NOT EXISTS contract_events (
    id BIGSERIAL PRIMARY KEY,
    event_name VARCHAR(128) NOT NULL,
    artwork_id NUMERIC(78,0),
    block_number BIGINT NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    log_index INTEGER NOT NULL,
    event_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_events_tx_log
    ON contract_events(transaction_hash, log_index);

CREATE INDEX IF NOT EXISTS idx_contract_events_event_name
    ON contract_events(event_name);

CREATE INDEX IF NOT EXISTS idx_contract_events_artwork_id
    ON contract_events(artwork_id);

CREATE INDEX IF NOT EXISTS idx_contract_events_block_number
    ON contract_events(block_number);

CREATE TABLE IF NOT EXISTS indexer_errors (
    id BIGSERIAL PRIMARY KEY,
    error_type VARCHAR(128) NOT NULL,
    block_number BIGINT,
    transaction_hash VARCHAR(66),
    error_message TEXT NOT NULL,
    error_data JSONB,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_indexer_errors_resolved
    ON indexer_errors(resolved);

CREATE INDEX IF NOT EXISTS idx_indexer_errors_error_type
    ON indexer_errors(error_type);

CREATE INDEX IF NOT EXISTS idx_indexer_errors_block_number
    ON indexer_errors(block_number);

CREATE INDEX IF NOT EXISTS idx_indexer_errors_transaction_hash
    ON indexer_errors(transaction_hash);
