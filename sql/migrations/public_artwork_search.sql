-- B-14: derived public title search. Registrations and current visibility remain
-- authoritative. No contract, profile, auction, moderation or private data changes.
BEGIN;

CREATE TABLE IF NOT EXISTS public.artwork_search_metadata (
    chain_id NUMERIC(78,0) NOT NULL CHECK (chain_id = 84532),
    artwork_id NUMERIC(78,0) NOT NULL,
    metadata_uri TEXT NOT NULL,
    source_transaction_hash TEXT NOT NULL,
    revision UUID NOT NULL DEFAULT gen_random_uuid(),
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 512),
    metadata JSONB CHECK (metadata IS NULL OR (jsonb_typeof(metadata)='object' AND octet_length(metadata::TEXT)<=524288)),
    terms TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', title)) STORED,
    metadata_status TEXT NOT NULL DEFAULT 'pending' CHECK (metadata_status IN ('pending','ready','unavailable')),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    checked_at TIMESTAMPTZ,
    PRIMARY KEY (chain_id, artwork_id),
    FOREIGN KEY (chain_id, artwork_id) REFERENCES public.v41_artworks(chain_id, artwork_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS artwork_search_metadata_terms ON public.artwork_search_metadata USING GIN (terms);
CREATE INDEX IF NOT EXISTS artwork_search_metadata_pending ON public.artwork_search_metadata (next_attempt_at, artwork_id)
    WHERE metadata_status <> 'ready';
CREATE INDEX IF NOT EXISTS artwork_search_creator ON public.v41_artworks (chain_id, lower(creator), artwork_id DESC);
CREATE INDEX IF NOT EXISTS artwork_search_profiles_wallet ON public.profiles (lower(wallet_address));
CREATE INDEX IF NOT EXISTS artwork_search_profiles_terms ON public.profiles USING GIN (
    to_tsvector('simple', coalesce(username,'') || ' ' ||
        CASE WHEN nullif(btrim(twitter_id),'') IS NOT NULL THEN coalesce(twitter_username,'') ELSE '' END || ' ' ||
        CASE WHEN nullif(btrim(discord_id),'') IS NOT NULL THEN coalesce(discord_username,'') ELSE '' END)
);

ALTER TABLE public.artwork_search_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artwork_search_metadata FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.artwork_search_metadata FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.artwork_search_metadata TO service_role;
DROP POLICY IF EXISTS artwork_search_metadata_service ON public.artwork_search_metadata;
CREATE POLICY artwork_search_metadata_service ON public.artwork_search_metadata TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.queue_artwork_search_metadata() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    IF NEW.chain_id <> 84532 THEN RETURN NEW; END IF;
    INSERT INTO public.artwork_search_metadata(chain_id,artwork_id,metadata_uri,source_transaction_hash,title)
        VALUES (NEW.chain_id,NEW.artwork_id,NEW.metadata_uri,NEW.transaction_hash,'Artwork #' || NEW.artwork_id::TEXT)
    ON CONFLICT (chain_id,artwork_id) DO UPDATE SET
        metadata_uri=EXCLUDED.metadata_uri, source_transaction_hash=EXCLUDED.source_transaction_hash,
        title=EXCLUDED.title, metadata=NULL, revision=gen_random_uuid(), metadata_status='pending',
        next_attempt_at=clock_timestamp(), checked_at=NULL
    WHERE artwork_search_metadata.metadata_uri IS DISTINCT FROM EXCLUDED.metadata_uri
       OR artwork_search_metadata.source_transaction_hash IS DISTINCT FROM EXCLUDED.source_transaction_hash;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_artwork_search_metadata() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS queue_artwork_search_metadata ON public.v41_artworks;
CREATE TRIGGER queue_artwork_search_metadata AFTER INSERT OR UPDATE OF metadata_uri, transaction_hash ON public.v41_artworks
    FOR EACH ROW EXECUTE FUNCTION public.queue_artwork_search_metadata();

-- Idempotent seed: preserve previously checked titles and their retry state.
INSERT INTO public.artwork_search_metadata(chain_id,artwork_id,metadata_uri,source_transaction_hash,title)
    SELECT chain_id,artwork_id,metadata_uri,transaction_hash,'Artwork #' || artwork_id::TEXT
    FROM public.v41_artworks WHERE chain_id=84532
ON CONFLICT (chain_id,artwork_id) DO NOTHING;

-- Only the server can call this bounded candidate lookup. All query operators
-- are constructed from parsed lexemes, never interpolated caller syntax.
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
          AND (p_category='artworks' OR EXISTS (
              SELECT 1 FROM public.v41_auctions u WHERE u.chain_id=a.chain_id AND u.artwork_id=a.artwork_id
                AND u.auction_id=a.active_auction_id AND u.status='active' AND u.end_time>statement_timestamp()
          ))
        ORDER BY a.artwork_id DESC LIMIT p_limit;
END;
$$;
REVOKE ALL ON FUNCTION public.search_public_artworks(TEXT,TEXT,TEXT,TEXT,INTEGER) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_public_artworks(TEXT,TEXT,TEXT,TEXT,INTEGER) TO service_role;

-- Latest-row lookups are per artwork/token, never a global history row cap.
CREATE INDEX IF NOT EXISTS artwork_search_auctions_latest ON public.v41_auctions(chain_id,artwork_id,auction_id DESC);
CREATE INDEX IF NOT EXISTS artwork_search_settlements_latest ON public.v41_settlements(chain_id,artwork_id,block_number DESC,log_index DESC)
    WHERE settlement_status='completed';
CREATE INDEX IF NOT EXISTS artwork_search_resale_latest ON public.v41_resale_history(chain_id,token_id,block_number DESC,log_index DESC);

CREATE OR REPLACE FUNCTION public.read_public_search_cards(p_artwork_ids TEXT[],p_core_address TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_result JSONB;
BEGIN
    IF p_artwork_ids IS NULL OR cardinality(p_artwork_ids) NOT BETWEEN 1 AND 20 OR
       EXISTS (SELECT 1 FROM unnest(p_artwork_ids) x WHERE x IS NULL OR x !~ '^[1-9][0-9]{0,77}$') THEN
        RAISE EXCEPTION 'Invalid search artwork page' USING ERRCODE='22023';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(p_artwork_ids) x WHERE x::NUMERIC >=
       115792089237316195423570985008687907853269984665640564039457584007913129639936) THEN
        RAISE EXCEPTION 'Invalid search artwork identifier' USING ERRCODE='22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.indexer_state s WHERE s.chain_id=84532 AND lower(s.contract_address)=p_core_address) THEN
        RAISE EXCEPTION 'Search deployment unavailable' USING ERRCODE='55000';
    END IF;
    WITH selected AS (
        SELECT a.*,d.metadata FROM public.v41_artworks a
        JOIN public.indexer_state s ON s.chain_id=a.chain_id AND lower(s.contract_address)=p_core_address
        LEFT JOIN public.artwork_search_metadata d ON d.chain_id=a.chain_id AND d.artwork_id=a.artwork_id
            AND d.metadata_uri=a.metadata_uri AND d.source_transaction_hash=a.transaction_hash
        WHERE a.chain_id=84532 AND a.artwork_id=ANY(p_artwork_ids::NUMERIC[]) AND a.block_number<=s.last_confirmed_block
          AND NOT EXISTS (SELECT 1 FROM public.artwork_moderation_visibility h WHERE h.chain_id=a.chain_id AND h.artwork_id=a.artwork_id AND h.hidden)
    ), rows AS (
        SELECT a.artwork_id,
            (to_jsonb(a)-'metadata') || jsonb_build_object('artwork_id',a.artwork_id::TEXT,'token_id',a.token_id::TEXT,
                'canonical_floor',a.canonical_floor::TEXT,'active_auction_id',a.active_auction_id::TEXT) AS artwork,
            coalesce(a.metadata,'{}'::JSONB) AS metadata,
            (SELECT to_jsonb(u) || jsonb_build_object('auction_id',u.auction_id::TEXT,'artwork_id',u.artwork_id::TEXT,
                'start_price',u.start_price::TEXT,'current_bid',u.current_bid::TEXT,'winning_bid',u.winning_bid::TEXT,
                'final_price',u.final_price::TEXT,'token_id',u.token_id::TEXT)
             FROM public.v41_auctions u WHERE u.chain_id=a.chain_id AND u.artwork_id=a.artwork_id ORDER BY u.auction_id DESC LIMIT 1) AS auction,
            (SELECT to_jsonb(t) || jsonb_build_object('auction_id',t.auction_id::TEXT,'artwork_id',t.artwork_id::TEXT,'token_id',t.token_id::TEXT)
             FROM public.v41_settlements t WHERE t.chain_id=a.chain_id AND t.artwork_id=a.artwork_id AND t.settlement_status='completed'
             ORDER BY t.block_number DESC,t.log_index DESC,t.indexed_at DESC LIMIT 1) AS settlement,
            (SELECT to_jsonb(r) || jsonb_build_object('token_id',r.token_id::TEXT,'price',r.price::TEXT)
             FROM public.v41_resale_listings r WHERE r.chain_id=a.chain_id AND r.token_id=a.token_id) AS listing,
            (SELECT to_jsonb(r) || jsonb_build_object('token_id',r.token_id::TEXT)
             FROM public.v41_resale_history r WHERE r.chain_id=a.chain_id AND r.token_id=a.token_id
             ORDER BY r.block_number DESC,r.log_index DESC,r.indexed_at DESC LIMIT 1) AS resale,
            (SELECT jsonb_build_object('like',count(DISTINCT lower(btrim(wallet_address))) FILTER (WHERE signal_type='like' AND btrim(wallet_address)<>''),
                'would_buy',count(DISTINCT lower(btrim(wallet_address))) FILTER (WHERE signal_type='would_buy' AND btrim(wallet_address)<>''),
                'watching',count(DISTINCT lower(btrim(wallet_address))) FILTER (WHERE signal_type='watching' AND btrim(wallet_address)<>''))
             FROM public.artwork_social_signals g WHERE g.chain_id=a.chain_id AND g.artwork_id=a.artwork_id::TEXT) AS signals
        FROM selected a
    ) SELECT jsonb_build_object(
        'artworks',coalesce(jsonb_agg(artwork ORDER BY artwork_id),'[]'::JSONB),
        'metadata',coalesce(jsonb_agg(metadata ORDER BY artwork_id),'[]'::JSONB),
        'auctions',coalesce(jsonb_agg(auction) FILTER(WHERE auction IS NOT NULL),'[]'::JSONB),
        'settlements',coalesce(jsonb_agg(settlement) FILTER(WHERE settlement IS NOT NULL),'[]'::JSONB),
        'listings',coalesce(jsonb_agg(listing) FILTER(WHERE listing IS NOT NULL),'[]'::JSONB),
        'resales',coalesce(jsonb_agg(resale) FILTER(WHERE resale IS NOT NULL),'[]'::JSONB),
        'signals',coalesce(jsonb_agg(signals ORDER BY artwork_id),'[]'::JSONB)
    ) INTO v_result FROM rows;
    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.read_public_search_cards(TEXT[],TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_public_search_cards(TEXT[],TEXT) TO service_role;
COMMIT;
