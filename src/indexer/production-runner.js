import EventListener from './event-listener.js';
import IndexerSyncEngine from './sync-engine.js';
import PostgreSQLDatabase from './postgresql-database.js';
import IndexerMetrics from './metrics.js';
import DistributedLock from './distributed-lock.js';
import { requireEnv, resolveIndexerChainConfigs } from './chain-config.js';
import { reconcileConfirmationDepth } from './confirmation-depth.js';
import {
    resolveMetricsAuth,
    createIndexerHttpServer,
    listenAsync
} from './metrics-auth.js';
import {
    isIndexerWithinHealthLag,
    resolveHealthMaxBlocksBehind
} from './health-policy.js';
import { reapStaleEventProcessingLeases } from './event-processing-lease.js';
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
        // Fail closed here, before ProductionIndexer construction, HTTP listen,
        // or indexer.start(): a missing/blank METRICS_AUTH aborts startup.
        metricsAuth: resolveMetricsAuth(process.env),
        rpcUrl: chain.rpcUrl,
        readRpcUrls: chain.readRpcUrls,
        contractAddress: chain.coreAddress,
        nftAddress: chain.nftAddress,
        projectNFTAddress: chain.projectNFTAddress,
        chainId: chain.chainId,
        chainSlug: chain.slug,
        startBlock: chain.startBlock,
        lockName: chain.lockName,
        confirmationDepth: chain.confirmationDepth,
        pollInterval: parseInt(process.env.INDEXER_POLL_INTERVAL || '15000', 10),
        reorgCheckInterval: parseInt(process.env.INDEXER_REORG_CHECK_INTERVAL || '60000', 10),
        reorgSampleSize: parseInt(process.env.INDEXER_REORG_SAMPLE_SIZE || '12', 10),
        healthMaxBlocksBehind: resolveHealthMaxBlocksBehind(
            process.env.INDEXER_HEALTH_MAX_BLOCKS_BEHIND
        ),
        healthPort: parseInt(process.env.INDEXER_HEALTH_PORT || '3001', 10)
    };
}

