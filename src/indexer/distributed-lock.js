class DistributedLock {
    constructor(database, lockName = 'indexer_leader', ttl = 15000, options = {}) {
        this.db = database;
        this.lockName = lockName;
        this.ttl = ttl;
        this.lockId = null;
        this.fencingToken = null;
        this.isLeader = false;
        this.heartbeatInterval = null;
        this.heartbeatInFlight = false;
        this.session = null;
        this.operation = Promise.resolve();
        this.epoch = 0;
        this.onLeadershipLost = typeof options.onLeadershipLost === 'function' ? options.onLeadershipLost : null;
        this.instanceId = `indexer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.advisoryLockId = this._hashLockName(lockName);

        // A checked-out client still cannot hold a session lock through a
        // transaction pooler. Require an explicit operational mode change.
        const poolOptions = database.pool?.options || {};
        let endpoint;
        try { endpoint = poolOptions.connectionString ? new URL(poolOptions.connectionString) : null; }
        catch { throw new Error('Invalid database endpoint for distributed leadership'); }
        const host = endpoint?.hostname || poolOptions.host || '';
        const port = Number(endpoint?.port || poolOptions.port || 5432);
        if (/(^|\.)pooler\.supabase\.com$/i.test(host) && port === 6543) {
            throw new Error('Distributed leadership requires Supavisor session mode (port 5432), not transaction mode (port 6543).');
        }
        if (!Number.isSafeInteger(ttl) || ttl < 3) throw new Error('Invalid distributed lock TTL');
        console.log(`[DistributedLock] Instance ID: ${this.instanceId}`);
        console.log(`[DistributedLock] Advisory Lock ID: ${this.advisoryLockId}`);
    }

    _hashLockName(name) {
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = ((hash << 5) - hash) + name.charCodeAt(i);
            hash = hash & hash;
        }
        return Math.abs(hash);
    }

    _serialize(work) {
        const operation = this.operation.then(work);
        this.operation = operation.catch(() => {});
        return operation;
    }

    async _query(session, text, values = []) {
        if (session.released || session.broken) throw new Error('Leadership database session is unavailable');
        try {
            const result = await session.client.query({text, values, query_timeout: Math.min(5000, Math.floor(this.ttl / 3))});
            return result.rows;
        } catch (error) {
            if (error.message === 'Query read timeout') session.broken = true;
            throw error;
        }
    }

    _fence(reason) {
        const wasLeader = this.isLeader;
        this.epoch++;
        this.isLeader = false;
        this.lockId = null;
        this.fencingToken = null;
        this.stopHeartbeat();
        if (wasLeader && reason && this.onLeadershipLost) {
            try {
                Promise.resolve(this.onLeadershipLost(reason)).catch(error => {
                    console.error('[DistributedLock] Leadership loss callback failed:', error.message);
                });
            } catch (error) {
                console.error('[DistributedLock] Leadership loss callback failed:', error.message);
            }
        }
    }

    _returnSession(session, destroy) {
        if (session.released) return;
        session.released = true;
        session.client.removeListener('error', session.onError);
        session.client.removeListener('end', session.onEnd);
        if (this.session === session) this.session = null;
        session.client.release(destroy);
    }

    async _closeSession(session) {
        if (!session || session.released) return;
        let destroy = session.broken || session.destroy;
        try {
            if (!session.broken && session.lockId) {
                await this._query(session, `DELETE FROM distributed_locks
                    WHERE id = $1 AND instance_id = $2 AND fencing_token = $3`,
                [session.lockId, this.instanceId, session.fencingToken]);
            }
        } catch (error) {
            destroy = true;
            console.error('[DistributedLock] Error removing owned lock row:', error.message);
        }
        try {
            if (!session.broken && session.acquired && !session.released) {
                const result = await this._query(session,
                    'SELECT pg_backend_pid() AS pid, pg_advisory_unlock($1) AS released', [this.advisoryLockId]);
                if (result[0]?.released !== true || result[0].pid !== session.pid) destroy = true;
            }
        } catch (error) {
            destroy = true;
            console.error('[DistributedLock] Error releasing advisory lock:', error.message);
        } finally {
            this._returnSession(session, destroy || session.broken);
        }
    }

    tryAcquire() {
        const epoch = this.epoch;
        return this._serialize(async () => {
            if (epoch !== this.epoch) return false;
            if (this.isLeader && this.session) return this._renew(this.session);
            let session;
            try {
                const client = await this.db.pool.connect();
                session = {client, acquired: false, released: false, broken: false};
                const lost = () => {
                    session.broken = true;
                    if (this.session === session) this._fence('leadership database session lost');
                    this._returnSession(session, true);
                };
                session.onError = lost;
                session.onEnd = lost;
                client.on('error', session.onError);
                client.on('end', session.onEnd);
                this.session = session;
                if (epoch !== this.epoch) return false;

                const result = await this._query(session,
                    'SELECT pg_backend_pid() AS pid, pg_try_advisory_lock($1) AS acquired', [this.advisoryLockId]);
                session.pid = result[0].pid;
                session.acquired = result[0].acquired;
                if (!session.acquired) return false;

                // Registration and renewal require the actual lock on this same
                // backend. A stale row bearing our instance ID is never enough.
                const registration = await this._query(session,
                    `INSERT INTO distributed_locks (lock_name, instance_id, acquired_at, expires_at, last_heartbeat, fencing_token)
                     SELECT $1, $2, NOW(), NOW() + $3 * INTERVAL '1 millisecond', NOW(), 1
                     WHERE pg_backend_pid() = $4 AND EXISTS (
                         SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()
                           AND classid = 0 AND objid = $5::oid AND objsubid = 1 AND granted)
                     ON CONFLICT (lock_name) DO UPDATE SET instance_id = EXCLUDED.instance_id,
                         acquired_at = EXCLUDED.acquired_at, expires_at = EXCLUDED.expires_at,
                         last_heartbeat = EXCLUDED.last_heartbeat, fencing_token = distributed_locks.fencing_token + 1
                     RETURNING id, fencing_token`,
                    [this.lockName, this.instanceId, this.ttl, session.pid, this.advisoryLockId]);
                if (!registration.length) throw new Error('Advisory lock session ownership was lost');
                session.lockId = registration[0].id;
                session.fencingToken = registration[0].fencing_token;
                if (epoch !== this.epoch || session.released || this.session !== session) return false;
                this.lockId = session.lockId;
                this.fencingToken = session.fencingToken;
                this.isLeader = true;
                return true;
            } catch (error) {
                // The server may have acquired the lock before cancellation or
                // loss of its acknowledgement. Never recycle that connection.
                if (session) session.destroy = true;
                console.error('[DistributedLock] Error acquiring lock:', error.message);
                return false;
            } finally {
                if (!this.isLeader || this.session !== session) await this._closeSession(session);
            }
        });
    }

    async _renew(session) {
        if (!this.isLeader || !session || this.session !== session || !session.lockId) return false;
        try {
            const result = await this._query(session,
                `UPDATE distributed_locks SET expires_at = NOW() + $4 * INTERVAL '1 millisecond', last_heartbeat = NOW()
                 WHERE id = $1 AND instance_id = $2 AND fencing_token = $3 AND pg_backend_pid() = $5
                   AND EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()
                     AND classid = 0 AND objid = $6::oid AND objsubid = 1 AND granted)
                 RETURNING id, fencing_token`,
                [session.lockId, this.instanceId, session.fencingToken, this.ttl, session.pid, this.advisoryLockId]);
            if (result.length && this.isLeader && this.session === session && !session.released) return true;
            this._fence('advisory ownership or fencing token lost');
        } catch (error) {
            console.error('[DistributedLock] Error renewing lock:', error.message);
            this._fence('heartbeat renewal error');
        }
        await this._closeSession(session);
        return false;
    }

    renew() {
        return this._serialize(() => this._renew(this.session));
    }

    release() {
        this._fence(null);
        return this._serialize(() => this._closeSession(this.session));
    }

    startHeartbeat() {
        if (this.heartbeatInterval) return;
        this.heartbeatInterval = setInterval(async () => {
            if (!this.isLeader || this.heartbeatInFlight) return;
            this.heartbeatInFlight = true;
            try {
                if (!await this.renew()) this.stopHeartbeat();
            } finally {this.heartbeatInFlight = false;}
        }, Math.floor(this.ttl / 3));
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
    }

    isLeaderInstance() { return this.isLeader; }

    getFencingToken() { return this.fencingToken; }

    getPinnedClientCount() { return this.session && !this.session.released ? 1 : 0; }

    getLeaderInfo() {
        return this._serialize(async () => {
            const session = this.session;
            try {
                const query = `SELECT instance_id, fencing_token, acquired_at, expires_at, last_heartbeat, pg_backend_pid() AS pid,
                    EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()
                        AND classid = 0 AND objid = $2::oid AND objsubid = 1 AND granted) AS owns_advisory
                    FROM distributed_locks WHERE lock_name = $1`;
                const values = [this.lockName, this.advisoryLockId];
                const result = session ? await this._query(session, query, values) : await this.db.query(query, values);
                if (session && (!result.length || result[0].pid !== session.pid || !result[0].owns_advisory ||
                    result[0].instance_id !== this.instanceId || result[0].fencing_token !== session.fencingToken)) {
                    this._fence('leadership status ownership lost');
                    await this._closeSession(session);
                    return null;
                }
                if (!result.length) return null;
                return {instanceId: result[0].instance_id, fencingToken: result[0].fencing_token,
                    acquiredAt: result[0].acquired_at, expiresAt: result[0].expires_at,
                    lastHeartbeat: result[0].last_heartbeat, isMe: this.isLeader && result[0].instance_id === this.instanceId};
            } catch (error) {
                console.error('[DistributedLock] Error getting leader info:', error.message);
                if (session && this.session === session) {
                    this._fence('leadership status check error');
                    await this._closeSession(session);
                }
                return null;
            }
        });
    }
}

export default DistributedLock;

if (typeof window !== 'undefined') window.DistributedLock = DistributedLock;
