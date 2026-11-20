import assert from 'node:assert/strict';
import test from 'node:test';

// Executable C1 specification, not production code or current-contract acceptance.
// The generated graph takes eligibility as input. The round-history cases derive
// losing deposits from accepted bids. Time eligibility is supplied by the test.
// Integral amounts and batch limits below are test vectors, not protocol settings.
const scope = deployment => JSON.stringify([deployment.chainId, deployment.engine]);
const identity = (deployment, id) => JSON.stringify([deployment.chainId, deployment.engine, id]);
const A = { chainId: '31337', engine: 'engine-a' };
const B = { chainId: '31337', engine: 'engine-b' };
const OTHER_CHAIN = { chainId: '31338', engine: 'engine-a' };
const buckets = ['deposits', 'refunds', 'credits'];
const offerWindow = 24 * 60 * 60;

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

function issueSettledWork(model, key, source) {
  const work = model.works.get(key);
  if (work?.outcome !== 'settled' || scope(source) !== work.domain || model.minted.has(key)) return;
  const provenance = { domain: work.domain, creator: work.creator, firstCollector: work.firstCollector,
    recipient: work.firstCollector, metadata: work.metadata };
  model.minted.set(key, provenance);
  model.mintReceipts.push({ key, ...provenance });
}

// Apply a bid that already passed the round's validation. The sequence number
// identifies a funding occurrence in the fixture, including repeat bidders.
function recordAcceptedBid(model, deployment, roundId, bidder, price, deposit) {
  const round = model.works.get(identity(deployment, roundId));
  assert.equal(round.outcome, 'bidding');
  if (round.winner) {
    const previous = identity(deployment, `${roundId}/bid/${round.bidCount}`);
    const debt = { domain: round.domain, owner: round.winner, amount: round.lockedDeposit, refundable: true };
    model.funds.set(previous, { ...debt });
    model.refunds.set(previous, debt);
  }
  round.bidCount++;
  round.bidHistory ??= [];
  round.bidHistory.push({ bidder, price });
  round.winner = bidder;
  round.price = price;
  round.initialDeposit = deposit;
  round.lockedDeposit = deposit;
  model.balances.set(round.domain, model.balances.get(round.domain) + deposit);
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
  } else if (command.kind === 'close-funded') {
    const work = model.works.get(key);
    if (work?.outcome === 'bidding' && work.winner && command.biddingEnded) work.outcome = 'payment-pending';
  } else if (command.kind === 'default') {
    const work = model.works.get(key);
    if (work?.outcome !== 'payment-pending' || !command.paymentExpired) return model;
    // These vectors divide exactly. Keep dust assignment outside this specification.
    assert.equal(work.lockedDeposit % 5n, 0n);
    const protocol = work.lockedDeposit / 5n;
    work.defaultAllocation = { creator: work.lockedDeposit - protocol, protocol };
    work.lockedDeposit = 0n;
    // Accepted prices strictly increase. Derive eligibility from the bid history.
    const runnerUp = work.bidHistory.findLast(bid => bid.bidder !== work.winner);
    if (runnerUp) {
      assert.ok(Number.isSafeInteger(command.now));
      work.offer = { ...runnerUp, deadline: command.now + offerWindow };
      work.outcome = 'runner-up-offered';
    } else work.outcome = 'defaulted';
  } else if (command.kind === 'decline-offer' || command.kind === 'expire-offer') {
    const work = model.works.get(key);
    if (work?.outcome !== 'runner-up-offered') return model;
    assert.ok(Number.isSafeInteger(command.now));
    if (command.kind === 'expire-offer' ? command.now <= work.offer.deadline :
      command.caller !== work.offer.bidder || command.now > work.offer.deadline) return model;
    work.outcome = 'defaulted';
  } else if (command.kind === 'settle' || command.kind === 'accept-offer') {
    const work = model.works.get(key);
    const useOffer = command.kind === 'accept-offer';
    if (work?.outcome !== (useOffer ? 'runner-up-offered' : 'payment-pending')) return model;
    if (useOffer) {
      assert.ok(Number.isSafeInteger(command.now));
      if (command.now > work.offer.deadline) return model;
    }
    const collector = useOffer ? work.offer.bidder : work.winner;
    const price = useOffer ? work.offer.price : work.price;
    if (command.caller !== collector) return model;
    const credited = work.lockedDeposit < price ? work.lockedDeposit : price;
    if (command.value !== price - credited) return model;
    work.outcome = 'settled';
    work.firstCollector = collector;
    work.floor = price;
    // Freeze aggregate proceeds here. Allocating fee rounding is a separate decision.
    work.settlement = { received: command.value, proceeds: price,
      winnerCredit: work.lockedDeposit - credited, creditOwner: collector };
    work.lockedDeposit = 0n;
    model.balances.set(work.domain, model.balances.get(work.domain) + command.value);
    issueSettledWork(model, key, command.deployment);
  } else if (command.kind === 'issue') {
    issueSettledWork(model, key, command.source);
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
    const purchases = [...model.works.values()].filter(work => work.domain === domain && work.initialDeposit !== undefined);
    let purchaseFunding = 0n, purchaseLiabilities = 0n;
    for (const work of purchases) {
      const settlement = work.settlement;
      purchaseFunding += work.initialDeposit + (settlement?.received ?? 0n);
      purchaseLiabilities += work.lockedDeposit + (settlement?.proceeds ?? 0n) + (settlement?.winnerCredit ?? 0n);
      if (work.defaultAllocation) purchaseLiabilities += work.defaultAllocation.creator + work.defaultAllocation.protocol;
    }
    const funded = sum([...model.funds.values()]) + purchaseFunding;
    const paid = sum(model.payments);
    const liabilities = buckets.reduce((n, bucket) => n + sum([...model[bucket].values()]), purchaseLiabilities);
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

test('C1 direct settlement consumes only the winning deposit and exact remaining payment, then sets the floor and issues once', () => {
  for (const [price, due, excess] of [[3n, 0n, 4n], [7n, 0n, 0n], [8n, 1n, 0n], [19n, 12n, 0n]]) {
    const before = addFixtureDeployment(emptyModel(), A, []);
    const fundedWork = { domain: scope(A), creator: 'artist', metadata: 'ipfs://work', outcome: 'payment-pending',
      winner: 'collector', price, initialDeposit: 7n, lockedDeposit: 7n };
    const key = identity(A, '2'), otherKey = identity(A, '3');
    before.works.set(key, fundedWork);
    before.works.set(otherKey, { ...fundedWork, initialDeposit: 50n, lockedDeposit: 50n });
    before.balances.set(scope(A), before.surplus.get(scope(A)) + 7n + 50n);
    const settle = (caller, value) => ({ kind: 'settle', deployment: A, id: '2', caller, value });
    assertInvariants(before);
    assert.deepEqual(transition(before, issue(A, '2')), before);
    assert.deepEqual(transition(before, settle('other-wallet', due)), before);
    assert.deepEqual(transition(before, settle('collector', due + 1n)), before);
    if (due > 0n) {
      assert.deepEqual(transition(before, settle('collector', due - 1n)), before);
      assert.deepEqual(transition(before, settle('collector', 0n)), before, 'another deposit cannot complete this purchase');
    }
    const after = transition(before, settle('collector', due));
    const work = after.works.get(key);
    assert.equal(work.outcome, 'settled');
    assert.equal(work.lockedDeposit, 0n);
    assert.equal(work.floor, price);
    assert.deepEqual(work.settlement, { received: due, proceeds: price, winnerCredit: excess, creditOwner: 'collector' });
    assert.deepEqual(after.works.get(otherKey), before.works.get(otherKey));
    assert.equal(after.mintReceipts.length, 1);
    assert.equal(after.minted.get(key).recipient, 'collector');
    assert.equal(after.balances.get(scope(A)), before.balances.get(scope(A)) + due);
    assertInvariants(after);
    assert.deepEqual(transition(after, settle('collector', due)), after);
    assert.deepEqual(transition(after, issue(A, '2')), after);
  }
});

// Ordinary unminted works in one deployment, with entry open. Validated terms
// and chain time are inputs. The replacement's pause and gas rules stay open.
function advanceNoBidAuction(before, command, now) {
  const work = before.works.get(command.workId);
  if (!work || work.minted) return before;
  const relisting = command.kind === 'relist';
  if (relisting) {
    if (command.caller !== work.creator || !command.terms) return before;
  } else {
    assert.equal(command.kind, 'finalize');
    if (!work.activeAuction || command.auctionId !== work.activeAuction) return before;
  }
  const active = before.auctions.get(work.activeAuction);
  if (work.activeAuction && (!active || active.workId !== command.workId || active.status !== 'open' ||
    now < active.end || active.winner !== null || active.deposit !== 0n)) return before;

  const after = structuredClone(before);
  const nextWork = after.works.get(command.workId);
  if (active) {
    after.auctions.get(work.activeAuction).status = 'closed-no-bid';
    after.events.push({ kind: 'closed-no-bid', workId: command.workId, auctionId: work.activeAuction });
    nextWork.activeAuction = null;
  }
  if (relisting) {
    const id = ++after.lastAuctionId;
    after.auctions.set(id, { workId: command.workId, status: 'open', winner: null, deposit: 0n,
      startPrice: command.terms.startPrice, end: now + command.terms.duration });
    nextWork.activeAuction = id;
    after.events.push({ kind: 'opened', workId: command.workId, auctionId: id });
  }
  return after;
}

test('C2/C11 no-bid cleanup preserves creator-only relisting and produces the same auction history in one or two calls', () => {
  const end = 24 * 60 * 60;
  const terms = { duration: 36 * 60 * 60, startPrice: 3n };
  const work = { creator: 'artist', minted: false, floor: 0n, activeAuction: 1 };
  const auction = { workId: 'art', status: 'open', winner: null, deposit: 0n, startPrice: 1n, end };
  const before = {
    works: new Map([['art', work], ['second', { ...work, activeAuction: 2 }]]),
    auctions: new Map([[1, auction], [2, { ...auction, workId: 'second', winner: 'collector', deposit: 7n }]]),
    lastAuctionId: 2, events: []
  };
  const initial = structuredClone(before);
  const finalize = { kind: 'finalize', caller: 'observer', workId: 'art', auctionId: 1 };
  const relist = { kind: 'relist', caller: 'artist', workId: 'art', terms };
  for (const command of [finalize, relist]) {
    assert.deepEqual(advanceNoBidAuction(before, command, end - 1), before);
    assert.deepEqual(advanceNoBidAuction(before, { ...command, workId: 'second', auctionId: 2 }, end), before);
  }
  assert.deepEqual(advanceNoBidAuction(before, { ...relist, caller: 'observer' }, end), before);
  assert.deepEqual(advanceNoBidAuction(before, { ...relist, terms: null }, end), before);

  const closed = advanceNoBidAuction(before, finalize, end);
  assert.deepEqual(closed.events, [{ kind: 'closed-no-bid', workId: 'art', auctionId: 1 }]);
  assert.deepEqual(closed.works.get('art'), { ...work, activeAuction: null });
  assert.equal(closed.auctions.get(1).status, 'closed-no-bid');
  assert.deepEqual(advanceNoBidAuction(closed, finalize, end), closed);
  assert.deepEqual(advanceNoBidAuction(closed, { ...relist, caller: 'observer' }, end), closed);

  const reopened = advanceNoBidAuction(before, relist, end);
  assert.deepEqual(reopened, advanceNoBidAuction(closed, relist, end));
  assert.deepEqual(reopened.events, [...closed.events, { kind: 'opened', workId: 'art', auctionId: 3 }]);
  assert.deepEqual(reopened.works.get('art'), { ...work, activeAuction: 3 });
  assert.deepEqual(reopened.auctions.get(3), { ...auction, startPrice: terms.startPrice, end: end + terms.duration });
  assert.deepEqual(reopened.works.get('second'), before.works.get('second'));
  assert.deepEqual(reopened.auctions.get(2), before.auctions.get(2));
  assert.deepEqual(advanceNoBidAuction(reopened, relist, end), reopened);
  assert.deepEqual(advanceNoBidAuction(reopened, finalize, end + terms.duration), reopened);
  assert.deepEqual(before, initial);
});

test('C1 model keeps old obligations and local artwork IDs independent across engines and chains', () => {
  let model = addFixtureDeployment(emptyModel(), A);
  model = transition(model, issue(A));
  model = transition(model, refund(A, '1'));
  model = transition(model, batch(A, [['1', false]], 1));
  const openRound = identity(A, '2');
  model.works.set(openRound, { domain: scope(A), creator: 'artist', metadata: 'ipfs://pending',
    outcome: 'bidding', bidCount: 0, floor: 0n });
  recordAcceptedBid(model, A, '2', 'other-collector', 10n, 5n);
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
  assert.equal(model.minted.get(identity(A, '1')).recipient, 'collector');
  assert.deepEqual(transition(model, issue(A)), model);
  model = transition(model, { kind: 'close-funded', deployment: A, id: '2', biddingEnded: true });
  model = transition(model, { kind: 'settle', deployment: A, id: '2', caller: 'other-collector', value: 5n });
  assert.equal(model.minted.get(openRound).recipient, 'other-collector');
  model = transition(model, withdraw(A, '1', 'creditor-1', true));
  assert.equal(model.minted.size, 4);
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

test('C2/C11 a returning winner keeps earlier refunds through settlement or default', () => {
  const round = 'round-42', key = identity(A, round);
  const unit = 10n ** 16n; // 0.01 ETH in wei
  const id = sequence => `${round}/bid/${sequence}`;
  const bidding = addFixtureDeployment(emptyModel(), A, []);
  bidding.works.set(key, { domain: scope(A), creator: 'artist', metadata: 'ipfs://round-art',
    outcome: 'bidding', bidCount: 0, winner: null, floor: null });
  recordAcceptedBid(bidding, A, round, 'alice', 10n * unit, unit);
  recordAcceptedBid(bidding, A, round, 'bob', 20n * unit, 2n * unit);
  recordAcceptedBid(bidding, A, round, 'carol', 30n * unit, 3n * unit);
  const firstBatch = batch(A, [[id(1), false], [id(2), true]], 2);
  const close = { kind: 'close-funded', deployment: A, id: round, biddingEnded: true };
  const lapse = { kind: 'default', deployment: A, id: round, paymentExpired: true, now: 200_000 };
  const settle = { kind: 'settle', deployment: A, id: round, caller: 'alice', value: 36n * unit };
  for (const earlyBatch of [false, true]) {
    const model = earlyBatch ? transition(bidding, firstBatch) : structuredClone(bidding);
    recordAcceptedBid(model, A, round, 'alice', 40n * unit, 4n * unit);
    assertInvariants(model);
    assert.deepEqual(transition(model, { ...close, biddingEnded: false }), model);
    const closed = transition(model, close);
    assert.equal(closed.works.get(key).outcome, 'payment-pending');
    assert.deepEqual(transition(closed, close), closed);
    assert.deepEqual(transition(closed, { ...lapse, paymentExpired: false }), closed);
    assert.deepEqual(transition(closed, { ...settle, value: 35n * unit }), closed,
      'the earlier losing deposit cannot fund a later winning bid');
    assert.deepEqual(transition(closed, { ...settle, value: 40n * unit }), closed,
      'the winner cannot be charged the gross price on top of the locked deposit');
    assert.equal(closed.payments.length, earlyBatch ? 1 : 0);
    assert.equal(closed.credits.size, earlyBatch ? 1 : 0);
    assert.equal(closed.refunds.size, earlyBatch ? 1 : 3);

    for (const terminal of [settle, lapse]) {
      let result = transition(closed, terminal);
      const work = result.works.get(key);
      assert.equal(work.lockedDeposit, 0n);
      if (terminal.kind === 'settle') {
        assert.equal(work.floor, 40n * unit);
        assert.equal(result.minted.get(key).firstCollector, 'alice');
        assert.equal(work.settlement.proceeds, 40n * unit);
      } else {
        assert.deepEqual(work.defaultAllocation, { creator: 32_000_000_000_000_000n, protocol: 8_000_000_000_000_000n });
        assert.equal(work.floor, null);
        assert.equal(result.minted.has(key), false);
      }
      assert.deepEqual(result.refunds, closed.refunds);
      assert.deepEqual(result.credits, closed.credits);
      assert.deepEqual(result.payments, closed.payments);
      assertInvariants(result);
      // First execution for the deferred schedule, replay for the early schedule.
      result = transition(result, firstBatch);
      result = transition(result, batch(A, [[id(1), true], [id(2), true], [id(3), true], [id(4), true]], 4));
      result = transition(result, withdraw(A, id(1), 'alice', true));
      assert.deepEqual(result.payments.map(p => [p.key, p.recipient, p.amount]), [
        [identity(A, id(2)), 'bob', 2n * unit],
        [identity(A, id(3)), 'carol', 3n * unit],
        [identity(A, id(1)), 'alice', unit]
      ]);
      assert.equal(result.credits.size, 0);
      assert.equal(result.refunds.size, 0);
      assertInvariants(result);
      for (const replay of [close, settle, lapse, batch(A, [[id(3), true]], 1), withdraw(A, id(1), 'alice', true)]) {
        assert.deepEqual(transition(result, replay), result);
      }
    }
  }
});

test('C2/C11 only the runner-up can buy at their last bid while every losing deposit remains independently refundable', () => {
  const round = 'offer-round', key = identity(A, round);
  const command = (kind, args = {}) => ({ kind, deployment: A, id: round, ...args });
  const close = command('close-funded', { biddingEnded: true });
  const recordedAt = 500_000;
  const lapse = command('default', { paymentExpired: true, now: recordedAt });
  const bidding = addFixtureDeployment(emptyModel(), A, []);
  bidding.works.set(key, { domain: scope(A), creator: 'artist', metadata: 'ipfs://offer-art',
    outcome: 'bidding', bidCount: 0, floor: null });
  recordAcceptedBid(bidding, A, round, 'bob', 100n, 10n);
  const loneDefault = transition(transition(bidding, close), lapse);
  assert.equal(loneDefault.works.get(key).outcome, 'defaulted');
  assert.equal(loneDefault.works.get(key).offer, undefined);
  assertInvariants(loneDefault);

  recordAcceptedBid(bidding, A, round, 'carol', 200n, 20n);
  recordAcceptedBid(bidding, A, round, 'bob', 300n, 30n);
  recordAcceptedBid(bidding, A, round, 'alice', 400n, 40n);
  const closed = transition(bidding, close);
  const offered = transition(closed, lapse);
  const deadline = recordedAt + 86_400;
  const work = offered.works.get(key);
  assert.equal(work.outcome, 'runner-up-offered');
  assert.deepEqual(work.offer, { bidder: 'bob', price: 300n, deadline });
  assert.deepEqual(work.defaultAllocation, { creator: 32n, protocol: 8n });
  assert.equal(work.lockedDeposit, 0n);
  assert.equal(work.floor, null);
  assert.deepEqual(offered.refunds, closed.refunds);
  assert.deepEqual(transition(offered, issue(A, round)), offered);
  assertInvariants(offered);

  const accept = command('accept-offer', { caller: 'bob', value: 300n, now: deadline });
  const decline = command('decline-offer', { caller: 'bob', now: deadline });
  const expire = command('expire-offer', { caller: 'observer', now: deadline + 1 });
  for (const invalid of [{ ...accept, caller: 'alice' }, { ...accept, caller: 'carol' },
    { ...accept, value: 270n }, { ...accept, value: 301n }, { ...accept, now: deadline + 1 },
    { ...decline, caller: 'carol' }, { ...expire, now: deadline }]) {
    assert.deepEqual(transition(offered, invalid), offered);
  }

  for (const release of [decline, expire]) {
    const released = transition(offered, release);
    assert.deepEqual(released.works.get(key), { ...work, outcome: 'defaulted' });
    assert.deepEqual(released.refunds, offered.refunds);
    assert.equal(released.minted.has(key), false);
    for (const replay of [lapse, release, accept, { ...accept, caller: 'carol', value: 200n }]) {
      assert.deepEqual(transition(released, replay), released);
    }
    assertInvariants(released);
  }

  const refundId = round + '/bid/3';
  for (const schedule of ['pending', 'credited', 'paid']) {
    const before = schedule === 'pending' ? offered : transition(offered, batch(A, [[refundId, schedule === 'paid']], 1));
    const settled = transition(before, accept);
    const purchase = settled.works.get(key);
    assert.equal(purchase.outcome, 'settled');
    assert.equal(purchase.floor, 300n);
    assert.equal(purchase.settlement.proceeds, 300n);
    assert.equal(purchase.settlement.received, 300n);
    assert.equal(settled.minted.get(key).firstCollector, 'bob');
    assert.deepEqual(purchase.defaultAllocation, work.defaultAllocation);
    assert.deepEqual(settled.refunds, before.refunds);
    assert.deepEqual(settled.credits, before.credits);
    assert.deepEqual(settled.payments, before.payments);
    assertInvariants(settled);
    const batched = transition(settled, batch(A, [[refundId, true]], 1));
    const refunded = transition(batched, withdraw(A, refundId, 'bob', true));
    assert.deepEqual(refunded.payments, [{ key: identity(A, refundId), domain: scope(A), recipient: 'bob', amount: 30n }]);
    assert.deepEqual(transition(refunded, accept), refunded);
    assert.deepEqual(transition(refunded, issue(A, round)), refunded);
    assertInvariants(refunded);
  }
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
