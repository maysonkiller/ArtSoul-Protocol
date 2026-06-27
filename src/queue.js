import dotenv from 'dotenv';

dotenv.config({ quiet: true });

let runtimePromise = null;
let queuesPromise = null;

const queueOptions = {
    indexer: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: false
    },
    ai: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false
    },
    recovery: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false
    },
    notifications: {
        attempts: 2,
        backoff: { type: 'fixed', delay: 10000 },
        removeOnComplete: true,
        removeOnFail: true
    }
};

function disabledQueue(name) {
    return {
        name,
        disabled: true,
        async add() {
            console.warn(`[Queue] ${name} skipped: REDIS_URL is not configured or queue runtime is unavailable.`);
            return null;
        },
        async getJobCounts() {
            return { waiting: 0, delayed: 0, active: 0, failed: 0 };
        },
        async close() {}
    };
}

async function loadQueueRuntime() {
    if (!process.env.REDIS_URL) {
        return { enabled: false, connection: null, Queue: null, Worker: null };
    }

    try {
        const [{ Queue, Worker }, { default: IORedis }] = await Promise.all([
            import('bullmq'),
            import('ioredis')
        ]);

        const connection = new IORedis(process.env.REDIS_URL, {
            maxRetriesPerRequest: null,
            enableOfflineQueue: false,
            retryStrategy: times => Math.min(times * 50, 2000)
        });

        connection.on('error', error => {
            console.warn(`[Queue] Redis connection warning: ${error.message}`);
        });

        return { enabled: true, connection, Queue, Worker };
    } catch (error) {
        console.warn(`[Queue] Redis queue runtime disabled: ${error.message}`);
        return { enabled: false, connection: null, Queue: null, Worker: null };
    }
}

export function getQueueRuntime() {
    if (!runtimePromise) {
        runtimePromise = loadQueueRuntime();
    }
    return runtimePromise;
}

export async function getRedisConnection() {
    const runtime = await getQueueRuntime();
    return runtime.connection;
}

async function getQueues() {
    if (queuesPromise) return queuesPromise;

    queuesPromise = (async () => {
        const runtime = await getQueueRuntime();
        if (!runtime.enabled) {
            return {
                indexerEventsQueue: disabledQueue('indexer-events'),
                aiAnalysisQueue: disabledQueue('ai-analysis'),
                recoveryQueue: disabledQueue('recovery'),
                notificationsQueue: disabledQueue('notifications')
            };
        }

        const { Queue, connection } = runtime;
        return {
            indexerEventsQueue: new Queue('indexer-events', { connection, defaultJobOptions: queueOptions.indexer }),
            aiAnalysisQueue: new Queue('ai-analysis', { connection, defaultJobOptions: queueOptions.ai }),
            recoveryQueue: new Queue('recovery', { connection, defaultJobOptions: queueOptions.recovery }),
            notificationsQueue: new Queue('notifications', { connection, defaultJobOptions: queueOptions.notifications })
        };
    })();

    return queuesPromise;
}

export class QueueCircuitBreaker {
    constructor(queueName, threshold = 10, resetTimeout = 60000) {
        this.queueName = queueName;
        this.threshold = threshold;
        this.resetTimeout = resetTimeout;
        this.failureCount = 0;
        this.lastFailureTime = 0;
        this.isOpen = false;
    }

    async recordFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        if (this.failureCount >= this.threshold) {
            this.isOpen = true;
            console.error(`[CircuitBreaker] OPEN for queue ${this.queueName}. Failures: ${this.failureCount}`);
        }
    }

    async recordSuccess() {
        this.failureCount = 0;
        this.isOpen = false;
    }

    async check() {
        if (this.isOpen && (Date.now() - this.lastFailureTime > this.resetTimeout)) {
            console.log(`[CircuitBreaker] HALF-OPEN for queue ${this.queueName}. Attempting recovery...`);
            this.isOpen = false;
            this.failureCount = 0;
        }
        return this.isOpen;
    }
}

