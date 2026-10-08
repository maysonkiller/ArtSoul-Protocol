# October 7: administration and verified collections

The founder approved the following direction while continuing Phase A:

| Area | Previous accepted implementation | Approved next behavior | Implementation status |
| --- | --- | --- | --- |
| Ordinary complaints | Assigned staff wallet and passkey; human review | Assigned moderator decides; future AI recommendation requires human confirmation | Existing human flow retained; no AI decision automation added |
| Authority | Configured 2-of-3 Safe for passkey recovery only; no role-management UI | Both designated authority wallets approve role changes, critical changes and authority transfer | Not implemented or deployed; the old Safe is not relabelled |
| Second factor | Native passkey plus audited enrollment approval | Authenticator app OR passkey/security key, with ordinary guided setup | Native setup implemented locally; authenticator app pending |
| Collection verification | No approved general checkmark eligibility | Manual origin review, recorded decision and revocation; no volume threshold or economic/Trust effect | Registry and granting workflow pending |
| Preview actions | Menu reserved space beside the title | Menu overlays media and does not change metadata layout | Implemented locally; release evidence is in the stabilization checkpoint |

This amends canon 07 and the related UI direction in canon 05/16. It does not
change Base auction economics, contract storage, settlement, Genesis rights or
mainnet authorization. The full Bible's October 7 note points to this amendment.

Authority wallets are an operator policy, not a new hardcoded role in frontend
source. October 8 clarification: application role grants/revocations and authority
rotation use gasless signatures from BOTH current designated wallets; no new Safe
is required for these application actions. A future transfer needs approval from
the current pair, not the proposed replacement. No single-key recovery exception
or autonomous AI role issuance has been approved. On-chain contract/fund control
and the existing Safe remain separate. The unwired Safe-policy observation helper
is not an implementation of this selected application authority.

October 8 preview amendment: only Donate, Report and an indexed creation
transaction link belong in the media-overlay menu, in that order. Management
stays on artwork detail; full title/metadata remain available through the card's
accessible label, tooltip and detail page. This replaces the earlier owner-action
and nested-details menu. Creation links must use the indexed registration hash
and matching known-chain explorer, never a pending or auction transaction.

The new authority and authenticator-app work does not make the current Admin
page a complete protocol-control console. Exact permitted critical operations
must be implemented individually and tested. Existing real-device and recovery
activation gates are not marked complete by this amendment or mocked tests.

Rollback boundaries: the preview layout can be reverted independently; the
code-free first-passkey amendment is recorded separately on October 3. No
authority/TOTP/verification deployment exists to roll back at this checkpoint.
Do not remove complaint records or rewrite historical audit evidence to change
a UI or policy direction.
