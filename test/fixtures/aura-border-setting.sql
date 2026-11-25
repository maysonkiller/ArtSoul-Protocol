BEGIN;
DO $$
DECLARE actor text := '0x' || repeat('ca', 20); v bigint; s record; role_name text;
BEGIN
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
        ASSERT NOT has_table_privilege(role_name,'artsoul_private.aura_border_history','SELECT,INSERT,UPDATE,DELETE,TRUNCATE');
        ASSERT has_function_privilege(role_name,'public.set_aura_border_setting(text,bigint,boolean,integer)','EXECUTE')
            = (role_name = 'service_role');
        ASSERT has_function_privilege(role_name,'public.read_aura_border_setting()','EXECUTE') = (role_name = 'service_role');
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
ROLLBACK;
