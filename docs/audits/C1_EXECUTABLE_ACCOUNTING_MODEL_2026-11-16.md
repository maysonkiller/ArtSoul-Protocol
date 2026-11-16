# C1 — Executable issuance and refund model

Status: **implemented and locally verified abstract specification; replacement
architecture remains a draft and C1 remains open.** No Solidity, deployed state,
fees, authority, pause policy, dependency or network configuration changed.

The [Node test](../../test/c1-replacement-accounting-model.test.mjs) makes a bounded
part of [D1/D3](../architecture/C1_DECISION_INVARIANTS_2026-11-02.md) and the
[replacement boundaries](../architecture/C1_REPLACEMENT_BOUNDARIES_2026-11-16.md)
executable. It uses only built-in Node modules and is collected by the existing
unit-test runner. It does not duplicate the current-contract characterization or
claim to repair its demonstrated hazards.

## Modeled boundary

- Identity is `(chain, engine, local ID)`. An unconsumed issuance obligation or
  credit survives adding another deployment; identical local IDs do not collide.
  Issuance uses recorded Creator/First Collector/metadata and is consumed once.
  Missing, pending, no-bid, defaulted and wrong-source requests cannot issue.
- **Already-validated settlement and losing-deposit eligibility are input facts.**
  The model does not validate a purchase, choose a winner, decide when refund
  eligibility arises, or authenticate a real caller/signature. Its source check
  expresses the required binding; it is not an on-chain authorization proof.
- Each funded obligation occupies exactly one of locked deposit `D`, payable
  refund `O`, withdrawable credit `C`, or paid. Refund failure moves the full
  obligation into credit; failed withdrawal preserves it. Payment retains the
  original amount and creditor. Another deposit belonging to the same creditor
  remains independent. Refund execution does not require losing-bidder action.
- For every deployment, `D + O + C + paid = funded` and
  `balance + paid = funded + unsolicitedSurplus`; therefore `D + O + C <= balance`.
  Optional purchase prefunding and execution reserves are absent (`F = R = 0`).
  Surplus is not silently allocated to users or an operator.
- Batch limits and transfer success/failure are explicit test inputs. A rejecting
  recipient does not prevent the next bounded transfer; duplicate batch entries
  cannot pay twice. A credit cannot also be spent through the old refund path.
  Rejected/replayed commands preserve abstract state without selecting whether a
  future ABI must revert or return a no-op result.

Integral amounts, namespace labels and batch bounds are fixtures, not new
economic values, activated chains, governance roles or operational limits.
Fee splitting, rounding, winner default allocation, alternate refund recipients,
pause/deadline treatment and paid automation are intentionally outside this slice.

## Executed evidence

```text
node --test test/c1-replacement-accounting-model.test.mjs
```

November 16 result: **6 tests passed**, exit 0, approximately 3.6 seconds locally.
The generated case exhausts its finite abstraction: two deployments, two eligible
deposits per deployment, four locations per obligation and two independent
issuance flags. It visits **1,024 states**, checks **28,672 outgoing transitions**
and their immediate replays, and checks conservation/provenance and unchanged
unrelated-deployment state at every transition. The maximum shortest path to a
state is ten commands. Equivalent receipt orderings share a state; this is not
an enumeration of all transaction histories or possible protocol inputs.

Focused cases additionally cover the same engine/local ID in another logical
chain namespace, new deployment creation while old credits/issuance remain,
mixed success/failure batches, repeated batch IDs and non-refundable deposits.
Controlled corruptions prove the invariant checker rejects duplicate or missing
obligations, changed creditors/amounts, per-deployment insolvency hidden by another
deployment's balance, duplicate payout records and unscoped issuance identity.

The checks operate on atomic JavaScript transitions. They do not prove Solidity
storage, external-call rollback, reentrancy safety, gas bounds, signature validity,
actual settlement-before-mint payment checks, or live migration behavior. The
existing 55 contract characterization tests are a separate historical checkpoint;
they were not rerun or relabeled as replacement acceptance here.

## Next bounded action

Record the remaining topology/authority and pause/deadline choices, then specify
the exact native-ETH state and interface boundary before replacement Solidity.
Reuse these assertions against that implementation, adding real payment, callback,
batch-gas and atomic rollback cases. This model neither selects those unresolved
policies nor completes architecture sign-off. This evidence is linked under
canonical backlog C1; unrelated work is excluded from the integrating change.
