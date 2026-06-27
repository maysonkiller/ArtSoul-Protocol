-- Migration 013: chain-scoped V4.1 projections and indexer runtime state.
-- Data-preserving migration. No tables are dropped, truncated, or reset.
-- Existing rows are treated as Base Sepolia because that was the only indexed
-- chain before this migration.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'indexer_state' AND column_name = 'chain_id'
    ) THEN
        ALTER TABLE indexer_state ADD COLUMN chain_id NUMERIC(78,0);
    END IF;
END $$;

UPDATE indexer_state SET chain_id = 84532 WHERE chain_id IS NULL;
ALTER TABLE indexer_state ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE indexer_state DROP CONSTRAINT IF EXISTS indexer_state_singleton;
ALTER TABLE indexer_state DROP CONSTRAINT IF EXISTS indexer_state_pkey;
ALTER TABLE indexer_state ADD CONSTRAINT indexer_state_pkey PRIMARY KEY (chain_id);
CREATE INDEX IF NOT EXISTS idx_indexer_state_status_chain
    ON indexer_state(chain_id, status);

ALTER TABLE event_processing_registry ADD COLUMN IF NOT EXISTS chain_id NUMERIC(78,0);
UPDATE event_processing_registry SET chain_id = 84532 WHERE chain_id IS NULL;
ALTER TABLE event_processing_registry ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE event_processing_registry DROP CONSTRAINT IF EXISTS unique_tx_log;
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_registry_chain_tx_log
    ON event_processing_registry(chain_id, transaction_hash, log_index);
CREATE INDEX IF NOT EXISTS idx_event_registry_chain_status
    ON event_processing_registry(chain_id, processing_status);
CREATE INDEX IF NOT EXISTS idx_event_registry_chain_block
    ON event_processing_registry(chain_id, block_number);

