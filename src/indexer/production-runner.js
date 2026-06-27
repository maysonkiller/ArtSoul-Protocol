import EventListener from './event-listener.js';
import IndexerSyncEngine from './sync-engine.js';
import PostgreSQLDatabase from './postgresql-database.js';
import IndexerMetrics from './metrics.js';
import DistributedLock from './distributed-lock.js';
import { requireEnv, resolveIndexerChainConfigs } from './chain-config.js';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

function resolveProductionIndexerConfig() {
    const chains = resolveIndexerChainConfigs();
    if (chains.length > 1) {
        throw new Error(
            `Multiple indexer chains configured (${chains.map(chain => chain.slug).join(', ')}). ` +
            'Run one indexer process per chain so replay, locks, and cache ownership stay isolated.'
        );
    }

    const chain = chains[0];

    return {
        databaseUrl: requireEnv(['DATABASE_URL'], 'DATABASE_URL'),
        rpcUrl: chain.rpcUrl,
        contractAddress: chain.coreAddress,
        nftAddress: chain.nftAddress,
        projectNFTAddress: chain.projectNFTAddress,
        chainId: chain.chainId,
        chainSlug: chain.slug,
        startBlock: chain.startBlock,
        lockName: chain.lockName,
        confirmationDepth: chain.confirmationDepth,
        pollInterval: parseInt(process.env.INDEXER_POLL_INTERVAL || '15000', 10),
        healthPort: parseInt(process.env.INDEXER_HEALTH_PORT || '3001', 10),
        alertWebhook: process.env.ALERT_WEBHOOK
    };
}

class ProductionIndexer {
    constructor(config) {
        this.config = config;
        this.db = new PostgreSQLDatabase({
            connectionString: config.databaseUrl
        });

        // Support multiple RPC endpoints
        const rpcUrls = config.rpcUrl.includes(',')
            ? config.rpcUrl.split(',').map(url => url.trim())
            : [config.rpcUrl];

        // Prometheus metrics
        this.metrics = new IndexerMetrics();

        this.eventListener = new EventListener({
            rpcUrl: rpcUrls,
            contractAddress: config.contractAddress,
            chainId: config.chainId
        }, this.metrics);

        this.syncEngine = new IndexerSyncEngine(this.db, this.eventListener, this.metrics);

        // Distributed lock for multi-instance coordination
        this.distributedLock = new DistributedLock(
            this.db,
            config.lockName || `indexer_leader_${config.chainId}`,
            config.lockTTL || 15000,
            {
                onLeadershipLost: (reason) => this._handleLeadershipLost(reason)
            }
        );
        this.leaderCheckInterval = null;

        this.confirmationDepth = config.confirmationDepth || 12;
        this.pollInterval = config.pollInterval || 15000;
        this.isLeader = false;
        this.isRunning = false;
        this.leaderElectionInProgress = false;
        this.leadershipLossInProgress = false;
        this.catchUpInProgress = false;
        this.confirmationTimer = null;
        this.failedEventsMetricsAvailable = true;
        this.failedEventsMetricsWarningLogged = false;

        // Failed events retry timer
        this.retryTimer = null;

        // Webhook configuration
        this.alertWebhook = config.alertWebhook || process.env.ALERT_WEBHOOK;

        // Alert deduplication
        this.alertCooldowns = new Map();
        this.alertCleanupInterval = 600000; // Clean up every 10 minutes
        this.lastAlertCleanup = Date.now();

        // Performance tracking (legacy, kept for compatibility)
        this.perfMetrics = {
            rpcLatencyMs: 0,
            eventsPerSecond: 0,
            blocksPerSecond: 0,
            rpcErrorsLastMinute: 0,
            lastErrorTime: 0,
            lastProgressCheck: Date.now(),
            lastProgressBlock: 0
        };
        // Legacy health/alert paths read scalar values from this.metrics.
        Object.assign(this.metrics, this.perfMetrics);

        // Alert thresholds
        this.alertThresholds = {
            minBlocksPerSecond: 100,
            maxRpcErrorsPerMinute: 5,
            maxLatencyMs: 10000,
            progressCheckInterval: 300000  // 5 minutes
        };

        // Start metrics update loop
        this._startMetricsUpdateLoop();

        console.log('[ProductionIndexer] Initialized');
        console.log('  Contract:', config.contractAddress);
        console.log('  Chain:', config.chainSlug || config.chainId);
        console.log('  Confirmation Depth:', this.confirmationDepth);
        console.log('  Poll Interval:', this.pollInterval, 'ms');
        console.log('  Health Port:', config.healthPort);
        console.log('  Alert Webhook:', this.alertWebhook ? 'Configured' : 'Not configured');
        console.log('  Prometheus Metrics:', 'Enabled');
        console.log('  Distributed Lock:', 'Enabled (multi-instance safe)');
    }

