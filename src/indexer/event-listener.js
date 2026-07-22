import { ethers } from 'ethers';
import { V41_CORE_ABI, parseV41EventData } from './v4-1-event-schema.js';

function redactRpcUrl(value) {
    try {
        const url = new URL(value);
        return `${url.protocol}//${url.host}/...`;
    } catch {
        return '[configured-rpc]';
    }
}

function normalizeRpcList(value) {
    const values = Array.isArray(value) ? value : [value];
    return [...new Set(values.map(url => String(url || '').trim()).filter(Boolean))];
}

class EventListener {
    constructor(config, metrics = null) {
        // Support multiple RPC endpoints
        this.rpcs = normalizeRpcList(config.rpcUrl);
        this.readRpcs = normalizeRpcList(config.readRpcUrls?.length ? config.readRpcUrls : this.rpcs);
        this.currentRpcIndex = 0;
        this.primaryRpcRetryInterval = 300000;
        this.lastPrimaryRpcRetryAt = 0;
        this.metrics = metrics;

        this.provider = new ethers.JsonRpcProvider(this.rpcs[this.currentRpcIndex]);
        this.readProviders = this.readRpcs.map(url => new ethers.JsonRpcProvider(url));
        this.readRpcUnavailableUntil = this.readRpcs.map(() => 0);
        this.contractAddress = config.contractAddress;
        this.contract = new ethers.Contract(this.contractAddress, V41_CORE_ABI, this.provider);
        this.chainId = config.chainId;
        this.handlers = new Map();
        this.isListening = false;

        // RPC retry configuration
        this.maxRetries = 3;
        this.retryDelay = 1000; // 1 second base delay

        // Rate limiting configuration
        this.maxRequestsPerSecond = 5;
        this.requestQueue = [];
        this.lastRequestTime = 0;
        this.minRequestInterval = 1000 / this.maxRequestsPerSecond; // 200ms between requests

        // Circuit breaker per RPC
        this.circuitBreakerThreshold = 20;
        this.circuitBreakerCooldown = 60000; // 1 minute

        // Per-RPC health tracking
        this.rpcHealth = this.rpcs.map((rpc, index) => ({
            url: rpc,
            index,
            errorWindow: [],
            errorWindowDuration: 60000,
            circuitBreakerTriggered: false,
            circuitBreakerUntil: 0,
            blacklistedUntil: 0,
            successCount: 0,
            errorCount: 0,
            avgLatency: 0,
            healthScore: 100
        }));

        // Adaptive timeout
        this.baseTimeout = 5000;
        this.maxTimeout = 10000;

        // RPC limits. Base Sepolia public/free RPCs often cap eth_getLogs to tiny
        // windows, so default conservatively and let production opt up by env.
        const configuredMaxBlockRange = parseInt(process.env.INDEXER_MAX_BLOCK_RANGE || '10', 10);
        this.maxBlockRange = Number.isFinite(configuredMaxBlockRange) && configuredMaxBlockRange > 0
            ? configuredMaxBlockRange
            : 10;
        this.minBlockRange = Math.min(10, this.maxBlockRange);
        this.maxBlockRangeLimit = this.maxBlockRange;

        console.log('[EventListener] Initialized');
        console.log('  Contract:', this.contractAddress);
        console.log('  Chain ID:', this.chainId);
        console.log('  RPC endpoints:', this.rpcs.length);
        this.rpcs.forEach((rpc, i) => {
            console.log(`    [${i}] ${redactRpcUrl(rpc)}`);
        });
        console.log('  Read RPC endpoints:', this.readRpcs.length);
        this.readRpcs.forEach((rpc, i) => {
            console.log(`    [${i}] ${redactRpcUrl(rpc)}`);
        });
        console.log('  Rate limit:', this.maxRequestsPerSecond, 'req/sec');
    }

