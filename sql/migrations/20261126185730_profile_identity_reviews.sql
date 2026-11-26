BEGIN;

CREATE TABLE public.profile_identity_reviews (
    wallet_address text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$' AND wallet_address <> '0x0000000000000000000000000000000000000000'),
    revision bigint NOT NULL CHECK (revision > 0),
    previous_revision bigint GENERATED ALWAYS AS (NULLIF(revision - 1, 0)) STORED,
    profile_id uuid NOT NULL,
    reviewed_name text NOT NULL CHECK (btrim(reviewed_name) <> ''),
    verified boolean NOT NULL,
    review_id uuid NOT NULL UNIQUE,
    reviewer_wallet text NOT NULL CHECK (reviewer_wallet ~ '^0x[0-9a-f]{40}$' AND reviewer_wallet <> '0x0000000000000000000000000000000000000000'),
    evidence_ref text NOT NULL CHECK (length(btrim(evidence_ref)) BETWEEN 1 AND 512),
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
    recorded_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (wallet_address, revision),
    FOREIGN KEY (wallet_address, previous_revision) REFERENCES public.profile_identity_reviews (wallet_address, revision)
);
ALTER TABLE public.profile_identity_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_identity_reviews FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.profile_identity_reviews FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (wallet_address, revision, profile_id, reviewed_name, verified)
    ON public.profile_identity_reviews TO service_role;

CREATE FUNCTION public.preserve_profile_identity_reviews()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
    RAISE EXCEPTION 'Append a new profile identity review to change a decision';
END;
$$;
REVOKE ALL ON FUNCTION public.preserve_profile_identity_reviews() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER preserve_profile_identity_reviews BEFORE UPDATE OR DELETE OR TRUNCATE ON public.profile_identity_reviews
    FOR EACH STATEMENT EXECUTE FUNCTION public.preserve_profile_identity_reviews();

CREATE VIEW public.reviewed_profile_content WITH (security_invoker=true) AS
SELECT p.*, COALESCE(NOT p.profile_content_hidden AND r.verified AND r.profile_id = p.id
    AND r.reviewed_name COLLATE "C" = p.username COLLATE "C", false) AS profile_identity_verified
FROM public.public_profile_content p
LEFT JOIN LATERAL (
    SELECT profile_id, reviewed_name, verified FROM public.profile_identity_reviews
    WHERE wallet_address = p.wallet_address ORDER BY revision DESC LIMIT 1
) r ON true;
REVOKE ALL ON public.reviewed_profile_content FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.reviewed_profile_content TO service_role;
COMMIT;