export class DistributedLock {
    async acquire(key, ttlMs = 30000) {
        const redis = await getRedisConnection();
        if (!redis) return null;

        const lockKey = `lock:${key}`;
        const token = Math.random().toString(36).substring(2);
        const acquired = await redis.set(lockKey, token, 'NX', 'PX', ttlMs);
        return acquired === 'OK' ? token : null;
    }

    async release(key, token) {
        const redis = await getRedisConnection();
        if (!redis || !token) return;

        const lockKey = `lock:${key}`;
        const script = 'if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end';
        await redis.eval(script, 1, lockKey, token);
    }

    async extend(key, ttlMs = 30000) {
        const redis = await getRedisConnection();
        if (!redis) return;

        const lockKey = `lock:${key}`;
        await redis.pexpire(lockKey, ttlMs);
    }
}

export const lockManager = new DistributedLock();

export class QueueHealthManager {
    constructor() {
        this.thresholds = {
            'indexer-events': 1000,
            'ai-analysis': 500,
            recovery: 100,
            notifications: 2000
        };
        this.snapshots = new Map();
    }

    async getStatus() {
        const queues = await getQueues();
        const statuses = {};

        for (const [key, queue] of Object.entries(queues)) {
            const name = queue.name || key;
            const counts = await queue.getJobCounts('waiting', 'delayed', 'active', 'failed');
            const total = counts.waiting + counts.delayed + counts.active + counts.failed;
            statuses[name] = {
                waiting: counts.waiting,
                delayed: counts.delayed,
                active: counts.active,
                failed: counts.failed,
                total,
                isCongested: total > (this.thresholds[name] || 1000)
            };
        }

        this.snapshots.set(Date.now(), statuses);
        return statuses;
    }

    getQueueHealthStatus() {
        return Array.from(this.snapshots.values()).pop() || { disabled: !process.env.REDIS_URL };
    }

    async shouldPause(queueName) {
        const status = await this.getStatus();
        return status[queueName]?.isCongested || false;
    }
}

export const healthManager = new QueueHealthManager();

export const indexerEventsQueue = {
    name: 'indexer-events',
    async add(...args) {
        const queues = await getQueues();
        return queues.indexerEventsQueue.add(...args);
    },
    async getJobCounts(...args) {
        const queues = await getQueues();
        return queues.indexerEventsQueue.getJobCounts(...args);
    }
};

export const aiAnalysisQueue = {
    name: 'ai-analysis',
    async add(...args) {
        const queues = await getQueues();
        return queues.aiAnalysisQueue.add(...args);
    },
    async getJobCounts(...args) {
        const queues = await getQueues();
        return queues.aiAnalysisQueue.getJobCounts(...args);
    }
};

export const recoveryQueue = {
    name: 'recovery',
    async add(...args) {
        const queues = await getQueues();
        return queues.recoveryQueue.add(...args);
    },
    async getJobCounts(...args) {
        const queues = await getQueues();
        return queues.recoveryQueue.getJobCounts(...args);
    }
};

export const notificationsQueue = {
    name: 'notifications',
    async add(...args) {
        const queues = await getQueues();
        return queues.notificationsQueue.add(...args);
    },
    async getJobCounts(...args) {
        const queues = await getQueues();
        return queues.notificationsQueue.getJobCounts(...args);
    }
};

export async function enqueueEvent(type, payload, wallet = 'system', traceId = null) {
    try {
        const jobId = traceId || `evt-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        await indexerEventsQueue.add('process-event', {
            type,
            payload,
            wallet,
            traceId: jobId,
            timestamp: new Date().toISOString()
        }, { jobId, priority: 1 });
        return true;
    } catch (error) {
        console.error(`[Queue Error] Failed to enqueue ${type} event: ${error.message}`);
        return false;
    }
}

export async function enqueueAIJob(type, payload, wallet = 'system', traceId = null) {
    try {
        const jobId = traceId || `ai-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        await aiAnalysisQueue.add('analyze-event', {
            type,
            payload,
            wallet,
            traceId: jobId,
            timestamp: new Date().toISOString()
        }, { jobId, priority: 10 });
        return true;
    } catch (error) {
        console.error(`[Queue Error] Failed to enqueue AI job for ${type}: ${error.message}`);
        return false;
    }
}
