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
        async keys(pattern) {
            calls.keys++;
            assert.equal(pattern, 'artsoul:*');
            return [...values.keys()];
        },
        async del(...keys) { calls.deletes++; keys.forEach(key => values.delete(key)); },
        async eval(script, count, marker, key, expected, value, ttl) {
            calls.writes++;
            assert.equal(count, 2);
            assert.equal(marker, generationKey);
            assert.match(script, /redis.call\('SET', KEYS\[2\], ARGV\[2\], 'EX', ARGV\[3\]\)/);
            assert.ok(ttl > 0);
            if (values.get(marker) !== expected) return 0;
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
