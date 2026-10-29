import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/services/cache-service.js', import.meta.url), 'utf8');
const queueImport = "import { getRedisConnection } from '../queue.js';";
assert.ok(source.includes(queueImport));
const { default: template } = await import(`data:text/javascript;base64,${Buffer.from(source.replace(
    queueImport, "const getRedisConnection = async () => { throw new Error('External Redis forbidden'); };"
)).toString('base64')}`);
const generationKey = 'artsoul:cache:recovery-generation';

// Deterministic failure/boundary tests, not evidence of Redis atomic execution.
// cache-recovery-rpc.test.mjs exercises the same scripts on a disposable Redis.
function fixture(t, overrides = {}) {
    const cache = new template.constructor();
    const values = new Map();
    const calls = { writes: 0, reads: 0, keys: 0, deletes: 0 };
    const redis = {
        async get(key) { calls.reads++; return values.get(key) ?? null; },
        async set(key, value, mode) {
            if (mode === 'NX' && values.has(key)) return null;
            values.set(key, value);
            return 'OK';
        },
        async scan(cursor, match, pattern, count, size) {
            calls.keys++;
            assert.equal(cursor, '0');
            assert.equal(match, 'MATCH');
            assert.equal(count, 'COUNT');
            assert.equal(size, 128);
            assert.equal(pattern, 'artsoul:*');
            return ['0', [...values.keys()]];
        },
        async del(...keys) { calls.deletes++; keys.forEach(key => values.delete(key)); },
        async eval(script, count, ...args) {
            if (count === 2) {
                const [marker, key, generation, ttl] = args;
                assert.match(script, /redis.call\('DEL', KEYS\[2\]\)/);
                assert.equal(marker, `artsoul:cache:entry-generation:${key}`);
                assert.ok(ttl > 0);
                values.set(marker, generation);
                return Number(values.delete(key));
            }
            calls.writes++;
            const [marker, entryMarker, key, expected, entryExpected, value, ttl] = args;
            assert.equal(count, 3);
            assert.equal(marker, generationKey);
            assert.equal(entryMarker, `artsoul:cache:entry-generation:${key}`);
            assert.match(script, /redis.call\('SET', KEYS\[3\], ARGV\[3\], 'EX', ARGV\[4\]\)/);
            assert.ok(ttl > 0);
            if (values.get(marker) !== expected || values.get(entryMarker) !== entryExpected) return 0;
            values.set(key, value);
            return 1;
        },
        ...overrides
    };
    cache.getRedis = async () => redis;
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'log', () => {});
    return { cache, values, calls, redis };
}

test('a delayed cache miss re-reads after purge without caching its obsolete snapshot', async t => {
    const { cache, values, calls } = fixture(t);
    let enter, release, current = 2500, fetches = 0;
    const entered = new Promise(resolve => { enter = resolve; });
    const released = new Promise(resolve => { release = resolve; });
    const key = cache.keys.auction('84532:artwork:1');
    const pending = cache.remember(key, 3600, async () => {
        fetches++;
        const snapshot = current;
        if (fetches === 1) { enter(); await released; }
        return { bid: snapshot };
    });
    await entered;
    current = 0;
    await cache.purge({ strict: true });
    release();
    assert.deepEqual(await pending, { bid: 0 });
    assert.equal(fetches, 2);
    assert.equal(calls.writes, 1);
    assert.equal(values.has(key), false, 'the bounded fresh read is not cached');
    assert.deepEqual(await cache.remember(key, 3600, async () => ({ bid: current })), { bid: 0 });
    assert.deepEqual(await cache.remember(key, 3600, async () => assert.fail('cache hit expected')), { bid: 0 });
});

test('guard failure permits only one fresh read even if another purge crosses it', async t => {
    const { cache, values, calls } = fixture(t);
    let fetches = 0;
    const key = cache.keys.stats('health:84532');
    const result = await cache.remember(key, 30, async () => {
        fetches++;
        await cache.purge({ strict: true });
        return { sequence: fetches };
    });
    assert.deepEqual(result, { sequence: 2 });
    assert.equal(fetches, 2);
    assert.equal(calls.writes, 1);
    assert.equal(values.has(key), false);
});

