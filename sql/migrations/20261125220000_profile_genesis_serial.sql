BEGIN;
-- Only the profile service may request the public serial of one wallet from a reviewed deployment.
CREATE OR REPLACE FUNCTION public.read_profile_genesis_serial(
    p_genesis text, p_code_hash text, p_authority text, p_founder text, p_wallet text
) RETURNS smallint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT g.token_id
    FROM artsoul_private.genesis_issuers i
    JOIN artsoul_private.genesis_grants g USING (chain_id, genesis_address)
    JOIN artsoul_private.genesis_grant_batches b USING (chain_id, genesis_address, transaction_hash)
    JOIN public.indexer_state s ON s.chain_id = i.chain_id
    WHERE i.chain_id = 8453 AND i.genesis_address = p_genesis AND i.code_hash = p_code_hash
        AND i.grant_authority = p_authority AND i.founder_recipient = p_founder AND g.recipient = p_wallet
        AND s.last_confirmed_block >= b.block_number AND s.last_indexed_block >= s.last_confirmed_block
        AND NOT EXISTS (SELECT FROM public.indexer_state other WHERE other.chain_id IS DISTINCT FROM 8453)
    ORDER BY g.token_id LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.read_profile_genesis_serial(text,text,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_profile_genesis_serial(text,text,text,text,text) TO service_role;
COMMIT;
