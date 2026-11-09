# B11 — Confirmed purchase feedback, November 9, 2026

## Observed defect

The artwork settlement and resale-purchase handlers performed a fresh RPC
artwork read after the wallet adapter had already confirmed the transaction.
That read only supplied legacy database writers which are permanently disabled.
An RPC failure therefore reached the transaction-failure alert, incorrectly
telling the buyer that the confirmed purchase failed and should be retried.

Resale purchases also lacked the confirmation notice already used by listing
changes. A delayed indexed response could keep the old Buy action visible,
including when the purchase originated in the assistant.

## Correction

- Remove both dead post-confirmation RPC/legacy-write blocks. Keep the indexed
  page refresh; its availability does not change a confirmed transaction result.
- Reuse the existing confirmed-resale bridge for a successfully purchased
  listing. Decode the captured Core contract's matching token event from the
  successful receipt, and immediately mark that listing inactive locally.
- Keep receipt decoding and local notification best-effort. They must never
  convert a successful transaction into a failure or require another RPC read.
- Retain indexed ownership, floor, metadata and provenance as authoritative.
  The local notice affects listing availability only and yields to indexed
  observations at the same or a later block.

These are frontend/adapter corrections under the existing settlement and
provenance rules. They change no contract, fees, custody, role or network policy.

## Verification and acceptance boundary

Behavioral regressions cover both original false-failure paths and genuine
transaction rejection. Receipt-level checks cover resale completion, cancelled
or reverted transactions, replacement receipts, wallet changes and unavailable
local refresh. The existing reconciliation tests cover stale API responses and
preserve indexed ownership and floor.

No real transaction was replayed. This correction does not replace the remaining
observed expired-settlement/default/re-auction journey or native-wallet checks.

Local verification on November 9: 188 focused tests passed with zero skips,
including the adapter, assistant dispatch, ID collision, auction reconciliation,
purchase-handler and runtime cache-version checks. The 11-route production build
and all 172 required CSS utilities passed. The four original adapter regressions
and two handler regressions were reproduced before their corrections.

The shared contract adapter is served as `contracts-integration.js?v=18` on all
five consuming pages. Its normalized content hash and version checks were
updated together. The release requires Linux/Windows CI and deployment checks;
local verification alone does not establish production release.

The full CI run also exposed an incomplete token-ID collision fixture: it had
neither a connected provider nor a successful purchase receipt. The fixture now
supplies those real adapter prerequisites and asserts account/chain checks for
both purchases, without bypassing the production wallet guard.

The existing local receipt bridge expires after two minutes. If receipt decoding
is unavailable, indexed refresh remains the fallback. Neither condition changes
the confirmed receipt result or authorizes a repeated transaction.
