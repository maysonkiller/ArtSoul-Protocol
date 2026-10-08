# Admin, Moderation, And Copyright Canon

## Moderation Model

ArtSoul uses a complaint-driven notice-and-takedown model.

Required public surfaces:

- Report button on each artwork.
- Report form with clear reason categories.
- Review queue for moderators.
- Hide and unhide actions.
- Audit log for moderation changes.
- User notifications where relevant.

## Copyright

A valid copyright claim may hide the reported work while it is reviewed. Dispute and restoration paths must exist.

Do not build a self-hosted content fingerprinting system for this phase. A cheap upload flag can ride along the AI valuation path if the existing provider supports it.

## Moderator Access

The simplified moderation model supersedes the historical social-factor list.
Staff access uses the authenticated wallet, an active least-privilege staff role,
and the configured passkey step-up. X/Discord handles are not authentication
factors and a public profile link never grants staff rights.

Staff passkey enrollment, verification and key management belong in the Admin
panel, reached through the account menu after server-confirmed staff discovery.
The verification dialog explains the required steps; credential controls do not
occupy public artwork layouts. Setup may be available before the separately
gated review queue is enabled. Moving these controls does not grant a role,
waive passkey verification or complete the real-device acceptance ceremony.

First-enrollment amendment, 2026-10-03: the authenticated wallet with an active
staff role may explicitly select "Set up passkey" without entering a code only
when a live, unused, independently issued and audited bootstrap approval already
exists for that exact wallet. The server binds the WebAuthn challenge to that
grant and consumes both atomically. It never issues or renews approval from this
action. Existing or historical keys and an established bootstrap deny this path.
Additional-device and Safe recovery enrollment retain their one-time tokens and
existing authorization. A verified staff user may explicitly add another key via
the native chooser using the existing self-grant token in browser memory; manual
transfer remains available for a separate browser or recovery. This removes
separate code possession for the first
approved bootstrap only; it does not add staff rights or waive native user
verification, two independent founder keys, or Safe-only recovery.

The founder authorized real passkey enrollment and the operator recovery ceremony
now under `CHANGELOG_2026-10-03_PHASE_A_ACTIVATION.md`, superseding the September 29
deferral to mainnet preparation.
Live activation still requires the configured authorization and recovery gates;
isolated tests do not satisfy a real ceremony.

Critical or irreversible actions require multisig approval. Social logins alone are never enough for critical admin actions.

## October 7 authority and verification direction

Approved direction, not an implemented or activated authority system:

- Ordinary report decisions belong to assigned moderators. Future AI may
  recommend a decision; a human moderator confirms it.
- Staff role grants/revocations, critical configuration changes and transfers of
  administration require BOTH current authority wallets. Neither wallet alone
  may assign a replacement or bypass this rule. Authority rotation is approved
  by the current pair and recorded before the replacement policy takes effect.
- Moderator login should offer an authenticator app or a passkey/security key.
  Authenticator-app support is not implemented by the code-free passkey setup.
  Email and social connections do not replace the required authority signatures.
- The existing 2-of-3 rehearsal Safe is historical recovery evidence; it does
  not enforce this newly approved mandatory-pair policy. No live Safe, role or
  recovery configuration is changed by this amendment. Deployment, atomic role
  changes, factor provisioning and real acceptance remain separate gates.

The earlier independent founder-key activation requirement remains in effect
until the authenticator-app rollout explicitly reconciles its recovery policy.
Losing either required authority key cannot be solved by unilateral approval.

October 8 clarification: application role changes and authority rotation use
gasless signatures from BOTH current designated wallets. Do not deploy a new
Safe for application roles. Each signed request must bind the exact action,
target, current authority version, domain, nonce and expiry, with atomic
consumption and an audit record. The current pair approves its replacement.
This does not transfer on-chain contract ownership, alter the existing Safe or
grant AI permission to issue staff roles. Contract/fund operations retain their
separately configured multisig controls. This is approved direction; the role
workflow and authenticator-app rollout still require implementation and testing.

Collection verification direction: a mark records a reviewed relationship
between a creator and collection, with a durable decision and revocation path.
There is no sales-volume threshold. It is not a guarantee of quality or value
and does not change Trust, price, floor, fees or ownership. Render it as an
overlay on collection media only when an authoritative verification exists;
profile text, collection metadata or a creator's own claim cannot grant it.
The verification registry and its approved administration are not implemented
by this documentation change.

## Public Repository Boundary

Operational abuse heuristics, private anti-sybil checks, and escalation playbooks should not be published in this repository.
