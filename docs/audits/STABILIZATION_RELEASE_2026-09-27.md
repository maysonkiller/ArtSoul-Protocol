# Stabilization release — September 27, 2026

Status: application published; read-only apex acceptance passed.
Phase A remains NO-GO pending the separately recorded device and activation gates.

## Reviewed revision and rollout

- Workspace: `C:\Projects\ArtSoul`, branch `codex/takeover-audit`.
- [PR #280](https://github.com/maysonkiller/ArtSoul-Protocol/pull/280) merged the
  reviewed candidate `e19446732d12942001404e794bde888a5c826e90` into the unchanged
  base `607f21337941fc1bd98a3651fde8953b981d5f91`.
- Merge: `81627ab5d5d5f17ed190aad352e56af701f724c5`, 11:12:50 UTC. The local
  workspace fast-forwarded to that exact commit without an overlay or reset.
- Production deployment `6691460363` reported success at 11:13:22 UTC.
  [Immutable deployment](https://artsoul-3htbz2ert-maysonkiller-be9112b5.vercel.app),
  [deployment inspection](https://vercel.com/maysonkiller-be9112b5/artsoul/7GkotETLCoSRM8gKwsAMur2VCWua).
- Rollback reference: prior successful production deployment `6470347826`,
  commit `607f213`, at
  [the preceding immutable deployment](https://artsoul-l8db8y9n8-maysonkiller-be9112b5.vercel.app).
  No rollback was performed.

The owner authorized this existing Base Sepolia application rollout after green
CI and preview checks. No migration, moderation activation, indexer-host update,
new contract deployment, mainnet operation, DNS change or data cleanup occurred.

## Verification

The initial hosted run failed before build: npm selected optional CDP SDK 1.57.0
while the lock contained 1.55.0. An exact npm 11.6.2 fresh-metadata fixture
reproduced it. The scoped Base Account override preserves 1.55.0; regeneration
produced no lockfile changes. The actual clean install, 184 wallet/navigation
checks and build then passed. See the [dependency review](DEPENDENCY_TRIAGE_2026-09-23.md).

- [Application revision CI](https://github.com/maysonkiller/ArtSoul-Protocol/actions/runs/36314685277):
  Ubuntu 1,227 Node tests passed, zero skips; Windows 1,181 passed and seven
  PostgreSQL suites skipped because that runner lacks the required Docker setup.
  Ubuntu executed those database suites. Both platforms passed 33 contract tests.
- [Exact final candidate CI](https://github.com/maysonkiller/ArtSoul-Protocol/actions/runs/36314843935):
  all three jobs passed before merging: Linux, Windows and static checks.
- [Post-merge CI](https://github.com/maysonkiller/ArtSoul-Protocol/actions/runs/36315006251)
  also passed all three jobs for `81627ab`.
- Preview acceptance used real deployed GET responses and the real guest wallet
  SDK. Artwork 28 maps to auction 63; artwork/profile/gallery agree on its no-bid
  state. Media decoded and six indexed provenance events loaded. Desktop and
  mobile viewport captures had no page exceptions or HTTP errors. Blocked SDK
  telemetry generated expected, separately classified console errors.
- Collection Publish stayed disabled. The exact final preview's navigation
  artifact matched the reviewed source. Its five-document delta changed no
  application or dependency file.

## Apex acceptance

The immutable production URL and `https://artsoulprotocol.com` returned the
reviewed navigation artifact with the same SHA-256. Fresh guest checks passed
eight desktop/mobile-viewport captures with the actual SDK and public API reads:
no page exceptions, HTTP errors, overflow or unwanted Reown font preloads.
Collection Publish remained disabled. Base Sepolia reported healthy, zero lag;
legacy Ethereum Sepolia remained stopped by design. A sanitized public-config
check returned `reportingEnabled: false`; no moderation activation occurred.

- **A-79 accepted:** ordinary desktop Chrome requested the first 24 creator works;
  identity appeared 280 ms before cards and 460 ms before the full-corpus response.
  The remaining card arrived without clearing settled content or a guest prompt.
- **TA-07 accepted:** four actual Classic/Future switches kept one Back button,
  respected each palette, produced no page exceptions and reduced transition
  duration to zero when reduced motion was enabled.
- **A-48 desktop portion passed:** ordinary headed Chrome 153, with the tool's
  cache-disabling flag removed and no request interception, preserved the marker
  and reported `pageshow.persisted: true`. Its retained navigation entry still
  said `navigate`, confirming why the old probe was incorrect. Earlier mixed
  headless results remain diagnostic evidence; iOS/Android acceptance stays open.
- **A-33 remains open:** 34 public records included five minted works, but none
  had three distinct Creator / First Collector / Owner addresses. No resale or
  artificial fixture was created to fill that evidence gap.

The general smoke blocked automatic SDK telemetry and classified its resulting
console errors. The uninterrupted Back-cache probe allowed normal Coinbase SDK
telemetry; it made no application writes or wallet signatures. Screenshots and
the corresponding `live-production-*` logs/JSON are in `output/`.

Local evidence remains under `output/audit/`: `release-ci-12bf2a8.log`,
`release-ci-e194467.log`, `release-source-manifest-2026-09-27.json`, and the
`live-preview-*` records. Of 90 source fingerprints, only the scoped package.json
override differs from the previous 1,227-test local revision. Original failed
logs are preserved alongside the successful checks.

## Acceptance limits

This rollout does not prove real-phone wallet/SIWE/OAuth, a live Gemini request,
Rabby signing behavior, founder passkeys or Safe recovery. Those remain in the
[Phase A close-out](../PHASE_A_CLOSE_OUT.md). It does not waive residual dependency
advisories or prototype contract findings. Collection terms, services and SQL
remain drafts; publishing, newsletter delivery and new deployments are inactive.

The A-48 probe was corrected to use a surviving document marker plus
`pageshow.persisted`. Navigation timing alone cannot identify a BFCache restore.
This changes the measurement method, not product behavior or acceptance scope.
