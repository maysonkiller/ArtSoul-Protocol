BEGIN;
DO $$
DECLARE
    applicant text := '0x'||repeat('1',40); reviewer text := '0x'||repeat('a1',20);
    member text := '0x'||repeat('b1',20); token text := '0x'||repeat('c1',20);
    site text := 'https://artsoul.example'; v bigint; tv bigint; av bigint; id bigint; collection_id bigint; r jsonb;
BEGIN
    INSERT INTO public.artsoul_staff_roles(wallet_address,role) VALUES (reviewer,'admin') RETURNING authorization_version INTO v;
    INSERT INTO public.artsoul_staff_roles(wallet_address,role) VALUES (member,'team') RETURNING authorization_version INTO tv;
    INSERT INTO public.artsoul_staff_roles(wallet_address,role) VALUES (applicant,'admin') RETURNING authorization_version INTO av;
    INSERT INTO public.artsoul_staff_authority_policy(singleton,version,origin,chain_id,wallet_a,wallet_b)
    VALUES(true,7,site,84532,reviewer,member) ON CONFLICT(singleton) DO UPDATE SET version=7,origin=site,chain_id=84532,wallet_a=reviewer,wallet_b=member;
    ASSERT NOT has_table_privilege('service_role','artsoul_private.identity_applications','SELECT,INSERT,UPDATE,DELETE');
    ASSERT NOT has_function_privilege('authenticated','public.request_identity_review(text,text,integer,text)','EXECUTE');
    ASSERT NOT has_function_privilege('anon','public.manage_identity_reviews(text,bigint,text,bigint,text,bigint,bigint,text,text)','EXECUTE');
    SET LOCAL ROLE service_role;
    id := public.request_identity_review(applicant,site,NULL,NULL);
    ASSERT public.request_identity_review(applicant,site,NULL,NULL)::bigint=id;
    r := public.manage_identity_reviews(member,tv,site,7,'pending',0,NULL,NULL,NULL);
    ASSERT jsonb_array_length(r)=1 AND r->0->>'wallet'=applicant;
    BEGIN
        PERFORM public.manage_identity_reviews(applicant,av,NULL,NULL,NULL,NULL,id,'approve','Public proof checked');
        RAISE EXCEPTION 'Expected independent review';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'SEPARATE_REVIEWER_REQUIRED' THEN RAISE; END IF; END;
    BEGIN
        PERFORM public.manage_identity_reviews(member,tv,site,6,NULL,NULL,id,'approve','Public proof checked');
        RAISE EXCEPTION 'Expected current policy';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'REVIEWER_REQUIRED' THEN RAISE; END IF; END;
    PERFORM public.manage_identity_reviews(member,tv,site,7,NULL,NULL,id,'approve','Public proof checked');
    ASSERT (SELECT profile_identity_verified FROM public.reviewed_profile_content WHERE wallet_address=applicant);
    PERFORM public.manage_identity_reviews(reviewer,v,NULL,NULL,NULL,NULL,id,'revoke','Official account changed');
    ASSERT (SELECT NOT profile_identity_verified FROM public.reviewed_profile_content WHERE wallet_address=applicant);
    collection_id := public.request_identity_review(applicant,site,84532,token);
    PERFORM public.manage_identity_reviews(reviewer,v,NULL,NULL,NULL,NULL,collection_id,'approve','Creator and chain checked');
    ASSERT (SELECT verified_collections @> jsonb_build_array(jsonb_build_object('chain_id',84532,'collection_address',token))
        FROM public.reviewed_profile_content WHERE wallet_address=applicant);
    ASSERT NOT public.has_collection_origin_review(8453,token,applicant);
    PERFORM public.manage_identity_reviews(member,tv,site,7,NULL,NULL,collection_id,'revoke','Public evidence withdrawn');
    ASSERT (SELECT verified_collections='[]'::jsonb FROM public.reviewed_profile_content WHERE wallet_address=applicant);
    id := public.request_identity_review(applicant,site,NULL,NULL);
    PERFORM public.manage_identity_reviews(reviewer,v,NULL,NULL,NULL,NULL,id,'decline','Public proof missing');
    ASSERT (SELECT count(*)=3 FROM public.identity_applicant_status(applicant));
    ASSERT NOT EXISTS (SELECT 1 FROM public.identity_applicant_status(member));
END $$;
ROLLBACK;
