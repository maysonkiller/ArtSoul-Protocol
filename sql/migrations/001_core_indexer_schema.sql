-- 001: CORE INDEXER SCHEMA
-- Primary tables for blockchain state tracking and event indexing.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Indexer State Table (Checkpoint System)
CREATE TABLE IF NOT EXISTS indexer_state (
    id INTEGER PRIMARY KEY DEFAULT 1,
    contract_address VARCHAR(42) NOT NULL,
    chain_id INTEGER NOT NULL,
    last_indexed_block BIGINT NOT NULL,
    last_confirmed_block BIGINT NOT NULL,
    confirmation_depth INTEGER DEFAULT 12,
    last_indexed_at TIMESTAMPTZ NOT NULL,
    total_events_indexed BIGINT DEFAULT 0,
    status VARCHAR(50) DEFAULT 'running',
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL,
    version VARCHAR(20) DEFAULT '2.0',

    CONSTRAINT single_row CHECK (id = 1)
);

CREATE INDEX idx_indexer_state_status ON indexer_state(status);
CREATE INDEX idx_indexer_state_last_indexed_block ON indexer_state(last_indexed_block);

-- Indexed Auctions Table
CREATE TABLE IF NOT EXISTS indexed_auctions (
    artwork_id VARCHAR(255) PRIMARY KEY,
    seller VARCHAR(42) NOT NULL,
    starting_price NUMERIC(78, 0) NOT NULL,
    start_time BIGINT NOT NULL,
    end_time BIGINT NOT NULL,
    winner_deadline BIGINT,
    ended BOOLEAN DEFAULT FALSE,
    winner_purchased BOOLEAN DEFAULT FALSE,
    highest_bidder VARCHAR(42),
    highest_bid NUMERIC(78, 0) DEFAULT 0,

    -- Indexer metadata
    block_number BIGINT NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_updated_block BIGINT NOT NULL,
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed BOOLEAN DEFAULT FALSE,

    CONSTRAINT valid_addresses CHECK (
        seller ~ '^0x[a-fA-F0-9]{40}$' AND
        (highest_bidder IS NULL OR highest_bidder ~ '^0x[a-fA-F0-9]{40}$')
    ),
    CONSTRAINT valid_times CHECK (end_time > start_time),
    CONSTRAINT valid_prices CHECK (starting_price >= 0 AND highest_bid >= 0)
);

CREATE INDEX idx_auctions_seller ON indexed_auctions(seller);
CREATE INDEX idx_auctions_ended ON indexed_auctions(ended) WHERE NOT ended;
CREATE INDEX idx_auctions_end_time ON indexed_auctions(end_time) WHERE NOT ended;
CREATE INDEX idx_auctions_block_number ON indexed_auctions(block_number);
CREATE INDEX idx_auctions_highest_bidder ON indexed_auctions(highest_bidder) WHERE highest_bidder IS NOT NULL;
CREATE INDEX idx_auctions_confirmed ON indexed_auctions(confirmed) WHERE NOT confirmed;

-- Indexed Bids Table
CREATE TABLE IF NOT EXISTS indexed_bids (
    id BIGSERIAL PRIMARY KEY,
    artwork_id VARCHAR(255) NOT NULL,
    bidder VARCHAR(42) NOT NULL,
    amount NUMERIC(78, 0) NOT NULL,
    timestamp BIGINT NOT NULL,

    -- Indexer metadata
    block_number BIGINT NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    log_index INTEGER NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed BOOLEAN DEFAULT FALSE,

    CONSTRAINT unique_bid UNIQUE (transaction_hash, log_index),
    CONSTRAINT valid_bidder CHECK (bidder ~ '^0x[a-fA-F0-9]{40}$'),
    CONSTRAINT valid_amount CHECK (amount > 0),

    FOREIGN KEY (artwork_id) REFERENCES indexed_auctions(artwork_id) ON DELETE CASCADE
);

CREATE INDEX idx_bids_artwork_id ON indexed_bids(artwork_id);
CREATE INDEX idx_bids_bidder ON indexed_bids(bidder);
CREATE INDEX idx_bids_timestamp ON indexed_bids(timestamp DESC);
CREATE INDEX idx_bids_block_number ON indexed_bids(block_number);
CREATE INDEX idx_bids_confirmed ON indexed_bids(confirmed) WHERE NOT confirmed;

-- Contract Events Table (Event Sourcing)
CREATE TABLE IF NOT EXISTS contract_events (
    id BIGSERIAL PRIMARY KEY,
    event_name VARCHAR(100) NOT NULL,
    artwork_id VARCHAR(255),
    block_number BIGINT NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    log_index INTEGER NOT NULL,
    event_data JSONB NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed BOOLEAN DEFAULT FALSE,

    CONSTRAINT unique_event UNIQUE (transaction_hash, log_index)
);

CREATE INDEX idx_events_event_name ON contract_events(event_name);
CREATE INDEX idx_events_artwork_id ON contract_events(artwork_id) WHERE artwork_id IS NOT NULL;
CREATE INDEX idx_events_block_number ON contract_events(block_number);
CREATE INDEX idx_events_indexed_at ON contract_events(indexed_at DESC);
CREATE INDEX idx_events_confirmed ON contract_events(confirmed) WHERE NOT confirmed;
CREATE INDEX idx_events_data ON contract_events USING GIN (event_data);

-- Block Confirmations Table (Track block finality)
CREATE TABLE IF NOT EXISTS block_confirmations (
    block_number BIGINT PRIMARY KEY,
    block_hash VARCHAR(66) NOT NULL,
    confirmed_at_block BIGINT NOT NULL,
    confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_confirmation CHECK (confirmed_at_block >= block_number)
);

CREATE INDEX idx_confirmations_confirmed_at ON block_confirmations(confirmed_at DESC);

-- Initial indexer state
INSERT INTO indexer_state (
    id, contract_address, chain_id, last_indexed_block, last_confirmed_block,
    last_indexed_at, started_at
) VALUES (
    1, '0x0000000000000000000000000000000000000000', 0, 0, 0, NOW(), NOW()
) ON CONFLICT (id) DO NOTHING;
