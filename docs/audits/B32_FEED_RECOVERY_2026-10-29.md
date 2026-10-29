# B32 — Honest feed failure and retry presentation

Status: locally verified; release pending.
Scope: Phase B reliability, homepage/gallery read presentation. Canon sections
1 (projection truth), 5 (public display), 15/17 (operational readiness). No
contract, economic, permission, database, hosting or billing change.

## Reproduction and correction

B31 correctly returned HTTP 503 while Supabase restricted Data API access,
but the homepage and gallery still used the database client's non-strict mode.
That mode converted the failure into an empty array. Users saw an empty feed
or an invitation to publish instead of a failed read.

Both loaders now use the existing strict read mode. On initial failure they
show a short unavailable message and Retry. A failed refresh retains previously
loaded cards with an explicit stale-result notice. No automatic outage polling
was added. The latest request owns the result and retry state. Successful empty
responses retain their normal empty view; a later successful retry restores the
cards. Homepage metrics explicitly show unavailability and clear old values.

The behavioral test also exposed a related fallback bug: gallery status labels
were initialized below the useMemo that consumes them. Moving the constant
outside the component removes the temporal-dead-zone failure when the shared
card status helper is unavailable. Status meanings are unchanged.

## Verification

- 76 focused tests pass: public-feed-unavailable, data-prefetch, gallery-search,
  public-metrics-projection, auction-confirmed-reconciliation and
  artwork-indexer-projection-recovery.
- Six new behavior tests exercise cold failure, successful empty response,
  retry recovery, retaining cards, clearing/restoring statistics and stale
  responses on both homepage and gallery.
- Production build, 11-route verification and Tailwind verification pass.
- Chrome rendered the actual built homepage and gallery against an isolated
  local HTTP 503 fixture. Retry remains usable without fake empty results.
  At 390px, both Classic and Future display the message and button without
  horizontal overflow (body375 / viewport390 including scrollbar). Viewport
  restored afterward. This is browser layout evidence, not native iPhone proof.
- Screenshots and fixture are retained privately; no real wallet or provider
  write was used. Recovery and request races were exercised by the loader tests,
  not inferred from the still-restricted production service.

## Interpretation and limits

Retaining previously fetched public cards is presentation of last-known data,
not a claim that an auction or listing is still actionable. Existing live
contract checks remain authoritative before wallet requests. The patch does
not bypass the Supabase restriction or restore the live service.

The owner explicitly refused paid overage on October 29. Spend Cap stays
enabled; no chargeable setting, migration or support message is authorized by
this patch. B30 provider recovery remains open. Phase B is not complete.

Rollback: revert the reviewed B32 change; no data reversal is required. That
would restore misleading empty-state presentation and is not recommended.
