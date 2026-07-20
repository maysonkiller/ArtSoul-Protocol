-- Phase 18.7b: complete the Supabase public-schema security classification.
--
-- This migration supersedes security_hardening.sql and rls_wallet_fix.sql.
-- Active browser writes use authenticated ArtSoul API routes; direct Supabase
-- client access is read-only. Run the read-only verification report in
-- sql/verification/phase_a_security_verification.sql before applying this file.

BEGIN;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO service_role;

REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated;

DO $$
DECLARE
    service_role_only_tables TEXT[] := ARRAY[
        'admin_users',
        'ai_suggestions',
        'ai_worker_logs',
        'artsoul_schema_migrations',
        'artsoul_staff_auth_events',
        'artsoul_staff_enrollment_grants',
        'artsoul_staff_passkeys',
        'artsoul_staff_roles',
        'artsoul_webauthn_challenges',
        'artwork_moderation_log',
        'artwork_moderation_visibility',
        'artwork_social_signals',
        'audit_log',
        'audit_log_entries',
        'audit_log_hash_chain',
        'block_confirmations',
        'block_hashes',
        'contract_events',
        'distributed_locks',
        'event_processing_registry',
        'event_queue_spillover',
        'failed_ai_jobs',
        'failed_events',
        'indexed_auctions',
        'indexed_bids',
        'indexed_withdrawals',
        'indexer_checkpoints',
        'indexer_errors',
        'indexer_lag',
        'indexer_state',
        'moderation_actions',
        'oauth_tokens',
        'outbox_events',
        'processed_events',
        'queue_metrics',
        'queue_metrics_snapshot',
        'reorg_events',
        'retry_queue',
        'rpc_providers',
        'siwe_nonces',
        'system_flags',
        'system_locks',
        'system_logs',
        'tx_states'
    ];
    public_readonly_tables TEXT[] := ARRAY[
        'ai_valuations',
        'artworks',
        'auctions',
        'bids',
        'bids_history',
        'nft_ownership',
        'profiles',
        'secondary_sales',
        'token_balances',
        'token_stakes',
        'token_transactions',
        'users',
        'votes',
        'v41_artworks',
        'v41_auction_endings',
        'v41_auction_extensions',
        'v41_auctions',
        'v41_bid_withdrawals',
        'v41_bids',
        'v41_floor_history',
        'v41_genesis_holders',
        'v41_project_eligibility',
        'v41_resale_history',
        'v41_resale_listings',
        'v41_settlements',
        'v41_trust_signals'
    ];
    service_role_only_views TEXT[] := ARRAY[
        'ai_activity_stream',
        'queue_health',
        'system_health'
    ];
    public_readonly_views TEXT[] := ARRAY[
        'v41_project_eligibility_signals'
    ];
    object_name TEXT;
    policy_record RECORD;
BEGIN
    FOREACH object_name IN ARRAY service_role_only_tables LOOP
        IF to_regclass(format('public.%I', object_name)) IS NOT NULL THEN
            EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon, authenticated', object_name);
            EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role', object_name);
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', object_name);
            EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', object_name);

            FOR policy_record IN
                SELECT policyname
                FROM pg_policies
                WHERE schemaname = 'public' AND tablename = object_name
            LOOP
                EXECUTE format('DROP POLICY %I ON public.%I', policy_record.policyname, object_name);
            END LOOP;
        END IF;
    END LOOP;

    FOREACH object_name IN ARRAY public_readonly_tables LOOP
        IF to_regclass(format('public.%I', object_name)) IS NOT NULL THEN
            EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon, authenticated', object_name);
            EXECUTE format('GRANT SELECT ON TABLE public.%I TO anon, authenticated', object_name);
            EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role', object_name);
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', object_name);
            EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', object_name);

            FOR policy_record IN
                SELECT policyname
                FROM pg_policies
                WHERE schemaname = 'public' AND tablename = object_name
            LOOP
                EXECUTE format('DROP POLICY %I ON public.%I', policy_record.policyname, object_name);
            END LOOP;

            EXECUTE format(
                'CREATE POLICY artsoul_public_read ON public.%I FOR SELECT TO anon, authenticated USING (true)',
                object_name
            );
        END IF;
    END LOOP;

    FOREACH object_name IN ARRAY service_role_only_views LOOP
        IF to_regclass(format('public.%I', object_name)) IS NOT NULL THEN
            EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon, authenticated', object_name);
            EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role', object_name);
        END IF;
    END LOOP;

    FOREACH object_name IN ARRAY public_readonly_views LOOP
        IF to_regclass(format('public.%I', object_name)) IS NOT NULL THEN
            EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon, authenticated', object_name);
            EXECUTE format('GRANT SELECT ON TABLE public.%I TO anon, authenticated', object_name);
            EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role', object_name);
        END IF;
    END LOOP;
END $$;

COMMIT;
