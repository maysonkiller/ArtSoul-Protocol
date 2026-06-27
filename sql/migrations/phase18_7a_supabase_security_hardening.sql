-- Phase 18.7a: Supabase security hardening for public testnet.
-- This migration is intentionally grant/RLS-only. It does not modify protocol data,
-- contract data, economics, Genesis, or collection structures.

BEGIN;

-- Keep backend/indexer authority explicit for current and future objects.
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO service_role;

-- Client roles must never own sequence access or schema-wide write defaults.
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated;

DO $$
DECLARE
    service_role_only_tables TEXT[] := ARRAY[
        'admin_users',
        'audit_log',
        'audit_log_entries',
        'audit_log_hash_chain',
        'block_hashes',
        'contract_events',
        'distributed_locks',
        'event_processing_registry',
        'event_queue_spillover',
        'indexer_checkpoints',
        'indexer_errors',
        'indexer_state',
        'moderation_actions',
        'oauth_tokens',
        'outbox_events',
        'processed_events',
        'siwe_nonces',
        'artwork_social_signals'
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
    public_readonly_views TEXT[] := ARRAY[
        'v41_project_eligibility_signals'
    ];
    table_name TEXT;
BEGIN
    -- Internal tables are API/indexer controlled. No direct client read/write.
    FOREACH table_name IN ARRAY service_role_only_tables LOOP
        IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
            EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon, authenticated', table_name);
            EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role', table_name);
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
            EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
        END IF;
    END LOOP;

    -- Public/catalog/projection tables may be read directly, but not written by clients.
    FOREACH table_name IN ARRAY public_readonly_tables LOOP
        IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
            EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon, authenticated', table_name);
            EXECUTE format('GRANT SELECT ON TABLE public.%I TO anon, authenticated', table_name);
            EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role', table_name);
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
            EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
            EXECUTE format('DROP POLICY IF EXISTS public_read_all ON public.%I', table_name);
            EXECUTE format(
                'CREATE POLICY public_read_all ON public.%I FOR SELECT TO anon, authenticated USING (true)',
                table_name
            );
        END IF;
    END LOOP;

    -- Views cannot have table RLS; keep them explicitly read-only for client roles.
    FOREACH table_name IN ARRAY public_readonly_views LOOP
        IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
            EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon, authenticated', table_name);
            EXECUTE format('GRANT SELECT ON TABLE public.%I TO anon, authenticated', table_name);
            EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role', table_name);
        END IF;
    END LOOP;
END $$;

COMMIT;
