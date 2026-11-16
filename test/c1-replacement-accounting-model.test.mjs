import assert from 'node:assert/strict';
import test from 'node:test';

// Executable C1 specification, not production code or current-contract acceptance.
// Verified settlement/refund eligibility are boundary inputs: this model does not
// establish payment validity, auction timing, governance or an issuer topology.
// Integral amounts and batch limits below are test vectors, not protocol settings.
const scope = deployment => JSON.stringify([deployment.chainId, deployment.engine]);
const identity = (deployment, id) => JSON.stringify([deployment.chainId, deployment.engine, id]);
const A = { chainId: '31337', engine: 'engine-a' };
const B = { chainId: '31337', engine: 'engine-b' };
const OTHER_CHAIN = { chainId: '31338', engine: 'engine-a' };
const buckets = ['deposits', 'refunds', 'credits'];

function emptyModel() {
  return { funds: new Map(), works: new Map(), balances: new Map(), surplus: new Map(),
    deposits: new Map(), refunds: new Map(), credits: new Map(), payments: [], minted: new Map(), mintReceipts: [] };
}

function addFixtureDeployment(model, deployment, amounts = [1n, 7n]) {
  const domain = scope(deployment);
  assert.ok(!model.balances.has(domain));
  // Unsolicited funds are not refundable deposits or an operator entitlement.
  model.surplus.set(domain, 3n);
  model.balances.set(domain, 3n);
  amounts.forEach((amount, i) => {
    const key = identity(deployment, String(i + 1));
    const fact = { domain, owner: `creditor-${i + 1}`, amount, refundable: true };
    model.funds.set(key, fact);
    model.deposits.set(key, structuredClone(fact));
    model.balances.set(domain, model.balances.get(domain) + amount);
  });
  model.works.set(identity(deployment, '1'), { domain, creator: `creator-${deployment.engine}`,
    metadata: `ipfs://model-${deployment.engine}`, outcome: 'settled', firstCollector: 'collector' });
  return model;
}

function pay(model, key, bucket) {
  const debt = model[bucket].get(key);
  model[bucket].delete(key);
  model.balances.set(debt.domain, model.balances.get(debt.domain) - debt.amount);
  model.payments.push({ key, domain: debt.domain, recipient: debt.owner, amount: debt.amount });
}

// Each command is one atomic abstract transition. A rejected/replayed command
// preserves state; that does not select revert versus no-op semantics for an ABI.
function transition(before, command) {
  const model = structuredClone(before);
  const key = identity(command.deployment, command.id);
  if (command.kind === 'refund') {
    const debt = model.deposits.get(key);
    if (debt?.refundable) {
      model.deposits.delete(key);
      model.refunds.set(key, debt);
    }
  } else if (command.kind === 'batch') {
    assert.ok(Number.isSafeInteger(command.limit) && command.limit > 0);
    for (const [id, succeeds] of command.entries.slice(0, command.limit)) {
      const obligation = identity(command.deployment, id);
      const debt = model.refunds.get(obligation);
      if (!debt) continue;
      assert.equal(typeof succeeds, 'boolean');
      if (succeeds) pay(model, obligation, 'refunds');
      else {
        model.refunds.delete(obligation);
        model.credits.set(obligation, debt);
      }
    }
  } else if (command.kind === 'withdraw') {
    const debt = model.credits.get(key);
    if (debt && command.caller === debt.owner) {
      assert.equal(typeof command.succeeds, 'boolean');
      if (command.succeeds) pay(model, key, 'credits');
    }
  } else if (command.kind === 'issue') {
    const work = model.works.get(key);
    if (work?.outcome === 'settled' && scope(command.source) === work.domain && !model.minted.has(key)) {
      const provenance = { domain: work.domain, creator: work.creator, firstCollector: work.firstCollector,
        recipient: work.firstCollector, metadata: work.metadata };
      model.minted.set(key, provenance);
      model.mintReceipts.push({ key, ...provenance });
    }
  } else assert.fail('Unknown model command');
  return model;
}