    async _readRpcCall(operation, context) {
        let lastError = null;
        const now = Date.now();
        const candidates = this.readProviders
            .map((provider, index) => ({ provider, index }))
            .filter(({ index }) => now >= this.readRpcUnavailableUntil[index]);
        const attempts = candidates.length > 0
            ? candidates
            : this.readProviders.map((provider, index) => ({ provider, index }));

        for (const { provider, index } of attempts) {
            let timeoutId;
            try {
                const timeout = new Promise((_, reject) => {
                    timeoutId = setTimeout(() => reject(new Error(`${context} timed out`)), this.baseTimeout);
                });
                const result = await Promise.race([operation(provider), timeout]);
                clearTimeout(timeoutId);
                this.readRpcUnavailableUntil[index] = 0;
                return result;
            } catch (error) {
                clearTimeout(timeoutId);
                lastError = error;
                this.readRpcUnavailableUntil[index] = Date.now() + 60000;
                console.warn(
                    `[EventListener] ${context} failed on read RPC[${index}] ` +
                    `(${redactRpcUrl(this.readRpcs[index])}); trying fallback: ${error.message}`
                );
            }
        }

        throw lastError || new Error(`${context} failed: no read RPC endpoint is available`);
    }

    /**
     * Get current RPC health status
     */
    _getCurrentRpcHealth() {
        return this.rpcHealth[this.currentRpcIndex];
    }

    /**
     * Public API for monitoring RPC health.
     * Error counts use the same rolling 60-second window as the circuit
     * breaker, so health consumers never rely on a detached scalar counter.
     */
    getRpcHealth() {
        const now = Date.now();

        return this.rpcHealth.map(rpc => {
            rpc.errorWindow = rpc.errorWindow.filter(
                timestamp => now - timestamp < rpc.errorWindowDuration
            );

            return {
                url: rpc.url,
                healthScore: rpc.healthScore,
                avgLatencyMs: rpc.avgLatency,
                errorsLastMinute: rpc.errorWindow.length
            };
        });
    }

    /**
     * Track error for current RPC
     */
    _trackError(error = null) {
        const rpc = this._getCurrentRpcHealth();
        const now = Date.now();

        rpc.errorWindow.push(now);
        rpc.errorCount++;

        // Record metrics
        if (this.metrics && error) {
            const errorType = error.message?.includes('timeout') ? 'timeout' :
                            error.message?.includes('rate limit') ? 'rate_limit' :
                            error.message?.includes('range') ? 'range_limit' : 'other';
            this.metrics.recordRpcError(rpc.url, errorType);
        }

        // Keep rolling window of last 100 requests
        if (!rpc.requestHistory) {
            rpc.requestHistory = [];
        }
        rpc.requestHistory.push({ success: false, timestamp: now });
        if (rpc.requestHistory.length > 100) {
            rpc.requestHistory.shift();
        }

        // Remove errors older than window duration
        rpc.errorWindow = rpc.errorWindow.filter(
            timestamp => now - timestamp < rpc.errorWindowDuration
        );

        // Update health score (0-100) using rolling window
        const recentRequests = rpc.requestHistory.length;
        const recentSuccesses = rpc.requestHistory.filter(r => r.success).length;
        const successRate = recentRequests > 0 ? recentSuccesses / recentRequests : 0;
        const recentErrors = rpc.errorWindow.length;
        const latencyScore = Math.max(0, 1 - (rpc.avgLatency / 10000));
        rpc.healthScore = (successRate * 70) + (latencyScore * 30) - (recentErrors * 2);
        rpc.healthScore = Math.max(0, rpc.healthScore);
    }

