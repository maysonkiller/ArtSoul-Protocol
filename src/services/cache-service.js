import { getRedisConnection } from '../queue.js';
import { randomUUID } from 'node:crypto';

const RECOVERY_GENERATION_KEY = 'artsoul:cache:recovery-generation';
// The comparison and write must be indivisible across API/indexer processes.
const STORE_IN_GENERATION = `
    if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
    redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
    return 1
`;

class CacheService {
    constructor() {
        this.isEnabled = false;
        this.keys = {
            auction: id => `artsoul:auction:${id}`,
            bids: id => `artsoul:bids:${id}`,
            wallet: address => `artsoul:wallet:${address}`,
            stats: name => `artsoul:stats:${name}`
        };
    }

    async getRedis() {
        const redis = await getRedisConnection();
        this.isEnabled = Boolean(redis);
        return redis;
    }

    async invalidateAuctionState(artworkId) {
        await this.del([
            this.keys.auction(artworkId),
            this.keys.bids(artworkId)
        ]);
    }

    async purge({ strict = false } = {}) {
        const redis = await this.getRedis();
        if (!redis) {
            if (strict && process.env.REDIS_URL) throw new Error('Recovery cache connection unavailable');
            return false;
        }

        try {
            // Fence in-flight fetches even when the cache was empty at purge time.
            // Never expire or delete this marker as part of the data purge.
            if (await redis.set(RECOVERY_GENERATION_KEY, randomUUID()) !== 'OK') {
                throw new Error('Recovery cache generation unavailable');
            }
            const keys = (await redis.keys('artsoul:*')).filter(key => key !== RECOVERY_GENERATION_KEY);
            if (keys.length > 0) {
                await redis.del(...keys);
                console.log(`[Cache] Recovery purge cleared ${keys.length} keys`);
            }
            return true;
        } catch (error) {
            this.handleRedisError('purge', error);
            if (strict) throw error;
            return false;
        }
    }

    async get(key) {
        const redis = await this.getRedis();
        if (!redis) return null;

        try {
            const data = await redis.get(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            this.handleRedisError(`get(${key})`, error);
            return null;
        }
    }

    async set(key, value, ttl = 3600) {
        const redis = await this.getRedis();
        if (!redis) return;

        try {
            await redis.set(key, JSON.stringify(value), 'EX', ttl);
        } catch (error) {
            this.handleRedisError(`set(${key})`, error);
        }
    }

    async del(keys) {
        const redis = await this.getRedis();
        if (!redis) return;

        try {
            const keysToDelete = Array.isArray(keys) ? keys : [keys];
            if (keysToDelete.length > 0) {
                await redis.del(...keysToDelete);
            }
        } catch (error) {
            this.handleRedisError('del', error);
        }
    }

    async mget(keys) {
        const redis = await this.getRedis();
        if (!redis) return new Array(keys.length).fill(null);

        try {
            const data = await redis.mget(...keys);
            return data.map(item => item ? JSON.parse(item) : null);
        } catch (error) {
            this.handleRedisError('mget', error);
            return new Array(keys.length).fill(null);
        }
    }

    async remember(key, ttl, asyncFetcher) {
        const cached = await this.get(key);
        if (cached !== null) return cached;

        let redis, generation;
        try {
            redis = await this.getRedis();
            if (redis) {
                generation = await redis.get(RECOVERY_GENERATION_KEY);
                if (!generation) {
                    await redis.set(RECOVERY_GENERATION_KEY, randomUUID(), 'NX');
                    generation = await redis.get(RECOVERY_GENERATION_KEY);
                }
            }
        } catch (error) {
            this.handleRedisError('read recovery generation', error);
        }
        // No nil/default generation: losing the marker must not allow ABA reuse.
        if (!generation) return asyncFetcher();

        const freshData = await asyncFetcher();
        if (freshData === null || freshData === undefined) return freshData;
        try {
            const stored = await redis.eval(STORE_IN_GENERATION, 2,
                RECOVERY_GENERATION_KEY, key, generation, JSON.stringify(freshData), ttl);
            if (stored === 1) return freshData;
        } catch (error) {
            this.handleRedisError(`remember(${key})`, error);
        }
        // A rewind crossed the fetch, or the guarded write could not be proven.
        // Re-read once without caching; repeated purges cannot cause a retry loop.
        // Fetch errors deliberately propagate, rather than serving the old result.
        return asyncFetcher();
    }

    handleRedisError(operation, error) {
        this.isEnabled = false;
        console.warn(`[Cache] ${operation} skipped: ${error.message}`);
    }
}

export default new CacheService();
