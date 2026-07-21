import pg from 'pg';
const { Pool } = pg;

class PostgreSQLDatabase {
    constructor(config) {
        this.pool = new Pool({
            connectionString: config.connectionString || process.env.DATABASE_URL,
            max: config.maxConnections || 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000,
        });

        this.pool.on('error', (err) => {
            console.error('[PostgreSQL] Unexpected error on idle client:', err);
        });

        // Pool metrics for backpressure detection
        this.metrics = {
            totalCount: 0,
            idleCount: 0,
            waitingCount: 0,
            queryCount: 0,
            slowQueryCount: 0,
            avgQueryTime: 0,
            lastCheck: Date.now()
        };

        // Rate limiting
        this.maxQueriesPerSecond = config.maxQueriesPerSecond || 100;
        this.queryTimestamps = [];

        // Circuit breaker
        this.circuitBreakerThreshold = 10; // errors in window
        this.circuitBreakerWindow = 60000; // 1 minute
        this.circuitBreakerCooldown = 30000; // 30 seconds
        this.errorTimestamps = [];
        this.circuitBreakerOpen = false;
        this.circuitBreakerOpenUntil = 0;

        // Update metrics every second
        setInterval(() => {
            this.metrics.totalCount = this.pool.totalCount;
            this.metrics.idleCount = this.pool.idleCount;
            this.metrics.waitingCount = this.pool.waitingCount;
            this.metrics.lastCheck = Date.now();

            // Clean old query timestamps (rate limiting)
            const now = Date.now();
            this.queryTimestamps = this.queryTimestamps.filter(ts => now - ts < 1000);

            // Clean old error timestamps (circuit breaker)
            this.errorTimestamps = this.errorTimestamps.filter(ts => now - ts < this.circuitBreakerWindow);

            // Reset circuit breaker if cooldown expired
            if (this.circuitBreakerOpen && now >= this.circuitBreakerOpenUntil) {
                console.log('[PostgreSQL] Circuit breaker reset');
                this.circuitBreakerOpen = false;
                this.errorTimestamps = [];
            }
        }, 1000);

        console.log('[PostgreSQL] Connection pool initialized');
        console.log(`  Max connections: ${config.maxConnections || 20}`);
        console.log(`  Rate limit: ${this.maxQueriesPerSecond} queries/sec`);
    }

    getPoolMetrics() {
        return {
            ...this.metrics,
            utilization: this.metrics.totalCount > 0
                ? ((this.metrics.totalCount - this.metrics.idleCount) / this.metrics.totalCount * 100).toFixed(1)
                : 0,
            isHealthy: this.metrics.waitingCount < 5  // Backpressure threshold
        };
    }

    isBackpressure() {
        // Detect backpressure conditions
        return this.metrics.waitingCount > 5 ||
               (this.metrics.totalCount - this.metrics.idleCount) > 15 ||
               this.metrics.avgQueryTime > 2000;
    }

    async query(text, params = []) {
        // Check circuit breaker
        if (this.circuitBreakerOpen) {
            const remainingMs = this.circuitBreakerOpenUntil - Date.now();
            throw new Error(`[PostgreSQL] Circuit breaker open, retry in ${Math.round(remainingMs / 1000)}s`);
        }

        // Rate limiting
        const now = Date.now();
        this.queryTimestamps.push(now);

        if (this.queryTimestamps.length > this.maxQueriesPerSecond) {
            console.warn(`[PostgreSQL] Rate limit exceeded: ${this.queryTimestamps.length} queries/sec`);
            // Wait a bit before proceeding
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        const start = Date.now();
        try {
            const result = await this.pool.query(text, params);
            const duration = Date.now() - start;

            // Update metrics
            this.metrics.queryCount++;
            this.metrics.avgQueryTime = this.metrics.avgQueryTime === 0
                ? duration
                : this.metrics.avgQueryTime * 0.9 + duration * 0.1;

            if (duration > 1000) {
                this.metrics.slowQueryCount++;
                console.warn(`[PostgreSQL] Slow query (${duration}ms):`, text.substring(0, 100));
            }

            return result.rows;
        } catch (error) {
            // Track error for circuit breaker
            this.errorTimestamps.push(Date.now());

            // Check if we should open circuit breaker
            if (this.errorTimestamps.length >= this.circuitBreakerThreshold) {
                console.error(`[PostgreSQL] Circuit breaker triggered (${this.errorTimestamps.length} errors in ${this.circuitBreakerWindow}ms)`);
                this.circuitBreakerOpen = true;
                this.circuitBreakerOpenUntil = Date.now() + this.circuitBreakerCooldown;
            }

            console.error('[PostgreSQL] Query error:', error.message);
            console.error('  Query:', text.substring(0, 200));
            console.error('  Params:', params);
            throw error;
        }
    }

    async batchInsert(table, columns, rows, onConflict = 'DO NOTHING') {
        if (rows.length === 0) return 0;

        // Whitelist of allowed tables (prevents SQL injection)
        const ALLOWED_TABLES = {
            'block_hashes': true,
            'contract_events': true,
            'indexed_auctions': true,
            'indexed_bids': true
        };

        if (!ALLOWED_TABLES[table]) {
            throw new Error(`[PostgreSQL] Table '${table}' not in whitelist`);
        }

        // Whitelist of allowed columns per table
        const ALLOWED_COLUMNS = {
            'block_hashes': ['chain_id', 'block_number', 'block_hash', 'parent_hash', 'timestamp'],
            'contract_events': ['chain_id', 'event_name', 'artwork_id', 'block_number', 'transaction_hash', 'log_index', 'event_data', 'indexed_at'],
            'indexed_auctions': ['artwork_id', 'seller', 'starting_price', 'start_time', 'end_time', 'block_number', 'transaction_hash', 'indexed_at', 'last_updated_block', 'last_updated_at'],
            'indexed_bids': ['artwork_id', 'bidder', 'amount', 'timestamp', 'block_number', 'transaction_hash', 'indexed_at']
        };

        // Validate columns
        const allowedCols = ALLOWED_COLUMNS[table];
        for (const col of columns) {
            if (!allowedCols.includes(col)) {
                throw new Error(`[PostgreSQL] Column '${col}' not allowed for table '${table}'`);
            }
        }

        // Build VALUES clause: ($1, $2, $3), ($4, $5, $6), ...
        const valuesPerRow = columns.length;
        const valuesClauses = [];
        const allParams = [];

        for (let i = 0; i < rows.length; i++) {
            const placeholders = [];
            for (let j = 0; j < valuesPerRow; j++) {
                placeholders.push(`$${i * valuesPerRow + j + 1}`);
                allParams.push(rows[i][j]);
            }
            valuesClauses.push(`(${placeholders.join(', ')})`);
        }

        // Safe: table and columns are whitelisted, only params are user data
        const query = `
            INSERT INTO ${table} (${columns.join(', ')})
            VALUES ${valuesClauses.join(', ')}
            ON CONFLICT ${onConflict}
        `;

        const result = await this.query(query, allParams);
        return result.length;
    }

    async transaction(callback) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async healthCheck() {
        try {
            const result = await this.query('SELECT NOW() as time, version() as version');
            return {
                healthy: true,
                timestamp: result[0].time,
                version: result[0].version
            };
        } catch (error) {
            return {
                healthy: false,
                error: error.message
            };
        }
    }

    async close() {
        await this.pool.end();
        console.log('[PostgreSQL] Connection pool closed');
    }
}

export default PostgreSQLDatabase;

if (typeof window !== 'undefined') {
    window.PostgreSQLDatabase = PostgreSQLDatabase;
}
