BEGIN;
CREATE OR REPLACE VIEW artsoul_private.finalized_genesis_serials AS
    SELECT i.genesis_address, i.code_hash, i.grant_authority, i.founder_recipient, g.recipient, g.token_id
    FROM artsoul_private.genesis_issuers i
    JOIN artsoul_private.genesis_grants g USING (chain_id, genesis_address)
    JOIN artsoul_private.genesis_grant_batches b USING (chain_id, genesis_address, transaction_hash)
    JOIN public.indexer_state s ON s.chain_id = i.chain_id
    WHERE i.chain_id = 8453 AND s.last_confirmed_block >= b.block_number
        AND s.last_indexed_block >= s.last_confirmed_block
        AND NOT EXISTS (SELECT FROM public.indexer_state other WHERE other.chain_id IS DISTINCT FROM 8453);
REVOKE ALL ON artsoul_private.finalized_genesis_serials FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.read_profile_genesis_serial(
    p_genesis text, p_code_hash text, p_authority text, p_founder text, p_wallet text
) RETURNS smallint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT g.token_id FROM artsoul_private.finalized_genesis_serials g
    WHERE g.genesis_address = p_genesis AND g.code_hash = p_code_hash AND g.grant_authority = p_authority
        AND g.founder_recipient = p_founder AND g.recipient = p_wallet
    ORDER BY g.token_id LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.read_wallet_genesis_frames(
    p_genesis text, p_code_hash text, p_authority text, p_founder text, p_wallet text, p_serials smallint[]
) RETURNS TABLE (token_id smallint, border_text boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT g.token_id, (SELECT s.enabled FROM public.read_aura_border_setting() s)
    FROM artsoul_private.finalized_genesis_serials g
    WHERE g.genesis_address = p_genesis AND g.code_hash = p_code_hash AND g.grant_authority = p_authority
        AND g.founder_recipient = p_founder AND g.recipient = p_wallet
        AND pg_catalog.cardinality(p_serials) BETWEEN 1 AND 12 AND g.token_id = ANY(p_serials)
    ORDER BY g.token_id
$$;
REVOKE ALL ON FUNCTION public.read_wallet_genesis_frames(text,text,text,text,text,smallint[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_wallet_genesis_frames(text,text,text,text,text,smallint[]) TO service_role;
COMMIT;
