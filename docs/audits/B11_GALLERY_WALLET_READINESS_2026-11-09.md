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

## Released verification and Gallery acceptance

[PR #480](https://github.com/maysonkiller/ArtSoul-Protocol/pull/480) merged at
`2026-11-09T18:05:54Z` as `009c4c18de114689d6524318403d896b3dde9ea2`.
[CI run 42670259771](https://github.com/maysonkiller/ArtSoul-Protocol/actions/runs/42670259771)
passed Linux, Windows and static checks. The earlier run failed only on the
obsolete cache-hash manifest; it was corrected before this green run.

Production deployment `dpl_5yq8JD9vcgPW1e5fz6eQumVETCwM` is READY at that exact
merge. The production probe matched all seven routes and both checked assets;
evidence is `docs/private/b11-gallery-wallet-production-probe-2026-11-09.json`.
On the actual Gallery, the withdrawal command then returned
"There is nothing to withdraw." without a wallet prompt or transaction.
Screenshot: `output/b11-gallery-withdraw-zero-confirmed-2026-11-09.png`.
This accepts Gallery readiness with the already-zero balance; it does not
repeat the completed withdrawal below.

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
Do not repeat the completed withdrawal.

## Accepted assistant auction creation

The owner signed assistant creation of artwork 14's auction at `0.001 ETH` for
24 hours. Both public RPCs confirmed transaction
`0x8234c4009a9cf0f40e47157f26ad3e23b9fd44b2f88b55d0d66c69853313634a`,
status 1, block `56631239`, `2026-11-09T18:15:16Z`. The exact Core
`AuctionCreated` event and state at that block identify active auction 75,
artwork 14 and its existing creator, with a duration of 86,400 seconds and end
time `2026-11-10T18:15:16Z`. The artwork remained unminted with floor zero.

Without reload, the page showed the live auction at the approved price and
duration. The assistant cleared its input, disabled Send and showed the
next-action prompt plus artwork and transaction links. Evidence:
`docs/private/b11-assistant-start14-receipt-2026-11-09.json`, its matching
read-only `.mjs` verifier, and
`output/b11-assistant-start14-confirmed-2026-11-09.png`.

The documentation follow-up [PR #481](https://github.com/maysonkiller/ArtSoul-Protocol/pull/481)
is deployed as `dpl_EsM4JvuRUY3dMgi4y5yg7Y3GTe6E`, READY at exact merge
`b07e94fb0a01a64fddd025ed1d100569f7976c49`.
[Merge CI 42672213379](https://github.com/maysonkiller/ArtSoul-Protocol/actions/runs/42672213379)
passed Linux, Windows and static checks. The earlier
[PR CI 42671887123](https://github.com/maysonkiller/ArtSoul-Protocol/actions/runs/42671887123)
had an aggregate failure while its two recorded jobs passed; no Linux job or
failed-job log explained that result. It is not recorded as a fully green PR run.

## Accepted assistant initial resale listing

The owner signed the assistant listing of artwork 38, token 7, for `0.001 ETH`.
Both public RPCs confirmed transaction
`0xa2a9478dd35f602846b6c5fefe6c472e0098f7fb7e3fec6d4e96529aee398e09`,
status 1, block `56633575`, `2026-11-09T18:23:03Z`. The exact Core
`ResaleListed` event and state at that block confirm the active listing at
`0.001 ETH`; the existing canonical floor remained `0.001 ETH`. NFT contract
`0xf061f70503c37Cf2196A28F4785E524D0Fb32538` still recorded the seller
`0x6EC8C121043357aC231E36D403EdAbf90AE6989B` as token 7's owner.

Without reload, the page showed the sale price and replaced List NFT with
Change price / Remove from sale. The assistant cleared its input, disabled
Send and showed the next-action prompt plus artwork and transaction links.
Evidence: `docs/private/b11-assistant-list38-receipt-2026-11-09.json`, its
matching read-only `.mjs` verifier, and
`output/b11-assistant-list38-confirmed-2026-11-09.png`.

Assistant bid remains pending and requires an eligible funded account different
from the creator. Existing real Phantom and latest native iPhone
observations, plus separate provider/cohort gates, remain open. Do not repeat
the accepted auction creation or listing; this record does not declare Phase B
or the future public beta complete.

## Signed purchase and delayed resale projection

The owner signed purchase of artwork 38/token 7 through the assistant for
`0.001 ETH`. Two public RPCs agree on transaction
`0xf029a10c9863601eeab56b43807ff455e52199378f54ad11db3c576329c45ec4`,
status 1, block `56637436`, `2026-11-09T18:35:56Z`. Ownership moved from
`0x6EC8C121043357aC231E36D403EdAbf90AE6989B` to
`0x2d49162fcf065dae43c4a0dc2feb3d1cc9ff1824`; the listing became inactive and
floor remained `0.001 ETH`. Evidence:
`docs/private/b11-assistant-buy38-receipt-2026-11-09.json` and its read-only
verifier. Do not replay the completed purchase.

The assistant cleared its input and retired Buy without reload, but the owner
label and five-event provenance remained stale in the observed page. This is
a confirmed UI defect, not a failed purchase or accepted complete UI journey.
Screenshot: `output/b11-assistant-buy38-initial-2026-11-09.png`.

The correction refreshes only the affected artwork after a confirmed resale:
one immediate read and at most six delayed reads across 60 seconds of scheduled
delays. It waits for both the newer indexed resale block and matching provenance,
pauses reads while hidden, and cancels on cleanup or a newer resale. It does not
resubmit transactions or add permanent polling. Focused tests cover delayed
history, visibility, cleanup, unrelated receipts, failed reads and exhaustion.
New native-wallet acceptance is still distinct from local regression evidence.
