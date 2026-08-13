# A8d Safe-Only Passkey Recovery Runbook

Status: implementation complete behind the existing disabled A8 passkey
feature flag. The A8d migration is unapplied, no Safe or RPC is configured in
production, and the founder recovery ceremony is not yet rehearsed. This file
does not authorize activation.

## 1. Security boundary

Lost-passkey recovery does **not** create a second moderation authority.
Recovery requires all of the following:

1. an existing SIWE session for the exact target wallet;
2. an active `artsoul_staff_roles` row for that wallet;
3. a short-lived, persisted, one-time recovery request;
4. a signature accepted by the configured Safe through EIP-1271 at the
   Safe's current owner threshold; and
5. identical verification through at least two explicitly configured RPC
   endpoints on the configured chain.

Success creates only one short-lived, single-use `additional` passkey
enrollment grant. It does not create a moderation session, add or change a
staff role, enroll a credential directly, or authorize a protocol action.
The raw grant token is returned once and never stored or logged.

Email, X, Discord, an EOA signature, a wallet supplied in the request body,
and a Safe supplied in the request body are never recovery factors.

## 2. Persisted evidence

Migration `sql/migrations/a8d_moderation_safe_recovery.sql` adds one forced-RLS,
service-role-only request table and one atomic SECURITY DEFINER RPC.

The request stores the exact human-readable statement and binds:

- request UUID;
- SIWE-authenticated target wallet;
- configured Safe address and chain;
- configured WebAuthn RP ID and origin;
- expiry; and
- the narrowly scoped action: one passkey enrollment grant.

Only the SHA-256 hash of the submitted Safe signature is retained in the audit
event. The signature itself and the raw enrollment token are not persisted.

## 3. Environment (do not configure before reviewed activation)

| Variable | Requirement |
| --- | --- |
| `ARTSOUL_MODERATION_SAFE_RECOVERY_ADDRESS` | Exact deployed Safe address. Never inferred from the request. |
| `ARTSOUL_MODERATION_SAFE_RECOVERY_CHAIN_ID` | Exact chain where that Safe is deployed. |
| `ARTSOUL_MODERATION_SAFE_RECOVERY_RPC_URLS` | At least two independent, comma-separated RPC endpoints. HTTPS is mandatory in production. |

The recovery route also requires the complete A8a WebAuthn configuration and
`ARTSOUL_MODERATION_PASSKEY_ENABLED=true`. Missing or inconsistent
configuration fails closed.

## 4. Ordered migration and verification

Do not run these steps from an ordinary development session.

1. Take and verify the current Supabase backup.
2. Apply `a8a_moderation_passkey_foundation.sql` first if it is not already
   recorded in the migration ledger.
3. Apply `a8d_moderation_safe_recovery.sql`.
4. Run the read-only
   `sql/verification/a8d_moderation_safe_recovery_verification.sql`.
5. Archive the verification output and record the migration in the ledger.

The verification must show forced RLS, no anon/authenticated table or RPC
access, no raw signature/token/private-key columns, the SECURITY DEFINER RPC
with a fixed `search_path`, and both recovery audit outcomes in the closed
event vocabulary.

## 5. Recovery ceremony

This ceremony must be rehearsed with non-production credentials before A8 is
enabled in production.

1. Establish SIWE for the existing active staff wallet.
2. POST `{ "action": "request" }` to
   `/api/moderation/passkey-recovery`.
3. Independently compare the returned wallet, Safe, chain, RP ID, origin and
   expiry with the expected configuration. Stop on any mismatch.
4. Sign the **exact returned message** with the configured Safe using the
   official Safe message-signing flow. Collect the Safe's currently required
   threshold and produce the encoded EIP-1271 signature bytes. Do not sign a
   paraphrase, screenshot, transaction, or different hash.
5. POST `{ "action": "complete", "request_id": "...", "signature": "0x..." }`
   from the same SIWE wallet session.
6. If both configured RPC endpoints accept the EIP-1271 signature, copy the
   returned one-time enrollment token immediately.
7. Use that token in the existing passkey registration flow before it expires.
8. Confirm `recovery_authorized`, `grant_issued`, `grant_consumed`, and
   `passkey_enrolled` evidence, then verify the new passkey on a fresh session.

The server uses the same message pre-hash as Safe Protocol Kit's
`hashSafeMessage` for a string, then asks the Safe's EIP-1271 handler to verify
the encoded threshold signature. Both the modern bytes32 and compatibility
bytes overloads are supported; activation must still be rehearsed against the
specific deployed Safe version and fallback handler.

Authoritative references:

- ERC-1271 specification: <https://eips.ethereum.org/EIPS/eip-1271>
- Safe Protocol Kit `isValidSignature` reference:
  <https://docs.safe.global/reference-sdk-protocol-kit/messages/isvalidsignature>
- Safe `CompatibilityFallbackHandler` source:
  <https://github.com/safe-fndn/safe-smart-account/blob/main/contracts/handler/CompatibilityFallbackHandler.sol>

## 6. Mandatory rehearsal failures

Record each expected denial without changing state:

- missing SIWE session;
- inactive or absent staff role;
- expired request;
- request replay;
- altered request message or configuration;
- wrong chain or undeployed Safe;
- one unavailable, wrong-chain, or disagreeing RPC endpoint;
- incomplete Safe threshold;
- EOA signature;
- oversized or malformed signature; and
- forced audit-write failure (transaction rollback).

Do not activate A8 until the successful ceremony and every denial above have
been recorded on the final RP ID/origin with the production-equivalent Safe
configuration.
