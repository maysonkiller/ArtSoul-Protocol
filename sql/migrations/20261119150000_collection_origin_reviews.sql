-- Prepare durable origin decisions for the future reviewed collection publisher.
-- The application receives read access only. Reviewer evidence stays private.
BEGIN;
CREATE TABLE public.collection_origin_reviews (
    chain_id bigint NOT NULL CHECK (chain_id > 0),
    collection_address text NOT NULL CHECK (collection_address ~ '^0x[0-9a-f]{40}$' AND collection_address <> '0x0000000000000000000000000000000000000000'),
    revision bigint NOT NULL CHECK (revision > 0),
    previous_revision bigint GENERATED ALWAYS AS (NULLIF(revision - 1, 0)) STORED,
    creator_address text NOT NULL CHECK (creator_address ~ '^0x[0-9a-f]{40}$' AND creator_address <> '0x0000000000000000000000000000000000000000'),
    verified boolean NOT NULL,
    review_id uuid NOT NULL UNIQUE,
    reviewer_wallet text NOT NULL CHECK (reviewer_wallet ~ '^0x[0-9a-f]{40}$' AND reviewer_wallet <> '0x0000000000000000000000000000000000000000'),
    evidence_ref text NOT NULL CHECK (length(btrim(evidence_ref)) BETWEEN 1 AND 512),
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
    recorded_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, collection_address, revision),
    FOREIGN KEY (chain_id, collection_address, previous_revision)
        REFERENCES public.collection_origin_reviews (chain_id, collection_address, revision)
);
ALTER TABLE public.collection_origin_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_origin_reviews FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.collection_origin_reviews FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (chain_id, collection_address, revision, creator_address, verified)
    ON public.collection_origin_reviews TO service_role;

CREATE FUNCTION public.preserve_collection_origin_reviews()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
    RAISE EXCEPTION 'Append a new collection origin review to change a decision';
END;
$$;
REVOKE ALL ON FUNCTION public.preserve_collection_origin_reviews() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER preserve_collection_origin_reviews
BEFORE UPDATE OR DELETE OR TRUNCATE ON public.collection_origin_reviews
FOR EACH STATEMENT EXECUTE FUNCTION public.preserve_collection_origin_reviews();

CREATE FUNCTION public.has_collection_origin_review(p_chain_id bigint, p_collection text, p_creator text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
    SELECT coalesce((
        SELECT r.verified AND r.creator_address = lower(p_creator)
        FROM public.collection_origin_reviews r
        WHERE r.chain_id = p_chain_id AND r.collection_address = lower(p_collection)
        ORDER BY r.revision DESC LIMIT 1
    ), false);
$$;
REVOKE ALL ON FUNCTION public.has_collection_origin_review(bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_collection_origin_review(bigint, text, text) TO service_role;
COMMIT;
