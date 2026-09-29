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

Real founder passkey enrollment and the operator recovery ceremony are scheduled
for mainnet preparation under `CHANGELOG_2026-09-29_TESTNET_ACCEPTANCE.md`.
Live activation still requires the configured authorization and recovery gates;
isolated tests do not satisfy a real ceremony.

Critical or irreversible actions require multisig approval. Social logins alone are never enough for critical admin actions.

## Public Repository Boundary

Operational abuse heuristics, private anti-sybil checks, and escalation playbooks should not be published in this repository.
