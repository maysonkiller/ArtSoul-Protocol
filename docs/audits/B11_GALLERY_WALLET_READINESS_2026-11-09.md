# Assistant wallet readiness and withdrawal acceptance

## Observed defect

After the accepted Keeef re-auction returned to Gallery, the header showed the
connected wallet but the withdrawal command said no wallet was connected.
Gallery loads the contract adapter without initializing its signer. The
assistant waited for AppKit and then assumed the adapter would already be
ready. The same command worked on an artwork page, which initializes it.

## Correction

The shared browser tool dependencies now prepare the existing adapter only
when a command needs it. The selected AppKit provider must expose the connected
account on Base Sepolia. Passive account and chain reads happen before and
after preparation; the selected provider, address, signer and adapter must
still match. A rejected preparation cannot fall through to a partially ready
singleton on that invocation or a later retry.

Passive preparation uses ethers `listAccounts`, never its `getSigner`
connection-request fallback. It does not connect a wallet, switch networks,
request signatures, grant agent permission or submit a transaction. Existing
per-action review, wallet approval and contract checks remain in force.
The explicit activity command uses the same path to report withdrawable funds
and rejects a wallet change while its result is loading. No polling or
first-paint dependency was added.

The shared assistant asset is v18 across its seven route shells. The contract
adapter is v20 across its five consumers. No deployed contract changed.

## Verification

Before the correction, all five initial actual-browser-dependency regression
cases failed. The corrected focused suite passed 103 tests, including eight
new assistant cases and three real-ethers passive initialization cases, with
the production ethers 6.7.0 build. Cases include disappearing accounts, wrong
chains, account/provider/chain changes during preparation, invalid retries,
consent ordering and read-only activity. No live provider was used by tests.
The production build passed verification for 11 routes and 172 CSS utilities.
Hosted release and live no-funds confirmation are recorded when observed.

## Accepted signed withdrawal before this correction

The owner completed withdrawal through the assistant on artwork 38 on
production v19. Transaction
`0xc672118595c195f5abade0edf090cee534fd9b6430e06f981b64f31ded9cf35c`
succeeded at block `56622288`, `2026-11-09T17:45:26Z`. Two independent public
Base Sepolia RPCs agree: pending funds changed from `0.0609875 ETH` to zero;
the contract balance decreased by that amount and the owner's balance
increased by the same amount. The receipt gas fee was
`0.000001149774191629 ETH`; it is not described as an owner balance deduction.

Without reloading, the assistant cleared the command, asked what to do next,
and showed profile and transaction links. This is accepted withdrawal
evidence, not evidence that the then-broken Gallery preparation worked.
Private evidence: `docs/private/b11-assistant-withdraw-receipt-2026-11-09.json`
and `output/b11-assistant-withdraw-confirmed-2026-11-09.png`.
Do not repeat the completed withdrawal. Other pending owner journeys remain
open; this record does not declare Phase B or the future public beta complete.
