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
source. A configured two-owner threshold of two must be proved; an arbitrary
threshold-valid Safe signature is insufficient if its owner policy permits a
different signer combination. A future transfer needs approval from the current
pair, not from the proposed replacement. No single-key recovery exception has
been approved.

The new authority and authenticator-app work does not make the current Admin
page a complete protocol-control console. Exact permitted critical operations
must be implemented individually and tested. Existing real-device and recovery
activation gates are not marked complete by this amendment or mocked tests.

Rollback boundaries: the preview layout can be reverted independently; the
code-free first-passkey amendment is recorded separately on October 3. No
authority/TOTP/verification deployment exists to roll back at this checkpoint.
Do not remove complaint records or rewrite historical audit evidence to change
a UI or policy direction.
