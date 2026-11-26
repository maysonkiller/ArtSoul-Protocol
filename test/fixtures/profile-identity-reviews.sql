DO $$
DECLARE
    wallet text := '0x' || repeat('1', 40);
    reviewer text := '0x' || repeat('3', 40);
    id uuid;
BEGIN
    SELECT p.id INTO STRICT id FROM public.public_profile_content p WHERE p.wallet_address = wallet;
    ASSERT (SELECT NOT profile_identity_verified FROM public.reviewed_profile_content WHERE wallet_address = wallet);
    INSERT INTO public.profile_identity_reviews (wallet_address, revision, profile_id, reviewed_name, verified, review_id, reviewer_wallet, evidence_ref, reason)
    VALUES (wallet, 1, id, 'Identity fixture', true, gen_random_uuid(), reviewer, 'private-fixture', 'Fixture evidence checked');
    SET LOCAL ROLE service_role;
    ASSERT (SELECT profile_identity_verified FROM public.reviewed_profile_content WHERE wallet_address = wallet);
    ASSERT NOT EXISTS (SELECT 1 FROM public.reviewed_profile_content WHERE wallet_address <> wallet AND profile_identity_verified);
    RESET ROLE;
    UPDATE public.profiles SET username = 'Renamed fixture' WHERE wallet_address = wallet;
    ASSERT (SELECT NOT profile_identity_verified FROM public.reviewed_profile_content WHERE wallet_address = wallet);
    UPDATE public.profiles SET username = 'Identity fixture' WHERE wallet_address = wallet;
    UPDATE public.profiles SET id = gen_random_uuid() WHERE wallet_address = wallet;
    ASSERT (SELECT NOT profile_identity_verified FROM public.reviewed_profile_content WHERE wallet_address = wallet);
    UPDATE public.profiles p SET id = (SELECT profile_id FROM public.profile_identity_reviews WHERE wallet_address = wallet AND revision = 1)
    WHERE p.wallet_address = wallet;
    INSERT INTO public.profile_identity_reviews (wallet_address, revision, profile_id, reviewed_name, verified, review_id, reviewer_wallet, evidence_ref, reason)
    VALUES (wallet, 2, id, 'Identity fixture', false, gen_random_uuid(), reviewer, 'private-fixture-2', 'Fixture review revoked');
    ASSERT (SELECT NOT profile_identity_verified FROM public.reviewed_profile_content WHERE wallet_address = wallet);
    ASSERT NOT has_column_privilege('service_role','public.profile_identity_reviews','evidence_ref','SELECT');
    ASSERT NOT has_column_privilege('service_role','public.profile_identity_reviews','reason','SELECT');
    ASSERT NOT has_table_privilege('service_role','public.profile_identity_reviews','INSERT,UPDATE,DELETE,TRUNCATE');
    ASSERT NOT has_table_privilege('anon','public.reviewed_profile_content','SELECT');
    ASSERT NOT has_table_privilege('authenticated','public.reviewed_profile_content','SELECT');
END;
$$;
