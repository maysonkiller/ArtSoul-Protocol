-- Run with psql -v ON_ERROR_STOP=1 against a disposable migrated database.
BEGIN;
DO $test$
DECLARE
    collection text := '0x' || repeat('a', 40);
    creator text := '0x' || repeat('b', 40);
    other_creator text := '0x' || repeat('c', 40);
    reviewer text := '0x' || repeat('f', 40);
    role_name text;
BEGIN
    ASSERT NOT public.has_collection_origin_review(8453, collection, creator);
    INSERT INTO public.collection_origin_reviews
        (chain_id, collection_address, revision, creator_address, verified, review_id, reviewer_wallet, evidence_ref, reason)
    VALUES (84532, collection, 1, creator, true, gen_random_uuid(), reviewer, 'test-evidence-A', 'Origin confirmed');
    ASSERT public.has_collection_origin_review(84532, upper(collection), upper(creator));
    ASSERT NOT public.has_collection_origin_review(8453, collection, creator);
    ASSERT NOT public.has_collection_origin_review(84532, collection, other_creator);
    ASSERT NOT public.has_collection_origin_review(84532, other_creator, creator);
    BEGIN
        INSERT INTO public.collection_origin_reviews
            (chain_id, collection_address, revision, creator_address, verified, review_id, reviewer_wallet, evidence_ref, reason)
        VALUES (84532, collection, 3, creator, false, gen_random_uuid(), reviewer, 'test-evidence-B', 'Out of order');
        RAISE EXCEPTION 'Missing predecessor was accepted';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO public.collection_origin_reviews
            (chain_id, collection_address, revision, creator_address, verified, review_id, reviewer_wallet, evidence_ref, reason)
        VALUES (84532, collection, 1, creator, false, gen_random_uuid(), reviewer, 'test-evidence-B', 'Stale review');
        RAISE EXCEPTION 'Conflicting revision was accepted';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    INSERT INTO public.collection_origin_reviews
        (chain_id, collection_address, revision, creator_address, verified, review_id, reviewer_wallet, evidence_ref, reason)
    VALUES (84532, collection, 2, creator, false, gen_random_uuid(), reviewer, 'test-evidence-B', 'Review revoked');
    ASSERT NOT public.has_collection_origin_review(84532, collection, creator);
    INSERT INTO public.collection_origin_reviews
        (chain_id, collection_address, revision, creator_address, verified, review_id, reviewer_wallet, evidence_ref, reason)
    VALUES (84532, collection, 3, other_creator, true, gen_random_uuid(), reviewer, 'test-evidence-C', 'Creator corrected');
    ASSERT NOT public.has_collection_origin_review(84532, collection, creator);
    ASSERT public.has_collection_origin_review(84532, collection, other_creator);
    ASSERT NOT public.has_collection_origin_review(84532, collection, NULL);
    ASSERT (SELECT count(*) = 3 FROM public.collection_origin_reviews WHERE chain_id = 84532 AND collection_address = collection);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
        ASSERT NOT has_table_privilege(role_name, 'public.collection_origin_reviews', 'INSERT,UPDATE,DELETE,TRUNCATE');
        ASSERT NOT has_column_privilege(role_name, 'public.collection_origin_reviews', 'evidence_ref', 'SELECT');
        ASSERT NOT has_column_privilege(role_name, 'public.collection_origin_reviews', 'reviewer_wallet', 'SELECT');
        ASSERT NOT has_column_privilege(role_name, 'public.collection_origin_reviews', 'reason', 'SELECT');
        ASSERT has_function_privilege(role_name, 'public.has_collection_origin_review(bigint,text,text)', 'EXECUTE') = (role_name = 'service_role');
    END LOOP;
    BEGIN
        DELETE FROM public.collection_origin_reviews WHERE chain_id = 84532 AND collection_address = collection;
        RAISE EXCEPTION 'Unexpected mutation' USING ERRCODE = 'check_violation';
    EXCEPTION WHEN raise_exception THEN NULL;
    END;
END;
$test$;
SET LOCAL ROLE service_role;
DO $test$
BEGIN
    ASSERT public.has_collection_origin_review(84532, '0x' || repeat('a', 40), '0x' || repeat('c', 40));
END;
$test$;
ROLLBACK;
