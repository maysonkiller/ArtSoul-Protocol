# B18 Future account control

Scope: Bible visual/theme section 16 and shared account presentation. No wallet,
permission, contract, economic or lifecycle change. Continue in
`C:\Projects\ArtSoul`, branch `codex/takeover-audit`.

The founder's curved profile prototype uses a compact capsule with a restrained
surface and a clear avatar. The live header retained a 20px cyan/40px purple glow
and gradient text. Its old idle-animation rules were already overridden later
in the stylesheet. Replace that redundant cascade with one steady surface:
cyan-to-purple edge, solid readable identity text, contained avatar outline,
distinct hover/open fill and visible keyboard focus. Classic remains separate.
All colors reuse existing theme tokens. No new dependency or animation.

Interpretation: use the prototype's visual treatment, not its demo-only wallet
dot or replacement identity structure. Preserve actual account information,
the existing menu/controller, guest and connected states, mobile sizing and
ellipsis for genuinely long account names. A decorative status dot could imply
an authenticated state the prototype cannot establish.

Validation before release:

- 143 existing header/avatar/theme/artwork-layout checks pass; no skipped tests.
- Production build passes, including 11 route and 173 Tailwind utility checks.
- Real Chrome rendering of the built shared header/CSS in an isolated local
  fixture: 40 combinations (320/390/430/768/1440px, Classic/Future, guest/short/
  long/address identity). No page overflow, circular avatar retained, target at
  least 42px high, guest/short names fit, open menu stays within viewport and
  changes no button geometry. Future open/idle fills differ. Escape closes the
  fixture menu. This is presentation evidence, not wallet authentication.
- Long labels deliberately ellipsize; the existing <=360px treatment may also
  shorten an address label. No unverified claim that all arbitrary names fit.
- Desktop and mobile screenshots inspected. Local evidence:
  `output/b18-account-layouts.json`, `output/b18-account-tests.log`,
  `output/b18-account-build.log`. One oversized browser batch timed out; the
  recorded 40 cases were rerun in bounded batches and passed.

CSS version 61 is applied to every existing stylesheet consumer. Existing cache
pin checks are updated; no new tests merely asserting decorative CSS values.
Hosted preview/apex validation is required before calling this slice released.
B18 stays open for remaining capability-label/final visual work; this does not
close cohort, native microphone or signed assistant acceptance.
