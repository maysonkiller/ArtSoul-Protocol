import assert from 'node:assert/strict';
import test from 'node:test';
import ProductionIndexer from '../src/indexer/production-runner.js';

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

// Run the shipped leader lifecycle and confirmation-poll methods, with local
// substitutes for RPC/DB side effects. A held snapshot models a slow read RPC.
function runnerWithPendingSnapshot() {
    const entered = deferred();
    const snapshot = deferred();
    const events = [];
    const runner = Object.create(ProductionIndexer.prototype);
    let engineRunning = true;
    Object.assign(runner, {
        isLeader: true, isRunning: true, leadershipLossInProgress: false,
        leaderElectionInProgress: false, confirmationInFlight: null,
        confirmationTimer: null, reaperTimer: null, leaderCheckInterval: null,
        lastReorgCheckAt: Date.now(), reorgCheckInterval: 60000,
        distributedLock: {
            lockName: 'fixture', instanceId: 'worker', epoch: 0,
            getFencingToken() { return '1'; }, isLeaderInstance() { return true; },
            async tryAcquire() { events.push('acquire'); return true; },
            stopHeartbeat() {}, startHeartbeat() {},
            async release() { events.push('release'); }
        },
        syncEngine: {
            async start() { engineRunning = true; events.push('engine-start'); },
            async stop() { engineRunning = false; events.push('engine-stop'); }
        },
        db: { async close() { events.push('db-close'); } },
        async _catchUpToSafeBlock() { return { currentBlock: 112, safeBlock: 100 }; },
        async _processConfirmations() {}, async _refreshEventFailureMetric() {},
        async _refreshResaleState() {
            entered.resolve();
            await snapshot.promise;
            events.push('snapshot-finished');
        },
        _refreshSearchMetadata() {}, _startConfirmationPolling() {}, _startStuckProcessorReaper() {},
        async _drainOperations() { events.push('drained'); }
    });
    return { runner, entered, snapshot, events, engineRunning: () => engineRunning };
}

test('leadership cannot be reacquired until the old confirmation poll and follower drain finish', async t => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'error', () => {});
    const h = runnerWithPendingSnapshot();
    const poll = h.runner._runConfirmationPoll();
    await h.entered.promise;
    const lost = h.runner._handleLeadershipLost('local test: slow snapshot during leadership loss');
    t.after(async () => { h.snapshot.resolve(); await Promise.all([poll, lost]); });
    assert.equal(h.runner.leadershipLossInProgress, true);
    assert.equal(h.runner.isLeader, false);
    assert.equal(h.runner.isRunning, false);
    assert.equal(h.engineRunning(), true, 'the old engine is still draining');

    // This represents the independent five-second leader-election tick.
    assert.equal(await h.runner._tryBecomeLeader(), false);
    assert.deepEqual(h.events, [], 'neither reacquisition nor a second engine starts during drain');
    await h.runner._handleLeadershipLost('duplicate loss callback');
    h.snapshot.resolve();
    await Promise.all([poll, lost]);
    assert.equal(h.runner.confirmationInFlight, null);
    assert.equal(h.runner.leadershipLossInProgress, false);
    assert.equal(h.engineRunning(), false);
    assert.deepEqual(h.events, ['snapshot-finished', 'engine-stop']);

    assert.equal(await h.runner._tryBecomeLeader(), true);
    assert.equal(h.runner.isLeader, true);
    assert.equal(h.runner.isRunning, true);
    assert.equal(h.engineRunning(), true, 'the completed old drain cannot stop the new leader engine');
    assert.deepEqual(h.events, ['snapshot-finished', 'engine-stop', 'acquire', 'engine-start']);
});

for (const phase of ['recovery', 'catch-up']) test(`leadership loss drains startup ${phase} before another leader can start`, async t => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'error', () => {});
    const h = runnerWithPendingSnapshot(), entered = deferred(), pending = deferred();
    h.runner.isLeader = false; h.runner.isRunning = false;
    if (phase === 'recovery') h.runner.syncEngine.start = async () => {
        h.events.push('recovery'); entered.resolve(); await pending.promise;
    };
    h.runner._catchUpToSafeBlock = async () => {
        h.events.push('catch-up');
        if (phase === 'catch-up') { entered.resolve(); await pending.promise; }
    };
    h.runner._startConfirmationPolling = () => h.events.push('poll-timer');
    h.runner._startStuckProcessorReaper = () => h.events.push('reaper-timer');
    const start = h.runner._tryBecomeLeader();
    await entered.promise;
    const lost = h.runner._handleLeadershipLost('fixture startup loss');
    t.after(async () => { pending.resolve(); await Promise.all([start, lost]); });
    assert.equal(await h.runner._tryBecomeLeader(), false);
    assert.equal(h.events.includes('engine-stop'), false);
    pending.resolve();
    assert.equal(await start, false);
    await lost;
    assert.equal(h.events.includes('poll-timer'), false);
    assert.equal(h.events.includes('reaper-timer'), false);
    if (phase === 'recovery') assert.equal(h.events.includes('catch-up'), false);
    assert.equal(h.events.at(-1), 'engine-stop');
    assert.equal(h.runner.confirmationInFlight, null);
    assert.equal(h.runner.leaderElectionInFlight, null);
});

