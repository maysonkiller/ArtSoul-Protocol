import { getRedisConnection } from '../queue.js';

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

    async purge() {
        const redis = await this.getRedis();
        if (!redis) return;

        try {
            const keys = await redis.keys('artsoul:*');
            if (keys.length > 0) {
                await redis.del(...keys);
                console.log(`[Cache] Recovery purge cleared ${keys.length} keys`);
            }
        } catch (error) {
            this.handleRedisError('purge', error);
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

        const freshData = await asyncFetcher();
        if (freshData !== null && freshData !== undefined) {
            await this.set(key, freshData, ttl);
        }
        return freshData;
    }

    handleRedisError(operation, error) {
        this.isEnabled = false;
        console.warn(`[Cache] ${operation} skipped: ${error.message}`);
    }
}

export default new CacheService();
