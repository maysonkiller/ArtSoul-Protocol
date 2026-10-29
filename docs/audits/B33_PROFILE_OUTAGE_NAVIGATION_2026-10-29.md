# B33 — Profile navigation during a restricted data-service outage

Status: source-only candidate, Draft PR. **No production release or provider recovery claimed.**

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
