# B18: original token marks in both themes

The founder requested original token branding in Classic and Future. The
Ethereum bitmap was already the official black diamond; the shared card-price
and account marks placed it on `--c-text`, making its backing cyan or mint.

The existing bitmap is retained. A neutral white brand backing now applies in
both themes, with identical dimensions, to shared card prices, account/native
balance marks and Ethereum network chips in wallet-NFT cards and details.
Other brand assets keep their own colors. No new image, dependency, request,
wallet operation or interface-palette change is introduced.

The visual canon records the distinction between theme colors and brand marks.
Rendered verification and release evidence are recorded below; mobile/desktop
wallet behavior is not inferred from this cosmetic correction.

Local verification: 65 focused identity, price and network-frame tests passed.
Rendered checks passed in Classic and Future at 390 px and 1440 px: assets
loaded, ETH backing stayed white, no filter altered brand colors, dimensions
were unchanged and no horizontal viewport overflow appeared. The isolated
fixture used the real shared styles and brand assets, without a connected
wallet. Local evidence is retained under `output/playwright/native-token-brand-*`.
The production build passed.

## Hosted release — November 9

[PR #478](https://github.com/maysonkiller/ArtSoul-Protocol/pull/478), reviewed
head `4edd7e8f`, merged at `2026-11-09T17:19:12Z` as
`d9a6175a6c3fc2be1802485e9cd8a5808e0d819d`.
[CI run 42662678753](https://github.com/maysonkiller/ArtSoul-Protocol/actions/runs/42662678753)
passed Linux, Windows and static checks. An initial obsolete adapter-version
test expected `v18`; the assertion was corrected to `v19` before the successful
run. This was a cache-version test correction, not a token-mark failure.

Deployment `dpl_5aHr5DHtrP5Vpa9ZVdevUUpPJUCB` is READY with the
`artsoulprotocol.com` alias. The production probe verified five routes and ten
assets with all expected-content matches true. These release checks supplement
the local rendered evidence above; they do not establish native-wallet journey
acceptance. The resulting production auction gallery after the owner's signed
Keeef re-auction showed the neutral white ETH backing beside its live price.
The separate signed-flow results are recorded in the B11 relay audit.
