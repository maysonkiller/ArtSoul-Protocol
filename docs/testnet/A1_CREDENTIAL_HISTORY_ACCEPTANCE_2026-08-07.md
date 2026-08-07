# A1 Credential Retirement and Repository-History Acceptance

Accepted: 2026-08-07

Scope: the final private, value-free operational evidence required to close
canonical A1 after the public mobile-authentication and upload-policy acceptance
recorded on 2026-08-04.

This record intentionally contains no API key, private key, signature, complete
wallet address, database password, provider URL containing credentials, or other
secret value.

## Accepted Evidence

- The tracked `.env.example` keeps the server-only Supabase credential, deployer
  keys, and metrics credential empty. The local `.env` is untracked and ignored.
- The local `SUPABASE_SERVICE_ROLE_KEY` was replaced through the authenticated
  Supabase CLI with the project's dedicated legacy server credential. A local
  decode check confirmed the JWT role is exactly `service_role`; the value was
  never printed or copied into Git.
- The previously mislabelled historical Supabase value decoded as the public
  `anon` role, not `service_role`. It did not provide privileged server access.
- The genuinely exposed secondary development key was retired from the local
  environment and from the Hetzner runtime. The operator's 2026-08-07 host check
  returned `SECOND_PRIVATE_KEY absent or empty`. The historical key is not the
  owner of the active Base Sepolia contracts.
- The current tracked tree produced zero findings under Gitleaks v8.30.1. The
  reachable-history review was completed without treating public client
  identifiers or masked examples as privileged credentials.
- GitHub Secret Scanning and push protection are enabled for the public
  repository. A 2026-08-07 API check returned zero open secret-scanning alerts.
- Production server-credential behavior remains evidenced by the accepted
  signed-upload path, while the upload route fails closed unless the configured
  JWT role is `service_role`.
- The latest read-only production RLS review found forced RLS on every public
  table, no client non-SELECT grants, no artwork write policy, one canonical
  public artwork SELECT policy, and no client-executable `SECURITY DEFINER`
  function.

## Repository-History Decision

The repository history is retained. Rewriting more than one thousand commits and
the active remote-branch graph would create disproportionate coordination and
provenance risk after the only genuine private-key finding had been retired and
the other historical JWT had been verified as the public `anon` credential.

Retention is conditional on the controls already in force: Secret Scanning,
push protection, zero open alerts, empty tracked secret placeholders, and no
reuse of the retired development key. This is the completed remediation decision,
not a claim that historical bytes were erased.

## Result

Canonical A1 is accepted. The public runtime evidence is recorded separately in
`A1_MOBILE_AUTH_UPLOAD_POLICY_ACCEPTANCE_2026-08-04.md`. No protocol economics,
contract behavior, storage layout, lifecycle rule, or product-network rule
changed as part of this acceptance.
