BEGIN;
CREATE SCHEMA IF NOT EXISTS artsoul_private;
CREATE TABLE artsoul_private.identity_applications (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    wallet text NOT NULL CHECK (wallet ~ '^0x[0-9a-f]{40}$'),
    profile_id uuid NOT NULL,
    profile_name text NOT NULL,
    chain_id integer,
    collection_address text,
    evidence text NOT NULL CHECK (length(evidence) BETWEEN 10 AND 512 AND evidence ~ '^https://'),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','revoked')),
    submitted_at timestamptz NOT NULL DEFAULT now(),
    decision_at timestamptz,
    decision_by text,
    decision_note text,
    grant_revision bigint,
    CHECK ((chain_id IS NULL AND collection_address IS NULL) OR
        (chain_id IS NOT NULL AND chain_id IN (8453,84532) AND collection_address IS NOT NULL
         AND collection_address ~ '^0x[0-9a-f]{40}$' AND collection_address <> '0x0000000000000000000000000000000000000000'))
);
CREATE UNIQUE INDEX identity_applications_pending ON artsoul_private.identity_applications
    (wallet, coalesce(chain_id,0), coalesce(collection_address,'')) WHERE status='pending';
CREATE INDEX identity_applications_queue ON artsoul_private.identity_applications(status,id);
CREATE INDEX identity_applications_wallet ON artsoul_private.identity_applications(wallet,id DESC);
ALTER TABLE artsoul_private.identity_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE artsoul_private.identity_applications FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE artsoul_private.identity_applications FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE artsoul_private.identity_applications_id_seq FROM PUBLIC,anon,authenticated,service_role;

CREATE INDEX collection_origin_creator ON public.collection_origin_reviews(creator_address,chain_id,collection_address);
CREATE OR REPLACE VIEW public.reviewed_profile_content WITH (security_invoker=true) AS
SELECT p.*, coalesce(NOT p.profile_content_hidden AND r.verified AND r.profile_id=p.id
    AND r.reviewed_name COLLATE "C"=p.username COLLATE "C",false) AS profile_identity_verified,
    CASE WHEN NOT p.profile_content_hidden THEN (
        SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.chain_id,c.collection_address),'[]'::jsonb) FROM (
            SELECT DISTINCT chain_id,collection_address FROM public.collection_origin_reviews t
            WHERE creator_address=p.wallet_address AND public.has_collection_origin_review(t.chain_id,t.collection_address,p.wallet_address)
            ORDER BY chain_id,collection_address LIMIT 100
        ) c
    ) ELSE '[]'::jsonb END AS verified_collections
FROM public.public_profile_content p
LEFT JOIN LATERAL (
    SELECT profile_id,reviewed_name,verified FROM public.profile_identity_reviews
    WHERE wallet_address=p.wallet_address ORDER BY revision DESC LIMIT 1
) r ON true;

CREATE FUNCTION public.request_identity_review(p_wallet text, p_evidence text, p_chain integer, p_collection text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p record; existing bigint;
BEGIN
    IF p_wallet IS NULL OR p_wallet !~ '^0x[0-9a-f]{40}$' OR p_evidence IS NULL OR
        length(p_evidence) NOT BETWEEN 10 AND 512 OR p_evidence !~ '^https://' OR
        (p_chain IS NULL) <> (p_collection IS NULL) OR p_chain NOT IN (8453,84532) OR
        p_collection !~ '^0x[0-9a-f]{40}$' OR p_collection = '0x0000000000000000000000000000000000000000'
        THEN RAISE EXCEPTION 'INVALID_APPLICATION'; END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('identity-request:' || p_wallet,0));
    SELECT id, username, profile_identity_verified INTO p FROM public.reviewed_profile_content
        WHERE wallet_address=p_wallet AND NOT profile_content_hidden AND btrim(username)<>'';
    IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_NAME_REQUIRED'; END IF;
    SELECT id INTO existing FROM artsoul_private.identity_applications WHERE wallet=p_wallet AND status='pending'
        AND chain_id IS NOT DISTINCT FROM p_chain AND collection_address IS NOT DISTINCT FROM p_collection;
    IF FOUND THEN RETURN existing::text; END IF;
    IF (p_chain IS NULL AND p.profile_identity_verified) OR (p_chain IS NOT NULL AND
        public.has_collection_origin_review(p_chain,p_collection,p_wallet)) THEN RAISE EXCEPTION 'ALREADY_VERIFIED'; END IF;
    IF (SELECT count(*) FROM artsoul_private.identity_applications WHERE wallet=p_wallet AND submitted_at >= now()-interval '24 hours') >= 5
        THEN RAISE EXCEPTION 'APPLICATION_LIMIT'; END IF;
    INSERT INTO artsoul_private.identity_applications(wallet,profile_id,profile_name,chain_id,collection_address,evidence)
        VALUES (p_wallet,p.id,p.username,p_chain,p_collection,p_evidence) RETURNING id INTO existing;
    RETURN existing::text;
END;
$$;

