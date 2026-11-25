-- Reviewed Genesis deployments and finalized grants. Applying this migration grants no tokens or privileges.
CREATE TABLE IF NOT EXISTS artsoul_private.genesis_issuers (
    chain_id integer NOT NULL CHECK (chain_id = 8453),
    genesis_address text NOT NULL CHECK (genesis_address ~ '^0x[0-9a-f]{40}$' AND genesis_address !~ '^0x0+$'),
    code_hash text NOT NULL CHECK (code_hash ~ '^0x[0-9a-f]{64}$' AND code_hash !~ '^0x0+$'),
    grant_authority text NOT NULL CHECK (grant_authority ~ '^0x[0-9a-f]{40}$' AND grant_authority !~ '^0x0+$' AND grant_authority <> genesis_address),
    founder_recipient text NOT NULL CHECK (founder_recipient ~ '^0x[0-9a-f]{40}$' AND founder_recipient !~ '^0x0+$'),
    PRIMARY KEY (chain_id, genesis_address)
);

CREATE TABLE IF NOT EXISTS artsoul_private.genesis_grant_batches (
    chain_id integer NOT NULL,
    genesis_address text NOT NULL,
    transaction_hash text NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$' AND transaction_hash !~ '^0x0+$'),
    block_number bigint NOT NULL CHECK (block_number >= 0),
    block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$' AND block_hash !~ '^0x0+$'),
    transaction_index bigint NOT NULL CHECK (transaction_index >= 0),
    policy_hash text NOT NULL CHECK (policy_hash ~ '^0x[0-9a-f]{64}$' AND policy_hash !~ '^0x0+$'),
    calldata_hash text NOT NULL CHECK (calldata_hash ~ '^0x[0-9a-f]{64}$' AND calldata_hash !~ '^0x0+$'),
    grant_count smallint NOT NULL CHECK (grant_count BETWEEN 1 AND 32),
    PRIMARY KEY (chain_id, genesis_address, transaction_hash),
    UNIQUE (chain_id, genesis_address, block_number, transaction_index),
    FOREIGN KEY (chain_id, genesis_address) REFERENCES artsoul_private.genesis_issuers
);

CREATE TABLE IF NOT EXISTS artsoul_private.genesis_grants (
    chain_id integer NOT NULL,
    genesis_address text NOT NULL,
    token_id smallint NOT NULL CHECK (token_id BETWEEN 0 AND 9999),
    category smallint NOT NULL CHECK (category BETWEEN 0 AND 3 AND (token_id = 0) = (category = 0)
        AND (token_id BETWEEN 1 AND 200) = (category = 1)),
    recipient text NOT NULL CHECK (recipient ~ '^0x[0-9a-f]{40}$' AND recipient !~ '^0x0+$'),
    decision_hash text NOT NULL CHECK (decision_hash ~ '^0x[0-9a-f]{64}$' AND decision_hash !~ '^0x0+$'),
    transaction_hash text NOT NULL,
    mint_index bigint NOT NULL CHECK (mint_index >= 0),
    lock_index bigint NOT NULL CHECK (lock_index > mint_index),
    grant_index bigint NOT NULL CHECK (grant_index > lock_index),
    PRIMARY KEY (chain_id, genesis_address, token_id),
    UNIQUE (chain_id, genesis_address, decision_hash),
    UNIQUE (chain_id, transaction_hash, grant_index),
    FOREIGN KEY (chain_id, genesis_address, transaction_hash) REFERENCES artsoul_private.genesis_grant_batches
);
CREATE INDEX IF NOT EXISTS genesis_grants_recipient ON artsoul_private.genesis_grants (chain_id, genesis_address, recipient);

CREATE OR REPLACE FUNCTION artsoul_private.reject_genesis_evidence_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    RAISE EXCEPTION 'Finalized Genesis evidence is append-only';
END;
$$;
REVOKE ALL ON FUNCTION artsoul_private.reject_genesis_evidence_change() FROM PUBLIC;
DO $$
DECLARE t text; api_role text;
BEGIN
    FOREACH t IN ARRAY ARRAY['genesis_issuers','genesis_grant_batches','genesis_grants'] LOOP
        EXECUTE format('ALTER TABLE artsoul_private.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON TABLE artsoul_private.%I FROM PUBLIC', t);
        FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
            EXECUTE format('REVOKE ALL ON TABLE artsoul_private.%I FROM %I', t, api_role);
        END LOOP;
        EXECUTE format('DROP TRIGGER IF EXISTS genesis_evidence_append_only ON artsoul_private.%I', t);
        EXECUTE format('CREATE TRIGGER genesis_evidence_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON artsoul_private.%I FOR EACH STATEMENT EXECUTE FUNCTION artsoul_private.reject_genesis_evidence_change()', t);
    END LOOP;
END;
$$;
