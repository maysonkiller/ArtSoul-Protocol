import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/services/cache-service.js', import.meta.url), 'utf8');
const queueImport = "import { getRedisConnection } from '../queue.js';";
assert.ok(source.includes(queueImport));
const { default: template } = await import(`data:text/javascript;base64,${Buffer.from(source.replace(
    queueImport, "const getRedisConnection = async () => { throw new Error('External Redis forbidden'); };"
)).toString('base64')}`);
const marker = 'artsoul:cache:recovery-generation';

// Controlled SCAN schedules exercise its documented empty/duplicate-page behavior.
// The real Redis fixture separately verifies actual iteration and deletion.
function fixture(t, scan) {
    const values = new Map([[marker, 'before']]);
    const calls = { scans: [], deletions: [], rotations: 0 };
    const redis = {
        async set(key, value) { assert.equal(key, marker); calls.rotations++; values.set(key, value); return 'OK'; },
        async keys() { assert.fail('recovery must not enumerate the entire keyspace with KEYS'); },
        async scan(cursor, ...options) {
            assert.deepEqual(options, ['MATCH', 'artsoul:*', 'COUNT', 128]);
            calls.scans.push(cursor);
            return scan(cursor, values);
        },
        async del(...keys) {
            assert.ok(keys.length > 0 && keys.length <= 128, 'deletion must use bounded batches');
            calls.deletions.push(keys);
            return keys.reduce((total, key) => total + Number(values.delete(key)), 0);
        }
    };
    const cache = new template.constructor();
    cache.getRedis = async () => redis;
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
    return { cache, redis, values, calls };
}

test('purge traverses empty pages, opaque cursors and duplicate keys before acknowledging completion', async t => {
    const largeCursor = '18446744073709551615';
    const { cache, values, calls } = fixture(t, cursor => {
        if (cursor === '0') return [largeCursor, []];
        if (cursor === largeCursor) return ['17', [marker, 'artsoul:auction:1', 'artsoul:auction:1']];
        assert.equal(cursor, '17');
        return ['0', ['artsoul:bids:1', 'artsoul:auction:1']];
    });
    values.set('artsoul:auction:1', 'old'); values.set('artsoul:bids:1', 'old');
    values.set('bull:jobs:1', 'retained');
    assert.equal(await cache.purge({ strict: true }), true);
    assert.deepEqual(calls.scans, ['0', largeCursor, '17']);
    assert.equal(values.has('artsoul:auction:1'), false);
    assert.equal(values.has('artsoul:bids:1'), false);
    assert.equal(values.get('bull:jobs:1'), 'retained');
    assert.notEqual(values.get(marker), 'before');
    assert.ok(calls.deletions.every(keys => !keys.includes(marker)));
});

test('a SCAN reply larger than COUNT is split into bounded deletes', async t => {
    const keys = Array.from({ length: 513 }, (_, index) => `artsoul:auction:${index}`);
    const { cache, values, calls } = fixture(t, () => ['0', [marker, ...keys]]);
    keys.forEach(key => values.set(key, 'old'));
    assert.equal(await cache.purge({ strict: true }), true);
    assert.deepEqual(calls.deletions.map(keys => keys.length), [128, 128, 128, 128, 1]);
    assert.deepEqual([...values.keys()], [marker]);
});

test('a later SCAN error leaves partial work unacknowledged and a full retry can finish', async t => {
    const failure = new Error('second scan failed');
    let fail = true;
    const { cache, values, calls } = fixture(t, cursor => {
        if (cursor === '0') return ['1', ['artsoul:auction:1']];
        if (fail) throw failure;
        return ['0', ['artsoul:auction:2']];
    });
    values.set('artsoul:auction:1', 'old'); values.set('artsoul:auction:2', 'old');
    await assert.rejects(cache.purge({ strict: true }), error => error === failure);
    assert.equal(values.has('artsoul:auction:1'), false);
    assert.equal(values.get('artsoul:auction:2'), 'old');
    const failedGeneration = values.get(marker);
    fail = false;
    assert.equal(await cache.purge({ strict: true }), true);
    assert.notEqual(values.get(marker), failedGeneration);
    assert.deepEqual(calls.scans, ['0', '1', '0', '1']);
    assert.deepEqual([...values.keys()], [marker]);
});

test('a failed delete batch stops later batches and best-effort purge reports failure', async t => {
    const keys = Array.from({ length: 300 }, (_, index) => `artsoul:bids:${index}`);
    const { cache, redis, values, calls } = fixture(t, () => ['0', keys]);
    keys.forEach(key => values.set(key, 'old'));
    const remove = redis.del;
    let deletions = 0;
    redis.del = async (...keys) => {
        if (++deletions === 2) throw new Error('batch failed');
        return remove(...keys);
    };
    assert.equal(await cache.purge(), false);
    assert.equal(deletions, 2);
    assert.equal(calls.deletions.length, 1);
    assert.equal(values.has(keys[0]), false);
    assert.equal(values.get(keys[128]), 'old');
    assert.equal(values.get(keys[299]), 'old');
    redis.del = remove;
    assert.equal(await cache.purge({ strict: true }), true);
    assert.deepEqual([...values.keys()], [marker]);
});

test('a nonterminating SCAN cannot consume an unbounded number of commands', async t => {
    const { cache, calls } = fixture(t, () => ['1', []]);
    await assert.rejects(cache.purge({ strict: true }), /Recovery cache purge command limit reached/);
    assert.equal(calls.scans.length, 1024);
    assert.equal(calls.deletions.length, 0);
});

test('deletion commands share the same purge budget as SCAN', async t => {
    const { cache, calls } = fixture(t, () => ['1', ['artsoul:auction:1']]);
    await assert.rejects(cache.purge({ strict: true }), /Recovery cache purge command limit reached/);
    assert.equal(calls.scans.length, 512);
    assert.equal(calls.deletions.length, 512);
});

for (const response of [null, ['invalid', []], ['0', null], ['0', [42]]]) {
    test(`an invalid SCAN response fails closed: ${JSON.stringify(response)}`, async t => {
        const { cache, calls } = fixture(t, () => response);
        await assert.rejects(cache.purge({ strict: true }), /Invalid recovery cache scan response/);
        assert.equal(calls.deletions.length, 0);
    });
}
