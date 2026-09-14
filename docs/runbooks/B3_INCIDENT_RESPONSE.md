# B-03 — what to watch during the beta, and what to do about it

A public beta is the first time people who are not the founder depend on this
working. This runbook answers two questions for each of the six things B-03
names: how do you find out, and what do you do.

It is written for somebody holding a phone with no terminal. Everything in
section 1 is a URL. The deeper reads that need SSH to the indexer host live in
[`A9_INFRA_COST_MONITORING.md`](A9_INFRA_COST_MONITORING.md), which this file
points at rather than repeats.

**One rule above all the steps below.** Never advance the indexer cursor or
clear an `event_processing_registry` row to unstick anything. The stall is the
symptom, not the fault, and A-15 exists because doing that silently skipped
events.

---

## 1. The three-minute check

| # | Open | Healthy looks like |
| --- | --- | --- |
| 1 | `artsoulprotocol.com` | The gallery paints. Cards have images. |
| 2 | `artsoulprotocol.com/api/public/indexer-status` | Base Sepolia: `"liveness": "healthy"`. Ethereum Sepolia: `"liveness": "stopped_by_design"`. `warnings` is `[]`. |
| 3 | `artsoulprotocol.com/api/public/artworks?limit=1` | `"success": true` with one row whose `network` is `baseSepolia`. |

If all three pass, nothing below applies.

### Reading `liveness`

It measures the clock, not the block. `last_indexed_at` advances on every
processed block range, so a quiet chain still keeps it fresh.

| Value | Meaning | Go to |
| --- | --- | --- |
| `healthy` | A range was processed within 120 seconds. | — |
| `degraded` | Nothing for 2 to 10 minutes. | §3 |
| `stalled` | Nothing for over 10 minutes. | §3 |
| `stopped_by_design` | The chain's indexer is deliberately off. Ethereum Sepolia only. | — |
| `unknown` | No usable timestamp. Treat as `stalled`. | §3 |

`seconds_since_last_indexed` can be up to 60 seconds older than the truth,
because the response is edge-cached. The thresholds already absorb that, and
the response states them so this file cannot drift from the code.

**Do not read `lag_to_observed_block` as a health signal.** It compares the
projection against its own newest row, so it reads 0 when the indexer has
stopped writing. It is useful only alongside a `healthy` verdict, where it means
the indexer is running and behind.

---

## 2. Site down or broken for visitors

**Find out:** step 1 above fails, or a tester says so.

**Do:**

1. Check whether it is the page or the data. Open
   `artsoulprotocol.com/api/public/artworks?limit=1`. If that answers, the
   serverless side is alive and the problem is the front end.
2. Check the most recent deployment in Vercel. If a deploy landed in the last
   hour, roll back to the previous one before diagnosing further. A rollback is
   cheap and reversible; a live debug session with users watching is not.
3. If the API is also down, check the Supabase project status. An exhausted
   plan quota or a paused project takes the API with it.
4. Tell the cohort. A beta tester who knows it is being worked on does not file
   five reports.

**Escalate:** if a rollback does not restore it, preserve the failing
deployment's logs before deploying anything new.

---

## 3. The indexer is behind or stopped

**Find out:** `liveness` is `degraded`, `stalled` or `unknown`.

Auctions, bids and settlements come from the projection, so a stalled indexer
means the site shows stale auction state while the chain moves on. People see
their bid disappear. This is the incident that most damages trust in a beta.

**Do:**

1. Note `last_indexed_block` and `last_indexed_at` **before** touching
   anything. Write them down.
2. SSH to the indexer host and read the authenticated health JSON, per
   [`A9_INFRA_COST_MONITORING.md`](A9_INFRA_COST_MONITORING.md) §Repository
   health check. It separates the three causes that look identical from outside:
   - `unresolvedErrors` above zero with an `eventFailures` breakdown: an event
     was scanned and never applied, and the cursor is **intentionally** stalled.
     Go to §4.
   - `BLOCK_LAG` or `RPC_ERRORS` climbing: the RPC is the problem, not the
     indexer. A9 §Incident response has the steps.
   - Process not running: PM2 restart. Preserve the logs and the cursor first.
3. After any restart, watch `liveness` return to `healthy` on the public
   endpoint, and confirm `last_indexed_block` is advancing rather than merely
   fresh.

**Never:** raise the polling frequency as a first response, and never reset the
cursor.

---

## 4. An event failed to process

**Find out:** `unresolvedErrors` above zero, or a cursor that is stalled while
the process is healthy.

The indexer fails closed by design: a poisoned event stops the cursor rather
than being skipped. The stalled cursor **is** the alarm working.

**Do:** follow A9 §Event-failure model. Capture the `transaction_hash`,
`log_index` and `processing_error` from `event_processing_registry` before any
change, fix the handler defect, and redeploy. The range retries itself.

**Never** clear the row or advance the cursor. That reintroduces the silent skip
A-15 was built to prevent.

---

## 5. Cost

**Find out:** the founder's monthly review, plus any Supabase or Alchemy usage
alert.

Running cost during the beta is roughly 150 to 200 USD a month across Vercel,
Supabase and the Hetzner indexer host, with no revenue against it. A cost
incident in a beta is usually a new uncached consumer, not growth.

**Do:** A9 §Incident response covers the signals and the order. Its first rule
holds here: revert the new uncached consumer before considering a plan change,
and keep the Supabase spend cap on.

---

## 6. Moderation

**Find out:** the review queue, once moderation is activated.

Moderation is built and merged behind a disabled feature flag with its migration
unapplied, per A-39 and RG-03. **Until that activation ceremony runs there is no
queue to watch, and nothing in this section applies.**

`artsoulprotocol.com/api/public/config` reports `reportingEnabled`, which is how
to tell from a phone whether report intake is on. It is the flag, not the queue.

After activation:

1. A report in `pending_review` that nobody has looked at is the signal. Canon
   12 makes the complaint-driven flow the primary mechanism, so an unattended
   queue is the failure mode, not a full one.
2. A valid claim hides the artwork pending review. That is expected and is not
   an incident.
3. Critical or irreversible actions need multisig, not a single operator. If an
   incident seems to call for one, it calls for the ceremony in
   [`A8_MODERATION_ROLLOUT.md`](A8_MODERATION_ROLLOUT.md) instead.

---

## 7. Cached public metrics

**Find out:** the homepage figures disagree with the chain, or look frozen.

Public metrics are a cached projection. Stale metrics are a display problem,
never a settlement or floor problem: canon keeps those on chain.

**Do:** confirm the indexer is healthy first (§3), since metrics derive from the
projection. If the indexer is healthy and the numbers are not moving, the
rollout and rollback steps are in
[`A11_PUBLIC_METRICS_ROLLOUT.md`](A11_PUBLIC_METRICS_ROLLOUT.md).

**Never** present a cached number as a settlement outcome in a report to
testers, a grant application or investor material.

---

## Recording an incident

One entry per incident, in this file, appended below. Short is fine. What
matters is that the next person can tell whether it has happened before.

| Date | Signal | What it was | What was done | Time to healthy |
| --- | --- | --- | --- | --- |
| | | | | |
