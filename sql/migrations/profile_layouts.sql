-- Wallet-bound public presentation. Identity, moderation and discovery are unchanged.
-- Apply separately after backup; no table/sequence default grants are assumed.
BEGIN;
CREATE OR REPLACE FUNCTION public.profile_layout_valid(p_layout JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog, public AS $$
DECLARE section JSONB; work JSONB; works JSONB := '[]'::JSONB; ids TEXT[] := '{}';
BEGIN
  IF jsonb_typeof(p_layout) <> 'object' OR octet_length(p_layout::TEXT) > 16384 OR
     (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_layout) AS k(key)) IS DISTINCT FROM
       ARRAY['cover_url','pinned','sections','template','version'] OR
     p_layout->'version' <> '1'::JSONB OR jsonb_typeof(p_layout->'template') <> 'string' OR p_layout->>'template' NOT IN ('default','featured') OR
     jsonb_typeof(p_layout->'sections') <> 'array' OR jsonb_array_length(p_layout->'sections') > 3 OR
     (p_layout->'cover_url' <> 'null'::JSONB AND (jsonb_typeof(p_layout->'cover_url') <> 'string' OR
       length(p_layout->>'cover_url') > 2048 OR p_layout->>'cover_url' !~ '^https://' OR p_layout->>'cover_url' ~ '[[:cntrl:]]'))
  THEN RETURN FALSE; END IF;
  IF p_layout->'pinned' <> 'null'::JSONB THEN works := jsonb_build_array(p_layout->'pinned'); END IF;
  FOR section IN SELECT value FROM jsonb_array_elements(p_layout->'sections') LOOP
    IF jsonb_typeof(section) <> 'object' OR
       (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(section) AS k(key)) IS DISTINCT FROM ARRAY['artworks','id','label'] OR
       jsonb_typeof(section->'id') <> 'string' OR section->>'id' !~ '^[a-z0-9][a-z0-9_-]{0,39}$' OR section->>'id' = ANY(ids) OR
       jsonb_typeof(section->'label') <> 'string' OR length(btrim(section->>'label')) < 1 OR length(section->>'label') > 60 OR
       section->>'label' ~ '[[:cntrl:]]' OR jsonb_typeof(section->'artworks') <> 'array' OR jsonb_array_length(section->'artworks') > 20 OR
       (SELECT count(DISTINCT value) FROM jsonb_array_elements(section->'artworks')) <> jsonb_array_length(section->'artworks')
    THEN RETURN FALSE; END IF;
    ids := array_append(ids, section->>'id');
    works := works || (section->'artworks');
  END LOOP;
  FOR work IN SELECT value FROM jsonb_array_elements(works) LOOP
    IF jsonb_typeof(work) <> 'object' OR
       (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(work) AS k(key)) IS DISTINCT FROM ARRAY['artwork_id','chain_id','core_address'] OR
       jsonb_typeof(work->'chain_id') <> 'number' OR work->>'chain_id' !~ '^[1-9][0-9]{0,15}$' OR
       (work->>'chain_id')::NUMERIC > 9007199254740991 OR
       jsonb_typeof(work->'core_address') <> 'string' OR work->>'core_address' !~ '^0x[0-9a-f]{40}$' OR
       work->>'core_address' = '0x0000000000000000000000000000000000000000' OR
       jsonb_typeof(work->'artwork_id') <> 'string' OR work->>'artwork_id' !~ '^[1-9][0-9]{0,77}$' OR
       (work->>'artwork_id')::NUMERIC >= 115792089237316195423570985008687907853269984665640564039457584007913129639936
    THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN (SELECT count(DISTINCT value) FROM jsonb_array_elements(works)) <= 20;
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END;
$$;
REVOKE ALL ON FUNCTION public.profile_layout_valid(JSONB) FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.profile_layouts (
  wallet_address TEXT PRIMARY KEY CHECK (wallet_address ~ '^0x[0-9a-f]{40}$' AND wallet_address <> '0x0000000000000000000000000000000000000000'),
  revision INTEGER NOT NULL CHECK (revision > 0),
  layout JSONB NOT NULL CHECK (public.profile_layout_valid(layout)),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profile_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_layouts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.profile_layouts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.profile_layouts TO service_role;

CREATE OR REPLACE FUNCTION public.save_profile_layout(p_wallet_address TEXT, p_expected_revision INTEGER, p_layout JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE saved public.profile_layouts%ROWTYPE;
BEGIN
  IF p_wallet_address IS NULL OR p_wallet_address !~ '^0x[0-9a-f]{40}$' OR
     p_wallet_address = '0x0000000000000000000000000000000000000000' OR
     p_expected_revision IS NULL OR p_expected_revision < 0 OR p_expected_revision >= 2147483647 OR
     p_layout IS NULL OR NOT public.profile_layout_valid(p_layout)
  THEN RAISE EXCEPTION 'Invalid profile layout' USING ERRCODE = '22023'; END IF;
  IF p_expected_revision = 0 THEN
    INSERT INTO public.profile_layouts(wallet_address, revision, layout)
      VALUES(p_wallet_address, 1, p_layout) ON CONFLICT(wallet_address) DO NOTHING RETURNING * INTO saved;
  ELSE
    UPDATE public.profile_layouts SET layout = p_layout, revision = revision + 1, updated_at = now()
      WHERE wallet_address = p_wallet_address AND revision = p_expected_revision RETURNING * INTO saved;
  END IF;
  IF saved.wallet_address IS NULL THEN RETURN jsonb_build_object('saved', FALSE); END IF;
  RETURN jsonb_build_object('saved', TRUE, 'wallet', saved.wallet_address, 'revision', saved.revision, 'layout', saved.layout);
END;
$$;
REVOKE ALL ON FUNCTION public.save_profile_layout(TEXT,INTEGER,JSONB) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_profile_layout(TEXT,INTEGER,JSONB) TO service_role;
COMMIT;
