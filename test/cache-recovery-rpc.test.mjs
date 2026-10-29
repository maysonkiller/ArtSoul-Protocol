// Real Redis generation/CAS behavior in one disposable loopback-only container.
// Queue initialization is excluded; no environment Redis endpoint is accepted.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import Redis from 'ioredis';

const GENERATION = 'artsoul:cache:recovery-generation';
const entryGeneration = key => `artsoul:cache:entry-generation:${key}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const docker = (...args) => execFileSync('docker', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 60000
}).trim();
let available = false;
try { available = docker('version', '--format', '{{.Server.Os}}') === 'linux'; } catch {}
const required = Boolean(process.env.CI) && process.platform === 'linux';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}
function transport(client, overrides) {
    return new Proxy(client, { get(target, property) {
        if (Object.hasOwn(overrides, property)) return overrides[property];
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
    } });
}

test('recovery and entry generations fence cache refill against real Redis', {
    skip: !available && !required ? 'Disposable Redis requires a Linux Docker server; no Redis connection attempted' : false,
    timeout: 90000
}, async t => {
    assert.ok(available, 'Linux CI must execute the real Redis fixture with Docker');
    const container = `artsoul-cache-recovery-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    const clients = [];
    let creationAttempted = false, endpoint;
    t.after(() => {
        for (const client of clients) client.disconnect();
        if (creationAttempted) {
            try { docker('rm', '-f', container); }
            catch (error) {
                if (!/No such container/i.test(String(error.stderr))) throw error;
            }
        }
    });
    const source = fs.readFileSync(new URL('../src/services/cache-service.js', import.meta.url), 'utf8');
    const queueImport = "import { getRedisConnection } from '../queue.js';";
    assert.ok(source.includes(queueImport));
    const isolated = source.replace(queueImport,
        'const getRedisConnection = async () => { throw new Error("External Redis disabled in fixture"); };');
    const { default: prototype } = await import(`data:text/javascript;base64,${Buffer.from(isolated).toString('base64')}`);
    const service = client => {
        const instance = new prototype.constructor();
        instance.getRedis = async () => client;
        return instance;
    };
    creationAttempted = true;
    docker('run', '-d', '--name', container, '-p', '127.0.0.1::6379',
        'redis:7.4-alpine', 'redis-server', '--save', '', '--appendonly', 'no');
    endpoint = docker('port', container, '6379/tcp');
    assert.match(endpoint, /^127\.0\.0\.1:\d+$/);
    for (let attempt = 0; ; attempt++) {
        try { assert.equal(docker('exec', container, 'redis-cli', 'PING'), 'PONG'); break; }
        catch (error) { if (attempt >= 40) throw error; await delay(100); }
    }
    const connect = async options => {
        const client = new Redis({ host: '127.0.0.1', port: Number(endpoint.split(':')[1]),
            lazyConnect: true, enableOfflineQueue: false, retryStrategy: null,
            maxRetriesPerRequest: 1, connectTimeout: 2000, commandTimeout: 3000, ...options });
        clients.push(client);
        client.on('error', () => {}); // Command/connect promises still reject on failure.
        await client.connect();
        assert.equal(await client.ping(), 'PONG');
        return client;
    };
    const first = await connect(), second = await connect();
    const cacheA = service(first), cacheB = service(second);
    t.diagnostic((await first.info('server')).split('\r\n').find(line => line.startsWith('redis_version:')));
    t.beforeEach(async () => { await first.flushdb(); }); // Only this disposable container.

    await t.test('current generation fills and serves across instances, with real expiry', async () => {
        const key = 'artsoul:auction:current';
        let fetches = 0;
        assert.deepEqual(await cacheA.remember(key, 5, async () => { fetches++; return { bid: 10 }; }), { bid: 10 });
        const generation = await first.get(GENERATION);
        assert.match(generation, UUID);
        assert.match(await first.get(entryGeneration(key)), UUID);
        const entryLifetime = await first.pttl(entryGeneration(key));
        assert.ok(entryLifetime > 0 && entryLifetime <= 5000, 'a read-created entry marker has a bounded lifetime');
        assert.deepEqual(JSON.parse(await first.get(key)), { bid: 10 });
        assert.deepEqual(await cacheB.remember(key, 5, async () => assert.fail('cache hit must not fetch')), { bid: 10 });
        assert.equal(fetches, 1);
        const remaining = await first.pttl(key);
        assert.ok(remaining > 0 && remaining <= 5000);
        await delay(remaining + 30);
        assert.equal(await first.get(key), null);
        assert.equal(await first.ttl(GENERATION), -1, 'the recovery marker must not expire with cached values');
        assert.deepEqual(await cacheB.remember(key, 30, async () => ({ bid: 20 })), { bid: 20 });
        assert.equal(await first.get(GENERATION), generation);
        assert.deepEqual(JSON.parse(await first.get(key)), { bid: 20 });
    });

    await t.test('a delayed pre-purge fetch cannot refill or return its obsolete value', async () => {
        const key = 'artsoul:auction:delayed', entered = deferred(), release = deferred();
        let fetches = 0;
        const reading = cacheA.remember(key, 60, async () => {
            if (++fetches === 1) { entered.resolve(); await release.promise; return { bid: 10 }; }
            return { bid: 0 };
        });
        try {
            await entered.promise;
            const before = await first.get(GENERATION);
            assert.equal(await cacheB.purge({ strict: true }), true);
            assert.notEqual(await first.get(GENERATION), before);
        } finally { release.resolve(); }
        assert.deepEqual(await reading, { bid: 0 });
        assert.equal(fetches, 2);
        assert.equal(await first.get(key), null, 'the single fresh retry is deliberately uncached');
    });

    await t.test('overlapping purges on separate instances retain the latest marker and fence an older fetch', async () => {
        const key = 'artsoul:auction:overlap', fetching = deferred(), releaseFetch = deferred();
        const scanA = deferred(), scanB = deferred(), releaseA = deferred(), releaseB = deferred();
        let fetches = 0;
        const reading = cacheA.remember(key, 60, async () => {
            if (++fetches === 1) { fetching.resolve(); await releaseFetch.promise; return 'obsolete'; }
            return 'current';
        });
        await fetching.promise;
        await first.set('artsoul:auction:existing', 'obsolete');
        const old = await first.get(GENERATION);
        const purgerA = service(transport(first, { keys: async pattern => {
            const keys = await first.keys(pattern); scanA.resolve(); await releaseA.promise; return keys;
        } }));
        const purgerB = service(transport(second, { keys: async pattern => {
            const keys = await second.keys(pattern); scanB.resolve(); await releaseB.promise; return keys;
        } }));
        const a = purgerA.purge({ strict: true });
        let b, latest;
        try {
            await scanA.promise;
            const middle = await first.get(GENERATION); assert.notEqual(middle, old);
            b = purgerB.purge({ strict: true });
            await scanB.promise;
            latest = await first.get(GENERATION); assert.notEqual(latest, middle);
            releaseB.resolve(); assert.equal(await b, true);
            releaseA.resolve(); assert.equal(await a, true);
        } finally { releaseA.resolve(); releaseB.resolve(); releaseFetch.resolve(); }
        assert.equal(await reading, 'current'); assert.equal(fetches, 2);
        assert.equal(await first.get(GENERATION), latest); assert.match(latest, UUID);
        assert.equal(await first.get(key), null);
        assert.equal(await first.get('artsoul:auction:existing'), null);
    });

    await t.test('purging an empty cache rotates and retains the marker', async () => {
        assert.equal(await first.dbsize(), 0);
        assert.equal(await cacheA.purge({ strict: true }), true);
        const initial = await first.get(GENERATION); assert.match(initial, UUID);
        assert.equal(await cacheB.purge({ strict: true }), true);
        const next = await first.get(GENERATION); assert.match(next, UUID); assert.notEqual(next, initial);
        assert.deepEqual(await first.keys('artsoul:*'), [GENERATION]);
    });

    for (const reinitialize of [false, true]) await t.test(`marker loss during a fetch ${reinitialize ? 'cannot reuse its previous generation' : 'cannot authorize a write'}`, async () => {
        const key = 'artsoul:auction:lost-marker', entered = deferred(), release = deferred();
        let fetches = 0;
        const reading = cacheA.remember(key, 60, async () => {
            if (++fetches === 1) { entered.resolve(); await release.promise; return 'obsolete'; }
            return 'fresh';
        });
        try {
            await entered.promise;
            const original = await first.get(GENERATION);
            await second.del(GENERATION);
            if (reinitialize) {
                await cacheB.remember('artsoul:auction:other', 60, async () => 'other');
                const replacement = await first.get(GENERATION);
                assert.match(replacement, UUID); assert.notEqual(replacement, original);
            }
        } finally { release.resolve(); }
        assert.equal(await reading, 'fresh'); assert.equal(fetches, 2);
        assert.equal(await first.get(key), null);
        if (!reinitialize) assert.equal(await first.get(GENERATION), null);
    });

    await t.test('concurrent absent-marker initialization uses the winning SET NX generation', async () => {
        const entered = [deferred(), deferred()], release = deferred();
        const make = (client, index) => {
            let firstMarkerRead = true;
            return service(transport(client, { get: async key => {
                const value = await client.get(key);
                if (key === GENERATION && firstMarkerRead) {
                    firstMarkerRead = false; assert.equal(value, null); entered[index].resolve(); await release.promise;
                }
                return value;
            } }));
        };
        const fetches = [0, 0];
        const pending = [make(first, 0), make(second, 1)].map((cache, index) =>
            cache.remember(`artsoul:auction:init-${index}`, 60, async () => { fetches[index]++; return index; }));
        try { await Promise.all(entered.map(gate => gate.promise)); }
        finally { release.resolve(); }
        assert.deepEqual(await Promise.all(pending), [0, 1]); assert.deepEqual(fetches, [1, 1]);
        assert.match(await first.get(GENERATION), UUID);
        assert.deepEqual(await first.mget('artsoul:auction:init-0', 'artsoul:auction:init-1'), ['0', '1']);
    });

    function delayedFill(cache, key, stale = 100, fresh = 200) {
        const entered = deferred(), release = deferred();
        let reads = 0;
        const reading = cache.remember(key, 60, async () => {
            if (++reads === 1) { entered.resolve(); await release.promise; return stale; }
            return fresh;
        });
        return { entered, release, reading, reads: () => reads };
    }
    await t.test('ordinary deletion fences a delayed fill without changing the recovery generation', async () => {
        const key = 'artsoul:auction:ordinary', pending = delayedFill(cacheA, key);
        try {
            await pending.entered.promise;
            const recovery = await first.get(GENERATION), entry = await first.get(entryGeneration(key));
            await cacheB.del(key);
            assert.equal(await first.get(GENERATION), recovery);
            const invalidated = await first.get(entryGeneration(key));
            assert.match(invalidated, UUID); assert.notEqual(invalidated, entry);
            const ttl = await first.ttl(entryGeneration(key));
            assert.ok(ttl > 0 && ttl <= 3600, 'invalidation markers expire instead of accumulating indefinitely');
        } finally { pending.release.resolve(); }
        assert.equal(await pending.reading, 200); assert.equal(pending.reads(), 2);
        assert.equal(await first.get(key), null, 'the stale fill and its uncached refresh cannot repopulate the key');
        await cacheA.remember(key, 5, async () => 200);
        const ttl = await first.pttl(key);
        assert.ok(ttl > 0 && ttl <= 5000, 'the longer invalidation marker does not extend cached-data TTL');
    });
    await t.test('auction-state invalidation fences both auction and bid reads', async () => {
        const artwork = '84532:artwork:9';
        const keys = [cacheA.keys.auction(artwork), cacheA.keys.bids(artwork)];
        const pending = [delayedFill(cacheA, keys[0], { bid: 100 }, { bid: 200 }),
            delayedFill(cacheB, keys[1], [100], [100, 200])];
        try {
            await Promise.all(pending.map(value => value.entered.promise));
            const entries = await first.mget(keys.map(entryGeneration));
            await cacheB.invalidateAuctionState(artwork);
            const invalidated = await first.mget(keys.map(entryGeneration));
            for (let index = 0; index < keys.length; index++) {
                assert.match(invalidated[index], UUID); assert.notEqual(invalidated[index], entries[index]);
            }
        } finally { for (const value of pending) value.release.resolve(); }
        assert.deepEqual(await Promise.all(pending.map(value => value.reading)), [{ bid: 200 }, [100, 200]]);
        assert.deepEqual(pending.map(value => value.reads()), [2, 2]);
        assert.deepEqual(await first.mget(keys), [null, null]);
    });
    await t.test('invalidating an unrelated key does not discard another in-flight fill', async () => {
        const key = 'artsoul:auction:unrelated', pending = delayedFill(cacheA, key, 100, 200);
        try {
            await pending.entered.promise;
            const recovery = await first.get(GENERATION), entry = await first.get(entryGeneration(key));
            await cacheB.del('artsoul:auction:changed');
            assert.equal(await first.get(GENERATION), recovery);
            assert.equal(await first.get(entryGeneration(key)), entry);
        } finally { pending.release.resolve(); }
        assert.equal(await pending.reading, 100); assert.equal(pending.reads(), 1);
        assert.equal(await first.get(key), '100');
    });
    for (const loss of ['deletion', 'expiry']) for (const reinitialize of [false, true]) {
        await t.test(`entry marker ${loss} ${reinitialize ? 'and reinitialization' : 'without replacement'} cannot authorize an old fill`, async () => {
            const key = 'artsoul:auction:entry-loss', marker = entryGeneration(key), pending = delayedFill(cacheA, key);
            try {
                await pending.entered.promise;
                const original = await first.get(marker), recovery = await first.get(GENERATION);
                if (loss === 'deletion') await second.del(marker);
                else { await second.pexpire(marker, 50); await delay(80); }
                assert.equal(await first.get(marker), null);
                if (reinitialize) {
                    assert.equal(await cacheB.remember(key, 60, async () => 200), 200);
                    const replacement = await first.get(marker);
                    assert.match(replacement, UUID); assert.notEqual(replacement, original);
                }
                assert.equal(await first.get(GENERATION), recovery);
            } finally { pending.release.resolve(); }
            assert.equal(await pending.reading, 200); assert.equal(pending.reads(), 2);
            assert.equal(await first.get(key), reinitialize ? '200' : null);
            if (!reinitialize) assert.equal(await first.get(marker), null);
        });
    }
    await t.test('repeated entry invalidations and recovery purge cannot revive an older fill', async () => {
        const key = 'artsoul:auction:combined', marker = entryGeneration(key), pending = delayedFill(cacheA, key);
        try {
            await pending.entered.promise;
            const recovery = await first.get(GENERATION), firstEntry = await first.get(marker);
            await cacheB.del(key); const secondEntry = await first.get(marker);
            await cacheA.del(key); const thirdEntry = await first.get(marker);
            assert.equal(new Set([firstEntry, secondEntry, thirdEntry]).size, 3);
            assert.equal(await cacheB.purge({ strict: true }), true);
            assert.notEqual(await first.get(GENERATION), recovery);
            assert.equal(await first.get(marker), null, 'recovery purge removes entry markers along with cached data');
            await cacheA.del(key);
            const finalEntry = await first.get(marker); assert.match(finalEntry, UUID);
            assert.ok(![firstEntry, secondEntry, thirdEntry].includes(finalEntry));
            assert.equal(await cacheB.remember(key, 60, async () => 200), 200);
        } finally { pending.release.resolve(); }
        assert.equal(await pending.reading, 200); assert.equal(pending.reads(), 2);
        assert.equal(await first.get(key), '200', 'an old fill must not overwrite the newly cached value');
    });
    await t.test('concurrent entry initialization uses the winning entry nonce', async () => {
        await cacheA.purge({ strict: true });
        const key = 'artsoul:auction:entry-init', marker = entryGeneration(key);
        const entered = [deferred(), deferred()], release = deferred();
        const make = (client, index) => {
            let initial = true;
            return service(transport(client, { get: async requested => {
                const value = await client.get(requested);
                if (requested === marker && initial) {
                    initial = false; assert.equal(value, null); entered[index].resolve(); await release.promise;
                }
                return value;
            } }));
        };
        const reads = [0, 0];
        const pending = [make(first, 0), make(second, 1)].map((cache, index) =>
            cache.remember(key, 60, async () => { reads[index]++; return 200; }));
        try { await Promise.all(entered.map(gate => gate.promise)); }
        finally { release.resolve(); }
        assert.deepEqual(await Promise.all(pending), [200, 200]); assert.deepEqual(reads, [1, 1]);
        assert.match(await first.get(marker), UUID); assert.equal(await first.get(key), '200');
    });

    async function denied(command, run) {
        const name = `fixture-${command}-${crypto.randomBytes(3).toString('hex')}`;
        const password = crypto.randomUUID();
        await first.acl('SETUSER', name, 'on', `>${password}`, '~*', '+@all', `-${command}`);
        let client;
        try { client = await connect({ username: name, password }); await run(service(client)); }
        finally { client?.disconnect(); await first.acl('DELUSER', name); }
    }
    for (const command of ['set', 'keys', 'del']) await t.test(`strict purge propagates a real Redis ${command.toUpperCase()} denial`, async () => {
        const original = crypto.randomUUID();
        await first.set(GENERATION, original); await first.set('artsoul:auction:retained', 'stale');
        await denied(command, cache => assert.rejects(cache.purge({ strict: true }), /NOPERM|permission/i));
        assert.equal(await first.get('artsoul:auction:retained'), 'stale');
        const current = await first.get(GENERATION); assert.match(current, UUID);
        if (command === 'set') assert.equal(current, original); else assert.notEqual(current, original);
    });
    for (const command of ['set', 'del']) await t.test(`entry invalidation logs a real Redis ${command.toUpperCase()} denial without claiming deletion`, async () => {
        const key = 'artsoul:auction:denied-invalidation', marker = entryGeneration(key), original = crypto.randomUUID();
        await first.set(key, '100'); await first.set(marker, original, 'EX', 300);
        const warnings = [];
        await denied(command, async cache => {
            const report = cache.handleRedisError;
            cache.handleRedisError = function (operation, error) {
                warnings.push({ operation, message: error.message }); report.call(this, operation, error);
            };
            assert.notEqual(await cache.del(key), true);
            assert.equal(cache.isEnabled, false);
        });
        assert.equal(warnings.length, 1); assert.match(warnings[0].operation, /del/);
        assert.match(warnings[0].message, /NOPERM|permission|can't run/i);
        assert.equal(await first.get(key), '100', 'a failed Lua command does not imply the data was deleted');
        const retained = await first.get(marker); assert.match(retained, UUID);
        // Redis scripts do not roll back an earlier SET when a later DEL fails.
        if (command === 'set') assert.equal(retained, original); else assert.notEqual(retained, original);
    });
    await t.test('failed marker initialization reads fresh data once without writing cache', async () => {
        let fetches = 0;
        await denied('set', async cache => {
            assert.equal(await cache.remember('artsoul:auction:initialization-error', 60, async () => { fetches++; return 'fresh'; }), 'fresh');
        });
        assert.equal(fetches, 1); assert.equal(await first.get(GENERATION), null);
        assert.equal(await first.get('artsoul:auction:initialization-error'), null);
    });
    await t.test('a real Redis EVAL denial causes one fresh uncached retry', async () => {
        let fetches = 0;
        await denied('eval', async cache => {
            const result = await cache.remember('artsoul:auction:eval-error', 60, async () => ++fetches === 1 ? 'obsolete' : 'fresh');
            assert.equal(result, 'fresh');
        });
        assert.equal(fetches, 2); assert.equal(await first.get('artsoul:auction:eval-error'), null);
        assert.match(await first.get(GENERATION), UUID);
    });
});
