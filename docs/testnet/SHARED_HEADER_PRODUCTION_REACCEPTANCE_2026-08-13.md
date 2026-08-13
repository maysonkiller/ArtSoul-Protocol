# Shared Header and First-Paint Production Re-acceptance

Accepted: 2026-08-13

Production origin: `https://artsoulprotocol.com`

Scope: durable backlog items A-05 and A-46 after the deferred-header regression.

## Accepted change

- [PR #194](https://github.com/maysonkiller/ArtSoul-Protocol/pull/194), merge
  commit `9d69b1c`, added a bounded dependency-free header prepaint bridge and
  prevented a delayed artwork module from leaving an empty black document.
- The bridge restores only validated wallet-bound presentation data. It does
  not authenticate a wallet, grant connected-only actions, request a provider,
  change a chain, or make a profile read authoritative.
- The artwork document exposes an existing static skeleton before React and a
  bounded module-load failure state. It does not change projection truth,
  auction freshness, contract behavior, or protocol economics.

## Automated evidence

PR #194 recorded all of the following before merge:

- 662 unit and integration tests passed;
- 19 contract tests passed;
- production build and route verification passed;
- Ubuntu CI, Windows CI, static checks, Vercel preview and production
  deployment passed;
- browser checks found one shared header and one coherent account shell, while
  the artwork document retained visible loading and failure states.

An additional production WebKit back-forward probe on 2026-08-13 reproduced a
fresh document load on browser Back (`pageshow.persisted=false`, navigation type
`back_forward`). It did not record a guest/connected header identity transition.
That separate whole-document repaint is tracked as A-48 and does not reopen the
ordinary-navigation header defect.

## Founder production evidence

After the production deployment, the founder exercised the site on a real
iPhone in both connected and disconnected states. The run covered initial
session restoration, repeated page navigation, artwork pages, explicit
disconnect and reconnect, SIWE signing, reloads, and network recovery from Base
Mainnet to Base Sepolia through the existing network control and MetaMask.

The accepted run confirmed:

- no guest avatar or `ArtSoul Guest` identity appeared during ordinary
  connected navigation;
- disconnected navigation remained visually coherent;
- the account control did not duplicate, overlay, collapse, jump, or leave a
  blank identity region;
- explicit reconnect and SIWE completed;
- selecting the network control opened MetaMask, requested Base Sepolia, and
  updated the site after confirmation;
- ordinary forward navigation did not flicker or lag;
- artwork pages no longer remained as an unexplained black document during a
  delayed or failed module path.

The founder observed one brief whole-document repaint when using an explicit
Back control or the native iPhone history-swipe. It was not observed during
ordinary forward page navigation and did not present the wrong wallet identity.
This is therefore recorded separately as A-48 rather than being hidden inside
A-05 or treated as a WalletConnect failure.

## Acceptance boundary

This record closes the deferred-header regression under A-05 and returns the
first-paint work under A-46 to done. It does not re-accept or change the external
mobile session lifecycle, SIWE authorization, Base Sepolia write guard,
projection freshness, contracts, economics, moderation, or the controlled-beta
GO decision.
