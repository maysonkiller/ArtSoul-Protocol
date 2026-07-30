# External-Mobile Wallet Production Acceptance

Date: 2026-07-30

Production origin: `https://artsoul.vercel.app`

Accepted merge: [PR #156](https://github.com/maysonkiller/ArtSoul-Protocol/pull/156),
merge commit `a2c82f2`

Scope: external-mobile WalletConnect lifecycle and Base Sepolia network recovery.

## Environment

- iPhone
- Chrome for iOS
- MetaMask mobile
- ArtSoul production origin
- Base Sepolia product testnet, chain ID `84532`

## Operator Procedure

1. Close the previous ArtSoul tabs.
2. Open the production wallet diagnostic and run its explicit diagnostic
   disconnect once.
3. Close the diagnostic tab and open the normal ArtSoul production site.
4. Connect MetaMask and return to the same Chrome tab.
5. Start with MetaMask on Ethereum Mainnet.
6. Select Base Sepolia from the ArtSoul account menu.
7. Select Base Sepolia again after the switch to confirm that the already-active
   product network is a harmless no-op.

## Accepted Results

- The production site loaded the post-merge wallet runtime
  `appkit-init.js?v=51`; the prior production cache key `v=46` was absent.
- MetaMask pairing and the return to the same Chrome tab completed.
- ArtSoul retained a live WalletConnect session.
- No second SIWE prompt appeared, which is consistent with reuse of an existing
  authenticated SIWE session. This is valid runtime behavior but is not evidence
  of a fresh SIWE challenge and signature.
- Starting from Ethereum Mainnet, selecting Base Sepolia requested and completed
  the network switch.
- After the switch, Base Sepolia remained the only selectable ArtSoul product
  network. Selecting the already-active network performed no additional action.
- The previous raw SDK failures were not reproduced:
  `WalletConnect did not establish a live session` and
  `Please call connect() before request()`.

## Boundaries

This acceptance closes the reported external-mobile connection and
wrong-network recovery defect. It does not add Ethereum Mainnet, Base Mainnet,
or any other chain as an ArtSoul product network. Base Sepolia remains the only
active write testnet.

This record does **not** complete Phase A1. The operator did not receive a fresh
SIWE prompt in this run, and the two authenticated negative upload-policy probes
were not executed. A1 still requires a production mobile run that visibly
reports `A1 auth smoke passed`, including both expected HTTP 400 policy
rejections, plus the separate private credential attestation.