test('an error in the bounded fresh read propagates instead of returning the old data', async t => {
    const { cache, values } = fixture(t);
    const failure = new Error('authoritative read unavailable');
    let fetches = 0;
    await assert.rejects(cache.remember('artsoul:auction:1', 30, async () => {
        if (++fetches > 1) throw failure;
        await cache.purge({ strict: true });
        return { obsolete: true };
    }), error => error === failure);
    assert.equal(fetches, 2);
    assert.equal(values.has('artsoul:auction:1'), false);
});

test('an unknown guarded-write result performs a fresh uncached read', async t => {
    const { cache, values } = fixture(t, { async eval() { throw new Error('connection lost'); } });
    let fetches = 0;
    assert.equal(await cache.remember('artsoul:bids:1', 30, async () => ++fetches), 2);
    assert.equal(fetches, 2);
    assert.equal(values.has('artsoul:bids:1'), false);
});

test('unavailable or missing generation bypasses caching and reads once', async t => {
    for (const failing of [false, true]) {
        const { cache, calls } = fixture(t, {
            async get() { if (failing) throw new Error('marker read failed'); return null; },
            async set() { return null; }
        });
        let fetches = 0;
        assert.equal(await cache.remember('artsoul:auction:1', 30, async () => ++fetches), 1);
        assert.equal(calls.writes, 0);
    }
    const { cache } = fixture(t);
    cache.getRedis = async () => null;
    assert.equal(await cache.remember('artsoul:auction:1', 30, async () => 'direct'), 'direct');
});

test('marker rotation failure cannot report a successful recovery purge', async t => {
    const { cache, calls } = fixture(t, { async set() { return null; } });
    await assert.rejects(cache.purge({ strict: true }), /Recovery cache generation unavailable/);
    assert.equal(await cache.purge(), false);
    assert.equal(calls.keys, 0);
    assert.equal(calls.deletes, 0);
});

test('null results and authoritative failures never write a cached entry', async t => {
    const { cache, calls } = fixture(t);
    assert.equal(await cache.remember('artsoul:auction:1', 30, async () => null), null);
    const failure = new Error('read failed');
    await assert.rejects(cache.remember('artsoul:auction:1', 30, async () => { throw failure; }),
        error => error === failure);
    assert.equal(calls.writes, 0);
});

test('ordinary auction invalidation rejects both auction and bid snapshots from before the new bid', async t => {
    const { cache, values } = fixture(t);
    const id = '84532:artwork:1';
    const keys = [cache.keys.auction(id), cache.keys.bids(id)];
    let release, current = 100;
    const released = new Promise(resolve => { release = resolve; });
    const entered = [], starts = [];
    const fetches = [0, 0];
    for (let i = 0; i < keys.length; i++) entered.push(new Promise(resolve => { starts.push(resolve); }));
    const pending = keys.map((key, i) => cache.remember(key, 3600, async () => {
        const captured = current;
        if (++fetches[i] === 1) { starts[i](); await released; }
        return { bid: captured };
    }));
    await Promise.all(entered);
    current = 200;
    await cache.invalidateAuctionState(id);
    release();
    assert.deepEqual(await Promise.all(pending), [{ bid: 200 }, { bid: 200 }]);
    assert.deepEqual(fetches, [2, 2]);
    keys.forEach(key => assert.equal(values.has(key), false));
});

test('unrelated auction invalidation does not force an in-flight read to fetch twice', async t => {
    const { cache, values } = fixture(t);
    const key = cache.keys.auction('84532:artwork:1');
    let fetches = 0;
    assert.equal(await cache.remember(key, 3600, async () => {
        fetches++;
        await cache.invalidateAuctionState('84532:artwork:2');
        return 'current';
    }), 'current');
    assert.equal(fetches, 1);
    assert.equal(JSON.parse(values.get(key)), 'current');
});

test('entry marker loss refuses the old write without requiring a recovery purge', async t => {
    const { cache, values } = fixture(t);
    const key = cache.keys.auction('84532:artwork:1');
    let fetches = 0;
    assert.equal(await cache.remember(key, 3600, async () => {
        if (++fetches === 1) {
            values.delete(`artsoul:cache:entry-generation:${key}`);
            return 'obsolete';
        }
        return 'current';
    }), 'current');
    assert.equal(fetches, 2);
    assert.equal(values.has(key), false);
});