    /**
     * Try to become leader
     */
    async _tryBecomeLeader() {
        if (this.isLeader === true) {
            return true;
        }

        if (this.leaderElectionInProgress) {
            return this.isLeader;
        }

        this.leaderElectionInProgress = true;

        try {
        const acquired = await this.distributedLock.tryAcquire();

        if (acquired && !this.isLeader) {
            this.isLeader = true;
            console.log('[ProductionIndexer] 👑 Became leader, starting indexer');
            await this._startAsLeader();
        } else if (!acquired && (this.isLeader || this.isRunning)) {
            console.log('[ProductionIndexer] 👥 Lost leadership, stopping indexer');
            await this._stopAsFollower();
        }

        return acquired;
        } catch (error) {
            this.isLeader = false;
            throw error;
        } finally {
            this.leaderElectionInProgress = false;
        }
    }

    async _handleLeadershipLost(reason) {
        if (this.leadershipLossInProgress) {
            return;
        }

        this.leadershipLossInProgress = true;
        try {
            console.error(`[ProductionIndexer] Lost distributed leadership: ${reason}`);
            this.isLeader = false;
            await this._stopAsFollower();
        } catch (error) {
            console.error('[ProductionIndexer] Error while stopping after leadership loss:', error.message);
        } finally {
            this.leadershipLossInProgress = false;
        }
    }

    /**
     * Start as leader
     */
    async _startAsLeader() {
        if (this.isRunning) {
            return;
        }

        console.log('[ProductionIndexer] Starting as leader...');

        // Start heartbeat
        this.distributedLock.startHeartbeat();

        // Start indexer
        this.isRunning = true;
        await this.syncEngine.start();
        await this._catchUpToSafeBlock('leader_start');

        // Start confirmation polling
        this._startConfirmationPolling();

        // Start failed events retry
        this._startFailedEventsRetry();

        // Start stuck processor reaper
        this._startStuckProcessorReaper();

        console.log('[ProductionIndexer] Leader started');
    }

    /**
     * Start stuck processor reaper (recovers hung events)
     * Uses heartbeat-based detection instead of just TTL
     */
    _startStuckProcessorReaper() {
        // Check for stuck events every 2 minutes
        this.reaperTimer = setInterval(async () => {
            try {
                // Find events stuck in 'processing' with stale heartbeat (> 2 minutes)
                // This is better than TTL because it detects actual worker death
                const stuckEvents = await this.db.query(
                    `UPDATE event_processing_registry
                     SET processing_status = 'pending',
                         processing_started_at = NULL,
                         owner_worker_id = NULL,
                         retry_count = retry_count + 1
                     WHERE chain_id = $1
                       AND processing_status = 'processing'
                       AND (
                           last_heartbeat_at < NOW() - INTERVAL '2 minutes'
                           OR last_heartbeat_at IS NULL
                       )
                     RETURNING event_hash, event_name, retry_count, owner_worker_id,
                               EXTRACT(EPOCH FROM (NOW() - last_heartbeat_at)) as stale_seconds`,
                    [this.config.chainId.toString()]
                );

                if (stuckEvents.length > 0) {
                    console.warn(JSON.stringify({
                        phase: 'reaper',
                        action: 'recovered_stuck_events',
                        count: stuckEvents.length,
                        events: stuckEvents.map(e => ({
                            event_hash: e.event_hash,
                            event_name: e.event_name,
                            retry_count: e.retry_count,
                            previous_owner: e.owner_worker_id,
                            stale_seconds: Math.floor(e.stale_seconds)
                        }))
                    }));
                }
            } catch (error) {
                console.error(JSON.stringify({
                    phase: 'reaper',
                    action: 'error',
                    error: error.message
                }));
            }
        }, 120000); // Every 2 minutes

        console.log('[ProductionIndexer] Stuck processor reaper started (heartbeat-based)');
    }

