-- B-14 forward repair: match the existing public serializer's latest-round
-- selection when active_auction_id is absent or stale. Test the latest round
-- AFTER selecting it so an older active row cannot revive a closed newer one.
-- Read-only projection semantics; no data, contract or economic changes.
-- Apply after public_artwork_search.sql. The original applied file is immutable.
BEGIN;

CREATE OR REPLACE FUNCTION public.search_public_artworks(
    p_query TEXT, p_category TEXT, p_core_address TEXT, p_before TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 21
) RETURNS TABLE (result_key TEXT)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
    v_query TEXT := btrim(p_query);
    v_terms TSQUERY;
    v_id NUMERIC;
    v_address TEXT;
    v_confirmed BIGINT;
BEGIN
    IF v_query IS NULL OR char_length(v_query) NOT BETWEEN 1 AND 100
       OR p_category NOT IN ('artworks','auctions','artists') OR p_category IS NULL
       OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 21
       OR p_core_address IS NULL OR p_core_address !~ '^0x[0-9a-f]{40}$' THEN
        RAISE EXCEPTION 'Invalid search request' USING ERRCODE='22023';
    END IF;
    SELECT s.last_confirmed_block INTO v_confirmed FROM public.indexer_state s
        WHERE s.chain_id=84532 AND lower(s.contract_address)=p_core_address;
    IF v_confirmed IS NULL THEN RAISE EXCEPTION 'Search deployment unavailable' USING ERRCODE='55000'; END IF;
    IF v_query ~* '^(#|artwork[: ]+)?[1-9][0-9]{0,77}$' THEN
        v_id := regexp_replace(v_query,'^(#|artwork[: ]+)','','i')::NUMERIC;
        IF v_id >= 115792089237316195423570985008687907853269984665640564039457584007913129639936 THEN
            RAISE EXCEPTION 'Invalid artwork identifier' USING ERRCODE='22023';
        END IF;
    ELSIF v_query ~* '^0x[0-9a-f]{40}$' THEN v_address := lower(v_query);
    ELSE
        IF char_length(v_query)<2 THEN RAISE EXCEPTION 'Enter at least two characters' USING ERRCODE='22023'; END IF;
        SELECT string_agg(quote_literal(t.lexeme) || ':*',' & ')::TSQUERY INTO v_terms
            FROM unnest(to_tsvector('simple',v_query)) t;
        IF v_terms IS NULL THEN RETURN; END IF;
    END IF;
    IF p_before IS NOT NULL AND ((p_category='artists' AND p_before !~ '^0x[0-9a-f]{40}$') OR
       (p_category<>'artists' AND (p_before !~ '^[1-9][0-9]{0,77}$' OR
         p_before::NUMERIC >= 115792089237316195423570985008687907853269984665640564039457584007913129639936))) THEN
        RAISE EXCEPTION 'Invalid search cursor' USING ERRCODE='22023';
    END IF;

    IF p_category='artists' THEN
        IF v_id IS NOT NULL THEN RETURN; END IF;
        RETURN QUERY WITH matching AS (
            SELECT lower(p.wallet_address) AS wallet FROM public.profiles p WHERE v_terms IS NOT NULL AND
                to_tsvector('simple',coalesce(p.username,'') || ' ' ||
                    CASE WHEN nullif(btrim(p.twitter_id),'') IS NOT NULL THEN coalesce(p.twitter_username,'') ELSE '' END || ' ' ||
                    CASE WHEN nullif(btrim(p.discord_id),'') IS NOT NULL THEN coalesce(p.discord_username,'') ELSE '' END) @@ v_terms
            UNION SELECT v_address WHERE v_address IS NOT NULL
        ) SELECT m.wallet FROM matching m WHERE (p_before IS NULL OR m.wallet<p_before) AND EXISTS (
            SELECT 1 FROM public.v41_artworks a WHERE a.chain_id=84532 AND lower(a.creator)=m.wallet
                AND a.block_number<=v_confirmed AND NOT EXISTS (
                    SELECT 1 FROM public.artwork_moderation_visibility h WHERE h.chain_id=a.chain_id AND h.artwork_id=a.artwork_id AND h.hidden
                )
        ) ORDER BY m.wallet DESC LIMIT p_limit;
        RETURN;
    END IF;

    RETURN QUERY WITH matching_creators AS (
        SELECT lower(p.wallet_address) AS wallet FROM public.profiles p WHERE v_terms IS NOT NULL AND
            to_tsvector('simple',coalesce(p.username,'') || ' ' ||
                CASE WHEN nullif(btrim(p.twitter_id),'') IS NOT NULL THEN coalesce(p.twitter_username,'') ELSE '' END || ' ' ||
                CASE WHEN nullif(btrim(p.discord_id),'') IS NOT NULL THEN coalesce(p.discord_username,'') ELSE '' END) @@ v_terms
        UNION SELECT v_address WHERE v_address IS NOT NULL
    ), matches AS (
        SELECT d.artwork_id FROM public.artwork_search_metadata d WHERE d.chain_id=84532 AND v_terms IS NOT NULL AND d.terms @@ v_terms
        UNION SELECT a.artwork_id FROM public.v41_artworks a JOIN matching_creators c ON lower(a.creator)=c.wallet WHERE a.chain_id=84532
        UNION SELECT v_id WHERE v_id IS NOT NULL
    ) SELECT a.artwork_id::TEXT FROM matches m JOIN public.v41_artworks a ON a.chain_id=84532 AND a.artwork_id=m.artwork_id
        WHERE a.block_number<=v_confirmed AND (p_before IS NULL OR a.artwork_id<p_before::NUMERIC)
          AND NOT EXISTS (SELECT 1 FROM public.artwork_moderation_visibility h WHERE h.chain_id=a.chain_id AND h.artwork_id=a.artwork_id AND h.hidden)
          AND (p_category='artworks' OR (
              SELECT u.status='active' AND u.end_time>statement_timestamp()
              FROM public.v41_auctions u WHERE u.chain_id=a.chain_id AND u.artwork_id=a.artwork_id
              ORDER BY u.auction_id DESC LIMIT 1
          ))
        ORDER BY a.artwork_id DESC LIMIT p_limit;
END;
$$;
REVOKE ALL ON FUNCTION public.search_public_artworks(TEXT,TEXT,TEXT,TEXT,INTEGER) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_public_artworks(TEXT,TEXT,TEXT,TEXT,INTEGER) TO service_role;
COMMIT;
