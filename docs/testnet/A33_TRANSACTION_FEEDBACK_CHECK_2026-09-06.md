# A-33 transaction feedback check — 2026-09-06

Status: local repair, not production or real-device acceptance.

## Evidence and bounded changes

The founder's September 5 desktop recording shows a bid Notice around 01:32 and a purchase Notice around 02:18 printing an RPC URL, `eth_estimateGas` request data and library diagnostics. Text escapes the dialog. The latter frame explicitly includes `OutOfFunds`; this is evidence for insufficient funds on that operation only. It is not evidence that every failure in the three recordings has that cause.

- Shared transaction formatting reads bounded, cycle-safe nested errors and preserves explicit reasons instead of generic outer wrappers. It maps OutOfFunds to the existing balance explanation. Public messages omit request-body and library diagnostic sections and are limited to 240 characters. No claim that nothing was submitted is added.
- Bid formatting no longer calls an RPC connection closure an ended auction, a low nonce a low bid, or a Base Sepolia RPC timeout a wrong network. Internal transport codes remain available in diagnostic metadata but do not replace the returned explanation.
- Existing Notice/Confirm dialogs wrap unbroken text, constrain their height and provide internal scrolling. Their buttons remain reachable in narrow and landscape viewports. The existing appearance is preserved. Reduced-motion preference suppresses the existing entrance animation and transitions.
- Runtime versions are changed on every consuming page and pinned in the content-hash regression guard.

## Verification

- Full unit suite: 878 tests, 871 passed, 7 skipped, 0 failed. Production build passed with 10 HTML routes and 178 Tailwind utilities verified. `git diff --check` passed.
- Regression tests reproduce the recorded OutOfFunds payload, nested revert reasons, cancellation, cyclic causes, generic RPC diagnostics and false bid classifications. They execute the actual formatter/adapter and bid module.
- Actual headless Chrome, isolated local dialog document: 320x568, 390x844, 844x390 and 1440x900 in both Classic and Future. An approximately 4,750-character unbroken message stays within the viewport without horizontal overflow; OK can be scrolled into view and clicked. Reduced-motion mode produces no entrance animation.
- No wallet provider, signature, purchase or other on-chain write is involved in these checks. Desktop viewport emulation is not Android/iOS acceptance.

## Open boundaries and interpretation

Bible frontend/provenance and theme scope only; no contract behavior, fees, ownership, settlement or mint lifecycle changed. Existing transaction prechecks and network guards remain active. Incomplete/ambiguous RPC evidence is not treated as proof of an ended auction or a specific contract refusal.

External-mobile switch failures, account reconciliation and a confirmation followed by stale indexer data remain separate. The recorded extension-injection failures are not hidden or patched by rewriting `window.ethereum`. A-33 stays in progress until relevant real-device feedback and composition checks pass.

## Follow-up: validation must release the action state

The adjacent profile Create Auction handler acquired its Processing lock before validating duration/price, but its early validation returns were outside `try/finally`. Three behavioral tests reproduced the stuck lock without requesting a wallet. Validation now runs inside the existing action lifetime so every return releases the lock. Allowed durations and positive-price rules are unchanged; no contract call is made for invalid input. This is a code-reproduced edge case, not a diagnosis of the signed-wallet waiting interval in the Android recording.
