-- Finalized registrations remain separate from the prototype catalog and cursor.
CREATE TABLE IF NOT EXISTS artsoul_private.ordinary_registrations (
    chain_id integer NOT NULL,
    core_address text NOT NULL,
    artwork_id numeric(78,0) NOT NULL CHECK (artwork_id BETWEEN 1 AND
        115792089237316195423570985008687907853269984665640564039457584007913129639935),
    creator text NOT NULL CHECK (creator ~ '^0x[0-9a-f]{40}$' AND creator !~ '^0x0+$'),
    metadata_uri bytea NOT NULL CHECK (octet_length(metadata_uri) BETWEEN 1 AND 2048),
    transaction_hash text NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$' AND transaction_hash !~ '^0x0+$'),
    block_number bigint NOT NULL CHECK (block_number >= 0),
    block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$' AND block_hash !~ '^0x0+$'),
    log_index bigint NOT NULL CHECK (log_index >= 0),
    PRIMARY KEY (chain_id, core_address, artwork_id),
    FOREIGN KEY (chain_id, core_address) REFERENCES artsoul_private.ordinary_issuers (chain_id, core_address),
    UNIQUE (chain_id, transaction_hash, log_index),
    UNIQUE (chain_id, block_number, log_index)
);

ALTER TABLE artsoul_private.ordinary_registrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON artsoul_private.ordinary_registrations FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
    FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
        EXECUTE format('REVOKE ALL ON artsoul_private.ordinary_registrations FROM %I', api_role);
    END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS ordinary_registrations_append_only ON artsoul_private.ordinary_registrations;
CREATE TRIGGER ordinary_registrations_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON artsoul_private.ordinary_registrations
    FOR EACH STATEMENT EXECUTE FUNCTION artsoul_private.reject_ordinary_evidence_change();
