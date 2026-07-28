# ArtSoul Controlled Beta Entry

Last reviewed: 2026-07-28

Status: **NO-GO — entry materials are prepared, but invitations must wait until
the remaining Phase A acceptance gates pass.**

This is the operating source of truth for entering the invite-only ArtSoul
controlled beta. It does not approve a beta window by itself. The Canon Bible
and the canonical Phase A backlog remain authoritative.

## 1. Scope and safety

The controlled beta validates the complete ArtSoul testnet lifecycle with a
small, trusted cohort:

1. publish an unminted artwork;
2. create an auction;
3. place a bid;
4. end the auction;
5. settle and lazily mint the NFT;
6. list and purchase the minted NFT on resale.

Only Base Sepolia (`84532`) is an active product testnet. Historical Ethereum
Sepolia records may remain readable, but writes and network selection are
disabled for them. Base mainnet and Ethereum mainnet may be present in wallet
negotiation for compatibility; they are not active product networks.

Testers must:

- use testnet ETH only;
- use a dedicated test wallet with no valuable mainnet assets;
- never share a seed phrase, private key, session topic, authenticated metrics
  credential, RPC URL containing a key, database URL, or service key;
- use only media they own or are authorized to publish;
- understand that testnet activity, NFTs, rankings, and snapshots have no
  financial value and create no Genesis or mainnet entitlement.

## 2. Entry checklist for testers

Use the detailed [tester guide](TESTER_GUIDE.md) during a test window. A tester
should complete and report one assigned journey rather than performing
uncoordinated transactions.

### Connection and recovery

- [ ] Open the production origin supplied in the invitation.
- [ ] Connect a supported wallet and confirm the displayed address.
- [ ] Complete the wallet signature when a protected action requests it.
- [ ] Confirm an unsupported network can be connected for browsing but that a
      write requires Base Sepolia.
- [ ] Refresh the page and confirm the live session restores without a second
      connection or a header flicker.
- [ ] Background the browser, return from the wallet, and confirm the same tab
      recovers.
- [ ] Disconnect and confirm the session does not reappear after reload.

### Protocol lifecycle

- [ ] Creator publishes an original test artwork.
- [ ] Creator starts a 24, 36, or 48 hour auction.
- [ ] A different wallet places a valid bid.
- [ ] The auction is ended after its deadline.
- [ ] The winning wallet settles within 24 hours.
- [ ] The NFT exists only after successful settlement.
- [ ] Creator, First Collector, Owner, and the indexed timeline are correct.
- [ ] Current owner lists the NFT at or above its canonical floor.
- [ ] A different wallet purchases the resale listing.
- [ ] Ownership and the indexed timeline update after resale.

### Read-only and failure behavior

- [ ] Legacy Ethereum Sepolia artwork remains readable with every write action
      disabled.
- [ ] A disconnected visitor can browse without repeated wallet prompts.
- [ ] A rejected signature or transaction returns the UI to a usable state.
- [ ] Navigation, refresh, back navigation, and mobile app switching do not
      duplicate transactions or lose confirmed state.
- [ ] Report any stale, contradictory, or mainnet-ready wording.

## 3. Support and issue intake

Use the following path during a controlled-beta window:

1. **Operational help:** reply in the private channel through which the tester
   received the invitation. The operator may move a reproducible defect to
   GitHub after removing personal or sensitive details.