function assertInvariants(model) {
  // Check against the original funding facts, independently of the transition.
  for (const [key, fact] of model.funds) {
    const debts = buckets.filter(bucket => model[bucket].has(key));
    const paid = model.payments.filter(payment => payment.key === key);
    assert.equal(debts.length + paid.length, 1, 'exactly one location for each funded obligation');
    for (const bucket of debts) {
      assert.deepEqual(model[bucket].get(key), fact, 'debt retains full amount and creditor');
      if (bucket !== 'deposits') assert.equal(fact.refundable, true);
    }
    for (const payment of paid) {
      assert.deepEqual(payment, { key, domain: fact.domain, recipient: fact.owner, amount: fact.amount },
        'payment cannot substitute creditor, value or deployment');
      assert.equal(fact.refundable, true);
    }
  }
  for (const bucket of buckets) for (const key of model[bucket].keys()) assert.ok(model.funds.has(key));
  for (const payment of model.payments) assert.ok(model.funds.has(payment.key));
  for (const [domain, balance] of model.balances) {
    const sum = records => records.filter(record => record.domain === domain).reduce((n, row) => n + row.amount, 0n);
    const funded = sum([...model.funds.values()]);
    const paid = sum(model.payments);
    const liabilities = buckets.reduce((n, bucket) => n + sum([...model[bucket].values()]), 0n);
    assert.equal(liabilities + paid, funded, 'every deposited unit is owed or paid exactly once');
    assert.equal(balance + paid, funded + model.surplus.get(domain), 'custody is conserved per deployment');
    assert.ok(liabilities <= balance, 'solvency does not depend on another deployment');
  }
  assert.equal(model.mintReceipts.length, model.minted.size, 'one issuance receipt per work');
  assert.equal(new Set(model.mintReceipts.map(receipt => receipt.key)).size, model.mintReceipts.length);
  for (const [key, minted] of model.minted) {
    const work = model.works.get(key);
    assert.equal(work?.outcome, 'settled', 'issuance requires a recorded successful obligation');
    assert.deepEqual(minted, { domain: work.domain, creator: work.creator, firstCollector: work.firstCollector,
      recipient: work.firstCollector, metadata: work.metadata });
    assert.deepEqual(model.mintReceipts.find(receipt => receipt.key === key), { key, ...minted });
  }
}

function deploymentState(model, deployment) {
  const domain = scope(deployment);
  const inDomain = records => [...records].filter(([, value]) => value.domain === domain);
  return { balance: model.balances.get(domain), surplus: model.surplus.get(domain),
    ...Object.fromEntries(['funds', 'works', ...buckets, 'minted'].map(name => [name, inDomain(model[name])])),
    payments: model.payments.filter(row => row.domain === domain),
    mintReceipts: model.mintReceipts.filter(row => row.domain === domain) };
}

const refund = (deployment, id) => ({ kind: 'refund', deployment, id });
const batch = (deployment, entries, limit) => ({ kind: 'batch', deployment, entries, limit });
const withdraw = (deployment, id, caller, succeeds) => ({ kind: 'withdraw', deployment, id, caller, succeeds });
const issue = (deployment, id = '1', source = deployment) => ({ kind: 'issue', deployment, id, source });

test('C1 model keeps old obligations and local artwork IDs independent across engines and chains', () => {
  let model = addFixtureDeployment(emptyModel(), A);
  model = transition(model, refund(A, '1'));
  model = transition(model, batch(A, [['1', false]], 1));
  const old = deploymentState(model, A);
  addFixtureDeployment(model, B);
  addFixtureDeployment(model, OTHER_CHAIN);
  assert.deepEqual(deploymentState(model, A), old, 'adding a namespace does not rotate or erase old rights');
  for (const deployment of [B, OTHER_CHAIN]) {
    const wrongSource = transition(model, issue(deployment, '1', A));
    assert.deepEqual(wrongSource, model, 'an old source cannot issue a new deployment obligation');
    model = transition(model, issue(deployment));
    assert.deepEqual(deploymentState(model, A), old);
  }
  model = transition(model, issue(A));
  model = transition(model, withdraw(A, '1', 'creditor-1', true));
  assert.equal(model.minted.size, 3);
  assert.equal(model.payments.length, 1);
  assertInvariants(model);
});

test('C1 model cannot issue missing, no-bid, defaulted, wrong-source or consumed obligations', () => {
  let model = addFixtureDeployment(emptyModel(), A);
  for (const outcome of ['pending', 'no-bid', 'defaulted']) {
    model.works.set(identity(A, outcome), { ...model.works.get(identity(A, '1')), outcome });
    assert.deepEqual(transition(model, issue(A, outcome)), model);
  }
  assert.deepEqual(transition(model, issue(A, 'missing')), model);
  assert.deepEqual(transition(model, issue(A, '1', B)), model);
  model = transition(model, { ...issue(A), recipient: 'outsider', creator: 'outsider', metadata: 'substitute' });
  assert.equal(model.minted.get(identity(A, '1')).recipient, 'collector', 'provenance comes from the obligation');
  assert.deepEqual(transition(model, issue(A)), model);
  assertInvariants(model);
});