    /**
     * Track success for current RPC
     */
    _trackSuccess(latency) {
        const rpc = this._getCurrentRpcHealth();
        rpc.successCount++;

        // Record metrics
        if (this.metrics) {
            this.metrics.recordRpcLatency(rpc.url, 'getLogs', latency / 1000);
            this.metrics.updateRpcHealthScore(rpc.url, rpc.healthScore);
        }

        // Keep rolling window of last 100 requests
        if (!rpc.requestHistory) {
            rpc.requestHistory = [];
        }
        rpc.requestHistory.push({ success: true, timestamp: Date.now() });
        if (rpc.requestHistory.length > 100) {
            rpc.requestHistory.shift();
        }

        // Update average latency (exponential moving average)
        rpc.avgLatency = rpc.avgLatency === 0
            ? latency
            : rpc.avgLatency * 0.9 + latency * 0.1;

        // Update health score: 70% success rate + 30% latency score (rolling window)
        const recentRequests = rpc.requestHistory.length;
        const recentSuccesses = rpc.requestHistory.filter(r => r.success).length;
        const successRate = recentRequests > 0 ? recentSuccesses / recentRequests : 1;
        const latencyScore = Math.max(0, 1 - (rpc.avgLatency / 10000)); // 0-1, worse as latency increases
        rpc.healthScore = (successRate * 70) + (latencyScore * 30);
    }

    /**
     * Get error count in current window for current RPC
     */
    _getErrorCount() {
        const rpc = this._getCurrentRpcHealth();
        const now = Date.now();
        return rpc.errorWindow.filter(
            timestamp => now - timestamp < rpc.errorWindowDuration
        ).length;
    }

    /**
     * Check circuit breaker status for current RPC
     */
    _checkCircuitBreaker() {
        const rpc = this._getCurrentRpcHealth();
        const now = Date.now();

        // Check if circuit breaker is active
        if (rpc.circuitBreakerTriggered && now < rpc.circuitBreakerUntil) {
            const remainingMs = rpc.circuitBreakerUntil - now;
            throw new Error(`Circuit breaker active for RPC[${rpc.index}], cooling down for ${Math.round(remainingMs / 1000)}s`);
        }

        // Reset circuit breaker if cooldown expired
        if (rpc.circuitBreakerTriggered && now >= rpc.circuitBreakerUntil) {
            console.log(`[EventListener]  Circuit breaker reset for RPC[${rpc.index}]`);
            rpc.circuitBreakerTriggered = false;
            rpc.errorWindow = []; // Clear error history
        }

        // Trigger circuit breaker if too many errors in window
        const errorCount = this._getErrorCount();
        if (errorCount > this.circuitBreakerThreshold) {
            console.error(`[EventListener]  Circuit breaker triggered for RPC[${rpc.index}] (${errorCount} errors > ${this.circuitBreakerThreshold})`);
            rpc.circuitBreakerTriggered = true;
            rpc.circuitBreakerUntil = now + this.circuitBreakerCooldown;

            // Blacklist this RPC temporarily
            rpc.blacklistedUntil = now + this.circuitBreakerCooldown;

            throw new Error(`Circuit breaker triggered for RPC[${rpc.index}]`);
        }
    }

    /**
     * Find best available RPC endpoint
     */
    _findBestRpc() {
        const now = Date.now();

        // Filter out blacklisted RPCs
        const available = this.rpcHealth.filter(rpc => now >= rpc.blacklistedUntil);

        if (available.length === 0) {
            console.warn('[EventListener] All RPCs blacklisted, using least-bad option');
            // Find RPC with shortest remaining blacklist time
            return this.rpcHealth.reduce((best, rpc) =>
                rpc.blacklistedUntil < best.blacklistedUntil ? rpc : best
            );
        }

        // Sort by health score (highest first)
        available.sort((a, b) => b.healthScore - a.healthScore);

        return available[0];
    }

    /**
     * Switch to best available RPC
     */
    _switchRpc() {
        const currentRpc = this._getCurrentRpcHealth();
        const bestRpc = this._findBestRpc();

        if (bestRpc.index !== this.currentRpcIndex) {
            console.log(`[EventListener] Switching RPC: [${currentRpc.index}] (health: ${currentRpc.healthScore.toFixed(1)}) → [${bestRpc.index}] (health: ${bestRpc.healthScore.toFixed(1)})`);

            this._useRpc(bestRpc.index);
        }
    }

