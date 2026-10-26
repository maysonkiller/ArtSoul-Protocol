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
