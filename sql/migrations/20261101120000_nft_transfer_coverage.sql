-- Apply after recovery_cache_obligation. This dormant schema does not attest
-- historical coverage or activate NFT ingestion/readers.
BEGIN;

CREATE TABLE IF NOT EXISTS public.nft_transfer_coverage (
    chain_id INTEGER NOT NULL REFERENCES public.indexer_state(chain_id) ON DELETE CASCADE,
    core_address TEXT NOT NULL CHECK (core_address ~ '^0x[0-9a-f]{40}$' AND core_address <> '0x' || repeat('0',40)),
    nft_address TEXT NOT NULL CHECK (nft_address ~ '^0x[0-9a-f]{40}$' AND nft_address <> '0x' || repeat('0',40)),
    from_block BIGINT NOT NULL CHECK (from_block > 0),
    origin_block_hash TEXT NOT NULL CHECK (origin_block_hash ~ '^0x[0-9a-f]{64}$' AND origin_block_hash <> '0x' || repeat('0',64)),
    covered_through BIGINT NOT NULL,
    covered_hash TEXT NOT NULL CHECK (covered_hash ~ '^0x[0-9a-f]{64}$' AND covered_hash <> '0x' || repeat('0',64)),
    core_code_hash TEXT NOT NULL CHECK (core_code_hash ~ '^0x[0-9a-f]{64}$' AND core_code_hash <> '0x' || repeat('0',64)),
    nft_code_hash TEXT NOT NULL CHECK (nft_code_hash ~ '^0x[0-9a-f]{64}$' AND nft_code_hash <> '0x' || repeat('0',64)),
    PRIMARY KEY (chain_id,core_address,nft_address),
    CHECK (chain_id > 0 AND core_address <> nft_address),
    CHECK (covered_through >= from_block - 1),
    CHECK (covered_through <> from_block - 1 OR covered_hash = origin_block_hash)
);
ALTER TABLE public.nft_transfer_coverage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nft_transfer_coverage FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.nft_transfer_coverage FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.nft_transfer_coverage TO service_role;
DROP POLICY IF EXISTS nft_transfer_coverage_service_read ON public.nft_transfer_coverage;
CREATE POLICY nft_transfer_coverage_service_read ON public.nft_transfer_coverage
    FOR SELECT TO service_role USING (true);

CREATE INDEX IF NOT EXISTS contract_events_nft_transfer_token
    ON public.contract_events(chain_id,contract_address,(event_data->>'tokenId'),block_number DESC,log_index DESC)
    WHERE event_name='Transfer';

-- Direct SQL rollback rotates the durable token even if no logs are deleted.
-- Invalidate atomically under its state-row lock; successful purge acknowledgement
-- to NULL does not invalidate a newly attested coverage row.
CREATE OR REPLACE FUNCTION artsoul_private.invalidate_nft_transfer_coverage()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
    DELETE FROM public.nft_transfer_coverage WHERE chain_id=NEW.chain_id;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION artsoul_private.invalidate_nft_transfer_coverage()
    FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS indexer_invalidate_nft_transfer_coverage ON public.indexer_state;
CREATE TRIGGER indexer_invalidate_nft_transfer_coverage
    AFTER UPDATE OF recovery_cache_token,contract_address ON public.indexer_state
    FOR EACH ROW WHEN (
        (NEW.recovery_cache_token IS NOT NULL AND NEW.recovery_cache_token IS DISTINCT FROM OLD.recovery_cache_token)
        OR lower(NEW.contract_address) IS DISTINCT FROM lower(OLD.contract_address)
    ) EXECUTE FUNCTION artsoul_private.invalidate_nft_transfer_coverage();

COMMENT ON TABLE public.nft_transfer_coverage IS
    'Deployment-scoped contiguous NFT Transfer evidence; origin predecessor and range continuity require a verified fenced writer';
COMMIT;