    _useRpc(index) {
        this.currentRpcIndex = index;
        this.provider = new ethers.JsonRpcProvider(this.rpcs[index]);
        this.contract = new ethers.Contract(this.contractAddress, V41_CORE_ABI, this.provider);
    }

    _maybeRetryPrimaryRpc() {
        if (this.currentRpcIndex === 0 || this.rpcs.length < 2) return;

        const now = Date.now();
        if (now - this.lastPrimaryRpcRetryAt < this.primaryRpcRetryInterval) return;

        this.lastPrimaryRpcRetryAt = now;
        console.log('[EventListener] Re-probing primary RPC after fallback cooldown');
        this._useRpc(0);
    }

    /**
     * Get adaptive timeout based on RPC latency
     */
    _getAdaptiveTimeout() {
        const rpc = this._getCurrentRpcHealth();

        if (rpc.avgLatency === 0) {
            return this.baseTimeout;
        }

        // Timeout = 2x average latency, clamped between 5s and 10s
        const adaptiveTimeout = Math.min(
            10000,  // Max 10s (not 15s)
            Math.max(this.baseTimeout, rpc.avgLatency * 2)
        );

        return adaptiveTimeout;
    }

    _isRateLimitError(error) {
        const message = String(error?.message || '').toLowerCase();
        const code = String(error?.code || error?.error?.code || '');

        return code === '429' ||
            message.includes('429') ||
            message.includes('rate limit') ||
            message.includes('too many requests') ||
            message.includes('compute units per second') ||
            message.includes('capacity');
    }

    _isRangeLimitError(error) {
        if (this._isRateLimitError(error)) {
            return false;
        }

        const message = String(error?.message || '').toLowerCase();
        return message.includes('block range') ||
            message.includes('eth_getlogs requests with up to') ||
            message.includes('range should work') ||
            message.includes('too many blocks') ||
            message.includes('response size exceeded') ||
            message.includes('query returned more than') ||
            (message.includes('more than') && message.includes('results'));
    }

    /**
     * Rate limiter - ensures we don't exceed maxRequestsPerSecond
     */
    async _rateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;