test('C1 model bounds mixed refund batches and retains full failed payments for the creditor', () => {
  let model = addFixtureDeployment(emptyModel(), A, [1n, 7n, 13n]);
  for (const id of ['1', '2', '3']) model = transition(model, refund(A, id));
  model = transition(model, batch(A, [['1', false], ['2', true], ['3', true]], 2));
  assert.equal(model.credits.get(identity(A, '1')).amount, 1n);
  assert.equal(model.payments.length, 1, 'one rejecting creditor does not stop the next refund');
  assert.equal(model.refunds.get(identity(A, '3')).amount, 13n, 'the explicit batch bound leaves later work pending');
  assert.deepEqual(transition(model, withdraw(A, '1', 'outsider', true)), model);
  assert.deepEqual(transition(model, withdraw(A, '1', 'creditor-1', false)), model);
  assert.deepEqual(transition(model, batch(A, [['1', true]], 1)), model, 'credit cannot also be paid by the old refund route');
  model = transition(model, withdraw(A, '1', 'creditor-1', true));
  model = transition(model, batch(A, [['3', true], ['3', true]], 2));
  assert.equal(model.payments.length, 3);
  assert.equal(model.balances.get(scope(A)), 3n, 'unsolicited surplus is not assigned to a creditor');
  for (const id of ['1', '2', '3']) assert.deepEqual(transition(model, refund(A, id)), model);
  assertInvariants(model);
});

test('C1 model does not infer refund eligibility or share credit between deposits of one creditor', () => {
  let model = addFixtureDeployment(emptyModel(), A);
  const locked = identity(A, '2');
  model.funds.get(locked).refundable = false;
  model.deposits.get(locked).refundable = false;
  model.funds.get(locked).owner = 'creditor-1';
  model.deposits.get(locked).owner = 'creditor-1';
  assert.deepEqual(transition(model, refund(A, '2')), model);
  model = transition(model, refund(A, '1'));
  model = transition(model, batch(A, [['1', false]], 1));
  model = transition(model, withdraw(A, '1', 'creditor-1', true));
  assert.equal(model.deposits.get(locked).amount, 7n);
  assertInvariants(model);
});

test('C1 accounting oracle detects duplicate, missing, diverted and cross-deployment obligations', () => {
  let model = addFixtureDeployment(addFixtureDeployment(emptyModel(), A), B);
  model = transition(model, refund(A, '1'));
  const key = identity(A, '1');
  for (const corrupt of [
    broken => broken.credits.set(key, broken.refunds.get(key)),
    broken => broken.refunds.delete(key),
    broken => { broken.refunds.get(key).owner = 'outsider'; },
    broken => { broken.refunds.get(key).amount -= 1n; },
    broken => { broken.balances.set(scope(A), 0n); broken.balances.set(scope(B), 22n); }
  ]) {
    const broken = structuredClone(model); corrupt(broken);
    assert.throws(() => assertInvariants(broken), assert.AssertionError);
  }
  model = transition(model, batch(A, [['1', true]], 1));
  const duplicate = structuredClone(model); duplicate.payments.push(duplicate.payments[0]);
  assert.throws(() => assertInvariants(duplicate), assert.AssertionError);
  model = transition(model, issue(A));
  const unscoped = structuredClone(model);
  unscoped.minted.set('1', unscoped.minted.get(key)); unscoped.minted.delete(key);
  assert.throws(() => assertInvariants(unscoped), assert.AssertionError);
});

test('C1 model explores every bounded ledger state with replay and deployment isolation checks', t => {
  const initial = addFixtureDeployment(addFixtureDeployment(emptyModel(), A), B);
  const commands = [];
  for (const deployment of [A, B]) {
    for (const id of ['1', '2']) commands.push(refund(deployment, id),
      batch(deployment, [[id, true]], 1), batch(deployment, [[id, false]], 1),
      withdraw(deployment, id, `creditor-${id}`, true), withdraw(deployment, id, `creditor-${id}`, false),
      withdraw(deployment, id, 'outsider', true));
    commands.push(issue(deployment), issue(deployment, '1', deployment === A ? B : A));
  }
  // Collapse equivalent histories by obligation location and consumed issuance;
  // recipient order is not a new economic state. Every outgoing edge is checked.
  const fingerprint = model => JSON.stringify([
    [...model.funds.keys()].map(key => buckets.find(bucket => model[bucket].has(key)) || 'paid'),
    [...model.works.keys()].map(key => model.minted.has(key))
  ]);
  const queue = [{ model: initial, depth: 0 }], seen = new Set([fingerprint(initial)]);
  let attempts = 0, maximumDepth = 0;
  assertInvariants(initial);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const { model, depth } = queue[cursor];
    maximumDepth = Math.max(maximumDepth, depth);
    for (const command of commands) {
      const next = transition(model, command);
      assertInvariants(next);
      const other = command.deployment === A ? B : A;
      assert.deepEqual(deploymentState(next, other), deploymentState(model, other));
      assert.deepEqual(transition(next, command), next, 'a repeated single-obligation action cannot pay or issue twice');
      attempts++;
      const key = fingerprint(next);
      if (!seen.has(key)) { seen.add(key); queue.push({ model: next, depth: depth + 1 }); }
      assert.ok(seen.size <= 1024, 'four obligations with four locations and two issuance flags bound the graph');
    }
  }
  assert.equal(seen.size, 1024);
  assert.equal(attempts, 28672);
  assert.equal(maximumDepth, 10);
  t.diagnostic(`${seen.size} states; ${attempts} transitions plus immediate replays; maximum shortest path ${maximumDepth}`);
});
