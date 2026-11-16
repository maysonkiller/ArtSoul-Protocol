-- Preserve the existing historical eligibility projection and its public grants.
-- Reads must use the caller's table privileges and row-level security policies.
BEGIN;
ALTER VIEW public.v41_project_eligibility_signals SET (security_invoker = true);
COMMIT;
