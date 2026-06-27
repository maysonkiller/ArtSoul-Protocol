import PostgreSQLDatabase from './postgresql-database.js';

class DistributedLock {
    constructor(database, lockName = 'indexer_leader', ttl = 15000, options = {}) {
        this.db = database;
        this.lockName = lockName;
        this.ttl = ttl;
        this.lockId = null;
        this.fencingToken = null; // CRITICAL: prevents split-brain
        this.isLeader = false;
        this.heartbeatInterval = null;
        this.onLeadershipLost = typeof options.onLeadershipLost === 'function'
            ? options.onLeadershipLost
            : null;
        this.instanceId = `indexer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Use PostgreSQL advisory lock ID (hash of lock name)
        this.advisoryLockId = this._hashLockName(lockName);

        console.log(`[DistributedLock] Instance ID: ${this.instanceId}`);
        console.log(`[DistributedLock] Advisory Lock ID: ${this.advisoryLockId}`);
    }

    /**
     * Hash lock name to integer for pg_advisory_lock
     */
    _hashLockName(name) {
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = ((hash << 5) - hash) + name.charCodeAt(i);
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash);
    }

    /**
     * Try to acquire leadership lock using PostgreSQL advisory lock
     */
    async tryAcquire() {
        if (this.isLeader && this.lockId && this.fencingToken) {
            return true;
        }

        try {
            // Try to acquire advisory lock (non-blocking)
            const result = await this.db.query(
                'SELECT pg_try_advisory_lock($1) as acquired',
                [this.advisoryLockId]
            );

            if (result[0].acquired) {
                // Successfully acquired advisory lock
                // Now register in distributed_locks table with fencing token
                const registration = await this.db.query(
                    `INSERT INTO distributed_locks (lock_name, instance_id, acquired_at, expires_at, fencing_token)
                     VALUES ($1, $2, NOW(), NOW() + INTERVAL '${this.ttl} milliseconds', 1)
                     ON CONFLICT (lock_name) DO UPDATE SET
                         instance_id = EXCLUDED.instance_id,
                         acquired_at = CASE
                             WHEN distributed_locks.instance_id = EXCLUDED.instance_id
                             THEN distributed_locks.acquired_at
                             ELSE EXCLUDED.acquired_at
                         END,
                         expires_at = EXCLUDED.expires_at,
                         last_heartbeat = CASE
                             WHEN distributed_locks.instance_id = EXCLUDED.instance_id
                             THEN NOW()
                             ELSE distributed_locks.last_heartbeat
                         END,
                         fencing_token = CASE
                             WHEN distributed_locks.instance_id = EXCLUDED.instance_id
                             THEN distributed_locks.fencing_token
                             ELSE distributed_locks.fencing_token + 1
                         END
                     RETURNING id, fencing_token`,
                    [this.lockName, this.instanceId]
                );

                this.lockId = registration[0].id;
                this.fencingToken = registration[0].fencing_token;
                this.isLeader = true;

                console.log(`[DistributedLock]  Acquired leadership lock`);
                console.log(`  Lock ID: ${this.lockId}`);
                console.log(`  Fencing Token: ${this.fencingToken}`);
                console.log(`  Advisory Lock: ${this.advisoryLockId}`);

                return true;
            }

            // Advisory lock held by another instance
            const existing = await this.db.query(
                `SELECT id, instance_id, fencing_token, expires_at FROM distributed_locks
                 WHERE lock_name = $1`,
                [this.lockName]
            );

            if (existing.length > 0) {
                const lock = existing[0];
                if (lock.instance_id === this.instanceId) {
                    this.lockId = lock.id;
                    this.fencingToken = lock.fencing_token;
                    this.isLeader = true;
                    console.log(`[DistributedLock] Leadership already held by this instance (token: ${this.fencingToken})`);
                    return true;
                }

                const now = new Date();
                const expiresAt = new Date(lock.expires_at);

                console.log(`[DistributedLock] Lock held by ${lock.instance_id} (token: ${lock.fencing_token}), expires in ${Math.round((expiresAt - now) / 1000)}s`);
            }

            this.isLeader = false;
            return false;
        } catch (error) {
            console.error('[DistributedLock] Error acquiring lock:', error.message);
            this.isLeader = false;
            return false;
        }
    }

    /**
     * Renew lock (heartbeat) - MUST check fencing token
     */
    async renew() {
        if (!this.isLeader || !this.lockId || !this.fencingToken) {
            return false;
        }

        try {
            // Update with fencing token check (prevents zombie leaders)
            const result = await this.db.query(
                `UPDATE distributed_locks
                 SET expires_at = NOW() + INTERVAL '${this.ttl} milliseconds',
                     last_heartbeat = NOW()
                 WHERE id = $1 AND instance_id = $2 AND fencing_token = $3
                 RETURNING id, fencing_token`,
                [this.lockId, this.instanceId, this.fencingToken]
            );

            if (result.length > 0) {
                console.log(`[DistributedLock] 💓 Heartbeat sent (token: ${this.fencingToken})`);
                return true;
            } else {
                console.error(`[DistributedLock]  Lost leadership - fencing token mismatch or stolen`);
                await this._handleLeadershipLost('fencing token mismatch or stolen');

                return false;
            }
        } catch (error) {
            console.error('[DistributedLock] Error renewing lock:', error.message);
            await this._handleLeadershipLost('heartbeat renewal error');

            return false;
        }
    }

    async _handleLeadershipLost(reason) {
        this.isLeader = false;
        this.lockId = null;
        this.fencingToken = null;

        // Release advisory lock
        await this._releaseAdvisoryLock();

        if (this.onLeadershipLost) {
            Promise.resolve(this.onLeadershipLost(reason)).catch(error => {
                console.error('[DistributedLock] Leadership loss callback failed:', error.message);
            });
        }
    }

    /**
     * Release advisory lock
     */
    async _releaseAdvisoryLock() {
        try {
            const result = await this.db.query(
                'SELECT pg_advisory_unlock($1) as released',
                [this.advisoryLockId]
            );
            if (result[0]?.released) {
                console.log(`[DistributedLock] Released advisory lock ${this.advisoryLockId}`);
            } else {
                console.warn(`[DistributedLock] Advisory lock ${this.advisoryLockId} was not held by this DB session`);
            }
        } catch (error) {
            console.error('[DistributedLock] Error releasing advisory lock:', error.message);
        }
    }

    /**
     * Release lock
     */
    async release() {
        if (!this.lockId) {
            return;
        }

        try {
            // Delete from table
            await this.db.query(
                `DELETE FROM distributed_locks
                 WHERE id = $1 AND instance_id = $2 AND fencing_token = $3`,
                [this.lockId, this.instanceId, this.fencingToken]
            );

            // Release advisory lock
            await this._releaseAdvisoryLock();

            console.log(`[DistributedLock] Released lock (ID: ${this.lockId}, token: ${this.fencingToken})`);
            this.lockId = null;
            this.fencingToken = null;
            this.isLeader = false;
        } catch (error) {
            console.error('[DistributedLock] Error releasing lock:', error.message);
        }
    }

    /**
     * Start heartbeat loop
     */
    startHeartbeat() {
        if (this.heartbeatInterval) {
            return;
        }

        // Send heartbeat every TTL/3 to ensure lock doesn't expire
        const heartbeatInterval = Math.floor(this.ttl / 3);

        this.heartbeatInterval = setInterval(async () => {
            if (this.isLeader) {
                const renewed = await this.renew();
                if (!renewed) {
                    console.error('[DistributedLock] Failed to renew lock, stopping heartbeat');
                    this.stopHeartbeat();
                }
            }
        }, heartbeatInterval);

        console.log(`[DistributedLock] Heartbeat started (interval: ${heartbeatInterval}ms)`);
    }

    /**
     * Stop heartbeat loop
     */
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
            console.log('[DistributedLock] Heartbeat stopped');
        }
    }

    /**
     * Check if this instance is the leader
     */
    isLeaderInstance() {
        return this.isLeader;
    }

    /**
     * Get fencing token (for write operations)
     */
    getFencingToken() {
        return this.fencingToken;
    }

    /**
     * Get current leader info
     */
    async getLeaderInfo() {
        try {
            const result = await this.db.query(
                `SELECT instance_id, fencing_token, acquired_at, expires_at, last_heartbeat
                 FROM distributed_locks
                 WHERE lock_name = $1`,
                [this.lockName]
            );

            if (result.length > 0) {
                return {
                    instanceId: result[0].instance_id,
                    fencingToken: result[0].fencing_token,
                    acquiredAt: result[0].acquired_at,
                    expiresAt: result[0].expires_at,
                    lastHeartbeat: result[0].last_heartbeat,
                    isMe: result[0].instance_id === this.instanceId
                };
            }

            return null;
        } catch (error) {
            console.error('[DistributedLock] Error getting leader info:', error.message);
            return null;
        }
    }
}

export default DistributedLock;

if (typeof window !== 'undefined') {
    window.DistributedLock = DistributedLock;
}
