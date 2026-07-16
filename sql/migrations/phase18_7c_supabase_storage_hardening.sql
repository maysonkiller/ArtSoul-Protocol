-- Phase 18.7c: harden Supabase Storage policies for the `artworks` bucket.
--
-- REVIEW-ONLY. This file is NOT applied automatically by any script in this
-- repository. Apply it manually in the Supabase SQL editor only after the
-- pre-change export in sql/verification/phase_a_security_verification.sql
-- (section 8) has been captured. See docs/security/MIGRATION_RUNBOOK.md.
--
-- WHY THIS MIGRATION EXISTS
-- The production `storage.objects` table for the `artworks` bucket carries
-- policies that were created by hand in the Supabase dashboard and are not
-- represented by any tracked SQL file. Phase 18.7b classified the public
-- schema but did not touch the `storage` schema. The read-only verification
-- observed, on the `artworks` bucket:
--   * three duplicate public SELECT policies (only one is needed); and
--   * direct anon/authenticated/public INSERT, UPDATE, and DELETE policies
--     that do NOT enforce per-wallet ownership or a wallet-scoped path -- they
--     only check the bucket and the authenticated role.
-- Those write policies let any authenticated client write, overwrite, or
-- delete objects in the bucket directly, bypassing the server's validation
-- (filename, MIME type, size, wallet-scoped path). The application does not
-- need them: the active upload path in src/api/routes/upload/file.js and
-- src/api/backend.js creates a short-lived, server-signed upload URL with the
-- Supabase service_role key. The service_role bypasses RLS, and the signed
-- upload token itself authorizes that single object write on the storage
-- server -- neither depends on a client-facing INSERT/UPDATE/DELETE policy.
-- Removing the direct write policies therefore does NOT break uploads; it
-- forces every write through the server. Public reads keep working because
-- the bucket is public and one canonical SELECT policy is retained.
--
-- SAFETY
--   * Storage bucket rows (storage.buckets) are not modified; the bucket stays
--     public and its limits are unchanged.
--   * No object data is moved or deleted.
--   * This transaction only removes storage.objects policies for the artworks
--     bucket and re-creates exactly one canonical public read policy.
--   * It does not touch policies for any other bucket.

BEGIN;

DO $$
DECLARE
    target_bucket CONSTANT TEXT := 'artworks';
    canonical_read_policy CONSTANT TEXT := 'artsoul_artworks_public_read';
    policy_record RECORD;
BEGIN
    -- 1. Remove the exact policies observed in production by name. These are
    --    idempotent: a name that is already gone is silently skipped.
    --    Public SELECT duplicates:
    DROP POLICY IF EXISTS "Anyone can view artworks" ON storage.objects;
    DROP POLICY IF EXISTS "Public Access for artworks" ON storage.objects;
    DROP POLICY IF EXISTS "Public can view" ON storage.objects;
    --    Direct client write policies (no real ownership/path enforcement):
    DROP POLICY IF EXISTS "Authenticated can upload to artworks" ON storage.objects;
    DROP POLICY IF EXISTS "Authenticated users can upload" ON storage.objects;
    DROP POLICY IF EXISTS "Authenticated users can upload to artworks" ON storage.objects;
    DROP POLICY IF EXISTS "Users can update own files in artworks" ON storage.objects;
    DROP POLICY IF EXISTS "Users can delete own files in artworks" ON storage.objects;

    -- 2. Defensive sweep: drop any remaining storage.objects policy that grants
    --    a WRITE (INSERT/UPDATE/DELETE/ALL) and references the artworks bucket,
    --    plus any SELECT policy referencing the artworks bucket EXCEPT the one
    --    canonical read policy we (re)create below. This catches undocumented
    --    siblings of the named policies above without touching other buckets.
    FOR policy_record IN
        SELECT policyname, cmd
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname <> canonical_read_policy
          AND (
                COALESCE(qual, '') ILIKE '%' || target_bucket || '%'
             OR COALESCE(with_check, '') ILIKE '%' || target_bucket || '%'
          )
          AND cmd IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL')
    LOOP
        EXECUTE format('DROP POLICY %I ON storage.objects', policy_record.policyname);
    END LOOP;

    -- 3. Retain exactly one canonical public SELECT policy for the bucket.
    --    Public buckets already serve downloads through the public object
    --    endpoint without consulting RLS, but a single explicit read policy
    --    keeps client listing/select of artworks objects working and documents
    --    intent. Recreate deterministically so re-running yields one policy.
    DROP POLICY IF EXISTS artsoul_artworks_public_read ON storage.objects;
    EXECUTE format(
        'CREATE POLICY %I ON storage.objects FOR SELECT TO public USING (bucket_id = %L)',
        canonical_read_policy,
        target_bucket
    );

    -- 4. No INSERT/UPDATE/DELETE policy is created. With RLS enabled and no
    --    permissive write policy, client roles (anon, authenticated) cannot
    --    write to storage.objects. The server keeps writing via service_role
    --    (RLS bypass) and via signed upload tokens, which are unaffected.
END $$;

COMMIT;

-- POST-APPLY EXPECTATION (see verification section 8):
--   For bucket_id = 'artworks' on storage.objects there is exactly one policy,
--   `artsoul_artworks_public_read`, cmd = SELECT. No INSERT/UPDATE/DELETE
--   policy references the artworks bucket. storage.buckets is unchanged.
