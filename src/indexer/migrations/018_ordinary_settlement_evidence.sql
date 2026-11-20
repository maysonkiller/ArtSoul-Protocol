-- Additive evidence for finalized replacement pairs. No prototype backfill or cursor changes.
CREATE SCHEMA IF NOT EXISTS artsoul_private;

CREATE TABLE IF NOT EXISTS artsoul_private.ordinary_issuers (
    chain_id integer NOT NULL CHECK (chain_id IN (84532, 8453)),
    core_address text NOT NULL CHECK (core_address ~ '^0x[0-9a-f]{40}$' AND core_address !~ '^0x0+$'),
    nft_address text NOT NULL CHECK (nft_address ~ '^0x[0-9a-f]{40}$' AND nft_address !~ '^0x0+$' AND nft_address <> core_address),
    core_code_hash text NOT NULL CHECK (core_code_hash ~ '^0x[0-9a-f]{64}$' AND core_code_hash !~ '^0x0+$'),
    nft_code_hash text NOT NULL CHECK (nft_code_hash ~ '^0x[0-9a-f]{64}$' AND nft_code_hash !~ '^0x0+$'),
    PRIMARY KEY (chain_id, core_address),
    UNIQUE (chain_id, nft_address)
);

CREATE TABLE IF NOT EXISTS artsoul_private.ordinary_settlements (
    chain_id integer NOT NULL,
    core_address text NOT NULL,
    auction_id numeric(78,0) NOT NULL CHECK (auction_id > 0),
    artwork_id numeric(78,0) NOT NULL CHECK (artwork_id > 0),
    token_id numeric(78,0) NOT NULL CHECK (token_id > 0),
    price_wei numeric(78,0) NOT NULL CHECK (price_wei > 0),
    creator text NOT NULL CHECK (creator ~ '^0x[0-9a-f]{40}$' AND creator !~ '^0x0+$'),
    first_collector text NOT NULL CHECK (first_collector ~ '^0x[0-9a-f]{40}$' AND first_collector !~ '^0x0+$'),
    runner_up_accepted boolean NOT NULL,
    transaction_hash text NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$' AND transaction_hash !~ '^0x0+$'),
    block_number bigint NOT NULL CHECK (block_number >= 0),
    block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$' AND block_hash !~ '^0x0+$'),
    log_index bigint NOT NULL CHECK (log_index >= 0),
    PRIMARY KEY (chain_id, core_address, auction_id),
    FOREIGN KEY (chain_id, core_address) REFERENCES artsoul_private.ordinary_issuers (chain_id, core_address),
    UNIQUE (chain_id, core_address, token_id),
    UNIQUE (chain_id, core_address, artwork_id),
    UNIQUE (chain_id, transaction_hash, log_index),
    UNIQUE (chain_id, block_number, log_index)
);

ALTER TABLE artsoul_private.ordinary_issuers ENABLE ROW LEVEL SECURITY;
ALTER TABLE artsoul_private.ordinary_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON artsoul_private.ordinary_issuers, artsoul_private.ordinary_settlements FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
    FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
        EXECUTE format('REVOKE ALL ON artsoul_private.ordinary_issuers, artsoul_private.ordinary_settlements FROM %I', api_role);
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION artsoul_private.reject_ordinary_evidence_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    RAISE EXCEPTION 'Finalized ordinary settlement evidence is append-only';
END;
$$;
REVOKE ALL ON FUNCTION artsoul_private.reject_ordinary_evidence_change() FROM PUBLIC;
DROP TRIGGER IF EXISTS ordinary_issuers_append_only ON artsoul_private.ordinary_issuers;
CREATE TRIGGER ordinary_issuers_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON artsoul_private.ordinary_issuers
    FOR EACH STATEMENT EXECUTE FUNCTION artsoul_private.reject_ordinary_evidence_change();
DROP TRIGGER IF EXISTS ordinary_settlements_append_only ON artsoul_private.ordinary_settlements;
CREATE TRIGGER ordinary_settlements_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON artsoul_private.ordinary_settlements
    FOR EACH STATEMENT EXECUTE FUNCTION artsoul_private.reject_ordinary_evidence_change();
