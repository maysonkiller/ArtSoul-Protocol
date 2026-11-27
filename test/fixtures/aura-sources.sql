BEGIN;
DO $$
DECLARE admin_wallet text := '0x'||repeat('a1',20); av bigint; site text := 'https://artsoul.example'; publisher text := '0x'||repeat('44',20); rh text := '0x'||repeat('a',64); actor text := '0x'||repeat('ca',20); v bigint; r record; core text := '0x'||repeat('31',20);
BEGIN
    ASSERT NOT has_table_privilege('service_role','artsoul_private.aura_sources','INSERT,UPDATE,DELETE');
    ASSERT NOT has_function_privilege('authenticated','public.manage_aura_sources(text,bigint,text,bigint,text,integer,text,text,text,integer,boolean,text)','EXECUTE');
    INSERT INTO public.artsoul_staff_roles(wallet_address,role) VALUES(actor,'team') RETURNING authorization_version INTO v;
    INSERT INTO public.artsoul_staff_roles(wallet_address,role) VALUES(admin_wallet,'admin') RETURNING authorization_version INTO av;
    INSERT INTO public.artsoul_staff_authority_policy(singleton,version,origin,chain_id,wallet_a,wallet_b)
      VALUES(true,7,site,84532,admin_wallet,actor) ON CONFLICT(singleton) DO UPDATE SET version=7,origin=site,chain_id=84532,wallet_a=admin_wallet,wallet_b=actor;
    SET LOCAL ROLE service_role;
    PERFORM public.manage_aura_sources(admin_wallet,av,NULL,NULL,'platform',84532,core,actor,'',NULL,NULL,NULL);
    BEGIN
        PERFORM public.manage_aura_sources(admin_wallet,av,NULL,NULL,'platform',84532,core,actor,'',0,true,'One staff source');
        RAISE EXCEPTION 'Ordinary Administrator granted a frame';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'FRAME_TEAM_REQUIRED' THEN RAISE; END IF; END;
    BEGIN
        PERFORM public.manage_aura_sources(admin_wallet,av,site,7,'platform',84532,core,actor,'',0,true,'Spoofed Team scope');
        RAISE EXCEPTION 'Governing Administrator granted a frame';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'AURA_ADMIN_REQUIRED' THEN RAISE; END IF; END;
    SELECT * INTO STRICT r FROM public.manage_aura_sources(actor,v,site,7,'platform',84532,core,actor,'',0,true,'Official artist wallet');
    ASSERT r.enabled AND r.revision=1 AND r.address=actor;
    ASSERT NOT EXISTS(SELECT 1 FROM public.aura_source_states('platform',8453,core,ARRAY[actor]));
    ASSERT NOT EXISTS(SELECT 1 FROM public.aura_source_states('platform',84532,actor,ARRAY[actor]));
    BEGIN
        PERFORM public.manage_aura_sources(actor,v,site,7,'platform',84532,core,actor,'',0,false,'Changed wallet');
        RAISE EXCEPTION 'Stale review accepted';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'SOURCE_CHANGED' THEN RAISE; END IF; END;
    PERFORM public.manage_aura_sources(actor,v,site,7,'platform',84532,core,actor,'',1,false,'Changed wallet');
    ASSERT (SELECT NOT enabled AND revision=2 FROM public.aura_source_states('platform',84532,core,ARRAY[actor]));
    BEGIN
        PERFORM public.manage_aura_sources(actor,v+1,site,7,'partner',8453,'',core,'',0,true,'Curated collection');
        RAISE EXCEPTION 'Stale reviewer accepted';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'AURA_ADMIN_REQUIRED' THEN RAISE; END IF; END;
    PERFORM public.manage_aura_sources(actor,v,site,7,'partner',8453,'',core,'',0,true,'Curated collection');
    ASSERT (SELECT enabled FROM public.aura_source_states('partner',8453,'',ARRAY[core]));
    ASSERT NOT EXISTS(SELECT 1 FROM public.aura_source_states('partner',84532,'',ARRAY[core]));
    BEGIN
        PERFORM public.manage_aura_sources(actor,v,site,7,'founder',84532,core,actor,'',0,true,'Old alternate review');
        RAISE EXCEPTION 'Stale alternate review accepted';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'SOURCE_CHANGED' THEN RAISE; END IF; END;
    PERFORM public.manage_aura_sources(actor,v,site,7,'founder',84532,core,actor,'',1,true,'Founder personal works');
    ASSERT (SELECT kind='founder' AND enabled FROM public.publisher_frame_states(84532,core,ARRAY[actor]));
    ASSERT NOT EXISTS (SELECT 1 FROM public.publisher_frame_states(8453,core,ARRAY[actor]));
    ASSERT NOT has_function_privilege('anon','public.publisher_frame_states(integer,text,text[])','EXECUTE');
    PERFORM public.manage_aura_sources(actor,v,site,7,'founder',84532,core,actor,'',2,false,'Retired personal wallet');
    ASSERT NOT (SELECT enabled FROM public.publisher_frame_states(84532,core,ARRAY[actor]));
    PERFORM public.manage_aura_sources(actor,v,site,7,'official_collection',8453,publisher,core,'',0,true,'Reviewed collection',rh);
    SELECT * INTO STRICT r FROM public.collection_frame_sources(8453,ARRAY[core]);
    ASSERT r.kind='official_collection' AND r.address=core AND r.issuer=publisher AND r.runtime_hash=rh;
    ASSERT NOT EXISTS(SELECT 1 FROM public.collection_frame_sources(84532,ARRAY[core]));
    BEGIN
        PERFORM public.manage_aura_sources(actor,v,site,7,'official_collection',8453,actor,core,'',0,true,'Conflicting original creator',rh);
        RAISE EXCEPTION 'Second official issuer accepted';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'SOURCE_CHANGED' THEN RAISE; END IF; END;
    PERFORM public.manage_aura_sources(actor,v,site,7,'official_collection',8453,publisher,core,'',1,false,'Withdrawn after review');
    SELECT * INTO STRICT r FROM public.collection_frame_sources(8453,ARRAY[core]);
    ASSERT r.kind='partner' AND r.issuer IS NULL AND r.runtime_hash IS NULL;
    BEGIN
        PERFORM public.manage_aura_sources(actor,v,site,7,'genesis',8453,'',core,'',0,true,'Unregistered Genesis contract');
        RAISE EXCEPTION 'Unregistered Genesis accepted';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'GENESIS_UNAVAILABLE' THEN RAISE; END IF; END;
    ASSERT NOT EXISTS (SELECT 1 FROM public.read_designated_wallet_genesis_frames(core,rh,actor,publisher,actor,ARRAY[1]::smallint[]));
    ASSERT NOT has_function_privilege('anon','public.collection_frame_sources(integer,text[])','EXECUTE');
    ASSERT NOT has_function_privilege('authenticated','public.manage_aura_sources(text,bigint,text,bigint,text,integer,text,text,text,integer,boolean,text,text)','EXECUTE');
    ASSERT NOT public.has_collection_origin_review(8453,core,actor);
END $$;
ROLLBACK;
