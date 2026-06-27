import promClient from 'prom-client';

class IndexerMetrics {
    constructor() {
        // Create a Registry
        this.register = new promClient.Registry();

        // Add default metrics (process CPU, memory, etc.)
        promClient.collectDefaultMetrics({ register: this.register });

        // Custom metrics
        this.blocksProcessed = new promClient.Counter({
            name: 'indexer_blocks_processed_total',
            help: 'Total number of blocks processed',
            labelNames: ['status'], // success, failed
            registers: [this.register]
        });

        this.eventsProcessed = new promClient.Counter({
            name: 'indexer_events_processed_total',
            help: 'Total number of events processed',
            labelNames: ['event_type', 'status'], // event_type: AuctionCreated, BidPlaced, etc. status: success, failed
            registers: [this.register]
        });

        this.rpcLatency = new promClient.Histogram({
            name: 'indexer_rpc_latency_seconds',
            help: 'RPC call latency in seconds',
            labelNames: ['rpc_url', 'method'], // method: getLogs, getBlock, etc.
            buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
            registers: [this.register]
        });

        this.rpcErrors = new promClient.Counter({
            name: 'indexer_rpc_errors_total',
            help: 'Total number of RPC errors',
            labelNames: ['rpc_url', 'error_type'],
            registers: [this.register]
        });

        this.rpcHealthScore = new promClient.Gauge({
            name: 'indexer_rpc_health_score',
            help: 'Current health score of each RPC (0-100)',
            labelNames: ['rpc_url'],
            registers: [this.register]
        });

        this.dbPoolSize = new promClient.Gauge({
            name: 'indexer_db_pool_total',
            help: 'Total number of database connections in pool',
            registers: [this.register]
        });

        this.dbPoolIdle = new promClient.Gauge({
            name: 'indexer_db_pool_idle',
            help: 'Number of idle database connections',
            registers: [this.register]
        });

        this.dbPoolWaiting = new promClient.Gauge({
            name: 'indexer_db_pool_waiting',
            help: 'Number of queries waiting for a connection',
            registers: [this.register]
        });

        this.dbQueryDuration = new promClient.Histogram({
            name: 'indexer_db_query_duration_seconds',
            help: 'Database query duration in seconds',
            labelNames: ['query_type'], // insert, select, update, delete
            buckets: [0.001, 0.01, 0.1, 0.5, 1, 2, 5],
            registers: [this.register]
        });

        this.failedEventsQueue = new promClient.Gauge({
            name: 'indexer_failed_events_queue_size',
            help: 'Number of events in dead-letter queue',
            registers: [this.register]
        });

        this.blockLag = new promClient.Gauge({
            name: 'indexer_block_lag',
            help: 'Number of blocks behind current chain head',
            registers: [this.register]
        });

        this.reorgsDetected = new promClient.Counter({
            name: 'indexer_reorgs_detected_total',
            help: 'Total number of reorgs detected',
            labelNames: ['depth'], // depth: shallow (<10), medium (10-100), deep (>100)
            registers: [this.register]
        });

        this.concurrencyLevel = new promClient.Gauge({
            name: 'indexer_concurrency_level',
            help: 'Current concurrency level (number of workers)',
            registers: [this.register]
        });

        this.backpressureActive = new promClient.Gauge({
            name: 'indexer_backpressure_active',
            help: 'Whether DB backpressure is currently active (0 or 1)',
            registers: [this.register]
        });

        console.log('[IndexerMetrics] Prometheus metrics initialized');
    }

    // Block processing
    recordBlockProcessed(success = true) {
        this.blocksProcessed.inc({ status: success ? 'success' : 'failed' });
    }

    // Event processing
    recordEventProcessed(eventType, success = true) {
        this.eventsProcessed.inc({
            event_type: eventType,
            status: success ? 'success' : 'failed'
        });
    }

    // RPC metrics
    recordRpcLatency(rpcUrl, method, durationSeconds) {
        this.rpcLatency.observe({ rpc_url: rpcUrl, method }, durationSeconds);
    }

    recordRpcError(rpcUrl, errorType) {
        this.rpcErrors.inc({ rpc_url: rpcUrl, error_type: errorType });
    }

    updateRpcHealthScore(rpcUrl, score) {
        this.rpcHealthScore.set({ rpc_url: rpcUrl }, score);
    }

    // DB metrics
    updateDbPoolMetrics(totalCount, idleCount, waitingCount) {
        this.dbPoolSize.set(totalCount);
        this.dbPoolIdle.set(idleCount);
        this.dbPoolWaiting.set(waitingCount);
    }

    recordDbQuery(queryType, durationSeconds) {
        this.dbQueryDuration.observe({ query_type: queryType }, durationSeconds);
    }

    // Failed events
    updateFailedEventsQueue(size) {
        this.failedEventsQueue.set(size);
    }

    // Block lag
    updateBlockLag(lag) {
        this.blockLag.set(lag);
    }

    // Reorgs
    recordReorg(depth) {
        let depthLabel = 'shallow';
        if (depth >= 100) depthLabel = 'deep';
        else if (depth >= 10) depthLabel = 'medium';

        this.reorgsDetected.inc({ depth: depthLabel });
    }

    // Concurrency
    updateConcurrency(level) {
        this.concurrencyLevel.set(level);
    }

    // Backpressure
    updateBackpressure(active) {
        this.backpressureActive.set(active ? 1 : 0);
    }

    // Get metrics for /metrics endpoint
    async getMetrics() {
        return await this.register.metrics();
    }

    // Get content type for response
    getContentType() {
        return this.register.contentType;
    }
}

export default IndexerMetrics;

if (typeof window !== 'undefined') {
    window.IndexerMetrics = IndexerMetrics;
}
