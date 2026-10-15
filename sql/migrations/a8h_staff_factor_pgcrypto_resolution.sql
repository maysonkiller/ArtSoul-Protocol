-- Supabase can install pgcrypto in extensions while local PostgreSQL uses public.
-- Qualify the three calls without broadening a SECURITY DEFINER search_path or
-- changing any enrollment, authorization, grant or factor record.
BEGIN;
DO $repair$
DECLARE
    v_schema NAME;
    v_definition TEXT;
    v_call RECORD;
    v_qualified TEXT;
BEGIN
    SELECT n.nspname INTO STRICT v_schema
    FROM pg_catalog.pg_extension e
    JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace
    WHERE e.extname='pgcrypto';
    FOR v_call IN SELECT * FROM (VALUES
        ('public.a8g_begin_totp_setup(text,uuid,uuid,jsonb)', 'gen_random_bytes(32)'),
        ('public.a8e_begin_totp_attempt(text,uuid,text)', 'digest(v_factor.encrypted_secret::TEXT,''sha256'')'),
        ('public.a8e_complete_totp_attempt(text,uuid,bigint)', 'digest(v_factor.encrypted_secret::TEXT,''sha256'')')
    ) AS calls(signature,expression) LOOP
        SELECT pg_catalog.pg_get_functiondef(v_call.signature::regprocedure) INTO STRICT v_definition;
        v_qualified := pg_catalog.format('%I.%s',v_schema,v_call.expression);
        -- Test the qualified form first: the unqualified text is its suffix.
        IF pg_catalog.strpos(v_definition,v_qualified)>0 THEN
            CONTINUE;
        END IF;
        IF (pg_catalog.length(v_definition)-pg_catalog.length(pg_catalog.replace(v_definition,v_call.expression,'')))
            <>pg_catalog.length(v_call.expression) THEN
            RAISE EXCEPTION 'UNEXPECTED_CRYPTO_CALLS';
        END IF;
        EXECUTE pg_catalog.replace(v_definition,v_call.expression,v_qualified);
    END LOOP;
END;
$repair$;
COMMIT;
