# B33 — Profile navigation during a restricted data-service outage

Status: released in PR #392, candidate `aabd735b`, main `0d2f547e`.
The incident description below records the earlier provider outage, not current
availability. Provider recovery is independently recorded in the October 29
infrastructure checkpoint; this UI patch changes no provider or billing setting.

## Incident and reproduction

On October 29 the founder captured `/profile` showing only **Profile unavailable**
and **Retry**. The authenticated Supabase organization billing page reported
`Services restricted`, `Egress Exceeded` and upstream HTTP 402 with Spend Cap
enabled through the current October 24–November 24 billing cycle.

In `src/entries/profile.jsx`, the initial `getProfile()` rejection is
propagated to `profileLoadError`. The `if (profileLoadError && !profile)`
branch then early-returns the entire profile page, including the normal
header-level profile tabs and editing/actions. The page's data source is
unavailable; the branch does not prove artwork records were deleted.

B31 and B32 fix different paths (public projection error semantics and
homepage/gallery presentation). They do not make the profile readable.

## Narrow correction

The initial profile outage state retains **Retry** and adds ordinary
**Explore Gallery** and **ArtSoul Home** links with explanatory text.
Owner-only controls are **not** made available when ownership/profile data
cannot be verified. The code does not create fake profile data, replay
wallet actions, invoke background retries, or bypass the restricted provider.

`test/profile-outage-navigation.test.cjs` is a source-shape regression
for this exact early-return path. It checks retry, public navigation,
the safe failure explanation and absence of owner-only handlers. Such tests
do not replace a rendered-browser test or a provider-recovery test.

## Acceptance and limitations

Before merging: exact-source Linux/Windows unit+build CI and a built
desktop/mobile browser check under simulated HTTP 503, proving that the links
are visible, keyboard-accessible and do not render privileged actions.
After deployment: read-only apex verification of the outage state. No
suppression of the Supabase error is allowed.

After provider recovery (B30): genuine profile and at least one populated
owned-artworks read, actual image delivery, and the owner-verified buttons
must all be checked. The three new links cannot themselves restore any
artwork, upload, transaction, profile edit or Supabase Storage media.

## No-new-spend boundary

Do not disable Spend Cap or change the plan. Do not move/delete DB or Storage,
treat a cached artwork as current ownership, introduce fake data, or move
ArtSoul OS files into the Protocol project. For alternative DB/Storage
migration, first make a verified read-only export, compatibility inventory,
independent private backups and rollback evidence; test in isolation.

Existing `B30_DATABASE_EGRESS_2026-10-29.md` documents the Shared Pooler
dominance and the already-deployed indexer correction.

## Release verification, October 29

- Exact-candidate Linux/Windows unit, contract and build CI plus static checks
  passed in run40859544072.
- Seven local profile outage/race tests passed; production build, 11 route
  checks and 173 Tailwind utility checks passed.
- Real Chrome rendering of the production build with all API reads forced to
  HTTP503: desktop Classic/Future, 390px Classic and 320px Future. No horizontal
  overflow, all three actions at least44px high. Retry visibly enters loading
  then returns to the error state. Tab focus reaches Gallery with visible focus;
  Gallery and Home links navigate correctly and browser Back returns to the
  profile. No owner editing/actions appear in the error branch.
- The fixture uses a synthetic public wallet address and blocks external
  requests. It does not sign in, change data or establish real-wallet acceptance.
- Preview and apex profile entries return HTTP200 and match the built bytes:
  `profile-DEXcc0Jf.js`, SHA256
  `4e56835e2c5aa4efcfbe10c0bd4265834b1e70c923c798b1d321d78d9ab660b3`.
  Apex checked at18:16UTC. Vercel reports deployment success.
- Private evidence: `docs/private/b33-{preview,production}-http.json`,
  `docs/private/b33-build.log`, and `docs/private/b33-profile-*.png`.
  Temporary viewport reset and test tab closed. The application environment,
  permissions, contracts and economics were unchanged. No dependency added.

Interpretation: public navigation remains useful when profile identity cannot
be loaded; it never grants ownership-dependent actions based on an unverified
address. No canon amendment is required (UI/error presentation only).
