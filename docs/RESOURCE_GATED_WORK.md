# ArtSoul Resource-Gated Work Plan

Updated: 2026-07-20

This document records work that remains required but cannot be activated or completed safely until its external resources are available. It is an operational plan subordinate to the [Canon Bible](canon/ARTSOUL_CANON_BIBLE_FULL.md) and the [durable backlog](BACKLOG.md); it does not amend architecture, economics, roles, or lifecycle rules.

## Operating Rule

ArtSoul may continue Phase A and Phase B work on the existing Base Sepolia, Vercel, Supabase, and indexer setup without adding new paid services. A missing budget does not delete or waive a requirement. Resource-gated work remains recorded with an explicit activation condition.

No agent or operator may reduce cost by:

- promoting the current testnet prototype contracts to mainnet;
- skipping the independent contract security review;
- combining ProtocolTreasury, EcosystemTreasury, deployer, keeper, or daily moderation authority into one hot wallet;
- enabling production passkey recovery before its final RP ID and Safe recovery path are verified;
- weakening RLS, write guards, moderation audit records, or multisig requirements;
- treating a grant application, expected reward, or uncommitted funding as available money.

Before any paid commitment, refresh the exact purchase, renewal, gas, audit, legal, and operating quotes. Roadmap estimates are not spending authorization.

## Resource-Gated Register

| ID | Required outcome | Canonical phase | Current state | Safe interim path | Activation/completion condition |
| --- | --- | --- | --- | --- | --- |
| RG-01 | Permanent DNS domain and redirect policy | C0 / C14 | Deferred; the Vercel production origin remains canonical for testnet | Continue on `artsoul.vercel.app`; do not present a temporary origin as the final WebAuthn RP ID | Founder-approved domain is funded, registered, renewable, connected to Vercel, HTTPS-verified, and documented |
| RG-02 | Project email for general, security, and copyright operations | C14 | Deferred until RG-01 | Use existing private operational contact channels; do not publish a mailbox that is not monitored | Domain exists and a monitored receive/reply path plus retention procedure are verified |
| RG-03 | Production activation of A8a moderation step-up | A8 | Engineering may proceed behind a disabled feature flag; final activation is deferred | Test only with non-production credentials on the current origin and expect re-enrolment | Final domain/RP ID is live; two founder passkeys are enrolled; the one-time bootstrap grant is audit-recorded; Safe-only founder recovery is configured and rehearsed; the flag is enabled through a reviewed deployment |
| RG-04 | Moderator onboarding and device step-up | A8 | Planned | Keep wallet addresses and role assignments out of public source; use test-only roles after the A8a data model exists | Each moderator has an active least-privilege role, an individually enrolled passkey, a 15-minute step-up session, revocation coverage, and an audit record |
| RG-05 | Base Sepolia Admin/Security Safe rehearsal | C0 / C13 | Deferred until independent signers and recovery handling are ready; no mainnet capital is required | Continue non-critical testnet engineering without claiming final admin topology | A 2-of-3 rehearsal Safe is configured with independent signers and grant, revoke, recovery, and signer-loss runbooks pass on Base Sepolia |
| RG-06 | Mainnet Safes and separated operational keys | C0 / D3 | Deferred; no mainnet wallet needs funding during Phase A | Design roles and tests without assigning final addresses | Dedicated ProtocolTreasury and EcosystemTreasury Safes, Admin/Security authority, deployer, and keeper are funded only as needed; signer custody and handover evidence are approved |
| RG-07 | Independent contract security review | C12 | Resource-gated and mandatory | Complete architecture, threat model, invariants, storage-layout review, and internal tests before requesting quotes | Review is funded and completed; every launch-blocking finding is resolved and re-verified |
| RG-08 | Final contract rehearsal and Base mainnet deployment gas | C13 / D3 | Deferred until final contracts and review are ready | Use Base Sepolia faucets and rehearsal deployments | A signed launch budget covers rehearsal, deployment, role handover, verification, smoke tests, and contingency; audited artifacts are the only deployable artifacts |
| RG-09 | Legal and privacy readiness | C14 | Resource-gated; exact entity and jurisdiction remain undecided | Keep the public testnet controlled and avoid claiming mainnet legal readiness | Founder/counsel approve the entity path, Terms, Privacy/GDPR, IP assignment, moderation contacts, and operating obligations |
| RG-10 | Sustainable production operations | C14 / D3 | Not yet funded as a mainnet service envelope | Continue measuring the existing testnet infrastructure and minimizing usage safely | A reviewed budget covers domain renewal, database/storage, indexer hosting, RPC fallback, monitoring, backups, incident response, and a defined operating runway |
| RG-11 | Project Basename or other optional brand protection | C0 | Optional and non-blocking | Continue using wallet addresses and the project profile; do not substitute an onchain name for DNS/email | Register only when funded or legitimately discounted, preferably to the approved project ownership/Safe path |

## A8a Decisions Preserved

The founder approved the following implementation constraints on 2026-07-20:

- moderation step-up sessions last 15 minutes;
- the founder enrols two independent passkeys;
- initial authority uses one one-time, auditable bootstrap grant;
- founder recovery is authorized only through the configured Safe path;
- A8a is developed behind a disabled feature flag until the final production domain is connected.

These constraints harden access to moderation. They do not make X or Discord handles authentication factors, do not grant irreversible authority to an individual moderator, and do not replace multisig approval for critical actions.

## Funding Evidence Rule

Funding is available only when it is received and usable, not when an application is submitted. Grants, rewards, sponsorships, credits, revenue, and explicit founder allocations may unlock rows above, but each unlocked row still requires its technical and security acceptance evidence.

Until then, engineering should prioritize the remaining zero-incremental-spend Phase A work, recruit controlled Base Sepolia testers, collect reproducible evidence, and avoid premature mainnet commitments.
