-- Finalized secondary sales on reviewed ordinary pairs, independent of ingestion order.
CREATE TABLE IF NOT EXISTS artsoul_private.ordinary_resale_purchases (
    chain_id integer NOT NULL,
    core_address text NOT NULL,
    token_id numeric(78,0) NOT NULL CHECK (token_id > 0),
    listing_version numeric(78,0) NOT NULL CHECK (listing_version > 0),
    artwork_id numeric(78,0) NOT NULL CHECK (artwork_id > 0),
    price_wei numeric(78,0) NOT NULL CHECK (price_wei > 0),
    seller text NOT NULL CHECK (seller ~ '^0x[0-9a-f]{40}$' AND seller !~ '^0x0+$'),
    buyer text NOT NULL CHECK (buyer ~ '^0x[0-9a-f]{40}$' AND buyer !~ '^0x0+$' AND buyer <> seller),
    creator text NOT NULL CHECK (creator ~ '^0x[0-9a-f]{40}$' AND creator !~ '^0x0+$'),
    first_collector text NOT NULL CHECK (first_collector ~ '^0x[0-9a-f]{40}$' AND first_collector !~ '^0x0+$'),
    protocol_treasury text NOT NULL CHECK (protocol_treasury ~ '^0x[0-9a-f]{40}$' AND protocol_treasury !~ '^0x0+$'),
    ecosystem_treasury text NOT NULL CHECK (ecosystem_treasury ~ '^0x[0-9a-f]{40}$' AND ecosystem_treasury !~ '^0x0+$' AND ecosystem_treasury <> protocol_treasury),
    seller_wei numeric(78,0) NOT NULL CHECK (seller_wei >= 0),
    creator_wei numeric(78,0) NOT NULL CHECK (creator_wei >= 0),
    protocol_wei numeric(78,0) NOT NULL CHECK (protocol_wei >= 0),
    ecosystem_wei numeric(78,0) NOT NULL CHECK (ecosystem_wei >= 0),
    transaction_hash text NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$' AND transaction_hash !~ '^0x0+$'),
    block_number bigint NOT NULL CHECK (block_number >= 0),
    block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$' AND block_hash !~ '^0x0+$'),
    log_index bigint NOT NULL CHECK (log_index > 0),
    CHECK (seller_wei + creator_wei + protocol_wei + ecosystem_wei = price_wei),
    CHECK (greatest(token_id, listing_version, artwork_id, price_wei) <=
        115792089237316195423570985008687907853269984665640564039457584007913129639935),
    PRIMARY KEY (chain_id, core_address, token_id, listing_version),
    FOREIGN KEY (chain_id, core_address) REFERENCES artsoul_private.ordinary_issuers (chain_id, core_address),
    UNIQUE (chain_id, transaction_hash, log_index),
    UNIQUE (chain_id, block_number, log_index)
);

ALTER TABLE artsoul_private.ordinary_resale_purchases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON artsoul_private.ordinary_resale_purchases FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
    FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
        EXECUTE format('REVOKE ALL ON artsoul_private.ordinary_resale_purchases FROM %I', api_role);
    END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS ordinary_resale_purchases_append_only ON artsoul_private.ordinary_resale_purchases;
CREATE TRIGGER ordinary_resale_purchases_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON artsoul_private.ordinary_resale_purchases
    FOR EACH STATEMENT EXECUTE FUNCTION artsoul_private.reject_ordinary_evidence_change();