test('failed startup releases leadership and a later election retries recovery and starts polling', async t => {
    t.mock.method(console, 'log', () => {});
    const h = runnerWithPendingSnapshot();
    h.runner.isLeader = false; h.runner.isRunning = false;
    let starts = 0;
    h.runner.syncEngine.start = async () => {
        h.events.push('recovery');
        if (++starts === 1) throw new Error('startup purge unavailable');
    };
    h.runner._catchUpToSafeBlock = async () => { h.events.push('catch-up'); };
    h.runner._startConfirmationPolling = () => h.events.push('poll-timer');
    h.runner._startStuckProcessorReaper = () => h.events.push('reaper-timer');
    await assert.rejects(h.runner._tryBecomeLeader(), /startup purge unavailable/);
    assert.equal(h.runner.isRunning, false);
    assert.equal(h.runner.isLeader, false);
    assert.equal(h.runner.confirmationInFlight, null);
    assert.deepEqual(h.events, ['acquire', 'recovery', 'engine-stop', 'release']);
    assert.equal(await h.runner._tryBecomeLeader(), true);
    assert.deepEqual(h.events.slice(4), ['acquire', 'recovery', 'catch-up', 'poll-timer', 'reaper-timer']);
});

test('authority from an earlier acquisition stays invalid when the instance and token are reused', () => {
    const { runner } = runnerWithPendingSnapshot();
    const old = runner._getRecoveryAuthority();
    assert.equal(old.isCurrent(), true);
    runner.distributedLock.epoch++;
    assert.equal(old.isCurrent(), false);
    assert.equal(runner._getRecoveryAuthority().isCurrent(), true);
});

test('a cleanup error still releases leadership and preserves the original startup failure', async t => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'error', () => {});
    const h = runnerWithPendingSnapshot();
    h.runner.isLeader = false; h.runner.isRunning = false;
    h.runner.syncEngine.start = async () => { throw new Error('recovery failed'); };
    h.runner.syncEngine.stop = async () => { throw new Error('cleanup failed'); };
    await assert.rejects(h.runner._tryBecomeLeader(), /recovery failed/);
    assert.equal(h.events.at(-1), 'release');
    assert.equal(h.runner.isRunning, false);
    assert.equal(h.runner.leaderElectionInProgress, false);
});

for (const phase of ['acquisition', 'recovery']) test(`shutdown waits for pending startup ${phase} and never installs timers`, async t => {
    t.mock.method(console, 'log', () => {});
    const h = runnerWithPendingSnapshot(), entered = deferred(), pending = deferred();
    h.runner.isLeader = false; h.runner.isRunning = false;
    if (phase === 'acquisition') h.runner.distributedLock.tryAcquire = async () => {
        h.events.push('acquire'); entered.resolve(); await pending.promise; return true;
    };
    else h.runner.syncEngine.start = async () => {
        h.events.push('recovery'); entered.resolve(); await pending.promise;
    };
    h.runner._startConfirmationPolling = () => h.events.push('poll-timer');
    h.runner._startStuckProcessorReaper = () => h.events.push('reaper-timer');
    const start = h.runner._tryBecomeLeader();
    await entered.promise;
    const stop = h.runner.stop();
    t.after(async () => { pending.resolve(); await Promise.all([start, stop]); });
    assert.equal(h.events.includes('release'), false);
    assert.equal(h.events.includes('db-close'), false);
    pending.resolve();
    assert.equal(await start, false);
    await stop;
    assert.equal(h.events.includes('poll-timer'), false);
    assert.equal(h.events.includes('reaper-timer'), false);
    assert.equal(h.events.at(-1), 'db-close');
    assert.equal(await h.runner._tryBecomeLeader(), false);
});

test('shutdown drains a pending confirmation poll before stopping the engine and releasing resources', async t => {
    t.mock.method(console, 'log', () => {});
    const h = runnerWithPendingSnapshot();
    const poll = h.runner._runConfirmationPoll();
    await h.entered.promise;
    const stop = h.runner.stop();
    t.after(async () => { h.snapshot.resolve(); await Promise.all([poll, stop]); });
    assert.equal(h.runner.isLeader, false);
    assert.equal(h.runner.isRunning, false);
    assert.equal(h.runner._runConfirmationPoll(), poll, 'shutdown does not start another poll');
    assert.deepEqual(h.events, [], 'resources stay available until the current poll returns');
    h.snapshot.resolve();
    await Promise.all([poll, stop]);
    assert.equal(h.runner.confirmationInFlight, null);
    assert.equal(h.engineRunning(), false);
    assert.deepEqual(h.events, ['snapshot-finished', 'drained', 'engine-stop', 'release', 'db-close']);
});
