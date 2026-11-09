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
The production build passed; hosted release verification remains a separate step.
