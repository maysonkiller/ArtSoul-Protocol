-- Migration 010: Canonical V4.1 event lifecycle projections
-- Contracts/events remain the source of truth. These tables are indexer projections.

CREATE TABLE IF NOT EXISTS v41_artworks (
    artwork_id NUMERIC(78,0) PRIMARY KEY,
    creator VARCHAR(42) NOT NULL,
    metadata_uri TEXT NOT NULL,
    minted BOOLEAN NOT NULL DEFAULT FALSE,
    token_id NUMERIC(78,0),
    canonical_floor NUMERIC(78,0) NOT NULL DEFAULT 0,
    active_auction_id NUMERIC(78,0),
    block_number BIGINT NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    log_index INTEGER NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_updated_block BIGINT NOT NULL,
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS v41_auctions (
    auction_id NUMERIC(78,0) PRIMARY KEY,
    artwork_id NUMERIC(78,0) NOT NULL,
    creator VARCHAR(42) NOT NULL,
    start_price NUMERIC(78,0) NOT NULL,
    duration NUMERIC(78,0) NOT NULL,
    original_end_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    total_extension_seconds BIGINT NOT NULL DEFAULT 0,
    chain_id NUMERIC(78,0) NOT NULL,
    status VARCHAR(32) NOT NULL,
    current_bid NUMERIC(78,0) NOT NULL DEFAULT 0,
    current_bidder VARCHAR(42),
    winner VARCHAR(42),
    winning_bid NUMERIC(78,0),
    settlement_deadline TIMESTAMPTZ,
    final_price NUMERIC(78,0),
    token_id NUMERIC(78,0),
    default_artist_amount NUMERIC(78,0),
    default_platform_amount NUMERIC(78,0),
    block_number BIGINT NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    log_index INTEGER NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_updated_block BIGINT NOT NULL,
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS v41_bids (
    id BIGSERIAL PRIMARY KEY,
    auction_id NUMERIC(78,0) NOT NULL,
    artwork_id NUMERIC(78,0),
    bidder VARCHAR(42) NOT NULL,
    bid_amount NUMERIC(78,0) NOT NULL,
    deposit_amount NUMERIC(78,0) NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    log_index INTEGER NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT v41_bids_unique_log UNIQUE (transaction_hash, log_index)
);

CREATE TABLE IF NOT EXISTS v41_bid_withdrawals (
    id BIGSERIAL PRIMARY KEY,
    auction_id NUMERIC(78,0) NOT NULL,
    bidder VARCHAR(42) NOT NULL,
    amount NUMERIC(78,0) NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    log_index INTEGER NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT v41_bid_withdrawals_unique_log UNIQUE (transaction_hash, log_index)
);

CREATE TABLE IF NOT EXISTS v41_auction_extensions (
    id BIGSERIAL PRIMARY KEY,
    auction_id NUMERIC(78,0) NOT NULL,
    old_end_time TIMESTAMPTZ NOT NULL,
    new_end_time TIMESTAMPTZ NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    log_index INTEGER NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT v41_auction_extensions_unique_log UNIQUE (transaction_hash, log_index)
);

CREATE TABLE IF NOT EXISTS v41_auction_endings (
    id BIGSERIAL PRIMARY KEY,
    auction_id NUMERIC(78,0) NOT NULL,
    winner VARCHAR(42),
    winning_bid NUMERIC(78,0) NOT NULL DEFAULT 0,
    settlement_deadline TIMESTAMPTZ,
    block_number BIGINT NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    log_index INTEGER NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT v41_auction_endings_unique_log UNIQUE (transaction_hash, log_index)
);

CREATE TABLE IF NOT EXISTS v41_settlements (
    auction_id NUMERIC(78,0) PRIMARY KEY,
    artwork_id NUMERIC(78,0),
    winner VARCHAR(42),
    final_price NUMERIC(78,0),
    token_id NUMERIC(78,0),
    artist_amount NUMERIC(78,0),
    platform_amount NUMERIC(78,0),
    settlement_status VARCHAR(24) NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    log_index INTEGER NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS v41_floor_history (
    id BIGSERIAL PRIMARY KEY,
    artwork_id NUMERIC(78,0) NOT NULL,
    token_id NUMERIC(78,0) NOT NULL,
    floor_price NUMERIC(78,0) NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    log_index INTEGER NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT v41_floor_history_unique_log UNIQUE (transaction_hash, log_index)
);

CREATE TABLE IF NOT EXISTS v41_resale_listings (
    token_id NUMERIC(78,0) PRIMARY KEY,
    seller VARCHAR(42) NOT NULL,
    price NUMERIC(78,0) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    block_number BIGINT NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    log_index INTEGER NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_updated_block BIGINT NOT NULL,
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS v41_resale_history (
    id BIGSERIAL PRIMARY KEY,
    token_id NUMERIC(78,0) NOT NULL,
    seller VARCHAR(42) NOT NULL,
    buyer VARCHAR(42) NOT NULL,
    price NUMERIC(78,0) NOT NULL,
    royalty_amount NUMERIC(78,0) NOT NULL,
    platform_fee NUMERIC(78,0) NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    log_index INTEGER NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT v41_resale_history_unique_log UNIQUE (transaction_hash, log_index)
);

CREATE TABLE IF NOT EXISTS v41_project_eligibility (
    user_address VARCHAR(42) PRIMARY KEY,
    eligibility_hash VARCHAR(66) NOT NULL,
    achieved BOOLEAN NOT NULL DEFAULT TRUE,
    block_number BIGINT NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    log_index INTEGER NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS v41_genesis_holders (
    user_address VARCHAR(42) PRIMARY KEY,
    token_id NUMERIC(78,0) NOT NULL UNIQUE,
    eligibility_hash VARCHAR(66) NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    log_index INTEGER NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS v41_trust_signals (
    user_address VARCHAR(42) PRIMARY KEY,
    successful_settlements BIGINT NOT NULL DEFAULT 0,
    failed_settlements BIGINT NOT NULL DEFAULT 0,
    suspicious_flags BIGINT NOT NULL DEFAULT 0,
    last_updated_block BIGINT,
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_v41_artworks_creator ON v41_artworks(creator);
CREATE INDEX IF NOT EXISTS idx_v41_artworks_token ON v41_artworks(token_id);
CREATE INDEX IF NOT EXISTS idx_v41_auctions_artwork ON v41_auctions(artwork_id);
CREATE INDEX IF NOT EXISTS idx_v41_auctions_status ON v41_auctions(status);
CREATE INDEX IF NOT EXISTS idx_v41_auctions_end_time ON v41_auctions(end_time);
CREATE INDEX IF NOT EXISTS idx_v41_bids_auction ON v41_bids(auction_id);
CREATE INDEX IF NOT EXISTS idx_v41_bids_bidder ON v41_bids(bidder);
CREATE INDEX IF NOT EXISTS idx_v41_settlements_status ON v41_settlements(settlement_status);
CREATE INDEX IF NOT EXISTS idx_v41_resale_listings_active ON v41_resale_listings(active);

CREATE OR REPLACE VIEW v41_project_eligibility_signals AS
WITH users AS (
    SELECT creator AS user_address FROM v41_artworks
    UNION
    SELECT bidder AS user_address FROM v41_bids
    UNION
    SELECT winner AS user_address FROM v41_settlements WHERE settlement_status = 'completed'
)
SELECT
    users.user_address,
    FALSE AS profile_created_external,
    COALESCE(artwork_counts.artwork_upload_count, 0) AS artwork_upload_count,
    COALESCE(bid_counts.auction_participation_count, 0) AS auction_participation_count,
    COALESCE(settlement_counts.successful_settlement_count, 0) AS successful_settlement_count,
    0 AS artwork_interaction_count_external,
    eligibility.eligibility_hash,
    eligibility.achieved AS onchain_eligibility_recorded,
    holder.token_id AS genesis_token_id
FROM users
LEFT JOIN (
    SELECT creator AS user_address, COUNT(*) AS artwork_upload_count
    FROM v41_artworks
    GROUP BY creator
) artwork_counts USING (user_address)
LEFT JOIN (
    SELECT bidder AS user_address, COUNT(DISTINCT auction_id) AS auction_participation_count
    FROM v41_bids
    GROUP BY bidder
) bid_counts USING (user_address)
LEFT JOIN (
    SELECT winner AS user_address, COUNT(*) AS successful_settlement_count
    FROM v41_settlements
    WHERE settlement_status = 'completed'
    GROUP BY winner
) settlement_counts USING (user_address)
LEFT JOIN v41_project_eligibility eligibility USING (user_address)
LEFT JOIN v41_genesis_holders holder USING (user_address);

DROP FUNCTION IF EXISTS rollback_events_from_block(BIGINT);

CREATE OR REPLACE FUNCTION rollback_events_from_block(reorg_block BIGINT)
RETURNS TABLE(
    events_deleted BIGINT,
    auctions_deleted BIGINT,
    bids_deleted BIGINT,
    outbox_deleted BIGINT
) AS $$
DECLARE
    v_events_deleted BIGINT := 0;
    v_auctions_deleted BIGINT := 0;
    v_bids_deleted BIGINT := 0;
    v_outbox_deleted BIGINT := 0;
    v_rows BIGINT := 0;
BEGIN
    DELETE FROM event_processing_registry
    WHERE block_number >= reorg_block;
    GET DIAGNOSTICS v_events_deleted = ROW_COUNT;

    DELETE FROM v41_genesis_holders WHERE block_number >= reorg_block;
    DELETE FROM v41_project_eligibility WHERE block_number >= reorg_block;
    DELETE FROM v41_resale_history WHERE block_number >= reorg_block;
    DELETE FROM v41_resale_listings WHERE block_number >= reorg_block;
    DELETE FROM v41_floor_history WHERE block_number >= reorg_block;
    DELETE FROM v41_settlements WHERE block_number >= reorg_block;
    DELETE FROM v41_auction_endings WHERE block_number >= reorg_block;
    DELETE FROM v41_auction_extensions WHERE block_number >= reorg_block;
    DELETE FROM v41_bid_withdrawals WHERE block_number >= reorg_block;

    DELETE FROM v41_bids WHERE block_number >= reorg_block;
    GET DIAGNOSTICS v_bids_deleted = ROW_COUNT;

    DELETE FROM v41_auctions WHERE block_number >= reorg_block;
    GET DIAGNOSTICS v_auctions_deleted = ROW_COUNT;

    DELETE FROM v41_artworks WHERE block_number >= reorg_block;

    DELETE FROM indexed_auctions WHERE block_number >= reorg_block;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_auctions_deleted := v_auctions_deleted + v_rows;

    DELETE FROM indexed_bids WHERE block_number >= reorg_block;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_bids_deleted := v_bids_deleted + v_rows;

    DELETE FROM outbox_events
    WHERE correlation_id IN (
        SELECT transaction_hash || '-' || log_index
        FROM contract_events
        WHERE block_number >= reorg_block
    );
    GET DIAGNOSTICS v_outbox_deleted = ROW_COUNT;

    DELETE FROM contract_events
    WHERE block_number >= reorg_block;

    RETURN QUERY SELECT v_events_deleted, v_auctions_deleted, v_bids_deleted, v_outbox_deleted;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE v41_artworks IS 'V4.1 artwork registration and mutable projection derived from canonical events';
COMMENT ON TABLE v41_auctions IS 'V4.1 auction lifecycle projection keyed by auctionId';
COMMENT ON TABLE v41_settlements IS 'V4.1 settlement success/default records; floor only exists after completed settlement';
COMMENT ON TABLE v41_trust_signals IS 'Off-chain trust counters for weighting, never automatic bans';
COMMENT ON VIEW v41_project_eligibility_signals IS 'Derived on-chain Genesis eligibility signals; profile and artwork interactions remain external inputs';