    /**
     * Stop as follower (lost leadership)
     */
    async _stopAsFollower() {
        this.isLeader = false;

        if (!this.isRunning) {
            this.distributedLock.stopHeartbeat();
            return;
        }

        console.log('[ProductionIndexer] Stopping as follower...');

        // Stop timers
        if (this.confirmationTimer) {
            clearInterval(this.confirmationTimer);
            this.confirmationTimer = null;
        }

        if (this.retryTimer) {
            clearInterval(this.retryTimer);
            this.retryTimer = null;
        }

        if (this.reaperTimer) {
            clearInterval(this.reaperTimer);
            this.reaperTimer = null;
        }

        // Stop heartbeat
        this.distributedLock.stopHeartbeat();

        // Stop indexer
        this.isRunning = false;
        await this.syncEngine.stop();

        console.log('[ProductionIndexer] Follower stopped');
    }

    /**
     * Start leader election loop
     */
    _startLeaderElection() {
        // Try to become leader immediately
        this._tryBecomeLeader();

        // Check leadership every 5 seconds
        this.leaderCheckInterval = setInterval(async () => {
            if (this.isLeader === true) {
                return;
            }

            await this._tryBecomeLeader();
        }, 5000);

        console.log('[ProductionIndexer] Leader election started');
    }

    /**
     * Stop leader election
     */
    _stopLeaderElection() {
        if (this.leaderCheckInterval) {
            clearInterval(this.leaderCheckInterval);
            this.leaderCheckInterval = null;
        }
    }

    /**
     * Update Prometheus metrics periodically
     */
    _startMetricsUpdateLoop() {
        this.metricsUpdating = false;

        setInterval(async () => {
            // Prevent overlapping updates
            if (this.metricsUpdating) {
                console.warn('[ProductionIndexer] Metrics update still running, skipping');
                return;
            }

            this.metricsUpdating = true;

            try {
                // Update DB pool metrics
                const poolMetrics = this.db.getPoolMetrics();
                this.metrics.updateDbPoolMetrics(
                    poolMetrics.totalCount,
                    poolMetrics.idleCount,
                    poolMetrics.waitingCount
                );

                // Update RPC health scores
                const rpcHealth = this.eventListener.getRpcHealth();
                for (const rpc of rpcHealth) {
                    this.metrics.updateRpcHealthScore(rpc.url, rpc.healthScore);
                }

                await this._updateFailedEventsQueueMetric();

                // Update block lag
                const state = await this.syncEngine.getIndexerState();
                if (state) {
                    const currentBlock = await this.eventListener.getCurrentBlock();
                    const lag = currentBlock - state.last_indexed_block;
                    this.metrics.updateBlockLag(lag);
                }

                // Update backpressure status
                this.metrics.updateBackpressure(this.db.isBackpressure());
            } catch (error) {
                console.error('[ProductionIndexer] Metrics update error:', error.message);
            } finally {
                this.metricsUpdating = false;
            }
        }, 5000); // Update every 5 seconds
    }

    _isMissingFailedEventsTable(error) {
        const message = String(error?.message || '').toLowerCase();
        const relation = String(error?.relation || error?.table || '').toLowerCase();
        return (relation === 'failed_events' || message.includes('failed_events')) &&
            (
                error?.code === '42P01' ||
                message.includes('does not exist') ||
                message.includes('relation') ||
                message.includes('undefined_table')
            );
    }

