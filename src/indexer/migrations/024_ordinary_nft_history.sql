-- Independent finalized coverage for each ordinary pair. Historical pairs retain their own progress.
CREATE TABLE IF NOT EXISTS artsoul_private.ordinary_nft_ranges (
    chain_id integer NOT NULL,
    core_address text NOT NULL,
    origin_block bigint NOT NULL CHECK (origin_block > 0),
    origin_previous_hash text NOT NULL CHECK (origin_previous_hash ~ '^0x[0-9a-f]{64}$'),
    from_block bigint NOT NULL CHECK (from_block >= origin_block),
    previous_hash text NOT NULL CHECK (previous_hash ~ '^0x[0-9a-f]{64}$'),
    through_block bigint NOT NULL CHECK (through_block >= from_block),
    through_hash text NOT NULL CHECK (through_hash ~ '^0x[0-9a-f]{64}$'),
    supply_before numeric(78,0) NOT NULL CHECK (supply_before >= 0),
    supply_after numeric(78,0) NOT NULL CHECK (supply_after >= supply_before),
    event_count integer NOT NULL CHECK (event_count BETWEEN 0 AND 10000),
    resale_count integer CHECK (resale_count BETWEEN 0 AND event_count),
    CHECK (from_block > origin_block OR (supply_before = 0 AND previous_hash = origin_previous_hash)),
    PRIMARY KEY (chain_id, core_address, through_block),
    UNIQUE (chain_id, core_address, from_block),
    FOREIGN KEY (chain_id, core_address) REFERENCES artsoul_private.ordinary_issuers
);

CREATE TABLE IF NOT EXISTS artsoul_private.ordinary_nft_transfers (
    chain_id integer NOT NULL,
    core_address text NOT NULL,
    through_block bigint NOT NULL,
    block_number bigint NOT NULL CHECK (block_number >= 0 AND block_number <= through_block),
    block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
    transaction_hash text NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
    transaction_index integer NOT NULL CHECK (transaction_index >= 0),
    log_index integer NOT NULL CHECK (log_index >= 0),
    block_time timestamptz NOT NULL,
    token_id numeric(78,0) NOT NULL CHECK (token_id > 0),
    from_wallet text NOT NULL CHECK (from_wallet ~ '^0x[0-9a-f]{40}$'),
    to_wallet text NOT NULL CHECK (to_wallet ~ '^0x[0-9a-f]{40}$' AND to_wallet !~ '^0x0+$'),
    PRIMARY KEY (chain_id, transaction_hash, log_index),
    UNIQUE (chain_id, block_number, log_index),
    FOREIGN KEY (chain_id, core_address, through_block) REFERENCES artsoul_private.ordinary_nft_ranges
);
CREATE INDEX IF NOT EXISTS ordinary_nft_owner_history ON artsoul_private.ordinary_nft_transfers
    (chain_id, core_address, token_id, block_number DESC, log_index DESC);
CREATE INDEX IF NOT EXISTS ordinary_nft_history_by_range ON artsoul_private.ordinary_nft_transfers
    (chain_id, core_address, through_block);

ALTER TABLE artsoul_private.ordinary_nft_ranges ENABLE ROW LEVEL SECURITY;
ALTER TABLE artsoul_private.ordinary_nft_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON artsoul_private.ordinary_nft_ranges, artsoul_private.ordinary_nft_transfers FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
    FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
        EXECUTE format('REVOKE ALL ON artsoul_private.ordinary_nft_ranges, artsoul_private.ordinary_nft_transfers FROM %I', api_role);
    END LOOP;
END;
$$;
DROP TRIGGER IF EXISTS ordinary_nft_ranges_append_only ON artsoul_private.ordinary_nft_ranges;
CREATE TRIGGER ordinary_nft_ranges_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON artsoul_private.ordinary_nft_ranges
    FOR EACH STATEMENT EXECUTE FUNCTION artsoul_private.reject_ordinary_evidence_change();
DROP TRIGGER IF EXISTS ordinary_nft_transfers_append_only ON artsoul_private.ordinary_nft_transfers;
CREATE TRIGGER ordinary_nft_transfers_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON artsoul_private.ordinary_nft_transfers
    FOR EACH STATEMENT EXECUTE FUNCTION artsoul_private.reject_ordinary_evidence_change();