2. **Reproducible product defect:** open a
   [controlled-beta bug report](https://github.com/maysonkiller/ArtSoul-Protocol/issues/new?template=controlled-beta-bug.yml).
3. **Security, privacy, copyright, or suspected credential exposure:** stop the
   affected flow and contact the operator privately through the invitation
   channel. Do not create a public issue or attach secrets.
4. **P1 incident:** stop the affected test journey immediately. The operator
   pauses the window until the issue is triaged and an explicit resume decision
   is recorded.

The public [community channel](https://t.me/ArtSoulCommunity) may be used for
general testnet discussion, but it is not the incident or security-reporting
channel.

## 4. Severity

| Priority | Meaning | Examples | Required response |
| --- | --- | --- | --- |
| P1 | Safety, authorization, economic truth, or core-lifecycle blocker | wrong-chain write, unauthorized action, incorrect ownership or money flow, stuck test funds with no recovery, reproducible inability to connect/publish/bid/settle in a supported environment | Stop the affected journey; no beta GO while open |
| P2 | Important defect with a safe workaround | one supported browser fails while another works, stale projection that recovers, degraded moderation workflow | Triage before the next window and record the workaround |
| P3 | Non-blocking polish or clarity problem | copy, spacing, minor visual inconsistency | Track for the relevant UI backlog item |

Priority is confirmed during triage; a reporter's initial choice is evidence,
not the final classification.

## 5. Known prototype deviations

The controlled beta validates behavior and usability of a public-testnet
prototype. It is not acceptance of these deviations for mainnet:

| Area | Deployed testnet prototype | Required before mainnet |
| --- | --- | --- |
| Resale split | 90% seller / 7.5% creator / 2.5% protocol; no Ecosystem Pool split | Frozen 92.5% / 5.5% / 1% / 1% split |
| NFT royalty | 7.5% | 5.5%, aligned with frozen resale economics |
| Marketplace approvals | Standard ERC-721 approvals | Restricted to approved marketplaces |
| Project NFT | Transferable 100-supply prototype | Retired; it is not Genesis and is never migrated |
| No-bid lifecycle | Automatic no-bid transition is not implemented | Permissionless, automation-compatible mainnet transition |
| Moderation step-up | Implementation and migrations may remain disabled behind resource gates | Final domain, reviewed WebAuthn RP ID, founder passkeys and Safe recovery before activation |
| Domain and support email | Temporary Vercel origin; no final project mailbox | Funded permanent domain and monitored copyright/security contact before mainnet readiness |
| Historical chain | Ethereum Sepolia data can remain readable | No active writes, selection, or migration of testnet ownership into mainnet |

Frozen primary and resale economics are not changed by this document.

## 6. Operator pre-window checklist

Record evidence links or command output in the decision record; do not mark an
item complete from memory.

- [ ] Target production commit is recorded and all required GitHub checks are
      green on that commit.
- [ ] Vercel production serves the target commit.
- [ ] Phase A security and migration acceptance is complete.
- [ ] Supported desktop and external-mobile wallet acceptance is complete,
      including SIWE, restore, disconnect, wrong-network recovery, and no stale
      session resurrection.
- [ ] A real wallet-signed publish-to-index projection smoke is complete.
- [ ] Indexer health is healthy at confirmation depth 3 with zero unresolved,
      failed, and dead event-processing records.
- [ ] Projection and provenance state coverage is complete.
- [ ] Lifecycle action gating is complete.
- [ ] Moderation/reporting has an operationally safe controlled-beta path or
      the window remains NO-GO.
- [ ] Infrastructure cost evidence and alerting acceptance is complete.
- [ ] Base commitment surfaces and stale-copy cleanup required by Phase A are
      accepted.
- [ ] The bug intake form opens and the operator can triage new reports.
- [ ] Every open issue was reviewed and there is no open P1.
- [ ] The tester cohort, assigned journeys, start time, stop time, and private
      support channel are recorded.
- [ ] Pause and rollback responsibilities are assigned.

## 7. Pause conditions

Pause the controlled-beta window when any of the following occurs:

- an unauthorized or wrong-chain write is observed;
- ownership, settlement, floor, royalty, or fee evidence disagrees with indexed
  on-chain truth;
- a supported wallet repeatedly cannot authenticate or recover its session;
- the indexer is unhealthy, loses leadership safety, or reports unresolved
  event failures;
- private data or a credential may have been exposed;
- a new P1 issue is opened;
- the operator cannot monitor or support the active window.

Pausing does not require a destructive database or contract action. Disable the
invitation window, communicate the stop to testers, preserve evidence, and use
the relevant runbook for the affected service.

## 8. Go / no-go decision record

Copy this section for each proposed window:

```text
Decision: GO / NO-GO
Decision timestamp (UTC):
Production commit:
Vercel deployment:
Operator:
Tester cohort:
Window start/end (UTC):
Phase A evidence:
Open P1 query/result:
Known P2 issues and workarounds:
Monitoring evidence:
Support channel confirmed:
Rollback/pause owner:
Decision notes:
```

GO is permitted only when every operator checklist item is evidenced and no P1
issue is open. Any missing evidence means NO-GO.
