-- Replaying an older settlement's verified receipt can append its credit independently.
CREATE TABLE IF NOT EXISTS artsoul_private.ordinary_primary_credits (
    chain_id integer NOT NULL,
    core_address text NOT NULL,
    auction_id numeric(78,0) NOT NULL,
    protocol_treasury text NOT NULL CHECK (protocol_treasury ~ '^0x[0-9a-f]{40}$' AND protocol_treasury !~ '^0x0+$'),
    protocol_wei numeric(78,0) NOT NULL CHECK (protocol_wei >= 0),
    creator_wei numeric(78,0) NOT NULL CHECK (creator_wei > 0),
    log_index bigint NOT NULL CHECK (log_index >= 0),
    PRIMARY KEY (chain_id, core_address, auction_id),
    FOREIGN KEY (chain_id, core_address, auction_id) REFERENCES artsoul_private.ordinary_settlements
);

ALTER TABLE artsoul_private.ordinary_primary_credits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON artsoul_private.ordinary_primary_credits FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
    FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
        EXECUTE format('REVOKE ALL ON artsoul_private.ordinary_primary_credits FROM %I', api_role);
    END LOOP;
END;
$$;
DROP TRIGGER IF EXISTS ordinary_primary_credits_append_only ON artsoul_private.ordinary_primary_credits;
CREATE TRIGGER ordinary_primary_credits_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON artsoul_private.ordinary_primary_credits
    FOR EACH STATEMENT EXECUTE FUNCTION artsoul_private.reject_ordinary_evidence_change();