CREATE OR REPLACE FUNCTION compute_event_hash(
    p_chain_id NUMERIC,
    p_transaction_hash VARCHAR(66),
    p_log_index INTEGER,
    p_event_name VARCHAR(100),
    p_event_data JSONB
) RETURNS VARCHAR(66) AS $$
BEGIN
    RETURN '0x' || encode(
        digest(
            p_chain_id::TEXT || ':' ||
            p_transaction_hash || ':' ||
            p_log_index::TEXT || ':' ||
            p_event_name || ':' ||
            p_event_data::TEXT,
            'sha256'
        ),
        'hex'
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION compute_event_hash(
    p_transaction_hash VARCHAR(66),
    p_log_index INTEGER,
    p_event_name VARCHAR(100),
    p_event_data JSONB
) RETURNS VARCHAR(66) AS $$
BEGIN
    RETURN compute_event_hash(84532, p_transaction_hash, p_log_index, p_event_name, p_event_data);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

ALTER TABLE block_hashes ADD COLUMN IF NOT EXISTS chain_id NUMERIC(78,0);
UPDATE block_hashes SET chain_id = 84532 WHERE chain_id IS NULL;
ALTER TABLE block_hashes ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE block_hashes DROP CONSTRAINT IF EXISTS block_hashes_pkey;
ALTER TABLE block_hashes ADD CONSTRAINT block_hashes_pkey PRIMARY KEY (chain_id, block_number);
CREATE INDEX IF NOT EXISTS idx_block_hashes_chain_parent
    ON block_hashes(chain_id, parent_hash);

ALTER TABLE contract_events ADD COLUMN IF NOT EXISTS chain_id NUMERIC(78,0);
UPDATE contract_events SET chain_id = 84532 WHERE chain_id IS NULL;
ALTER TABLE contract_events ALTER COLUMN chain_id SET NOT NULL;
DROP INDEX IF EXISTS idx_contract_events_tx_log;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_events_chain_tx_log
    ON contract_events(chain_id, transaction_hash, log_index);
CREATE INDEX IF NOT EXISTS idx_contract_events_chain_event
    ON contract_events(chain_id, event_name);
CREATE INDEX IF NOT EXISTS idx_contract_events_chain_block
    ON contract_events(chain_id, block_number);

ALTER TABLE indexer_errors ADD COLUMN IF NOT EXISTS chain_id NUMERIC(78,0);
UPDATE indexer_errors SET chain_id = 84532 WHERE chain_id IS NULL;
ALTER TABLE indexer_errors ALTER COLUMN chain_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_indexer_errors_chain_resolved
    ON indexer_errors(chain_id, resolved);

ALTER TABLE v41_artworks ADD COLUMN IF NOT EXISTS chain_id NUMERIC(78,0);
UPDATE v41_artworks SET chain_id = 84532 WHERE chain_id IS NULL;
ALTER TABLE v41_artworks ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE v41_artworks DROP CONSTRAINT IF EXISTS v41_artworks_pkey;
ALTER TABLE v41_artworks ADD CONSTRAINT v41_artworks_pkey PRIMARY KEY (chain_id, artwork_id);
CREATE INDEX IF NOT EXISTS idx_v41_artworks_chain_creator
    ON v41_artworks(chain_id, creator);
CREATE INDEX IF NOT EXISTS idx_v41_artworks_chain_token
    ON v41_artworks(chain_id, token_id);

ALTER TABLE v41_auctions ADD COLUMN IF NOT EXISTS chain_id NUMERIC(78,0);
UPDATE v41_auctions SET chain_id = 84532 WHERE chain_id IS NULL;
ALTER TABLE v41_auctions ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE v41_auctions DROP CONSTRAINT IF EXISTS v41_auctions_pkey;
ALTER TABLE v41_auctions ADD CONSTRAINT v41_auctions_pkey PRIMARY KEY (chain_id, auction_id);
CREATE INDEX IF NOT EXISTS idx_v41_auctions_chain_artwork
    ON v41_auctions(chain_id, artwork_id);
CREATE INDEX IF NOT EXISTS idx_v41_auctions_chain_status
    ON v41_auctions(chain_id, status);
CREATE INDEX IF NOT EXISTS idx_v41_auctions_chain_end_time
    ON v41_auctions(chain_id, end_time);

ALTER TABLE v41_bids ADD COLUMN IF NOT EXISTS chain_id NUMERIC(78,0);
UPDATE v41_bids SET chain_id = 84532 WHERE chain_id IS NULL;
ALTER TABLE v41_bids ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE v41_bids DROP CONSTRAINT IF EXISTS v41_bids_unique_log;
CREATE UNIQUE INDEX IF NOT EXISTS idx_v41_bids_chain_tx_log
    ON v41_bids(chain_id, transaction_hash, log_index);
CREATE INDEX IF NOT EXISTS idx_v41_bids_chain_auction
    ON v41_bids(chain_id, auction_id);
CREATE INDEX IF NOT EXISTS idx_v41_bids_chain_bidder
    ON v41_bids(chain_id, bidder);

ALTER TABLE v41_bid_withdrawals ADD COLUMN IF NOT EXISTS chain_id NUMERIC(78,0);
UPDATE v41_bid_withdrawals SET chain_id = 84532 WHERE chain_id IS NULL;
ALTER TABLE v41_bid_withdrawals ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE v41_bid_withdrawals DROP CONSTRAINT IF EXISTS v41_bid_withdrawals_unique_log;
CREATE UNIQUE INDEX IF NOT EXISTS idx_v41_bid_withdrawals_chain_tx_log
    ON v41_bid_withdrawals(chain_id, transaction_hash, log_index);

ALTER TABLE v41_auction_extensions ADD COLUMN IF NOT EXISTS chain_id NUMERIC(78,0);
UPDATE v41_auction_extensions SET chain_id = 84532 WHERE chain_id IS NULL;
ALTER TABLE v41_auction_extensions ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE v41_auction_extensions DROP CONSTRAINT IF EXISTS v41_auction_extensions_unique_log;
CREATE UNIQUE INDEX IF NOT EXISTS idx_v41_auction_extensions_chain_tx_log
    ON v41_auction_extensions(chain_id, transaction_hash, log_index);

ALTER TABLE v41_auction_endings ADD COLUMN IF NOT EXISTS chain_id NUMERIC(78,0);
UPDATE v41_auction_endings SET chain_id = 84532 WHERE chain_id IS NULL;
ALTER TABLE v41_auction_endings ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE v41_auction_endings DROP CONSTRAINT IF EXISTS v41_auction_endings_unique_log;
CREATE UNIQUE INDEX IF NOT EXISTS idx_v41_auction_endings_chain_tx_log
    ON v41_auction_endings(chain_id, transaction_hash, log_index);

ALTER TABLE v41_settlements ADD COLUMN IF NOT EXISTS chain_id NUMERIC(78,0);
UPDATE v41_settlements SET chain_id = 84532 WHERE chain_id IS NULL;
ALTER TABLE v41_settlements ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE v41_settlements DROP CONSTRAINT IF EXISTS v41_settlements_pkey;
ALTER TABLE v41_settlements ADD CONSTRAINT v41_settlements_pkey PRIMARY KEY (chain_id, auction_id);
CREATE INDEX IF NOT EXISTS idx_v41_settlements_chain_status
    ON v41_settlements(chain_id, settlement_status);

ALTER TABLE v41_floor_history ADD COLUMN IF NOT EXISTS chain_id NUMERIC(78,0);
UPDATE v41_floor_history SET chain_id = 84532 WHERE chain_id IS NULL;
ALTER TABLE v41_floor_history ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE v41_floor_history DROP CONSTRAINT IF EXISTS v41_floor_history_unique_log;
CREATE UNIQUE INDEX IF NOT EXISTS idx_v41_floor_history_chain_tx_log
    ON v41_floor_history(chain_id, transaction_hash, log_index);

ALTER TABLE v41_resale_listings ADD COLUMN IF NOT EXISTS chain_id NUMERIC(78,0);
UPDATE v41_resale_listings SET chain_id = 84532 WHERE chain_id IS NULL;
ALTER TABLE v41_resale_listings ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE v41_resale_listings DROP CONSTRAINT IF EXISTS v41_resale_listings_pkey;
ALTER TABLE v41_resale_listings ADD CONSTRAINT v41_resale_listings_pkey PRIMARY KEY (chain_id, token_id);
CREATE INDEX IF NOT EXISTS idx_v41_resale_listings_chain_active
    ON v41_resale_listings(chain_id, active);

ALTER TABLE v41_resale_history ADD COLUMN IF NOT EXISTS chain_id NUMERIC(78,0);
UPDATE v41_resale_history SET chain_id = 84532 WHERE chain_id IS NULL;
ALTER TABLE v41_resale_history ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE v41_resale_history DROP CONSTRAINT IF EXISTS v41_resale_history_unique_log;
CREATE UNIQUE INDEX IF NOT EXISTS idx_v41_resale_history_chain_tx_log
    ON v41_resale_history(chain_id, transaction_hash, log_index);

ALTER TABLE v41_project_eligibility ADD COLUMN IF NOT EXISTS chain_id NUMERIC(78,0);
UPDATE v41_project_eligibility SET chain_id = 84532 WHERE chain_id IS NULL;
ALTER TABLE v41_project_eligibility ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE v41_project_eligibility DROP CONSTRAINT IF EXISTS v41_project_eligibility_pkey;
ALTER TABLE v41_project_eligibility ADD CONSTRAINT v41_project_eligibility_pkey PRIMARY KEY (chain_id, user_address);

ALTER TABLE v41_genesis_holders ADD COLUMN IF NOT EXISTS chain_id NUMERIC(78,0);
UPDATE v41_genesis_holders SET chain_id = 84532 WHERE chain_id IS NULL;
ALTER TABLE v41_genesis_holders ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE v41_genesis_holders DROP CONSTRAINT IF EXISTS v41_genesis_holders_pkey;
ALTER TABLE v41_genesis_holders DROP CONSTRAINT IF EXISTS v41_genesis_holders_token_id_key;
ALTER TABLE v41_genesis_holders ADD CONSTRAINT v41_genesis_holders_pkey PRIMARY KEY (chain_id, user_address);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v41_genesis_holders_chain_token
    ON v41_genesis_holders(chain_id, token_id);

ALTER TABLE v41_trust_signals ADD COLUMN IF NOT EXISTS chain_id NUMERIC(78,0);
UPDATE v41_trust_signals SET chain_id = 84532 WHERE chain_id IS NULL;
ALTER TABLE v41_trust_signals ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE v41_trust_signals DROP CONSTRAINT IF EXISTS v41_trust_signals_pkey;
ALTER TABLE v41_trust_signals ADD CONSTRAINT v41_trust_signals_pkey PRIMARY KEY (chain_id, user_address);

ALTER TABLE artwork_social_signals ADD COLUMN IF NOT EXISTS chain_id BIGINT;
UPDATE artwork_social_signals SET chain_id = 84532 WHERE chain_id IS NULL;
ALTER TABLE artwork_social_signals ALTER COLUMN chain_id SET DEFAULT 84532;
ALTER TABLE artwork_social_signals ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE artwork_social_signals DROP CONSTRAINT IF EXISTS artwork_social_signals_unique_user_signal;
CREATE UNIQUE INDEX IF NOT EXISTS idx_artwork_social_signals_chain_unique_user_signal
    ON artwork_social_signals(chain_id, artwork_id, wallet_address, signal_type);
CREATE INDEX IF NOT EXISTS idx_artwork_social_signals_chain_artwork
    ON artwork_social_signals(chain_id, artwork_id);

CREATE OR REPLACE VIEW v41_project_eligibility_signals AS
WITH users AS (
    SELECT chain_id, creator AS user_address FROM v41_artworks
    UNION
    SELECT chain_id, bidder AS user_address FROM v41_bids
    UNION
    SELECT chain_id, winner AS user_address FROM v41_settlements WHERE settlement_status = 'completed'
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
    holder.token_id AS genesis_token_id,
    users.chain_id
FROM users
LEFT JOIN (
    SELECT chain_id, creator AS user_address, COUNT(*) AS artwork_upload_count
    FROM v41_artworks
    GROUP BY chain_id, creator
) artwork_counts USING (chain_id, user_address)
LEFT JOIN (
    SELECT chain_id, bidder AS user_address, COUNT(DISTINCT auction_id) AS auction_participation_count
    FROM v41_bids
    GROUP BY chain_id, bidder
) bid_counts USING (chain_id, user_address)
LEFT JOIN (
    SELECT chain_id, winner AS user_address, COUNT(*) AS successful_settlement_count
    FROM v41_settlements
    WHERE settlement_status = 'completed'
    GROUP BY chain_id, winner
) settlement_counts USING (chain_id, user_address)
LEFT JOIN v41_project_eligibility eligibility USING (chain_id, user_address)
LEFT JOIN v41_genesis_holders holder USING (chain_id, user_address);

CREATE OR REPLACE FUNCTION rollback_events_from_block(reorg_block BIGINT, target_chain_id NUMERIC)
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
    WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    GET DIAGNOSTICS v_events_deleted = ROW_COUNT;

    DELETE FROM v41_genesis_holders WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    DELETE FROM v41_project_eligibility WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    DELETE FROM v41_resale_history WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    DELETE FROM v41_resale_listings WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    DELETE FROM v41_floor_history WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    DELETE FROM v41_settlements WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    DELETE FROM v41_auction_endings WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    DELETE FROM v41_auction_extensions WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    DELETE FROM v41_bid_withdrawals WHERE chain_id = target_chain_id AND block_number >= reorg_block;

    DELETE FROM v41_bids WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    GET DIAGNOSTICS v_bids_deleted = ROW_COUNT;

    DELETE FROM v41_auctions WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    GET DIAGNOSTICS v_auctions_deleted = ROW_COUNT;

    DELETE FROM v41_artworks WHERE chain_id = target_chain_id AND block_number >= reorg_block;

    DELETE FROM indexed_auctions WHERE block_number >= reorg_block;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_auctions_deleted := v_auctions_deleted + v_rows;

    DELETE FROM indexed_bids WHERE block_number >= reorg_block;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_bids_deleted := v_bids_deleted + v_rows;

    DELETE FROM outbox_events
    WHERE correlation_id IN (
        SELECT target_chain_id::TEXT || '-' || transaction_hash || '-' || log_index
        FROM contract_events
        WHERE chain_id = target_chain_id AND block_number >= reorg_block
    )
    OR (
        target_chain_id = 84532
        AND correlation_id IN (
            SELECT transaction_hash || '-' || log_index
            FROM contract_events
            WHERE chain_id = target_chain_id AND block_number >= reorg_block
        )
    );
    GET DIAGNOSTICS v_outbox_deleted = ROW_COUNT;

    DELETE FROM outbox_events
    WHERE idempotency_key IN (
        SELECT target_chain_id::TEXT || '-' || transaction_hash || '-' || log_index || '-webhook'
        FROM contract_events
        WHERE chain_id = target_chain_id AND block_number >= reorg_block
        UNION
        SELECT target_chain_id::TEXT || '-' || transaction_hash || '-' || log_index || '-notification'
        FROM contract_events
        WHERE chain_id = target_chain_id AND block_number >= reorg_block
    );
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_outbox_deleted := v_outbox_deleted + v_rows;

    DELETE FROM contract_events
    WHERE chain_id = target_chain_id AND block_number >= reorg_block;

    RETURN QUERY SELECT v_events_deleted, v_auctions_deleted, v_bids_deleted, v_outbox_deleted;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION rollback_events_from_block(reorg_block BIGINT)
RETURNS TABLE(
    events_deleted BIGINT,
    auctions_deleted BIGINT,
    bids_deleted BIGINT,
    outbox_deleted BIGINT
) AS $$
BEGIN
    RETURN QUERY SELECT * FROM rollback_events_from_block(reorg_block, 84532);
END;
$$ LANGUAGE plpgsql;

COMMENT ON VIEW v41_project_eligibility_signals IS 'Chain-scoped derived Genesis eligibility signals; profile and artwork interactions remain external inputs';