    async _updateFailedEventsQueueMetric() {
        if (!this.failedEventsMetricsAvailable) {
            this.metrics.updateFailedEventsQueue(0);
            return;
        }

        try {
            const failedEvents = await this.db.query(
                'SELECT COUNT(*) as count FROM failed_events WHERE NOT resolved'
            );
            this.metrics.updateFailedEventsQueue(Number(failedEvents[0]?.count || 0));
        } catch (error) {
            if (!this._isMissingFailedEventsTable(error)) {
                throw error;
            }

            this.failedEventsMetricsAvailable = false;
            this.metrics.updateFailedEventsQueue(0);

            if (!this.failedEventsMetricsWarningLogged) {
                this.failedEventsMetricsWarningLogged = true;
                console.warn('[ProductionIndexer] Optional failed_events table is missing; failed-event queue metric disabled.');
            }
        }
    }

    /**
     * Send alert via webhook
     */
    async _sendAlert(level, message) {
        const emoji = {
            'critical': '',
            'warning': '',
            'info': ''
        };

        const fullMessage = `${emoji[level] || '📢'} [${level.toUpperCase()}] ${message}`;

        // Always log to console
        if (level === 'critical') {
            console.error(fullMessage);
        } else if (level === 'warning') {
            console.warn(fullMessage);
        } else {
            console.log(fullMessage);
        }

        // Alert deduplication - don't send same alert within 5 minutes
        const alertKey = `${level}:${message}`;
        const now = Date.now();
        const lastSent = this.alertCooldowns.get(alertKey);

        if (lastSent && now - lastSent < 300000) {
            return;
        }

        this.alertCooldowns.set(alertKey, now);

        // Cleanup old alerts periodically
        if (now - this.lastAlertCleanup > this.alertCleanupInterval) {
            for (const [key, timestamp] of this.alertCooldowns.entries()) {
                if (now - timestamp > 300000) {
                    this.alertCooldowns.delete(key);
                }
            }
            this.lastAlertCleanup = now;
        }

        // Fire-and-forget webhook (don't await, don't block)
        if (this.alertWebhook) {
            fetch(this.alertWebhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: fullMessage,
                    level: level,
                    timestamp: new Date().toISOString(),
                    indexer: {
                        contract: this.config.contractAddress,
                        chainId: this.config.chainId
                    }
                })
            }).catch(error => {
                console.error('[ALERT] Webhook failed (non-blocking):', error.message);
            });
        }
    }

    /**
     * Check system health and raise alerts
     */
    async _checkAlerts(state) {
        // Alert: Low throughput
        if (this.metrics.blocksPerSecond > 0 && this.metrics.blocksPerSecond < this.alertThresholds.minBlocksPerSecond) {
            await this._sendAlert('warning', `Low throughput: ${this.metrics.blocksPerSecond.toFixed(2)} blocks/sec < ${this.alertThresholds.minBlocksPerSecond}`);
        }

        // Alert: High RPC error rate
        if (this.metrics.rpcErrorsLastMinute > this.alertThresholds.maxRpcErrorsPerMinute) {
            await this._sendAlert('critical', `High RPC error rate: ${this.metrics.rpcErrorsLastMinute} errors/min > ${this.alertThresholds.maxRpcErrorsPerMinute}`);
        }

        // Alert: High latency
        if (this.metrics.rpcLatencyMs > this.alertThresholds.maxLatencyMs) {
            await this._sendAlert('critical', `High RPC latency: ${this.metrics.rpcLatencyMs}ms > ${this.alertThresholds.maxLatencyMs}ms`);
        }

        // Alert: No progress (stuck) - improved detection
        const now = Date.now();
        if (now - this.metrics.lastProgressCheck > this.alertThresholds.progressCheckInterval) {
            const blockProgress = state.last_indexed_block - this.metrics.lastProgressBlock;

            // Alert if less than 5 blocks progress OR blocks/sec < 1
            if (blockProgress < 5 || this.metrics.blocksPerSecond < 1) {
                await this._sendAlert('critical', `Indexer stuck: ${blockProgress} blocks in ${this.alertThresholds.progressCheckInterval / 1000}s (${this.metrics.blocksPerSecond.toFixed(2)} blocks/sec)`);
            }

            this.metrics.lastProgressCheck = now;
            this.metrics.lastProgressBlock = state.last_indexed_block;
        }
    }

    async start() {
        console.log('[ProductionIndexer] Starting with leader election...');

        // Initialize indexer state
        await this._initializeState();

        // Start leader election loop
        this._startLeaderElection();

        console.log('[ProductionIndexer] Leader election active');
        console.log('[ProductionIndexer] Will start indexing when elected as leader');
    }

    async stop() {
        console.log('[ProductionIndexer] Stopping gracefully...');

        // Mark as stopping (prevents new work)
        this.isLeader = false;
        this.isRunning = false;

        // Stop leader election
        this._stopLeaderElection();

        // Stop timers first
        if (this.confirmationTimer) {
            clearInterval(this.confirmationTimer);
            this.confirmationTimer = null;
        }

        if (this.retryTimer) {
            clearInterval(this.retryTimer);
            this.retryTimer = null;
        }

        // Wait for current operations to complete (drain)
        console.log('[ProductionIndexer] Draining current operations...');
        await this._drainOperations();

        // Stop sync engine
        await this.syncEngine.stop();

        // Release lock
        await this.distributedLock.release();

        // Close DB connections
        await this.db.close();

        console.log('[ProductionIndexer] Stopped gracefully');
    }

    /**
     * Wait for current operations to complete
     */
    async _drainOperations() {
        const maxWait = 30000; // 30 seconds max
        const startTime = Date.now();

        while (Date.now() - startTime < maxWait) {
            // Check if any operations are in progress
            const poolMetrics = this.db.getPoolMetrics();
            const activeQueries = poolMetrics.totalCount - poolMetrics.idleCount;

            if (activeQueries === 0) {
                console.log('[ProductionIndexer] All operations drained');
                return;
            }

            console.log(`[ProductionIndexer] Waiting for ${activeQueries} active queries to complete...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.warn('[ProductionIndexer] Drain timeout reached, forcing shutdown');
    }

    async _initializeState() {
        // Validate config before initialization
        if (!this.config.contractAddress || this.config.contractAddress === '0x0000000000000000000000000000000000000000') {
            throw new Error('[ProductionIndexer] Invalid contract address - cannot initialize');
        }

        if (!this.config.chainId || this.config.chainId === 0) {
            throw new Error('[ProductionIndexer] Invalid chainId - cannot initialize');
        }

        const existing = await this.db.query(
            'SELECT * FROM indexer_state WHERE chain_id = $1',
            [this.config.chainId.toString()]
        );

        if (existing.length === 0) {
            // Fresh initialization
            await this.db.query(
                `INSERT INTO indexer_state (
                    contract_address, chain_id, last_indexed_block, last_confirmed_block,
                    confirmation_depth, last_indexed_at, started_at, status
                ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), 'initialized')`,
                [
                    this.config.contractAddress,
                    this.config.chainId,
                    this.config.startBlock,
                    this.config.startBlock,
                    this.confirmationDepth
                ]
            );

            console.log(`[ProductionIndexer] Initialized state at block ${this.config.startBlock}`);
            console.log(`  Contract: ${this.config.contractAddress}`);
            console.log(`  Chain ID: ${this.config.chainId}`);
        } else {
            const state = existing[0];

            // Check if existing state has invalid data (zero address or zero chainId)
            const hasInvalidAddress = !state.contract_address || state.contract_address === '0x0000000000000000000000000000000000000000';
            const hasInvalidChainId = !state.chain_id || parseInt(state.chain_id) === 0;

            if (hasInvalidAddress || hasInvalidChainId) {
                console.warn(`[ProductionIndexer] Detected corrupted state - fixing...`);
                console.warn(`  Old Contract: ${state.contract_address}`);
                console.warn(`  Old Chain ID: ${state.chain_id}`);

                // Fix corrupted state
                await this.db.query(
                    `UPDATE indexer_state
                     SET contract_address = $1,
                         chain_id = $2,
                         last_indexed_at = NOW()
                     WHERE chain_id = $2`,
                    [this.config.contractAddress, this.config.chainId]
                );

                console.log(`[ProductionIndexer] State fixed:`);
                console.log(`  New Contract: ${this.config.contractAddress}`);
                console.log(`  New Chain ID: ${this.config.chainId}`);
                console.log(`  Resuming from block ${state.last_indexed_block}`);
            } else {
                // Validate existing state matches config
                if (state.contract_address !== this.config.contractAddress) {
                    throw new Error(
                        `[ProductionIndexer] Contract address mismatch!\n` +
                        `  Database: ${state.contract_address}\n` +
                        `  Config: ${this.config.contractAddress}\n` +
                        `  Cannot proceed - database may be for different contract`
                    );
                }

                if (parseInt(state.chain_id) !== this.config.chainId) {
                    throw new Error(
                        `[ProductionIndexer] Chain ID mismatch!\n` +
                        `  Database: ${state.chain_id}\n` +
                        `  Config: ${this.config.chainId}\n` +
                        `  Cannot proceed - database may be for different chain`
                    );
                }

                console.log(`[ProductionIndexer] Resuming from block ${state.last_indexed_block}`);
                console.log(`  Contract: ${state.contract_address}`);
                console.log(`  Chain ID: ${state.chain_id}`);
            }
        }
    }

    _startConfirmationPolling() {
        console.log('[ProductionIndexer] Starting confirmation polling...');

        this.confirmationTimer = setInterval(async () => {
            try {
                // Check for reorgs first
                const reorgDetected = await this.syncEngine.detectReorg();
                if (reorgDetected) {
                    console.warn('[ProductionIndexer] Reorg detected, resyncing...');
                    // Reorg handling will reset state, continue normal operation
                    return;
                }

                await this._catchUpToSafeBlock('poll');
                await this._processConfirmations();
            } catch (error) {
                console.error('[ProductionIndexer] Confirmation polling error:', error);
            }
        }, this.pollInterval);
    }

    _startFailedEventsRetry() {
        console.log('[ProductionIndexer] Starting failed events retry...');

        // Retry failed events every 5 minutes
        this.retryTimer = setInterval(async () => {
            try {
                const retried = await this.syncEngine.retryFailedEvents();
                if (retried > 0) {
                    console.log(`[ProductionIndexer] Retried ${retried} failed events`);
                }
            } catch (error) {
                console.error('[ProductionIndexer] Failed events retry error:', error);
            }
        }, 300000); // 5 minutes
    }

    async _catchUpToSafeBlock(reason = 'poll') {
        if (this.catchUpInProgress) {
            console.log('[ProductionIndexer] Catch-up already in progress, skipping');
            return;
        }

        this.catchUpInProgress = true;
        try {
            const currentBlock = await this.eventListener.getCurrentBlock();
            const safeBlock = Math.max(0, currentBlock - this.confirmationDepth);
            const state = await this.syncEngine.getIndexerState();
            const lastIndexedBlock = Number(state.last_indexed_block || 0);

            if (safeBlock <= lastIndexedBlock) {
                return;
            }

            console.log(JSON.stringify({
                phase: 'catch_up',
                action: 'sync_historical_events',
                reason,
                chainId: this.config.chainId,
                fromBlock: lastIndexedBlock + 1,
                toBlock: safeBlock,
                currentBlock,
                confirmationDepth: this.confirmationDepth
            }));

            await this.syncEngine.syncHistoricalEvents(lastIndexedBlock + 1, safeBlock);
        } catch (error) {
            console.error(JSON.stringify({
                phase: 'catch_up',
                action: 'error',
                reason,
                chainId: this.config.chainId,
                error: error.message
            }));
        } finally {
            this.catchUpInProgress = false;
        }
    }

    async _processConfirmations() {
        const currentBlock = await this.eventListener.getCurrentBlock();
        const state = await this.syncEngine.getIndexerState();

        // Check for reorgs before confirming new blocks
        const reorgDetected = await this.detectReorg();
        if (reorgDetected) {
            console.log('[ProductionIndexer] Reorg detected and handled, skipping confirmation this round');
            return;
        }

        const confirmedBlock = currentBlock - this.confirmationDepth;

        if (confirmedBlock > state.last_confirmed_block) {
            console.log(`[ProductionIndexer] Confirming blocks up to ${confirmedBlock}`);

            // Count already-completed events in this confirmed range. The
            // current registry does not store a separate confirmation flag.
            const result = await this.db.query(
                `SELECT COUNT(*)::BIGINT as count
                 FROM event_processing_registry
                 WHERE chain_id = $1
                   AND block_number <= $2
                   AND processing_status = 'completed'`,
                [this.config.chainId.toString(), confirmedBlock]
            );

            const confirmedCount = result[0].count;

            // Update indexer state
            await this.db.query(
                `UPDATE indexer_state
                 SET last_confirmed_block = $1,
                     last_indexed_at = NOW()
                 WHERE chain_id = $2`,
                [confirmedBlock, this.config.chainId.toString()]
            );

            console.log(`[ProductionIndexer] Confirmed ${confirmedCount} events up to block ${confirmedBlock}`);
        }
    }

    async detectReorg() {
        const state = await this.syncEngine.getIndexerState();

        // Only check blocks that should be confirmed
        const checkFromBlock = Math.max(
            state.last_confirmed_block - 100,
            state.last_indexed_block - this.confirmationDepth - 100
        );

        // Get recent confirmed blocks
        const recentBlocks = await this.db.query(
            `SELECT block_number, block_hash
             FROM block_hashes
             WHERE chain_id = $1 AND block_number > $2
             ORDER BY block_number DESC
             LIMIT 100`,
            [this.config.chainId.toString(), checkFromBlock]
        );

        // Check if block hashes match
        for (const record of recentBlocks) {
            const block = await this.eventListener.provider.getBlock(record.block_number);

            if (block.hash !== record.block_hash) {
                console.warn(`[ProductionIndexer]  REORG DETECTED at block ${record.block_number}`);
                console.warn(`  Expected hash: ${record.block_hash}`);
                console.warn(`  Actual hash: ${block.hash}`);
                console.warn(`  Depth: ${state.last_indexed_block - record.block_number} blocks`);

                await this._handleReorg(record.block_number);
                return true;
            }
        }

        return false;
    }

    async _handleReorg(fromBlock) {
        console.log(`[ProductionIndexer] Handling reorg from block ${fromBlock}`);

        // Log reorg event
        try {
            await this.db.query(
                `INSERT INTO reorg_events (from_block, to_block, detected_at)
                 VALUES ($1, $2, NOW())`,
                [fromBlock, fromBlock + 100]
            );
        } catch (error) {
            console.warn('[ProductionIndexer] Reorg audit table unavailable; continuing rollback:', error.message);
        }

        // Rollback unconfirmed events
        const result = await this.db.query(
            'SELECT * FROM rollback_events_from_block($1, $2)',
            [fromBlock, this.config.chainId.toString()]
        );

        console.log(`[ProductionIndexer] Rolled back:`);
        console.log(`  Auctions: ${result[0].auctions_deleted}`);
        console.log(`  Bids: ${result[0].bids_deleted}`);
        console.log(`  Events: ${result[0].events_deleted}`);

        // Update indexer state to resync from reorg point
        await this.db.query(
            `UPDATE indexer_state
             SET last_indexed_block = $1,
                 last_confirmed_block = $1,
                 last_indexed_at = NOW()
             WHERE chain_id = $2`,
            [fromBlock - 1, this.config.chainId.toString()]
        );

        console.log(`[ProductionIndexer] Reorg handled, will resync from block ${fromBlock}`);
    }

    async getHealth() {
        try {
            console.log('[DEBUG] getHealth called, isRunning:', this.isRunning);

            const dbHealth = await this.db.healthCheck();
            const state = await this.syncEngine.getIndexerState();
            const currentBlock = await this.eventListener.getCurrentBlock();
            const errors = await this.syncEngine.getUnresolvedErrors();

            const blocksBehind = currentBlock - state.last_indexed_block;
            const isSynced = blocksBehind < 10;
            const hasErrors = errors.length > 0;

            // Reset error counter if last error was >1 minute ago
            if (Date.now() - this.metrics.lastErrorTime > 60000) {
                this.metrics.rpcErrorsLastMinute = 0;
            }

            // Determine overall health status
            let status = 'healthy';
            if (!this.isRunning) {
                status = 'stopped';
            } else if (hasErrors) {
                status = 'degraded';
            } else if (blocksBehind > 100) {
                status = 'syncing';
            }

            console.log('[DEBUG] Health status:', status, 'blocksBehind:', blocksBehind);

            return {
                status,
                timestamp: new Date().toISOString(),
                database: dbHealth,
                indexer: {
                    contractAddress: state.contract_address,
                    chainId: state.chain_id,
                    lastIndexedBlock: state.last_indexed_block,
                    lastConfirmedBlock: state.last_confirmed_block,
                    currentBlock: currentBlock,
                    blocksBehind: blocksBehind,
                    isSynced: isSynced,
                    confirmationDepth: this.confirmationDepth,
                    totalEventsIndexed: state.total_events_indexed,
                    unresolvedErrors: errors.length
                },
                metrics: {
                    rpcLatencyMs: Math.round(this.metrics.rpcLatencyMs),
                    blocksPerSecond: parseFloat(this.metrics.blocksPerSecond.toFixed(2)),
                    eventsPerSecond: parseFloat(this.metrics.eventsPerSecond.toFixed(2)),
                    rpcErrorsLastMinute: this.metrics.rpcErrorsLastMinute
                },
                uptime: Date.now() - new Date(state.started_at).getTime(),
                version: state.version || '2.0'
            };
        } catch (error) {
            console.error('[DEBUG] Health check error:', error);
            return {
                status: 'error',
                timestamp: new Date().toISOString(),
                error: error.message
            };
        }
    }
}

// Production runner
async function main() {
    console.log('[ProductionIndexer] CLI entrypoint starting...');

    try {
        const config = resolveProductionIndexerConfig();
        console.log(`[ProductionIndexer] Resolved chain: ${config.chainSlug || config.chainId}`);
        console.log(`[ProductionIndexer] Using start block: ${config.startBlock}`);

        const indexer = new ProductionIndexer(config);

        // Graceful shutdown
        process.on('SIGTERM', async () => {
            console.log('[ProductionIndexer] SIGTERM received, shutting down gracefully...');
            await indexer.stop();
            process.exit(0);
        });

        process.on('SIGINT', async () => {
            console.log('[ProductionIndexer] SIGINT received, shutting down gracefully...');
            await indexer.stop();
            process.exit(0);
        });

        // Health check endpoint (start BEFORE indexer to avoid blocking)
        const http = await import('http');
        const server = http.createServer(async (req, res) => {
            if (req.url === '/health') {
                const health = await indexer.getHealth();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(health));
            } else if (req.url === '/metrics') {
                // Basic auth for metrics endpoint (security)
                const authHeader = req.headers.authorization;
                const expectedAuth = process.env.METRICS_AUTH || 'Basic ' + Buffer.from('admin:changeme').toString('base64');

                if (authHeader !== expectedAuth) {
                    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Metrics"' });
                    res.end('Unauthorized');
                    return;
                }

                const metrics = await indexer.metrics.getMetrics();
                res.writeHead(200, { 'Content-Type': indexer.metrics.getContentType() });
                res.end(metrics);
            } else {
                res.writeHead(404);
                res.end('Not Found');
            }
        });

        const healthPort = Number.isFinite(config.healthPort) && config.healthPort > 0
            ? config.healthPort
            : 3001;

        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error(
                    `[ProductionIndexer] Health port ${healthPort} is already in use. ` +
                    'Set INDEXER_HEALTH_PORT to a unique port for each indexer process.'
                );
            }
            throw error;
        });

        server.listen(healthPort, () => {
            console.log(`[ProductionIndexer] Health check endpoint listening on port ${healthPort}`);
            console.log(`[ProductionIndexer] Prometheus metrics endpoint: http://localhost:${healthPort}/metrics`);
        });

        // Start indexer (this will block in sync loop)
        await indexer.start();

    } catch (error) {
        console.error('[ProductionIndexer] Fatal startup error:', error);
        process.exit(1);
    }
}

function isCliEntrypoint() {
    if (!process.argv[1]) return false;
    return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
}

if (isCliEntrypoint()) {
    main().catch(error => {
        console.error('[ProductionIndexer] Unhandled fatal error:', error);
        process.exit(1);
    });
}

export default ProductionIndexer;
