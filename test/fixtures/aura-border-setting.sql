BEGIN;
DO $$
DECLARE actor text := '0x' || repeat('ca', 20); v bigint; s record; role_name text;
BEGIN
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
        ASSERT NOT has_table_privilege(role_name,'artsoul_private.aura_border_history','SELECT,INSERT,UPDATE,DELETE,TRUNCATE');
        ASSERT has_function_privilege(role_name,'public.set_aura_border_setting(text,bigint,boolean,integer)','EXECUTE')
            = (role_name = 'service_role');
        ASSERT has_function_privilege(role_name,'public.read_aura_border_setting()','EXECUTE') = (role_name = 'service_role');
        ASSERT has_function_privilege(role_name,'public.manage_aura_border_setting(text,bigint,text,bigint,boolean,integer)','EXECUTE')
            = (role_name = 'service_role');
    END LOOP;
    INSERT INTO public.artsoul_staff_roles(wallet_address,role) VALUES (actor,'admin') RETURNING authorization_version INTO v;
    SELECT * INTO s FROM public.read_aura_border_setting(); ASSERT s.revision = 0 AND NOT s.enabled;
    SELECT * INTO s FROM public.set_aura_border_setting(actor,v,true,0); ASSERT s.revision = 1 AND s.enabled;
    SELECT * INTO s FROM public.set_aura_border_setting(actor,v,true,1); ASSERT s.revision = 1 AND s.enabled;
    BEGIN
        PERFORM public.set_aura_border_setting(actor,v,false,0);
        RAISE EXCEPTION 'Stale revision was accepted';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'AURA_REVISION_CONFLICT' THEN RAISE; END IF; END;
    BEGIN
        PERFORM public.set_aura_border_setting(actor,v+1,false,1);
        RAISE EXCEPTION 'Stale authority was accepted';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'AURA_ADMIN_REQUIRED' THEN RAISE; END IF; END;
    SELECT * INTO s FROM public.set_aura_border_setting(actor,v,false,1); ASSERT s.revision = 2 AND NOT s.enabled;
    UPDATE public.artsoul_staff_roles SET role='moderator' WHERE wallet_address=actor;
    BEGIN
        PERFORM public.set_aura_border_setting(actor,v,true,2);
        RAISE EXCEPTION 'Moderation role was accepted';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'AURA_ADMIN_REQUIRED' THEN RAISE; END IF; END;
    ASSERT (SELECT count(*)=2 AND bool_and(actor_wallet=actor AND authorization_version=v)
        FROM artsoul_private.aura_border_history);
END $$;
DO $$
DECLARE member text := '0x'||repeat('21',20); other_member text := '0x'||repeat('41',20);
    outsider text := '0x'||repeat('31',20); site text := 'https://artsoul.example'; v bigint; ov bigint; s record; case_row record;
BEGIN
    INSERT INTO public.artsoul_staff_authority_policy(singleton,version,origin,chain_id,wallet_a,wallet_b)
    VALUES(true,3,site,84532,member,other_member)
    ON CONFLICT (singleton) DO UPDATE SET version=3,origin=excluded.origin,chain_id=84532,wallet_a=excluded.wallet_a,wallet_b=excluded.wallet_b;
    INSERT INTO public.artsoul_staff_roles(wallet_address,role) VALUES(member,'team') RETURNING authorization_version INTO v;
    INSERT INTO public.artsoul_staff_roles(wallet_address,role) VALUES(outsider,'team') RETURNING authorization_version INTO ov;
    SELECT * INTO s FROM public.manage_aura_border_setting(member,v,site,3,NULL,NULL); ASSERT s.revision=2 AND NOT s.enabled;
    SELECT * INTO s FROM public.manage_aura_border_setting(member,v,site,3,true,2); ASSERT s.revision=3 AND s.enabled;
    ASSERT (SELECT count(*)=1 FROM artsoul_private.aura_border_history
        WHERE revision=3 AND actor_wallet=member AND authorization_version=v AND authority_policy_version=3);
    FOR case_row IN SELECT * FROM (VALUES(member,v,site,2),(member,v+1,site,3),(member,v,'https://wrong.example',3),
        (outsider,ov,site,3),(member,v,NULL::text,NULL::integer)) cases(wallet,role_version,origin,policy_version) LOOP
        BEGIN
            PERFORM public.manage_aura_border_setting(case_row.wallet,case_row.role_version,case_row.origin,case_row.policy_version,false,3);
            RAISE EXCEPTION 'Invalid authority accepted';
        EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'AURA_ADMIN_REQUIRED' THEN RAISE; END IF; END;
    END LOOP;
    BEGIN
        PERFORM public.manage_aura_border_setting(member,v,site,3,false,2);
        RAISE EXCEPTION 'Replayed revision accepted';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'AURA_REVISION_CONFLICT' THEN RAISE; END IF; END;
    UPDATE public.artsoul_staff_authority_policy SET wallet_a=outsider,version=4 WHERE singleton;
    BEGIN
        PERFORM public.manage_aura_border_setting(member,v,site,4,NULL,NULL);
        RAISE EXCEPTION 'Removed team authority accepted';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'AURA_ADMIN_REQUIRED' THEN RAISE; END IF; END;
    UPDATE public.artsoul_staff_roles SET role='moderator' WHERE wallet_address=outsider RETURNING authorization_version INTO ov;
    BEGIN
        PERFORM public.manage_aura_border_setting(outsider,ov,site,4,false,3);
        RAISE EXCEPTION 'Moderator authority accepted';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'AURA_ADMIN_REQUIRED' THEN RAISE; END IF; END;
    ASSERT (SELECT count(*)=3 FROM artsoul_private.aura_border_history);
END $$;
ROLLBACK;
