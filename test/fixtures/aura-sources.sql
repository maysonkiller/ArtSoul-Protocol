BEGIN;
DO $$
DECLARE actor text := '0x'||repeat('ca',20); v bigint; r record; core text := '0x'||repeat('31',20);
BEGIN
    ASSERT NOT has_table_privilege('service_role','artsoul_private.aura_sources','INSERT,UPDATE,DELETE');
    ASSERT NOT has_function_privilege('authenticated','public.manage_aura_sources(text,bigint,text,bigint,text,integer,text,text,text,integer,boolean,text)','EXECUTE');
    INSERT INTO public.artsoul_staff_roles(wallet_address,role) VALUES(actor,'admin') RETURNING authorization_version INTO v;
    SET LOCAL ROLE service_role;
    SELECT * INTO STRICT r FROM public.manage_aura_sources(actor,v,NULL,NULL,'platform',84532,core,actor,'',0,true,'Official artist wallet');
    ASSERT r.enabled AND r.revision=1 AND r.address=actor;
    ASSERT NOT EXISTS(SELECT 1 FROM public.aura_source_states('platform',8453,core,ARRAY[actor]));
    ASSERT NOT EXISTS(SELECT 1 FROM public.aura_source_states('platform',84532,actor,ARRAY[actor]));
    BEGIN
        PERFORM public.manage_aura_sources(actor,v,NULL,NULL,'platform',84532,core,actor,'',0,false,'Changed wallet');
        RAISE EXCEPTION 'Stale review accepted';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'SOURCE_CHANGED' THEN RAISE; END IF; END;
    PERFORM public.manage_aura_sources(actor,v,NULL,NULL,'platform',84532,core,actor,'',1,false,'Changed wallet');
    ASSERT (SELECT NOT enabled AND revision=2 FROM public.aura_source_states('platform',84532,core,ARRAY[actor]));
    BEGIN
        PERFORM public.manage_aura_sources(actor,v+1,NULL,NULL,'partner',8453,'',core,'',0,true,'Curated collection');
        RAISE EXCEPTION 'Stale reviewer accepted';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'AURA_ADMIN_REQUIRED' THEN RAISE; END IF; END;
    PERFORM public.manage_aura_sources(actor,v,NULL,NULL,'partner',8453,'',core,'',0,true,'Curated collection');
    ASSERT (SELECT enabled FROM public.aura_source_states('partner',8453,'',ARRAY[core]));
    ASSERT NOT EXISTS(SELECT 1 FROM public.aura_source_states('partner',84532,'',ARRAY[core]));
    BEGIN
        PERFORM public.manage_aura_sources(actor,v,NULL,NULL,'founder',84532,core,actor,'',0,true,'Old alternate review');
        RAISE EXCEPTION 'Stale alternate review accepted';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'SOURCE_CHANGED' THEN RAISE; END IF; END;
    PERFORM public.manage_aura_sources(actor,v,NULL,NULL,'founder',84532,core,actor,'',1,true,'Founder personal works');
    ASSERT (SELECT kind='founder' AND enabled FROM public.publisher_frame_states(84532,core,ARRAY[actor]));
    ASSERT NOT EXISTS (SELECT 1 FROM public.publisher_frame_states(8453,core,ARRAY[actor]));
    ASSERT NOT has_function_privilege('anon','public.publisher_frame_states(integer,text,text[])','EXECUTE');
    PERFORM public.manage_aura_sources(actor,v,NULL,NULL,'founder',84532,core,actor,'',2,false,'Retired personal wallet');
    ASSERT NOT (SELECT enabled FROM public.publisher_frame_states(84532,core,ARRAY[actor]));
    ASSERT NOT public.has_collection_origin_review(8453,core,actor);
END $$;
ROLLBACK;
