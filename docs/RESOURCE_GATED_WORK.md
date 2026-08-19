# ArtSoul Resource-Gated Work Plan

Updated: 2026-08-19

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
| RG-01 | Permanent DNS domain and redirect policy | C0 / C14 | The apex and `www` are attached to Vercel. On 2026-08-08 the apex, public APIs and social image returned `200` over HTTPS, `www` returned a permanent `308` to the apex, canonical metadata was live, and `artsoul.vercel.app` remained available as the bounded rollback origin. Apex-origin wallet/SIWE and social-link return smokes remain to be recorded before this row is complete. | Keep `artsoul.vercel.app` as a temporary allowed rollback origin during the cutover; keep A8 passkey/admin/reporting flags disabled until the remaining apex-origin smokes and RG-03 recovery gates pass | Record desktop and iPhone wallet connect/restore/SIWE/disconnect plus Discord and X linking returning to the apex using the fill-in form [`testnet/RG01_APEX_ORIGIN_SMOKE_CHECKLIST.md`](testnet/RG01_APEX_ORIGIN_SMOKE_CHECKLIST.md), then remove temporary compatibility only in a later reviewed change |
| RG-02 | Project email for general, security, and copyright operations | C14 | The permanent domain is live; a monitored project mailbox and retention procedure are not yet verified | Use existing private operational contact channels; do not publish a mailbox that is not monitored | A monitored receive/reply path for general, security, and copyright operations plus its retention procedure are verified |
| RG-03 | Production activation of A8a moderation step-up | A8 | The final domain and RP ID are known. A8d now contains a disabled Safe-only recovery foundation, additive migration, read-only verification and rollback/replay tests, but its migration/configuration and founder ceremony are unapplied/unrehearsed; no production founder passkeys/bootstrap evidence exists. A candidate rehearsal Safe now exists on Base Sepolia at version `1.4.1` with the canonical `CompatibilityFallbackHandler`, which supports the EIP-1271 path A8d verifies; see [`testnet/RG05_SAFE_MULTISIG_REHEARSAL_2026-08-16.md`](testnet/RG05_SAFE_MULTISIG_REHEARSAL_2026-08-16.md). That Safe is available to configure for a non-production ceremony rehearsal and does not by itself satisfy any A8d gate | Keep passkey, Protocol Admin and public reporting flags disabled; leave all Safe recovery variables unset; test only with non-production credentials | Apex-origin acceptance is recorded; ordered A8a/A8d migrations and verification are archived; two founder passkeys are enrolled; the one-time bootstrap grant is audit-recorded; Safe-only founder recovery succeeds and all mandatory denial cases are rehearsed against the configured Safe and two RPCs; the flag is enabled through a reviewed deployment |
| RG-04 | Moderator onboarding and device step-up | A8 | Planned | Keep wallet addresses and role assignments out of public source; use test-only roles after the A8a data model exists | Each moderator has an active least-privilege role, an individually enrolled passkey, a 15-minute step-up session, revocation coverage, and an audit record |
| RG-05 | Base Sepolia Admin/Security Safe rehearsal | C0 / C13 | Threshold and signer-loss gates satisfied on 2026-08-16 and independently verified on chain 2026-08-19. A 2-of-3 Safe v1.4.1 with three independently held signers executed all three signer pairs, including the pair that excludes the founder, and a `swapOwner` replacement removed an owner **without that owner's signature**, after which the original composition was restored. Live reads confirm 3 owners, threshold 2, nonce 5. Grant and revoke runbooks are not exercised. Evidence: [`testnet/RG05_SAFE_MULTISIG_REHEARSAL_2026-08-16.md`](testnet/RG05_SAFE_MULTISIG_REHEARSAL_2026-08-16.md) | Continue non-critical testnet engineering without claiming final admin topology; the rehearsal Safe carries no protocol role and is not a mainnet Safe candidate | Pass role grant and revoke runbooks on Base Sepolia once the A8 role data model is migrated. Signer addresses and role assignments stay out of public source per RG-04 |
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

The [`BASE_ECOSYSTEM_FUND_READINESS.md`](BASE_ECOSYSTEM_FUND_READINESS.md) plan records one potential founder-owned investment path. Its current status is `researched`, not submitted or funded. Preparation must not displace Phase A work, alter protocol scope, or represent testnet activity as mainnet traction.

Until then, engineering should prioritize the remaining zero-incremental-spend Phase A work, recruit controlled Base Sepolia testers, collect reproducible evidence, and avoid premature mainnet commitments.