CREATE FUNCTION public.identity_applicant_status(p_wallet text)
RETURNS TABLE (id text, profile_name text, chain_id integer, collection_address text, status text, note text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT a.id::text,a.profile_name,a.chain_id,a.collection_address,a.status,a.decision_note FROM artsoul_private.identity_applications a
    WHERE a.wallet=p_wallet ORDER BY a.id DESC LIMIT 25;
$$;

CREATE FUNCTION public.identity_review_queue(p_status text,p_after bigint)
RETURNS TABLE (id text,wallet text,profile_name text,chain_id integer,collection_address text,evidence text,status text,submitted_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    SELECT a.id::text,a.wallet,a.profile_name,a.chain_id,a.collection_address,a.evidence,a.status,a.submitted_at
    FROM artsoul_private.identity_applications a WHERE a.status=p_status AND a.id>p_after ORDER BY a.id LIMIT 26;
$$;

CREATE FUNCTION public.manage_identity_reviews(p_actor text,p_version bigint,p_origin text,p_policy_version bigint,p_status text,p_after bigint,
    p_id bigint,p_action text,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE required_role text:='admin'; a artsoul_private.identity_applications%ROWTYPE; latest record; new_revision bigint; result jsonb;
BEGIN
    IF p_origin IS NOT NULL OR p_policy_version IS NOT NULL THEN
        PERFORM 1 FROM public.artsoul_staff_authority_policy s WHERE s.singleton AND s.chain_id=84532
            AND s.origin=p_origin AND s.version=p_policy_version AND p_actor IN(s.wallet_a,s.wallet_b) FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION 'REVIEWER_REQUIRED'; END IF;
        required_role:='team';
    END IF;
    PERFORM 1 FROM public.artsoul_staff_roles s WHERE s.wallet_address=p_actor AND s.active AND s.role=required_role
        AND s.authorization_version=p_version FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'REVIEWER_REQUIRED'; END IF;
    IF p_action IS NULL THEN
        IF p_status IS NULL OR p_status NOT IN ('pending','approved','declined','revoked') OR p_after IS NULL OR p_after<0 THEN RAISE EXCEPTION 'INVALID_APPLICATION'; END IF;
        SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id::bigint),'[]'::jsonb) INTO result
            FROM public.identity_review_queue(p_status,p_after) q;
        RETURN result;
    END IF;
    IF p_action NOT IN ('approve','decline','revoke') OR p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'INVALID_DECISION'; END IF;
    SELECT * INTO a FROM artsoul_private.identity_applications WHERE id=p_id FOR UPDATE;
    IF NOT FOUND OR (p_action='revoke' AND a.status<>'approved') OR (p_action<>'revoke' AND a.status<>'pending')
        THEN RAISE EXCEPTION 'APPLICATION_CHANGED'; END IF;
    IF a.wallet=p_actor THEN RAISE EXCEPTION 'SEPARATE_REVIEWER_REQUIRED'; END IF;
    IF p_action='approve' AND NOT EXISTS (SELECT 1 FROM public.public_profile_content p WHERE p.wallet_address=a.wallet AND
        p.id=a.profile_id AND NOT p.profile_content_hidden AND p.username COLLATE "C"=a.profile_name COLLATE "C")
        THEN RAISE EXCEPTION 'PROFILE_CHANGED'; END IF;
    IF p_action IN ('approve','revoke') THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(coalesce('collection:' || a.chain_id || ':' || a.collection_address,'profile:' || a.wallet),0));
        IF a.chain_id IS NULL THEN
            SELECT revision,verified INTO latest FROM public.profile_identity_reviews WHERE wallet_address=a.wallet ORDER BY revision DESC LIMIT 1;
        ELSE
            SELECT revision,verified INTO latest FROM public.collection_origin_reviews WHERE chain_id=a.chain_id AND collection_address=a.collection_address ORDER BY revision DESC LIMIT 1;
        END IF;
        IF p_action='revoke' AND (latest.revision IS DISTINCT FROM a.grant_revision OR latest.verified IS DISTINCT FROM true)
            THEN RAISE EXCEPTION 'APPLICATION_CHANGED'; END IF;
        IF p_action='approve' AND latest.verified THEN RAISE EXCEPTION 'ALREADY_VERIFIED'; END IF;
        new_revision:=coalesce(latest.revision,0)+1;
        IF a.chain_id IS NULL THEN
            INSERT INTO public.profile_identity_reviews(wallet_address,revision,profile_id,reviewed_name,verified,review_id,reviewer_wallet,evidence_ref,reason)
                VALUES (a.wallet,new_revision,a.profile_id,a.profile_name,p_action='approve',gen_random_uuid(),p_actor,a.evidence,btrim(p_note));
        ELSE
            INSERT INTO public.collection_origin_reviews(chain_id,collection_address,revision,creator_address,verified,review_id,reviewer_wallet,evidence_ref,reason)
                VALUES (a.chain_id,a.collection_address,new_revision,a.wallet,p_action='approve',gen_random_uuid(),p_actor,a.evidence,btrim(p_note));
        END IF;
    END IF;
    UPDATE artsoul_private.identity_applications SET status=CASE p_action WHEN 'approve' THEN 'approved' WHEN 'revoke' THEN 'revoked' ELSE 'declined' END,
        decision_at=now(),decision_by=p_actor,decision_note=btrim(p_note),grant_revision=coalesce(new_revision,grant_revision) WHERE id=a.id;
    RETURN jsonb_build_object('id',a.id::text,'action',p_action);
END;
$$;
REVOKE ALL ON FUNCTION public.identity_review_queue(text,bigint) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.request_identity_review(text,text,integer,text),public.identity_applicant_status(text),
    public.manage_identity_reviews(text,bigint,text,bigint,text,bigint,bigint,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.request_identity_review(text,text,integer,text),public.identity_applicant_status(text),
    public.manage_identity_reviews(text,bigint,text,bigint,text,bigint,bigint,text,text) TO service_role;
COMMIT;
