# Newsletter enrollment durability — local correction

TA-05, Collection Launch service draft. This handler remains absent from the
active route map. No service was enabled, email sent or migration applied.
Scope: the approved Collection Launch development amendment to Bible §17;
no protocol economics, eligibility, supply or deployment setting changed.

## Reproduction and correction

The previous handler sent a welcome before saving its unsubscribe-token hash.
A provider success followed by a database failure produced a link that could not
unsubscribe. A retry rotated the token, and the late unconditional upsert could
overwrite an intervening opt-out. The original handler failed 11 focused checks.

The handler now saves explicit consent and the token hash before requesting email.
A repeated active enrollment preserves its existing token and sends no new welcome.
An ordinary subscribe cannot reactivate an observed opt-out; explicit `resubscribe`
also requires consent and a conditional update of the observed record. First-time
inserts ignore a conflicting record instead of replacing it. An unsubscribe
consumes its capability so even equal timestamps cannot allow a stale conditional
update. Send completion never writes subscription state.
Independent review then reproduced a daily-quota trap: the response requesting
explicit resubscription consumed the only email allowance before confirmation.
The IP limit now guards every status response, while the daily email allowance
is consumed only for an actual enrollment/send attempt.

Interpretations made explicit:

- Subscription truth is saved consent, not email-provider acceptance.
- The response distinguishes `consent_recorded` and welcome `accepted` or
  `unconfirmed`. Provider acceptance does not claim delivery or a future retry.
- Concurrency ordering begins at the first database snapshot. This does not
  establish an ordering of HTTP arrivals across instances.
- A consumed unsubscribe link is an idempotent no-op and cannot cancel later,
  explicitly renewed consent with a new token.

These are service semantics, not a canon amendment. An outbox, confirmed email
ownership and real-provider/operator acceptance remain separate activation work.
A process failure after the durable save can lose the welcome email; the repair
does not claim exactly-once delivery or reliable background retries. Email and
unsubscribe capability handling must be reviewed before campaign integration.
Activation must also separate unsubscribe availability from the newsletter-send
flag and decide how to avoid revealing enrollment status through public responses;
these existing draft limitations are not approved production behavior.

## Evidence

- `output/audit/newsletter-durability-before.log`: 11 failures against the old
  handler; original reproduction retained.
- `output/audit/newsletter-consent-quota-before.log`: independent review's
  sequential consent/confirmation test failed before the quota correction.
- `output/audit/newsletter-durability-final.log`: 31 handler checks plus 19
  existing SQL security guards, **50 passed**, no failures or skips.
- `output/audit/continuation-newsletter-final-2026-09-27.log`: combined Node
  regression suite, **1,257 passed**, no failures/skips, including disposable
  PostgreSQL checks. Application/dependency source is the released revision
  plus this dormant handler and its tests; contracts were unchanged.
- The tests invoke the real handler with intercepted REST and provider requests.
  They cover database failure, an uncertain commit followed by retry, provider
  rejection/timeout, duplicate enrollment, competing inserts, opt-out races,
  token reuse, explicit resubscription, quotas and invalid configuration/input.
  No real provider, deployed PostgREST or user email address was used.

The existing schema is unchanged. Next activation work must verify actual
PostgREST conditional updates in an isolated service environment and complete
durable delivery/unsubscribe handling before wiring routes or requesting emails.