class ProductionIndexer {
    constructor(config) {
        this.config = config;
        this.db = new PostgreSQLDatabase({
            connectionString: config.databaseUrl
        });

        const rpcUrls = Array.isArray(config.rpcUrl) ? config.rpcUrl : [config.rpcUrl];

        // Prometheus metrics
        this.metrics = new IndexerMetrics();

        this.eventListener = new EventListener({
            rpcUrl: rpcUrls,
            readRpcUrls: config.readRpcUrls,
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
        this.reorgCheckInterval = config.reorgCheckInterval || 60000;
        this.reorgSampleSize = config.reorgSampleSize || 12;
        this.healthMaxBlocksBehind = resolveHealthMaxBlocksBehind(
            config.healthMaxBlocksBehind
        );
        this.lastReorgCheckAt = 0;
        this.lastObservedBlock = null;
        this.isLeader = false;
        this.isRunning = false;
        this.leaderElectionInProgress = false;
        this.leadershipLossInProgress = false;
        this.catchUpInProgress = false;
        this.confirmationTimer = null;
        // Set when startup fails to reconcile the persisted confirmation depth.
        // Surfaced by getHealth() so operators can see the drift without a
        // separate DB query; never corrupts or resets the cursor.
        this.confirmationDepthSyncError = null;

        // Start metrics update loop
        this._startMetricsUpdateLoop();

        console.log('[ProductionIndexer] Initialized');
        console.log('  Contract:', config.contractAddress);
        console.log('  Chain:', config.chainSlug || config.chainId);
        console.log('  Confirmation Depth:', this.confirmationDepth);
        console.log('  Poll Interval:', this.pollInterval, 'ms');
        console.log('  Reorg Check Interval:', this.reorgCheckInterval, 'ms');
        console.log('  Reorg Sample Size:', this.reorgSampleSize, 'blocks');
        console.log('  Healthy Block Lag:', `< ${this.healthMaxBlocksBehind} blocks`);
        console.log('  Health Port:', config.healthPort);
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

        // One authoritative read of the failure registry at startup, so the
        // gauge is correct before any range runs (and after a restart that
        // inherited failures from a previous process).
        await this._refreshEventFailureMetric('startup');

        await this._catchUpToSafeBlock('leader_start');

        // Start confirmation polling
        this._startConfirmationPolling();

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
                const stuckEvents = await reapStaleEventProcessingLeases(this.db, {
                    chainId: this.config.chainId.toString()
                });

                if (stuckEvents.length > 0) {
                    console.warn(JSON.stringify({
                        phase: 'reaper',
                        action: 'recovered_stuck_events',
                        count: stuckEvents.length,
                        events: stuckEvents.map(e => ({
                            event_hash: e.event_hash,
                            event_name: e.event_name,
                            retry_count: e.retry_count,
                            previous_owner: e.previous_owner,
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

                // The event-failure gauge is intentionally NOT refreshed here.
                // Failure counts only change when a range is processed, so
                // polling them every 5 seconds would add ~17k idle
                // PostgreSQL/Supabase queries per day against the A9 cost
                // budget. It is refreshed on the events that can change it.

                // Update block lag
                const state = await this.syncEngine.getIndexerState();
                if (state && Number.isFinite(this.lastObservedBlock)) {
                    const lag = this.lastObservedBlock - state.last_indexed_block;
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

    // Truthful replacement for the removed failed_events gauge, sourced from
    // event_processing_registry (the single source of truth for event-
    // processing failures) so it can never report a false zero for a table
    // that does not exist.
    //
    // Event driven, never polled: failure counts change only when a range is
    // processed, so this runs once at startup and then only after a range
    // that actually did work or failed. An idle indexer issues zero recurring
    // failure-registry queries.
    async _refreshEventFailureMetric(reason) {
        try {
            const counts = await this.syncEngine.getEventFailureCounts();
            this.metrics.updateEventFailures(counts);
            return counts;
        } catch (error) {
            console.error(JSON.stringify({
                phase: 'event_failure_metric',
                action: 'refresh_failed',
                reason,
                error: error.message
            }));
            return null;
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

            // Reconcile the persisted confirmation depth with the active config
            // so /health and /api/public/indexer-status report the same value.
            // Metadata-only and cursor-safe; see reconcileConfirmationDepth.
            await this._reconcileConfirmationDepth();
        }
    }

    async _reconcileConfirmationDepth() {
        const result = await reconcileConfirmationDepth(
            this.db,
            this.config.chainId,
            this.confirmationDepth,
            {
                onError: (error) => {
                    this.confirmationDepthSyncError = {
                        message: error.message,
                        configuredDepth: this.confirmationDepth,
                        at: new Date().toISOString()
                    };
                    console.error(JSON.stringify({
                        phase: 'confirmation_depth_reconcile',
                        action: 'error',
                        chainId: this.config.chainId.toString(),
                        configuredDepth: this.confirmationDepth,
                        error: error.message
                    }));
                }
            }
        );

        // Clear a previously recorded error once reconciliation succeeds.
        if (!result.error) {
            this.confirmationDepthSyncError = null;
        }

        return result;
    }

    _startConfirmationPolling() {
        console.log('[ProductionIndexer] Starting confirmation polling...');

        this.confirmationTimer = setInterval(async () => {
            try {
                const now = Date.now();
                if (now - this.lastReorgCheckAt >= this.reorgCheckInterval) {
                    this.lastReorgCheckAt = now;
                    const reorgDetected = await this.syncEngine.detectReorg({
                        sampleSize: this.reorgSampleSize
                    });
                    if (reorgDetected) {
                        console.warn('[ProductionIndexer] Reorg detected, resyncing...');
                        return;
                    }
                }

                // Only confirm when the catch-up for this poll actually
                // completed. A range that failed closed returns no checkpoint,
                // and confirming past an unapplied event would mark it as
                // reorg-safe and permanently skipped.
                const checkpoint = await this._catchUpToSafeBlock('poll');
                if (checkpoint) {
                    await this._processConfirmations(checkpoint.currentBlock);
                }
            } catch (error) {
                console.error('[ProductionIndexer] Confirmation polling error:', error);
            }
        }, this.pollInterval);
    }

    async _catchUpToSafeBlock(reason = 'poll') {
        if (this.catchUpInProgress) {
            console.log('[ProductionIndexer] Catch-up already in progress, skipping');
            return;
        }

        this.catchUpInProgress = true;
        try {
            const currentBlock = await this.eventListener.getCurrentBlock();
            this.lastObservedBlock = currentBlock;
            const safeBlock = Math.max(0, currentBlock - this.confirmationDepth);
            const state = await this.syncEngine.getIndexerState();
            const lastIndexedBlock = Number(state.last_indexed_block || 0);

            if (safeBlock <= lastIndexedBlock) {
                return { currentBlock, safeBlock, lastIndexedBlock };
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

            const processedCount = await this.syncEngine.syncHistoricalEvents(
                lastIndexedBlock + 1, safeBlock, { currentBlock }
            );

            // Only a range that actually applied events can change the failure
            // counts — including a previously failed event that just recovered
            // and drove the gauge back down. An empty range queries nothing.
            if (processedCount > 0) {
                await this._refreshEventFailureMetric('range_completed');
            }

            return { currentBlock, safeBlock, lastIndexedBlock: safeBlock };
        } catch (error) {
            console.error(JSON.stringify({
                phase: 'catch_up',
                action: 'error',
                reason,
                chainId: this.config.chainId,
                error: error.message
            }));

            // A failed-closed range recorded new failed/dead rows; refresh so
            // the gauge shows the stall immediately rather than at next start.
            await this._refreshEventFailureMetric('range_failed');
        } finally {
            this.catchUpInProgress = false;
        }
    }

    async _processConfirmations(observedBlock = null) {
        const currentBlock = Number.isFinite(Number(observedBlock))
            ? Number(observedBlock)
            : await this.eventListener.getCurrentBlock();
        const state = await this.syncEngine.getIndexerState();

        // A block can never be confirmed before it has been indexed. When a
        // range fails closed, last_indexed_block stops advancing, so this
        // clamp keeps the confirmation cursor pinned behind the stalled range
        // instead of declaring unapplied events final.
        const confirmedBlock = Math.min(
            currentBlock - this.confirmationDepth,
            Number(state.last_indexed_block || 0)
        );

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

    async getHealth() {
        try {
            console.log('[DEBUG] getHealth called, isRunning:', this.isRunning);

            const dbHealth = await this.db.healthCheck();
            const state = await this.syncEngine.getIndexerState();
            const currentBlock = await this.eventListener.getCurrentBlock();
            const errors = await this.syncEngine.getUnresolvedErrors();
            // Authoritative event-processing failure COUNTS for THIS chain. A
            // failed or dead registry row means an event in an already-scanned
            // range was never applied, so health must not report a clean
            // indexer. An aggregate, never a row scan: per-row detail is an
            // operator SQL query documented in the A9 runbook.
            const eventFailures = await this.syncEngine.getEventFailureCounts();

            const blocksBehind = currentBlock - state.last_indexed_block;
            const isSynced = isIndexerWithinHealthLag(
                blocksBehind,
                this.healthMaxBlocksBehind
            );
            const failedEventCount = Number(eventFailures?.failed || 0);
            const deadEventCount = Number(eventFailures?.dead || 0);
            const unresolvedErrorCount = errors.length + failedEventCount + deadEventCount;
            const hasErrors = unresolvedErrorCount > 0;

            const rpcHealth = this.eventListener.getRpcHealth();
            const rpcLatencyMs = rpcHealth.reduce(
                (highest, rpc) => Math.max(highest, Number(rpc.avgLatencyMs) || 0),
                0
            );
            const rpcErrorsLastMinute = rpcHealth.reduce(
                (total, rpc) => total + (Number(rpc.errorsLastMinute) || 0),
                0
            );

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
                    syncThresholdBlocks: this.healthMaxBlocksBehind,
                    confirmationDepth: this.confirmationDepth,
                    confirmationDepthSyncError: this.confirmationDepthSyncError,
                    totalEventsIndexed: state.total_events_indexed,
                    unresolvedErrors: unresolvedErrorCount,
                    // Additive breakdown; unresolvedErrors stays the headline
                    // field and now counts unapplied events too.
                    eventFailures: {
                        failed: failedEventCount,
                        dead: deadEventCount
                    }
                },
                metrics: {
                    rpcLatencyMs: Math.round(rpcLatencyMs),
                    rpcErrorsLastMinute
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

        // Health/metrics endpoint (start BEFORE indexer to avoid blocking).
        // The credential was resolved and validated during config resolution
        // and is passed explicitly; the handler never reads process.env.
        const server = createIndexerHttpServer(indexer, { metricsAuth: config.metricsAuth });

        const healthPort = Number.isFinite(config.healthPort) && config.healthPort > 0
            ? config.healthPort
            : 3001;

        // Await a successful loopback bind before starting the indexer. A bind
        // failure (for example EADDRINUSE) must prevent indexer.start().
        try {
            await listenAsync(server, healthPort, '127.0.0.1');
        } catch (error) {
            if (error.code === 'EADDRINUSE') {
                console.error(
                    `[ProductionIndexer] Health port ${healthPort} is already in use. ` +
                    'Set INDEXER_HEALTH_PORT to a unique port for each indexer process.'
                );
            }
            throw error;
        }
        console.log(`[ProductionIndexer] Health check endpoint listening on http://127.0.0.1:${healthPort}`);
        console.log(`[ProductionIndexer] Prometheus metrics endpoint: http://127.0.0.1:${healthPort}/metrics`);

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
