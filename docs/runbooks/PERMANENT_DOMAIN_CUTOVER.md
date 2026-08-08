# Permanent Domain Cutover

Canonical origin: `https://artsoulprotocol.com`

Legacy rollback origin: `https://artsoul.vercel.app`

This runbook connects the founder-owned Cloudflare zone to the existing ArtSoul
Vercel project. It changes public routing and identity origins only. It does not
change protocol economics, contracts, storage layout, wallet authorization, or
the Base-only write guard.

## Preconditions

- `artsoulprotocol.com` is registered and renewable by the founder.
- The zone uses the founder-controlled Cloudflare account.
- The Vercel project is the existing `artsoul` production project.
- The current Vercel production deployment and `artsoul.vercel.app` alias are
  healthy before the cutover.

## Vercel and DNS

1. In the ArtSoul Vercel project, add `artsoulprotocol.com` as the production
   domain and make it the canonical production domain.
2. Add `www.artsoulprotocol.com` and configure it to redirect permanently to
   `https://artsoulprotocol.com`.
3. Copy the exact DNS records shown by Vercel into Cloudflare. Do not reuse a
   value from an old guide: Vercel's project screen is authoritative for the
   current target and verification records.
4. While Vercel is verifying the domain, keep Cloudflare proxying disabled for
   the Vercel target records unless Vercel explicitly reports the proxied record
   as valid. Proxying can be enabled only after certificate issuance and the
   acceptance checks below remain green.
5. Wait for Vercel to report both domains as valid and for HTTPS certificates to
   be active.

## Deployment Environment

Set the following production values in Vercel. Keep the legacy origin during the
cutover so active sessions and rollback remain possible.

```text
OAUTH_ALLOWED_ORIGINS=https://artsoulprotocol.com,https://artsoul.vercel.app
API_ALLOWED_ORIGINS=https://artsoulprotocol.com,https://artsoul.vercel.app
ARTSOUL_WEBAUTHN_RP_ID=artsoulprotocol.com
ARTSOUL_WEBAUTHN_ALLOWED_ORIGIN=https://artsoulprotocol.com
```

Do not enable the moderation passkey feature flags merely because these values
exist. A8 activation still requires two founder passkeys, the auditable bootstrap
grant and rehearsed Safe-only recovery.

## External Provider Configuration

Add the exact production callbacks before testing social linking:

```text
https://artsoulprotocol.com/api/oauth/callback/discord
https://artsoulprotocol.com/api/oauth/callback/twitter
```

Set the X application website URL to `https://artsoulprotocol.com`. Keep the old
Vercel callbacks only for the bounded migration window; remove them later in a
separate reviewed cleanup after existing sessions no longer need rollback.

In Reown, add `https://artsoulprotocol.com` to the ArtSoul project's allowed
origins. Keep the Vercel production and required preview origins during the
cutover.

## Acceptance

Run every check against the apex domain:

```bash
curl -fsSI https://artsoulprotocol.com/
curl -fsSI https://www.artsoulprotocol.com/
curl -fsS https://artsoulprotocol.com/api/public/indexer-status
curl -fsS 'https://artsoulprotocol.com/api/public/artworks?limit=1'
```

Accept the cutover only when:

- the apex returns `200` over HTTPS with the expected security headers;
- `www` redirects permanently to the apex without a loop;
- public APIs return their normal cached responses;
- desktop and iPhone external-browser wallet connect, restore, SIWE, network
  recovery and explicit disconnect pass on the apex origin;
- Discord and X linking return to the apex profile page;
- Open Graph URLs and images resolve from the apex domain;
- `artsoul.vercel.app` remains available as the documented rollback origin.

After these checks, update RG-01 to complete. Only then may A8 passkey enrolment
use `artsoulprotocol.com` as the final RP ID.
