# A1 Mobile Authentication and Upload-Policy Production Acceptance

Accepted: 2026-08-04

Production origin: `https://artsoul.vercel.app`

Production baseline: `main` at or after merge commit `f4297ce`

Scope: the remaining public-runtime evidence for canonical A1: a fresh external-mobile
SIWE signature followed by authenticated rejection of an unsupported MIME request
and an artwork-size request greater than 50 MB.

## Environment

- iPhone
- Chrome for iOS 150
- MetaMask mobile
- ArtSoul production origin
- Base Sepolia product testnet, chain ID `84532`
- isolated authentication bench: `/wallet-test.html?walletdebug=1&layer=auth`

The operator supplied the complete diagnostic output after the run. This record
contains only redacted evidence; no credential, signature, full wallet address,
or complete WalletConnect topic is stored in the repository.

## Operator Procedure

1. Open the production authentication bench on the iPhone.
2. Start a fresh external-mobile MetaMask connection.
3. Return to the same Chrome tab after approving the wallet connection.
4. Use the explicit second gesture to hand off to MetaMask for the SIWE message.
5. Sign the SIWE message and return to the same Chrome tab.
6. Let the bench issue its two authenticated, intentionally invalid JSON policy
   requests. The bench never uploads a file and never uses a returned signed URL.
7. Copy the complete diagnostic output.

The explicit second gesture is expected for a newly paired external-wallet
session: the first gesture establishes the WalletConnect session and the second
initiates SIWE. Requiring the operator to tap before the browser hands control to
MetaMask is not an acceptance failure.

## Accepted Evidence

The redacted production log reported all of the following:

- connection resolved on Base Sepolia for wallet `0x6ec8...989b`;
- the first gesture ended with `SIWE deferred after external mobile wallet connect`,
  as designed for a newly paired session;
- the second gesture completed with `A1 SIWE authenticated`;
- the unsupported-MIME probe returned HTTP `400`, error
  `INVALID_UPLOAD_PAYLOAD`, reason `UNSUPPORTED_FILE_TYPE`,
  `signedUploadReturned: false`, and `passed: true`;
- the greater-than-50-MB probe returned HTTP `400`, error
  `INVALID_UPLOAD_PAYLOAD`, reason `INVALID_FILE_SIZE`,
  `signedUploadReturned: false`, and `passed: true`;
- the final diagnostic state was
  `A1 auth smoke passed: SIWE + MIME/size rejection.`

Both negative probes were authenticated by the fresh SIWE session. Neither
request produced a signed upload URL, uploaded a body to Storage, or created an
object.

## Scope Boundary

This evidence supersedes only the runtime gap recorded in
`MOBILE_WALLET_PRODUCTION_ACCEPTANCE_2026-07-30.md`. It does not by itself close
canonical A1. A1 remains open only for the private, value-free attestation that
historical credentials and any genuine historical deployer key were rotated or
retired, and that the repository-history remediation decision was completed.
Secret values must never be placed in the public repository or acceptance report.

Removal of the isolated wallet bench is a separate post-acceptance cleanup task;
this evidence PR does not combine that cleanup with acceptance recording.
