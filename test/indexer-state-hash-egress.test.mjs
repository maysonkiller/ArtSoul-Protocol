import assert from 'node:assert/strict';
import test from 'node:test';
import Engine from '../src/indexer/sync-engine.js';

test('state hashing sends only chain and cutoff and receives a digest in one round trip', async () => {
    const calls = [];
    const hash = 'a'.repeat(64);
    const engine = new Engine({ query: async (sql, params) => {
        calls.push({ sql, params });
        return [{ hash }];
    } }, { chainId: 84532 });
    assert.equal(await engine._computeStateHash('51537518'), `0x${hash}`);
    assert.equal(calls.length, 1, 'never download history and send it back for hashing');
    assert.deepEqual(calls[0].params, ['84532', '51537518']);
});

test('a failed digest query propagates without a full-history fallback or state writes', async () => {
    let calls = 0;
    const failure = new Error('database unavailable');
    const engine = new Engine({ query: async () => { calls++; throw failure; } }, { chainId: 84532 });
    await assert.rejects(engine._computeStateHash(123), error => error === failure);
    assert.equal(calls, 1);
});
