# B18 compact account menu

## Scope and reproduction

The founder's November 1 mobile screenshot showed wallet identity, appearance,
network, provider and account destinations as a long sequence of rows. In the
built 390px fixture the eligible staff menu was 442px high. Desktop retained
older narrow sizing rules. This changes the shared account menu only (visual
canon part 16 and B3 beta defect work); contract behavior and access rules are
unchanged.

## Implemented

- Identity and full-address copy remain at the top. Profile and an eligible
  Admin link share the next row where primary navigation is already present.
- Network, balance and the active wallet provider form one group. Existing
  network switching and confirmation states are preserved.
- Appearance uses a compact labeled Classic/Future switch with `aria-pressed`.
  Disconnect, Connect and restoration feedback remain distinct final actions.
- A common bounded popover replaces divergent desktop/mobile sizing. Interactive
  targets are at least 44px. Short screens scroll only the popover; ordinary
  portrait and desktop menus fit without an internal scrollbar.
- Search, voice and notifications remain beside the account button. Admin
  eligibility still comes from the server and is invalidated on account changes.
  Both palettes and static Classic behavior are preserved.

## Interpretation decisions

Keep appearance inside the account menu instead of adding another header button.
Keep Admin one activation away in that menu instead of burying it in Profile.
Retain the existing rule omitting the link to the currently open own Profile or
Admin page. Legacy surfaces without primary navigation retain their destinations.
These are UI choices, not new roles, permissions or architecture amendments.

## Validation

- 158 focused shared header, copy, network, role, loading and cache-version checks
  passed. The build verifies 11 HTML routes and 172 Tailwind utilities.
- 563 rendered-browser assertions across 40 combinations: 320, 390, 768, 844
  landscape and 1366 widths; Classic/Future; guest, member, staff and a different
  connected network. Verified fit, touch sizes, full address copy, theme state,
  eligible Admin visibility, network choices and reachable final actions.
- A 320px left-edge overflow and a legacy 36px Connect target were found during
  the check and fixed before signoff. Screenshots reviewed in both themes.
- The eligible staff menu at 390px is approximately 364px high, down from 442px.
  Browser fixtures do not certify native iPhone or extension wallet flows.

## Release status

Local implementation and build verified. Release/CI results will be added after
the exact candidate is checked. Phase B remains open: this UI change does not
complete the independent recovery and existing-worker activation gates.
