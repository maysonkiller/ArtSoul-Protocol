BEGIN;
DO $$
DECLARE site text:='https://artsoul.example'; actor text:='0x'||repeat('a1',20); issuer text:='0x'||repeat('aa',20);
    recipient text:='0x'||repeat('b1',20); safe text:='0x'||repeat('c1',20); hash text:='0x'||repeat('ab',32); v bigint;
BEGIN
    INSERT INTO public.artsoul_staff_roles(wallet_address,role) VALUES(actor,'team') RETURNING authorization_version INTO v;
    INSERT INTO public.artsoul_staff_authority_policy(singleton,version,origin,chain_id,wallet_a,wallet_b)
        VALUES(true,7,site,84532,actor,safe) ON CONFLICT(singleton) DO UPDATE SET version=7,origin=site,chain_id=84532,wallet_a=actor,wallet_b=safe;
    INSERT INTO artsoul_private.genesis_issuers VALUES (8453,issuer,hash,safe,recipient);
    INSERT INTO artsoul_private.genesis_grant_batches VALUES (8453,issuer,hash,100,hash,0,hash,hash,1);
    INSERT INTO artsoul_private.genesis_grants VALUES (8453,issuer,0,0,recipient,hash,hash,1,2,3);
    -- Model the dedicated mainnet index. Earlier migration fixtures include
    -- an unrelated chain; a mixed index must never count as mainnet evidence.
    DELETE FROM public.indexer_state WHERE chain_id IS DISTINCT FROM 8453;
    INSERT INTO public.indexer_state(chain_id,contract_address,last_indexed_block,last_confirmed_block,last_indexed_at,started_at)
        VALUES(8453,issuer,100,100,now(),now());
    SET LOCAL ROLE service_role;
    ASSERT public.read_profile_genesis_serial(issuer,hash,safe,recipient,recipient)=0,'fixture grant must be finalized on the dedicated chain';
    ASSERT NOT EXISTS(SELECT 1 FROM public.read_designated_wallet_genesis_frames(issuer,hash,safe,recipient,recipient,ARRAY[0]::smallint[]));
    PERFORM public.manage_aura_sources(actor,v,site,7,'genesis',8453,'',issuer,'',0,true,'Verified dedicated grant issuer');
    ASSERT (SELECT enabled FROM public.aura_source_states('genesis',8453,'',ARRAY[issuer])),'reviewed issuer missing';
    ASSERT (SELECT token_id=0 FROM public.read_designated_wallet_genesis_frames(issuer,hash,safe,recipient,recipient,ARRAY[0,201]::smallint[])),
        'expected exact designated Genesis token';
    ASSERT NOT EXISTS(SELECT 1 FROM public.read_designated_wallet_genesis_frames(issuer,hash,safe,recipient,actor,ARRAY[0]::smallint[]));
    ASSERT NOT EXISTS(SELECT 1 FROM public.read_designated_wallet_genesis_frames(issuer,'0x'||repeat('dd',32),safe,recipient,recipient,ARRAY[0]::smallint[]));
    PERFORM public.manage_aura_sources(actor,v,site,7,'genesis',8453,'',issuer,'',1,false,'Pause visual attribution');
    ASSERT NOT EXISTS(SELECT 1 FROM public.read_designated_wallet_genesis_frames(issuer,hash,safe,recipient,recipient,ARRAY[0]::smallint[]));
    ASSERT public.read_profile_genesis_serial(issuer,hash,safe,recipient,recipient)=0;
END;
$$;
ROLLBACK;
