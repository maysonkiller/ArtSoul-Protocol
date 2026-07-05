# Mobile Wallet Root-Cause Test

This diagnostic intentionally does not change ArtSoul wallet behavior. It separates bare Reown AppKit from the ArtSoul wrapper so a real-phone result can identify the failing layer.

## Test layers

Use the same deployment origin for every step. Before testing a Vercel preview, add that exact preview origin to Reown Project Domains.

1. Bare AppKit only:
   `https://<deployment-origin>/wallet-test.html?walletdebug=1`
2. ArtSoul `appkit-init.js` wrapper, without Supabase:
   `https://<deployment-origin>/wallet-test.html?walletdebug=1&layer=wrapper`
3. ArtSoul wrapper plus `supabase-client.js` and `supabase-auth.js`:
   `https://<deployment-origin>/wallet-test.html?walletdebug=1&layer=auth`
4. Real page:
   `https://<deployment-origin>/index.html?walletdebug=1`

The test page is excluded from site navigation and search indexing.

## Real-phone procedure

For each layer:

1. In MetaMask, remove the existing ArtSoul connection before starting the next layer.
2. Open the URL in external Chrome or Brave, not MetaMask's in-app browser.
3. Take a screenshot of the first log panel before tapping Connect.
4. Tap Connect, choose MetaMask, approve the connection, and return to the external browser.
5. Wait 15 seconds without reloading.
6. Take screenshots that include the final 10 to 20 log lines and the account/chain summary.
7. Record whether MetaMask returned automatically or whether you returned manually.

Then repeat the real page once in MetaMask's in-app browser and once on desktop. Do not approve a signature during these connection-only tests.

## How to interpret the first failing layer

- Bare AppKit fails: Reown project configuration, origin allowlist, relay/network reachability, MetaMask, or AppKit version/configuration is the cause. ArtSoul recovery code has not run.
- Bare AppKit works and `layer=wrapper` fails: `appkit-init.js` is the first failing layer.
- Wrapper works and `layer=auth` fails: Supabase auth bootstrap is the first failing layer.
- All test layers work and the real page fails: the failure is in another real-page integration or UI layer.

Do not change production connect behavior until one of these boundaries is demonstrated by the on-device log.

## Screenshot evidence to look for

The bare log must show:

- `bare AppKit created`
- `Connect click entered`
- `subscribeState` with the Connect modal open
- `pagehide` or `visibilitychange` when MetaMask opens
- `pageshow`, `window focus`, or `visibilitychange` after returning
- `subscribeAccount` with an address
- `resolvedChainId: 84532`

The real-page log must show:

- `appkit configuration`
- `connect button handler entered`
- `walletconnect/appkit modal open requested`
- `appkit account update`
- `external mobile session chain resolved`
- either `external mobile Base Sepolia confirmed` and `wallet connection confirmed`, or a precise error/timeout line

## Reown Dashboard checklist

Open Reown Dashboard, select the project whose public Project ID matches the value used in `appkit-init.js`, then verify:

1. Project status: active, not deleted or disabled.
2. Project Domains -> Configure Domains contains exactly:
   - `https://artsoul.vercel.app`
   - the exact Vercel preview origin being tested, copied from the browser address bar, for example `https://<deployment>.vercel.app`
3. Domain entries contain only scheme plus hostname. Do not include `/index.html`, `/wallet-test.html`, query strings, or a trailing page path.
4. The page log reports `metadataUrl` equal to the browser origin.
5. The page log reports `projectIdPresent: true` without displaying the Project ID.
6. The configured AppKit and Wagmi networks are Base Sepolia only, chain ID `84532`, with Base Sepolia as `defaultNetwork`.
7. Test once on Wi-Fi and once on cellular data with VPN, DNS filtering, and iCloud Private Relay disabled. Relay lookup or WebSocket errors point to network reachability rather than ArtSoul code.

Reown documents an origin mismatch as `APKT002 Invalid App Configuration`, an invalid ID as `APKT007`, an unavailable/blocked relay as a connection or request timeout, and requires `metadata.url` to match the current domain and subdomain.

## Stop condition

The diagnostic PR is complete when the page builds and produces readable logs. A production fix is a separate commit after screenshots identify the first failing layer and exact failing event.