        if (timeSinceLastRequest < this.minRequestInterval) {
            const delay = this.minRequestInterval - timeSinceLastRequest;
            console.log(`[RateLimiter] Delaying request by ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        this.lastRequestTime = Date.now();
    }

    /**
     * Retry RPC calls with exponential backoff and RPC switching
     */
    async _retryRpcCall(fn, context = 'RPC call') {
        let lastError;
        this._maybeRetryPrimaryRpc();

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                // Check circuit breaker before attempt
                this._checkCircuitBreaker();

                // Apply rate limiting
                await this._rateLimit();

                // Get adaptive timeout
                const timeout = this._getAdaptiveTimeout();

                // Add timeout to RPC call
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`RPC timeout (${timeout}ms)`)), timeout)
                );

                const startTime = Date.now();
                const result = await Promise.race([fn(), timeoutPromise]);
                const latency = Date.now() - startTime;

                // Track success
                this._trackSuccess(latency);

                return result;
            } catch (error) {
                lastError = error;

                // Track error for circuit breaker
                this._trackError(error);

                console.warn(`[EventListener] ${context} failed (attempt ${attempt}/${this.maxRetries})`);
                console.warn(`  RPC[${this.currentRpcIndex}]: ${error.message}`);

                // If circuit breaker triggered, switch immediately (fast-fail)
                if (error.message.includes('Circuit breaker')) {
                    console.log('[EventListener] Circuit breaker triggered, switching RPC immediately');
                    if (this.rpcs.length > 1) {
                        this._switchRpc();
                    }
                    // Don't retry on same RPC, continue to next attempt with new RPC
                    continue;
                }

                // Try switching to best available RPC on first failure
                if (attempt === 1 && this.rpcs.length > 1) {
                    this._switchRpc();
                }

                if (attempt < this.maxRetries) {
                    // Exponential backoff with jitter
                    const baseDelay = this.retryDelay * Math.pow(2, attempt - 1);
                    const jitter = Math.random() * 1000; // 0-1000ms random jitter
                    const delay = baseDelay + jitter;

                    console.warn(`  Retrying in ${Math.round(delay)}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    console.error(`[EventListener] ${context} failed after ${this.maxRetries} attempts`);
                }
            }
        }

        throw lastError;
    }

    on(eventName, handler) {
        if (!this.handlers.has(eventName)) {
            this.handlers.set(eventName, []);
        }
        this.handlers.get(eventName).push(handler);
        console.log(`[EventListener] Registered handler for ${eventName}`);
    }

    async startListening() {
        if (this.isListening) {
            console.log('[EventListener] Already listening');
            return;
        }

        this.isListening = true;
        this.lastProcessedBlock = 0; // Will be set from indexer state
        console.log('[EventListener] Starting event listeners...');
        console.log('[EventListener] Using polling via queryFilter (more reliable than filters)');

        // Polling will be driven by sync engine, not independent polling
        // This prevents duplicate event processing and ensures proper block tracking
        console.log('[EventListener] Event polling ready (driven by sync engine)');
    }

    async stopListening() {
        if (!this.isListening) {
            console.log('[EventListener] Not listening');
            return;
        }

        this.isListening = false;
        console.log('[EventListener] Stopped event polling');
    }

    async _handleEvent(eventName, eventData, event) {
        const blockNumber = event.log.blockNumber;
        const transactionHash = event.log.transactionHash;
        const logIndex = event.log.index;

        console.log(`[EventListener] ${eventName} detected:`);
        console.log(`  Block: ${blockNumber}`);
        console.log(`  TX: ${transactionHash}`);
        console.log(`  Data:`, eventData);

        const handlers = this.handlers.get(eventName) || [];

        for (const handler of handlers) {
            try {
                await handler({
                    eventName,
                    eventData,
                    blockNumber,
                    transactionHash,
                    logIndex,
                    timestamp: Date.now()
                });
            } catch (error) {
                console.error(`[EventListener] Handler error for ${eventName}:`, error);
            }
        }
    }

    async queryHistoricalEvents(eventName, fromBlock, toBlock) {
        console.log(`[EventListener] Querying ${eventName} from block ${fromBlock} to ${toBlock}`);

        return await this._retryRpcCall(async () => {
            const filter = this.contract.filters[eventName]();
            const events = await this.contract.queryFilter(filter, fromBlock, toBlock);

            console.log(`[EventListener] Found ${events.length} ${eventName} events`);

            return events.map(event => {
                const parsedLog = this.contract.interface.parseLog({
                    topics: event.topics,
                    data: event.data
                });

                return {
                    eventName,
                    eventData: this._parseEventData(eventName, parsedLog.args),
                    blockNumber: event.blockNumber,
                    transactionHash: event.transactionHash,
                    logIndex: event.index
                };
            });
        }, `queryHistoricalEvents(${eventName})`);
    }

    async queryAllHistoricalEvents(fromBlock, toBlock) {
        console.log(`[EventListener] Querying all events from block ${fromBlock} to ${toBlock}`);

        // Split into chunks if range exceeds RPC limit
        const range = toBlock - fromBlock + 1;
        if (range > this.maxBlockRange) {
            console.log(`[EventListener] Range ${range} exceeds limit ${this.maxBlockRange}, splitting into chunks`);

            const allEvents = [];
            let currentFrom = fromBlock;

            while (currentFrom <= toBlock) {
                const currentTo = Math.min(currentFrom + this.maxBlockRange - 1, toBlock);
                const chunkEvents = await this._queryLogsChunk(currentFrom, currentTo);
                allEvents.push(...chunkEvents);
                currentFrom = currentTo + 1;
            }

            console.log(`[EventListener] Parsed ${allEvents.length} contract events from ${Math.ceil(range / this.maxBlockRange)} chunks`);
            return allEvents;
        }

        // Single query if within limit
        return await this._queryLogsChunk(fromBlock, toBlock);
    }

    async _queryLogsChunk(fromBlock, toBlock) {
        return await this._retryRpcCall(async () => {
            // Query all events at once using contract filter
            const filter = {
                address: this.contractAddress,
                fromBlock,
                toBlock
            };

            const startTime = Date.now();

            try {
                const logs = await this.provider.getLogs(filter);
                const latency = Date.now() - startTime;

                console.log(`[EventListener] Found ${logs.length} total logs in range ${fromBlock}-${toBlock} (${latency}ms)`);

                // Adaptive range adjustment based on success
                const range = toBlock - fromBlock + 1;

                // If successful and fast, try increasing range
                if (latency < 2000 && range === this.maxBlockRange && this.maxBlockRange < this.maxBlockRangeLimit) {
                    this.maxBlockRange = Math.min(this.maxBlockRangeLimit, Math.floor(this.maxBlockRange * 1.5));
                    console.log(`[EventListener] Increasing max block range to ${this.maxBlockRange}`);
                }

                const allEvents = [];

                for (const log of logs) {
                    try {
                        const parsedLog = this.contract.interface.parseLog({
                            topics: log.topics,
                            data: log.data
                        });

                        if (parsedLog) {
                            allEvents.push({
                                eventName: parsedLog.name,
                                eventData: this._parseEventData(parsedLog.name, parsedLog.args),
                                blockNumber: log.blockNumber,
                                transactionHash: log.transactionHash,
                                logIndex: log.index
                            });
                        }
                    } catch (error) {
                        // Skip logs that don't match our ABI
                        continue;
                    }
                }

                // Sort by block number and log index
                allEvents.sort((a, b) => {
                    if (a.blockNumber !== b.blockNumber) {
                        return a.blockNumber - b.blockNumber;
                    }
                    return a.logIndex - b.logIndex;
                });

                return allEvents;
            } catch (error) {
                // Adaptive range adjustment on error
                const range = toBlock - fromBlock + 1;

                // Only shrink log windows for actual eth_getLogs range/result limits.
                // Throughput 429s need RPC failover/backoff, not permanent 10-block chunks.
                if (this._isRangeLimitError(error)) {
                    this.maxBlockRange = Math.max(this.minBlockRange, Math.floor(range * 0.5));
                    console.warn(`[EventListener] RPC range limit hit, reducing max block range to ${this.maxBlockRange}`);
                }

                throw error;
            }
        }, `queryLogsChunk(${fromBlock}-${toBlock})`);
    }

    _parseEventData(eventName, args) {
        const parsed = parseV41EventData(eventName, args);
        if (Object.keys(parsed).length === 0) {
            console.warn(`[EventListener] No mapping for event ${eventName}`);
        }
        return parsed;
    }

    _parseEventArgs(args) {
        const parsed = {};

        // ethers.js returns Result object with both indexed and named properties
        // We need to extract only named properties (non-numeric keys)
        const keys = Object.keys(args).filter(key => isNaN(Number(key)));

        for (const key of keys) {
            const value = args[key];
            if (typeof value === 'bigint') {
                parsed[key] = value;
            } else {
                parsed[key] = value;
            }
        }

        return parsed;
    }

    async getCurrentBlock() {
        return await this._readRpcCall(
            provider => provider.getBlockNumber(),
            'getCurrentBlock'
        );
    }

    async getBlock(blockNumber) {
        return await this._readRpcCall(
            provider => provider.getBlock(Number(blockNumber)),
            `getBlock(${blockNumber})`
        );
    }
}

export default EventListener;

if (typeof window !== 'undefined') {
    window.EventListener = EventListener;
}
