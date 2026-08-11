# Shared Header Production Acceptance

Accepted: 2026-08-04

Production origin: `https://artsoulprotocol.com`

Scope: durable backlog items A-05 and A-45.

## Accepted changes

- [PR #167](https://github.com/maysonkiller/ArtSoul-Protocol/pull/167)
  bound profile identity resolution to the active wallet, rejected stale
  cross-wallet reads, retried failed profile reads only through bounded events,
  and cleared wallet-bound identity on disconnect.
- [PR #168](https://github.com/maysonkiller/ArtSoul-Protocol/pull/168), merge
  commit `f4297ce1ea9c1abf5ccc114d9efa0b501eff0c99`, made the visible account
  control atomic and stable across full-document navigation. It also restored a
  validated, wallet-bound cached identity before the first frame, kept desktop
  and mobile geometry fixed, and removed the remote-font metric swap from the
  shared control.
- The implementation preserves the existing multi-page architecture. It adds no
  polling, wallet requests, profile requests, RPC calls, authorization shortcut,
  network change, contract change, or dependency.

## Automated evidence

PR #168 recorded all of the following before merge:

- 116 shared-header regression cases passed;
- 592 unit tests passed with six expected Docker-dependent skips;
- 19 contract tests passed;
- all ten built routes used the same canonical disconnected avatar;
- Ubuntu CI, Windows CI, static checks, Vercel deployment, and Vercel preview
  checks passed;
- real Chromium checks at desktop and mobile widths observed one stable header,
  one account button, one avatar image, fixed geometry, atomic disconnect, and
  no guest avatar beside a connected name or address.

## Production evidence

After deployment, the founder exercised the production site on desktop and a
real mobile browser with both connected and disconnected wallet states. The run
covered opening and reloading pages, navigating between the home, gallery,
profile, publish, artwork, and documentation surfaces, and returning after a
wallet connection.

The previously reported failures were not reproduced:

- the account button did not duplicate or overlay avatars;
- the disconnected avatar did not replace a connected profile identity during
  normal navigation;
- profile name, shortened wallet address, and avatar remained mutually
  consistent;
- the account button did not collapse, jump, or show a blank intermediate
  state;
- explicit disconnected pages retained the canonical guest identity.

One Telegram in-app-browser connection took longer than the external-browser
path and briefly changed visual state before settling. It completed without a
persistent wrong identity, duplicate control, or unusable wallet state. This is
not treated as a failure of A-05 or A-45; external-mobile wallet lifecycle
acceptance remains recorded separately under A-03/A2.

## Acceptance boundary

This record closes the shared-header presentation defects only. It does not
change or re-accept SIWE, WalletConnect session ownership, the Base Sepolia
write guard, profile authorization, contracts, economics, moderation, or the
controlled-beta GO decision.
